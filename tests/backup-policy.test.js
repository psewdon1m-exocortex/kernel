import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBackupPolicy, restoredPolicyRecord, validateBackupIntent } from "../server/backup-policy.js";

const intent = { schema: "exocortex.backup.intent.v1", archive: { enabled: true, intervalHours: 6 },
  mirror: { enabled: true, intervalMinutes: 5 }, sourceRevision: 3 };
function fixture(client) {
  let journal = restoredPolicyRecord(intent);
  return { policy: createBackupPolicy({ client, configured: () => true,
    readPending: () => journal, writePending: value => { journal = structuredClone(value); } }),
    journal: () => journal, restore: () => { journal = restoredPolicyRecord(intent); } };
}
test("restored policy survives dependency outage without leaking unrelated settings", async () => {
  const { policy } = fixture({ policy: async () => { throw new Error("offline"); } });
  assert.deepEqual(await policy.exportIntent(), intent);
  assert.equal((await policy.read()).paused, true);
  assert.throws(() => policy.assertExportReady(), /paused/);
  assert.deepEqual(validateBackupIntent({ ...intent, token: "never-export", archive: { ...intent.archive, url: "private" } }), intent);
  await assert.rejects(policy.runs("POST", { kind: "archive" }), /paused/);
});
test("uncertain resume replays the same restore and resume identities", async () => {
  const calls = []; let failOnce = true;
  const { policy, journal } = fixture({ policy: async (method, body) => {
    if (!method) return { revision: 11 };
    calls.push(structuredClone(body));
    if (body.kind === "restore") return { revision: 12, paused: true };
    if (failOnce) { failOnce = false; throw new Error("lost acknowledgement"); }
    return { revision: 13, appliedRevision: 13, paused: false };
  } });
  const input = { kind: "resume", requestId: randomUUID(), expectedRevision: 11 };
  await assert.rejects(policy.mutate(input), /lost acknowledgement/);
  assert.ok(journal());
  await policy.mutate({ ...input, requestId: randomUUID() });
  assert.deepEqual(calls[0], calls[2]); assert.deepEqual(calls[1], calls[3]);
  assert.equal(journal(), null);
});
test("a concurrent newer domain restore cannot be cleared by an earlier verification", async () => {
  let f;
  f = fixture({ policy: async (method, body) => {
    if (!method) return { revision: 1 };
    if (body.kind === "restore") return { revision: 2 };
    f.restore(); return { revision: 3, appliedRevision: 3, paused: false };
  } });
  await assert.rejects(f.policy.mutate({ kind: "resume", requestId: randomUUID() }), /Another restore/);
  assert.ok(f.journal()); assert.throws(() => f.policy.assertExportReady(), /paused/);
});
test("an unapplied receipt never clears the recovery pause", async () => {
  const { policy, journal } = fixture({ policy: async (method, body) => !method ? { revision: 1 } :
    body.kind === "restore" ? { revision: 2 } : { revision: 3, appliedRevision: 2, paused: false } });
  await assert.rejects(policy.mutate({ kind: "resume", requestId: randomUUID() }), /not yet verified/);
  assert.ok(journal());
});
