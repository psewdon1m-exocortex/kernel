import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";
import { createKernelApp } from "../server/app.js";

for (const configured of [false, true]) test(`Neptune ${configured ? "unreachable" : "unconfigured"} is a distinct protected dependency state`, async context => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-neptune-state-"));
  const tokenFile = path.join(dataDir, "control.token");
  fs.writeFileSync(tokenFile, "local-fixture-control-token");
  const socketPath = process.platform === "win32" ? `\\\\.\\pipe\\kernel-neptune-missing-${process.pid}-${Number(configured)}` : path.join(dataDir, "missing.sock");
  const app = createKernelApp({dataDir, defaultsDir:path.resolve("data/defaults"), distDir:path.join(dataDir,"dist"),
    accessKey:"fixture-operator-access-key", sessionSecret:"fixture-session-secret-of-at-least-32-characters", apiToken:"fixture-service-token-at-least-24", diskPath:dataDir,
    neptuneSocketPath:socketPath, neptuneControlTokenFile:configured ? tokenFile : ""});
  context.after(() => {
    app.locals.kernel.close();
    assert.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dataDir,{recursive:true,force:true});
  });
  assert.equal((await request(app).get("/api/neptune/policy")).status,401);
  const agent=request.agent(app);
  assert.equal((await agent.post("/api/auth/login").send({access_key:"fixture-operator-access-key"})).status,200);
  const availability=await agent.get("/api/neptune/availability");
  assert.equal(availability.status,200);
  assert.equal(availability.body.installed,null);
  assert.equal(availability.body.state,configured ? "unavailable" : "unlinked");
  if(!configured) assert.equal(availability.body.configured,false);
  const policy=await agent.get("/api/neptune/policy");
  assert.ok([502,503].includes(policy.status));
  assert.equal(policy.body.code,configured ? "NEPTUNE_UNAVAILABLE" : "NEPTUNE_NOT_CONFIGURED");
  assert.equal(policy.body.error,configured ? "Neptune is unavailable. Check the connection and retry." : "Initialize Neptune to enable automatic backups.");
  assert.ok(!JSON.stringify(policy.body).includes(dataDir));
  assert.ok(!JSON.stringify(policy.body).includes("local-fixture-control-token"));
});
