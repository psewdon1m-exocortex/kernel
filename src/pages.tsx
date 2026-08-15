import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";
import {
  ConfirmDialog,
  EntryForm,
  Modal,
  formatBytes,
  formatDate,
  shortHash,
} from "./components";
import type {
  AuditEvent,
  DocumentRevision,
  Metrics,
  RegisterEntry,
  RegisterSnapshot,
  RevisionSummary,
  UiSettings,
  UpdateCheck,
  UpdateJob,
  UpdaterStatus,
} from "./types";

type Notify = (message: string, kind?: "success" | "error" | "info") => void;

function PageStatus({ children }: { children: string }) {
  return <div className="page-status" role="status">{children}</div>;
}

type MetricId = "cpu" | "ram" | "disk" | "uptime";

const DEFAULT_METRIC_ORDER: MetricId[] = ["cpu", "ram", "disk", "uptime"];
const DASHBOARD_ORDER_KEY = "kernel.dashboard.metric-order.v1";

function readMetricOrder(): MetricId[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(DASHBOARD_ORDER_KEY) ?? "[]");
    if (
      Array.isArray(stored)
      && stored.length === DEFAULT_METRIC_ORDER.length
      && DEFAULT_METRIC_ORDER.every((id) => stored.includes(id))
    ) {
      return stored as MetricId[];
    }
  } catch {
    // Invalid browser state falls back to the canonical 2-by-2 layout.
  }
  return DEFAULT_METRIC_ORDER;
}

export function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics>();
  const [offline, setOffline] = useState(false);
  const [metricOrder, setMetricOrder] = useState<MetricId[]>(readMetricOrder);
  const [draggedMetric, setDraggedMetric] = useState<MetricId | null>(null);
  const [dragTarget, setDragTarget] = useState<MetricId | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const value = await api<Metrics>("/api/dashboard");
        if (active) {
          setMetrics(value);
          setOffline(false);
        }
      } catch {
        if (active) setOffline(true);
      }
    };
    void load();
    const timer = window.setInterval(load, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_ORDER_KEY, JSON.stringify(metricOrder));
  }, [metricOrder]);

  const cards: Record<MetricId, {
    title: string;
    value: string;
    percent?: number | null;
    rows: Array<[string, string]>;
  }> = {
    cpu: {
      title: "CPU",
      value: percent(metrics?.cpu.usage_percent),
      percent: metrics?.cpu.usage_percent,
      rows: [["Current usage", percent(metrics?.cpu.usage_percent)]],
    },
    ram: {
      title: "RAM",
      value: formatBytes(metrics?.ram.used_bytes),
      percent: ratioPercent(metrics?.ram.used_bytes, metrics?.ram.total_bytes),
      rows: [
        ["Used", formatBytes(metrics?.ram.used_bytes)],
        ["Free", formatBytes(metrics?.ram.free_bytes)],
        ["Total", formatBytes(metrics?.ram.total_bytes)],
      ],
    },
    disk: {
      title: "DISK",
      value: formatBytes(metrics?.disk.used_bytes),
      percent: ratioPercent(metrics?.disk.used_bytes, metrics?.disk.total_bytes),
      rows: [
        ["Used", formatBytes(metrics?.disk.used_bytes)],
        ["Free", formatBytes(metrics?.disk.free_bytes)],
        ["Total", formatBytes(metrics?.disk.total_bytes)],
      ],
    },
    uptime: {
      title: "UPTIME",
      value: formatDuration(metrics?.uptime_seconds),
      rows: [
        ["Current", formatDuration(metrics?.uptime_seconds)],
        ["Seconds", metrics?.uptime_seconds == null
          ? "N/A"
          : metrics.uptime_seconds.toLocaleString("en-US")],
      ],
    },
  };

  const moveMetric = (target: MetricId) => {
    if (!draggedMetric || draggedMetric === target) return;
    setMetricOrder((current) => {
      const next = [...current];
      const from = next.indexOf(draggedMetric);
      const to = next.indexOf(target);
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  };

  return (
    <section className="page-body">
      <div className={`system-line ${offline ? "is-error" : "is-healthy"}`}>
        <span>{offline ? "Local telemetry unavailable" : "Local VPS telemetry"}</span>
      </div>
      <div className="dashboard-grid" aria-label="System telemetry">
        {metricOrder.map((id) => (
          <MetricCard
            key={id}
            id={id}
            {...cards[id]}
            dragging={draggedMetric === id}
            dragTarget={dragTarget === id && draggedMetric !== id}
            onDragStart={(event) => {
              setDraggedMetric(id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", id);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragTarget(id);
            }}
            onDragLeave={() => {
              setDragTarget((current) => current === id ? null : current);
            }}
            onDrop={(event) => {
              event.preventDefault();
              moveMetric(id);
              setDragTarget(null);
            }}
            onDragEnd={() => {
              setDraggedMetric(null);
              setDragTarget(null);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function MetricCard({
  id,
  title,
  value,
  percent: valuePercent,
  rows,
  dragging,
  dragTarget,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  id: MetricId;
  title: string;
  value: string;
  percent?: number | null;
  rows: Array<[string, string]>;
  dragging: boolean;
  dragTarget: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <article
      className={`metric-card${dragging ? " is-dragging" : ""}${dragTarget ? " is-drag-target" : ""}`}
      data-dashboard-node={id}
      data-metric-id={id}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      aria-label={`${title} telemetry`}
    >
      <header><span>{title}</span><span className="drag-mark" title="Drag block" aria-hidden="true">:::</span></header>
      <strong className="metric-main">{value}</strong>
      {valuePercent != null && (
        <div className="meter" aria-label={`${title}: ${value}`}>
          <span style={{ width: `${Math.max(0, Math.min(100, valuePercent))}%` }} />
        </div>
      )}
      {rows.length > 0 && (
        <dl>
          {rows.map(([label, item]) => (
            <div key={label}><dt>{label}</dt><dd>{item}</dd></div>
          ))}
        </dl>
      )}
    </article>
  );
}

function percent(value: number | null | undefined) {
  return value == null ? "N/A" : `${value.toFixed(1)}%`;
}

function ratioPercent(used: number | null | undefined, total: number | null | undefined) {
  return used == null || total == null || total <= 0
    ? null
    : (used / total) * 100;
}

function formatLogDate(value: string | null | undefined) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(" ");
}

function formatDuration(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  const total = Math.max(0, Math.floor(value));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return days > 0
    ? `${days}d ${hours}h ${minutes}m`
    : `${hours}h ${minutes}m`;
}

export function DocumentPage({
  type,
}: {
  type: "overview" | "constitution";
}) {
  const [document, setDocument] = useState<DocumentRevision>();
  const [error, setError] = useState("");

  useEffect(() => {
    setDocument(undefined);
    setError("");
    api<DocumentRevision>(`/api/documents/${type}`)
      .then(setDocument)
      .catch((reason: Error) => setError(reason.message));
  }, [type]);

  if (error) return <PageStatus>{error}</PageStatus>;
  if (!document) return <PageStatus>Loading document...</PageStatus>;

  return (
    <section className="document-workspace">
      <div className="document-meta">
        <span>Revision {document.revision}</span>
        <span>SHA-256 {shortHash(document.checksum)}</span>
        <span>{formatDate(document.created_at)}</span>
      </div>
      <article className="markdown-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children, ...props }) => {
              const safe = !href || /^(https?:|mailto:|\/|#)/i.test(href);
              return safe
                ? <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer" {...props}>{children}</a>
                : <span>{children}</span>;
            },
          }}
        >
          {document.content ?? ""}
        </ReactMarkdown>
      </article>
    </section>
  );
}

export function RegisterPage({ notify }: { notify: Notify }) {
  const [snapshot, setSnapshot] = useState<RegisterSnapshot>();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<RegisterEntry | "new">();
  const [deleting, setDeleting] = useState<RegisterEntry>();
  const [pending, setPending] = useState(false);
  const [dragId, setDragId] = useState<string>();
  const [insert, setInsert] = useState<{ id: string; after: boolean }>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<RevisionSummary[]>([]);
  const [restore, setRestore] = useState<RevisionSummary>();

  const load = useCallback(() => {
    api<RegisterSnapshot>("/api/register")
      .then(setSnapshot)
      .catch((error: Error) => notify(error.message, "error"));
  }, [notify]);

  const loadVersions = useCallback(() => {
    api<{ versions: RevisionSummary[] }>("/api/register/versions")
      .then((result) => setVersions(result.versions))
      .catch((error: Error) => notify(error.message, "error"));
  }, [notify]);

  useEffect(load, [load]);

  const visible = useMemo(() => {
    const query = search.toLowerCase().trim();
    return (snapshot?.entries ?? []).filter((entry) => (
      !query || `${entry.key} ${entry.value} ${entry.description}`.toLowerCase().includes(query)
    ));
  }, [search, snapshot]);

  const saveEntry = async (input: { key: string; value: string; description: string }) => {
    setPending(true);
    try {
      const result = await api<RegisterSnapshot>(
        editing === "new" ? "/api/register/entries" : `/api/register/entries/${editing?.id}`,
        {
          method: editing === "new" ? "POST" : "PUT",
          body: JSON.stringify(input),
        },
      );
      setSnapshot(result);
      setEditing(undefined);
      notify(editing === "new" ? "Register entry added" : "Register entry updated");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setPending(false);
    }
  };

  const deleteEntry = async () => {
    if (!deleting) return;
    setPending(true);
    try {
      const result = await api<RegisterSnapshot>(`/api/register/entries/${deleting.id}`, {
        method: "DELETE",
      });
      setSnapshot(result);
      setDeleting(undefined);
      notify("Register entry deleted");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setPending(false);
    }
  };

  const commitOrder = async (targetId: string, after: boolean) => {
    if (!snapshot || !dragId || dragId === targetId) return;
    const ids = snapshot.entries.map((entry) => entry.id).filter((id) => id !== dragId);
    let index = ids.indexOf(targetId);
    if (after) index += 1;
    ids.splice(index, 0, dragId);
    setDragId(undefined);
    setInsert(undefined);
    try {
      const result = await api<RegisterSnapshot>("/api/register/order", {
        method: "PUT",
        body: JSON.stringify({ ids }),
      });
      setSnapshot(result);
      notify("Register order saved");
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const openHistory = () => {
    setHistoryOpen(true);
    loadVersions();
  };

  const restoreVersion = async () => {
    if (!restore) return;
    setPending(true);
    try {
      const result = await api<RegisterSnapshot>("/api/register/restore", {
        method: "POST",
        body: JSON.stringify({ revision: restore.revision }),
      });
      setSnapshot(result);
      setRestore(undefined);
      loadVersions();
      notify("Register restored as a new revision");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="page-body">
      <div className="register-toolbar">
        <label className="search-field">
          <span>Search</span>
          <input
            type="search"
            value={search}
            placeholder="key, value or description"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="revision-box">
          <span>Active revision</span>
          <strong>{snapshot?.revision ?? "Loading..."}</strong>
          <small>SHA-256 {shortHash(snapshot?.checksum)}</small>
        </div>
        <button type="button" className="primary-action" onClick={() => setEditing("new")}>
          Add value
        </button>
        <button type="button" onClick={openHistory}>
          Versions
        </button>
      </div>

      <div className="register-grid">
        {visible.map((entry) => (
          <article
            key={entry.id}
            className={`register-card ${insert?.id === entry.id ? (insert.after ? "insert-after" : "insert-before") : ""}`}
            draggable={!search}
            onDragStart={() => setDragId(entry.id)}
            onDragEnd={() => {
              setDragId(undefined);
              setInsert(undefined);
            }}
            onDragOver={(event) => {
              if (search) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              setInsert({ id: entry.id, after: event.clientY > rect.top + rect.height / 2 });
            }}
            onDrop={(event) => {
              event.preventDefault();
              void commitOrder(entry.id, insert?.after ?? false);
            }}
          >
            <header>
              <strong>{entry.key}</strong>
              <span className="drag-mark" title="Drag">⠿</span>
            </header>
            <code>{entry.value}</code>
            <p>{entry.description || "No description"}</p>
            <footer>
              <span>{formatDate(entry.updated_at)}</span>
              <div>
                <button type="button" onClick={() => setEditing(entry)}>Edit</button>
                <button type="button" className="danger-text" onClick={() => setDeleting(entry)}>Delete</button>
              </div>
            </footer>
          </article>
        ))}
        {snapshot && visible.length === 0 && (
          <div className="empty-state">No entries found.</div>
        )}
      </div>

      {editing && (
        <Modal
          title={editing === "new" ? "ADD REGISTER VALUE" : "EDIT REGISTER VALUE"}
          onClose={() => !pending && setEditing(undefined)}
        >
          <EntryForm
            initial={editing === "new" ? undefined : editing}
            pending={pending}
            onSubmit={(value) => void saveEntry(value)}
            onClose={() => setEditing(undefined)}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="DELETE REGISTER VALUE"
          message={`Register entry ${deleting.key} will be deleted.`}
          detail="A new Register revision will be created and the previous revision will remain in history."
          confirmLabel="Delete"
          pending={pending}
          onConfirm={() => void deleteEntry()}
          onClose={() => setDeleting(undefined)}
        />
      )}

      {historyOpen && (
        <Modal title="REGISTER VERSIONS" width={900} onClose={() => setHistoryOpen(false)}>
          <div className="version-list">
            {versions.map((version) => {
              const active = version.revision === snapshot?.revision;
              return (
                <div key={version.revision}>
                  <span className={active ? "active-tag" : ""}>
                    {active ? "ACTIVE" : version.reason.toUpperCase()}
                  </span>
                  <code>{version.revision}</code>
                  <span>{shortHash(version.checksum)}</span>
                  <time>{formatDate(version.created_at)}</time>
                  <button
                    type="button"
                    disabled={pending || active}
                    onClick={() => setRestore(version)}
                  >
                    Restore
                  </button>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {restore && (
        <ConfirmDialog
          title="RESTORE REGISTER"
          message={`Revision ${restore.revision} will be restored.`}
          detail="The current version will remain in history. Restore creates a new active immutable revision."
          confirmLabel="Restore"
          pending={pending}
          onConfirm={() => void restoreVersion()}
          onClose={() => setRestore(undefined)}
        />
      )}
    </section>
  );
}

export function SettingsPage({
  settings,
  onSettings,
  notify,
}: {
  settings: UiSettings;
  onSettings(settings: UiSettings): void;
  notify: Notify;
}) {
  const [draft, setDraft] = useState(settings);
  const [appearancePending, setAppearancePending] = useState(false);
  const [loggerPending, setLoggerPending] = useState(false);
  const [updatePending, setUpdatePending] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck>();
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus>();
  const [updateJob, setUpdateJob] = useState<UpdateJob>();
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [backupFile, setBackupFile] = useState<File>();
  const [backupPending, setBackupPending] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState({ current: "", next: "", repeat: "" });
  const [passwordPending, setPasswordPending] = useState(false);

  const loadAudit = useCallback(() => {
    api<{ events: AuditEvent[] }>("/api/audit?limit=100")
      .then((result) => setAudit(result.events))
      .catch((error: Error) => notify(error.message, "error"));
  }, [notify]);

  useEffect(loadAudit, [loadAudit]);

  const loadUpdaterStatus = useCallback(() => {
    api<UpdaterStatus>("/api/updater/status")
      .then(setUpdaterStatus)
      .catch((error: Error) => setUpdaterStatus({
        installed: false,
        available: false,
        status: "unavailable",
        service: "updater",
        message: error.message,
      }));
  }, []);

  useEffect(loadUpdaterStatus, [loadUpdaterStatus]);

  useEffect(() => {
    if (!updateJob || ["COMPLETED", "ROLLED_BACK", "FAILED", "ROLLBACK_FAILED"].includes(updateJob.state)) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      api<UpdateJob>(`/api/updater/jobs/${encodeURIComponent(updateJob.id)}`)
        .then(setUpdateJob)
        .catch((error: Error) => notify(error.message, "error"));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [notify, updateJob]);

  const saveAppearance = async (event: FormEvent) => {
    event.preventDefault();
    setAppearancePending(true);
    try {
      const value = await api<UiSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      onSettings(value);
      setDraft(value);
      notify("Appearance settings saved");
      loadAudit();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setAppearancePending(false);
    }
  };

  const setSidebarFixed = async (fixed: boolean) => {
    const previous = settings;
    const next = { ...settings, sidebar_auto_hide: !fixed };
    setDraft((current) => ({ ...current, sidebar_auto_hide: !fixed }));
    onSettings(next);
    setAppearancePending(true);
    try {
      const saved = await api<UiSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      onSettings(saved);
      setDraft((current) => ({ ...current, sidebar_auto_hide: saved.sidebar_auto_hide }));
      notify(fixed ? "Sidebar fixed on screen" : "Sidebar auto-hide enabled");
      loadAudit();
    } catch (error) {
      onSettings(previous);
      setDraft((current) => ({
        ...current,
        sidebar_auto_hide: previous.sidebar_auto_hide,
      }));
      notify((error as Error).message, "error");
    } finally {
      setAppearancePending(false);
    }
  };

  const setRevisionRequestLogging = async (enabled: boolean) => {
    const previous = settings;
    const next = { ...settings, revision_request_logging: enabled };
    setDraft((current) => ({ ...current, revision_request_logging: enabled }));
    onSettings(next);
    setLoggerPending(true);
    try {
      const saved = await api<UiSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      onSettings(saved);
      setDraft((current) => ({
        ...current,
        revision_request_logging: saved.revision_request_logging,
      }));
      notify(enabled ? "Revision request logging enabled" : "Revision request logging disabled");
      loadAudit();
    } catch (error) {
      onSettings(previous);
      setDraft((current) => ({
        ...current,
        revision_request_logging: previous.revision_request_logging,
      }));
      notify((error as Error).message, "error");
    } finally {
      setLoggerPending(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (password.next !== password.repeat) {
      notify("The new passwords do not match", "error");
      return;
    }
    setPasswordPending(true);
    try {
      await api("/api/settings/password", {
        method: "POST",
        body: JSON.stringify({
          current_password: password.current,
          new_password: password.next,
        }),
      });
      setPassword({ current: "", next: "", repeat: "" });
      notify("Operator password changed");
      loadAudit();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setPasswordPending(false);
    }
  };

  const checkForUpdates = async () => {
    setUpdatePending(true);
    try {
      const result = await api<UpdateCheck>("/api/updater/check", { method: "POST" });
      setUpdateCheck(result);
      notify(result.update_available ? "Kernel update is available" : "Kernel is up to date", "info");
      loadAudit();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setUpdatePending(false);
    }
  };

  const downloadPreUpdateBackup = async () => {
    const staged = await api<{ id: string; filename: string; download_url: string }>("/api/backups", {
      method: "POST",
    });
    const response = await fetch(staged.download_url, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Backup download failed with HTTP ${response.status}`);
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = disposition.match(/filename="?([^";]+)"?/)?.[1] ?? staged.filename;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return staged.id;
  };

  const installUpdate = async () => {
    if (!updateCheck?.available_version) return;
    setUpdatePending(true);
    try {
      const backupId = await downloadPreUpdateBackup();
      const job = await api<UpdateJob>("/api/updater/install", {
        method: "POST",
        body: JSON.stringify({ version: updateCheck.available_version, backup_id: backupId }),
      });
      setUpdateJob(job);
      setConfirmUpdate(false);
      notify("Backup downloaded and Kernel update job started", "info");
      loadAudit();
      loadUpdaterStatus();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setUpdatePending(false);
    }
  };

  const restoreBackup = async () => {
    if (!backupFile) return;
    const form = new FormData();
    form.append("file", backupFile);
    setBackupPending(true);
    try {
      await api("/api/backup/restore", { method: "POST", body: form });
      notify("Kernel backup restored");
      setBackupFile(undefined);
      if (backupInputRef.current) backupInputRef.current.value = "";
      window.location.reload();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBackupPending(false);
    }
  };

  return (
    <section className="settings-stack">
      <section className="settings-section">
        <header><h2>APPEARANCE</h2><span>Colors and primary navigation behavior</span></header>
        <form className="settings-content appearance-form" onSubmit={saveAppearance}>
          {(["dark", "light", "accent"] as const).map((name) => (
            <label key={name} className="color-row">
              <span>{name}</span>
              <input
                type="color"
                value={draft.colors[name]}
                onChange={(event) => setDraft({
                  ...draft,
                  colors: { ...draft.colors, [name]: event.target.value },
                })}
              />
              <input
                type="text"
                pattern="#[0-9a-fA-F]{6}"
                value={draft.colors[name]}
                onChange={(event) => setDraft({
                  ...draft,
                  colors: { ...draft.colors, [name]: event.target.value },
                })}
              />
            </label>
          ))}
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={!draft.sidebar_auto_hide}
              disabled={appearancePending}
              onChange={(event) => void setSidebarFixed(event.target.checked)}
            />
            <span>Keep sidebar fixed on screen</span>
          </label>
          <div className="row-actions">
            <button
              type="button"
              onClick={() => setDraft((current) => ({
                ...current,
                colors: { dark: "#000000", light: "#ffffff", accent: "#00a8ff" },
                sidebar_auto_hide: true,
              }))}
            >
              Reset
            </button>
            <button type="submit" disabled={appearancePending}>
              {appearancePending ? "Saving..." : "Save appearance"}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-section">
        <header><h2>DOCUMENTS</h2><span>Uploads and immutable revisions</span></header>
        <div className="settings-content document-managers">
          <DocumentManager type="overview" notify={notify} onChanged={loadAudit} />
          <DocumentManager type="constitution" notify={notify} onChanged={loadAudit} />
        </div>
      </section>

      <section className="settings-section">
        <header><h2>SECURITY</h2><span>Single-operator access</span></header>
        <form className="settings-content form-grid" onSubmit={changePassword}>
          <label><span>Current password</span><input type="password" autoComplete="current-password" required value={password.current} onChange={(event) => setPassword({ ...password, current: event.target.value })} /></label>
          <label><span>New password</span><input type="password" autoComplete="new-password" minLength={12} required value={password.next} onChange={(event) => setPassword({ ...password, next: event.target.value })} /></label>
          <label><span>Repeat new password</span><input type="password" autoComplete="new-password" minLength={12} required value={password.repeat} onChange={(event) => setPassword({ ...password, repeat: event.target.value })} /></label>
          <div className="row-actions"><button type="submit" disabled={passwordPending}>{passwordPending ? "Changing..." : "Change password"}</button></div>
        </form>
      </section>

      <section className="settings-section">
        <header><h2>BACKUP</h2><span>Export or restore the local Kernel state</span></header>
        <div className="settings-content backup-row">
          <p>The export includes documents, revisions, Register, Topology, settings and audit events.</p>
          <div className="backup-actions">
            <a className="button-link" href="/api/backup" download>Download backup</a>
            <label className={`button-link ${backupPending ? "is-disabled" : ""}`}>
              Restore backup
              <input
                ref={backupInputRef}
                hidden
                type="file"
                accept=".zip,application/zip,.json,application/json"
                disabled={backupPending}
                onChange={(event) => setBackupFile(event.target.files?.[0])}
              />
            </label>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <header><h2>UPDATER</h2><span>Operator-triggered release discovery</span></header>
        <div className="settings-content updater-settings">
          <p className="hint">
            Kernel reads repositories.kernel.url from Register and checks matching Kernel releases.
            The local updater downloads and verifies the release, replaces only this VPS container,
            checks health and rolls back on failure.
          </p>
          <div className={`updater-availability ${updaterStatus?.available ? "is-available" : "is-unavailable"}`} role="status">
            <strong>{updaterStatus?.available ? "UPDATER AVAILABLE" : "UPDATER NOT INSTALLED"}</strong>
            <span>
              {updaterStatus?.available
                ? `Local worker ${updaterStatus.version ?? ""}`.trim()
                : updaterStatus?.message ?? "Updater status is loading."}
            </span>
          </div>
          <button
            type="button"
            className="primary-action"
            disabled={updatePending}
            onClick={() => void checkForUpdates()}
          >
            {updatePending ? "Checking..." : "Check for updates"}
          </button>
          {updateCheck?.update_available && (
            <button
              type="button"
              className="primary-action"
              disabled={updatePending || !updaterStatus?.available}
              onClick={() => setConfirmUpdate(true)}
            >
              Install update
            </button>
          )}
          {updateCheck && (
            <div className="updater-result" role="status">
              <span>Installed</span><strong>{updateCheck.installed_version}</strong>
              <span>Available</span><strong>{updateCheck.available_version ?? "No published release"}</strong>
              <span>Status</span><strong>{updateCheck.update_available ? "UPDATE AVAILABLE" : "UP TO DATE"}</strong>
              {updateCheck.release_url && (
                <a href={updateCheck.release_url} target="_blank" rel="noreferrer">Open release notes</a>
              )}
            </div>
          )}
          {updateJob && (
            <div className="updater-job" role="status">
              <span>Job</span><strong>{updateJob.id}</strong>
              <span>State</span><strong>{updateJob.state}</strong>
              {updateJob.message && <p>{updateJob.message}</p>}
            </div>
          )}
        </div>
      </section>

      <section className="settings-section">
        <header className="logger-header">
          <h2>LOGGER</h2>
          <span>Recent operator and system actions</span>
          <a className="button-link logger-download" href="/api/logs/download" download>
            Download Logs Zip
          </a>
        </header>
        <div className="settings-content logger-settings">
          <label className="toggle-row logger-toggle">
            <input
              type="checkbox"
              checked={draft.revision_request_logging}
              disabled={loggerPending}
              onChange={(event) => void setRevisionRequestLogging(event.target.checked)}
            />
            <span>Log every internal-service revision request, including 304 Not Modified</span>
          </label>
          <p className="hint logger-limits">
            Retention is capped at {draft.audit_limits.max_entries.toLocaleString("en-US")} events,{" "}
            {draft.audit_limits.retention_days} days, or {formatBytes(draft.audit_limits.max_bytes)}
            {" "}on disk, whichever limit is reached first. Current stored log size:{" "}
            {formatBytes(draft.audit_limits.stored_bytes)}.
          </p>
          <div className="audit-list">
            {audit.map((event) => (
              <div key={event.id}>
                <span className={`audit-status is-${event.status}`}>{event.status}</span>
                <strong>{event.action}</strong>
                <span>{event.target}</span>
                <span>{event.actor}</span>
                <time dateTime={event.created_at}>{formatLogDate(event.created_at)}</time>
              </div>
            ))}
            {!audit.length && <p className="muted">The audit log is empty.</p>}
          </div>
        </div>
      </section>
      {backupFile && (
        <ConfirmDialog
          title="RESTORE KERNEL BACKUP"
          message={`Restore ${backupFile.name}?`}
          detail="Current state remains represented by immutable revisions where possible. Operator credentials are not replaced."
          confirmLabel="Restore"
          pending={backupPending}
          onConfirm={() => void restoreBackup()}
          onClose={() => {
            setBackupFile(undefined);
            if (backupInputRef.current) backupInputRef.current.value = "";
          }}
        />
      )}
      {confirmUpdate && updateCheck?.available_version && (
        <ConfirmDialog
          title="INSTALL KERNEL UPDATE"
          message={`Install Kernel ${updateCheck.available_version}?`}
          detail="A full backup will be downloaded first. The local updater will verify release checksums and the immutable image digest, preserve volumes, run health checks and automatically roll back on failure."
          confirmLabel="Download backup and install"
          pending={updatePending}
          onConfirm={() => void installUpdate()}
          onClose={() => setConfirmUpdate(false)}
        />
      )}
    </section>
  );
}

function DocumentManager({
  type,
  notify,
  onChanged,
}: {
  type: "overview" | "constitution";
  notify: Notify;
  onChanged(): void;
}) {
  const [versions, setVersions] = useState<DocumentRevision[]>([]);
  const [pending, setPending] = useState(false);
  const [restore, setRestore] = useState<DocumentRevision>();
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<{ versions: DocumentRevision[] }>(`/api/documents/${type}/versions`)
      .then((result) => setVersions(result.versions))
      .catch((error: Error) => notify(error.message, "error"));
  }, [notify, type]);

  useEffect(load, [load]);

  const upload = async (file?: File) => {
    if (!file) return;
    if (file.name.toLowerCase() !== `${type}.md`) {
      notify(`Expected a file named ${type}.md`, "error");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const data = new FormData();
    data.append("file", file);
    setPending(true);
    try {
      await api(`/api/documents/${type}/upload`, { method: "POST", body: data });
      notify(`${type}.md published`);
      load();
      onChanged();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const restoreVersion = async () => {
    if (!restore) return;
    setPending(true);
    try {
      await api(`/api/documents/${type}/restore`, {
        method: "POST",
        body: JSON.stringify({ revision: restore.revision }),
      });
      notify(`${type}.md restored as a new revision`);
      setRestore(undefined);
      load();
      onChanged();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="document-manager">
      <header>
        <div><strong>{type.toUpperCase()}</strong><span>{type}.md</span></div>
        <label className={`button-link ${pending ? "is-disabled" : ""}`}>
          {pending ? "Uploading..." : "Upload file"}
          <input
            ref={inputRef}
            hidden
            type="file"
            accept=".md,text/markdown,text/plain"
            disabled={pending}
            onChange={(event) => void upload(event.target.files?.[0])}
          />
        </label>
      </header>
      <div className="version-list">
        {versions.map((version, index) => (
          <div key={version.revision}>
            <span className={index === 0 ? "active-tag" : ""}>{index === 0 ? "ACTIVE" : version.reason.toUpperCase()}</span>
            <code>{version.revision}</code>
            <span>{shortHash(version.checksum)}</span>
            <time>{formatDate(version.created_at)}</time>
            <button type="button" disabled={pending || index === 0} onClick={() => setRestore(version)}>Restore</button>
          </div>
        ))}
      </div>
      {restore && (
        <ConfirmDialog
          title={`RESTORE ${type.toUpperCase()}`}
          message={`Revision ${restore.revision} will be restored.`}
          detail="The current version remains in history. Restore creates a new active immutable revision and can be reversed by another restore."
          confirmLabel="Restore"
          pending={pending}
          onConfirm={() => void restoreVersion()}
          onClose={() => setRestore(undefined)}
        />
      )}
    </section>
  );
}
