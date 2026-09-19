import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectRegisterProfile, validateProfileBindings, inspectResolvedProfile } from "../server/register-profile.js";
import { KernelStore } from "../server/store.js";

test("six-service profile requires its baseline and preserves additional Register entries", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-profile-"));
  const defaultsDir = path.resolve("data/defaults");
  const profile = JSON.parse(fs.readFileSync(path.join(defaultsDir, "register.json"), "utf8"));
  const store = new KernelStore({ dataDir: directory, defaultsDir, initialPasswordHash: "synthetic-test-verifier" });
  try {
    assert.equal(inspectRegisterProfile(store.listRegisterEntries(), profile).ready, false);
    const reference = "volt://3518462b-bb66-459a-a1ab-c38a837740ab/4";
    const bindings = Object.fromEntries(profile.map(entry => [entry.key, reference]));
    assert.equal(validateProfileBindings({ ...bindings, "services.custom.sni": reference }, profile).length, profile.length);
    assert.throws(() => validateProfileBindings({ ...bindings, "services.volt.port": "443" }, profile));
    store.createRegisterEntry({ key: "services.custom.sni", value: reference, description: "Custom service" }, "test");
    const previous = store.getRegisterMachineSnapshot().revision;
    store.upsertRegisterEntries(validateProfileBindings(bindings, profile), "operator");
    const status = inspectRegisterProfile(store.listRegisterEntries(), profile);
    assert.equal(status.ready, true);
    assert.equal(Object.hasOwn(status, "extra"), false);
    assert.ok(store.listRegisterEntries().some(entry => entry.key === "services.custom.sni"));
    store.restoreRegister(previous, "operator");
    assert.ok(store.listRegisterEntries().some(entry => entry.key === "services.custom.sni"));
    assert.deepEqual(inspectResolvedProfile({ "services.volt.port": "70000", "repositories.saturn.url": "http://invalid.test/a/b" }).invalid, ["repositories.saturn.url", "services.volt.port"]);
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
