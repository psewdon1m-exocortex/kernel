import assert from "node:assert/strict";
import test from "node:test";
import { validateRuntimeSecrets } from "../server/security.js";

const valid = {
  adminUsername: "operator",
  adminPassword: "correct-horse-battery-staple",
  sessionSecret: "s".repeat(48),
  apiToken: "t".repeat(32),
};

test("runtime secret validation accepts production-strength values", () => {
  assert.doesNotThrow(() => validateRuntimeSecrets(valid));
});

test("runtime secret validation rejects example placeholders", () => {
  assert.throws(
    () => validateRuntimeSecrets({
      ...valid,
      adminPassword: "change-this-operator-password",
      sessionSecret: "replace-with-at-least-32-random-characters",
      apiToken: "replace-with-at-least-24-random-characters",
    }),
    /non-placeholder/,
  );
});
