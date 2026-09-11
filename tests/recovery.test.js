import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { KernelStore } from "../server/store.js";

test("clean recovery preserves identities, histories, personalization and Volt bootstrap URL", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "kernel-recovery-"));
  const stores = [];
  try {
    const make = (name) => {
      const store = new KernelStore({ dataDir: path.join(directory, name), defaultsDir: path.resolve("data/defaults"), initialPasswordHash: "audit-only-verifier" });
      stores.push(store); return store;
    };
    const source = make("source");
    source.createDocumentRevision("overview", "second overview", "audit", "edit");
    source.setSetting("navigation_order", JSON.stringify(["settings", "constitution", "register", "topology", "overview", "dashboard"]));
    source.setSetting("volt_url", "https://volt.audit.invalid");
    const backup = source.exportBackup(), target = make("target");
    target.importBackup(backup, "audit");
    const restored = target.exportBackup();
    assert.deepEqual(restored.authoritative.settings, backup.authoritative.settings);
    for (const table of ["document_revisions", "register_entries", "register_revisions", "topology_revisions"]) {
      assert.deepEqual(restored.authoritative.tables[table], backup.authoritative.tables[table]);
    }
    const bad = structuredClone(backup);
    bad.authoritative.tables.register_entries.push(bad.authoritative.tables.register_entries[0]);
    const before = JSON.stringify(target.exportBackup().authoritative);
    assert.throws(() => target.importBackup(bad, "audit"));
    assert.equal(JSON.stringify(target.exportBackup().authoritative), before);
    assert.equal(JSON.stringify(backup).includes("audit-only-verifier"), false);
  } finally { stores.forEach((store) => store.close()); rmSync(directory, { recursive: true, force: true }); }
});
