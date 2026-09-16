"""Fail-closed regression tests for the Part 12 evidence gate."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("policy_gate", Path(__file__).with_name("known-problems-gate.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.directory = self.root / "evidence"
        self.directory.mkdir()
        self.catalog = b"| **TEST-01** | A problem | An executable prevention |\n"
        (self.directory / "catalog.md").write_bytes(self.catalog)
        self.policy = {
            "service": "synthetic",
            "catalog_revision": "a" * 40,
            "catalog_sha256": hashlib.sha256(self.catalog).hexdigest(),
            "active_ids": 1,
            "remote_path": "catalog.md",
            "case_defaults": {"TEST": ["unit"]},
            "case_overrides": {},
            "final_checks": [],
            "not_applicable": {},
        }
        self.policy_path = self.root / "policy.json"
        self.save()
        self.receipt = {
            "revision": "b" * 40,
            "catalog_sha256": self.policy["catalog_sha256"],
            "run_id": "synthetic:1",
            "case": "unit",
            "command": ["synthetic-test"],
            "exit_code": 0,
            "log": "unit.log",
            "log_sha256": hashlib.sha256(b"passed").hexdigest(),
        }

    def save(self):
        self.policy_path.write_text(json.dumps(self.policy), encoding="utf-8")

    def receipt_file(self):
        (self.directory / "unit.log").write_bytes(b"passed")
        (self.directory / "unit.json").write_text(json.dumps(self.receipt), encoding="utf-8")

    def run_gate(self, phase="final", dirty=False, tag="synthetic-v1.0.0"):
        def fake_git(*args):
            if args[0] == "status":
                return " M tracked.py" if dirty else ""
            return "b" * 40
        with (
            patch.object(gate, "ROOT", self.root),
            patch.object(gate, "POLICY", self.policy_path),
            patch.object(gate, "git", fake_git),
            patch.dict(os.environ, {"GITHUB_RUN_ID": "synthetic", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_REF_NAME": tag}),
            patch.object(sys, "argv", ["gate", "--phase", phase, "--evidence-dir", "evidence"]),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            code = gate.main()
        return code, json.loads((self.root / "known-problems-report.json").read_text(encoding="utf-8"))

    def test_missing_evidence_cannot_qualify(self):
        code, report = self.run_gate()
        self.assertEqual(code, 1)
        self.assertFalse(report["release_qualification"])

    def test_current_receipt_qualifies_but_production_activation_remains_explicit(self):
        self.receipt_file()
        code, report = self.run_gate()
        self.assertEqual(code, 0)
        self.assertTrue(report["release_qualification"])
        self.assertEqual(report["deployment_activation"]["status"], "NOT_RUN")

    def test_stale_revision_run_catalog_or_case_is_rejected(self):
        for key in ["revision", "run_id", "catalog_sha256", "case"]:
            with self.subTest(key=key):
                old = self.receipt[key]
                self.receipt[key] = "stale"
                self.receipt_file()
                self.assertEqual(self.run_gate()[0], 1)
                self.receipt[key] = old

    def test_modified_log_and_failed_command_are_rejected(self):
        self.receipt_file()
        (self.directory / "unit.log").write_bytes(b"tampered")
        self.assertEqual(self.run_gate()[0], 1)
        self.receipt["exit_code"] = 1
        self.receipt_file()
        self.assertEqual(self.run_gate()[1]["checks"][0]["status"], "FAIL")

    def test_duplicate_json_missing_prefix_and_unknown_override_fail_closed(self):
        with self.assertRaises(ValueError):
            gate.unique_object([("ID", 1), ("ID", 2)])
        self.policy["case_defaults"] = {}
        self.save()
        with self.assertRaises(ValueError):
            self.run_gate()
        self.policy["case_defaults"] = {"TEST": ["unit"]}
        self.policy["case_overrides"] = {"UNKNOWN-01": ["unit"]}
        self.save()
        with self.assertRaises(ValueError):
            self.run_gate()

    def test_altered_catalog_dirty_source_wrong_tag_and_final_deferral(self):
        (self.directory / "catalog.md").write_bytes(b"changed")
        with self.assertRaises(ValueError):
            self.run_gate()
        (self.directory / "catalog.md").write_bytes(self.catalog)
        self.receipt_file()
        with self.assertRaises(ValueError):
            self.run_gate(dirty=True)
        with self.assertRaises(ValueError):
            self.run_gate(tag="v1.0.0")
        self.policy["final_checks"] = ["TEST-01"]
        self.save()
        self.assertEqual(self.run_gate("pre-signing")[0], 0)
        self.assertEqual(self.run_gate("final")[0], 1)


if __name__ == "__main__":
    unittest.main()
