import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { strFromU8, unzipSync } from "fflate";
import request from "supertest";
import { createKernelApp } from "../server/app.js";
import { registerChecksum } from "../server/machine-contract.js";

const ADMIN_PASSWORD = "test-operator-password";
const ADMIN_USERNAME = "test-operator";
const API_TOKEN = "test-service-token-at-least-24";

describe("Kernel API", () => {
  let app;
  let agent;
  let dataDir;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-test-"));
    app = createKernelApp({
      dataDir,
      defaultsDir: path.resolve("data/defaults"),
      distDir: path.join(dataDir, "missing-dist"),
      adminUsername: ADMIN_USERNAME,
      adminPassword: ADMIN_PASSWORD,
      sessionSecret: "test-session-secret-at-least-32-characters",
      apiToken: API_TOKEN,
      diskPath: dataDir,
      auditMaxEntries: 100,
      auditRetentionDays: 30,
      auditMaxBytes: 16 * 1024,
      releaseFetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return [{
            tag_name: "kernel-v0.2.0",
            draft: false,
            prerelease: false,
            html_url: "https://github.com/example/kernel/releases/tag/kernel-v0.2.0",
            published_at: "2026-07-28T00:00:00Z",
          }];
        },
      }),
      updaterControlToken: "test-updater-control-token",
      updaterClient: {
        async status() {
          return {
            installed: true,
            available: true,
            status: "ok",
            service: "updater",
            version: "0.1.0",
            busy: false,
          };
        },
        async createUpdate(payload) {
          return {
            id: "job-kernel-1",
            service: payload.service,
            version: payload.version,
            state: "REQUESTED",
            rollback_available: true,
          };
        },
        async job(id) {
          return { id, service: "kernel", version: "0.2.0", state: "COMPLETED" };
        },
        async rollback(id) {
          return { id, service: "kernel", version: "0.2.0", state: "ROLLING_BACK" };
        },
      },
    });
    agent = request.agent(app);
  });

  afterEach(() => {
    app.locals.kernel.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function login() {
    const response = await agent
      .post("/api/auth/login")
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    assert.equal(response.status, 200);
    return response;
  }

  test("health is public while data is protected", async () => {
    const health = await request(app).get("/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");

    const appearance = await request(app).get("/api/appearance");
    assert.equal(appearance.status, 200);
    assert.deepEqual(appearance.body, {
      colors: { dark: "#000000", light: "#ffffff", accent: "#00a8ff" },
    });

    const dashboard = await request(app).get("/api/dashboard");
    assert.equal(dashboard.status, 401);
  });

  test("operator can authenticate and read dashboard", async () => {
    const wrongUsername = await agent.post("/api/auth/login").send({
      username: "wrong-operator",
      password: ADMIN_PASSWORD,
    });
    assert.equal(wrongUsername.status, 401);
    const denied = await agent.post("/api/auth/login").send({
      username: ADMIN_USERNAME,
      password: "wrong-password",
    });
    assert.equal(denied.status, 401);
    await login();

    const response = await agent.get("/api/dashboard");
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.ram.total_bytes, "number");
    assert.equal(typeof response.body.uptime_seconds, "number");
  });

  test("documents upload from device and restore as a new revision", async () => {
    await login();
    const initial = await agent.get("/api/documents/overview");
    assert.equal(initial.status, 200);

    const uploaded = await agent
      .post("/api/documents/overview/upload")
      .attach("file", Buffer.from("# Updated overview\n\nSafe content."), {
        filename: "overview.md",
        contentType: "text/markdown",
      });
    assert.equal(uploaded.status, 201);
    assert.notEqual(uploaded.body.revision, initial.body.revision);
    assert.match(uploaded.body.content, /Updated overview/);

    const wrongName = await agent
      .post("/api/documents/overview/upload")
      .attach("file", Buffer.from("# Wrong"), "other.md");
    assert.equal(wrongName.status, 400);

    const restored = await agent
      .post("/api/documents/overview/restore")
      .send({ revision: initial.body.revision });
    assert.equal(restored.status, 201);
    assert.notEqual(restored.body.revision, initial.body.revision);
    assert.equal(restored.body.source_revision, initial.body.revision);
    assert.equal(restored.body.content, initial.body.content);
  });

  test("Register mutations and restore create immutable checksummed revisions", async () => {
    await login();
    const initial = await agent.get("/api/register");
    assert.equal(initial.status, 200);

    const created = await agent
      .post("/api/register/entries")
      .send({
        key: "perimetr.api",
        value: "https://perimetr.internal/api",
        description: "Perimetr internal API",
      });
    assert.equal(created.status, 201);
    assert.notEqual(created.body.revision, initial.body.revision);
    assert.equal(created.body.values["perimetr.api"], "https://perimetr.internal/api");
    assert.match(created.body.checksum, /^sha256:[a-f0-9]{64}$/);

    const entry = created.body.entries.find((item) => item.key === "perimetr.api");
    const updated = await agent
      .put(`/api/register/entries/${entry.id}`)
      .send({ ...entry, value: "https://perimetr.internal/v2" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.values["perimetr.api"], "https://perimetr.internal/v2");

    const secret = await agent
      .post("/api/register/entries")
      .send({ key: "service.api_token", value: "plain-secret-value", description: "" });
    assert.equal(secret.status, 400);

    const reference = await agent
      .post("/api/register/entries")
      .send({ key: "service.api_token", value: "secret://service/api-token", description: "" });
    assert.equal(reference.status, 201);

    const deleted = await agent.delete(`/api/register/entries/${entry.id}`);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.values["perimetr.api"], undefined);

    const restored = await agent
      .post("/api/register/restore")
      .send({ revision: initial.body.revision });
    assert.equal(restored.status, 201);
    assert.notEqual(restored.body.revision, initial.body.revision);
    assert.deepEqual(restored.body.values, initial.body.values);

    const versions = await agent.get("/api/register/versions");
    assert.equal(versions.status, 200);
    assert.equal(versions.body.versions[0].reason, "restore");
    assert.equal(versions.body.versions[0].source_revision, initial.body.revision);
  });

  test("service token reads only the stable v1 Register and Constitution contracts", async () => {
    const client = request(app);
    const raw = await client
      .get("/api/v1/constitution/raw")
      .set("Authorization", `Bearer ${API_TOKEN}`);
    assert.equal(raw.status, 200);
    assert.match(raw.text, /Constitution/);
    assert.match(raw.headers.etag, /^"constitution-/);
    assert.equal(raw.headers["cache-control"], "no-store, private");

    const register = await client
      .get("/api/v1/register/snapshot")
      .set("Authorization", `Bearer ${API_TOKEN}`);
    assert.equal(register.status, 200);
    assert.equal(register.body.schema, "exocortex.register.snapshot.v1");
    assert.equal(
      register.body.values.repositories.agent.url,
      "https://github.com/psewdon1m-exocortex/agent",
    );
    assert.equal(register.body.values.services.kernel.sni, "kernel.example.com");
    assert.equal(register.body.values.services.kernel.port, "443");
    assert.equal(register.body.values.services.kernel.service_token, API_TOKEN);
    assert.equal(register.body.values.services.perimetr.sni, "perimetr.example.com");
    assert.equal(register.body.values.services.perimetr.port, "443");
    assert.equal(register.body.values.intervals.kernel.refresh_sec, "60");
    const expectedChecksum = registerChecksum(register.body.values);
    assert.equal(register.body.checksum, expectedChecksum);
    assert.equal(register.headers["content-type"], "application/vnd.exocortex.register+json; version=1");

    const section = await client
      .get("/api/v1/register/sections/services")
      .set("Authorization", `Bearer ${API_TOKEN}`);
    assert.equal(section.status, 200);
    assert.equal(section.body.values.perimetr.sni, "perimetr.example.com");
    assert.equal(section.body.values.perimetr.port, "443");

    const resolved = await client
      .get("/api/v1/register/resolve?key=services.kernel.sni")
      .set("Authorization", `Bearer ${API_TOKEN}`);
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.value, "kernel.example.com");

    const unchanged = await client
      .get("/api/v1/register/snapshot")
      .set("Authorization", `Bearer ${API_TOKEN}`)
      .set("If-None-Match", register.headers.etag);
    assert.equal(unchanged.status, 304);

    const head = await client
      .head("/api/v1/register/snapshot")
      .set("Authorization", `Bearer ${API_TOKEN}`);
    assert.equal(head.status, 200);
    assert.equal(head.headers["x-register-revision"], register.body.revision);

    for (const endpoint of [
      "/api/register",
      "/api/documents/overview",
      "/api/documents/constitution",
      "/api/dashboard",
      "/api/topology",
      "/api/settings",
      "/api/audit",
      "/api/logs/download",
      "/api/auth/session",
    ]) {
      const response = await client
        .get(endpoint)
        .set("Authorization", `Bearer ${API_TOKEN}`);
      assert.equal(response.status, 403, endpoint);
    }

    const write = await client
      .post("/api/register/entries")
      .set("Authorization", `Bearer ${API_TOKEN}`)
      .send({ key: "blocked.write", value: "no", description: "" });
    assert.equal(write.status, 403);
  });

  test("operator can rotate the Register service token and toggle revision request logging", async () => {
    await login();
    const initial = await agent.get("/api/register");
    const tokenEntry = initial.body.entries.find((item) => item.key === "services.kernel.service_token");
    assert.ok(tokenEntry);

    const nextToken = "rotated-service-token-at-least-24";
    const rotated = await agent
      .put(`/api/register/entries/${tokenEntry.id}`)
      .send({ ...tokenEntry, value: nextToken });
    assert.equal(rotated.status, 200);

    const bootstrapStillWorks = await request(app)
      .get("/api/v1/register/snapshot")
      .set("Authorization", `Bearer ${API_TOKEN}`);
    assert.equal(bootstrapStillWorks.status, 200);

    await agent.put("/api/settings").send({
      colors: { dark: "#000000", light: "#ffffff", accent: "#00a8ff" },
      sidebar_auto_hide: true,
      revision_request_logging: false,
    });
    let audit = await agent.get("/api/audit?limit=500");
    const readsBeforeDisabledRequest = audit.body.events.filter(
      (event) => event.action === "machine.read",
    ).length;
    await request(app)
      .get("/api/v1/register/snapshot")
      .set("Authorization", `Bearer ${nextToken}`);
    audit = await agent.get("/api/audit?limit=500");
    assert.equal(
      audit.body.events.filter((event) => event.action === "machine.read").length,
      readsBeforeDisabledRequest,
    );

    await agent.put("/api/settings").send({
      colors: { dark: "#000000", light: "#ffffff", accent: "#00a8ff" },
      sidebar_auto_hide: true,
      revision_request_logging: true,
    });
    const snapshot = await request(app)
      .get("/api/v1/register/snapshot")
      .set("Authorization", `Bearer ${nextToken}`);
    await request(app)
      .get("/api/v1/register/snapshot")
      .set("Authorization", `Bearer ${nextToken}`)
      .set("If-None-Match", snapshot.headers.etag);
    audit = await agent.get("/api/audit?limit=500");
    const reads = audit.body.events.filter((event) => event.action === "machine.read");
    assert.ok(reads.some((event) => event.status === "success"));
    assert.ok(reads.some((event) => event.status === "not-modified"));
  });

  test("Topology accepts an Open Node project and forces visual-only settings", async () => {
    await login();
    const current = await agent.get("/api/topology");
    assert.equal(current.status, 200);
    const initialRevision = current.body.revision;
    const initialName = current.body.project.metadata.name;
    const project = current.body.project;
    project.metadata.name = "Updated topology";
    project.execution.mode = "reactive";
    project.timeline.enabled = true;
    project.settings.dashboardVisible = true;

    const saved = await agent.put("/api/topology").send({ project });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.project.metadata.name, "Updated topology");
    assert.equal(saved.body.project.execution.mode, "manual");
    assert.equal(saved.body.project.timeline.enabled, false);
    assert.equal(saved.body.project.settings.dashboardVisible, false);

    const restored = await agent
      .post("/api/topology/restore")
      .send({ revision: initialRevision });
    assert.equal(restored.status, 201);
    assert.notEqual(restored.body.revision, initialRevision);
    assert.equal(restored.body.source_revision, initialRevision);
    assert.equal(restored.body.project.metadata.name, initialName);

    const versions = await agent.get("/api/topology/versions");
    assert.equal(versions.status, 200);
    assert.equal(versions.body.versions[0].reason, "restore");
  });

  test("appearance, password and audit flows are operator-controlled", async () => {
    await login();
    const settings = await agent.put("/api/settings").send({
      colors: { dark: "#010101", light: "#fefefe", accent: "#11aaff" },
      sidebar_auto_hide: false,
      revision_request_logging: false,
    });
    assert.equal(settings.status, 200);
    assert.equal(settings.body.sidebar_auto_hide, false);
    assert.equal(settings.body.revision_request_logging, false);

    const changed = await agent.post("/api/settings/password").send({
      current_password: ADMIN_PASSWORD,
      new_password: "new-test-password",
    });
    assert.equal(changed.status, 200);

    const audit = await agent.get("/api/audit");
    assert.equal(audit.status, 200);
    assert.ok(audit.body.events.some((event) => event.action === "security.password.change"));
  });

  test("operator downloads bounded logs with expanded error diagnostics", async () => {
    await login();
    app.locals.kernel.store.audit("system", "updater.fetch", "kernel", "error", {
      request_id: "req_test_logs",
      method: "GET",
      message: "Release manifest request failed",
      error: {
        name: "NetworkError",
        code: "ECONNREFUSED",
        message: "Connection to the release host was refused",
        stack: "NetworkError: Connection to the release host was refused\n    at updater.fetch",
        cause: { name: "Error", message: "Socket closed", code: "ECONNRESET" },
      },
    });

    const logs = await agent
      .get("/api/logs/download")
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    assert.equal(logs.status, 200);
    assert.match(logs.headers["content-type"], /^application\/zip/);
    assert.match(logs.headers["content-disposition"], /kernel-logs-\d{14}\.zip/);
    const archive = unzipSync(new Uint8Array(logs.body));
    assert.ok(archive["manifest.json"]);
    assert.ok(archive["events.jsonl"]);
    assert.ok(archive["errors.json"]);
    assert.ok(archive["README.txt"]);

    const manifest = JSON.parse(strFromU8(archive["manifest.json"]));
    assert.equal(manifest.format, "exocortex-kernel-logs");
    assert.equal(manifest.retention.max_bytes, 16 * 1024);
    const errors = JSON.parse(strFromU8(archive["errors.json"]));
    const diagnostic = errors.find((item) => item.event_id && item.action === "updater.fetch");
    assert.equal(diagnostic.error_type, "NetworkError");
    assert.equal(diagnostic.error_code, "ECONNREFUSED");
    assert.equal(diagnostic.message, "Connection to the release host was refused");
    assert.match(diagnostic.stack_trace, /at updater\.fetch/);
    assert.equal(diagnostic.request_id, "req_test_logs");
    assert.equal(diagnostic.context.error.cause.code, "ECONNRESET");
  });

  test("audit retention is bounded, updates are checked from Register, and backups restore state", async () => {
    await login();
    for (let index = 0; index < 130; index += 1) {
      app.locals.kernel.store.audit("test", "retention.test", String(index), "success", {});
    }
    const audit = await agent.get("/api/audit?limit=1000");
    assert.equal(audit.status, 200);
    assert.ok(audit.body.events.length <= 100);
    for (let index = 0; index < 10; index += 1) {
      app.locals.kernel.store.audit("test", "retention.bytes", String(index), "success", {
        payload: "x".repeat(4096),
      });
    }
    const settings = await agent.get("/api/settings");
    assert.equal(settings.body.audit_limits.max_bytes, 16 * 1024);
    assert.ok(settings.body.audit_limits.stored_bytes <= 16 * 1024);
    const sizeBoundedAudit = await agent.get("/api/audit?limit=1000");
    assert.ok(sizeBoundedAudit.body.events.length < 10);

    const update = await agent.post("/api/updater/check");
    assert.equal(update.status, 200);
    assert.equal(update.body.installed_version, "0.1.0");
    assert.equal(update.body.available_version, "0.2.0");
    const updaterStatus = await agent.get("/api/updater/status");
    assert.equal(updaterStatus.status, 200);
    assert.equal(updaterStatus.body.available, true);
    const stagedBackup = await agent.post("/api/backups");
    assert.equal(stagedBackup.status, 201);
    const stagedDownload = await agent.get(stagedBackup.body.download_url);
    assert.equal(stagedDownload.status, 200);
    const install = await agent
      .post("/api/updater/install")
      .send({ version: "0.2.0", backup_id: stagedBackup.body.id });
    assert.equal(install.status, 202);
    assert.equal(install.body.state, "REQUESTED");
    const job = await agent.get("/api/updater/jobs/job-kernel-1");
    assert.equal(job.body.state, "COMPLETED");
    assert.equal(update.body.update_available, true);
    assert.equal(update.body.repository_url, "https://github.com/psewdon1m-exocortex/kernel");

    const backup = await agent.get("/api/backup");
    assert.equal(backup.status, 200);
    const initialRegister = backup.body.register.current;
    const current = await agent.get("/api/register");
    const kernelPort = current.body.entries.find((item) => item.key === "services.kernel.port");
    await agent
      .put(`/api/register/entries/${kernelPort.id}`)
      .send({ ...kernelPort, value: "19999" });

    const restored = await agent
      .post("/api/backup/restore")
      .attach("file", Buffer.from(JSON.stringify(backup.body)), {
        filename: "kernel-backup.json",
        contentType: "application/json",
      });
    assert.equal(restored.status, 200);
    const after = await agent.get("/api/register");
    assert.equal(after.body.values["services.kernel.port"], initialRegister.values["services.kernel.port"]);
    assert.notEqual(after.body.revision, initialRegister.revision);
  });
});
