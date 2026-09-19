import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";
import { createKernelApp } from "../server/app.js";
import { PRINCIPALS_SETTING } from "../server/machine-principals.js";

const legacy = "legacy-token-" + "a".repeat(32), wyvern = "wyvern-token-" + "b".repeat(32), client = "client-token-" + "c".repeat(32);
const digest = value => createHash("sha256").update(value).digest("hex");
const configRef = "volt://11111111-1111-4111-8111-111111111111/1";
const secretRef = "volt://22222222-2222-4222-8222-222222222222/1";
const publicRef = "volt://33333333-3333-4333-8333-333333333333/1";

async function setup(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "kernel-wyvern-"));
  const calls = [];
  const app = createKernelApp({ dataDir: directory, defaultsDir: path.resolve("data/defaults"), distDir: path.join(directory, "none"),
    accessKey: "operator", sessionSecret: "s".repeat(40), apiToken: legacy, diskPath: directory,
    voltClient: { async resolve(references) {
      calls.push(references);
      return { schema: "volt.resolve.v1", resolution_revision: "volt-generation", values: Object.fromEntries(references.map(ref =>
        [ref, { value: ref === secretRef ? "synthetic-provider-secret" : "value", visibility: ref === secretRef ? "secret" : "plain", revision: 7 }])) };
    } }, serviceStatusFetch: async () => { throw new Error("fixture offline"); },
  });
  t.after(() => { app.locals.kernel.close(); rmSync(directory, { recursive: true, force: true }); });
  app.locals.kernel.store.upsertRegisterEntries([
    { key: "wyvern.config.active", value: configRef, description: "config" },
    { key: "wyvern.credentials.google", value: secretRef, description: "key" },
    { key: "services.laboratory.ai.old_key", value: secretRef, description: "legacy alias" },
    { key: "repositories.wyvern.url", value: publicRef, description: "repository" },
  ], "test", { replace: true });
  const agent = request.agent(app);
  assert.equal((await agent.post("/api/auth/login").send({ access_key: "operator" })).status, 200);
  const grant = (id, token, allowed_keys, enabled = true) => agent.put("/api/machine-principals/" + id).send({ token_sha256: digest(token), allowed_keys, enabled });
  const resolve = (token, keys, extra = {}) => request(app).post("/api/v1/register/resolve").set("Authorization", "Bearer " + token).send({ keys, ...extra });
  return { app, agent, grant, resolve, calls };
}

test("legacy cannot resolve Wyvern keys or aliases but retains unrelated discovery", async t => {
  const f = await setup(t);
  for (const key of ["wyvern.config.active", "wyvern.credentials.google", "services.laboratory.ai.old_key"])
    assert.equal((await f.resolve(legacy, [key])).status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.resolve(legacy, ["repositories.wyvern.url"])).status, 200);
});

test("principals are exact-key scoped and independently revocable", async t => {
  const f = await setup(t);
  assert.equal((await f.grant("wyvern", wyvern, ["wyvern.config.active", "wyvern.credentials.google"])).status, 200);
  assert.equal((await f.grant("laboratory", client, ["repositories.wyvern.url"])).status, 200);
  assert.equal((await f.resolve(wyvern, ["wyvern.credentials.google"])).body.values["wyvern.credentials.google"].value, "synthetic-provider-secret");
  assert.equal((await f.resolve(client, ["wyvern.credentials.google"])).status, 403);
  assert.equal((await f.resolve(wyvern, ["repositories.wyvern.url"])).status, 403);
  assert.equal((await request(f.app).put("/api/machine-principals/other").set("Authorization", "Bearer " + wyvern).send({})).status, 403);
  await f.grant("wyvern", wyvern, ["wyvern.config.active", "wyvern.credentials.google"], false);
  assert.equal((await f.resolve(wyvern, ["wyvern.credentials.google"])).status, 401);
});

test("revision preconditions prevent activation of a mixed bundle", async t => {
  const f = await setup(t); await f.grant("wyvern", wyvern, ["wyvern.config.active", "wyvern.credentials.google"]);
  const first = await f.resolve(wyvern, ["wyvern.config.active"]);
  assert.equal((await f.resolve(wyvern, ["wyvern.config.active"], { expected_register_revision: "different" })).status, 409);
  const conflict = await f.resolve(wyvern, ["wyvern.config.active", "wyvern.credentials.google"], { expected_register_revision: first.body.register_revision, expected_volt_revisions: { "wyvern.config.active": 6 } });
  assert.equal(conflict.status, 409); assert.equal(JSON.stringify(conflict.body).includes("synthetic-provider-secret"), false);
  const valid = await f.resolve(wyvern, ["wyvern.config.active", "wyvern.credentials.google"], { expected_register_revision: first.body.register_revision, expected_volt_revisions: { "wyvern.config.active": 7 } });
  assert.equal(valid.status, 200); assert.equal(valid.body.resolution_revision, "volt-generation");
  assert.equal((await f.resolve(wyvern, ["wyvern.config.active"], { expected_volt_revisions: { "unrequested": 1 } })).status, 400);
});

test("principal verifiers are recoverable metadata; tokens never enter settings or output", async t => {
  const f = await setup(t); await f.grant("wyvern", wyvern, ["wyvern.config.active"]);
  const response = await f.agent.get("/api/machine-principals");
  assert.equal(JSON.stringify(response.body).includes(digest(wyvern)), false);
  const backup = f.app.locals.kernel.store.exportBackup();
  assert.ok(backup.authoritative.settings.find(item => item.key === PRINCIPALS_SETTING));
  assert.equal(JSON.stringify(backup).includes(wyvern), false);
  assert.equal((await f.grant("alias", legacy, [])).status, 400);
  assert.equal((await f.grant("duplicate", wyvern, [])).status, 400);
  assert.equal((await f.grant("wildcard", client, ["wyvern.*"])).status, 400);
});
