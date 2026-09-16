#!/usr/bin/env python3
"""Validate Kernel's rendered production and release contract without claiming production activation."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
values = {}
for line in (root / ".env.example").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.startswith("#"):
        key, value = line.split("=", 1)
        values[key] = value
assert values["KERNEL_VERSION"] == version
assert values["KERNEL_ACCESS_KEY"] == ""
values.update({
    "KERNEL_ACCESS_KEY": "CHANGE_ME",
    "KERNEL_URL": "https://kernel.example.test",
    "KERNEL_IMAGE": "ghcr.io/psewdon1m-exocortex/kernel@sha256:" + "a" * 64,
    "KERNEL_SESSION_SECRET": "s" * 48,
    "KERNEL_SERVICE_TOKEN": "t" * 32,
    "UPDATER_CONTROL_TOKEN": "u" * 48,
    "UPDATER_SOCKET_GID": "1001",
    "NEPTUNE_SOCKET_GID": "1002",
    "NEPTUNE_CONTROL_TOKEN_HOST_FILE": "/run/contract/neptune-control.token",
    "NEPTUNE_EXPORT_TOKEN_HOST_FILE": "/run/contract/neptune-export.token",
})
with tempfile.TemporaryDirectory() as directory:
    env_file = Path(directory) / "kernel.env"
    env_file.write_text("\n".join(key + "=" + value for key, value in values.items()), encoding="utf-8")
    clean_env = {key: value for key, value in os.environ.items() if key not in values}
    rendered = json.loads(subprocess.check_output([
        "docker", "compose", "--env-file", str(env_file),
        "-f", str(root / "compose.production.yaml"), "config", "--format", "json",
    ], cwd=root, env=clean_env, text=True))
kernel = rendered["services"]["kernel"]
assert kernel["image"].endswith("@sha256:" + "a" * 64)
assert kernel["environment"]["KERNEL_VERSION"] == version
assert kernel["environment"]["KERNEL_ACCESS_KEY"] == "CHANGE_ME"
assert len(kernel["ports"]) == 1
assert kernel["ports"][0]["host_ip"] == "127.0.0.1"
assert int(kernel["ports"][0]["published"]) == 18180
assert kernel["read_only"] and "ALL" in kernel["cap_drop"]
assert "no-new-privileges:true" in kernel["security_opt"]
assert kernel["environment"]["KERNEL_COOKIE_SECURE"] == "true"
assert kernel["environment"]["KERNEL_TRUSTED_PROXIES"] not in ["*", "0.0.0.0/0"]
assert not any(re.search(r"nginx|coturn", name, re.I) for name in rendered["services"])
assert not any(name in kernel["environment"] for name in ["VOLT_KERNEL_TOKEN", "SATURN_CLIENT_TOKEN"])

installer = (root / "install.sh").read_text(encoding="utf-8")
assert "/opt/exocortex/volt/.env" not in installer and "/opt/exocortex/saturn/.env" not in installer
assert "KERNEL_ACCESS_KEY must contain at least" not in installer
assert 'case "$access_key"' not in installer
assert 'set_env KERNEL_ACCESS_KEY' not in installer
assert "credential_root=/etc/exocortex/bootstrap-credentials" in installer
assert "chmod 0600" in installer and "chown root:root" in installer
if shutil.which("sh"):
    for script in ["bootstrap.sh", "install.sh"]:
        subprocess.run(["sh", "-n", str(root / script)], check=True)

bootstrap = (root / "bootstrap.sh").read_text(encoding="utf-8")
assert "--retry 3" in bootstrap and "--max-filesize 16384" in bootstrap
assert "KERNEL_BOOTSTRAP_PUBLIC_KEY_B64" in bootstrap and "PRIVATE KEY" not in bootstrap
release = (root / ".github/workflows/release.yml").read_text(encoding="utf-8")
for term in ["kernel-v*", "known-problems-gate.py", "--phase pre-signing", "--phase final", "--prerelease"]:
    assert term in release, term
nginx = (root / "nginx.security.conf").read_text(encoding="utf-8")
for term in ["X-Forwarded-Proto https", "X-Forwarded-For $proxy_add_x_forwarded_for", "location = /api/health", "location = /api/internal/updater/restore"]:
    assert term in nginx, term
readiness = (root / "DEPLOYMENT_READINESS.md").read_text(encoding="utf-8")
for term in ["NOT_RUN", "rollback", "SHA-256", "128 MiB", "Neptune", ".env"]:
    assert term.lower() in readiness.lower(), term
policy = json.loads((root / ".release/known-problems-policy.json").read_text(encoding="utf-8"))
assert policy["active_ids"] == 97 and len(policy["catalog_revision"]) == 40
assert (root / ".release/updater.version").read_text(encoding="utf-8").strip() == "0.4.3"
print(json.dumps({
    "service": "kernel",
    "version": version,
    "result": "PASS",
    "scope": "rendered Compose, exact Access Key boundary, own installer/trust, release and Nginx templates",
    "production_activation": "NOT_RUN",
}))
