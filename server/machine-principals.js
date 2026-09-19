import { createHash, timingSafeEqual } from "node:crypto";

const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/;
const HASH = /^[a-f0-9]{64}$/;
const invalid = () => Object.assign(new Error("Invalid machine principal configuration"), { status: 400, code: "MACHINE_PRINCIPAL_INVALID" });
export const PRINCIPALS_SETTING = "machine_principals_v1";

export function validatePrincipals(input) {
  if (!Array.isArray(input) || input.length > 256) throw invalid();
  const ids = new Set(), hashes = new Set();
  for (const item of input) {
    if (!item || Object.keys(item).some(key => !["id", "token_sha256", "allowed_keys", "enabled", "wyvern"].includes(key)) ||
        !ID.test(item.id) || !HASH.test(item.token_sha256) || typeof item.enabled !== "boolean" ||
        !Array.isArray(item.allowed_keys) || item.allowed_keys.length > 128 ||
        item.allowed_keys.some(key => typeof key !== "string" || key.length > 128 || !KEY.test(key)) ||
        new Set(item.allowed_keys).size !== item.allowed_keys.length || ids.has(item.id) || hashes.has(item.token_sha256)) throw invalid();
    ids.add(item.id); hashes.add(item.token_sha256);
    if (item.wyvern !== undefined && (!item.wyvern || Object.keys(item.wyvern).some(key => !["instance_id", "role"].includes(key)) ||
        !ID.test(item.wyvern.instance_id) || !["manager", "runtime"].includes(item.wyvern.role))) throw invalid();
  }
  return input;
}
export function loadPrincipals(store) {
  try { return validatePrincipals(JSON.parse(store.getSetting(PRINCIPALS_SETTING) ?? "[]")); }
  catch { throw Object.assign(new Error("Machine identity configuration unavailable"), { status: 503, code: "MACHINE_PRINCIPALS_UNAVAILABLE" }); }
}
export function authenticatePrincipal(store, token) {
  if (typeof token !== "string" || !token || token.length > 4096) return null;
  const digest = createHash("sha256").update(token).digest();
  let selected = null;
  for (const principal of loadPrincipals(store)) {
    if (timingSafeEqual(digest, Buffer.from(principal.token_sha256, "hex")) && principal.enabled) selected = principal;
  }
  return selected ? { kind: "service", actor: "service:" + selected.id, principal: selected } : null;
}
function leaves(node, prefix = "", result = []) {
  for (const [key, value] of Object.entries(node)) {
    const name = prefix ? prefix + "." + key : key;
    if (typeof value === "string") result.push([name, value]);
    else if (value && typeof value === "object" && !Array.isArray(value)) leaves(value, name, result);
  }
  return result;
}
function nested(values, key) {
  let current = values;
  for (const part of key.split(".")) current = current && Object.hasOwn(current, part) ? current[part] : undefined;
  return current;
}
export function assertResolveAllowed(auth, keys, snapshot) {
  const protectedKey = key => key.startsWith("wyvern.") || /^services\.[A-Za-z0-9_-]+\.wyvern(?:\.|$)/.test(key);
  // Protect aliases to the same secret as well as the namespace itself.
  const protectedRefs = new Set(leaves(snapshot.values).filter(([key]) => protectedKey(key)).map(([, value]) => value.toLowerCase()));
  const allowed = auth.principal ? new Set(auth.principal.allowed_keys) : null;
  for (const key of keys) {
    const reference = nested(snapshot.values, key);
    const denied = allowed ? !allowed.has(key) : protectedKey(key) || typeof reference === "string" && protectedRefs.has(reference.toLowerCase());
    if (denied) throw Object.assign(new Error("This machine identity cannot resolve the requested keys"), { status: 403, code: "REGISTER_KEY_FORBIDDEN" });
  }
}
