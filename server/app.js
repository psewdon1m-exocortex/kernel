import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import cookieParser from "cookie-parser";
import express from "express";
import { strToU8, zipSync } from "fflate";
import multer from "multer";
import {
  createSessionToken,
  hashPassword,
  verifyApiToken,
  verifyPassword,
  verifySessionToken,
} from "./security.js";
import { createMetricsCollector } from "./metrics.js";
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCUMENT_TYPES = new Set(["overview", "constitution"]);
const MAX_MARKDOWN_BYTES = 1024 * 1024;
const MAX_TOPOLOGY_BYTES = 2 * 1024 * 1024;
const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SENSITIVE_KEY = /(?:^|[._-])(password|passwd|secret|token|private[._-]?key|cookie|session|recovery|seed)(?:$|[._-])/i;
const SENSITIVE_VALUE = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:^|\s)(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}|https?:\/\/[^/\s:@]+:[^/\s@]+@|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/;
const ALLOWED_COLOR = /^#[0-9a-f]{6}$/i;
const MANAGED_SERVICE_TOKEN_KEY = "services.kernel.service_token";

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
  if (key === MANAGED_SERVICE_TOKEN_KEY && value.length < 24) {
    throw Object.assign(new Error("Kernel service token must contain at least 24 characters"), { status: 400 });
  }
  if (description.length > 500) {
    throw Object.assign(new Error("Description is too long"), { status: 400 });
  }
  const isReference = value.startsWith("secret://");
  if ((SENSITIVE_KEY.test(key) && !isReference && key !== MANAGED_SERVICE_TOKEN_KEY) || SENSITIVE_VALUE.test(value)) {
    throw Object.assign(new Error("Register cannot store secrets; use a secret:// reference"), { status: 400 });
  }
  return { key, value, description };
}

function validateAppearance(body) {
  const colors = body?.colors ?? {};
  for (const name of ["dark", "light", "accent"]) {
    if (!ALLOWED_COLOR.test(colors[name] ?? "")) {
      throw Object.assign(new Error(`Invalid ${name} color`), { status: 400 });
    }
  }
  return {
    colors: {
      dark: colors.dark.toLowerCase(),
      light: colors.light.toLowerCase(),
      accent: colors.accent.toLowerCase(),
    },
    sidebar_auto_hide: body.sidebar_auto_hide !== false,
    revision_request_logging: body.revision_request_logging !== false,
  };
}

function validateTopology(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Topology must be an Open Node project object"), { status: 400 });
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_TOPOLOGY_BYTES) {
    throw Object.assign(new Error("Topology project exceeds the 2 MB limit"), { status: 413 });
  }
  if (value.format !== "open-node-project" || value.schemaVersion !== "1.0.0") {
    throw Object.assign(new Error("Unsupported Open Node project format"), { status: 400 });
  }
  for (const field of ["nodes", "containers", "groups", "connections", "annotations", "presets", "assets"]) {
    if (!Array.isArray(value[field])) {
      throw Object.assign(new Error(`Topology field ${field} must be an array`), { status: 400 });
    }
  }
  for (const asset of value.assets) {
    if (
      asset?.storage === "remote"
      || (typeof asset?.uri === "string" && /^https?:\/\//i.test(asset.uri))
    ) {
      throw Object.assign(new Error("Remote Topology assets are disabled"), { status: 400 });
    }
  }
  const project = structuredClone(value);
  project.execution = {
    ...project.execution,
    mode: "manual",
    concurrency: 1,
    preferredBackend: "main",
    cacheEnabled: false,
  };
  project.timeline = { ...project.timeline, enabled: false };
  project.settings = {
    ...project.settings,
    timelineVisible: false,
    dashboardVisible: false,
  };
  project.metadata = {
    ...project.metadata,
    updatedAt: new Date().toISOString(),
  };
  return project;
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

function requestOriginMatches(req) {
  const origin = req.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    const forwardedHost = req.get("x-forwarded-host");
    const expectedHost = forwardedHost || req.get("host");
    return source.host === expectedHost;
  } catch {
    return false;
  }
}

export function createKernelApp(options) {
  const {
    dataDir = path.join(ROOT, "data"),
    defaultsDir = path.join(ROOT, "data", "defaults"),
    distDir = path.join(ROOT, "dist"),
    adminUsername,
    adminPassword,
    sessionSecret,
    apiToken,
    cookieSecure = false,
    trustProxy = false,
    diskPath = process.platform === "win32" ? path.parse(process.cwd()).root : "/",
    version = "0.1.0",
    auditMaxEntries = 10000,
    auditRetentionDays = 30,
    auditMaxBytes = 64 * 1024 * 1024,
    updateCheckTimeoutMs = 5000,
    releaseFetch = globalThis.fetch,
    updaterSocketPath = "/run/exocortex/updater.sock",
    updaterHeadId = "kernel",
    updaterControlToken = "",
    updaterClient = createUpdaterClient(updaterSocketPath, updaterControlToken),
  } = options;

  const store = new KernelStore({
    dataDir,
    defaultsDir,
    initialPasswordHash: hashPassword(adminPassword),
    auditMaxEntries,
    auditRetentionDays,
    auditMaxBytes,
  });
  store.ensureManagedRegisterEntry(
    MANAGED_SERVICE_TOKEN_KEY,
    apiToken,
    "Bearer token distributed to trusted internal services. The KERNEL_SERVICE_TOKEN bootstrap credential remains valid so a service can always read Register.",
  );
  const metrics = createMetricsCollector(diskPath);
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

  app.disable("x-powered-by");
  if (trustProxy) app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
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
      const registerToken = store.getRegisterValue(MANAGED_SERVICE_TOKEN_KEY);
      if (
        verifyApiToken(presentedToken, apiToken)
        || verifyApiToken(presentedToken, registerToken)
      ) {
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
    if (!requestOriginMatches(req)) {
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

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "exocortex-kernel", version });
  });

  app.get("/api/appearance", (_req, res) => {
    const { colors } = store.getUiSettings();
    res.json({ colors });
  });

  app.get("/api/v1/health", (_req, res) => {
    res.json({
      schema: "exocortex.kernel.health.v1",
      status: "ok",
      service: "exocortex-kernel",
      version,
    });
  });

  app.head("/api/v1/register/snapshot", requireMachine, (req, res) => {
    const snapshot = store.getRegisterMachineSnapshot();
    if (applyConditionalHeaders(req, res, "Register", snapshot)) return;
    machineAudit(req, "success", { revision: snapshot.revision });
    res.status(200).end();
  });

  app.get("/api/v1/register/snapshot", requireMachine, (req, res) => {
    const snapshot = store.getRegisterMachineSnapshot();
    if (applyConditionalHeaders(req, res, "Register", snapshot)) return;
    machineAudit(req, "success", { revision: snapshot.revision });
    sendMachineJson(res, REGISTER_MEDIA_TYPE, snapshot);
  });

  app.get("/api/v1/register/sections/:section", requireMachine, (req, res) => {
    const snapshot = store.getRegisterMachineSnapshot();
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
    const snapshot = store.getRegisterMachineSnapshot();
    let value = snapshot.values;
    for (const part of key.split(".")) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) {
        machineAudit(req, "not-found", { revision: snapshot.revision, key });
        return machineError(
          req,
          res,
          404,
          "REGISTER_KEY_NOT_FOUND",
          "The requested Register key was not found.",
        );
      }
      value = value[part];
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
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const usernameMatches = verifyApiToken(username, adminUsername);
    const passwordMatches = verifyPassword(password, store.getPasswordHash());
    if (!usernameMatches || !passwordMatches) {
      attempts.push(timestamp);
      loginAttempts.set(ip, attempts);
      store.audit("anonymous", "auth.login", "operator", "denied", { reason: "invalid-credentials" });
      return res.status(401).json({ error: "Invalid username or password" });
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
    res.json(store.getRegisterSnapshot(req.auth.kind === "operator"));
  });

  app.get("/api/register/versions", requireOperator, (req, res) => {
    res.json({ versions: store.listRegisterVersions(normalizeLimit(req.query.limit, 100, 500)) });
  });

  app.post("/api/register/restore", requireOperator, (req, res, next) => {
    try {
      const revision = typeof req.body?.revision === "string" ? req.body.revision : "";
      const restored = store.restoreRegister(revision, safeActor(req));
      if (!restored) return res.status(404).json({ error: "Register revision not found" });
      res.status(201).json(restored);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/register/entries", requireOperator, (req, res, next) => {
    try {
      res.status(201).json(store.createRegisterEntry(validateRegisterInput(req.body), safeActor(req)));
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
      res.json(store.upsertRegisterEntries(inputs, safeActor(req)));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/register/entries/:id", requireOperator, (req, res, next) => {
    try {
      const snapshot = store.updateRegisterEntry(
        req.params.id,
        validateRegisterInput(req.body),
        safeActor(req),
      );
      if (!snapshot) return res.status(404).json({ error: "Register entry not found" });
      res.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/register/entries/:id", requireOperator, (req, res, next) => {
    try {
      const snapshot = store.deleteRegisterEntry(req.params.id, safeActor(req));
      if (!snapshot) return res.status(404).json({ error: "Register entry not found" });
      res.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/register/order", requireOperator, (req, res, next) => {
    try {
      if (!Array.isArray(req.body?.ids) || req.body.ids.some((id) => typeof id !== "string")) {
        return res.status(400).json({ error: "ids must be an array of entry IDs" });
      }
      res.json(store.reorderRegisterEntries(req.body.ids, safeActor(req)));
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
      res.json(store.updateUiSettings(validateAppearance(req.body), safeActor(req)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/settings/password", requireOperator, (req, res, next) => {
    try {
      const currentPassword = typeof req.body?.current_password === "string" ? req.body.current_password : "";
      const nextPassword = typeof req.body?.new_password === "string" ? req.body.new_password : "";
      if (!verifyPassword(currentPassword, store.getPasswordHash())) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }
      if (nextPassword.length < 12) {
        return res.status(400).json({ error: "New password must contain at least 12 characters" });
      }
      const generation = store.changePasswordHash(hashPassword(nextPassword), safeActor(req));
      const token = createSessionToken(sessionSecret, generation);
      res.cookie("kernel_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: cookieSecure,
        maxAge: 12 * 60 * 60 * 1000,
        path: "/",
      });
      res.json({ changed: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/audit", requireOperator, (req, res) => {
    res.json({ events: store.listAudit(normalizeLimit(req.query.limit, 200, 1000)) });
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
    store.audit("operator", "backup.download", "kernel", "success", {});
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="kernel-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify(store.exportBackup(), null, 2));
  });

  const stagedBackupDir = path.join(dataDir, "pre-update-backups");
  const pruneStagedBackups = () => {
    fs.mkdirSync(stagedBackupDir, { recursive: true });
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const entries = fs.readdirSync(stagedBackupDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        const target = path.join(stagedBackupDir, entry.name);
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
      const filename = `kernel-pre-update-${id}.json`;
      const backupBody = Buffer.from(JSON.stringify(store.exportBackup(), null, 2));
      if (backupBody.byteLength > MAX_BACKUP_BYTES) {
        throw Object.assign(new Error("Kernel backup exceeds the updater limit"), { status: 413 });
      }
      const target = path.join(stagedBackupDir, `${id}.json`);
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
      const target = path.join(stagedBackupDir, `${req.params.id}.json`);
      if (!fs.existsSync(target)) {
        throw Object.assign(new Error("Staged backup was not found"), { status: 404 });
      }
      res.download(target, `kernel-pre-update-${req.params.id}.json`);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/updater/status", requireOperator, async (_req, res, next) => {
    try {
      res.json(await updaterClient.status());
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
      const backupPath = path.join(stagedBackupDir, `${backupId}.json`);
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
          filename: `kernel-pre-update-${backupId}.json`,
          sha256: checksum,
          data_base64: backupBody.toString("base64"),
        },
      });
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

  app.post("/api/updater/jobs/:id/rollback", requireOperator, async (req, res, next) => {
    try {
      res.status(202).json(await updaterClient.rollback(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/backup/restore",
    requireOperator,
    backupUpload.single("file"),
    (req, res, next) => {
      try {
        if (!req.file) {
          throw Object.assign(new Error("Select a Kernel backup JSON file"), { status: 400 });
        }
        let backup;
        try {
          const content = new TextDecoder("utf-8", { fatal: true }).decode(req.file.buffer);
          backup = JSON.parse(content);
        } catch {
          throw Object.assign(new Error("Backup must be valid UTF-8 JSON"), { status: 400 });
        }
        res.json(store.importBackup(backup, safeActor(req)));
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
        const content = new TextDecoder("utf-8", { fatal: true }).decode(req.file.buffer);
        res.json(store.importBackup(JSON.parse(content), "updater"));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post("/api/updater/check", requireOperator, async (req, res, next) => {
    const repositoryUrl = store.getRegisterValue("repositories.kernel.url");
    try {
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
        repository_url: repositoryUrl,
        installed_version: version,
        available_version: result.available_version,
        update_available: result.update_available,
      });
      res.json(result);
    } catch (error) {
      store.audit(safeActor(req), "updater.check", "kernel", "error", {
        repository_url: repositoryUrl ?? null,
        message: error?.message ?? String(error),
      });
      next(error);
    }
  });

  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, {
      dotfiles: "allow",
      etag: true,
      maxAge: "1h",
      index: false,
    }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(distDir, "index.html"), { dotfiles: "allow" });
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
    close() {
      metrics.close();
      store.close();
    },
  };
  return app;
}
