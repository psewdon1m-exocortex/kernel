const REFERENCE = /^volt:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[1-5]$/i;

export function inspectRegisterProfile(entries, profile) {
  const required = new Set(profile.map(entry => entry.key));
  const provided = new Map(entries.map(entry => [entry.key, entry.value]));
  const missing = [...required].filter(key => !provided.has(key)).sort();
  const invalid = [...required].filter(key => provided.has(key) && !REFERENCE.test(String(provided.get(key)))).sort();
  const extra = [...provided.keys()].filter(key => !required.has(key)).sort();
  const duplicates = entries.length !== provided.size;
  return { schema: "exocortex.register.readiness.v1", profile: "six-services", ready: !missing.length && !invalid.length && !extra.length && !duplicates,
    required: required.size, configured: required.size - missing.length - invalid.length, missing, invalid, extra, duplicates };
}

export function validateProfileBindings(bindings, profile) {
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) throw new Error("Bindings must be a flat key-to-Volt-reference object");
  const entries = Object.entries(bindings).map(([key, value]) => ({ key, value }));
  const status = inspectRegisterProfile(entries, profile);
  if (!status.ready) throw Object.assign(new Error("The six-service profile is incomplete or contains invalid bindings"), { status: 400, details: status });
  return profile.map(entry => ({ ...entry, value: bindings[entry.key] }));
}

export function inspectResolvedProfile(values) {
  const invalid = [];
  for (const [key, value] of Object.entries(values)) {
    let valid = typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\r\n\0]/.test(value);
    if (valid && key.startsWith("repositories.")) {
      try { const url = new URL(value); valid = url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password && !url.search && !url.hash && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname); }
      catch { valid = false; }
    } else if (valid && key.endsWith(".sni")) valid = value.length <= 253 && /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value);
    else if (valid && key.endsWith(".port")) valid = /^\d{1,5}$/.test(value) && Number(value) > 0 && Number(value) <= 65535;
    else if (valid && (key.includes(".paths.") || key.endsWith(".health.path"))) valid = value.startsWith("/") && !value.startsWith("//") && !/[?#\\]/.test(value) && !value.split("/").includes("..");
    else if (valid && key.endsWith(".health.contract")) valid = ["private-readiness", "public-readiness", "public-liveness"].includes(value);
    else if (valid && key.endsWith(".saturn_slug")) valid = /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
    else if (valid && key.startsWith("intervals.")) valid = /^\d{1,5}$/.test(value) && Number(value) > 0 && Number(value) <= 86400;
    if (!valid) invalid.push(key);
  }
  return { ready: invalid.length === 0, invalid: invalid.sort() };
}
