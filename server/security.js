import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { validateVoltUrl } from "./volt-client.js";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const STORED_SECRET_CONTEXT = "exocortex.kernel.stored-secret.v1";

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function decode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function constantTimeTextEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return timingSafeEqual(a, b);
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password, encoded) {
  if (typeof encoded !== "string") return false;
  const [algorithm, saltValue, expectedValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltValue || !expectedValue) return false;
  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(expectedValue, "base64url");
    const actual = scryptSync(password, salt, expected.length, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSessionToken(secret, generation, now = Date.now()) {
  const payload = encode(JSON.stringify({
    sub: "operator",
    generation,
    issuedAt: now,
    expiresAt: now + SESSION_TTL_MS,
  }));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySessionToken(token, secret, expectedGeneration, now = Date.now()) {
  if (!token || typeof token !== "string") return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!constantTimeTextEqual(signature, expected)) return null;
  try {
    const decoded = JSON.parse(decode(payload));
    if (
      decoded.sub !== "operator"
      || decoded.generation !== expectedGeneration
      || !Number.isFinite(decoded.expiresAt)
      || decoded.expiresAt <= now
    ) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function verifyApiToken(value, expected) {
  return Boolean(value && expected && constantTimeTextEqual(value, expected));
}

function storedSecretKey(sessionSecret) {
  return createHash("sha256")
    .update(STORED_SECRET_CONTEXT)
    .update("\0")
    .update(String(sessionSecret))
    .digest();
}

export function encryptStoredSecret(value, sessionSecret) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", storedSecretKey(sessionSecret), nonce);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptStoredSecret(encoded, sessionSecret) {
  if (!encoded) return "";
  try {
    const [version, nonceValue, tagValue, ciphertextValue] = String(encoded).split(".");
    if (version !== "v1" || !nonceValue || !tagValue || !ciphertextValue) throw new Error("invalid stored secret");
    const decipher = createDecipheriv("aes-256-gcm", storedSecretKey(sessionSecret), Buffer.from(nonceValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw Object.assign(new Error("Stored Volt token cannot be decrypted with the current KERNEL_SESSION_SECRET"), { status: 503, code: "VOLT_TOKEN_DECRYPTION_FAILED" });
  }
}

export function validateVoltKernelToken(value) {
  return typeof value === "string"
    && value.length >= 32
    && value.length <= 512
    && !/(?:replace-with|change-this|example-token)/i.test(value);
}

export function validateRuntimeSecrets({
  accessKey,
  legacyAdminUsername,
  adminPassword,
  adminUsername,
  sessionSecret,
  apiToken,
  voltUrl,
  voltKernelToken,
}) {
  const issues = [];
  const isPlaceholder = (value) => (
    typeof value !== "string"
    || /(?:change-this|replace-with|example-password)/i.test(value)
  );
  const resolvedAccessKey = accessKey ?? adminPassword;
  const resolvedLegacyUsername = legacyAdminUsername ?? adminUsername;
  if (
    resolvedLegacyUsername != null
    && resolvedLegacyUsername !== ""
    && !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(resolvedLegacyUsername)
  ) {
    issues.push("deprecated KERNEL_ADMIN_USERNAME must contain 3-64 letters, numbers, dots, underscores or hyphens when present");
  }
  if (typeof resolvedAccessKey !== "string" || resolvedAccessKey.length < 12 || isPlaceholder(resolvedAccessKey)) {
    issues.push("KERNEL_ACCESS_KEY must contain at least 12 non-placeholder characters");
  }
  if (typeof sessionSecret !== "string" || sessionSecret.length < 32 || isPlaceholder(sessionSecret)) {
    issues.push("KERNEL_SESSION_SECRET must contain at least 32 non-placeholder characters");
  }
  if (typeof apiToken !== "string" || apiToken.length < 24 || isPlaceholder(apiToken)) {
    issues.push("KERNEL_SERVICE_TOKEN must contain at least 24 non-placeholder characters");
  }
  if (voltUrl) {
    try {
      validateVoltUrl(voltUrl);
    } catch (error) {
      issues.push(error.message);
    }
  }
  if (voltKernelToken && !validateVoltKernelToken(voltKernelToken)) {
    issues.push("VOLT_KERNEL_TOKEN must contain at least 32 non-placeholder characters");
  }
  if (issues.length) throw new Error(issues.join("; "));
}
