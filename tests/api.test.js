import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import request from "supertest";
import { createKernelApp } from "../server/app.js";
import { registerChecksum } from "../server/machine-contract.js";

const ADMIN_PASSWORD = "test-operator-password";
const ADMIN_USERNAME = "test-operator";
const API_TOKEN = "test-service-token-at-least-24";
const REGISTER_FIXTURE_VALUES = {
  "repositories.agent.url": "https://github.com/psewdon1m-exocortex/agent",
  "repositories.kernel.url": "https://github.com/psewdon1m-exocortex/kernel",
  "repositories.neptune.url": "https://github.com/psewdon1m-exocortex/neptune",
  "repositories.gryphon.url": "https://github.com/psewdon1m-exocortex/gryphon",
  "repositories.updater.url": "https://github.com/psewdon1m-exocortex/updater",
  "services.kernel.sni": "kernel.example.com",
  "services.kernel.port": "443",
  "services.volt.sni": "volt.example.com",
  "services.perimetr.sni": "perimetr.example.com",
  "services.perimetr.port": "443",
  "intervals.kernel.refresh_sec": "60",
};

describe("Kernel API", () => {
  let app;
  let agent;
  let dataDir;
  let submittedUpdatePayload;
  let neptuneSchedule;
  let voltReferences;
  let voltValues;

  beforeEach(async () => {
    submittedUpdatePayload = undefined;
    neptuneSchedule = undefined;
    voltReferences = undefined;
    voltValues = new Map();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-test-"));
    const neptuneExportTokenFile = path.join(dataDir, "neptune-export.token");
    fs.writeFileSync(neptuneExportTokenFile, "test-neptune-export-token", { mode: 0o600 });
    app = createKernelApp({
      dataDir,
      defaultsDir: path.resolve("data/defaults"),
      distDir: path.join(dataDir, "missing-dist"),
      accessKey: ADMIN_PASSWORD,
      legacyAdminUsername: ADMIN_USERNAME,
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
          return [
            {
              tag_name: "kernel-v0.2.0",
              draft: false,
              prerelease: false,
              html_url: "https://github.com/example/kernel/releases/tag/kernel-v0.2.0",
              published_at: "2026-07-28T00:00:00Z",
            },
            {
              tag_name: "updater-v0.1.1",
              draft: false,
              prerelease: false,
              html_url: "https://github.com/example/updater/releases/tag/updater-v0.1.1",
              published_at: "2026-07-29T00:00:00Z",
            },
          ];
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
          submittedUpdatePayload = payload;
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
      neptuneExportTokenFile,
      neptuneClient: {
        async status() { return { product: "neptune-linux", version: "0.1.0", client_instance_id: "client-test", project: { projectId: "kernel", enabled: false, interval_hours: 24 }, active: false }; },
        async schedule(enabled, intervalHours) { neptuneSchedule = { enabled, intervalHours }; return {}; },
        async run() { return { accepted: true }; },
      },
      voltClient: {
        async resolve(references) {
          voltReferences = references;
          return {
            schema: "volt.resolve.v1",
            values: Object.fromEntries(references.map((reference) => [reference, {
              value: voltValues.get(reference)?.value ?? "resolved-by-kernel",
              revision: 7,
              visibility: voltValues.get(reference)?.visibility ?? "secret",
            }])),
          };
        },
      },
    });
    const currentEntries = app.locals.kernel.store.listRegisterEntries();
    app.locals.kernel.store.upsertRegisterEntries(currentEntries.map((entry) => {
      const reference = `volt://${randomUUID()}/1`;
      voltValues.set(reference, { value: REGISTER_FIXTURE_VALUES[entry.key] ?? `fixture:${entry.key}`, visibility: "plain" });
      return { key: entry.key, value: reference, description: entry.description };
    }), "test-fixture");
    agent = request.agent(app);
  });

  afterEach(() => {
    app.locals.kernel.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function login() {
    const response = await agent
      .post("/api/auth/login")
      .send({ access_key: ADMIN_PASSWORD });
    assert.equal(response.status, 200);
    return response;
  }

  test("local health, crawler policy and protected data have independent boundaries", async () => {
    const robots = await request(app).get("/robots.txt");
    assert.equal(robots.status, 200);
    assert.equal(robots.text, "User-agent: *\nDisallow: /\n");
    assert.equal(robots.headers["x-robots-tag"], "noindex, nofollow, noarchive, nosnippet");

    const health = await request(app).get("/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");
    const publicHealth = await request(app)
      .get("/api/health")
      .set("X-Forwarded-For", "203.0.113.10");
    assert.equal(publicHealth.status, 404);

    const appearance = await request(app).get("/api/appearance");
    assert.equal(appearance.status, 200);
    assert.deepEqual(appearance.body, {
      colors: { dark: "#000000", light: "#ffffff", accent: "#00a8ff" },
    });

    const dashboard = await request(app).get("/api/dashboard");
    assert.equal(dashboard.status, 401);
    assert.equal(dashboard.headers["x-robots-tag"], "noindex, nofollow, noarchive, nosnippet");
  });

  test("Neptune exports the normal Kernel archive and keeps scheduling behind operator auth", async () => {
    const denied = await request(app).get("/api/neptune/status");
    assert.equal(denied.status, 401);
    await login();
    const status = await agent.get("/api/neptune/status");
    assert.equal(status.status, 200);
    assert.equal(status.body.client_instance_id, "client-test");
    const scheduled = await agent.put("/api/neptune/schedule").send({ enabled: true, interval_hours: 6 });
    assert.equal(scheduled.status, 204);
    assert.deepEqual(neptuneSchedule, { enabled: true, intervalHours: 6 });

    const unauthorizedExport = await request(app).post("/api/internal/neptune/backup");
    assert.equal(unauthorizedExport.status, 401);
    const automatic = await request(app).post("/api/internal/neptune/backup")
      .set("Authorization", "Bearer test-neptune-export-token")
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    assert.equal(automatic.status, 200);
    assert.equal(automatic.type, "application/zip");
    const archive = unzipSync(new Uint8Array(automatic.body));
    assert.ok(archive["manifest.json"]);
    assert.ok(archive["data/kernel.json"]);
  });

  test("SPA shell is served only for the root route", async () => {
    const distDir = path.join(dataDir, "dist");
    fs.mkdirSync(distDir);
    fs.writeFileSync(distDir + path.sep + "index.html", "<!doctype html><title>kernel shell</title>");
    const shellApp = createKernelApp({
      dataDir: path.join(dataDir, "shell-data"),
      defaultsDir: path.resolve("data/defaults"),
      distDir,
      adminUsername: ADMIN_USERNAME,
      adminPassword: ADMIN_PASSWORD,
      sessionSecret: "test-session-secret-at-least-32-characters",
      apiToken: API_TOKEN,
    });
    try {
      assert.equal((await request(shellApp).get("/")).status, 200);
      for (const probe of ["/.env", "/wp-admin", "/phpmyadmin", "/.git/config"]) {
        const response = await request(shellApp).get(probe);
        assert.equal(response.status, 404, probe);
        assert.deepEqual(response.body, { error: "Not found" });
      }
    } finally {
      shellApp.locals.kernel.close();
    }
  });

  test("operator can authenticate and read dashboard", async () => {
    const denied = await agent.post("/api/auth/login").send({ access_key: "wrong-access-key" });
    assert.equal(denied.status, 401);
    const legacy = await request(app).post("/api/auth/login").send({
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    });
    assert.equal(legacy.status, 200);
    await login();

    const response = await agent.get("/api/dashboard");
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.ram.total_bytes, "number");
    assert.equal(typeof response.body.uptime_seconds, "number");

    const services = await agent.get("/api/service-statuses");
    assert.equal(services.status, 200);
    assert.deepEqual(services.body.services.map((service) => service.id), [
      "kernel", "chronos", "perimetr", "saturn", "laboratory", "volt",
    ]);
    assert.ok(services.body.services.every((service) => service.status === "unconfigured"));
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
        value: "volt://11111111-1111-4111-8111-111111111111/1",
        description: "Perimetr internal API",
      });
    assert.equal(created.status, 201);
    assert.notEqual(created.body.revision, initial.body.revision);
    assert.equal(created.body.values["perimetr.api"], "volt://11111111-1111-4111-8111-111111111111/1");
    assert.match(created.body.checksum, /^sha256:[a-f0-9]{64}$/);

    const entry = created.body.entries.find((item) => item.key === "perimetr.api");
    const updated = await agent
      .put(`/api/register/entries/${entry.id}`)
      .send({ ...entry, value: "volt://33333333-3333-4333-8333-333333333333/2" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.values["perimetr.api"], "volt://33333333-3333-4333-8333-333333333333/2");

    const secret = await agent
      .post("/api/register/entries")
      .send({ key: "service.api_token", value: "plain-secret-value", description: "" });
    assert.equal(secret.status, 400);

    const environmentReference = await agent
      .post("/api/register/entries")
      .send({ key: "service.api_token", value: "secret://env/SERVICE_API_TOKEN", description: "" });
    assert.equal(environmentReference.status, 400);

    const reference = await agent
      .post("/api/register/entries")
      .send({
        key: "service.api_token",
        value: "volt://11111111-1111-4111-8111-111111111111/1",
        description: "Volt field reference",
      });
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

  test("legacy Register values are preserved for migration but blocked from machine publication", async () => {
    const legacyValue = "legacy-value-that-must-survive-until-migrated";
    app.locals.kernel.store.createRegisterEntry({
      key: "services.legacy.api_token",
      value: legacyValue,
      description: "Legacy value awaiting Volt migration",
    }, "legacy-bootstrap");

    const blocked = await request(app)
      .get("/api/v1/register/snapshot")
      .set("Authorization", `Bearer ${API_TOKEN}`);
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.error.code, "REGISTER_VALUE_MIGRATION_REQUIRED");
    assert.equal(JSON.stringify(blocked.body).includes(legacyValue), false);

    await login();
    const operator = await agent.get("/api/register");
    assert.equal(operator.status, 200);
    assert.equal(operator.body.value_migration.required, true);
    assert.equal(operator.body.value_migration.entry_count, 1);
    assert.equal(operator.body.values["services.legacy.api_token"], legacyValue);

    const entry = operator.body.entries.find((item) => item.key === "services.legacy.api_token");
    const voltReference = "volt://11111111-1111-4111-8111-111111111111/1";
    const migrated = await agent
      .put(`/api/register/entries/${entry.id}`)
      .send({ ...entry, value: voltReference });
    assert.equal(migrated.status, 200);
    assert.equal(migrated.body.value_migration.required, false);
    assert.equal(migrated.body.values[entry.key], voltReference);

    const published = await request(app)
      .get("/api/v1/register/snapshot")
      .set("Authorization", `Bearer ${API_TOKEN}`);
    assert.equal(published.status, 200);
    assert.equal(published.body.values.services.legacy.api_token, voltReference);

    const versions = await agent.get("/api/register/versions");
    assert.equal(versions.body.versions.length, 1);
    assert.equal(versions.body.versions[0].reason, "value-scrub");
    for (const suffix of ["", "-wal", "-shm"]) {
      const filename = path.join(dataDir, `kernel.sqlite${suffix}`);
      if (fs.existsSync(filename)) {
        assert.equal(fs.readFileSync(filename).includes(Buffer.from(legacyValue)), false);
      }
    }
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
    assert.match(register.body.values.repositories.agent.url, /^volt:\/\//);
    assert.match(register.body.values.services.kernel.sni, /^volt:\/\//);
    assert.match(register.body.values.services.kernel.port, /^volt:\/\//);
    assert.equal(register.body.values.services.kernel.service_token, undefined);
    assert.match(register.body.values.services.volt.sni, /^volt:\/\//);
    assert.match(register.body.values.services.perimetr.sni, /^volt:\/\//);
    assert.match(register.body.values.services.perimetr.port, /^volt:\/\//);
    assert.match(register.body.values.intervals.kernel.refresh_sec, /^volt:\/\//);
    const expectedChecksum = registerChecksum(register.body.values);
    assert.equal(register.body.checksum, expectedChecksum);
    assert.equal(register.headers["content-type"], "application/vnd.exocortex.register+json; version=1");

    const section = await client
      .get("/api/v1/register/sections/services")
      .set("Authorization", `Bearer ${API_TOKEN}`);
    assert.equal(section.status, 200);
    assert.match(section.body.values.perimetr.sni, /^volt:\/\//);
    assert.match(section.body.values.perimetr.port, /^volt:\/\//);

    const resolved = await client
      .get("/api/v1/register/resolve?key=services.kernel.sni")
      .set("Authorization", `Bearer ${API_TOKEN}`);
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.value, register.body.values.services.kernel.sni);

    const secretReference = "volt://11111111-1111-4111-8111-111111111111/1";
    app.locals.kernel.store.createRegisterEntry({
      key: "services.test.api_token",
      value: secretReference,
      description: "Broker test",
    }, "test");
    const brokered = await client
      .post("/api/v1/register/resolve")
      .set("Authorization", `Bearer ${API_TOKEN}`)
      .send({ keys: ["services.kernel.sni", "services.test.api_token"] });
    assert.equal(brokered.status, 200);
    assert.equal(brokered.body.schema, "exocortex.register.resolution.v1");
    assert.deepEqual(brokered.body.values["services.kernel.sni"], {
      value: "kernel.example.com", secret: false, volt_revision: 7,
    });
    assert.deepEqual(brokered.body.values["services.test.api_token"], {
      value: "resolved-by-kernel", secret: true, volt_revision: 7,
    });
    assert.deepEqual(new Set(voltReferences), new Set([register.body.values.services.kernel.sni, secretReference]));
    assert.equal(brokered.headers["cache-control"], "no-store, private");

    const unchanged = await client
      .get("/api/v1/register/snapshot")
      .set("Authorization", `Bearer ${API_TOKEN}`)
      .set("If-None-Match", `"${brokered.body.register_revision}"`);
    assert.equal(unchanged.status, 304);

    const head = await client
      .head("/api/v1/register/snapshot")
      .set("Authorization", `Bearer ${API_TOKEN}`);
    assert.equal(head.status, 200);
    assert.equal(head.headers["x-register-revision"], brokered.body.register_revision);

    for (const endpoint of [
      "/api/register",
      "/api/documents/overview",
      "/api/documents/constitution",
      "/api/dashboard",
      "/api/service-statuses",
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

  test("Kernel bootstrap token stays outside Register and revision request logging can be toggled", async () => {
    await login();
    const initial = await agent.get("/api/register");
    const tokenEntry = initial.body.entries.find((item) => item.key === "services.kernel.service_token");
    assert.equal(tokenEntry, undefined);

    const nextToken = "rotated-service-token-at-least-24";
    const rejected = await agent
      .post("/api/register/entries")
      .send({ key: "services.kernel.service_token", value: nextToken, description: "" });
    assert.equal(rejected.status, 400);

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
      .set("Authorization", `Bearer ${API_TOKEN}`);
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
      .set("Authorization", `Bearer ${API_TOKEN}`);
    await request(app)
      .get("/api/v1/register/snapshot")
      .set("Authorization", `Bearer ${API_TOKEN}`)
      .set("If-None-Match", snapshot.headers.etag);
    audit = await agent.get("/api/audit?limit=500");
    const reads = audit.body.events.filter((event) => event.action === "machine.read");
    assert.ok(reads.some((event) => event.status === "success"));
    assert.ok(reads.some((event) => event.status === "not-modified"));
  });

  test("Topology accepts a versioned Excalidraw document with embedded images", async () => {
    await login();
    const current = await agent.get("/api/topology");
    assert.equal(current.status, 200);
    const initialRevision = current.body.revision;
    assert.equal(current.body.project.type, "excalidraw");
    assert.equal(current.body.project.version, 2);
    const project = current.body.project;
    project.appState.name = "Updated topology";
    project.elements.push({
      id: "rectangle-test",
      type: "rectangle",
      x: 80,
      y: 80,
      width: 240,
      height: 140,
    });
    project.files["image-test"] = {
      id: "image-test",
      mimeType: "image/png",
      dataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      created: Date.now(),
    };

    const saved = await agent.put("/api/topology").send({ project });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.project.appState.name, "Updated topology");
    assert.equal(saved.body.project.elements.at(-1).type, "rectangle");
    assert.match(saved.body.project.files["image-test"].dataURL, /^data:image\/png;base64,/);

    const remoteFile = structuredClone(saved.body.project);
    remoteFile.files["image-test"].dataURL = "https://example.test/image.png";
    const rejected = await agent.put("/api/topology").send({ project: remoteFile });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error, /embedded Excalidraw image data/i);

    const duplicateElement = structuredClone(saved.body.project);
    duplicateElement.elements.push({ ...duplicateElement.elements[0] });
    const duplicateRejected = await agent.put("/api/topology").send({ project: duplicateElement });
    assert.equal(duplicateRejected.status, 400);
    assert.match(duplicateRejected.body.error, /duplicate/i);

    const restored = await agent
      .post("/api/topology/restore")
      .send({ revision: initialRevision });
    assert.equal(restored.status, 201);
    assert.notEqual(restored.body.revision, initialRevision);
    assert.equal(restored.body.source_revision, initialRevision);
    assert.equal(restored.body.project.type, "excalidraw");
    assert.deepEqual(restored.body.project.elements, []);

    const versions = await agent.get("/api/topology/versions");
    assert.equal(versions.status, 200);
    assert.equal(versions.body.versions[0].reason, "restore");
  });

  test("appearance, Access Key and audit flows are operator-controlled", async () => {
    await login();
    const settings = await agent.put("/api/settings").send({
      colors: { dark: "#010101", light: "#fefefe", accent: "#11aaff" },
      sidebar_auto_hide: false,
      revision_request_logging: false,
    });
    assert.equal(settings.status, 200);
    assert.equal(settings.body.sidebar_auto_hide, false);
    assert.equal(settings.body.revision_request_logging, false);
    assert.deepEqual(settings.body.colors, {
      dark: "#000000",
      light: "#ffffff",
      accent: "#11aaff",
    });
    assert.deepEqual(settings.body.presentation.navigation_order, [
      "dashboard", "overview", "topology", "register", "constitution", "settings",
    ]);

    const changed = await agent.post("/api/settings/access-key").send({
      current_access_key: ADMIN_PASSWORD,
      new_access_key: "new-test-access-key",
      repeat_access_key: "new-test-access-key",
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.sessions_revoked, true);

    const audit = await agent.get("/api/audit");
    assert.equal(audit.status, 200);
    assert.ok(audit.body.events.some((event) => event.action === "security.access-key.change"));
  });

  test("Volt connection is configured through operator settings without exposing its token", async () => {
    await login();
    const initial = await agent.get("/api/settings/volt");
    assert.deepEqual(initial.body, { url: "", token_configured: false });

    const invalid = await agent.put("/api/settings/volt").send({
      url: "http://volt.example.com",
      token: "short",
    });
    assert.equal(invalid.status, 400);

    const token = "kernel-to-volt-settings-token-at-least-32-characters";
    const saved = await agent.put("/api/settings/volt").send({
      url: "https://volt.example.net",
      token,
    });
    assert.deepEqual(saved.body, { url: "https://volt.example.net", token_configured: true });
    assert.equal(JSON.stringify(saved.body).includes(token), false);
    const ciphertext = app.locals.kernel.store.getSetting("volt_kernel_token_encrypted");
    assert.equal(ciphertext.includes(token), false);

    const kept = await agent.put("/api/settings/volt").send({
      url: "https://new-volt.example.net",
      token: "",
    });
    assert.deepEqual(kept.body, { url: "https://new-volt.example.net", token_configured: true });
  });

  test("operator mutations accept the browser origin through the local UI proxy", async () => {
    await login();
    const current = await agent.get("/api/settings");
    const reorderedDashboard = [
      "uptime", "ram", "disk", "cpu",
      ...current.body.presentation.dashboard_order.slice(4),
    ];
    const proxied = await agent
      .put("/api/settings")
      .set("Host", "127.0.0.1:18180")
      .set("Origin", "http://kernel.local:18181")
      .set("X-Forwarded-Host", "kernel.local:18181")
      .send({
        ...current.body,
        colors: { ...current.body.colors, accent: "#22bbcc" },
        presentation: {
          ...current.body.presentation,
          dashboard_order: reorderedDashboard,
        },
      });
    assert.equal(proxied.status, 200);
    assert.equal(proxied.body.colors.accent, "#22bbcc");
    assert.deepEqual(proxied.body.presentation.dashboard_order, reorderedDashboard);

    const rejected = await agent
      .put("/api/settings")
      .set("Host", "kernel.local:18181")
      .set("Origin", "https://attacker.example")
      .send(current.body);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.error, "Request origin is not allowed");
  });

  test("operator downloads bounded logs with expanded error diagnostics", async () => {
    await login();
    const cursor = (await agent.get("/api/audit?limit=1")).body.events[0].id;
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
    const changes = await agent.get(`/api/audit/changes?after=${encodeURIComponent(cursor)}`);
    assert.equal(changes.status, 200);
    assert.ok(changes.body.events.some((event) => event.action === "updater.fetch"));
    const older = await agent.get(`/api/audit/older?before=${encodeURIComponent(changes.body.events[0].id)}`);
    assert.equal(older.status, 200);
    assert.ok(older.body.events.length > 0);

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
    assert.equal(update.body.installed_version, "0.1.1");
    assert.equal(update.body.available_version, "0.2.0");
    const updaterStatus = await agent.get("/api/updater/status");
    assert.equal(updaterStatus.status, 200);
    assert.equal(updaterStatus.body.available, true);
    assert.equal(updaterStatus.body.kernel_version, "0.1.1");
    const updaterUpdate = await agent.post("/api/updater/self-update/check");
    assert.equal(updaterUpdate.status, 200);
    assert.equal(updaterUpdate.body.service, "updater");
    assert.equal(updaterUpdate.body.installed_version, "0.1.0");
    assert.equal(updaterUpdate.body.available_version, "0.1.1");
    assert.equal(updaterUpdate.body.update_available, true);
    assert.equal(updaterUpdate.body.repository_url, "https://github.com/psewdon1m-exocortex/updater");
    const stagedBackup = await agent.post("/api/backups");
    assert.equal(stagedBackup.status, 201);
    const stagedDownload = await agent
      .get(stagedBackup.body.download_url)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    assert.equal(stagedDownload.status, 200);
    assert.match(stagedDownload.headers["content-type"], /^application\/zip/);
    assert.match(stagedDownload.headers["content-disposition"], /kernel-pre-update-[0-9a-f-]+\.zip/);
    const stagedArchive = unzipSync(new Uint8Array(stagedDownload.body));
    assert.ok(stagedArchive["manifest.json"]);
    assert.ok(stagedArchive["data/kernel.json"]);
    const install = await agent
      .post("/api/updater/install")
      .send({ version: "0.2.0", backup_id: stagedBackup.body.id });
    assert.equal(install.status, 202);
    assert.equal(install.body.state, "REQUESTED");
    const lastJob = await agent.get("/api/updater/last-job");
    assert.equal(lastJob.body.id, "job-kernel-1");
    assert.match(submittedUpdatePayload.backup.filename, /\.zip$/);
    const updaterArchive = unzipSync(Buffer.from(submittedUpdatePayload.backup.data_base64, "base64"));
    assert.ok(updaterArchive["manifest.json"]);
    assert.ok(updaterArchive["data/kernel.json"]);
    const job = await agent.get("/api/updater/jobs/job-kernel-1");
    assert.equal(job.body.state, "COMPLETED");
    assert.equal(update.body.update_available, true);
    assert.equal(update.body.repository_url, "https://github.com/psewdon1m-exocortex/kernel");

    const backup = await agent
      .get("/api/backup")
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    assert.equal(backup.status, 200);
    assert.match(backup.headers["content-type"], /^application\/zip/);
    assert.match(backup.headers["content-disposition"], /kernel-backup-\d{4}-\d{2}-\d{2}\.zip/);
    const backupArchive = unzipSync(new Uint8Array(backup.body));
    const backupManifest = JSON.parse(strFromU8(backupArchive["manifest.json"]));
    const backupData = backupArchive["data/kernel.json"];
    const backupPayload = JSON.parse(strFromU8(backupData));
    assert.equal(backupManifest.format, "exocortex-kernel-backup-archive");
    assert.equal(backupManifest.schema_version, 1);
    assert.equal(backupManifest.files["data/kernel.json"].uncompressed_bytes, backupData.byteLength);
    assert.equal(
      backupManifest.files["data/kernel.json"].sha256,
      createHash("sha256").update(backupData).digest("hex"),
    );
    const initialRegister = backupPayload.register.current;
    const current = await agent.get("/api/register");
    const kernelPort = current.body.entries.find((item) => item.key === "services.kernel.port");
    await agent
      .put(`/api/register/entries/${kernelPort.id}`)
      .send({ ...kernelPort, value: "19999" });

    const inspection = await agent
      .post("/api/backup/inspect")
      .attach("file", backup.body, {
        filename: "kernel-backup.zip",
        contentType: "application/zip",
      });
    assert.equal(inspection.status, 201);
    assert.equal(inspection.body.filename, "kernel-backup.zip");
    assert.equal(inspection.body.format, "exocortex-kernel-backup");

    const restored = await agent
      .post("/api/backup/restore")
      .send({ inspection_id: inspection.body.inspection_id });
    assert.equal(restored.status, 200);
    const after = await agent.get("/api/register");
    assert.equal(after.body.values["services.kernel.port"], initialRegister.values["services.kernel.port"]);
    assert.notEqual(after.body.revision, initialRegister.revision);

    const tamperedData = strToU8(JSON.stringify({ ...backupPayload, created_at: "tampered" }));
    const tamperedArchive = zipSync({
      "manifest.json": backupArchive["manifest.json"],
      "data/kernel.json": tamperedData,
    });
    const rejected = await agent
      .post("/api/backup/restore")
      .attach("file", Buffer.from(tamperedArchive), {
        filename: "tampered-kernel-backup.zip",
        contentType: "application/zip",
      });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error, /checksum/i);

    const legacy = await agent
      .post("/api/backup/restore")
      .attach("file", Buffer.from(JSON.stringify(backupPayload)), {
        filename: "legacy-kernel-backup.json",
        contentType: "application/json",
      });
    assert.equal(legacy.status, 200);
  });
});
