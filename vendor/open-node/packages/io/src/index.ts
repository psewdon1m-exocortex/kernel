import {
  PROJECT_SCHEMA_VERSION,
  cloneProject,
  createEmptyProject,
  validateProject,
  type OpenNodeProject,
  type ProjectSettings,
  type ValidationIssue,
} from "@open-node/model";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
const sizeSchema = z.object({ width: z.number().positive(), height: z.number().positive() });
const portSchema = z.object({
  id: z.string().min(1), label: z.string(), direction: z.enum(["input", "output"]), kind: z.enum(["data", "control"]), typeId: z.string().min(1),
  required: z.boolean().optional(), multiple: z.boolean().optional(), dynamic: z.boolean().optional(), hidden: z.boolean().optional(),
});

const nodeSchema = z.object({
  id: z.string().min(1), kind: z.literal("node"), nodeTypeId: z.string().min(1), nodeTypeVersion: z.string().min(1), position: pointSchema, size: sizeSchema,
  label: z.string(), color: z.string().optional(), bypassed: z.boolean(), parameters: z.record(z.string(), z.unknown()), ports: z.array(portSchema),
  parentContainerId: z.string().nullable(), parentGroupId: z.string().nullable(), uiState: z.record(z.string(), z.unknown()), runtimeHints: z.record(z.string(), z.unknown()),
  tags: z.array(z.string()).optional(), unresolved: z.object({ reason: z.string(), rawState: z.unknown() }).optional(),
});

const containerSchema = z.object({
  id: z.string().min(1), kind: z.literal("container"), name: z.string(), position: pointSchema, size: sizeSchema, color: z.string().optional(), collapsed: z.boolean(), bypassed: z.boolean(),
  nodeIds: z.array(z.string()), parentGroupId: z.string().nullable(), inputPort: portSchema, outputPort: portSchema, errorPolicy: z.literal("stop-on-error"), tags: z.array(z.string()).optional(),
});

const groupSchema = z.object({
  id: z.string().min(1), kind: z.literal("group"), name: z.string().optional(), position: pointSchema, size: sizeSchema, color: z.string().optional(), opacity: z.number().min(0).max(1),
  borderStyle: z.enum(["solid", "dashed", "dotted"]), collapsed: z.boolean(), bypassed: z.boolean(), memberNodeIds: z.array(z.string()), memberContainerIds: z.array(z.string()),
  bypassSnapshot: z.record(z.string(), z.boolean()).optional(), tags: z.array(z.string()).optional(),
});

const annotationSchema = z.object({
  id: z.string().min(1), kind: z.literal("annotation"), annotationType: z.enum(["rectangle", "ellipse", "diamond", "arrow", "brush", "text"]),
  position: pointSchema, size: sizeSchema, rotation: z.number().finite(), color: z.string(), fillColor: z.string().optional(), strokeWidth: z.number().positive(), opacity: z.number().min(0).max(1),
  text: z.string().optional(), fontSize: z.number().positive().optional(), points: z.array(pointSchema).optional(),
});

const baseConnection = {
  id: z.string().min(1), label: z.string().optional(), color: z.string().optional(), thickness: z.number().positive(), opacity: z.number().min(0).max(1), dash: z.array(z.number().nonnegative()).optional(),
  arrowhead: z.enum(["none", "end", "both"]), routing: z.enum(["straight", "bezier", "smooth-step", "orthogonal"]), routingOverride: z.boolean().optional(), reroutePoints: z.array(pointSchema),
};
const computationalEndpoint = z.object({ elementId: z.string(), portId: z.string() });
const decorativeEndpoint = z.object({ elementId: z.string(), normalizedAnchor: pointSchema });
const connectionSchema = z.discriminatedUnion("kind", [
  z.object({ ...baseConnection, kind: z.literal("data"), source: computationalEndpoint, target: computationalEndpoint }),
  z.object({ ...baseConnection, kind: z.literal("control"), source: computationalEndpoint, target: computationalEndpoint }),
  z.object({ ...baseConnection, kind: z.literal("decorative"), source: decorativeEndpoint, target: decorativeEndpoint }),
]);

const backgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: z.string() }),
  z.object({ type: z.literal("linear-gradient"), from: z.string(), to: z.string(), angle: z.number() }),
  z.object({ type: z.literal("radial-gradient"), inner: z.string(), outer: z.string() }),
  z.object({ type: z.literal("image"), assetId: z.string(), fit: z.enum(["cover", "contain", "stretch", "tile"]), scale: z.number().positive(), opacity: z.number().min(0).max(1), offset: pointSchema, binding: z.enum(["world", "viewport"]) }),
  z.object({ type: z.literal("transparent") }),
]);

const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  grid: z.object({ enabled: z.boolean(), step: z.number().positive(), majorEvery: z.number().int().positive(), color: z.string(), opacity: z.number().min(0).max(1), snapping: z.boolean() }),
  minimapVisible: z.boolean(), timelineVisible: z.boolean(), dashboardVisible: z.boolean(), reducedMotion: z.boolean(), previewQuality: z.enum(["low", "medium", "high"]),
  connectionRouting: z.enum(["straight", "bezier", "smooth-step", "orthogonal"]),
  connectionsVisible: z.boolean().optional().default(true), portsVisible: z.boolean().optional().default(true),
  groupsVisible: z.boolean().optional().default(true), annotationsVisible: z.boolean().optional().default(true),
  recentLibraryItems: z.array(z.object({ kind: z.enum(["node", "container"]), id: z.string().min(1) })).max(12).optional().default([]),
  panelLayout: z.object({ library: z.object({ position: pointSchema, size: sizeSchema }) }).optional(),
});

const presetSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("node"), name: z.string(), nodeTypeId: z.string(), nodeTypeVersion: z.string(), color: z.string().optional(), parameters: z.record(z.string(), z.unknown()), uiState: z.record(z.string(), z.unknown()) }),
  z.object({ id: z.string(), kind: z.literal("container"), name: z.string(), color: z.string().optional(), nodes: z.array(z.object({ nodeTypeId: z.string(), nodeTypeVersion: z.string(), label: z.string(), color: z.string().optional(), parameters: z.record(z.string(), z.unknown()), bypassed: z.boolean() })), errorPolicy: z.literal("stop-on-error") }),
]);

const assetSchema = z.object({
  id: z.string(), name: z.string(), storage: z.enum(["embedded", "external", "remote", "host-managed"]), uri: z.string().optional(), path: z.string().optional(), mimeType: z.string(),
  mediaType: z.enum(["image", "video", "audio", "text", "table", "document", "geometry", "archive", "binary"]), size: z.number().nonnegative(), checksum: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()), missing: z.boolean().optional(), embeddedPath: z.string().optional(),
});

export const openNodeProjectSchema = z.object({
  format: z.literal("open-node-project"),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  createdWith: z.string(),
  metadata: z.object({ id: z.string(), name: z.string(), description: z.string().optional(), createdAt: z.string(), updatedAt: z.string(), tags: z.array(z.string()) }),
  dependencies: z.array(z.object({ packageId: z.string(), version: z.string(), integrity: z.string().optional(), required: z.boolean() })),
  settings: settingsSchema,
  execution: z.object({ mode: z.enum(["manual", "reactive", "continuous", "timeline"]), concurrency: z.number().int().positive(), preferredBackend: z.enum(["main", "worker", "gpu", "host", "auto"]), cacheEnabled: z.boolean(), nodeTimeoutMs: z.number().positive(), continuousQueueSize: z.number().int().positive(), backpressure: z.enum(["block", "drop-oldest", "drop-newest"]) }),
  timeline: z.object({ enabled: z.boolean(), fps: z.number().positive().max(1000), durationSeconds: z.number().nonnegative(), startTime: z.number().nonnegative(), endTime: z.number().nonnegative(), loop: z.boolean(), playbackRate: z.number().positive(), timeUnit: z.enum(["seconds", "frames"]), currentTime: z.number().nonnegative() }),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().positive() }),
  background: backgroundSchema,
  nodes: z.array(nodeSchema), containers: z.array(containerSchema), groups: z.array(groupSchema), connections: z.array(connectionSchema), annotations: z.array(annotationSchema).optional().default([]), presets: z.array(presetSchema), assets: z.array(assetSchema),
});

export interface MigrationStep {
  from: string;
  to: string;
  migrate(project: Record<string, unknown>): Record<string, unknown>;
}

export interface ProjectLoadReport {
  project: OpenNodeProject | null;
  valid: boolean;
  issues: ValidationIssue[];
  migrated: boolean;
  migrationPath: string[];
  original: unknown;
}

export class MigrationRegistry {
  #steps = new Map<string, MigrationStep>();

  register(step: MigrationStep): this {
    if (this.#steps.has(step.from)) throw new Error(`Migration already registered for ${step.from}`);
    this.#steps.set(step.from, step);
    return this;
  }

  migrate(input: Record<string, unknown>, target = PROJECT_SCHEMA_VERSION): { value: Record<string, unknown>; path: string[] } {
    let value = structuredClone(input);
    const path = [String(value["schemaVersion"] ?? "unknown")];
    const visited = new Set<string>();
    while (value["schemaVersion"] !== target) {
      const current = String(value["schemaVersion"] ?? "unknown");
      if (visited.has(current)) throw new Error(`Migration cycle detected at ${current}`);
      visited.add(current);
      const step = this.#steps.get(current);
      if (!step) throw new Error(`No migration path from schema ${current} to ${target}`);
      value = step.migrate(structuredClone(value));
      value["schemaVersion"] = step.to;
      path.push(step.to);
    }
    return { value, path };
  }
}

export function createDefaultMigrationRegistry(): MigrationRegistry {
  return new MigrationRegistry().register({
    from: "0.1.0",
    to: "1.0.0",
    migrate(input) {
      const defaults = createEmptyProject(String((input["metadata"] as Record<string, unknown> | undefined)?.["name"] ?? "Migrated Project"));
      return deepMerge(defaults as unknown as Record<string, unknown>, input);
    },
  });
}

export function serializeProject(project: OpenNodeProject, pretty = true): string {
  const validation = validateProject(project);
  if (!validation.valid) throw new Error(`Cannot serialize invalid project: ${validation.issues.map((issue) => issue.message).join("; ")}`);
  const parsed = openNodeProjectSchema.safeParse(project);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "$"}: ${issue.message}`).join("; ");
    throw new Error(`Cannot serialize project outside the canonical schema: ${details}`);
  }
  assertJsonSerializable(parsed.data, "$", new WeakSet<object>());
  return JSON.stringify(parsed.data, null, pretty ? 2 : undefined);
}

function assertJsonSerializable(value: unknown, path: string, ancestors: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Cannot serialize non-finite number at ${path}`);
    return;
  }
  if (value === undefined) return;
  if (typeof value !== "object") throw new Error(`Cannot serialize ${typeof value} value at ${path}`);
  if (ancestors.has(value)) throw new Error(`Cannot serialize circular value at ${path}`);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error(`Cannot serialize non-plain object at ${path}`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (item === undefined) throw new Error(`Cannot serialize undefined array item at ${path}[${index}]`);
      assertJsonSerializable(item, `${path}[${index}]`, ancestors);
    });
  } else {
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`Cannot serialize symbol-keyed property at ${path}`);
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) assertJsonSerializable(item, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

export function loadProjectJson(source: string | unknown, migrations = createDefaultMigrationRegistry()): ProjectLoadReport {
  let original: unknown;
  try {
    original = typeof source === "string" ? JSON.parse(source) : structuredClone(source);
  } catch (error) {
    return failure(source, "invalid-json", error instanceof Error ? error.message : "Invalid JSON", "$");
  }
  if (!original || typeof original !== "object" || Array.isArray(original)) return failure(original, "invalid-root", "Project root must be an object", "$");
  const record = original as Record<string, unknown>;
  if (record["format"] !== "open-node-project") return failure(original, "invalid-format", "Not an Open Node project", "format");
  let candidate = structuredClone(record);
  let migrationPath: string[] = [];
  try {
    if (candidate["schemaVersion"] !== PROJECT_SCHEMA_VERSION) {
      const migrated = migrations.migrate(candidate);
      candidate = migrated.value;
      migrationPath = migrated.path;
    }
  } catch (error) {
    return failure(original, "migration-failed", error instanceof Error ? error.message : "Migration failed", "schemaVersion");
  }
  const parsed = openNodeProjectSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      project: null,
      valid: false,
      issues: parsed.error.issues.map((issue) => ({ code: `schema-${issue.code}`, message: issue.message, path: issue.path.join("."), severity: "error" as const })),
      migrated: migrationPath.length > 0,
      migrationPath,
      original,
    };
  }
  const project = parsed.data as OpenNodeProject;
  const modelValidation = validateProject(project);
  return { project: modelValidation.valid ? project : null, valid: modelValidation.valid, issues: modelValidation.issues, migrated: migrationPath.length > 0, migrationPath, original };
}

export interface ProjectPackage {
  project: OpenNodeProject;
  assets: Map<string, Uint8Array>;
  dependenciesLock?: unknown;
}

export interface PackageLimits {
  maxEntries?: number;
  maxUncompressedBytes?: number;
  maxCompressionRatio?: number;
}

export function packProject(input: ProjectPackage): Uint8Array {
  const files: Record<string, Uint8Array> = { "project.json": strToU8(serializeProject(input.project)) };
  if (input.dependenciesLock) files["dependencies.lock.json"] = strToU8(JSON.stringify(input.dependenciesLock, null, 2));
  for (const [path, bytes] of input.assets) {
    const safe = normalizePackagePath(path.startsWith("assets/") ? path : `assets/${path}`);
    files[safe] = bytes;
  }
  return zipSync(files, { level: 6 });
}

export function unpackProject(bytes: Uint8Array, limits: PackageLimits = {}): ProjectPackage {
  const maxEntries = limits.maxEntries ?? 2048;
  const maxUncompressedBytes = limits.maxUncompressedBytes ?? 512 * 1024 * 1024;
  const files = unzipSync(bytes);
  const entries = Object.entries(files);
  if (entries.length > maxEntries) throw new Error(`Package contains more than ${maxEntries} entries`);
  let total = 0;
  for (const [path, content] of entries) {
    normalizePackagePath(path);
    total += content.byteLength;
    if (total > maxUncompressedBytes) throw new Error("Package exceeds the maximum uncompressed size");
  }
  const projectFile = files["project.json"];
  if (!projectFile) throw new Error("Package does not contain project.json");
  const report = loadProjectJson(strFromU8(projectFile));
  if (!report.valid || !report.project) throw new Error(`Invalid packaged project: ${report.issues.map((issue) => issue.message).join("; ")}`);
  const assets = new Map(entries.filter(([path]) => path.startsWith("assets/")).map(([path, content]) => [path, content]));
  const lock = files["dependencies.lock.json"];
  return { project: report.project, assets, ...(lock ? { dependenciesLock: JSON.parse(strFromU8(lock)) } : {}) };
}

export interface HotkeyBinding {
  command: string;
  keys: string;
}

export interface OpenNodeConfig {
  format: "open-node-config";
  version: "1.0.0";
  settings: ProjectSettings;
  hotkeys: HotkeyBinding[];
  canvas: { minZoom: number; maxZoom: number };
  featureFlags: Record<string, boolean>;
}

const configSchema = z.object({
  format: z.literal("open-node-config"), version: z.literal("1.0.0"), settings: settingsSchema,
  hotkeys: z.array(z.object({ command: z.string(), keys: z.string() })),
  canvas: z.object({ minZoom: z.number().positive(), maxZoom: z.number().positive() }),
  featureFlags: z.record(z.string(), z.boolean()),
}).superRefine((config, context) => {
  if (config.canvas.minZoom >= config.canvas.maxZoom) context.addIssue({ code: "custom", message: "minZoom must be less than maxZoom", path: ["canvas"] });
  const keys = new Map<string, string>();
  for (const binding of config.hotkeys) {
    const normalized = normalizeHotkey(binding.keys);
    const current = keys.get(normalized);
    if (current && current !== binding.command) context.addIssue({ code: "custom", message: `Hotkey conflict: ${binding.keys} is assigned to ${current} and ${binding.command}`, path: ["hotkeys"] });
    keys.set(normalized, binding.command);
  }
});

export function createDefaultConfig(): OpenNodeConfig {
  return {
    format: "open-node-config", version: "1.0.0", settings: createEmptyProject().settings,
    hotkeys: [
      { command: "library.open", keys: "Alt" }, { command: "containerLibrary.open", keys: "Alt+Space" }, { command: "group.create", keys: "Alt+Drag" },
      { command: "viewport.pan", keys: "Space+MouseLeft" }, { command: "viewport.origin", keys: "Space Space" }, { command: "selection.delete", keys: "Delete" },
      { command: "history.undo", keys: "Mod+Z" }, { command: "history.redo", keys: "Mod+Shift+Z" }, { command: "selection.duplicate", keys: "Mod+D" }, { command: "selection.bypass", keys: "B" },
    ],
    canvas: { minZoom: 0.05, maxZoom: 8 },
    featureFlags: { timeline: true, streaming: true, machineApi: true },
  };
}

export function parseConfig(value: unknown): OpenNodeConfig {
  return configSchema.parse(value) as OpenNodeConfig;
}

export function importConfig(current: OpenNodeConfig, value: unknown, mode: "merge" | "replace" = "merge"): OpenNodeConfig {
  const incoming = parseConfig(value);
  if (mode === "replace") return incoming;
  return parseConfig(deepMerge(structuredClone(current) as unknown as Record<string, unknown>, incoming as unknown as Record<string, unknown>));
}

export function serializeConfig(config: OpenNodeConfig): string {
  return JSON.stringify(parseConfig(config), null, 2);
}

export interface AutosaveAdapter {
  save(projectId: string, serialized: string): Promise<void>;
  load(projectId: string): Promise<string | null>;
  remove(projectId: string): Promise<void>;
}

export class LocalStorageAutosaveAdapter implements AutosaveAdapter {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, private readonly prefix = "open-node:autosave:") {}
  async save(projectId: string, serialized: string): Promise<void> { this.storage.setItem(this.prefix + projectId, serialized); }
  async load(projectId: string): Promise<string | null> { return this.storage.getItem(this.prefix + projectId); }
  async remove(projectId: string): Promise<void> { this.storage.removeItem(this.prefix + projectId); }
}

export class AutosaveController {
  #timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly adapter: AutosaveAdapter, private readonly delayMs = 1500) {}
  schedule(project: OpenNodeProject): void {
    if (this.#timer) clearTimeout(this.#timer);
    const snapshot = cloneProject(project);
    this.#timer = setTimeout(() => void this.adapter.save(snapshot.metadata.id, serializeProject(snapshot)), this.delayMs);
  }
  async recover(projectId: string): Promise<ProjectLoadReport | null> {
    const serialized = await this.adapter.load(projectId);
    return serialized ? loadProjectJson(serialized) : null;
  }
  dispose(): void { if (this.#timer) clearTimeout(this.#timer); }
}

function failure(original: unknown, code: string, message: string, path: string): ProjectLoadReport {
  return { project: null, valid: false, issues: [{ code, message, path, severity: "error" }], migrated: false, migrationPath: [], original };
}

function normalizePackagePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..") || /^[A-Za-z]:/.test(normalized)) throw new Error(`Unsafe package path: ${path}`);
  return normalized;
}

function normalizeHotkey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "").split("+").sort().join("+");
}

function deepMerge(base: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(incoming)) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      base[key] = deepMerge(base[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      base[key] = structuredClone(value);
    }
  }
  return base;
}
