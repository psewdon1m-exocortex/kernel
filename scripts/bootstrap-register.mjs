import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProfileBindings } from "../server/register-profile.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = JSON.parse(fs.readFileSync(path.join(process.env.KERNEL_DEFAULTS_DIR || path.join(root, "data/defaults"), "register.json"), "utf8"));
const [command, ...rest] = process.argv.slice(2);
const argumentsMap = new Map();
for (let index = 0; index < rest.length; index += 2) argumentsMap.set(rest[index], rest[index + 1]);
if (command === "template") {
  process.stdout.write(JSON.stringify(Object.fromEntries(profile.map(entry => [entry.key, ""])), null, 2) + "\n");
} else if (["validate", "apply", "check"].includes(command)) {
  let bindings;
  if (command !== "check") {
    const filename = argumentsMap.get("--bindings");
    if (!filename || fs.statSync(filename).size > 65536) throw new Error("Provide a bindings JSON file of at most 64 KiB");
    bindings = JSON.parse(fs.readFileSync(filename, "utf8"));
    validateProfileBindings(bindings, profile);
  }
  if (command === "validate") process.stdout.write("The six-service bindings are complete and contain only valid Volt references.\n");
  else {
    const url = new URL(argumentsMap.get("--kernel-url"));
    if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Use the private HTTPS Kernel origin or loopback HTTP");
    const keyFile = argumentsMap.get("--access-key-file");
    if (!keyFile || fs.statSync(keyFile).size > 4096) throw new Error("Provide a protected Access Key file");
    const accessKey = fs.readFileSync(keyFile, "utf8").trim();
    const login = await fetch(new URL("/api/auth/login", url), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin }, body: JSON.stringify({ access_key: accessKey }) });
    if (!login.ok) throw new Error("Kernel operator authentication failed");
    const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const headers = { "Content-Type": "application/json", Cookie: cookie, Origin: url.origin };
    try {
      if (command === "apply") {
        const response = await fetch(new URL("/api/register/profile", url), { method: "PUT", redirect: "error", headers, body: JSON.stringify({ bindings, prune: argumentsMap.get("--prune-outside-profile") === "true" }) });
        if (!response.ok) throw new Error(`Register profile rejected (HTTP ${response.status}); inspect /api/register/profile before pruning`);
      }
      const response = await fetch(new URL("/api/register/profile/check", url), { method: "POST", redirect: "error", headers, body: "{}" });
      if (!response.ok) throw new Error(`Register readiness failed (HTTP ${response.status}); review bindings and Volt availability`);
      process.stdout.write(JSON.stringify(await response.json(), null, 2) + "\n");
    } finally { await fetch(new URL("/api/auth/logout", url), { method: "POST", redirect: "error", headers, body: "{}" }).catch(() => undefined); }
  }
} else throw new Error("Usage: bootstrap-register.mjs template | validate --bindings FILE | apply --bindings FILE --kernel-url URL --access-key-file FILE [--prune-outside-profile true] | check --kernel-url URL --access-key-file FILE");
