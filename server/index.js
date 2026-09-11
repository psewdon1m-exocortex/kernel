import path from "node:path";
import { trustedProxies } from "./proxy-policy.js";
import { fileURLToPath } from "node:url";
import { createKernelApp } from "./app.js";
import { validateRuntimeSecrets } from "./security.js";
import fs from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const voltKernelToken = process.env.VOLT_KERNEL_TOKEN_FILE
  ? fs.readFileSync(path.resolve(process.env.VOLT_KERNEL_TOKEN_FILE), "utf8").trim()
  : process.env.VOLT_KERNEL_TOKEN;
const config = {
  port: Number(
    process.env.KERNEL_LISTEN_PORT
      ?? process.env.KERNEL_PORT
      ?? 18180,
  ),
  dataDir: process.env.KERNEL_DATA_DIR
    ? path.resolve(process.env.KERNEL_DATA_DIR)
    : path.join(ROOT, "data"),
  defaultsDir: process.env.KERNEL_DEFAULTS_DIR
    ? path.resolve(process.env.KERNEL_DEFAULTS_DIR)
    : path.join(ROOT, "data", "defaults"),
  distDir: path.join(ROOT, "dist"),
  // KERNEL_ADMIN_PASSWORD remains a one-release compatibility alias for
  // installations prepared before the single Access Key migration.
  accessKey: process.env.KERNEL_ACCESS_KEY ?? process.env.KERNEL_ADMIN_PASSWORD,
  legacyAdminUsername: process.env.KERNEL_ADMIN_USERNAME,
  sessionSecret: process.env.KERNEL_SESSION_SECRET,
  apiToken: process.env.KERNEL_SERVICE_TOKEN ?? process.env.KERNEL_API_TOKEN,
  cookieSecure: process.env.KERNEL_COOKIE_SECURE === "true",
  trustProxy: trustedProxies(process.env.KERNEL_TRUSTED_PROXIES),
  diskPath: process.env.KERNEL_DISK_PATH
    || (process.platform === "win32" ? path.parse(process.cwd()).root : "/"),
  version: process.env.KERNEL_VERSION ?? "0.1.1",
  auditMaxEntries: Number(process.env.KERNEL_AUDIT_MAX_ENTRIES ?? 10000),
  auditRetentionDays: Number(process.env.KERNEL_AUDIT_RETENTION_DAYS ?? 30),
  auditMaxBytes: Number(process.env.KERNEL_AUDIT_MAX_BYTES ?? 64 * 1024 * 1024),
  updateCheckTimeoutMs: Number(process.env.KERNEL_UPDATE_CHECK_TIMEOUT_MS ?? 5000),
  serviceStatusIntervalMs: Number(process.env.KERNEL_SERVICE_STATUS_INTERVAL_MS ?? 30000),
  serviceStatusTimeoutMs: Number(process.env.KERNEL_SERVICE_STATUS_TIMEOUT_MS ?? 3000),
  updaterSocketPath: process.env.UPDATER_SOCKET_PATH ?? "/run/exocortex/updater.sock",
  updaterHeadId: process.env.UPDATER_HEAD_ID ?? "kernel",
  updaterControlToken: process.env.UPDATER_CONTROL_TOKEN,
  neptuneSocketPath: process.env.NEPTUNE_SOCKET_PATH ?? "/run/neptune/neptuned.sock",
  neptuneProjectId: process.env.NEPTUNE_PROJECT_ID ?? "kernel",
  neptuneControlTokenFile: process.env.NEPTUNE_CONTROL_TOKEN_FILE,
  neptuneExportTokenFile: process.env.NEPTUNE_EXPORT_TOKEN_FILE,
  voltUrl: process.env.VOLT_URL ?? "",
  voltKernelToken,
  voltTimeoutMs: Number(process.env.VOLT_TIMEOUT_MS ?? 3000),
};

validateRuntimeSecrets(config);
const app = createKernelApp(config);
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Exocortex Kernel listening on http://0.0.0.0:${config.port}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}; stopping Kernel`);
  server.close(() => {
    app.locals.kernel.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
