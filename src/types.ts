export type ViewName =
  | "dashboard"
  | "overview"
  | "topology"
  | "register"
  | "constitution"
  | "settings"
  | "documentation";

export interface Session {
  authenticated: boolean;
  actor: string;
  kind: "operator" | "service";
}

export interface UiSettings {
  colors: {
    dark: string;
    light: string;
    accent: string;
  };
  sidebar_auto_hide: boolean;
  revision_request_logging: boolean;
  presentation: {
    navigation_order: Array<Exclude<ViewName, "documentation">>;
    dashboard_order: DashboardCardId[];
    settings_order: SettingsSection[];
  };
  audit_limits: {
    max_entries: number;
    retention_days: number;
    max_bytes: number;
    stored_bytes: number;
  };
}

export type DashboardMetric = "cpu" | "ram" | "disk" | "uptime";
export type ServiceId = "kernel" | "chronos" | "perimetr" | "saturn" | "laboratory" | "volt";
export type ServiceDashboardCard = `service-${ServiceId}`;
export type DashboardCardId = DashboardMetric | ServiceDashboardCard;
export type SettingsSection = "appearance" | "security" | "backup" | "updates" | "logs" | "documents";

export interface ServiceStatusCheck {
  state: "pass" | "fail" | "unknown";
  level?: "readiness" | "liveness";
  latency_ms: number | null;
  code: string;
}

export interface ServiceStatus {
  id: ServiceId;
  name: string;
  status: "available" | "degraded" | "unavailable" | "unconfigured" | "stale" | "unknown";
  hostname: string | null;
  checked_at: string | null;
  checks: {
    edge: ServiceStatusCheck;
    readiness: ServiceStatusCheck;
  };
  consecutive_failures: number;
}

export interface ServiceStatusSnapshot {
  collected_at: string | null;
  refresh_interval_seconds: number;
  stale_after_seconds: number;
  services: ServiceStatus[];
}

export interface NeptuneStatus {
  product: "neptune-linux";
  version: string;
  client_instance_id: string;
  project: {
    projectId: string;
    enabled: boolean;
    interval_hours: number;
    next_run_at?: string;
  };
  active: boolean;
}

export interface DocumentRevision {
  revision: string;
  type: "overview" | "constitution";
  checksum: string;
  actor: string;
  reason: string;
  source_revision: string | null;
  created_at: string;
  content?: string;
}

export interface RegisterEntry {
  id: string;
  key: string;
  value: string;
  description: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface RegisterSnapshot {
  revision: string;
  checksum: string;
  updated_at: string;
  values: Record<string, string>;
  entries: RegisterEntry[];
  value_migration?: {
    required: boolean;
    entry_count: number;
    entries: Array<{ id: string; key: string }>;
  };
}

export interface RevisionSummary {
  revision: string;
  checksum: string;
  actor: string;
  reason: string;
  source_revision: string | null;
  created_at: string;
}

export interface Metrics {
  collected_at: string;
  cpu: {
    usage_percent: number | null;
    cores: number;
    load_1m: number | null;
    load_5m: number | null;
    load_15m: number | null;
  };
  ram: {
    used_bytes: number;
    free_bytes: number;
    total_bytes: number;
    percent: number | null;
  };
  disk: {
    used_bytes: number | null;
    free_bytes: number | null;
    total_bytes: number | null;
    percent: number | null;
  };
  uptime_seconds: number;
  hostname: string;
  platform: string;
}

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  status: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface NoticeMessage {
  id: string;
  kind: "success" | "error" | "info";
  message: string;
}

export interface UpdateCheck {
  service: string;
  repository_url: string;
  installed_version: string;
  available_version: string | null;
  update_available: boolean;
  tag: string | null;
  release_url: string | null;
  published_at: string | null;
  prerelease: boolean;
  discovery_status?: "verified-github-metadata";
  artifact_verification?: "delegated-to-updater";
  apply_via: string;
  backup_required: boolean;
}

export interface UpdaterStatus {
  installed: boolean;
  available: boolean;
  status: string;
  service: string;
  version?: string;
  kernel_version?: string;
  busy?: boolean;
  message?: string;
}

export interface BackupInspection {
  inspection_id: string;
  filename: string;
  size: number;
  format: string;
  version: number;
  created_at: string | null;
}

export interface UpdateJob {
  id: string;
  service: string;
  version: string;
  state: string;
  message?: string;
  rollback_available: boolean;
}
