import { createRoot, type Root } from "react-dom/client";
import { createElement, createRef } from "react";
import { AssetRegistry } from "@open-node/assets";
import { CommandHistory } from "@open-node/commands";
import { registerCoreNodes } from "@open-node/core-nodes";
import { BackendRegistry, ExecutionRuntime, type ExecutionBackend, type ExecutionRunOptions, type ExecutionSession } from "@open-node/engine";
import { AutosaveController, LocalStorageAutosaveAdapter, loadProjectJson, serializeProject } from "@open-node/io";
import { MachineApi, type MachineApiOptions } from "@open-node/machine-api";
import { createEmptyProject, ProjectStore, type OpenNodeProject, type ProjectChangeEvent, type ViewportState } from "@open-node/model";
import { NodeRegistry, PluginManager, type NodeDefinition, type OpenNodePlugin } from "@open-node/sdk";
import { BrowserTelemetryAdapter, TelemetryMonitor, type TelemetryAdapter } from "@open-node/telemetry";
import { TimelineRuntime } from "@open-node/timeline";
import { createCoreTypeRegistry, type TypeDefinition, type TypeRegistry } from "@open-node/type-system";
import { OpenNodeEditor, type OpenNodeEditorController, type OpenNodeEditorHandle } from "@open-node/ui";

export type OpenNodeMode = "standalone" | "embedded-edit" | "embedded-readonly" | "headless";

export interface OpenNodeAdapters {
  assets?: AssetRegistry;
  telemetry?: TelemetryAdapter | TelemetryMonitor;
  executionBackends?: ExecutionBackend[];
  services?: Record<string, unknown>;
  machineApi?: MachineApiOptions;
}

export interface CreateOpenNodeOptions {
  container?: HTMLElement | string;
  mode?: OpenNodeMode | "edit" | "readonly";
  project?: OpenNodeProject | string;
  nodeDefinitions?: NodeDefinition[];
  typeDefinitions?: TypeDefinition[];
  plugins?: OpenNodePlugin[];
  adapters?: OpenNodeAdapters;
  themeTokens?: Record<string, string>;
  onSaveRequest?: (project: OpenNodeProject) => void | Promise<void>;
  visualOnly?: boolean;
  registerCoreNodes?: boolean;
}

export type OpenNodeEventName =
  | "projectChanged"
  | "selectionChanged"
  | "nodeCreated"
  | "nodeDeleted"
  | "connectionCreated"
  | "connectionRejected"
  | "executionStarted"
  | "executionProgress"
  | "executionFinished"
  | "executionFailed"
  | "executionCancelled"
  | "timelineChanged"
  | "assetImported"
  | "saveRequested";

export interface OpenNodeEvent<T = unknown> {
  type: OpenNodeEventName;
  detail: T;
  timestamp: string;
}

type EventListener<T = unknown> = (event: OpenNodeEvent<T>) => void;

export interface OpenNodeInstance {
  readonly mode: OpenNodeMode;
  readonly store: ProjectStore;
  readonly history: CommandHistory;
  readonly nodeRegistry: NodeRegistry;
  readonly typeRegistry: TypeRegistry;
  readonly assetRegistry: AssetRegistry;
  readonly runtime: ExecutionRuntime;
  readonly timelineRuntime: TimelineRuntime;
  readonly machineApi: MachineApi;
  readonly plugins: PluginManager;
  load(project: OpenNodeProject | string): void;
  serialize(): OpenNodeProject;
  serializeJson(pretty?: boolean): string;
  run(options?: ExecutionRunOptions): ExecutionSession;
  cancel(): void;
  registerNode(definition: NodeDefinition): void;
  registerType(definition: TypeDefinition): void;
  registerPlugin(plugin: OpenNodePlugin): Promise<void>;
  on<T = unknown>(event: OpenNodeEventName, listener: EventListener<T>): () => void;
  once<T = unknown>(event: OpenNodeEventName, listener: EventListener<T>): () => void;
  viewport: {
    goToOrigin(): void;
    fitAll(): void;
    fitSelection(): void;
    get(): ViewportState;
    set(viewport: ViewportState): void;
  };
  timeline: {
    play(): void;
    pause(): void;
    stop(): void;
    setTime(seconds: number): void;
    setFrame(frame: number): void;
  };
  destroy(): Promise<void>;
}

export function createOpenNode(options: CreateOpenNodeOptions = {}): OpenNodeInstance {
  const mode = normalizeMode(options.mode);
  const visualOnly = options.visualOnly === true;
  const initialProject = parseInitialProject(options.project);
  const typeRegistry = createCoreTypeRegistry();
  for (const definition of options.typeDefinitions ?? []) typeRegistry.register(definition);
  const nodeRegistry = new NodeRegistry();
  if (options.registerCoreNodes !== false) registerCoreNodes(nodeRegistry);
  for (const definition of options.nodeDefinitions ?? []) nodeRegistry.register(definition);
  const migratedProject = { ...initialProject, nodes: initialProject.nodes.map((node) => nodeRegistry.migrate(node)) };
  const store = new ProjectStore(migratedProject);
  const history = new CommandHistory();
  const assets = options.adapters?.assets ?? new AssetRegistry();
  for (const asset of initialProject.assets) assets.upsert(asset);
  const backendRegistry = new BackendRegistry();
  for (const backend of options.adapters?.executionBackends ?? []) backendRegistry.register(backend);
  const runtime = new ExecutionRuntime(nodeRegistry, backendRegistry);
  for (const [id, service] of Object.entries(options.adapters?.services ?? {})) runtime.services.set(id, service);
  runtime.services.set("assets", assets);
  const timeline = new TimelineRuntime(initialProject.timeline);
  const telemetry = options.adapters?.telemetry instanceof TelemetryMonitor
    ? options.adapters.telemetry
    : new TelemetryMonitor(options.adapters?.telemetry ?? new BrowserTelemetryAdapter());
  const controller: OpenNodeEditorController = { store, history, nodes: nodeRegistry, types: typeRegistry, runtime, timeline, assets, telemetry };
  const plugins = new PluginManager(nodeRegistry, typeRegistry);
  const machineApi = new MachineApi(
    { store, history, nodes: nodeRegistry, types: typeRegistry, runtime, timeline },
    options.adapters?.machineApi ?? { permissions: { scopes: visualOnly ? ["read", "write", "files"] : ["read", "write", "execute", "timeline", "files"], maxTransactionOperations: 200 } },
  );
  const listeners = new Map<OpenNodeEventName, Set<EventListener>>();
  const emit = (type: OpenNodeEventName, detail: unknown) => {
    const event = { type, detail, timestamp: new Date().toISOString() };
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  let activeSession: ExecutionSession | undefined;
  let root: Root | undefined;
  const editorRef = createRef<OpenNodeEditorHandle>();
  let destroyed = false;
  let reactiveTimer: ReturnType<typeof setTimeout> | undefined;
  let previousProject = store.snapshot();
  const autosave = mode === "standalone" && typeof localStorage !== "undefined" ? new AutosaveController(new LocalStorageAutosaveAdapter(localStorage)) : undefined;

  const unsubscribeStore = store.subscribe((event: ProjectChangeEvent) => {
    emit("projectChanged", event);
    const previousNodeIds = new Set(previousProject.nodes.map((node) => node.id));
    const currentNodeIds = new Set(event.project.nodes.map((node) => node.id));
    for (const node of event.project.nodes) if (!previousNodeIds.has(node.id)) emit("nodeCreated", node);
    for (const node of previousProject.nodes) if (!currentNodeIds.has(node.id)) emit("nodeDeleted", node);
    const previousConnections = new Set(previousProject.connections.map((connection) => connection.id));
    for (const connection of event.project.connections) if (!previousConnections.has(connection.id)) emit("connectionCreated", connection);
    previousProject = structuredClone(event.project);
    if (!readOnlyMode(mode) && event.reason !== "viewport") autosave?.schedule(event.project);
    if (!visualOnly && event.project.execution.mode === "reactive" && !["viewport", "load"].includes(event.reason) && activeSession?.status !== "running") {
      if (reactiveTimer) clearTimeout(reactiveTimer);
      reactiveTimer = setTimeout(() => startRun({ mode: "reactive" }), 80);
    }
  });
  const unsubscribeTimeline = timeline.subscribe((event) => emit("timelineChanged", event));

  const startRun = (runOptions: ExecutionRunOptions = {}): ExecutionSession => {
    if (destroyed) throw new Error("Open Node instance is destroyed");
    if (visualOnly) throw new Error("Execution is disabled in visual-only mode");
    const session = runtime.run(store.snapshot(), { timeline: timeline.context, services: { assets }, ...runOptions });
    activeSession = session;
    emit("executionStarted", { sessionId: session.id, mode: session.mode });
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "progress" || event.type === "element") emit("executionProgress", session.progress);
    });
    void session.completion.then((completed) => {
      unsubscribe();
      if (completed.status === "success") emit("executionFinished", completed);
      else if (completed.status === "cancelled") emit("executionCancelled", completed);
      else emit("executionFailed", completed);
    });
    return session;
  };

  const container = mode === "headless" ? undefined : resolveContainer(options.container);
  if (container) {
    root = createRoot(container);
    root.render(createElement(OpenNodeEditor, {
      ref: editorRef,
      controller,
      mode: mode === "standalone" ? "standalone" : mode === "embedded-readonly" ? "embedded-readonly" : "embedded-edit",
      themeTokens: options.themeTokens,
      visualOnly,
      onSaveRequest: async (project: OpenNodeProject) => {
        emit("saveRequested", project);
        await options.onSaveRequest?.(project);
      },
      onOpenRequest: (source: string) => instance.load(source),
    }));
  }

  const instance: OpenNodeInstance = {
    mode,
    store,
    history,
    nodeRegistry,
    typeRegistry,
    assetRegistry: assets,
    runtime,
    timelineRuntime: timeline,
    machineApi,
    plugins,
    load(project) {
      const parsed = parseInitialProject(project);
      const migrated = { ...parsed, nodes: parsed.nodes.map((node) => nodeRegistry.migrate(node)) };
      store.replace(migrated, "load");
      history.clear();
      timeline.configure(migrated.timeline);
      for (const asset of migrated.assets) assets.upsert(asset);
    },
    serialize: () => store.snapshot(),
    serializeJson: (pretty = true) => serializeProject(store.project, pretty),
    run: startRun,
    cancel: () => activeSession?.cancel(),
    registerNode: (definition) => nodeRegistry.register(definition),
    registerType: (definition) => typeRegistry.register(definition),
    registerPlugin: (plugin) => plugins.register(plugin),
    on<T = unknown>(event: OpenNodeEventName, listener: EventListener<T>) {
      const set = listeners.get(event) ?? new Set<EventListener>();
      set.add(listener as EventListener);
      listeners.set(event, set);
      return () => set.delete(listener as EventListener);
    },
    once<T = unknown>(event: OpenNodeEventName, listener: EventListener<T>) {
      const unsubscribe = instance.on<T>(event, (payload) => { unsubscribe(); listener(payload); });
      return unsubscribe;
    },
    viewport: {
      goToOrigin() {
        if (editorRef.current) editorRef.current.goToOrigin();
        else store.mutate((draft) => { draft.viewport = { ...draft.viewport, x: 0, y: 0 }; }, "viewport");
      },
      fitAll: () => editorRef.current?.fitAll(),
      fitSelection: () => editorRef.current?.fitSelection(),
      get: () => editorRef.current?.getViewport() ?? structuredClone(store.project.viewport),
      set(viewport) {
        if (editorRef.current) editorRef.current.setViewport(viewport);
        else store.mutate((draft) => { draft.viewport = viewport; }, "viewport");
      },
    },
    timeline: {
      play: () => timeline.play(),
      pause: () => timeline.pause(),
      stop: () => timeline.stop(),
      setTime(seconds) {
        timeline.setTime(seconds);
        store.mutate((draft) => { draft.timeline.currentTime = timeline.context.timeSeconds; }, "timeline");
      },
      setFrame(frame) {
        timeline.setFrame(frame);
        store.mutate((draft) => { draft.timeline.currentTime = timeline.context.timeSeconds; }, "timeline");
      },
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      if (reactiveTimer) clearTimeout(reactiveTimer);
      activeSession?.cancel();
      unsubscribeStore();
      unsubscribeTimeline();
      root?.unmount();
      timeline.destroy();
      telemetry.stop();
      autosave?.dispose();
      await plugins.dispose();
      await runtime.dispose();
      listeners.clear();
    },
  };

  for (const plugin of options.plugins ?? []) void plugins.register(plugin);
  return instance;
}

export function createHeadlessOpenNode(options: Omit<CreateOpenNodeOptions, "container" | "mode"> = {}): OpenNodeInstance {
  return createOpenNode({ ...options, mode: "headless" });
}

function normalizeMode(mode: CreateOpenNodeOptions["mode"]): OpenNodeMode {
  if (mode === "edit") return "embedded-edit";
  if (mode === "readonly") return "embedded-readonly";
  return mode ?? "embedded-edit";
}

function parseInitialProject(value?: OpenNodeProject | string): OpenNodeProject {
  if (!value) return createEmptyProject();
  const report = loadProjectJson(value);
  if (!report.valid || !report.project) throw new Error(`Invalid Open Node project: ${report.issues.map((issue) => issue.message).join("; ")}`);
  return report.project;
}

function resolveContainer(container?: HTMLElement | string): HTMLElement {
  if (typeof container === "string") {
    const element = document.querySelector<HTMLElement>(container);
    if (!element) throw new Error(`Open Node container not found: ${container}`);
    return element;
  }
  if (container) return container;
  throw new Error("A container is required outside headless mode");
}

function readOnlyMode(mode: OpenNodeMode): boolean {
  return mode === "embedded-readonly";
}
