import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import cookieParser from "cookie-parser";
import express from "express";
import { strToU8, unzipSync, zipSync } from "fflate";
import multer from "multer";
import {
  createSessionToken,
  decryptStoredSecret,
  encryptStoredSecret,
  hashPassword,
  validateVoltKernelToken,
  verifyApiToken,
  verifyPassword,
  verifySessionToken,
} from "./security.js";
import { createMetricsCollector } from "./metrics.js";
import { createServiceStatusCollector, SERVICE_STATUS_DEFINITIONS } from "./service-status.js";
import { KernelStore } from "./store.js";
import {
  CONSTITUTION_MEDIA_TYPE,
  REGISTER_MEDIA_TYPE,
  checksumOf,
  etagMatches,
  parseConstitution,
} from "./machine-contract.js";
import { checkGitHubRelease } from "./updater.js";
import { createUpdaterClient } from "./updater-client.js";
import { createNeptuneClient } from "./neptune-client.js";
import { createVoltClient, validateVoltUrl } from "./volt-client.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCUMENT_TYPES = new Set(["overview", "constitution"]);
const MAX_MARKDOWN_BYTES = 1024 * 1024;
const MAX_TOPOLOGY_BYTES = 32 * 1024 * 1024;
const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const MAX_BACKUP_MANIFEST_BYTES = 64 * 1024;
const MAX_BACKUP_COMPRESSION_RATIO = 200;
const MAX_VOLT_REFERENCES = 20;
const KERNEL_BACKUP_ARCHIVE_FORMAT = "exocortex-kernel-backup-archive";
const KERNEL_BACKUP_DATA_MEMBER = "data/kernel.json";
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VOLT_REFERENCE = /^volt:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_COLOR = /^#[0-9a-f]{6}$/i;
const PRESENTATION_ORDERS = {
  navigation_order: ["dashboard", "overview", "topology", "register", "constitution", "settings"],
  dashboard_order: [
    "cpu", "ram", "disk", "uptime",
    "service-kernel", "service-chronos", "service-perimetr",
    "service-saturn", "service-laboratory", "service-volt",
  ],
  settings_order: ["appearance", "security", "backup", "updates", "logs", "documents"],
};
const ROBOTS_POLICY = fs.readFileSync(path.join(ROOT, "server", "robots.txt"), "utf8");
const PROXY_IDENTITY_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
];
const BLOCKED_PROBE_PATH = /(^|\/)\.|\.(?:env|ini|log|sql|bak|backup|old|swp|zip|tar|gz)$/i;

function serializeError(error) {
  if (!error || typeof error !== "object") {
    return { name: "Error", message: String(error), code: null, stack: null, cause: null };
  }
  const cause = error.cause && error.cause !== error
    ? {
      name: error.cause?.name ?? "Error",
      message: error.cause?.message ?? String(error.cause),
      code: error.cause?.code ?? null,
    }
    : null;
  return {
    name: error.name ?? "Error",
    message: error.message ?? String(error),
    code: error.code ?? null,
    stack: typeof error.stack === "string" ? error.stack : null,
    cause,
  };
}

function detailedAuditError(event) {
  const details = event.details && typeof event.details === "object" ? event.details : {};
  const recorded = details.error && typeof details.error === "object" ? details.error : {};
  return {
    event_id: event.id,
    occurred_at: event.created_at,
    actor: event.actor,
    action: event.action,
    target: event.target,
    summary: `${event.action} failed for ${event.target}`,
    error_type: recorded.name ?? details.name ?? "Error",
    error_code: recorded.code ?? details.code ?? null,
    message: recorded.message ?? details.message ?? details.reason
      ?? "No diagnostic message was recorded for this error.",
    cause: recorded.cause ?? details.cause ?? null,
    stack_trace: recorded.stack ?? details.stack ?? null,
    request_id: details.request_id ?? null,
    method: details.method ?? null,
    context: details,
  };
}

function safeActor(req) {
  return req.auth?.actor ?? "anonymous";
}

function normalizeLimit(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

function validateRegisterInput(body) {
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  const value = typeof body?.value === "string" ? body.value.trim() : "";
  const description = typeof body?.description === "string"
    ? body.description.trim()
    : "";
  if (!SAFE_KEY.test(key)) {
    throw Object.assign(new Error("Key must use letters, numbers, dots, underscores or hyphens"), { status: 400 });
  }
  if (!value || value.length > 2048) {
    throw Object.assign(new Error("Value must contain between 1 and 2048 characters"), { status: 400 });
  }
  if (description.length > 500) {
    throw Object.assign(new Error("Description is too long"), { status: 400 });
  }
  if (!VOLT_REFERENCE.test(value)) {
    throw Object.assign(new Error("Register values must use volt://<entry-id>/<field-id>"), { status: 400 });
  }
  return { key, value, description };
}

function isUnresolvedRegisterEntry(_key, value) {
  return !VOLT_REFERENCE.test(String(value));
}

function nestedRegisterValue(values, key) {
  let value = values;
  for (const part of key.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

function validateUiSettings(body, current) {
  const accent = body?.colors?.accent ?? current.colors.accent;
  if (!ALLOWED_COLOR.test(accent)) {
    throw Object.assign(new Error("Invalid accent color"), { status: 400 });
  }
  const presentation = {};
  for (const [name, required] of Object.entries(PRESENTATION_ORDERS)) {
    const proposed = body?.presentation?.[name] ?? current.presentation[name];
    if (
      !Array.isArray(proposed)
      || proposed.length !== required.length
      || new Set(proposed).size !== required.length
      || proposed.some((item) => !required.includes(item))
    ) {
      throw Object.assign(new Error(`Invalid ${name.replaceAll("_", " ")}`), { status: 400 });
    }
    presentation[name] = proposed;
  }
  for (const field of ["sidebar_auto_hide", "revision_request_logging"]) {
    if (body?.[field] !== undefined && typeof body[field] !== "boolean") {
      throw Object.assign(new Error(`Invalid ${field.replaceAll("_", " ")}`), { status: 400 });
    }
  }
  return {
    colors: {
      dark: "#000000",
      light: "#ffffff",
      accent: accent.toLowerCase(),
    },
    sidebar_auto_hide: body?.sidebar_auto_hide ?? current.sidebar_auto_hide,
    revision_request_logging: body?.revision_request_logging ?? current.revision_request_logging,
    presentation,
  };
}

function validateTopology(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Topology must be an Excalidraw document object"), { status: 400 });
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_TOPOLOGY_BYTES) {
    throw Object.assign(new Error("Topology document exceeds the 32 MB limit"), { status: 413 });
  }
  if (value.type !== "excalidraw" || Number(value.version) !== 2) {
    throw Object.assign(new Error("Unsupported Excalidraw document format"), { status: 400 });
  }
  if (!Array.isArray(value.elements)) {
    throw Object.assign(new Error("Topology field elements must be an array"), { status: 400 });
  }
  if (!value.appState || typeof value.appState !== "object" || Array.isArray(value.appState)) {
    throw Object.assign(new Error("Topology field appState must be an object"), { status: 400 });
  }
  const files = value.files ?? {};
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw Object.assign(new Error("Topology field files must be an object"), { status: 400 });
  }
  const elementIds = new Set();
  for (const element of value.elements) {
    if (
      !element
      || typeof element !== "object"
      || typeof element.id !== "string"
      || !element.id
      || typeof element.type !== "string"
      || !element.type
    ) {
      throw Object.assign(new Error("Topology contains an invalid Excalidraw element"), { status: 400 });
    }
    if (elementIds.has(element.id)) {
      throw Object.assign(new Error("Topology contains duplicate Excalidraw element IDs"), { status: 400 });
    }
    elementIds.add(element.id);
  }
  for (const [fileId, file] of Object.entries(files)) {
    if (
      !file
      || typeof file !== "object"
      || file.id !== fileId
      || typeof file.dataURL !== "string"
      || !/^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,/i.test(file.dataURL)
    ) {
      throw Object.assign(new Error("Topology files must be embedded Excalidraw image data"), { status: 400 });
    }
  }
  return {
    type: "excalidraw",
    version: 2,
    source: typeof value.source === "string" ? value.source.slice(0, 2048) : "https://excalidraw.com",
    elements: structuredClone(value.elements),
    appState: structuredClone(value.appState),
    files: structuredClone(files),
  };
}

function isZipBuffer(bytes) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06));
}

function parseUtf8Json(bytes, label) {
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(content);
  } catch {
    throw Object.assign(new Error(`${label} must be valid UTF-8 JSON`), { status: 400 });
  }
}

function buildKernelBackupArchive(backup, sourceVersion) {
  const data = strToU8(JSON.stringify(backup, null, 2));
  if (data.byteLength > MAX_BACKUP_BYTES) {
    throw Object.assign(new Error("Kernel backup exceeds the uncompressed backup limit"), { status: 413 });
  }
  const dataChecksum = createHash("sha256").update(data).digest("hex");
  const manifest = strToU8(JSON.stringify({
    format: KERNEL_BACKUP_ARCHIVE_FORMAT,
    schema_version: 1,
    created_at: backup.created_at,
    scope: "complete",
    source_version: sourceVersion,
    restore_mode: "replace",
    files: {
      [KERNEL_BACKUP_DATA_MEMBER]: {
        sha256: dataChecksum,
        uncompressed_bytes: data.byteLength,
        records: 1,
      },
    },
  }, null, 2));
  const archive = Buffer.from(zipSync({
    "manifest.json": manifest,
    [KERNEL_BACKUP_DATA_MEMBER]: data,
  }, { level: 6 }));
  if (archive.byteLength > MAX_BACKUP_BYTES) {
    throw Object.assign(new Error("Kernel backup ZIP exceeds the backup limit"), { status: 413 });
  }
  return archive;
}

function parseKernelBackupFile(bytes) {
  if (!isZipBuffer(bytes)) {
    // Keep existing operator archives restorable after the format transition.
    return parseUtf8Json(bytes, "Legacy Kernel backup");
  }
  const allowedMembers = new Set(["manifest.json", KERNEL_BACKUP_DATA_MEMBER]);
  let memberCount = 0;
  let uncompressedBytes = 0;
  let archive;
  try {
    archive = unzipSync(new Uint8Array(bytes), {
      filter(member) {
        memberCount += 1;
        if (memberCount > allowedMembers.size || !allowedMembers.has(member.name)) {
          throw Object.assign(new Error("Kernel backup ZIP contains an unknown member"), { status: 400 });
        }
        const maximum = member.name === "manifest.json"
          ? MAX_BACKUP_MANIFEST_BYTES
          : MAX_BACKUP_BYTES;
        if (member.originalSize <= 0 || member.originalSize > maximum) {
          throw Object.assign(new Error("Kernel backup ZIP member exceeds its size limit"), { status: 413 });
        }
        if (member.size > 0 && member.originalSize / member.size > MAX_BACKUP_COMPRESSION_RATIO) {
          throw Object.assign(new Error("Kernel backup ZIP compression ratio is unsafe"), { status: 400 });
        }
        uncompressedBytes += member.originalSize;
        if (uncompressedBytes > MAX_BACKUP_BYTES + MAX_BACKUP_MANIFEST_BYTES) {
          throw Object.assign(new Error("Kernel backup ZIP exceeds its uncompressed size limit"), { status: 413 });
        }
        return true;
      },
    });
  } catch (error) {
    if (error?.status) throw error;
    throw Object.assign(new Error("Kernel backup must be a valid ZIP archive"), { status: 400 });
  }
  if (Object.keys(archive).length !== allowedMembers.size) {
    throw Object.assign(new Error("Kernel backup ZIP is incomplete"), { status: 400 });
  }
  const manifest = parseUtf8Json(archive["manifest.json"], "Kernel backup manifest");
  const data = archive[KERNEL_BACKUP_DATA_MEMBER];
  const descriptor = manifest?.files?.[KERNEL_BACKUP_DATA_MEMBER];
  const checksum = createHash("sha256").update(data).digest("hex");
  if (
    manifest?.format !== KERNEL_BACKUP_ARCHIVE_FORMAT
    || Number(manifest?.schema_version) !== 1
    || manifest?.scope !== "complete"
    || manifest?.restore_mode !== "replace"
    || descriptor?.uncompressed_bytes !== data.byteLength
    || !/^[a-f0-9]{64}$/.test(descriptor?.sha256 ?? "")
    || descriptor.sha256 !== checksum
  ) {
    throw Object.assign(new Error("Kernel backup manifest or member checksum is invalid"), { status: 400 });
  }
  return parseUtf8Json(data, "Kernel backup data");
}

function validateMarkdown(file, type) {
  if (!file) {
    throw Object.assign(new Error("Select a Markdown file"), { status: 400 });
  }
  const expectedName = `${type}.md`;
  if (path.basename(file.originalname).toLowerCase() !== expectedName) {
    throw Object.assign(new Error(`Expected a file named ${expectedName}`), { status: 400 });
  }
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(file.buffer);
  } catch {
    throw Object.assign(new Error("Markdown must be valid UTF-8 text"), { status: 400 });
  }
  content = content.replace(/^\uFEFF/, "").trim();
  if (!content || content.includes("\0")) {
    throw Object.assign(new Error("Markdown must be a non-empty text file"), { status: 400 });
  }
  return `${content}\n`;
}

function firstForwardedHeaderValue(value) {
  return typeof value === "string"
    ? value.split(",").at(-1)?.trim()
    : undefined;
}

function isLoopbackAddress(address) {
  const normalized = String(address ?? "").replace(/^::ffff:/, "");
  return normalized === "::1" || normalized === "127.0.0.1";
}

function requestOriginMatches(req, trustProxy) {
  const origin = req.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    if (!["http:", "https:"].includes(source.protocol)) return false;

    const expectedHosts = new Set([req.get("host")].filter(Boolean));
    // Local development and the supported production proxy both terminate the
    // browser connection before forwarding it to Kernel. Trust the public host
    // only from that trusted hop, never from an arbitrary remote client.
    if (trustProxy || isLoopbackAddress(req.socket.remoteAddress)) {
      const forwardedHost = firstForwardedHeaderValue(req.get("x-forwarded-host"));
      if (forwardedHost) expectedHosts.add(forwardedHost);
    }
    return expectedHosts.has(source.host);
  } catch {
    return false;
  }
}

function isProxiedRequest(req) {
  return PROXY_IDENTITY_HEADERS.some((name) => Boolean(req.get(name)));
}

export function createKernelApp(options) {
  const {
    dataDir = path.join(ROOT, "data"),
    defaultsDir = path.join(ROOT, "data", "defaults"),
    distDir = path.join(ROOT, "dist"),
    accessKey = options.adminPassword,
    legacyAdminUsername = options.adminUsername,
    sessionSecret,
    apiToken,
    cookieSecure = false,
    trustProxy = false,
    diskPath = process.platform === "win32" ? path.parse(process.cwd()).root : "/",
    version = "0.1.1",
    auditMaxEntries = 10000,
    auditRetentionDays = 30,
    auditMaxBytes = 64 * 1024 * 1024,
    updateCheckTimeoutMs = 5000,
    releaseFetch = globalThis.fetch,
    serviceStatusFetch = globalThis.fetch,
    serviceStatusIntervalMs = 30_000,
    serviceStatusTimeoutMs = 3_000,
    updaterSocketPath = "/run/exocortex/updater.sock",
    updaterHeadId = "kernel",
    updaterControlToken = "",
    updaterClient = createUpdaterClient(updaterSocketPath, updaterControlToken),
    neptuneSocketPath = "/run/neptune/neptuned.sock",
    neptuneProjectId = "kernel",
    neptuneControlTokenFile = "",
    neptuneExportTokenFile = "",
    neptuneClient = createNeptuneClient(neptuneSocketPath, neptuneProjectId, neptuneControlTokenFile),
    voltUrl = "",
    voltKernelToken = "",
    voltTimeoutMs = 3000,
    voltFetch = globalThis.fetch,
    voltClient = null,
  } = options;

  const store = new KernelStore({
    dataDir,
    defaultsDir,
    initialPasswordHash: hashPassword(accessKey),
    auditMaxEntries,
    auditRetentionDays,
    auditMaxBytes,
  });
  const storedVoltConnection = store.getVoltConnectionSettings();
  if ((!storedVoltConnection.url && voltUrl) || (!storedVoltConnection.encrypted_token && voltKernelToken)) {
    const migratedToken = !storedVoltConnection.encrypted_token && voltKernelToken
      ? encryptStoredSecret(voltKernelToken, sessionSecret)
      : "";
    store.updateVoltConnectionSettings({
      url: storedVoltConnection.url || validateVoltUrl(voltUrl),
      encryptedToken: migratedToken,
    }, "system:migration");
  }
  function activeVoltClient() {
    if (voltClient) return voltClient;
    const connection = store.getVoltConnectionSettings();
    return createVoltClient({
      baseUrl: connection.url,
      token: decryptStoredSecret(connection.encrypted_token, sessionSecret),
      timeoutMs: voltTimeoutMs,
      fetchImpl: voltFetch,
    });
  }
  store.migrateLegacyVoltReferences();
  store.scrubLegacyRegisterValues(isUnresolvedRegisterEntry);
  async function resolveCurrentRegisterKeys(keys, { allowMissing = false } = {}) {
    const snapshot = store.getRegisterMachineSnapshot();
    if (!snapshot) throw Object.assign(new Error("Register is not initialized"), { status: 503 });
    const selected = new Map();
    for (const key of keys) {
      const reference = nestedRegisterValue(snapshot.values, key);
      if (reference === undefined && allowMissing) continue;
      if (typeof reference !== "string" || !VOLT_REFERENCE.test(reference)) {
        throw Object.assign(new Error(`Register key ${key} is not mapped to Volt`), { status: 409 });
      }
      selected.set(key, reference);
    }
    if (!selected.size) return {};
    const references = [...new Set(selected.values())];
    const resolvedValues = {};
    for (let offset = 0; offset < references.length; offset += MAX_VOLT_REFERENCES) {
      const resolved = await activeVoltClient().resolve(references.slice(offset, offset + MAX_VOLT_REFERENCES));
      Object.assign(resolvedValues, resolved.values);
    }
    return Object.fromEntries([...selected].map(([key, reference]) => [key, resolvedValues[reference].value]));
  }
  const metrics = createMetricsCollector(diskPath);
  const serviceStatusKeys = SERVICE_STATUS_DEFINITIONS.flatMap(({ id }) => [
    `services.${id}.sni`,
    `services.${id}.port`,
    `services.${id}.health.path`,
    `services.${id}.health.contract`,
  ]);
  const serviceStatuses = createServiceStatusCollector({
    fetchImpl: serviceStatusFetch,
    getRegisterValues: async () => {
      try { return await resolveCurrentRegisterKeys(serviceStatusKeys, { allowMissing: true }); }
      catch { return {}; }
    },
    intervalMs: serviceStatusIntervalMs,
    timeoutMs: serviceStatusTimeoutMs,
    onTransition: (previous, current) => {
      store.audit("system", "service.status.change", current.id, current.status, {
        from: previous.status,
        to: current.status,
        checks: current.checks,
      });
    },
  });
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: MAX_MARKDOWN_BYTES },
  });
  const backupUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: MAX_BACKUP_BYTES },
  });
  const loginAttempts = new Map();
  const resolutionAttempts = new Map();

  function recordResolutionAttempt(address, now) {
    if (resolutionAttempts.size >= 2_048) {
      for (const [source, timestamps] of resolutionAttempts) {
        if (!timestamps.some((timestamp) => now - timestamp < 60_000)) resolutionAttempts.delete(source);
      }
      while (resolutionAttempts.size >= 2_048) resolutionAttempts.delete(resolutionAttempts.keys().next().value);
    }
    const recent = (resolutionAttempts.get(address) ?? []).filter((timestamp) => now - timestamp < 60_000);
    if (recent.length >= 120) return false;
    recent.push(now);
    resolutionAttempts.set(address, recent);
    return true;
  }

  function authorizeNeptuneExport(req) {
    if (!neptuneExportTokenFile || !fs.existsSync(neptuneExportTokenFile)) return false;
    const supplied = String(req.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const expected = fs.readFileSync(neptuneExportTokenFile, "utf8").trim();
    return timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(expected).digest());
  }

  app.disable("x-powered-by");
  if (trustProxy) app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (BLOCKED_PROBE_PATH.test(req.path)) {
      return res.status(404).json({ error: "Not found" });
    }
    next();
  });
  app.use(express.json({ limit: MAX_TOPOLOGY_BYTES }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    req.requestId = `req_${randomUUID().replaceAll("-", "")}`;
    res.setHeader("X-Request-ID", req.requestId);
    next();
  });

  function resolveAuth(req) {
    const session = verifySessionToken(
      req.cookies?.kernel_session,
      sessionSecret,
      store.getAuthGeneration(),
    );
    if (session) return { actor: "operator", kind: "operator" };
    const authorization = req.get("authorization") ?? "";
    if (authorization.startsWith("Bearer ")) {
      const presentedToken = authorization.slice(7);
      if (verifyApiToken(presentedToken, apiToken)) {
        return { actor: "internal-service", kind: "service" };
      }
    }
    return null;
  }

  function requireAuth(req, res, next) {
    req.auth = resolveAuth(req);
    if (!req.auth) return res.status(401).json({ error: "Authentication required" });
    next();
  }

  function requireOperator(req, res, next) {
    req.auth = resolveAuth(req);
    if (!req.auth) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (req.auth?.kind !== "operator") {
      return res.status(403).json({ error: "Operator session required" });
    }
    if (!requestOriginMatches(req, trustProxy)) {
      return res.status(403).json({ error: "Request origin is not allowed" });
    }
    next();
  }

  function machineError(req, res, status, code, message) {
    return res.status(status).json({
      error: {
        code,
        message,
        request_id: req.requestId,
      },
    });
  }

  function requireMachine(req, res, next) {
    req.auth = resolveAuth(req);
    if (!req.auth) {
      return machineError(
        req,
        res,
        401,
        "MACHINE_AUTH_REQUIRED",
        "A valid Kernel service token is required.",
      );
    }
    if (req.auth.kind !== "service") {
      return machineError(
        req,
        res,
        403,
        "MACHINE_TOKEN_REQUIRED",
        "This endpoint is available to internal services only.",
      );
    }
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Pragma", "no-cache");
    next();
  }

  function machineAudit(req, status = "success", details = {}) {
    if (store.getSetting("revision_request_logging") === "false") return;
    store.audit("internal-service", "machine.read", req.path, status, {
      request_id: req.requestId,
      method: req.method,
      source_address: req.ip || req.socket.remoteAddress || null,
      ...details,
    });
  }

  function registerMigration(actor = "system") {
    const result = store.scrubLegacyRegisterValues(isUnresolvedRegisterEntry, actor);
    return {
      result,
      status: {
        required: result.pending,
        entry_count: result.count,
        entries: result.entries,
      },
    };
  }

  function operatorRegisterSnapshot(actor = "system") {
    const migration = registerMigration(actor);
    return { ...migration.result.snapshot, value_migration: migration.status };
  }

  function publishableRegisterSnapshot(req, res) {
    const migration = registerMigration();
    if (migration.status.required) {
      machineAudit(req, "blocked", {
        reason: "volt-value-migration",
        entry_count: migration.status.entry_count,
      });
      machineError(
        req,
        res,
        503,
        "REGISTER_VALUE_MIGRATION_REQUIRED",
        "Register publication is blocked until every value is replaced with a volt:// reference.",
      );
      return null;
    }
    return store.getRegisterMachineSnapshot();
  }

  function sendMachineJson(res, mediaType, payload) {
    res.setHeader("Content-Type", mediaType);
    res.end(JSON.stringify(payload));
  }

  function applyConditionalHeaders(req, res, prefix, snapshot) {
    res.setHeader("ETag", `"${snapshot.revision}"`);
    res.setHeader(`X-${prefix}-Revision`, snapshot.revision);
    res.setHeader(`X-${prefix}-Checksum`, snapshot.checksum);
    if (etagMatches(req.get("if-none-match"), snapshot.revision)) {
      machineAudit(req, "not-modified", { revision: snapshot.revision });
      res.status(304).end();
      return true;
    }
    return false;
  }

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send(ROBOTS_POLICY);
  });

  app.get("/api/health", (req, res) => {
    if (isProxiedRequest(req)) return res.status(404).json({ error: "Not found" });
    res.json({ status: "ok", service: "exocortex-kernel", version });
  });

  app.get("/api/appearance", (_req, res) => {
    const { colors } = store.getUiSettings();
    res.json({ colors });
  });

  app.get("/api/v1/health", (req, res) => {
    if (isProxiedRequest(req)) return res.status(404).json({ error: "Not found" });
    res.json({
      schema: "exocortex.kernel.health.v1",
      status: "ok",
      service: "exocortex-kernel",
      version,
    });
  });

  app.head("/api/v1/register/snapshot", requireMachine, (req, res) => {
    const snapshot = publishableRegisterSnapshot(req, res);
    if (!snapshot) return;
    if (applyConditionalHeaders(req, res, "Register", snapshot)) return;
    machineAudit(req, "success", { revision: snapshot.revision });
    res.status(200).end();
  });

  app.get("/api/v1/register/snapshot", requireMachine, (req, res) => {
    const snapshot = publishableRegisterSnapshot(req, res);
    if (!snapshot) return;
    if (applyConditionalHeaders(req, res, "Register", snapshot)) return;
    machineAudit(req, "success", { revision: snapshot.revision });
    sendMachineJson(res, REGISTER_MEDIA_TYPE, snapshot);
  });

  app.get("/api/v1/register/sections/:section", requireMachine, (req, res) => {
    const snapshot = publishableRegisterSnapshot(req, res);
    if (!snapshot) return;
    const section = req.params.section;
    if (!Object.hasOwn(snapshot.values, section)) {
      machineAudit(req, "not-found", { revision: snapshot.revision, section });
      return machineError(
        req,
        res,
        404,
        "REGISTER_SECTION_NOT_FOUND",
        "The requested Register section was not found.",
      );
    }
    if (applyConditionalHeaders(req, res, "Register", snapshot)) return;
    const selected = snapshot.values[section];
    machineAudit(req, "success", { revision: snapshot.revision, section });
    return sendMachineJson(res, REGISTER_MEDIA_TYPE, {
      schema: "exocortex.register.section.v1",
      revision: snapshot.revision,
      checksum: checksumOf({ [section]: selected }),
      published_at: snapshot.published_at,
      section,
      values: selected,
    });
  });

  app.get("/api/v1/register/resolve", requireMachine, (req, res) => {
    const key = typeof req.query.key === "string" ? req.query.key.trim() : "";
    if (!SAFE_KEY.test(key)) {
      machineAudit(req, "invalid", { key });
      return machineError(
        req,
        res,
        400,
        "REGISTER_KEY_INVALID",
        "A valid dotted Register key is required.",
      );
    }
    const snapshot = publishableRegisterSnapshot(req, res);
    if (!snapshot) return;
    const value = nestedRegisterValue(snapshot.values, key);
    if (value === undefined) {
      machineAudit(req, "not-found", { revision: snapshot.revision, key });
      return machineError(req, res, 404, "REGISTER_KEY_NOT_FOUND", "The requested Register key was not found.");
    }
    if (applyConditionalHeaders(req, res, "Register", snapshot)) return;
    machineAudit(req, "success", { revision: snapshot.revision, key });
    return sendMachineJson(res, REGISTER_MEDIA_TYPE, {
      schema: "exocortex.register.value.v1",
      revision: snapshot.revision,
      key,
      value,
    });
  });

  app.post("/api/v1/register/resolve", requireMachine, async (req, res, next) => {
    try {
      const submitted = req.body?.keys;
      if (
        !Array.isArray(submitted)
        || submitted.length < 1
        || submitted.length > MAX_VOLT_REFERENCES
        || submitted.some((key) => typeof key !== "string" || !SAFE_KEY.test(key.trim()))
      ) {
        machineAudit(req, "invalid", { reason: "invalid-keys" });
        return machineError(req, res, 400, "REGISTER_KEYS_INVALID", "keys must contain between 1 and 20 valid dotted Register keys.");
      }
      const keys = [...new Set(submitted.map((key) => key.trim()))];
      const address = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      if (!recordResolutionAttempt(address, now)) {
        machineAudit(req, "blocked", { reason: "rate-limit", key_count: keys.length });
        return machineError(req, res, 429, "REGISTER_RESOLUTION_RATE_LIMITED", "Too many resolution requests; retry later.");
      }

      const snapshot = publishableRegisterSnapshot(req, res);
      if (!snapshot) return;
      const selected = new Map();
      const references = [];
      for (const key of keys) {
        const value = nestedRegisterValue(snapshot.values, key);
        if (value === undefined) {
          machineAudit(req, "not-found", { revision: snapshot.revision, key_count: keys.length });
          return machineError(req, res, 404, "REGISTER_KEY_NOT_FOUND", "A requested Register key was not found.");
        }
        if (typeof value !== "string") {
          machineAudit(req, "invalid", { revision: snapshot.revision, reason: "non-string-value", key_count: keys.length });
          return machineError(req, res, 422, "REGISTER_VALUE_INVALID", "A requested Register value is not a string.");
        }
        selected.set(key, value);
        references.push(value);
      }

      const uniqueReferences = [...new Set(references)];
      const volt = uniqueReferences.length ? await activeVoltClient().resolve(uniqueReferences) : null;
      const values = {};
      for (const [key, storedValue] of selected) {
        const resolved = volt.values[storedValue];
        values[key] = {
          value: resolved.value,
          secret: resolved.visibility === "secret",
          volt_revision: resolved.revision,
        };
      }
      machineAudit(req, "success", {
        revision: snapshot.revision,
        key_count: keys.length,
        volt_value_count: uniqueReferences.length,
      });
      res.setHeader("Cache-Control", "no-store, private");
      res.setHeader("Pragma", "no-cache");
      return sendMachineJson(res, REGISTER_MEDIA_TYPE, {
        schema: "exocortex.register.resolution.v1",
        register_revision: snapshot.revision,
        values,
      });
    } catch (error) {
      machineAudit(req, "failed", { code: error?.code ?? "INTERNAL_ERROR" });
      next(error);
    }
  });

  function constitutionState() {
    const document = store.getDocument("constitution");
    const parsed = parseConstitution(document.content);
    return {
      document,
      parsed,
      snapshot: {
        schema: "exocortex.constitution.snapshot.v1",
        revision: document.revision,
        checksum: document.checksum,
        published_at: document.created_at,
        source: {
          filename: "constitution.md",
          format: "markdown",
        },
        document: {
          title: parsed.title,
          markdown: document.content,
        },
        sections: parsed.sections,
      },
    };
  }

  app.get("/api/v1/constitution/raw", requireMachine, (req, res) => {
    const { document } = constitutionState();
    if (applyConditionalHeaders(req, res, "Constitution", document)) return;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    machineAudit(req, "success", { revision: document.revision, representation: "raw" });
    res.send(document.content);
  });

  app.get("/api/v1/constitution/snapshot", requireMachine, (req, res) => {
    const { snapshot } = constitutionState();
    if (applyConditionalHeaders(req, res, "Constitution", snapshot)) return;
    machineAudit(req, "success", { revision: snapshot.revision, representation: "snapshot" });
    sendMachineJson(res, CONSTITUTION_MEDIA_TYPE, snapshot);
  });

  app.get("/api/v1/constitution/meta", requireMachine, (req, res) => {
    const { document, parsed } = constitutionState();
    if (applyConditionalHeaders(req, res, "Constitution", document)) return;
    machineAudit(req, "success", { revision: document.revision, representation: "meta" });
    sendMachineJson(res, CONSTITUTION_MEDIA_TYPE, {
      schema: "exocortex.constitution.meta.v1",
      revision: document.revision,
      checksum: document.checksum,
      published_at: document.created_at,
      section_count: parsed.sections.length,
    });
  });

  app.post("/api/auth/login", (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const timestamp = Date.now();
    const attempts = (loginAttempts.get(ip) ?? []).filter((item) => timestamp - item < 10 * 60 * 1000);
    if (attempts.length >= 10) {
      store.audit("anonymous", "auth.login", "operator", "denied", { reason: "rate-limit" });
      return res.status(429).json({ error: "Too many attempts; retry later" });
    }
    const submittedAccessKey = typeof req.body?.access_key === "string"
      ? req.body.access_key
      : typeof req.body?.password === "string"
        && typeof req.body?.username === "string"
        && verifyApiToken(req.body.username.trim(), legacyAdminUsername)
        ? req.body.password
        : "";
    if (!verifyPassword(submittedAccessKey, store.getPasswordHash())) {
      attempts.push(timestamp);
      loginAttempts.set(ip, attempts);
      store.audit("anonymous", "auth.login", "operator", "denied", { reason: "invalid-credentials" });
      return res.status(401).json({ error: "Invalid Access Key" });
    }
    loginAttempts.delete(ip);
    const token = createSessionToken(sessionSecret, store.getAuthGeneration());
    res.cookie("kernel_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: cookieSecure,
      maxAge: 12 * 60 * 60 * 1000,
      path: "/",
    });
    store.audit("operator", "auth.login", "operator", "success", {});
    return res.json({ authenticated: true, actor: "operator" });
  });

  app.post("/api/auth/logout", requireOperator, (req, res) => {
    res.clearCookie("kernel_session", {
      httpOnly: true,
      sameSite: "strict",
      secure: cookieSecure,
      path: "/",
    });
    store.audit("operator", "auth.logout", "operator", "success", {});
    res.json({ authenticated: false });
  });

  app.get("/api/auth/session", requireOperator, (req, res) => {
    res.json({ authenticated: true, actor: req.auth.actor, kind: req.auth.kind });
  });

  app.get("/api/dashboard", requireOperator, (_req, res) => {
    res.json(metrics.read());
  });

  app.get("/api/service-statuses", requireOperator, async (_req, res, next) => {
    try {
      res.json(await serviceStatuses.snapshot());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/documents/:type", requireOperator, (req, res, next) => {
    try {
      if (!DOCUMENT_TYPES.has(req.params.type)) return res.status(404).json({ error: "Unknown document" });
      res.json(store.getDocument(req.params.type));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/documents/:type/versions", requireOperator, (req, res) => {
    if (!DOCUMENT_TYPES.has(req.params.type)) return res.status(404).json({ error: "Unknown document" });
    res.json({
      versions: store.listDocumentVersions(
        req.params.type,
        normalizeLimit(req.query.limit, 100, 500),
      ),
    });
  });

  app.post("/api/documents/:type/upload", requireOperator, upload.single("file"), (req, res, next) => {
    try {
      if (!DOCUMENT_TYPES.has(req.params.type)) return res.status(404).json({ error: "Unknown document" });
      const content = validateMarkdown(req.file, req.params.type);
      res.status(201).json(store.createDocumentRevision(
        req.params.type,
        content,
        safeActor(req),
        "upload",
      ));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/documents/:type/restore", requireOperator, (req, res, next) => {
    try {
      if (!DOCUMENT_TYPES.has(req.params.type)) return res.status(404).json({ error: "Unknown document" });
      const revision = typeof req.body?.revision === "string" ? req.body.revision : "";
      const restored = store.restoreDocument(req.params.type, revision, safeActor(req));
      if (!restored) return res.status(404).json({ error: "Document revision not found" });
      res.status(201).json(restored);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/register", requireOperator, (req, res) => {
    res.json(operatorRegisterSnapshot(safeActor(req)));
  });

  app.get("/api/register/versions", requireOperator, (req, res) => {
    res.json({ versions: store.listRegisterVersions(normalizeLimit(req.query.limit, 100, 500)) });
  });

  app.post("/api/register/restore", requireOperator, (req, res, next) => {
    try {
      const revision = typeof req.body?.revision === "string" ? req.body.revision : "";
      const actor = safeActor(req);
      // Legacy revisions remain operator-restorable during migration, but any
      // restored literal immediately blocks machine publication until remapped.
      const restored = store.restoreRegister(revision, actor);
      if (!restored) return res.status(404).json({ error: "Register revision not found" });
      res.status(201).json(operatorRegisterSnapshot(actor));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/register/entries", requireOperator, (req, res, next) => {
    try {
      const actor = safeActor(req);
      store.createRegisterEntry(validateRegisterInput(req.body), actor);
      res.status(201).json(operatorRegisterSnapshot(actor));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/register/entries", requireOperator, (req, res, next) => {
    try {
      if (!Array.isArray(req.body?.entries) || req.body.entries.length < 1 || req.body.entries.length > 200) {
        return res.status(400).json({ error: "entries must contain between 1 and 200 Register values" });
      }
      const inputs = req.body.entries.map(validateRegisterInput);
      if (new Set(inputs.map((item) => item.key)).size !== inputs.length) {
        return res.status(400).json({ error: "entries must not contain duplicate keys" });
      }
      const actor = safeActor(req);
      store.upsertRegisterEntries(inputs, actor);
      res.json(operatorRegisterSnapshot(actor));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/register/entries/:id", requireOperator, (req, res, next) => {
    try {
      const actor = safeActor(req);
      const snapshot = store.updateRegisterEntry(
        req.params.id,
        validateRegisterInput(req.body),
        actor,
      );
      if (!snapshot) return res.status(404).json({ error: "Register entry not found" });
      res.json(operatorRegisterSnapshot(actor));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/register/entries/:id", requireOperator, (req, res, next) => {
    try {
      const actor = safeActor(req);
      const snapshot = store.deleteRegisterEntry(req.params.id, actor);
      if (!snapshot) return res.status(404).json({ error: "Register entry not found" });
      res.json(operatorRegisterSnapshot(actor));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/register/order", requireOperator, (req, res, next) => {
    try {
      if (!Array.isArray(req.body?.ids) || req.body.ids.some((id) => typeof id !== "string")) {
        return res.status(400).json({ error: "ids must be an array of entry IDs" });
      }
      const actor = safeActor(req);
      store.reorderRegisterEntries(req.body.ids, actor);
      res.json(operatorRegisterSnapshot(actor));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/topology", requireOperator, (_req, res) => {
    res.json(store.getTopology());
  });

  app.put("/api/topology", requireOperator, (req, res, next) => {
    try {
      const project = validateTopology(req.body?.project ?? req.body);
      res.json(store.saveTopology(project, safeActor(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/topology/versions", requireOperator, (req, res) => {
    res.json({ versions: store.listTopologyVersions(normalizeLimit(req.query.limit, 100, 500)) });
  });

  app.post("/api/topology/restore", requireOperator, (req, res, next) => {
    try {
      const revision = typeof req.body?.revision === "string" ? req.body.revision : "";
      const restored = store.restoreTopology(revision, safeActor(req));
      if (!restored) return res.status(404).json({ error: "Topology revision not found" });
      res.status(201).json(restored);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings", requireOperator, (_req, res) => {
    res.json(store.getUiSettings());
  });

  app.put("/api/settings", requireOperator, (req, res, next) => {
    try {
      res.json(store.updateUiSettings(
        validateUiSettings(req.body, store.getUiSettings()),
        safeActor(req),
      ));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings/volt", requireOperator, (_req, res, next) => {
    try {
      const connection = store.getVoltConnectionSettings();
      res.json({ url: connection.url, token_configured: Boolean(connection.encrypted_token) });
    } catch (error) { next(error); }
  });

  app.put("/api/settings/volt", requireOperator, (req, res, next) => {
    try {
      const current = store.getVoltConnectionSettings();
      let url;
      try {
        url = validateVoltUrl(typeof req.body?.url === "string" ? req.body.url.trim() : "");
      } catch (error) {
        throw Object.assign(new Error(error.message), { status: 400 });
      }
      const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      if (!url) throw Object.assign(new Error("Volt URL is required"), { status: 400 });
      if (!token && !current.encrypted_token) {
        throw Object.assign(new Error("Volt Kernel token is required"), { status: 400 });
      }
      if (token && !validateVoltKernelToken(token)) {
        throw Object.assign(new Error("Volt Kernel token must contain between 32 and 512 non-placeholder characters"), { status: 400 });
      }
      const saved = store.updateVoltConnectionSettings({
        url,
        encryptedToken: token ? encryptStoredSecret(token, sessionSecret) : "",
      }, safeActor(req));
      res.json({ url: saved.url, token_configured: Boolean(saved.encrypted_token) });
    } catch (error) { next(error); }
  });

  const changeAccessKey = (req, res, next) => {
    try {
      const currentAccessKey = typeof req.body?.current_access_key === "string"
        ? req.body.current_access_key
        : typeof req.body?.current_password === "string" ? req.body.current_password : "";
      const nextAccessKey = typeof req.body?.new_access_key === "string"
        ? req.body.new_access_key
        : typeof req.body?.new_password === "string" ? req.body.new_password : "";
      const repeatedAccessKey = typeof req.body?.repeat_access_key === "string"
        ? req.body.repeat_access_key
        : nextAccessKey;
      if (!verifyPassword(currentAccessKey, store.getPasswordHash())) {
        return res.status(400).json({ error: "Current Access Key is incorrect" });
      }
      if (nextAccessKey !== repeatedAccessKey) {
        return res.status(400).json({ error: "New Access Key entries do not match" });
      }
      if (nextAccessKey.length < 12) {
        return res.status(400).json({ error: "New Access Key must contain at least 12 characters" });
      }
      const generation = store.changePasswordHash(hashPassword(nextAccessKey), safeActor(req));
      const token = createSessionToken(sessionSecret, generation);
      res.cookie("kernel_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: cookieSecure,
        maxAge: 12 * 60 * 60 * 1000,
        path: "/",
      });
      res.json({ changed: true, sessions_revoked: true });
    } catch (error) {
      next(error);
    }
  };
  app.post("/api/settings/access-key", requireOperator, changeAccessKey);
  app.post("/api/settings/password", requireOperator, changeAccessKey);

  app.get("/api/audit", requireOperator, (req, res) => {
    res.json({ events: store.listAudit(normalizeLimit(req.query.limit, 200, 1000)) });
  });

  app.get("/api/audit/changes", requireOperator, (req, res, next) => {
    try {
      const after = typeof req.query.after === "string" ? req.query.after : "";
      if (!after) throw Object.assign(new Error("Audit cursor is required"), { status: 400 });
      res.json({ events: store.listAuditAfter(after, normalizeLimit(req.query.limit, 100, 200)) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/audit/older", requireOperator, (req, res, next) => {
    try {
      const before = typeof req.query.before === "string" ? req.query.before : "";
      if (!before) throw Object.assign(new Error("Audit cursor is required"), { status: 400 });
      res.json({ events: store.listAuditBefore(before, normalizeLimit(req.query.limit, 100, 200)) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/logs/download", requireOperator, (req, res) => {
    store.audit(safeActor(req), "logs.download", "kernel", "success", {
      request_id: req.requestId,
      format: "zip",
    });
    const audit = store.exportAudit();
    const errors = audit.events
      .filter((event) => event.status === "error")
      .map(detailedAuditError);
    const createdAt = new Date().toISOString();
    const manifest = {
      format: "exocortex-kernel-logs",
      version: 1,
      service: "kernel",
      service_version: version,
      created_at: createdAt,
      event_count: audit.events.length,
      error_count: errors.length,
      retention: audit.limits,
      files: {
        "events.jsonl": "All retained audit events, newest first.",
        "errors.json": "Expanded diagnostics for events whose status is error.",
        "manifest.json": "Archive metadata and active retention limits.",
        "README.txt": "Human-readable archive description.",
      },
    };
    const eventsJsonl = audit.events.map((event) => JSON.stringify(event)).join("\n");
    const archive = zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
      "events.jsonl": strToU8(eventsJsonl ? `${eventsJsonl}\n` : ""),
      "errors.json": strToU8(JSON.stringify(errors, null, 2)),
      "README.txt": strToU8([
        "EXOCORTEX KERNEL LOG ARCHIVE",
        "",
        `Created: ${createdAt}`,
        "Times in JSON files use ISO 8601 UTC.",
        "The web interface intentionally shows a compact event summary.",
        "errors.json contains the recorded message, type, code, cause, stack trace,",
        "request metadata and full diagnostic context when those values were available.",
        "",
        `Retention: ${audit.limits.max_entries} events, ${audit.limits.retention_days} days,`,
        `or ${audit.limits.max_bytes} stored bytes, whichever limit is reached first.`,
      ].join("\n")),
    }, { level: 6 });
    const timestamp = createdAt.replace(/\D/g, "").slice(0, 14);
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", String(archive.byteLength));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="kernel-logs-${timestamp}.zip"`,
    );
    res.send(Buffer.from(archive));
  });

  app.get("/api/backup", requireOperator, (_req, res) => {
    const archive = buildKernelBackupArchive(store.exportBackup(), version);
    const checksum = createHash("sha256").update(archive).digest("hex");
    store.audit("operator", "backup.download", "kernel", "success", { checksum });
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", String(archive.byteLength));
    res.setHeader("Content-Disposition", `attachment; filename="kernel-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.send(archive);
  });

  app.post("/api/internal/neptune/backup", (req, res) => {
    if (!authorizeNeptuneExport(req)) return res.status(401).json({ error: "Neptune export token is required" });
    const archive = buildKernelBackupArchive(store.exportBackup(), version);
    const checksum = createHash("sha256").update(archive).digest("hex");
    store.audit("neptune", "backup.export", "kernel", "success", { checksum, bytes: archive.byteLength });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", String(archive.byteLength));
    res.setHeader("X-Neptune-Archive-Schema", KERNEL_BACKUP_ARCHIVE_FORMAT);
    res.setHeader("X-Neptune-Archive-Sha256", checksum);
    res.setHeader("X-Neptune-Source-Version", version);
    res.setHeader("Content-Disposition", `attachment; filename="kernel-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
    return res.send(archive);
  });

  app.get("/api/neptune/status", requireOperator, async (_req, res, next) => {
    try { res.json(await neptuneClient.status()); } catch (error) { next(error); }
  });

  app.put("/api/neptune/schedule", requireOperator, async (req, res, next) => {
    try {
      const enabled = req.body?.enabled;
      const intervalHours = Number(req.body?.interval_hours);
      if (typeof enabled !== "boolean" || !Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 8760) {
        throw Object.assign(new Error("Neptune interval must be a whole number of hours between 1 and 8760"), { status: 400 });
      }
      await neptuneClient.schedule(enabled, intervalHours);
      res.status(204).send();
    } catch (error) { next(error); }
  });

  app.post("/api/neptune/runs", requireOperator, async (_req, res, next) => {
    try { res.status(202).json(await neptuneClient.run()); } catch (error) { next(error); }
  });

  app.post("/api/neptune/update/check", requireOperator, async (req, res, next) => {
    try {
      const repositoryUrl = (await resolveCurrentRegisterKeys(["repositories.neptune.url"]))["repositories.neptune.url"];
      if (!repositoryUrl) throw Object.assign(new Error("Register key repositories.neptune.url is missing"), { status: 409 });
      const status = await neptuneClient.status();
      const result = await checkGitHubRelease({ repositoryUrl, service: "neptune-linux", currentVersion: status.version, fetchImpl: releaseFetch, timeoutMs: updateCheckTimeoutMs });
      store.audit(safeActor(req), "neptune.update.check", "neptune-linux", "success", { installed_version: status.version, available_version: result.available_version });
      res.json(result);
    } catch (error) { next(error); }
  });

  app.post("/api/neptune/update/install", requireOperator, async (req, res, next) => {
    try {
      const repositoryUrl = (await resolveCurrentRegisterKeys(["repositories.neptune.url"]))["repositories.neptune.url"];
      const requestedVersion = String(req.body?.version ?? "");
      if (!repositoryUrl) throw Object.assign(new Error("Register key repositories.neptune.url is missing"), { status: 409 });
      const status = await neptuneClient.status();
      const update = await checkGitHubRelease({ repositoryUrl, service: "neptune-linux", currentVersion: status.version, fetchImpl: releaseFetch, timeoutMs: updateCheckTimeoutMs });
      if (!update.update_available || update.available_version !== requestedVersion) {
        throw Object.assign(new Error("Requested Neptune version is not the current upgrade candidate"), { status: 409 });
      }
      const result = await updaterClient.updateNeptune({ head_id: updaterHeadId, version: requestedVersion });
      store.audit(safeActor(req), "neptune.update.install", "neptune-linux", "success", { version: requestedVersion });
      res.json(result);
    } catch (error) { next(error); }
  });

  const stagedBackupDir = path.join(dataDir, "pre-update-backups");
  const stagedRestoreDir = path.join(dataDir, "restore-inspections");
  const pruneStagedBackups = () => {
    fs.mkdirSync(stagedBackupDir, { recursive: true });
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const entries = fs.readdirSync(stagedBackupDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && (entry.name.endsWith(".zip") || entry.name.endsWith(".json")))
      .map((entry) => {
        const target = path.join(stagedBackupDir, entry.name);
        return { target, modified: fs.statSync(target).mtimeMs };
      })
      .sort((left, right) => right.modified - left.modified);
    entries.forEach((entry, index) => {
      if (index >= 10 || entry.modified < cutoff) fs.rmSync(entry.target, { force: true });
    });
  };

  const pruneRestoreInspections = () => {
    fs.mkdirSync(stagedRestoreDir, { recursive: true });
    const cutoff = Date.now() - 60 * 60 * 1000;
    const entries = fs.readdirSync(stagedRestoreDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".upload"))
      .map((entry) => {
        const target = path.join(stagedRestoreDir, entry.name);
        return { target, modified: fs.statSync(target).mtimeMs };
      })
      .sort((left, right) => right.modified - left.modified);
    entries.forEach((entry, index) => {
      if (index >= 10 || entry.modified < cutoff) fs.rmSync(entry.target, { force: true });
    });
  };

  app.post("/api/backups", requireOperator, (req, res, next) => {
    try {
      pruneStagedBackups();
      const id = randomUUID();
      const filename = `kernel-pre-update-${id}.zip`;
      const backupBody = buildKernelBackupArchive(store.exportBackup(), version);
      if (backupBody.byteLength > MAX_BACKUP_BYTES) {
        throw Object.assign(new Error("Kernel backup exceeds the updater limit"), { status: 413 });
      }
      const target = path.join(stagedBackupDir, `${id}.zip`);
      fs.writeFileSync(`${target}.tmp`, backupBody, { mode: 0o600 });
      fs.renameSync(`${target}.tmp`, target);
      const checksum = createHash("sha256").update(backupBody).digest("hex");
      store.audit(safeActor(req), "backup.staged", "kernel-update", "success", { id, checksum });
      res.status(201).json({
        id,
        filename,
        checksum,
        download_url: `/api/backups/${id}`,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/backups/:id", requireOperator, (req, res, next) => {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
        throw Object.assign(new Error("Backup ID is invalid"), { status: 400 });
      }
      const target = path.join(stagedBackupDir, `${req.params.id}.zip`);
      if (!fs.existsSync(target)) {
        throw Object.assign(new Error("Staged backup was not found"), { status: 404 });
      }
      res.download(target, `kernel-pre-update-${req.params.id}.zip`);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/updater/status", requireOperator, async (_req, res, next) => {
    try {
      res.json({ ...(await updaterClient.status()), kernel_version: version });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/updater/install", requireOperator, async (req, res, next) => {
    try {
      const versionToInstall = typeof req.body?.version === "string"
        ? req.body.version.trim()
        : "";
      const backupId = typeof req.body?.backup_id === "string"
        ? req.body.backup_id.trim()
        : "";
      if (!versionToInstall) {
        throw Object.assign(new Error("Select a published Kernel release"), { status: 400 });
      }
      if (!/^[0-9a-f-]{36}$/i.test(backupId)) {
        throw Object.assign(new Error("Download a fresh Kernel backup before installing"), { status: 400 });
      }
      const backupPath = path.join(stagedBackupDir, `${backupId}.zip`);
      if (!fs.existsSync(backupPath)) {
        throw Object.assign(new Error("The staged Kernel backup is unavailable"), { status: 409 });
      }
      if (Date.now() - fs.statSync(backupPath).mtimeMs > 15 * 60 * 1000) {
        throw Object.assign(new Error("The staged Kernel backup is older than 15 minutes"), { status: 409 });
      }
      const backupBody = fs.readFileSync(backupPath);
      const checksum = createHash("sha256").update(backupBody).digest("hex");
      const job = await updaterClient.createUpdate({
        request_id: req.requestId,
        head_id: updaterHeadId,
        service: "kernel",
        version: versionToInstall,
        backup: {
          filename: `kernel-pre-update-${backupId}.zip`,
          sha256: checksum,
          data_base64: backupBody.toString("base64"),
        },
      });
      store.setLastUpdateJobId(job.id);
      store.audit(safeActor(req), "updater.install.requested", "kernel", "success", {
        job_id: job.id,
        version: versionToInstall,
        backup_checksum: checksum,
      });
      fs.rmSync(backupPath, { force: true });
      res.status(202).json(job);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/updater/jobs/:id", requireOperator, async (req, res, next) => {
    try {
      res.json(await updaterClient.job(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/updater/last-job", requireOperator, async (_req, res, next) => {
    try {
      const jobId = store.getLastUpdateJobId();
      res.json(jobId ? await updaterClient.job(jobId) : null);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/updater/jobs/:id/rollback", requireOperator, async (req, res, next) => {
    try {
      res.status(202).json(await updaterClient.rollback(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/backup/inspect",
    requireOperator,
    backupUpload.single("file"),
    (req, res, next) => {
      try {
        if (!req.file) {
          throw Object.assign(new Error("Select a Kernel backup ZIP file"), { status: 400 });
        }
        const backup = parseKernelBackupFile(req.file.buffer);
        if (
          !backup
          || backup.format !== "exocortex-kernel-backup"
          || ![1, 2].includes(Number(backup.version))
        ) {
          throw Object.assign(new Error("Unsupported Kernel backup format"), { status: 400 });
        }
        pruneRestoreInspections();
        const inspectionId = randomUUID();
        const target = path.join(stagedRestoreDir, `${inspectionId}.upload`);
        fs.writeFileSync(`${target}.tmp`, req.file.buffer, { mode: 0o600 });
        fs.renameSync(`${target}.tmp`, target);
        store.audit(safeActor(req), "backup.inspect", "kernel", "success", {
          inspection_id: inspectionId,
          filename: path.basename(req.file.originalname),
          size: req.file.size,
          backup_version: Number(backup.version),
        });
        res.status(201).json({
          inspection_id: inspectionId,
          filename: path.basename(req.file.originalname),
          size: req.file.size,
          format: backup.format,
          version: Number(backup.version),
          created_at: backup.created_at ?? null,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/backup/restore",
    requireOperator,
    backupUpload.single("file"),
    (req, res, next) => {
      let inspectedTarget = null;
      try {
        let bytes = req.file?.buffer;
        if (!bytes) {
          const inspectionId = typeof req.body?.inspection_id === "string"
            ? req.body.inspection_id
            : "";
          if (!/^[0-9a-f-]{36}$/i.test(inspectionId)) {
            throw Object.assign(new Error("Inspect a Kernel backup before restoring it"), { status: 400 });
          }
          inspectedTarget = path.join(stagedRestoreDir, `${inspectionId}.upload`);
          if (!fs.existsSync(inspectedTarget)) {
            throw Object.assign(new Error("Backup inspection expired or was not found"), { status: 404 });
          }
          if (Date.now() - fs.statSync(inspectedTarget).mtimeMs > 60 * 60 * 1000) {
            fs.rmSync(inspectedTarget, { force: true });
            throw Object.assign(new Error("Backup inspection expired; inspect the file again"), { status: 409 });
          }
          bytes = fs.readFileSync(inspectedTarget);
        }
        const result = store.importBackup(parseKernelBackupFile(bytes), safeActor(req), validateRegisterInput);
        if (inspectedTarget) fs.rmSync(inspectedTarget, { force: true });
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/internal/updater/restore",
    (req, res, next) => {
      if (
        !updaterControlToken
        || !verifyApiToken(req.get("x-updater-token") ?? "", updaterControlToken)
      ) {
        return res.status(403).json({ error: "Updater authentication required" });
      }
      next();
    },
    backupUpload.single("file"),
    (req, res, next) => {
      try {
        if (!req.file) {
          throw Object.assign(new Error("Kernel backup file is required"), { status: 400 });
        }
        res.json(store.importBackup(parseKernelBackupFile(req.file.buffer), "updater", validateRegisterInput));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post("/api/updater/check", requireOperator, async (req, res, next) => {
    try {
      const repositoryUrl = (await resolveCurrentRegisterKeys(["repositories.kernel.url"]))["repositories.kernel.url"];
      if (!repositoryUrl) {
        throw Object.assign(
          new Error("Register key repositories.kernel.url is missing"),
          { status: 409 },
        );
      }
      const result = await checkGitHubRelease({
        repositoryUrl,
        service: "kernel",
        currentVersion: version,
        fetchImpl: releaseFetch,
        timeoutMs: updateCheckTimeoutMs,
      });
      store.audit(safeActor(req), "updater.check", "kernel", "success", {
        installed_version: version,
        available_version: result.available_version,
        update_available: result.update_available,
      });
      res.json(result);
    } catch (error) {
      store.audit(safeActor(req), "updater.check", "kernel", "error", {
        message: error?.message ?? String(error),
      });
      next(error);
    }
  });

  app.post("/api/updater/self-update/check", requireOperator, async (req, res, next) => {
    try {
      const repositoryUrl = (await resolveCurrentRegisterKeys(["repositories.updater.url"]))["repositories.updater.url"];
      if (!repositoryUrl) {
        throw Object.assign(
          new Error("Register key repositories.updater.url is missing"),
          { status: 409 },
        );
      }
      const status = await updaterClient.status();
      if (!status.available || !status.version) {
        throw Object.assign(new Error("Updater is not installed or is unavailable on this VPS"), { status: 503 });
      }
      const result = await checkGitHubRelease({
        repositoryUrl,
        service: "updater",
        currentVersion: status.version,
        fetchImpl: releaseFetch,
        timeoutMs: updateCheckTimeoutMs,
      });
      store.audit(safeActor(req), "updater.self-update.check", "updater", "success", {
        installed_version: status.version,
        available_version: result.available_version,
        update_available: result.update_available,
      });
      res.json(result);
    } catch (error) {
      store.audit(safeActor(req), "updater.self-update.check", "updater", "error", {
        message: error?.message ?? String(error),
      });
      next(error);
    }
  });

  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, {
      dotfiles: "deny",
      etag: true,
      maxAge: "1h",
      index: false,
    }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path !== "/") return next();
      // Resolve inside the configured root so a legitimate parent such as
      // C:\.projects is not mistaken for a requested dotfile on Windows.
      res.sendFile("index.html", { root: distDir, dotfiles: "deny" });
    });
  }

  app.use((req, res) => {
    if (req.path.startsWith("/api/v1/")) {
      return machineError(req, res, 404, "MACHINE_ENDPOINT_NOT_FOUND", "Machine API endpoint not found.");
    }
    res.status(404).json({ error: "Not found" });
  });

  app.use((error, req, res, _next) => {
    const isUploadLimit = error?.code === "LIMIT_FILE_SIZE";
    const isDuplicate = typeof error?.message === "string" && error.message.includes("UNIQUE constraint failed");
    const status = isUploadLimit ? 413 : isDuplicate ? 409 : Number(error?.status) || 500;
    const message = isUploadLimit
      ? "Uploaded file exceeds the configured size limit"
      : isDuplicate
        ? "A Register entry with this key already exists"
        : status >= 500
          ? "Internal server error"
          : error.message;
    if (status >= 500) {
      store.audit(safeActor(req), "request.error", req.path, "error", {
        request_id: req.requestId,
        method: req.method,
        message: error?.message ?? String(error),
        error: serializeError(error),
      });
    }
    if (req.path.startsWith("/api/v1/")) {
      return machineError(
        req,
        res,
        status,
        error?.code || (status >= 500 ? "INTERNAL_ERROR" : "MACHINE_REQUEST_INVALID"),
        message,
      );
    }
    res.status(status).json({ error: message });
  });

  app.locals.kernel = {
    store,
    metrics,
    serviceStatuses,
    close() {
      serviceStatuses.close();
      metrics.close();
      store.close();
    },
  };
  return app;
}
