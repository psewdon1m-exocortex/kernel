#!/usr/bin/env python3
"""Exercise Kernel packaging, signing and clean-host bootstrap in a disposable root container."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
target = Path("/opt/exocortex/kernel")
trust = Path("/etc/exocortex/release-trust/kernel.pem")
if not Path("/.dockerenv").exists() or os.geteuid() != 0:
    raise SystemExit("Run only as root in a disposable Docker container")
if target.exists() or trust.exists():
    raise SystemExit("Test requires an empty disposable installation root")
checks = []


def run(arguments, *, env=None, expected=0, cwd=root):
    result = subprocess.run(arguments, cwd=cwd, env=env, capture_output=True, text=True)
    if (result.returncode == 0) != (expected == 0):
        raise AssertionError(
            f"{arguments[0]} exit {result.returncode}: {result.stdout[-2000:]} {result.stderr[-2000:]}"
        )
    return result


with tempfile.TemporaryDirectory(prefix="kernel-bootstrap-test-") as directory:
    work = Path(directory)
    private = work / "test-signing.pem"
    run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072", "-out", str(private)])
    env = {**os.environ, "RELEASE_SIGNING_KEY_FILE": str(private)}
    output = work / "artifacts"
    run(["node", "scripts/sign-release.mjs", "--export-public-key", str(output / "kernel.pem")], env=env)
    helper = work / "updater"
    (helper / "release-trust").mkdir(parents=True)
    (helper / "systemd").mkdir()
    (helper / "install.sh").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    (helper / "updater-linux-amd64").write_text("#!/bin/sh\necho synthetic-helper\n", encoding="utf-8")
    (helper / "systemd/updater.service").write_text("[Service]\nExecStart=/usr/bin/updater\n", encoding="utf-8")
    for scope in ["updater", "neptune", "gryphon"]:
        shutil.copyfile(output / "kernel.pem", helper / "release-trust" / (scope + ".pem"))
    env.update({
        "GITHUB_REPOSITORY": "psewdon1m-exocortex/kernel",
        "IMAGE_REFERENCE": "ghcr.io/psewdon1m-exocortex/kernel",
        "IMAGE_DIGEST": "sha256:" + "a" * 64,
        "UPDATER_BUNDLE_DIR": str(helper),
        "UPDATER_BUNDLE_VERSION": (root / ".release/updater.version").read_text(encoding="utf-8").strip(),
    })
    run(["bash", "scripts/build-release.sh", version, str(output)], env=env)
    manifest = output / "kernel-release.json"
    run(["node", "scripts/sign-release.mjs", str(manifest)], env=env)
    run(["node", "scripts/build-bootstrap.mjs", "bootstrap.sh", str(output / "kernel.pem"), str(output / "bootstrap.sh"), version], env=env)
    assets = {file.name: file.read_bytes() for file in output.iterdir()}
    binaries = work / "bin"
    binaries.mkdir()
    curl = binaries / "curl"
    curl.write_text(
        "#!/usr/bin/env python3\n"
        "import os,shutil,sys\n"
        "from pathlib import Path\n"
        "a=sys.argv[1:];url=next((x for x in a if x.startswith('https://')),None);out=a[a.index('-o')+1]\n"
        "base=os.environ['FIXTURE_BASE']\n"
        "if not url or not url.startswith(base+'/') or '/' in url[len(base)+1:]:sys.exit(22)\n"
        "shutil.copyfile(Path(os.environ['FIXTURE_ASSETS'])/url.rsplit('/',1)[-1],out)\n",
        encoding="utf-8",
    )
    curl.chmod(0o755)
    apt = binaries / "apt-get"
    apt.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    apt.chmod(0o755)
    env.update({
        "PATH": str(binaries) + ":" + os.environ["PATH"],
        "FIXTURE_ASSETS": str(output),
        "FIXTURE_BASE": f"https://github.com/psewdon1m-exocortex/kernel/releases/download/kernel-v{version}",
    })
    bootstrap = output / "bootstrap.sh"

    def reset():
        if target.exists():
            shutil.rmtree(target)
        trust.unlink(missing_ok=True)
        for name, data in assets.items():
            (output / name).write_bytes(data)

    def check(name, callback):
        reset()
        callback()
        checks.append({"name": name, "result": "PASS"})
        print("PASS:", name, flush=True)

    def clean_install():
        run(["sh", str(bootstrap)], env=env)
        contents = (target / ".env").read_text(encoding="utf-8")
        assert (target / ".env").stat().st_mode & 0o777 == 0o600
        assert "KERNEL_ACCESS_KEY=\n" in contents
        assert "KERNEL_ACCESS_KEY=CHANGE_ME" not in contents
        assert "KERNEL_SESSION_SECRET=replace-" not in contents
        assert "@sha256:" + "a" * 64 in contents
        assert trust.read_bytes() == assets["kernel.pem"]
        assert "PRIVATE KEY" not in bootstrap.read_text(encoding="utf-8")
        assert Path("/usr/local/sbin/kernel-install").exists()
        before = hashlib.sha256((target / ".env").read_bytes()).digest()
        run(["sh", str(bootstrap)], env=env, expected=1)
        assert hashlib.sha256((target / ".env").read_bytes()).digest() == before

    check("exact-version bootstrap creates private own env and immutable public trust", clean_install)

    def altered_signature():
        manifest.write_bytes(manifest.read_bytes() + b" ")
        run(["sh", str(bootstrap)], env=env, expected=1)
        assert not target.exists()

    check("altered signed manifest is rejected before staging", altered_signature)

    def wrong_identity():
        body = json.loads(manifest.read_text(encoding="utf-8"))
        body["version"] = "99.99.99"
        manifest.write_text(json.dumps(body), encoding="utf-8")
        run(["node", "scripts/sign-release.mjs", str(manifest)], env=env)
        run(["sh", str(bootstrap)], env=env, expected=1)
        assert not target.exists()

    check("valid signature cannot override the selected release identity", wrong_identity)

    bundle = output / f"kernel-{version}-compose.tar.gz"

    def corrupt_bundle():
        data = bytearray(bundle.read_bytes())
        data[-15] ^= 255
        bundle.write_bytes(data)
        run(["sh", str(bootstrap)], env=env, expected=1)
        assert not target.exists()

    check("bundle checksum mismatch is rejected", corrupt_bundle)

    def unsafe_archive():
        with tarfile.open(bundle, "w:gz") as archive:
            member = tarfile.TarInfo("../escape")
            member.size = 1
            archive.addfile(member, io.BytesIO(b"x"))
        body = json.loads(manifest.read_text(encoding="utf-8"))
        body["compose_bundle"]["sha256"] = hashlib.sha256(bundle.read_bytes()).hexdigest()
        manifest.write_text(json.dumps(body), encoding="utf-8")
        run(["node", "scripts/sign-release.mjs", str(manifest)], env=env)
        run(["sh", str(bootstrap)], env=env, expected=1)
        assert not target.exists()

    check("signed path traversal archive is rejected", unsafe_archive)

    def foreign_trust():
        trust.parent.mkdir(parents=True, exist_ok=True)
        trust.write_text("previous explicit public trust\n", encoding="utf-8")
        run(["sh", str(bootstrap)], env=env, expected=1)
        assert trust.read_text(encoding="utf-8") == "previous explicit public trust\n"
        assert not target.exists()

    check("existing foreign trust is never silently replaced", foreign_trust)
    reset()

print(json.dumps({"service": "kernel", "version": version, "checks": checks, "transport": "fixture", "systemd_tested": False}))
