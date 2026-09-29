import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";
import { createKernelApp } from "../server/app.js";
import { PRINCIPALS_SETTING } from "../server/machine-principals.js";

const sha = value => createHash("sha256").update(value).digest("hex");
const host = "host-1234567890abcdef12345678";
const configRef = "volt://11111111-1111-4111-8111-111111111111/1";

test("Wyvern enrollment accepts only its host-bound Updater machine principal and is idempotent", async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "kernel-machine-enroll-"));
  const machine = "updater-machine-" + "m".repeat(32);
  const legacy = "legacy-service-" + "l".repeat(32);
  let revision = 0;
  const app = createKernelApp({ dataDir: directory, defaultsDir: path.resolve("data/defaults"), distDir: path.join(directory, "none"),
    accessKey: "operator", sessionSecret: "s".repeat(40), apiToken: legacy, updaterMachineToken: machine, updaterHostID: host,
    diskPath: directory, serviceStatusFetch: async () => { throw new Error("fixture offline"); },
    voltClient: {
      async wyvern(operation) {
        if (operation === "publish") revision = 1;
        return { revision, references: revision ? { ["wyvern.instances." + host + ".config"]: configRef } : {} };
      },
      async resolve() {
        return { values: { [configRef]: { revision: 1, value: JSON.stringify({ schema: "exocortex.wyvern.config.v1", instance_id: host, adapters: {}, clients: {} }) } } };
      },
    },
  });
  t.after(() => { app.locals.kernel.close(); rmSync(directory, { recursive: true, force: true }); });
  const endpoint = "/api/wyvern/instances/" + host + "/enroll";
  const body = { host_id: host, manager_token_sha256: sha("manager"), runtime_token_sha256: sha("runtime") };
  const post = (token, input = body) => request(app).post(endpoint).set("Authorization", "Bearer " + token).send(input);
  const agent = request.agent(app);
  assert.equal((await agent.post("/api/auth/login").send({ access_key: "operator" })).status, 200);
  assert.equal((await agent.post(endpoint).send(body)).status, 403);
  assert.equal((await post(legacy)).status, 403);
  assert.equal((await post(machine, { ...body, host_id: "another-host" })).status, 403);
  assert.equal((await post(machine)).status, 200);
  assert.equal((await post(machine)).status, 200);
  assert.equal((await post(machine, { ...body, runtime_token_sha256: sha("changed") })).status, 409);
});

test("revoked Updater machine principal is not recreated by a Kernel restart", async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "kernel-machine-revocation-"));
  const options = { dataDir: directory, defaultsDir: path.resolve("data/defaults"), distDir: path.join(directory, "none"),
    accessKey: "operator", sessionSecret: "s".repeat(40), apiToken: "legacy-" + "l".repeat(32),
    updaterMachineToken: "machine-" + "m".repeat(32), updaterHostID: host, diskPath: directory };
  const first = createKernelApp(options);
  first.locals.kernel.store.setSetting(PRINCIPALS_SETTING, "[]");
  first.locals.kernel.close();
  const restarted = createKernelApp(options);
  t.after(() => { restarted.locals.kernel.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal((await request(restarted).get("/api/v1/register/snapshot").set("Authorization", "Bearer " + options.updaterMachineToken)).status, 401);
});
