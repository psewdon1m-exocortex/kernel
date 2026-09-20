import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNeptuneClient } from "../server/neptune-client.js";

test("an agent without the service-owned policy protocol requires an upgrade", async context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-neptune-protocol-"));
  const tokenFile = path.join(directory, "control.token");
  fs.writeFileSync(tokenFile, "fixture-control-token");
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const calls = [];
  const transport = async (_socket, _projectId, _token, _method, route) => {
    calls.push(route);
    if (route === "/v1/health") return { version: "0.1.8" };
    if (route === "/status") return { version: "0.1.8" };
    if (route === "/policy") throw Object.assign(new Error("Neptune returned HTTP 404"), { status: 404, upstreamStatus: 404 });
    throw new Error(`Unexpected route ${route}`);
  };
  const client = createNeptuneClient("fixture.sock", "kernel", tokenFile, transport);
  const availability = await client.availability();
  assert.deepEqual({ ...availability, last_verified_at: undefined }, {
    installed: true, linked: true, version: "0.1.8", state: "upgrade_required", policy_protocol: 0,
    policy_supported: false, required_policy_protocol: 1, last_verified_at: undefined,
  });
  assert.match(availability.last_verified_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(calls, ["/v1/health", "/status"]);
  await assert.rejects(client.policy(), error => {
    assert.equal(error.status, 426);
    assert.equal(error.code, "NEPTUNE_POLICY_UPGRADE_REQUIRED");
    assert.match(error.message, /Update Saturn and Neptune/);
    return true;
  });
});
