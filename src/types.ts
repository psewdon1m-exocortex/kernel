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
  audit_limits: {
    max_entries: number;
    retention_days: number;
    max_bytes: number;
    stored_bytes: number;
  };
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
  apply_via: string;
  backup_required: boolean;
}

export interface UpdaterStatus {
  installed: boolean;
  available: boolean;
  status: string;
  service: string;
  version?: string;
  busy?: boolean;
  message?: string;
}

export interface UpdateJob {
  id: string;
  service: string;
  version: string;
  state: string;
  message?: string;
  rollback_available: boolean;
}
