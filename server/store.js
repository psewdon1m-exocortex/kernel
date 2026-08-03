import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expandDottedValues, registerChecksum } from "./machine-contract.js";

function nowIso() {
  return new Date().toISOString();
}

function hashContent(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function revisionId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function documentRow(row, withContent = true) {
  if (!row) return null;
  return {
    revision: row.revision,
    type: row.document_type,
    checksum: row.checksum,
    actor: row.actor,
    reason: row.reason,
    source_revision: row.source_revision ?? null,
    created_at: row.created_at,
    ...(withContent ? { content: row.content } : {}),
  };
}

function topologyRow(row, withProject = true) {
  if (!row) return null;
  return {
    revision: row.revision,
    checksum: row.checksum,
    actor: row.actor,
    reason: row.reason,
    source_revision: row.source_revision ?? null,
    created_at: row.created_at,
    ...(withProject ? { project: JSON.parse(row.project_json) } : {}),
  };
}

function registerEntryRow(row) {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    description: row.description,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class KernelStore {
  constructor({
    dataDir,
    defaultsDir,
    initialPasswordHash,
    auditMaxEntries = 10000,
    auditRetentionDays = 30,
    auditMaxBytes = 64 * 1024 * 1024,
  }) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.dataDir = dataDir;
    this.defaultsDir = defaultsDir;
    this.dbPath = path.join(dataDir, "kernel.sqlite");
    this.auditMaxEntries = Math.max(100, Number(auditMaxEntries) || 10000);
    this.auditRetentionDays = Math.max(1, Number(auditRetentionDays) || 30);
    this.auditMaxBytes = Math.max(1024, Number(auditMaxBytes) || 64 * 1024 * 1024);
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.#createSchema();
    this.#ensureColumn("register_revisions", "source_revision", "TEXT");
    this.#ensureColumn("topology_revisions", "source_revision", "TEXT");
    this.#normalizeRegisterSnapshots();
    this.#seed(initialPasswordHash);
    this.#trimAudit();
  }

  #ensureColumn(table, column, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  #normalizeRegisterSnapshots() {
    const latest = this.db.prepare(`
      SELECT revision, snapshot_json
      FROM register_revisions
      ORDER BY id DESC LIMIT 1
    `).get();
    if (latest && !Array.isArray(JSON.parse(latest.snapshot_json).entries)) {
      this.#createRegisterSnapshot("system", "migration", latest.revision);
    }
  }

  #createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS document_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        revision TEXT NOT NULL UNIQUE,
        document_type TEXT NOT NULL CHECK(document_type IN ('overview', 'constitution')),
        content TEXT NOT NULL,
        checksum TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        source_revision TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS document_revision_type_idx
        ON document_revisions(document_type, id DESC);

      CREATE TABLE IF NOT EXISTS register_entries (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS register_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        revision TEXT NOT NULL UNIQUE,
        snapshot_json TEXT NOT NULL,
        checksum TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        source_revision TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topology_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        revision TEXT NOT NULL UNIQUE,
        project_json TEXT NOT NULL,
        checksum TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        source_revision TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        status TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  #seed(initialPasswordHash) {
    const setting = this.db.prepare("SELECT value FROM settings WHERE key = ?");
    const putSetting = this.db.prepare(
      "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)",
    );
    putSetting.run("admin_password_hash", initialPasswordHash);
    putSetting.run("auth_generation", "1");
    putSetting.run("theme_dark", "#000000");
    putSetting.run("theme_light", "#ffffff");
    putSetting.run("theme_accent", "#00a8ff");
    putSetting.run("sidebar_auto_hide", "true");
    putSetting.run("revision_request_logging", "true");

    for (const type of ["overview", "constitution"]) {
      const existing = this.db.prepare(
        "SELECT 1 AS present FROM document_revisions WHERE document_type = ? LIMIT 1",
      ).get(type);
      if (!existing) {
        const content = fs.readFileSync(
          path.join(this.defaultsDir, `${type}.md`),
          "utf8",
        );
        this.createDocumentRevision(type, content, "system", "initial");
      }
    }

    const topology = this.db.prepare(
      "SELECT 1 AS present FROM topology_revisions LIMIT 1",
    ).get();
    if (!topology) {
      const project = JSON.parse(fs.readFileSync(
        path.join(this.defaultsDir, "topology.onode.json"),
        "utf8",
      ));
      this.saveTopology(project, "system", "initial");
    }

    const registerRevision = this.db.prepare(
      "SELECT 1 AS present FROM register_revisions LIMIT 1",
    ).get();
    if (!registerRevision) {
      const timestamp = nowIso();
      const registerDefaults = JSON.parse(fs.readFileSync(
        path.join(this.defaultsDir, "register.json"),
        "utf8",
      ));
      const insert = this.db.prepare(`
        INSERT INTO register_entries
          (id, key, value, description, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      registerDefaults.forEach((entry, position) => insert.run(
        randomUUID(),
        entry.key,
        entry.value,
        entry.description ?? "",
        position,
        timestamp,
        timestamp,
      ));
      this.#createRegisterSnapshot("system", "initial");
    }

    if (!setting.get("admin_password_hash")) {
      throw new Error("Kernel password initialization failed");
    }
  }

  transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  getSetting(key) {
    return this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
  }

  setSetting(key, value) {
    this.db.prepare(`
      INSERT INTO settings(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  }

  getAuthGeneration() {
    return Number(this.getSetting("auth_generation") ?? 1);
  }

  getPasswordHash() {
    return this.getSetting("admin_password_hash");
  }

  changePasswordHash(nextHash, actor) {
    this.transaction(() => {
      this.setSetting("admin_password_hash", nextHash);
      this.setSetting("auth_generation", this.getAuthGeneration() + 1);
      this.audit(actor, "security.password.change", "operator", "success", {});
    });
    return this.getAuthGeneration();
  }

  getUiSettings() {
    return {
      colors: {
        dark: this.getSetting("theme_dark") ?? "#000000",
        light: this.getSetting("theme_light") ?? "#ffffff",
        accent: this.getSetting("theme_accent") ?? "#00a8ff",
      },
      sidebar_auto_hide: this.getSetting("sidebar_auto_hide") !== "false",
      revision_request_logging: this.getSetting("revision_request_logging") !== "false",
      audit_limits: {
        max_entries: this.auditMaxEntries,
        retention_days: this.auditRetentionDays,
        max_bytes: this.auditMaxBytes,
        stored_bytes: this.getAuditStoredBytes(),
      },
    };
  }

  updateUiSettings(settings, actor) {
    this.transaction(() => {
      this.setSetting("theme_dark", settings.colors.dark);
      this.setSetting("theme_light", settings.colors.light);
      this.setSetting("theme_accent", settings.colors.accent);
      this.setSetting("sidebar_auto_hide", settings.sidebar_auto_hide ? "true" : "false");
      this.setSetting("revision_request_logging", settings.revision_request_logging ? "true" : "false");
      this.audit(actor, "settings.update", "appearance", "success", settings);
    });
    return this.getUiSettings();
  }

  ensureManagedRegisterEntry(key, value, description) {
    const existing = this.db.prepare(
      "SELECT id, value, description FROM register_entries WHERE key = ?",
    ).get(key);
    if (existing) {
      return this.getRegisterSnapshot();
    }
    return this.upsertRegisterEntries([{ key, value, description }], "system");
  }

  getRegisterValue(key) {
    return this.db.prepare(
      "SELECT value FROM register_entries WHERE key = ?",
    ).get(key)?.value ?? null;
  }

  createDocumentRevision(type, content, actor, reason = "upload", sourceRevision = null) {
    const revision = revisionId(type);
    const checksum = hashContent(content);
    const createdAt = nowIso();
    this.db.prepare(`
      INSERT INTO document_revisions
        (revision, document_type, content, checksum, actor, reason, source_revision, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(revision, type, content, checksum, actor, reason, sourceRevision, createdAt);
    this.audit(actor, `document.${reason}`, type, "success", {
      revision,
      checksum,
      source_revision: sourceRevision,
    });
    return this.getDocument(type);
  }

  getDocument(type) {
    return documentRow(this.db.prepare(`
      SELECT * FROM document_revisions
      WHERE document_type = ?
      ORDER BY id DESC LIMIT 1
    `).get(type));
  }

  listDocumentVersions(type, limit = 100) {
    return this.db.prepare(`
      SELECT * FROM document_revisions
      WHERE document_type = ?
      ORDER BY id DESC LIMIT ?
    `).all(type, limit).map((row) => documentRow(row, false));
  }

  restoreDocument(type, revision, actor) {
    const source = this.db.prepare(`
      SELECT * FROM document_revisions
      WHERE document_type = ? AND revision = ?
    `).get(type, revision);
    if (!source) return null;
    return this.transaction(() => this.createDocumentRevision(
      type,
      source.content,
      actor,
      "restore",
      revision,
    ));
  }

  listRegisterEntries() {
    return this.db.prepare(`
      SELECT * FROM register_entries
      ORDER BY position ASC, key ASC
    `).all().map(registerEntryRow);
  }

  getRegisterSnapshot(includeEntries = true) {
    const row = this.db.prepare(`
      SELECT * FROM register_revisions
      ORDER BY id DESC LIMIT 1
    `).get();
    if (!row) return null;
    const snapshot = JSON.parse(row.snapshot_json);
    const values = snapshot.values ?? {};
    return {
      revision: row.revision,
      // Compatibility checksum for the operator/v0 API. The stable machine
      // contract has its own checksum over the nested v1 representation.
      checksum: hashContent(JSON.stringify({ values })),
      updated_at: row.created_at,
      values,
      ...(includeEntries ? { entries: this.listRegisterEntries() } : {}),
    };
  }

  getRegisterMachineSnapshot() {
    const row = this.db.prepare(`
      SELECT * FROM register_revisions
      ORDER BY id DESC LIMIT 1
    `).get();
    if (!row) return null;
    const stored = JSON.parse(row.snapshot_json);
    const values = expandDottedValues(stored.values ?? {});
    return {
      schema: "exocortex.register.snapshot.v1",
      revision: row.revision,
      checksum: registerChecksum(values),
      published_at: row.created_at,
      valid_until: null,
      values,
    };
  }

  #createRegisterSnapshot(actor, reason, sourceRevision = null) {
    const entries = this.listRegisterEntries();
    const values = Object.fromEntries(
      [...entries]
        .sort((left, right) => (
          left.key < right.key ? -1 : left.key > right.key ? 1 : 0
        ))
        .map((entry) => [entry.key, entry.value]),
    );
    const machineValues = expandDottedValues(values);
    const snapshotJson = JSON.stringify({ values, entries });
    const checksum = registerChecksum(machineValues);
    const revision = revisionId("register");
    const createdAt = nowIso();
    this.db.prepare(`
      INSERT INTO register_revisions
        (revision, snapshot_json, checksum, actor, reason, source_revision, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(revision, snapshotJson, checksum, actor, reason, sourceRevision, createdAt);
    this.audit(actor, `register.${reason}`, "register", "success", {
      revision,
      checksum,
      source_revision: sourceRevision,
      entry_count: entries.length,
    });
    return this.getRegisterSnapshot();
  }

  createRegisterEntry(input, actor) {
    return this.transaction(() => {
      const position = Number(this.db.prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM register_entries",
      ).get().next);
      const timestamp = nowIso();
      const id = randomUUID();
      this.db.prepare(`
        INSERT INTO register_entries
          (id, key, value, description, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.key, input.value, input.description, position, timestamp, timestamp);
      return this.#createRegisterSnapshot(actor, "create");
    });
  }

  upsertRegisterEntries(inputs, actor) {
    return this.transaction(() => {
      const timestamp = nowIso();
      let nextPosition = Number(this.db.prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM register_entries",
      ).get().next);
      const find = this.db.prepare("SELECT id FROM register_entries WHERE key = ?");
      const update = this.db.prepare(`
        UPDATE register_entries
        SET value = ?, description = ?, updated_at = ?
        WHERE key = ?
      `);
      const insert = this.db.prepare(`
        INSERT INTO register_entries
          (id, key, value, description, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const input of inputs) {
        if (find.get(input.key)) {
          update.run(input.value, input.description, timestamp, input.key);
        } else {
          insert.run(
            randomUUID(),
            input.key,
            input.value,
            input.description,
            nextPosition,
            timestamp,
            timestamp,
          );
          nextPosition += 1;
        }
      }
      return this.#createRegisterSnapshot(actor, "batch-upsert");
    });
  }

  updateRegisterEntry(id, input, actor) {
    return this.transaction(() => {
      const result = this.db.prepare(`
        UPDATE register_entries
        SET key = ?, value = ?, description = ?, updated_at = ?
        WHERE id = ?
      `).run(input.key, input.value, input.description, nowIso(), id);
      if (Number(result.changes) === 0) return null;
      return this.#createRegisterSnapshot(actor, "update");
    });
  }

  deleteRegisterEntry(id, actor) {
    return this.transaction(() => {
      const result = this.db.prepare(
        "DELETE FROM register_entries WHERE id = ?",
      ).run(id);
      if (Number(result.changes) === 0) return null;
      const entries = this.listRegisterEntries();
      const update = this.db.prepare(
        "UPDATE register_entries SET position = ? WHERE id = ?",
      );
      entries.forEach((entry, index) => update.run(index, entry.id));
      return this.#createRegisterSnapshot(actor, "delete");
    });
  }

  reorderRegisterEntries(ids, actor) {
    const existing = this.listRegisterEntries().map((entry) => entry.id);
    if (ids.length !== existing.length || new Set(ids).size !== ids.length) {
      throw new Error("Order must include every Register entry exactly once");
    }
    if (ids.some((id) => !existing.includes(id))) {
      throw new Error("Order contains an unknown Register entry");
    }
    return this.transaction(() => {
      const update = this.db.prepare(
        "UPDATE register_entries SET position = ?, updated_at = ? WHERE id = ?",
      );
      const timestamp = nowIso();
      ids.forEach((id, index) => update.run(index, timestamp, id));
      return this.#createRegisterSnapshot(actor, "reorder");
    });
  }

  listRegisterVersions(limit = 100) {
    return this.db.prepare(`
      SELECT revision, checksum, actor, reason, source_revision, created_at
      FROM register_revisions ORDER BY id DESC LIMIT ?
    `).all(limit);
  }

  restoreRegister(revision, actor) {
    const source = this.db.prepare(`
      SELECT * FROM register_revisions WHERE revision = ?
    `).get(revision);
    if (!source) return null;
    const snapshot = JSON.parse(source.snapshot_json);
    const values = snapshot.values ?? {};
    const timestamp = nowIso();
    const entries = Array.isArray(snapshot.entries)
      ? snapshot.entries
      : Object.entries(values).map(([key, value], position) => ({
        id: randomUUID(),
        key,
        value,
        description: "",
        position,
        created_at: timestamp,
        updated_at: timestamp,
      }));
    return this.transaction(() => {
      this.db.exec("DELETE FROM register_entries");
      const insert = this.db.prepare(`
        INSERT INTO register_entries
          (id, key, value, description, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      entries.forEach((entry, position) => insert.run(
        entry.id || randomUUID(),
        entry.key,
        entry.value,
        entry.description ?? "",
        position,
        entry.created_at ?? timestamp,
        entry.updated_at ?? timestamp,
      ));
      return this.#createRegisterSnapshot(actor, "restore", revision);
    });
  }

  getTopology() {
    return topologyRow(this.db.prepare(`
      SELECT * FROM topology_revisions ORDER BY id DESC LIMIT 1
    `).get());
  }

  saveTopology(project, actor, reason = "save") {
    const projectJson = JSON.stringify(project);
    const checksum = hashContent(projectJson);
    const latest = this.db.prepare(`
      SELECT checksum FROM topology_revisions ORDER BY id DESC LIMIT 1
    `).get();
    if (latest?.checksum === checksum) return this.getTopology();
    const revision = revisionId("topology");
    const createdAt = nowIso();
    this.db.prepare(`
      INSERT INTO topology_revisions
        (revision, project_json, checksum, actor, reason, source_revision, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(revision, projectJson, checksum, actor, reason, null, createdAt);
    this.audit(actor, "topology.save", "topology", "success", {
      revision,
      checksum,
      nodes: project.nodes.length,
      connections: project.connections.length,
    });
    return this.getTopology();
  }

  listTopologyVersions(limit = 100) {
    return this.db.prepare(`
      SELECT revision, checksum, actor, reason, source_revision, created_at
      FROM topology_revisions ORDER BY id DESC LIMIT ?
    `).all(limit);
  }

  restoreTopology(revision, actor) {
    const source = this.db.prepare(`
      SELECT * FROM topology_revisions WHERE revision = ?
    `).get(revision);
    if (!source) return null;
    const project = JSON.parse(source.project_json);
    const projectJson = JSON.stringify(project);
    const checksum = hashContent(projectJson);
    const restoredRevision = revisionId("topology");
    const createdAt = nowIso();
    return this.transaction(() => {
      this.db.prepare(`
        INSERT INTO topology_revisions
          (revision, project_json, checksum, actor, reason, source_revision, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        restoredRevision,
        projectJson,
        checksum,
        actor,
        "restore",
        revision,
        createdAt,
      );
      this.audit(actor, "topology.restore", "topology", "success", {
        revision: restoredRevision,
        checksum,
        source_revision: revision,
        nodes: project.nodes.length,
        connections: project.connections.length,
      });
      return this.getTopology();
    });
  }

  audit(actor, action, target, status, details = {}) {
    this.db.prepare(`
      INSERT INTO audit_events
        (event_id, actor, action, target, status, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      actor,
      action,
      target,
      status,
      JSON.stringify(details),
      nowIso(),
    );
    this.#trimAudit();
  }

  #trimAudit() {
    const cutoff = new Date(
      Date.now() - this.auditRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.db.prepare("DELETE FROM audit_events WHERE created_at < ?").run(cutoff);
    this.db.prepare(`
      DELETE FROM audit_events
      WHERE id NOT IN (
        SELECT id FROM audit_events ORDER BY id DESC LIMIT ?
      )
    `).run(this.auditMaxEntries);
    this.db.prepare(`
      WITH event_sizes AS (
        SELECT
          id,
          128
            + length(CAST(event_id AS BLOB))
            + length(CAST(actor AS BLOB))
            + length(CAST(action AS BLOB))
            + length(CAST(target AS BLOB))
            + length(CAST(status AS BLOB))
            + length(CAST(details_json AS BLOB))
            + length(CAST(created_at AS BLOB)) AS stored_bytes
        FROM audit_events
      ),
      newest_first AS (
        SELECT
          id,
          SUM(stored_bytes) OVER (ORDER BY id DESC) AS cumulative_bytes
        FROM event_sizes
      )
      DELETE FROM audit_events
      WHERE id IN (
        SELECT id FROM newest_first WHERE cumulative_bytes > ?
      )
    `).run(this.auditMaxBytes);
  }

  getAuditStoredBytes() {
    return Number(this.db.prepare(`
      SELECT COALESCE(SUM(
        128
          + length(CAST(event_id AS BLOB))
          + length(CAST(actor AS BLOB))
          + length(CAST(action AS BLOB))
          + length(CAST(target AS BLOB))
          + length(CAST(status AS BLOB))
          + length(CAST(details_json AS BLOB))
          + length(CAST(created_at AS BLOB))
      ), 0) AS stored_bytes
      FROM audit_events
    `).get()?.stored_bytes ?? 0);
  }

  listAudit(limit = 200) {
    return this.db.prepare(`
      SELECT event_id, actor, action, target, status, details_json, created_at
      FROM audit_events ORDER BY id DESC LIMIT ?
    `).all(limit).map((row) => ({
      id: row.event_id,
      actor: row.actor,
      action: row.action,
      target: row.target,
      status: row.status,
      details: JSON.parse(row.details_json),
      created_at: row.created_at,
    }));
  }

  exportAudit() {
    return {
      limits: {
        max_entries: this.auditMaxEntries,
        retention_days: this.auditRetentionDays,
        max_bytes: this.auditMaxBytes,
        stored_bytes: this.getAuditStoredBytes(),
      },
      events: this.listAudit(this.auditMaxEntries),
    };
  }

  exportBackup() {
    return {
      format: "exocortex-kernel-backup",
      version: 2,
      created_at: nowIso(),
      documents: {
        overview: this.listDocumentVersions("overview", 10000).map((item) => {
          const row = this.db.prepare(
            "SELECT * FROM document_revisions WHERE revision = ?",
          ).get(item.revision);
          return documentRow(row);
        }),
        constitution: this.listDocumentVersions("constitution", 10000).map((item) => {
          const row = this.db.prepare(
            "SELECT * FROM document_revisions WHERE revision = ?",
          ).get(item.revision);
          return documentRow(row);
        }),
      },
      register: {
        current: this.getRegisterSnapshot(),
        versions: this.listRegisterVersions(10000),
      },
      topology: this.getTopology(),
      settings: this.getUiSettings(),
      audit: this.listAudit(this.auditMaxEntries),
    };
  }

  importBackup(backup, actor) {
    if (
      !backup
      || backup.format !== "exocortex-kernel-backup"
      || ![1, 2].includes(Number(backup.version))
    ) {
      throw Object.assign(new Error("Unsupported Kernel backup format"), { status: 400 });
    }
    const overview = backup.documents?.overview?.[0];
    const constitution = backup.documents?.constitution?.[0];
    const registerEntries = backup.register?.current?.entries;
    const topology = backup.topology?.project;
    if (
      typeof overview?.content !== "string"
      || typeof constitution?.content !== "string"
      || !Array.isArray(registerEntries)
      || !topology
    ) {
      throw Object.assign(new Error("Kernel backup is incomplete"), { status: 400 });
    }

    return this.transaction(() => {
      this.createDocumentRevision(
        "overview",
        overview.content,
        actor,
        "backup-restore",
        overview.revision ?? null,
      );
      this.createDocumentRevision(
        "constitution",
        constitution.content,
        actor,
        "backup-restore",
        constitution.revision ?? null,
      );

      this.db.exec("DELETE FROM register_entries");
      const timestamp = nowIso();
      const insert = this.db.prepare(`
        INSERT INTO register_entries
          (id, key, value, description, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      registerEntries.forEach((entry, position) => {
        if (typeof entry?.key !== "string" || typeof entry?.value !== "string") {
          throw Object.assign(
            new Error("Kernel backup contains an invalid Register entry"),
            { status: 400 },
          );
        }
        insert.run(
          randomUUID(),
          entry.key,
          entry.value,
          String(entry.description ?? ""),
          position,
          timestamp,
          timestamp,
        );
      });
      this.#createRegisterSnapshot(
        actor,
        "backup-restore",
        backup.register?.current?.revision ?? null,
      );
      this.saveTopology(topology, actor, "backup-restore");

      const settings = backup.settings;
      if (settings?.colors) {
        for (const [key, value] of Object.entries({
          theme_dark: settings.colors.dark,
          theme_light: settings.colors.light,
          theme_accent: settings.colors.accent,
        })) {
          if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
            throw Object.assign(new Error("Kernel backup contains invalid UI settings"), { status: 400 });
          }
          this.setSetting(key, value.toLowerCase());
        }
        this.setSetting("sidebar_auto_hide", settings.sidebar_auto_hide ? "true" : "false");
        this.setSetting(
          "revision_request_logging",
          settings.revision_request_logging ? "true" : "false",
        );
      }
      this.audit(actor, "backup.restore", "kernel", "success", {
        backup_created_at: backup.created_at ?? null,
      });
      return {
        restored: true,
        restored_at: nowIso(),
        register_revision: this.getRegisterSnapshot(false).revision,
      };
    });
  }
}

export { hashContent };
