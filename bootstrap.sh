#!/usr/bin/env sh
set -eu

REPOSITORY="psewdon1m-exocortex/kernel"
INSTALL_DIR="${KERNEL_INSTALL_DIR:-/opt/exocortex/kernel}"
API_URL="https://api.github.com/repos/$REPOSITORY/releases?per_page=100"

[ "$(id -u)" -eq 0 ] || { echo "Run the Kernel bootstrap as root." >&2; exit 4; }
[ ! -f "$INSTALL_DIR/.env" ] || {
  echo "Kernel is already prepared at $INSTALL_DIR. Use the Settings updater for an existing installation." >&2
  exit 5
}
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl openssl python3 tar

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT INT TERM
curl -fsSL --retry 3 --connect-timeout 10 "$API_URL" -o "$temporary/releases.json"

manifest_url=$(python3 - "$temporary/releases.json" <<'PY'
import json, re, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    releases = json.load(handle)
candidates = []
for release in releases:
    match = re.fullmatch(r"kernel-v(\d+)\.(\d+)\.(\d+)", str(release.get("tag_name") or ""))
    if match and not release.get("draft") and not release.get("prerelease"):
        candidates.append((tuple(map(int, match.groups())), release))
if not candidates:
    raise SystemExit("No stable kernel-v* release is available.")
release = max(candidates, key=lambda item: item[0])[1]
for asset in release.get("assets") or []:
    if asset.get("name") == "kernel-release.json":
        print(asset["browser_download_url"])
        break
else:
    raise SystemExit("The selected Kernel release has no manifest.")
PY
)
curl -fsSL --retry 3 --connect-timeout 10 "$manifest_url" -o "$temporary/manifest.json"

trust_file="${EXOCORTEX_RELEASE_TRUST_FILE:-/etc/exocortex/release-trust/kernel.pem}"
[ -f "$trust_file" ] || { echo "Provision the Kernel release public key before bootstrap." >&2; exit 15; }
curl -fsSL --proto '=https' --proto-redir '=https' --max-filesize 16384 "${manifest_url}.sig.json" -o "$temporary/manifest.sig.json"
python3 - "$temporary/manifest.json" "$temporary/manifest.sig.json" "$trust_file" <<'PYVERIFY'
"""Bootstrap verifier: only a pre-provisioned public key establishes trust."""
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

manifest, envelope, trust = map(Path, sys.argv[1:])
if manifest.stat().st_size > 2 * 1024 * 1024 or envelope.stat().st_size > 16384 or trust.stat().st_size > 16384:
    raise SystemExit("Release signature input exceeds limit")
signed = json.loads(envelope.read_text(encoding="utf8"))
if signed.get("schema") != "exocortex.release-signature.v1" or signed.get("algorithm") != "RSA-PSS-SHA256":
    raise SystemExit("Unsupported release signature")
public = subprocess.run(["openssl", "pkey", "-pubin", "-in", str(trust), "-outform", "DER"], check=True, capture_output=True).stdout
if hashlib.sha256(public).hexdigest() != signed.get("key_id"):
    raise SystemExit("Release signer is not trusted")
description = subprocess.run(["openssl", "rsa", "-pubin", "-in", str(trust), "-text", "-noout"], check=True, capture_output=True, text=True).stdout
bits = re.search(r"Public-Key: \((\d+) bit\)", description)
if not bits or int(bits[1]) < 3072:
    raise SystemExit("Release trust requires RSA with at least 3072 bits")
with tempfile.TemporaryDirectory(prefix="exocortex-signature-") as temporary:
    signature = Path(temporary) / "signature.bin"
    signature.write_bytes(base64.b64decode(signed["signature"], validate=True))
    subprocess.run(["openssl", "dgst", "-sha256", "-verify", str(trust), "-signature", str(signature), "-sigopt", "rsa_padding_mode:pss", "-sigopt", "rsa_pss_saltlen:32", str(manifest)], check=True)
PYVERIFY

fields=$(python3 - "$temporary/manifest.json" <<'PY'
import json, re, sys
from urllib.parse import urlparse
with open(sys.argv[1], encoding="utf-8") as handle:
    manifest = json.load(handle)
bundle = manifest.get("compose_bundle") or {}
image = manifest.get("image") or {}
version = str(manifest.get("version") or "")
url = str(bundle.get("url") or "")
checksum = str(bundle.get("sha256") or "").removeprefix("sha256:").lower()
reference = str(image.get("reference") or "")
digest = str(image.get("digest") or "")
parsed = urlparse(url)
if manifest.get("schema_version") != 1 or manifest.get("service") != "kernel":
    raise SystemExit("Invalid Kernel release manifest identity.")
if not re.fullmatch(r"\d+\.\d+\.\d+", version):
    raise SystemExit("Invalid Kernel release version.")
if parsed.scheme != "https" or parsed.hostname != "github.com":
    raise SystemExit("Kernel bundle must be downloaded from GitHub over HTTPS.")
if not re.fullmatch(r"[a-f0-9]{64}", checksum):
    raise SystemExit("Invalid Kernel bundle checksum.")
if not reference.startswith("ghcr.io/") or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
    raise SystemExit("Invalid immutable Kernel image reference.")
print(version)
print(url)
print(checksum)
print(reference + "@" + digest)
PY
)
version=$(printf '%s\n' "$fields" | sed -n '1p')
bundle_url=$(printf '%s\n' "$fields" | sed -n '2p')
bundle_sha=$(printf '%s\n' "$fields" | sed -n '3p')
image=$(printf '%s\n' "$fields" | sed -n '4p')

curl -fsSL --retry 3 --connect-timeout 10 "$bundle_url" -o "$temporary/kernel.tar.gz"
printf '%s  %s\n' "$bundle_sha" "$temporary/kernel.tar.gz" | sha256sum -c -
if tar -tzf "$temporary/kernel.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Kernel release archive contains an unsafe path." >&2
  exit 14
fi
mkdir -p "$temporary/stage" "$INSTALL_DIR"
tar -xzf "$temporary/kernel.tar.gz" -C "$temporary/stage" --no-same-owner --no-same-permissions
cp -a "$temporary/stage/." "$INSTALL_DIR/"
chown -R root:root "$INSTALL_DIR"
chmod 0755 "$INSTALL_DIR/install.sh"
KERNEL_RELEASE_VERSION="$version" KERNEL_RELEASE_IMAGE="$image" \
  "$INSTALL_DIR/install.sh" prepare
