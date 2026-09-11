import { SelfUpdateButton } from "./SelfUpdateButton.js";
import { pendingAgentJob, waitForAgentJob, type AgentJob } from "./agent-job";
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
  BackupInspection,
  DashboardCardId,
  DashboardMetric,
  DocumentRevision,
  Metrics,
  NeptuneAvailability,
  RegisterEntry,
  RegisterSnapshot,
  RevisionSummary,
  SettingsSection,
  ServiceId,
  ServiceStatus,
  ServiceStatusSnapshot,
  UiSettings,
  UpdateCheck,
  UpdateJob,
  UpdaterStatus,
} from "./types";

type Notify = (message: string, kind?: "success" | "error" | "info") => void;
type SettingsSaver = (settings: UiSettings, message?: string) => void | Promise<UiSettings>;
type VoltConnectionSettings = { url: string; token_configured: boolean };

function PageStatus({ children }: { children: string }) {
  return <div className="page-status" role="status">{children}</div>;
}

export function DashboardPage({ settings, onSettings, notify }: {
  settings: UiSettings;
  onSettings: SettingsSaver;
  notify: Notify;
}) {
  const [metrics, setMetrics] = useState<Metrics>();
  const [serviceSnapshot, setServiceSnapshot] = useState<ServiceStatusSnapshot>();
  const [offline, setOffline] = useState(false);
  const [servicesOffline, setServicesOffline] = useState(false);
  const [draggedCard, setDraggedCard] = useState<DashboardCardId | null>(null);
  const [dragTarget, setDragTarget] = useState<DashboardCardId | null>(null);

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
    let active = true;
    const load = async () => {
      try {
        const value = await api<ServiceStatusSnapshot>("/api/service-statuses");
        if (active) {
          setServiceSnapshot(value);
          setServicesOffline(false);
        }
      } catch {
        if (active) setServicesOffline(true);
      }
    };
    void load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const cards: Record<DashboardMetric, {
    title: string;
    value: string;
    percent?: number | null;
  }> = {
    cpu: {
      title: "CPU Usage",
      value: metrics
        ? `${percent(metrics.cpu.usage_percent)}  -  cores: ${metrics.cpu.cores}`
        : "Loading...",
      percent: metrics?.cpu.usage_percent,
    },
    ram: {
      title: "RAM Usage",
      value: metrics
        ? `${percent(metrics.ram.percent)}  -  ${formatBytes(metrics.ram.used_bytes)}/${formatBytes(metrics.ram.total_bytes)}`
        : "Loading...",
      percent: ratioPercent(metrics?.ram.used_bytes, metrics?.ram.total_bytes),
    },
    disk: {
      title: "Disk Usage",
      value: metrics
        ? `${percent(metrics.disk.percent)}  -  ${formatBytes(metrics.disk.used_bytes)}/${formatBytes(metrics.disk.total_bytes)}`
        : "Loading...",
      percent: ratioPercent(metrics?.disk.used_bytes, metrics?.disk.total_bytes),
    },
    uptime: {
      title: "Uptime",
      value: metrics ? `Active: ${formatDuration(metrics.uptime_seconds)}` : "Loading...",
    },
  };

  const serviceById = new Map(serviceSnapshot?.services.map((service) => [service.id, service]) ?? []);

  const cardTitle = (id: DashboardCardId) => id.startsWith("service-")
    ? SERVICE_CARDS.find((item) => item.cardId === id)?.name ?? id
    : cards[id as DashboardMetric].title;

  const moveCard = (source: DashboardCardId, target: DashboardCardId) => {
    if (source === target) return;
    const nextOrder = [...settings.presentation.dashboard_order];
    const from = nextOrder.indexOf(source);
    const to = nextOrder.indexOf(target);
    [nextOrder[from], nextOrder[to]] = [nextOrder[to], nextOrder[from]];
    void onSettings({
      ...settings,
      presentation: { ...settings.presentation, dashboard_order: nextOrder },
    }, "Dashboard order saved");
  };

  const moveByKeyboard = (id: DashboardCardId, delta: -1 | 1) => {
    const order = settings.presentation.dashboard_order;
    const index = order.indexOf(id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    moveCard(id, order[target]);
    notify(`${cardTitle(id)} moved to position ${target + 1}`, "info");
  };

  return (
    <section className="page-body">
      <span className="sr-only" role="status">
        {offline ? "Local telemetry unavailable" : "Local VPS telemetry available"}
        {servicesOffline ? "; service availability unavailable" : "; service availability loaded"}
      </span>
      <div className="dashboard-grid" aria-label="System telemetry and service availability">
        {settings.presentation.dashboard_order.map((id, index) => {
          const interaction = {
            dragging: draggedCard === id,
            dragTarget: dragTarget === id && draggedCard !== id,
            onDragStart: (event) => {
              setDraggedCard(id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", id);
            },
            onDragOver: (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragTarget(id);
            },
            onDragLeave: () => {
              setDragTarget((current) => current === id ? null : current);
            },
            onDrop: (event) => {
              event.preventDefault();
              if (draggedCard) moveCard(draggedCard, id);
              setDragTarget(null);
            },
            onDragEnd: () => {
              setDraggedCard(null);
              setDragTarget(null);
            },
            onMove: (delta) => moveByKeyboard(id, delta),
          } satisfies DashboardCardInteractions;
          if (id.startsWith("service-")) {
            const serviceId = id.slice("service-".length) as ServiceId;
            const metadata = SERVICE_CARDS.find((item) => item.id === serviceId)!;
            return (
              <ServiceStatusCard
                key={id}
                id={id}
                ordinal={index + 1}
                name={metadata.name}
                service={serviceById.get(serviceId)}
                {...interaction}
              />
            );
          }
          const metricId = id as DashboardMetric;
          return (
            <MetricCard
              key={id}
              id={metricId}
              ordinal={index + 1}
              {...cards[metricId]}
              {...interaction}
            />
          );
        })}
      </div>
    </section>
  );
}

const SERVICE_CARDS: Array<{ id: ServiceId; cardId: DashboardCardId; name: string }> = [
  { id: "kernel", cardId: "service-kernel", name: "KERNEL" },
  { id: "chronos", cardId: "service-chronos", name: "Chronos" },
  { id: "perimetr", cardId: "service-perimetr", name: "Perimetr" },
  { id: "saturn", cardId: "service-saturn", name: "Saturn" },
  { id: "laboratory", cardId: "service-laboratory", name: "Laboratory" },
  { id: "volt", cardId: "service-volt", name: "Volt" },
];

interface DashboardCardInteractions {
  dragging: boolean;
  dragTarget: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onMove: (delta: -1 | 1) => void;
}

function MetricCard({
  id,
  ordinal,
  title,
  value,
  percent: valuePercent,
  dragging,
  dragTarget,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMove,
}: {
  id: DashboardCardId;
  ordinal: number;
  title: string;
  value: string;
  percent?: number | null;
  dragging: boolean;
  dragTarget: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  return (
    <article
      className={`metric-card${dragging ? " is-dragging" : ""}${dragTarget ? " is-drag-target" : ""}`}
      data-dashboard-node={id}
      data-metric-id={id}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      aria-label={`${title} telemetry`}
    >
      <span className="metric-ordinal">{String(ordinal).padStart(2, "0")}</span>
      <div className="metric-copy">
        <h2>{title}</h2>
        <strong className="metric-main">{value}</strong>
      </div>
        <button
          type="button"
          className="drag-mark"
          draggable
          title="Drag, or use Ctrl+Arrow Left/Right to reorder"
          aria-label={`Reorder ${title}`}
          onDragStart={onDragStart}
          onKeyDown={(event) => {
            if (event.ctrlKey && event.key === "ArrowLeft") {
              event.preventDefault();
              onMove(-1);
            } else if (event.ctrlKey && event.key === "ArrowRight") {
              event.preventDefault();
              onMove(1);
            }
          }}
        ><span aria-hidden="true" /></button>
      {valuePercent != null && (
        <div className="meter" aria-label={`${title}: ${value}`}>
          <span style={{ width: `${Math.max(0, Math.min(100, valuePercent))}%` }} />
        </div>
      )}
    </article>
  );
}

function ServiceStatusCard({
  id,
  ordinal,
  name,
  service,
  dragging,
  dragTarget,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMove,
}: {
  id: DashboardCardId;
  ordinal: number;
  name: string;
  service?: ServiceStatus;
} & DashboardCardInteractions) {
  const status = service?.status ?? "unknown";
  const edge = service?.checks.edge;
  const readiness = service?.checks.readiness;
  const readinessLabel = readiness?.level === "liveness" ? "LIVE" : "READY";
  return (
    <article
      className={`metric-card service-status-card status-${status}${dragging ? " is-dragging" : ""}${dragTarget ? " is-drag-target" : ""}`}
      data-dashboard-node={id}
      data-service-id={service?.id ?? id.slice("service-".length)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      aria-label={`${name} availability: ${status}`}
    >
      <span className="metric-ordinal">{String(ordinal).padStart(2, "0")}</span>
      <div className="metric-copy service-status-copy">
        <div className="service-status-heading">
          <h2>{name}</h2>
          <strong className="service-state"><span aria-hidden="true" />{status.toUpperCase()}</strong>
        </div>
        <p className="service-host">{service?.hostname ?? "Endpoint is not configured"}</p>
        <div className="service-checks">
          <span>EDGE <strong className={`check-${edge?.state ?? "unknown"}`}>{(edge?.state ?? "unknown").toUpperCase()}</strong></span>
          <span>{readinessLabel} <strong className={`check-${readiness?.state ?? "unknown"}`}>{(readiness?.state ?? "unknown").toUpperCase()}</strong></span>
          {edge?.latency_ms != null && <span>{edge.latency_ms} ms</span>}
          <span>{service?.checked_at ? `CHECKED ${formatServiceTime(service.checked_at)}` : "WAITING FOR CHECK"}</span>
        </div>
      </div>
      <button
        type="button"
        className="drag-mark"
        draggable
        title="Drag, or use Ctrl+Arrow Left/Right to reorder"
        aria-label={`Reorder ${name}`}
        onDragStart={onDragStart}
        onKeyDown={(event) => {
          if (event.ctrlKey && event.key === "ArrowLeft") {
            event.preventDefault();
            onMove(-1);
          } else if (event.ctrlKey && event.key === "ArrowRight") {
            event.preventDefault();
            onMove(1);
          }
        }}
      ><span aria-hidden="true" /></button>
    </article>
  );
}

function formatServiceTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "UNKNOWN";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
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

  const commitOrder = async (targetId: string, after: boolean, sourceId = dragId) => {
    if (!snapshot || !sourceId || sourceId === targetId) return;
    const ids = snapshot.entries.map((entry) => entry.id).filter((id) => id !== sourceId);
    let index = ids.indexOf(targetId);
    if (after) index += 1;
    ids.splice(index, 0, sourceId);
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
          Add mapping
        </button>
        <button type="button" onClick={openHistory}>
          Versions
        </button>
      </div>

      {snapshot?.value_migration?.required && (
        <div className="register-migration-warning" role="alert">
          <strong>Register publication is paused</strong>
          <span>
            Replace {snapshot.value_migration.entry_count} stored {snapshot.value_migration.entry_count === 1 ? "value" : "values"} with exact
            {" "}<code>volt://&lt;entry-id&gt;/&lt;value-position&gt;</code> references. Positions start at 1. Existing values remain visible here only for migration and are not returned to services.
          </span>
        </div>
      )}

      <div className="register-grid">
        {visible.map((entry, visibleIndex) => (
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
              <span className="register-ordinal">{String(visibleIndex + 1).padStart(2, "0")}</span>
              <strong>{entry.key}</strong>
              <button
                type="button"
                className="drag-mark"
                title="Drag, or use Ctrl+Arrow Up/Down to reorder"
                aria-label={`Reorder ${entry.key}`}
                disabled={Boolean(search)}
                onKeyDown={(event) => {
                  const order = snapshot?.entries ?? [];
                  const current = order.findIndex((item) => item.id === entry.id);
                  if (event.ctrlKey && event.key === "ArrowUp" && current > 0) {
                    event.preventDefault();
                    void commitOrder(order[current - 1].id, false, entry.id);
                  } else if (event.ctrlKey && event.key === "ArrowDown" && current < order.length - 1) {
                    event.preventDefault();
                    void commitOrder(order[current + 1].id, true, entry.id);
                  }
                }}
              >⠿</button>
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
          title={editing === "new" ? "Add Register mapping" : "Edit Register mapping"}
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
          title="Delete Register mapping"
          message={`Register entry ${deleting.key} will be deleted.`}
          detail="A new Register revision will be created and the previous revision will remain in history."
          confirmLabel="Delete"
          pending={pending}
          onConfirm={() => void deleteEntry()}
          onClose={() => setDeleting(undefined)}
        />
      )}

      {historyOpen && (
        <Modal title="Register versions" width={900} onClose={() => setHistoryOpen(false)}>
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
          title="Restore Register"
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

function LegacySettingsPage({
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

export function SettingsPage({
  settings,
  onSettings,
  onPreviewAccent,
  notify,
}: {
  settings: UiSettings;
  onSettings: SettingsSaver;
  onPreviewAccent(accent?: string): void;
  notify: Notify;
}) {
  const [openSection, setOpenSection] = useState<SettingsSection>();
  const [dragSection, setDragSection] = useState<SettingsSection>();
  const [insertSection, setInsertSection] = useState<{ id: SettingsSection; after: boolean }>();
  const [draftAccent, setDraftAccent] = useState(settings.colors.accent);
  const [draftSidebarFixed, setDraftSidebarFixed] = useState(!settings.sidebar_auto_hide);
  const [settingsPending, setSettingsPending] = useState(false);
  const [accessKey, setAccessKey] = useState({ current: "", next: "", repeat: "" });
  const [securityPending, setSecurityPending] = useState(false);
  const [voltDialogOpen, setVoltDialogOpen] = useState(false);
  const [voltConnection, setVoltConnection] = useState<VoltConnectionSettings>({ url: "", token_configured: false });
  const [voltDraft, setVoltDraft] = useState({ url: "", token: "", repeat: "" });
  const [voltPending, setVoltPending] = useState(false);
  const [backupPending, setBackupPending] = useState(false);
  const [neptune, setNeptune] = useState<NeptuneAvailability>();
  const [neptuneDialogOpen, setNeptuneDialogOpen] = useState(false);
  const [neptuneCode, setNeptuneCode] = useState("");
  const [neptunePending, setNeptunePending] = useState(false);
  const [inspection, setInspection] = useState<BackupInspection>();
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus>();
  const [registerReachability, setRegisterReachability] = useState<"checking" | "reachable" | "unreachable">("checking");
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck>();
  const [updateJob, setUpdateJob] = useState<UpdateJob>();
  const [updatePending, setUpdatePending] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [updaterUpdate, setUpdaterUpdate] = useState<UpdateCheck>();
  const [updaterUpdatePending, setUpdaterUpdatePending] = useState(false);
  const [updaterUpdateError, setUpdaterUpdateError] = useState("");
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [auditPending, setAuditPending] = useState(false);
  const auditRef = useRef<AuditEvent[]>([]);

  useEffect(() => {
    auditRef.current = audit;
  }, [audit]);

  useEffect(() => () => onPreviewAccent(undefined), [onPreviewAccent]);

  const loadUpdaterState = useCallback(async () => {
    try {
      const status = await api<UpdaterStatus>("/api/updater/status");
      setUpdaterStatus(status);
    } catch (error) {
      setUpdaterStatus({
        installed: false,
        available: false,
        status: "unavailable",
        service: "updater",
        message: (error as Error).message,
      });
    }
    try {
      const job = await api<UpdateJob | null>("/api/updater/last-job");
      if (job) setUpdateJob(job);
    } catch {
      // A missing historical updater job does not block release discovery.
    }
  }, []);

  useEffect(() => { void loadUpdaterState(); }, [loadUpdaterState]);

  const loadNeptune = useCallback(() => {
    api<NeptuneAvailability>("/api/neptune/availability").then(setNeptune).catch(() => setNeptune({ installed: false, linked: false, state: "unavailable" }));
  }, []);
  useEffect(() => {
    loadNeptune();
    const pending = pendingAgentJob();
    if (!pending) return;
    setNeptunePending(true);
    void waitForAgentJob(pending, id => api<AgentJob>(`/api/neptune/initializations/${encodeURIComponent(id)}`))
      .then(() => loadNeptune()).catch(error => notify((error as Error).message, "error"))
      .finally(() => setNeptunePending(false));
  }, [loadNeptune, notify]);

  const initializeNeptune = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[A-Za-z0-9_-]{32}$/.test(neptuneCode)) { notify("Enter the 32-character setup code from Saturn", "error"); return; }
    setNeptunePending(true);
    try {
      const job = await api<AgentJob>("/api/neptune/initialize", { method: "POST", body: JSON.stringify({ enrollment_code: neptuneCode }) });
      setNeptuneCode("");
      await waitForAgentJob(job, id => api<AgentJob>(`/api/neptune/initializations/${encodeURIComponent(id)}`));
      const availability = await api<NeptuneAvailability>("/api/neptune/availability");
      setNeptune(availability);
      if (!availability.linked) throw new Error("Neptune enrollment completed but its project health is unavailable");
      setNeptuneDialogOpen(false);
      notify("Neptune is linked and ready.", "success");
    } catch (error) { notify((error as Error).message, "error"); }
    finally { setNeptunePending(false); }
  };

  const loadVoltConnection = useCallback(async () => {
    try {
      const connection = await api<VoltConnectionSettings>("/api/settings/volt");
      setVoltConnection(connection);
      setVoltDraft((current) => ({ ...current, url: connection.url }));
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }, [notify]);

  useEffect(() => { void loadVoltConnection(); }, [loadVoltConnection]);

  useEffect(() => {
    let disposed = false;
    setRegisterReachability("checking");
    api("/api/register")
      .then(() => { if (!disposed) setRegisterReachability("reachable"); })
      .catch(() => { if (!disposed) setRegisterReachability("unreachable"); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!updateJob || ["COMPLETED", "ROLLED_BACK", "FAILED", "ROLLBACK_FAILED"].includes(updateJob.state)) return;
    const timer = window.setInterval(() => {
      api<UpdateJob>(`/api/updater/jobs/${encodeURIComponent(updateJob.id)}`)
        .then(setUpdateJob)
        .catch((error: Error) => notify(error.message, "error"));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [notify, updateJob]);

  const loadAudit = useCallback(async () => {
    setAuditPending(true);
    try {
      const result = await api<{ events: AuditEvent[] }>("/api/audit?limit=100");
      setAudit(result.events.slice(0, 1000));
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setAuditPending(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadAudit();
    const poll = async () => {
      if (document.hidden || !auditRef.current[0]) return;
      try {
        const result = await api<{ events: AuditEvent[] }>(
          `/api/audit/changes?after=${encodeURIComponent(auditRef.current[0].id)}&limit=100`,
        );
        if (!result.events.length) return;
        setAudit((current) => {
          const known = new Set(current.map((event) => event.id));
          const incoming = result.events.filter((event) => !known.has(event.id)).reverse();
          return [...incoming, ...current].slice(0, 1000);
        });
      } catch (error) {
        notify((error as Error).message, "error");
      }
    };
    const timer = window.setInterval(poll, 3000);
    return () => window.clearInterval(timer);
  }, [loadAudit, notify]);

  const saveAppearance = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^#[0-9a-f]{6}$/i.test(draftAccent)) {
      notify("Accent color must use #RRGGBB format", "error");
      return;
    }
    setSettingsPending(true);
    try {
      const next = {
        ...settings,
        colors: { dark: "#000000", light: "#ffffff", accent: draftAccent.toLowerCase() },
      };
      const saved = await onSettings(next, "Accent color applied") ?? next;
      setDraftAccent(saved.colors.accent);
      onPreviewAccent(undefined);
    } finally {
      setSettingsPending(false);
    }
  };

  const setSidebarFixed = async (fixed: boolean) => {
    setDraftSidebarFixed(fixed);
    setSettingsPending(true);
    try {
      const saved = await onSettings(
        { ...settings, sidebar_auto_hide: !fixed },
        fixed ? "Sidebar fixed on screen" : "Sidebar auto-hide enabled",
      ) ?? { ...settings, sidebar_auto_hide: !fixed };
      setDraftSidebarFixed(!saved.sidebar_auto_hide);
    } finally {
      setSettingsPending(false);
    }
  };

  const changeAccessKey = async (event: FormEvent) => {
    event.preventDefault();
    if (accessKey.next !== accessKey.repeat) {
      notify("New Access Key entries do not match", "error");
      return;
    }
    setSecurityPending(true);
    try {
      await api("/api/settings/access-key", {
        method: "POST",
        body: JSON.stringify({
          current_access_key: accessKey.current,
          new_access_key: accessKey.next,
          repeat_access_key: accessKey.repeat,
        }),
      });
      setAccessKey({ current: "", next: "", repeat: "" });
      setOpenSection(undefined);
      notify("Access Key changed; other sessions were revoked");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setSecurityPending(false);
    }
  };

  const saveVoltConnection = async (event: FormEvent) => {
    event.preventDefault();
    if (voltDraft.token !== voltDraft.repeat) {
      notify("Volt Kernel token entries do not match", "error");
      return;
    }
    setVoltPending(true);
    try {
      const saved = await api<VoltConnectionSettings>("/api/settings/volt", {
        method: "PUT",
        body: JSON.stringify({ url: voltDraft.url, token: voltDraft.token }),
      });
      setVoltConnection(saved);
      setVoltDraft({ url: saved.url, token: "", repeat: "" });
      setVoltDialogOpen(false);
      notify("Volt connection settings saved");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setVoltPending(false);
    }
  };

  const generateVoltToken = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    setVoltDraft((current) => ({ ...current, token, repeat: token }));
  };

  const copyVoltToken = async () => {
    if (!voltDraft.token) return;
    try {
      await navigator.clipboard.writeText(voltDraft.token);
      notify("Volt Kernel token copied");
    } catch {
      notify("Could not copy the token; select it in the field", "error");
    }
  };

  const downloadBlob = async (url: string, fallbackName: string) => {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = disposition.match(/filename="?([^";]+)"?/)?.[1] ?? fallbackName;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  const createBackup = async () => {
    setBackupPending(true);
    try {
      await downloadBlob("/api/backup", `kernel-backup-${new Date().toISOString().slice(0, 10)}.zip`);
      notify("Kernel backup created and downloaded");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBackupPending(false);
    }
  };

  const inspectBackup = async (file?: File) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setBackupPending(true);
    setInspection(undefined);
    try {
      setInspection(await api<BackupInspection>("/api/backup/inspect", { method: "POST", body: form }));
    } catch (error) {
      notify((error as Error).message, "error");
      if (backupInputRef.current) backupInputRef.current.value = "";
      setOpenSection(undefined);
    } finally {
      setBackupPending(false);
    }
  };

  const restoreBackup = async () => {
    if (!inspection) return;
    setBackupPending(true);
    try {
      await api("/api/backup/restore", {
        method: "POST",
        body: JSON.stringify({ inspection_id: inspection.inspection_id }),
      });
      notify("Kernel backup restored");
      window.location.reload();
    } catch (error) {
      notify((error as Error).message, "error");
      setBackupPending(false);
    }
  };

  const checkForUpdates = useCallback(async () => {
    setUpdatePending(true);
    setUpdateError("");
    try {
      const result = await api<UpdateCheck>("/api/updater/check", { method: "POST" });
      setUpdateCheck(result);
    } catch (error) {
      setUpdateError((error as Error).message);
    } finally {
      setUpdatePending(false);
    }
  }, []);

  const openUpdates = () => {
    setOpenSection("updates");
    void checkForUpdates();
  };

  const checkUpdaterUpdate = async () => {
    setUpdaterUpdatePending(true);
    setUpdaterUpdateError("");
    try {
      const result = await api<UpdateCheck>("/api/updater/self-update/check", { method: "POST" });
      setUpdaterUpdate(result);
      notify(result.update_available ? `Updater ${result.available_version} is available` : "Updater is up to date", "info");
    } catch (error) {
      const message = (error as Error).message;
      setUpdaterUpdateError(message);
      notify(message, "error");
    } finally {
      setUpdaterUpdatePending(false);
    }
  };

  const stageBackupAndInstall = async () => {
    if (!updateCheck?.available_version) return;
    setUpdatePending(true);
    try {
      const staged = await api<{ id: string; filename: string; download_url: string }>("/api/backups", { method: "POST" });
      await downloadBlob(staged.download_url, staged.filename);
      const job = await api<UpdateJob>("/api/updater/install", {
        method: "POST",
        body: JSON.stringify({ version: updateCheck.available_version, backup_id: staged.id }),
      });
      setUpdateJob(job);
      setConfirmUpdate(false);
      notify("Backup downloaded; update job started", "info");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setUpdatePending(false);
    }
  };

  const rollbackUpdate = async () => {
    if (!updateJob) return;
    setUpdatePending(true);
    try {
      setUpdateJob(await api<UpdateJob>(`/api/updater/jobs/${encodeURIComponent(updateJob.id)}/rollback`, { method: "POST" }));
      notify("Rollback requested", "info");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setUpdatePending(false);
    }
  };

  const setRevisionLogging = async (enabled: boolean) => {
    setSettingsPending(true);
    try {
      await onSettings({ ...settings, revision_request_logging: enabled }, enabled ? "Revision request logging enabled" : "Revision request logging disabled");
    } finally {
      setSettingsPending(false);
    }
  };

  const loadOlderAudit = async () => {
    const cursor = audit.at(-1)?.id;
    if (!cursor || audit.length >= 1000) return;
    setAuditPending(true);
    try {
      const result = await api<{ events: AuditEvent[] }>(`/api/audit/older?before=${encodeURIComponent(cursor)}&limit=100`);
      setAudit((current) => [...current, ...result.events].slice(0, 1000));
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setAuditPending(false);
    }
  };

  const moveSection = (source: SettingsSection, target: SettingsSection, after: boolean) => {
    if (source === target) return;
    const order = settings.presentation.settings_order.filter((id) => id !== source);
    let index = order.indexOf(target);
    if (after) index += 1;
    order.splice(index, 0, source);
    setDragSection(undefined);
    setInsertSection(undefined);
    void onSettings({ ...settings, presentation: { ...settings.presentation, settings_order: order } }, "Settings order saved");
  };

  const sectionTitles: Record<SettingsSection, string> = {
    appearance: "Appearance",
    security: "Security",
    backup: "Backup",
    updates: "Updates",
    logs: "Logs",
    documents: "Documents",
  };

  const sectionContent = (id: SettingsSection) => {
    if (id === "appearance") return (
      <div className="settings-content appearance-content">
        <div className="settings-group">
          <h3>Color correction</h3>
          <p>Changes preview immediately and apply to both authenticated views and sign-in.</p>
          <form className="appearance-form" onSubmit={saveAppearance}>
            <label className="color-swatch" aria-label="Accent color swatch">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(draftAccent) ? draftAccent : "#00a8ff"} onChange={(event) => { setDraftAccent(event.target.value); onPreviewAccent(event.target.value); }} />
            </label>
            <label className="sr-only" htmlFor="accent-color-value">Accent color</label>
            <input id="accent-color-value" className="accent-value" type="text" pattern="#[0-9a-fA-F]{6}" value={draftAccent.toUpperCase()} onChange={(event) => { const value = event.target.value; setDraftAccent(value); if (/^#[0-9a-f]{6}$/i.test(value)) onPreviewAccent(value); }} />
            <button type="button" onClick={() => { setDraftAccent("#00a8ff"); onPreviewAccent("#00a8ff"); }}>Reset color</button>
            <button type="submit" disabled={settingsPending}>{settingsPending ? "Applying..." : "Apply color"}</button>
          </form>
        </div>
        <div className="settings-group sidebar-mode-group">
          <h3>Left menu position</h3>
          <p>Reveal the Sidebar from the edge or keep it fixed on wide screens.</p>
          <label className="toggle-row">
            <input type="checkbox" checked={draftSidebarFixed} disabled={settingsPending} onChange={(event) => void setSidebarFixed(event.target.checked)} />
            <span>Keep sidebar fixed on screen</span>
          </label>
        </div>
      </div>
    );

    if (id === "security") return (
      <div className="settings-content security-content">
        <div className="settings-group">
          <h3>Changing Access Key</h3>
          <p>Changing the operator Access Key revokes every other active browser session.</p>
          <button type="button" className="section-action" onClick={() => setOpenSection("security")}>Change Access Key</button>
        </div>
        <div className="settings-group">
          <h3>Volt connection</h3>
          <p>URL: <strong>{voltConnection.url || "not configured"}</strong><br />Kernel token: <strong>{voltConnection.token_configured ? "configured" : "not configured"}</strong></p>
          <button type="button" className="section-action" onClick={() => { setVoltDraft({ url: voltConnection.url, token: "", repeat: "" }); setVoltDialogOpen(true); }}>Configure Volt</button>
        </div>
      </div>
    );

    if (id === "backup") return (
      <div className="settings-content backup-content">
        <div className="settings-group">
          <h3>System snapshot</h3>
          <p>Logical snapshots contain documents, revisions, Register, Topology, settings and retained audit events, but no Access Key or service token.</p>
          <button type="button" className="section-action" disabled={backupPending} onClick={() => void createBackup()}>{backupPending ? "Creating..." : "Create and download snapshot"}</button>
        </div>
        <div className="settings-group">
          <h3>Restore snapshot</h3>
          <p>Restoring snapshot.</p>
          <button type="button" className="section-action" disabled={backupPending} onClick={() => { setInspection(undefined); if (backupInputRef.current) { backupInputRef.current.value = ""; backupInputRef.current.click(); } }}>{backupPending ? "Inspecting..." : "Browse local snapshot archive"}</button>
          <input ref={backupInputRef} hidden type="file" accept=".zip,application/zip,.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setOpenSection("backup"); void inspectBackup(file); }} />
        </div>
        <div className="settings-group backup-neptune-group">
          <h3>Automatic backup to Saturn</h3>
          <p>Schedules, remote runs and Neptune fleet status are managed only from Saturn → Synchronization. Manual Kernel snapshot download and restore remain here.</p>
          <div className="reachability-row"><span>Local Neptune agent:</span><strong className={neptune?.linked ? "is-reachable" : "is-unreachable"}>{neptune?.linked ? "Linked to Saturn" : neptune?.installed ? "Detected · not linked" : "Not installed"}<i aria-hidden="true" /></strong></div>
          {!neptune?.linked && <button type="button" className="section-action" disabled={!updaterStatus?.available || neptunePending} onClick={() => setNeptuneDialogOpen(true)}>Initialize Neptune</button>}
        </div>
      </div>
    );

    if (id === "updates") return (
      <div className="settings-content updates-content">
        <div className="settings-group update-pipeline-group">
          <h3>Update pipeline</h3>
          <p>Release discovery comes from Kernel Register; replacement and rollback are performed by the local Updater.</p>
          <p>Current installed version: <strong className="accent-text">{updaterStatus?.kernel_version ?? "Loading..."}</strong></p>
        </div>
        <div className="update-statuses">
          <div className="reachability-row">
            <span>Local updater agent:</span>
            <strong className={updaterStatus?.available ? "is-reachable" : updaterStatus ? "is-unreachable" : "is-checking"}>{updaterStatus?.available ? "Service Reachability" : updaterStatus ? "Service Unavailable" : "Checking"}<i aria-hidden="true" /></strong>
          </div>
          <div className="reachability-row">
            <span>Kernel Register:</span>
            <strong className={`is-${registerReachability}`}>{registerReachability === "reachable" ? "Service Reachability" : registerReachability === "unreachable" ? "Service Unavailable" : "Checking"}<i aria-hidden="true" /></strong>
          </div>
        </div>
        <button type="button" className="section-action update-check-action" disabled={updatePending} onClick={openUpdates}>{updatePending ? "Checking..." : "Check for updates"}</button>
        <div className="settings-group updater-version-group">
          <h3>Updater version</h3>
          <SelfUpdateButton enabled={updaterStatus?.available === true} start={() => api("/api/updater/self-update/install", { method: "POST" })} read={id => api(`/api/updater/jobs/${encodeURIComponent(id)}`)} />
          <p>Current installed version: {updaterStatus?.version ?? "unavailable"}{updaterUpdate?.available_version ? ` · latest ${updaterUpdate.available_version}` : ""}</p>
          <button type="button" className="section-action" disabled={!updaterStatus?.available || updaterUpdatePending} onClick={() => void checkUpdaterUpdate()}>{updaterUpdatePending ? "Checking..." : "Check Updater for updates"}</button>
          {updaterUpdateError && <p className="inline-error" role="alert">{updaterUpdateError}</p>}

        </div>
      </div>
    );

    if (id === "logs") return (
      <div className="settings-content logs-content">
        <div className="logs-command-band">
          <div>
            <p>Compact operator and internal-service action stream.</p>
            <label className="toggle-row"><input type="checkbox" checked={settings.revision_request_logging} disabled={settingsPending} onChange={(event) => void setRevisionLogging(event.target.checked)} /><span>Log internal-service revision requests</span></label>
          </div>
          <a className="button-link" href="/api/logs/download" download>Download archived logs</a>
        </div>
        <div className="audit-list" role="log">
          <div className="audit-head"><strong>TYPE</strong><strong>BODY</strong><strong>TIME</strong></div>
          {audit.map((event) => <div key={event.id}><span className={`audit-status is-${event.status}`}>/{event.status.toUpperCase()}</span><span>{event.action} · {event.target} · {event.actor}</span><time dateTime={event.created_at}>{formatLogDate(event.created_at)}</time></div>)}
          {!audit.length && <p className="muted">{auditPending ? "Loading events..." : "The audit log is empty."}</p>}
        </div>
        <button type="button" className="compact-action" disabled={auditPending || audit.length >= 1000 || !audit.length} onClick={() => void loadOlderAudit()}>{auditPending ? "Loading..." : audit.length >= 1000 ? "Display limit reached" : "Load older events"}</button>
      </div>
    );

    return (
      <div className="settings-content documents-content">
        <p className="settings-intro">Upload local Markdown files and restore immutable Overview and Constitution revisions.</p>
        <div className="document-managers"><DocumentManager type="overview" notify={notify} onChanged={loadAudit} /><DocumentManager type="constitution" notify={notify} onChanged={loadAudit} /></div>
      </div>
    );
  };

  return (
    <section className="settings-stack" aria-label="KERNEL settings">
      {settings.presentation.settings_order.map((id, index) => {
        const title = sectionTitles[id];
        return (
          <article
            key={id}
            data-settings-section={id}
            className={`settings-section universal-card ${insertSection?.id === id ? (insertSection.after ? "insert-after" : "insert-before") : ""}`}
            onDragEnd={() => { setDragSection(undefined); setInsertSection(undefined); }}
            onDragOver={(event) => {
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              setInsertSection({ id, after: event.clientY > rect.top + rect.height / 2 });
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragSection) moveSection(dragSection, id, insertSection?.after ?? false);
            }}
          >
            <header>
              <span className="settings-number">{String(index + 1).padStart(2, "0")}</span>
              <h2>{title}</h2>
              <button
                type="button"
                className="drag-mark"
                draggable
                aria-label={`Reorder ${title}`}
                title="Drag, or use Ctrl+Arrow Up/Down to reorder"
                onDragStart={() => setDragSection(id)}
                onKeyDown={(event) => {
                  const order = settings.presentation.settings_order;
                  const current = order.indexOf(id);
                  if (event.ctrlKey && event.key === "ArrowUp" && current > 0) {
                    event.preventDefault();
                    moveSection(id, order[current - 1], false);
                  } else if (event.ctrlKey && event.key === "ArrowDown" && current < order.length - 1) {
                    event.preventDefault();
                    moveSection(id, order[current + 1], true);
                  }
                }}
              ><span aria-hidden="true" /></button>
            </header>
            {sectionContent(id)}
          </article>
        );
      })}

      {openSection === "security" && (
        <Modal title="Security" onClose={() => !securityPending && setOpenSection(undefined)}>
          <form className="form-stack" onSubmit={changeAccessKey}>
            <label><span>Current Access Key</span><input type="password" autoComplete="current-password" required value={accessKey.current} onChange={(event) => setAccessKey({ ...accessKey, current: event.target.value })} /></label>
            <label><span>New Access Key</span><input type="password" autoComplete="new-password" minLength={12} required value={accessKey.next} onChange={(event) => setAccessKey({ ...accessKey, next: event.target.value })} /></label>
            <label><span>Repeat new Access Key</span><input type="password" autoComplete="new-password" minLength={12} required value={accessKey.repeat} onChange={(event) => setAccessKey({ ...accessKey, repeat: event.target.value })} /></label>
            <p className="hint">Applying a new key revokes every other operator session.</p>
            <div className="dialog-actions"><button type="button" disabled={securityPending} onClick={() => setOpenSection(undefined)}>Cancel</button><button type="submit" disabled={securityPending}>{securityPending ? "Changing..." : "Change Access Key"}</button></div>
          </form>
        </Modal>
      )}

      {voltDialogOpen && (
        <Modal title="Volt connection" onClose={() => !voltPending && setVoltDialogOpen(false)}>
          <form className="form-stack" onSubmit={saveVoltConnection}>
            <label><span>Volt URL</span><input type="url" required placeholder="https://volt.example.org" value={voltDraft.url} onChange={(event) => setVoltDraft({ ...voltDraft, url: event.target.value })} /></label>
            <label><span>VOLT_KERNEL_TOKEN</span><input type="password" autoComplete="new-password" minLength={32} placeholder={voltConnection.token_configured ? "Leave blank to keep the current token" : "At least 32 characters"} required={!voltConnection.token_configured} value={voltDraft.token} onChange={(event) => setVoltDraft({ ...voltDraft, token: event.target.value })} /></label>
            <label><span>Repeat VOLT_KERNEL_TOKEN</span><input type="password" autoComplete="new-password" minLength={32} required={Boolean(voltDraft.token)} value={voltDraft.repeat} onChange={(event) => setVoltDraft({ ...voltDraft, repeat: event.target.value })} /></label>
            <p className="hint">Set the same token in Volt Settings. Once saved, Kernel will not display it again.</p>
            <div className="dialog-actions"><button type="button" disabled={voltPending} onClick={generateVoltToken}>Generate token</button><button type="button" disabled={voltPending || !voltDraft.token} onClick={() => void copyVoltToken()}>Copy token</button><button type="button" disabled={voltPending} onClick={() => setVoltDialogOpen(false)}>Cancel</button><button type="submit" disabled={voltPending}>{voltPending ? "Saving..." : "Save connection"}</button></div>
          </form>
        </Modal>
      )}

      {openSection === "backup" && (
        <Modal title="Restore snapshot" width={720} onClose={() => !backupPending && setOpenSection(undefined)}>
          <div className="backup-panel">
            {backupPending && <p role="status">Inspecting the selected Kernel archive...</p>}
            {inspection && (
              <div className="inspection-card" role="status">
                <strong>Inspection passed</strong>
                <dl><div><dt>File</dt><dd>{inspection.filename}</dd></div><div><dt>Size</dt><dd>{formatBytes(inspection.size)}</dd></div><div><dt>Format</dt><dd>v{inspection.version}</dd></div><div><dt>Created</dt><dd>{formatDate(inspection.created_at)}</dd></div></dl>
                <p className="danger-copy">Restore replaces current mutable state. Existing immutable revisions remain recoverable where supported.</p>
                <button type="button" className="danger" disabled={backupPending} onClick={() => void restoreBackup()}>{backupPending ? "Restoring..." : "Confirm restore"}</button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {neptuneDialogOpen && (
        <Modal title="Initialize Neptune" onClose={() => !neptunePending && setNeptuneDialogOpen(false)}>
          <form className="form-stack" onSubmit={initializeNeptune}>
            <p className="hint">Create a one-time Linux pipeline code in Saturn → Synchronization. The code goes directly to the local Updater and is never stored by Kernel.</p>
            <label><span>Saturn setup code</span><input value={neptuneCode} minLength={32} maxLength={32} autoComplete="off" required onChange={(event) => setNeptuneCode(event.target.value.trim())} /></label>
            <div className="dialog-actions"><button type="button" disabled={neptunePending} onClick={() => setNeptuneDialogOpen(false)}>Cancel</button><button type="submit" disabled={neptunePending}>{neptunePending ? "Starting..." : "Initialize"}</button></div>
          </form>
        </Modal>
      )}

      {openSection === "updates" && (
        <Modal title="Updates" width={760} onClose={() => !updatePending && setOpenSection(undefined)}>
          <div className="updater-settings">
            <div className="updater-result"><span>Installed</span><strong>{updateCheck?.installed_version ?? updaterStatus?.kernel_version ?? "Loading"}</strong><span>Updater</span><strong>{updaterStatus?.available ? `Available ${updaterStatus.version ?? ""}` : "Unavailable"}</strong><span>Registry</span><strong>{updatePending ? "Checking" : updateError ? "Failed" : updateCheck ? "Checked" : "Not checked"}</strong></div>
            {updateError && <p className="login-error" role="alert">{updateError}</p>}
            {updateCheck && <div className="update-discovery"><h3>Discovery</h3><p>{updateCheck.update_available ? `Kernel ${updateCheck.available_version} is available.` : "No newer compatible Kernel release was found."}</p><p className="hint">GitHub release identity and semantic version are checked here. Artifact digests and health are verified by the privileged updater during installation.</p>{updateCheck.release_url && <a href={updateCheck.release_url} target="_blank" rel="noreferrer">Release notes</a>}</div>}
            <div className="dialog-actions"><button type="button" disabled={updatePending} onClick={() => void checkForUpdates()}>{updatePending ? "Checking..." : "Check again"}</button>{updateCheck?.update_available && <button type="button" disabled={updatePending || !updaterStatus?.available} onClick={() => setConfirmUpdate(true)}>Install {updateCheck.available_version}</button>}</div>
            {updateJob && <div className="updater-job" role="status"><span>Job</span><strong>{updateJob.id}</strong><span>State</span><strong>{updateJob.state}</strong>{updateJob.message && <p>{updateJob.message}</p>}{updateJob.rollback_available && <button type="button" className="danger" disabled={updatePending} onClick={() => void rollbackUpdate()}>Rollback</button>}</div>}
          </div>
        </Modal>
      )}

      {confirmUpdate && updateCheck?.available_version && (
        <ConfirmDialog title="Install KERNEL update" message={`Install KERNEL ${updateCheck.available_version}?`} detail="A full backup is created and downloaded first. The updater then verifies artifacts, preserves volumes, checks service health and exposes rollback when available." confirmLabel="Create backup and install" pending={updatePending} onConfirm={() => void stageBackupAndInstall()} onClose={() => setConfirmUpdate(false)} />
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
