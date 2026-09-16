#!/usr/bin/env python3
"""Verify the pinned Updater bundle surface consumed by Kernel releases."""
import json
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
bundle = Path(sys.argv[1]).resolve()
expected_version = (root / ".release/updater.version").read_text(encoding="utf-8").strip()
assert re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", expected_version)
required = [
    "install.sh",
    "updater-linux-amd64",
    "systemd/updater.service",
    "release-trust/updater.pem",
    "release-trust/neptune.pem",
    "release-trust/gryphon.pem",
]
for relative in required:
    item = bundle / relative
    assert item.is_file() and not item.is_symlink() and item.stat().st_size > 0, relative
for pem in (bundle / "release-trust").glob("*.pem"):
    text = pem.read_text(encoding="utf-8")
    assert "PUBLIC KEY" in text and "PRIVATE KEY" not in text
unit = (bundle / "systemd/updater.service").read_text(encoding="utf-8")
assert "ExecStart=" in unit
installer = (bundle / "install.sh").read_text(encoding="utf-8")
assert "updater" in installer.lower()
print(json.dumps({"result": "PASS", "updater_version": expected_version, "required": required}))
