import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("bundled documents advance untouched installations without replacing operator revisions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "kernel-documents-"));
  const defaultsDir = path.join(directory, "defaults");
  const dataDir = path.join(directory, "data");
  const stores = [];
  try {
    cpSync(path.resolve("data/defaults"), defaultsDir, { recursive: true });
    writeFileSync(path.join(defaultsDir, "overview.md"), "# Previous Overview\n", "utf8");
    writeFileSync(path.join(defaultsDir, "constitution.md"), "# Previous Constitution\n", "utf8");
    const open = () => {
      const store = new KernelStore({ dataDir, defaultsDir, initialPasswordHash: "audit-only-verifier" });
      stores.push(store);
      return store;
    };

    const previous = open();
    const previousOverview = previous.getDocument("overview");
    previous.close();
    stores.pop();

    const currentOverview = readFileSync(path.resolve("data/defaults/overview.md"), "utf8");
    const currentConstitution = readFileSync(path.resolve("data/defaults/constitution.md"), "utf8");
    writeFileSync(path.join(defaultsDir, "overview.md"), currentOverview, "utf8");
    writeFileSync(path.join(defaultsDir, "constitution.md"), currentConstitution, "utf8");
    const migrated = open();
    assert.equal(migrated.getDocument("overview").content, currentOverview);
    assert.equal(migrated.getDocument("overview").reason, "bundled-update");
    assert.equal(migrated.getDocument("overview").source_revision, previousOverview.revision);
    assert.equal(migrated.getDocument("constitution").content, currentConstitution);
    migrated.createDocumentRevision("overview", "# Operator Overview\n", "operator", "upload");
    migrated.close();
    stores.pop();

    writeFileSync(path.join(defaultsDir, "overview.md"), "# Future Bundled Overview\n", "utf8");
    const preserved = open();
    assert.equal(preserved.getDocument("overview").content, "# Operator Overview\n");
    assert.equal(preserved.getDocument("overview").reason, "upload");
  } finally {
    stores.forEach((store) => store.close());
    rmSync(directory, { recursive: true, force: true });
  }
});
