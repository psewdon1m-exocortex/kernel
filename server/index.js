import path from "node:path";
import { fileURLToPath } from "node:url";
import { createKernelApp } from "./app.js";
import { validateRuntimeSecrets } from "./security.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  adminUsername: process.env.KERNEL_ADMIN_USERNAME,
  adminPassword: process.env.KERNEL_ADMIN_PASSWORD,
  sessionSecret: process.env.KERNEL_SESSION_SECRET,
  apiToken: process.env.KERNEL_SERVICE_TOKEN ?? process.env.KERNEL_API_TOKEN,
  cookieSecure: process.env.KERNEL_COOKIE_SECURE === "true",
  trustProxy: process.env.KERNEL_TRUST_PROXY === "true",
  diskPath: process.env.KERNEL_DISK_PATH
    || (process.platform === "win32" ? path.parse(process.cwd()).root : "/"),
  version: process.env.KERNEL_VERSION ?? "0.1.0",
  auditMaxEntries: Number(process.env.KERNEL_AUDIT_MAX_ENTRIES ?? 10000),
  auditRetentionDays: Number(process.env.KERNEL_AUDIT_RETENTION_DAYS ?? 30),
  auditMaxBytes: Number(process.env.KERNEL_AUDIT_MAX_BYTES ?? 64 * 1024 * 1024),
  updateCheckTimeoutMs: Number(process.env.KERNEL_UPDATE_CHECK_TIMEOUT_MS ?? 5000),
  updaterSocketPath: process.env.UPDATER_SOCKET_PATH ?? "/run/exocortex/updater.sock",
  updaterHeadId: process.env.UPDATER_HEAD_ID ?? "kernel",
  updaterControlToken: process.env.UPDATER_CONTROL_TOKEN,
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
