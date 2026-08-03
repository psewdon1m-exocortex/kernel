import type {
  BackendId,
  NodeInstance,
  PortInstance,
  TimelineContext,
  ValidationResult,
  ValueEnvelope,
} from "@open-node/model";
import type { TypeDefinition, TypeRegistry } from "@open-node/type-system";

export interface PortDefinition extends Omit<PortInstance, "direction"> {
  defaultValue?: unknown;
}

export type ParameterControl = "text" | "number" | "toggle" | "select" | "color" | "table" | "file" | "button" | "readonly" | "preview";

export interface ParameterDefinition {
  id: string;
  label: string;
  control: ParameterControl;
  description?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: string | number | boolean }>;
  accept?: string[];
}

export type BypassDefinition =
  | { strategy: "passthrough"; inputPortId: string; outputPortId: string }
  | { strategy: "constant"; outputPortId: string; value: ValueEnvelope }
  | { strategy: "block" }
  | { strategy: "unsupported" };

export interface ExecuteContext<Params extends Record<string, unknown> = Record<string, unknown>> {
  node: NodeInstance;
  params: Params;
  inputs: Readonly<Record<string, ValueEnvelope | undefined>>;
  signal: AbortSignal;
  backend: BackendId;
  timeline: TimelineContext;
  services: Readonly<Record<string, unknown>>;
  reportProgress(progress: number, message?: string): void;
}

export interface StreamExecuteContext<Params extends Record<string, unknown> = Record<string, unknown>> extends ExecuteContext<Params> {
  streams: Readonly<Record<string, AsyncIterable<ValueEnvelope> | undefined>>;
}

export interface ContainerExecuteContext<Params extends Record<string, unknown> = Record<string, unknown>> {
  node: NodeInstance;
  params: Params;
  value: ValueEnvelope;
  signal: AbortSignal;
  timeline: TimelineContext;
  services: Readonly<Record<string, unknown>>;
}

export interface PreviewContext<Params extends Record<string, unknown> = Record<string, unknown>> {
  node: NodeInstance;
  params: Params;
  outputs: Readonly<Record<string, ValueEnvelope | undefined>>;
  timeline: TimelineContext;
  signal: AbortSignal;
  quality: "low" | "medium" | "high";
}

export interface NodeExecutionResult {
  outputs: Record<string, ValueEnvelope>;
  metadata?: Record<string, unknown>;
}

export interface NodeStreamResult {
  outputs: Record<string, ValueEnvelope>;
  progress?: number;
}

export type PreviewResult =
  | { kind: "image" | "video" | "audio"; url: string; alt?: string }
  | { kind: "text"; text: string }
  | { kind: "table"; columns: string[]; rows: unknown[][] }
  | { kind: "custom"; data: unknown };

export interface NodeDefinition<Params extends Record<string, unknown> = Record<string, unknown>> {
  typeId: string;
  version: string;
  displayName: string;
  description?: string;
  category: string;
  tags?: string[];
  defaultColor?: string;
  icon?: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  parameters: ParameterDefinition[];
  pure: boolean;
  sideEffect?: boolean;
  containerCompatible?: boolean;
  bypass?: BypassDefinition;
  capabilities?: {
    cpu?: boolean;
    worker?: boolean;
    gpu?: boolean;
    streaming?: boolean;
    timelineAware?: boolean;
    preview?: boolean;
  };
  resources?: {
    estimatedMemoryMb?: number;
    preferredBackend?: BackendId;
    parallelSafe?: boolean;
    maxConcurrency?: number;
    backendPolicy?: "gpu-preferred" | "gpu-required" | "cpu-only";
  };
  createDefaultParams(): Params;
  validate(params: Params): ValidationResult;
  execute?(context: ExecuteContext<Params>): Promise<NodeExecutionResult>;
  executeStream?(context: StreamExecuteContext<Params>): AsyncIterable<NodeStreamResult>;
  containerAdapter?(context: ContainerExecuteContext<Params>): Promise<ValueEnvelope>;
  renderPreview?(context: PreviewContext<Params>): Promise<PreviewResult>;
  migrate?(oldVersion: string, state: unknown): unknown;
}

export interface PluginManifest {
  id: string;
  version: string;
  displayName: string;
  permissions?: Array<"network" | "filesystem" | "clipboard" | "camera" | "microphone" | "gpu" | "worker" | "host-api">;
}

export interface OpenNodePlugin {
  manifest: PluginManifest;
  nodes?: NodeDefinition[];
  types?: TypeDefinition[];
  setup?(context: PluginSetupContext): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface PluginSetupContext {
  nodeRegistry: NodeRegistry;
  typeRegistry: TypeRegistry;
  services: Map<string, unknown>;
}

const NODE_TYPE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){2,}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function validResult(): ValidationResult {
  return { valid: true, issues: [] };
}

export function invalidResult(code: string, message: string, path = "parameters"): ValidationResult {
  return { valid: false, issues: [{ code, message, path, severity: "error" }] };
}

export class NodeRegistry {
  #definitions = new Map<string, Map<string, NodeDefinition>>();

  register<Params extends Record<string, unknown>>(definition: NodeDefinition<Params>): this {
    this.#assertDefinition(definition);
    const versions = this.#definitions.get(definition.typeId) ?? new Map<string, NodeDefinition>();
    if (versions.has(definition.version)) throw new Error(`Node is already registered: ${definition.typeId}@${definition.version}`);
    versions.set(definition.version, definition as NodeDefinition);
    this.#definitions.set(definition.typeId, versions);
    return this;
  }

  unregister(typeId: string, version?: string): void {
    if (!version) {
      this.#definitions.delete(typeId);
      return;
    }
    const versions = this.#definitions.get(typeId);
    versions?.delete(version);
    if (versions?.size === 0) this.#definitions.delete(typeId);
  }

  get(typeId: string, version?: string): NodeDefinition | undefined {
    const versions = this.#definitions.get(typeId);
    if (!versions) return undefined;
    if (version) return versions.get(version);
    return [...versions.entries()].sort(([a], [b]) => compareSemver(b, a))[0]?.[1];
  }

  require(typeId: string, version?: string): NodeDefinition {
    const definition = this.get(typeId, version);
    if (!definition) throw new Error(`Unregistered Node definition: ${typeId}${version ? `@${version}` : ""}`);
    return definition;
  }

  list(): NodeDefinition[] {
    return [...this.#definitions.keys()].map((id) => this.require(id)).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  search(query: string, category?: string): NodeDefinition[] {
    const normalized = query.trim().toLocaleLowerCase();
    return this.list().filter((definition) => {
      if (category && definition.category !== category) return false;
      if (!normalized) return true;
      return [definition.displayName, definition.description ?? "", definition.category, definition.typeId, ...(definition.tags ?? [])]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }

  migrate(node: NodeInstance): NodeInstance {
    const exact = this.get(node.nodeTypeId, node.nodeTypeVersion);
    if (exact) return node;
    const current = this.get(node.nodeTypeId);
    if (!current?.migrate) {
      return { ...node, unresolved: { reason: `Missing ${node.nodeTypeId}@${node.nodeTypeVersion}`, rawState: structuredClone(node) } };
    }
    try {
      const parameters = current.migrate(node.nodeTypeVersion, node.parameters);
      if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) throw new Error("Migration did not return a parameter object");
      return { ...node, nodeTypeVersion: current.version, parameters: parameters as Record<string, unknown>, ports: instantiatePorts(current), unresolved: undefined };
    } catch (error) {
      return { ...node, unresolved: { reason: error instanceof Error ? error.message : "Node migration failed", rawState: structuredClone(node) } };
    }
  }

  #assertDefinition(definition: NodeDefinition): void {
    if (!NODE_TYPE_ID.test(definition.typeId)) throw new Error(`Node type id must use publisher.package.node form: ${definition.typeId}`);
    if (!SEMVER.test(definition.version)) throw new Error(`Node version must use semantic versioning: ${definition.version}`);
    const portIds = [...definition.inputs, ...definition.outputs].map((item) => item.id);
    const parameterIds = definition.parameters.map((item) => item.id);
    if (new Set(portIds).size !== portIds.length) throw new Error(`Port ids must be unique in ${definition.typeId}`);
    if (new Set(parameterIds).size !== parameterIds.length) throw new Error(`Parameter ids must be unique in ${definition.typeId}`);
    if (definition.containerCompatible && !definition.containerAdapter) throw new Error(`Container-compatible Node requires containerAdapter: ${definition.typeId}`);
    if (!definition.execute && !definition.executeStream && !definition.containerAdapter) throw new Error(`Node has no execution implementation: ${definition.typeId}`);
    if (definition.sideEffect && definition.pure) throw new Error(`A side-effect Node cannot be pure: ${definition.typeId}`);
  }
}

export function instantiatePorts(definition: NodeDefinition): NodeInstance["ports"] {
  return [
    ...definition.inputs.map(({ defaultValue: _defaultValue, ...port }) => ({ ...port, direction: "input" as const })),
    ...definition.outputs.map(({ defaultValue: _defaultValue, ...port }) => ({ ...port, direction: "output" as const })),
  ];
}

export function createNodeFromDefinition(definition: NodeDefinition, position = { x: 0, y: 0 }): NodeInstance {
  const color = definition.defaultColor ? { color: definition.defaultColor } : {};
  return {
    id: `node-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    kind: "node",
    nodeTypeId: definition.typeId,
    nodeTypeVersion: definition.version,
    position,
    size: { width: 240, height: definition.capabilities?.preview ? 220 : 148 },
    label: definition.displayName,
    ...color,
    bypassed: false,
    parameters: definition.createDefaultParams(),
    ports: instantiatePorts(definition),
    parentContainerId: null,
    parentGroupId: null,
    uiState: { previewEnabled: Boolean(definition.capabilities?.preview) },
    runtimeHints: {},
  };
}

export class PluginManager {
  #plugins = new Map<string, OpenNodePlugin>();
  readonly services = new Map<string, unknown>();

  constructor(
    readonly nodeRegistry: NodeRegistry,
    readonly typeRegistry: TypeRegistry,
  ) {}

  async register(plugin: OpenNodePlugin): Promise<void> {
    if (this.#plugins.has(plugin.manifest.id)) throw new Error(`Plugin already registered: ${plugin.manifest.id}`);
    for (const type of plugin.types ?? []) this.typeRegistry.register(type);
    for (const node of plugin.nodes ?? []) this.nodeRegistry.register(node);
    await plugin.setup?.({ nodeRegistry: this.nodeRegistry, typeRegistry: this.typeRegistry, services: this.services });
    this.#plugins.set(plugin.manifest.id, plugin);
  }

  list(): PluginManifest[] {
    return [...this.#plugins.values()].map((plugin) => plugin.manifest);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.#plugins.values()].map((plugin) => plugin.dispose?.()));
    this.#plugins.clear();
    this.services.clear();
  }
}

function compareSemver(a: string, b: string): number {
  const left = a.split(/[.+-]/).slice(0, 3).map(Number);
  const right = b.split(/[.+-]/).slice(0, 3).map(Number);
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return a.localeCompare(b);
}
