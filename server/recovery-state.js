import { createHash } from "node:crypto";
import { expandDottedValues, registerChecksum } from "./machine-contract.js";

const TABLES = {
  document_revisions: ["id", "revision", "document_type", "content", "checksum", "actor", "reason", "source_revision", "created_at"],
  register_entries: ["id", "key", "value", "description", "position", "created_at", "updated_at"],
  register_revisions: ["id", "revision", "snapshot_json", "checksum", "actor", "reason", "source_revision", "created_at"],
  topology_revisions: ["id", "revision", "project_json", "checksum", "actor", "reason", "source_revision", "created_at"],
  audit_events: ["id", "event_id", "actor", "action", "target", "status", "details_json", "created_at"],
};
const SETTINGS = new Set(["theme_dark", "theme_light", "theme_accent", "sidebar_auto_hide",
  "revision_request_logging", "navigation_order", "dashboard_order", "settings_order", "volt_url"]);
const hash = (text) => "sha256:" + createHash("sha256").update(text).digest("hex");
const invalid = (message) => Object.assign(new Error(message), { status: 400, code: "BACKUP_STATE_INVALID" });

export function exportRecoveryState(db) {
  const tables = {};
  for (const [table, columns] of Object.entries(TABLES)) {
    const rows = db.prepare("SELECT " + columns.join(",") + " FROM " + table + " ORDER BY id LIMIT 200001").all();
    if (rows.length > 200000) throw invalid("Recovery table exceeds the supported record limit");
    tables[table] = rows;
  }
  const settings = db.prepare("SELECT key,value FROM settings ORDER BY key").all().filter((row) => SETTINGS.has(row.key));
  return { schema: "exocortex.kernel.recovery-state.v1", tables, settings };
}

export function importRecoveryState(store, state, actor, registerValidator) {
  if (state?.schema !== "exocortex.kernel.recovery-state.v1" || !state.tables || !Array.isArray(state.settings)) throw invalid("Missing authoritative recovery state");
  if (Object.keys(state.tables).length !== Object.keys(TABLES).length) throw invalid("Unexpected recovery tables");
  for (const [table, columns] of Object.entries(TABLES)) {
    const rows = state.tables[table];
    if (!Array.isArray(rows) || rows.length > 200000) throw invalid("Invalid recovery table");
    for (const row of rows) {
      if (!row || columns.some((column) => !Object.hasOwn(row, column)) || Object.keys(row).some((key) => !columns.includes(key))) throw invalid("Invalid recovery row");
      if (Object.values(row).some((value) => value !== null && typeof value !== "string" && typeof value !== "number")) throw invalid("Invalid recovery cell");
    }
  }
  if (!state.tables.document_revisions.some((row) => row.document_type === "overview")
    || !state.tables.document_revisions.some((row) => row.document_type === "constitution")
    || !state.tables.register_revisions.length || !state.tables.topology_revisions.length) throw invalid("Incomplete recovery history");
  for (const row of state.tables.document_revisions) if (hash(row.content) !== row.checksum) throw invalid("Document checksum mismatch");
  for (const row of state.tables.topology_revisions) {
    JSON.parse(row.project_json);
    if (hash(row.project_json) !== row.checksum) throw invalid("Topology checksum mismatch");
  }
  for (const row of state.tables.register_entries) if (row.value !== "") registerValidator?.(row);
  for (const row of state.tables.register_revisions) {
    const snapshot = JSON.parse(row.snapshot_json);
    if (!Array.isArray(snapshot.entries)) throw invalid("Missing Register history entries");
    for (const entry of snapshot.entries) if (entry.value !== "") registerValidator?.(entry);
    const values = expandDottedValues(Object.fromEntries(snapshot.entries.map((entry) => [entry.key, entry.value])));
    if (registerChecksum(values) !== row.checksum) throw invalid("Register checksum mismatch");
  }
  for (const row of state.tables.audit_events) JSON.parse(row.details_json);
  const seen = new Set();
  for (const row of state.settings) {
    if (!SETTINGS.has(row.key) || typeof row.value !== "string" || seen.has(row.key)) throw invalid("Unsafe or duplicate recovery setting");
    seen.add(row.key);
    if (row.key.endsWith("_order") && !Array.isArray(JSON.parse(row.value))) throw invalid("Invalid interface order");
    if (row.key === "volt_url" && row.value) {
      const url = new URL(row.value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw invalid("Invalid Volt bootstrap origin");
    }
  }
  return store.transaction(() => {
    for (const table of Object.keys(TABLES)) store.db.exec("DELETE FROM " + table);
    for (const [table, columns] of Object.entries(TABLES)) {
      const insert = store.db.prepare("INSERT INTO " + table + "(" + columns.join(",") + ") VALUES(" + columns.map(() => "?").join(",") + ")");
      for (const row of state.tables[table]) insert.run(...columns.map((column) => row[column]));
    }
    for (const key of SETTINGS) store.db.prepare("DELETE FROM settings WHERE key=?").run(key);
    for (const row of state.settings) store.setSetting(row.key, row.value);
    store.setSetting("auth_generation", store.getAuthGeneration() + 1);
    if (store.db.prepare("PRAGMA foreign_key_check").all().length) throw invalid("Recovery violated database integrity");
    store.audit(actor, "backup.restore", "kernel", "success", { profile: state.schema });
    return { restored: true, restored_at: new Date().toISOString(), register_revision: store.getRegisterSnapshot(false).revision };
  });
}
