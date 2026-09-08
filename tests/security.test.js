import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptStoredSecret,
  encryptStoredSecret,
  validateRuntimeSecrets,
} from "../server/security.js";

const valid = {
  adminUsername: "operator",
  adminPassword: "correct-horse-battery-staple",
  sessionSecret: "s".repeat(48),
  apiToken: "t".repeat(32),
  voltUrl: "https://volt.exocortex.internal",
  voltKernelToken: "v".repeat(32),
};

test("runtime secret validation accepts production-strength values", () => {
  assert.doesNotThrow(() => validateRuntimeSecrets(valid));
  assert.doesNotThrow(() => validateRuntimeSecrets({ ...valid, voltUrl: "", voltKernelToken: "" }));
});

test("stored Volt tokens are authenticated and bound to the Kernel session secret", () => {
  const token = "v".repeat(48);
  const encrypted = encryptStoredSecret(token, "s".repeat(48));
  assert.equal(encrypted.includes(token), false);
  assert.equal(decryptStoredSecret(encrypted, "s".repeat(48)), token);
  assert.throws(() => decryptStoredSecret(encrypted, "x".repeat(48)), { code: "VOLT_TOKEN_DECRYPTION_FAILED" });
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
