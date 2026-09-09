import assert from "node:assert/strict";
import test from "node:test";

import { createVoltClient, validateVoltUrl } from "../server/volt-client.js";

const REFERENCE = "volt://11111111-1111-4111-8111-111111111111/1";

test("Volt URL permits remote HTTPS and loopback HTTP only", () => {
  assert.equal(validateVoltUrl("https://volt.exocortex.internal/"), "https://volt.exocortex.internal");
  assert.equal(validateVoltUrl("http://127.0.0.1:18184"), "http://127.0.0.1:18184");
  assert.throws(() => validateVoltUrl("http://volt.exocortex.internal"), /HTTPS or local loopback/);
  assert.throws(() => validateVoltUrl("https://user:pass@volt.exocortex.internal"), /credentials/);
  assert.throws(() => validateVoltUrl("https://volt.exocortex.internal?token=leak"), /query/);
  assert.throws(() => validateVoltUrl("https://volt.example.com"), /placeholder/);
});

test("Kernel Volt client uses the internal endpoint and validates its response", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      schema: "volt.resolve.v1",
      resolution_revision: "revision",
      values: { [REFERENCE]: { value: "resolved-secret", revision: 4, visibility: "secret" } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = createVoltClient({
    baseUrl: "https://volt.exocortex.internal/",
    token: "kernel-to-volt-token",
    fetchImpl,
  });
  const result = await client.resolve([REFERENCE]);
  assert.equal(result.values[REFERENCE].value, "resolved-secret");
  assert.equal(request.url, "https://volt.exocortex.internal/api/v1/internal/kernel/resolve");
  assert.equal(request.options.headers.Authorization, "Bearer kernel-to-volt-token");
  assert.equal(request.options.redirect, "manual");
  assert.deepEqual(JSON.parse(request.options.body), { references: [REFERENCE] });
});
