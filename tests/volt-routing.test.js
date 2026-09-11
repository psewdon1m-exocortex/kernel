import test from "node:test";
import assert from "node:assert/strict";
import { createDiscoveredVoltClient } from "../server/volt-client.js";

test("secret routing uses fresh Register coordinates after bootstrap discovery", async () => {
  const refs = [1, 2, 4].map(position => `volt://3518462b-bb66-459a-a1ab-c38a837740ab/${position}`);
  const calls = [];
  let current = "first.volt.test";
  const client = createDiscoveredVoltClient({ baseUrl: "https://bootstrap.volt.test", token: "synthetic-private-token", getRouteReferences: () => ({ sni: refs[0], port: refs[1] }),
    fetchImpl: async (url, init) => {
      calls.push(url);
      assert.equal(init.headers.Authorization, "Bearer synthetic-private-token");
      const values = Object.fromEntries(JSON.parse(init.body).references.map(reference => [reference, {
        value: reference === refs[0] ? current : reference === refs[1] ? "443" : "transient-secret", visibility: "secret", revision: 1,
      }]));
      return Response.json({ schema: "volt.resolve.v1", values });
    },
  });
  assert.equal((await client.resolve([refs[2]])).values[refs[2]].value, "transient-secret");
  current = "second.volt.test";
  await client.resolve([refs[2]]);
  assert.deepEqual(calls.map(url => new URL(url).hostname), ["bootstrap.volt.test", "first.volt.test", "bootstrap.volt.test", "second.volt.test"]);
});
