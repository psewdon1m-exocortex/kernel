import {
  downstreamIds,
  getComputationalElement,
  topologicalSort,
  upstreamIds,
  validateProject,
  type BackendId,
  type ContainerInstance,
  type ElementExecutionState,
  type ExecutionError,
  type ExecutionMode,
  type NodeInstance,
  type OpenNodeProject,
  type TimelineContext,
  type ValueEnvelope,
} from "@open-node/model";
import { BoundedAsyncQueue, DagScheduler, type SchedulerTask } from "@open-node/scheduler";
import type { ExecuteContext, NodeDefinition, NodeExecutionResult, NodeRegistry, NodeStreamResult } from "@open-node/sdk";

export interface BackendExecutionRequest {
  definition: NodeDefinition;
  context: ExecuteContext;
}

export interface ExecutionBackend {
  readonly id: BackendId;
  readonly available: boolean;
  canExecute(definition: NodeDefinition): boolean;
  execute(request: BackendExecutionRequest): Promise<NodeExecutionResult>;
  dispose?(): void | Promise<void>;
}

export class MainThreadBackend implements ExecutionBackend {
  readonly id = "main" as const;
  readonly available = true;

  canExecute(definition: NodeDefinition): boolean {
    return definition.capabilities?.cpu !== false && Boolean(definition.execute);
  }

  async execute({ definition, context }: BackendExecutionRequest): Promise<NodeExecutionResult> {
    if (!definition.execute) throw new Error(`Node has no one-shot executor: ${definition.typeId}`);
    return definition.execute(context);
  }
}

export interface WorkerDispatchRequest {
  typeId: string;
  version: string;
  node: NodeInstance;
  params: Record<string, unknown>;
  inputs: Readonly<Record<string, ValueEnvelope | undefined>>;
  timeline: TimelineContext;
  services: string[];
}

export type WorkerDispatcher = (request: WorkerDispatchRequest, signal: AbortSignal, onProgress: (value: number, message?: string) => void) => Promise<NodeExecutionResult>;

export class WorkerBackend implements ExecutionBackend {
  readonly id = "worker" as const;

  constructor(
    private readonly dispatch: WorkerDispatcher,
    readonly available = typeof Worker !== "undefined",
  ) {}

  canExecute(definition: NodeDefinition): boolean {
    return this.available && definition.capabilities?.worker === true;
  }

  execute({ definition, context }: BackendExecutionRequest): Promise<NodeExecutionResult> {
    return this.dispatch(
      {
        typeId: definition.typeId,
        version: definition.version,
        node: context.node,
        params: context.params,
        inputs: context.inputs,
        timeline: context.timeline,
        services: Object.keys(context.services),
      },
      context.signal,
      context.reportProgress,
    );
  }
}

export interface GpuBackend extends ExecutionBackend {
  readonly id: "gpu";
  deviceInfo(): Promise<Record<string, unknown>>;
  releaseResources(): void | Promise<void>;
}

export interface HostBackend extends ExecutionBackend {
  readonly id: "host";
}

export class BackendRegistry {
  #backends = new Map<BackendId, ExecutionBackend>();

  constructor() {
    this.register(new MainThreadBackend());
  }

  register(backend: ExecutionBackend): this {
    if (this.#backends.has(backend.id)) throw new Error(`Execution backend already registered: ${backend.id}`);
    this.#backends.set(backend.id, backend);
    return this;
  }

  get(id: BackendId): ExecutionBackend | undefined {
    return this.#backends.get(id);
  }

  list(): ExecutionBackend[] {
    return [...this.#backends.values()];
  }

  select(definition: NodeDefinition, preferred: BackendId | "auto", nodePreferred?: BackendId | "auto"): ExecutionBackend {
    if (definition.resources?.backendPolicy === "gpu-required") {
      const gpu = this.#backends.get("gpu");
      if (gpu?.available && gpu.canExecute(definition)) return gpu;
      throw new Error(`GPU backend is required but unavailable for ${definition.typeId}`);
    }
    const candidates: BackendId[] = [];
    const requested = nodePreferred && nodePreferred !== "auto" ? nodePreferred : preferred !== "auto" ? preferred : definition.resources?.preferredBackend;
    if (requested) candidates.push(requested);
    if (definition.resources?.backendPolicy !== "cpu-only" && definition.capabilities?.gpu) candidates.push("gpu");
    if (definition.capabilities?.worker) candidates.push("worker");
    candidates.push("main", "host");
    for (const id of [...new Set(candidates)]) {
      const backend = this.#backends.get(id);
      if (backend?.available && backend.canExecute(definition)) return backend;
    }
    throw new Error(`No execution backend is available for ${definition.typeId}`);
  }

  async dispose(): Promise<void> {
    await Promise.all(this.list().map((backend) => backend.dispose?.()));
    this.#backends.clear();
  }
}

export interface ExecutionWorkerMessage {
  id: string;
  type: "execute" | "cancel";
  request?: WorkerDispatchRequest;
}

export interface ExecutionWorkerResponse {
  id: string;
  type: "progress" | "result" | "error";
  progress?: number;
  message?: string;
  result?: NodeExecutionResult;
  error?: { message: string; stack?: string };
}

export function createWorkerDispatcher(factory: () => Worker): WorkerDispatcher {
  return (request, signal, onProgress) => new Promise<NodeExecutionResult>((resolve, reject) => {
    const worker = factory();
    const id = `worker-task-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      worker.postMessage({ id, type: "cancel" } satisfies ExecutionWorkerMessage);
      cleanup();
      reject(signal.reason ?? new DOMException("Worker execution cancelled", "AbortError"));
    };
    worker.addEventListener("message", (event: MessageEvent<ExecutionWorkerResponse>) => {
      const response = event.data;
      if (response.id !== id) return;
      if (response.type === "progress") onProgress(response.progress ?? 0, response.message);
      if (response.type === "result" && response.result) { cleanup(); resolve(response.result); }
      if (response.type === "error") { cleanup(); const error = new Error(response.error?.message ?? "Worker execution failed"); if (response.error?.stack) error.stack = response.error.stack; reject(error); }
    });
    worker.addEventListener("error", (event) => { cleanup(); reject(new Error(event.message || "Worker crashed")); }, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    worker.postMessage({ id, type: "execute", request } satisfies ExecutionWorkerMessage);
  });
}

export interface WorkerMessagePort {
  addEventListener(type: "message", listener: (event: MessageEvent<ExecutionWorkerMessage>) => void): void;
  postMessage(message: ExecutionWorkerResponse): void;
}

export function installExecutionWorker(port: WorkerMessagePort, registry: NodeRegistry, services: Readonly<Record<string, unknown>> = {}): void {
  const controllers = new Map<string, AbortController>();
  port.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "cancel") { controllers.get(message.id)?.abort(); return; }
    if (message.type !== "execute" || !message.request) return;
    const request = message.request;
    const controller = new AbortController();
    controllers.set(message.id, controller);
    const definition = registry.get(request.typeId, request.version);
    if (!definition?.execute) {
      port.postMessage({ id: message.id, type: "error", error: { message: `Worker Node definition is unavailable: ${request.typeId}@${request.version}` } });
      controllers.delete(message.id);
      return;
    }
    void definition.execute({
      node: request.node,
      params: request.params,
      inputs: request.inputs,
      signal: controller.signal,
      backend: "worker",
      timeline: request.timeline,
      services,
      reportProgress: (progress, detail) => port.postMessage({ id: message.id, type: "progress", progress, ...(detail ? { message: detail } : {}) }),
    }).then((result) => port.postMessage({ id: message.id, type: "result", result }))
      .catch((error: unknown) => port.postMessage({ id: message.id, type: "error", error: { message: error instanceof Error ? error.message : String(error), ...(error instanceof Error && error.stack ? { stack: error.stack } : {}) } }))
      .finally(() => controllers.delete(message.id));
  });
}

export interface ExecutionProgress {
  completed: number;
  total: number;
  percent: number | null;
  currentElementId?: string;
  status: "queued" | "running" | "success" | "error" | "cancelled";
  elapsedMs: number;
}

export interface ExecutionSessionEvent {
  type: "started" | "progress" | "element" | "finished" | "failed" | "cancelled";
  session: ExecutionSession;
  elementId?: string;
}

export interface ExecutionRunOptions {
  mode?: ExecutionMode;
  scope?: "all" | "selected" | "downstream" | "from";
  elementIds?: string[];
  signal?: AbortSignal;
  timeline?: Partial<TimelineContext>;
  allowSideEffects?: boolean;
  services?: Readonly<Record<string, unknown>>;
  concurrency?: number;
}

export interface StreamRunOptions {
  inputs?: Readonly<Record<string, ValueEnvelope | undefined>>;
  streams?: Readonly<Record<string, AsyncIterable<ValueEnvelope> | undefined>>;
  timeline?: Partial<TimelineContext>;
  services?: Readonly<Record<string, unknown>>;
  capacity?: number;
  backpressure?: "block" | "drop-oldest" | "drop-newest";
  allowSideEffects?: boolean;
}

export class NodeStreamSession implements AsyncIterable<NodeStreamResult> {
  readonly id = `stream-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  readonly queue: BoundedAsyncQueue<NodeStreamResult>;
  readonly startedAt = performance.now();
  processedItems = 0;
  error?: unknown;
  status: "streaming" | "success" | "error" | "cancelled" = "streaming";
  readonly completion: Promise<this>;
  #controller = new AbortController();

  constructor(producer: (signal: AbortSignal) => AsyncIterable<NodeStreamResult>, capacity: number, policy: "block" | "drop-oldest" | "drop-newest") {
    this.queue = new BoundedAsyncQueue(capacity, policy);
    this.completion = this.#consume(producer);
  }

  get signal(): AbortSignal { return this.#controller.signal; }
  get throughputPerSecond(): number { const elapsed = performance.now() - this.startedAt; return elapsed > 0 ? this.processedItems * 1000 / elapsed : 0; }

  cancel(reason?: unknown): void {
    this.#controller.abort(reason ?? new DOMException("Stream cancelled", "AbortError"));
  }

  [Symbol.asyncIterator](): AsyncIterator<NodeStreamResult> {
    return this.queue[Symbol.asyncIterator]();
  }

  async #consume(producer: (signal: AbortSignal) => AsyncIterable<NodeStreamResult>): Promise<this> {
    try {
      for await (const result of producer(this.#controller.signal)) {
        await this.queue.enqueue(result, this.#controller.signal);
        this.processedItems += 1;
      }
      this.status = this.#controller.signal.aborted ? "cancelled" : "success";
      this.queue.close();
    } catch (error) {
      if (this.#controller.signal.aborted) {
        this.status = "cancelled";
        this.queue.close();
      } else {
        this.status = "error";
        this.error = error;
        this.queue.close(error);
      }
    }
    return this;
  }
}

export interface ElementExecutionResult {
  elementId: string;
  outputs: Record<string, ValueEnvelope>;
  backend: BackendId;
  durationMs: number;
  cached: boolean;
}

export class ExecutionSession {
  readonly id = `session-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  readonly startedAt = performance.now();
  finishedAt?: number;
  status: ExecutionProgress["status"] = "queued";
  progress: ExecutionProgress;
  readonly elementStates = new Map<string, ElementExecutionState>();
  readonly results = new Map<string, ElementExecutionResult>();
  readonly errors: ExecutionError[] = [];
  readonly completion: Promise<this>;
  #controller = new AbortController();
  #listeners = new Set<(event: ExecutionSessionEvent) => void>();
  #resolve!: (session: this) => void;
  #reject!: (error: unknown) => void;

  constructor(
    readonly mode: ExecutionMode,
    total: number,
  ) {
    this.progress = { completed: 0, total, percent: total > 0 ? 0 : 100, status: "queued", elapsedMs: 0 };
    this.completion = new Promise<this>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  subscribe(listener: (event: ExecutionSessionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  cancel(reason?: unknown): void {
    this.#controller.abort(reason ?? new DOMException("Execution cancelled", "AbortError"));
  }

  _event(type: ExecutionSessionEvent["type"], elementId?: string): void {
    const event: ExecutionSessionEvent = { type, session: this, ...(elementId ? { elementId } : {}) };
    for (const listener of this.#listeners) listener(event);
  }

  _finish(status: ExecutionProgress["status"]): void {
    this.status = status;
    this.finishedAt = performance.now();
    this.progress = { ...this.progress, status, elapsedMs: this.finishedAt - this.startedAt, percent: status === "success" ? 100 : this.progress.percent };
    this._event(status === "success" ? "finished" : status === "cancelled" ? "cancelled" : "failed");
    this.#resolve(this);
  }

  _fail(error: unknown): void {
    this.status = "error";
    this.finishedAt = performance.now();
    this._event("failed");
    this.#reject(error);
  }
}

export class ExecutionRuntime {
  readonly backends: BackendRegistry;
  readonly scheduler = new DagScheduler();
  readonly cache = new Map<string, NodeExecutionResult>();
  readonly services = new Map<string, unknown>();
  #sessions = new Map<string, ExecutionSession>();

  constructor(
    readonly nodeRegistry: NodeRegistry,
    backends?: BackendRegistry,
  ) {
    this.backends = backends ?? new BackendRegistry();
  }

  getSession(id: string): ExecutionSession | undefined {
    return this.#sessions.get(id);
  }

  listSessions(): ExecutionSession[] {
    return [...this.#sessions.values()];
  }

  run(project: OpenNodeProject, options: ExecutionRunOptions = {}): ExecutionSession {
    const validation = validateProject(project);
    if (!validation.valid) throw new Error(`Cannot execute invalid project: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    const included = resolveScope(project, options.scope ?? "all", options.elementIds ?? []);
    const sorted = topologicalSort(project, included);
    const session = new ExecutionSession(options.mode ?? project.execution.mode, sorted.length);
    this.#sessions.set(session.id, session);
    for (const id of sorted) session.elementStates.set(id, { status: "queued", progress: 0 });
    const externalAbort = () => session.cancel(options.signal?.reason);
    options.signal?.addEventListener("abort", externalAbort, { once: true });
    queueMicrotask(() => {
      this.#execute(project, sorted, session, options)
        .catch((error) => session._fail(error))
        .finally(() => options.signal?.removeEventListener("abort", externalAbort));
    });
    return session;
  }

  streamNode(project: OpenNodeProject, nodeId: string, options: StreamRunOptions = {}): NodeStreamSession {
    const node = project.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error(`Streaming Node not found: ${nodeId}`);
    const definition = this.nodeRegistry.get(node.nodeTypeId, node.nodeTypeVersion);
    if (!definition?.executeStream || !definition.capabilities?.streaming) throw new Error(`Node does not support streaming: ${node.nodeTypeId}`);
    if (definition.sideEffect && !options.allowSideEffects) throw new Error(`Explicit side-effect permission required for ${definition.displayName}`);
    const validation = definition.validate(node.parameters);
    if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.message).join("; "));
    const timeline = createTimelineContext(project, options.timeline);
    const services = { ...Object.fromEntries(this.services), ...(options.services ?? {}) };
    return new NodeStreamSession(
      (signal) => definition.executeStream!({
        node,
        params: node.parameters,
        inputs: options.inputs ?? {},
        streams: options.streams ?? {},
        signal,
        backend: "main",
        timeline,
        services,
        reportProgress: () => undefined,
      }),
      options.capacity ?? project.execution.continuousQueueSize,
      options.backpressure ?? project.execution.backpressure,
    );
  }

  invalidate(project: OpenNodeProject, elementIds: Iterable<string>): void {
    const affected = downstreamIds(project, elementIds);
    for (const key of this.cache.keys()) {
      if ([...affected].some((id) => key.startsWith(`${id}:`))) this.cache.delete(key);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  async dispose(): Promise<void> {
    for (const session of this.#sessions.values()) session.cancel();
    await this.backends.dispose();
    this.#sessions.clear();
    this.cache.clear();
    this.services.clear();
  }

  async #execute(project: OpenNodeProject, sorted: string[], session: ExecutionSession, options: ExecutionRunOptions): Promise<void> {
    session.status = "running";
    session.progress = { ...session.progress, status: "running" };
    session._event("started");
    const timeline = createTimelineContext(project, options.timeline);
    const tasks: SchedulerTask<ElementExecutionResult>[] = sorted.map((elementId) => {
      const element = getComputationalElement(project, elementId);
      const incoming = project.connections.filter((connection) => connection.kind !== "decorative" && connection.target.elementId === elementId && sorted.includes(connection.source.elementId));
      return {
        id: elementId,
        dependencies: [...new Set(incoming.map((connection) => connection.source.elementId))],
        priority: element?.kind === "node" ? element.runtimeHints.priority : 0,
        parallelSafe: elementParallelSafe(project, elementId, this.nodeRegistry),
        run: async ({ signal, dependencyResults }) => {
          const inputs: Record<string, ValueEnvelope | undefined> = {};
          for (const connection of incoming) {
            if (connection.kind === "decorative") continue;
            const sourceResult = dependencyResults.get(connection.source.elementId) as ElementExecutionResult | undefined;
            const value = sourceResult?.outputs[connection.source.portId];
            const existing = inputs[connection.target.portId];
            inputs[connection.target.portId] = existing && value ? { typeId: `list<${value.typeId}>`, value: [existing.value, value.value] } : value;
          }
          return this.#executeElement(project, elementId, inputs, session, signal, timeline, options);
        },
      };
    });
    const handle = this.scheduler.schedule(tasks, {
      concurrency: options.concurrency ?? project.execution.concurrency,
      signal: session.signal,
      stopOnError: false,
      onEvent: (event) => {
        const state = session.elementStates.get(event.taskId) ?? { status: "idle", progress: null };
        const status = event.status === "skipped" ? "cancelled" : event.status;
        if (status !== "error" && status !== "success" && status !== "cancelled" && status !== "running" && status !== "queued") return;
        session.elementStates.set(event.taskId, { ...state, status });
        session.progress = {
          completed: event.completed,
          total: event.total,
          percent: event.total > 0 ? Math.round((event.completed / event.total) * 100) : 100,
          currentElementId: event.taskId,
          status: session.signal.aborted ? "cancelled" : event.status === "error" ? "error" : "running",
          elapsedMs: performance.now() - session.startedAt,
        };
        session._event(event.status === "running" ? "element" : "progress", event.taskId);
      },
    });
    const result = await handle.result;
    for (const [id, value] of result.results) session.results.set(id, value);
    if (result.status === "cancelled") session._finish("cancelled");
    else if (result.status === "error") session._finish("error");
    else session._finish("success");
  }

  async #executeElement(
    project: OpenNodeProject,
    elementId: string,
    inputs: Record<string, ValueEnvelope | undefined>,
    session: ExecutionSession,
    signal: AbortSignal,
    timeline: TimelineContext,
    options: ExecutionRunOptions,
  ): Promise<ElementExecutionResult> {
    const element = getComputationalElement(project, elementId);
    if (!element) throw new Error(`Computational element not found: ${elementId}`);
    const startedAt = performance.now();
    if (element.kind === "container") return this.#executeContainer(project, element, inputs, session, signal, timeline, options, startedAt);
    const definition = this.nodeRegistry.get(element.nodeTypeId, element.nodeTypeVersion);
    if (!definition || element.unresolved) throw this.#recordError(session, element.id, "UNRESOLVED_NODE", element.unresolved?.reason ?? `Definition missing: ${element.nodeTypeId}@${element.nodeTypeVersion}`, "main");
    const backend = this.backends.select(definition, project.execution.preferredBackend, element.runtimeHints.preferredBackend);
    const result = await this.#executeNode(project, element, definition, inputs, session, signal, timeline, options, backend);
    return { elementId, outputs: result.outputs, backend: backend.id, durationMs: performance.now() - startedAt, cached: result.cached };
  }

  async #executeNode(
    project: OpenNodeProject,
    node: NodeInstance,
    definition: NodeDefinition,
    inputs: Record<string, ValueEnvelope | undefined>,
    session: ExecutionSession,
    signal: AbortSignal,
    timeline: TimelineContext,
    options: ExecutionRunOptions,
    backend: ExecutionBackend,
  ): Promise<NodeExecutionResult & { cached: boolean }> {
    const state = session.elementStates.get(node.id) ?? { status: "running" as const, progress: 0 };
    session.elementStates.set(node.id, { ...state, backend: backend.id, status: "running", startedAt: performance.now() });
    const validation = definition.validate(node.parameters);
    if (!validation.valid) throw this.#recordError(session, node.id, "INVALID_PARAMETERS", validation.issues.map((issue) => issue.message).join("; "), backend.id);
    if (definition.sideEffect && !options.allowSideEffects) throw this.#recordError(session, node.id, "SIDE_EFFECT_PERMISSION_REQUIRED", `Explicit permission required for ${definition.displayName}`, backend.id);
    const defaults = Object.fromEntries(definition.inputs.filter((port) => inputs[port.id] === undefined && port.defaultValue !== undefined).map((port) => [port.id, { typeId: port.typeId, value: structuredClone(port.defaultValue) }]));
    const resolvedInputs = { ...defaults, ...inputs };
    if (node.bypassed) {
      const bypass = applyBypass(definition, resolvedInputs);
      session.elementStates.set(node.id, { ...state, backend: backend.id, status: "bypassed", progress: 1, finishedAt: performance.now() });
      return { ...bypass, cached: false };
    }
    const cacheKey = `${node.id}:${stableStringify({ version: definition.version, params: node.parameters, inputs: resolvedInputs, timeline: definition.capabilities?.timelineAware ? timeline : undefined })}`;
    const cacheEnabled = project.execution.cacheEnabled && projectCacheEnabled(node, definition) && session.mode !== "continuous";
    const cached = cacheEnabled ? this.cache.get(cacheKey) : undefined;
    if (cached) {
      session.elementStates.set(node.id, { ...state, backend: backend.id, status: "success", progress: 1, finishedAt: performance.now() });
      return { ...structuredClone(cached), cached: true };
    }
    const timeoutMs = node.runtimeHints.timeoutMs ?? project.execution.nodeTimeoutMs;
    const timeout = createTimeoutSignal(signal, timeoutMs);
    try {
      const result = await backend.execute({
        definition,
        context: {
          node,
          params: node.parameters,
          inputs: resolvedInputs,
          signal: timeout.signal,
          backend: backend.id,
          timeline,
          services: { ...Object.fromEntries(this.services), ...(options.services ?? {}) },
          reportProgress: (progress) => {
            const current = session.elementStates.get(node.id) ?? state;
            session.elementStates.set(node.id, { ...current, status: "running", progress: clamp(progress, 0, 1) });
            session._event("progress", node.id);
          },
        },
      });
      assertOutputs(definition, result);
      if (cacheEnabled) this.cache.set(cacheKey, structuredClone(result));
      session.elementStates.set(node.id, { ...state, backend: backend.id, status: "success", progress: 1, finishedAt: performance.now() });
      return { ...result, cached: false };
    } catch (error) {
      const formal = this.#recordError(session, node.id, timeout.signal.aborted && !signal.aborted ? "NODE_TIMEOUT" : signal.aborted ? "EXECUTION_CANCELLED" : "NODE_EXECUTION_FAILED", error instanceof Error ? error.message : String(error), backend.id, error);
      session.elementStates.set(node.id, { ...state, backend: backend.id, status: signal.aborted ? "cancelled" : "error", progress: null, error: formal, finishedAt: performance.now() });
      throw formal;
    } finally {
      timeout.dispose();
    }
  }

  async #executeContainer(
    project: OpenNodeProject,
    container: ContainerInstance,
    inputs: Record<string, ValueEnvelope | undefined>,
    session: ExecutionSession,
    signal: AbortSignal,
    timeline: TimelineContext,
    options: ExecutionRunOptions,
    startedAt: number,
  ): Promise<ElementExecutionResult> {
    let value = inputs[container.inputPort.id] ?? { typeId: "core.any", value: undefined };
    if (container.bypassed) return { elementId: container.id, outputs: { [container.outputPort.id]: value }, backend: "main", durationMs: performance.now() - startedAt, cached: false };
    for (let index = 0; index < container.nodeIds.length; index += 1) {
      if (signal.aborted) throw signal.reason;
      const nodeId = container.nodeIds[index];
      const node = project.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) throw this.#recordError(session, container.id, "CONTAINER_NODE_MISSING", `Container Node is missing: ${nodeId}`, "main");
      const definition = this.nodeRegistry.get(node.nodeTypeId, node.nodeTypeVersion);
      if (!definition?.containerAdapter || !definition.containerCompatible) throw this.#recordError(session, node.id, "CONTAINER_INCOMPATIBLE_NODE", `${node.nodeTypeId} is not Container-compatible`, "main");
      session.elementStates.set(node.id, { status: "running", progress: 0, backend: "main", startedAt: performance.now() });
      if (!node.bypassed) {
        try {
          value = await definition.containerAdapter({
            node,
            params: node.parameters,
            value,
            signal,
            timeline,
            services: { ...Object.fromEntries(this.services), ...(options.services ?? {}) },
          });
          session.elementStates.set(node.id, { status: "success", progress: 1, backend: "main", finishedAt: performance.now() });
        } catch (error) {
          const formal = this.#recordError(session, node.id, "CONTAINER_NODE_FAILED", error instanceof Error ? error.message : String(error), "main", error);
          session.elementStates.set(node.id, { status: "error", progress: null, backend: "main", error: formal, finishedAt: performance.now() });
          throw formal;
        }
      } else {
        session.elementStates.set(node.id, { status: "bypassed", progress: 1, backend: "main", finishedAt: performance.now() });
      }
      session.elementStates.set(container.id, { status: "running", progress: (index + 1) / Math.max(1, container.nodeIds.length), backend: "main" });
    }
    return { elementId: container.id, outputs: { [container.outputPort.id]: value }, backend: "main", durationMs: performance.now() - startedAt, cached: false };
  }

  #recordError(session: ExecutionSession, nodeId: string, code: string, message: string, backend: BackendId, cause?: unknown): ExecutionError {
    const error: ExecutionError = {
      code,
      message,
      nodeId,
      portId: null,
      backend,
      stack: cause instanceof Error ? cause.stack ?? null : null,
      timestamp: new Date().toISOString(),
    };
    session.errors.push(error);
    return error;
  }
}

export interface ContinuousMetrics {
  processedItems: number;
  errors: number;
  throughputPerSecond: number;
  elapsedMs: number;
  queueSize: number;
  droppedItems: number;
}

export class ContinuousRuntime {
  readonly queue: BoundedAsyncQueue<OpenNodeProject>;
  #controller = new AbortController();
  #processed = 0;
  #errors = 0;
  #startedAt = performance.now();
  #running?: Promise<void>;

  constructor(
    private readonly runtime: ExecutionRuntime,
    capacity = 64,
    policy: "block" | "drop-oldest" | "drop-newest" = "drop-oldest",
  ) {
    this.queue = new BoundedAsyncQueue(capacity, policy);
  }

  get metrics(): ContinuousMetrics {
    const elapsedMs = performance.now() - this.#startedAt;
    return {
      processedItems: this.#processed,
      errors: this.#errors,
      throughputPerSecond: elapsedMs > 0 ? (this.#processed * 1000) / elapsedMs : 0,
      elapsedMs,
      queueSize: this.queue.metrics.size,
      droppedItems: this.queue.metrics.dropped,
    };
  }

  start(options: Omit<ExecutionRunOptions, "mode"> = {}): void {
    if (this.#running) return;
    this.#startedAt = performance.now();
    this.#running = this.#loop(options);
  }

  enqueue(project: OpenNodeProject): Promise<boolean> {
    return this.queue.enqueue(project, this.#controller.signal);
  }

  async stop(): Promise<void> {
    this.#controller.abort();
    this.queue.close();
    await this.#running;
    this.#running = undefined;
  }

  async #loop(options: Omit<ExecutionRunOptions, "mode">): Promise<void> {
    try {
      for await (const project of this.queue) {
        if (this.#controller.signal.aborted) break;
        const session = this.runtime.run(project, { ...options, mode: "continuous", signal: this.#controller.signal });
        const completed = await session.completion;
        if (completed.status === "success") this.#processed += 1;
        else this.#errors += 1;
      }
    } catch (error) {
      if (!this.#controller.signal.aborted) {
        this.#errors += 1;
        throw error;
      }
    }
  }
}

function resolveScope(project: OpenNodeProject, scope: NonNullable<ExecutionRunOptions["scope"]>, ids: string[]): Set<string> {
  const topLevel = new Set([...project.nodes.filter((node) => !node.parentContainerId).map((node) => node.id), ...project.containers.map((container) => container.id)]);
  if (scope === "all" || ids.length === 0) return topLevel;
  const valid = ids.filter((id) => topLevel.has(id));
  if (scope === "selected") return upstreamIds(project, valid);
  const downstream = downstreamIds(project, valid);
  return upstreamIds(project, downstream);
}

function elementParallelSafe(project: OpenNodeProject, elementId: string, registry: NodeRegistry): boolean {
  const element = getComputationalElement(project, elementId);
  if (!element || element.kind === "container") return false;
  return registry.get(element.nodeTypeId, element.nodeTypeVersion)?.resources?.parallelSafe !== false;
}

function createTimelineContext(project: OpenNodeProject, override?: Partial<TimelineContext>): TimelineContext {
  return {
    timeSeconds: project.timeline.currentTime,
    frame: Math.round(project.timeline.currentTime * project.timeline.fps),
    fps: project.timeline.fps,
    deltaTime: 0,
    playbackState: "stopped",
    ...override,
  };
}

function applyBypass(definition: NodeDefinition, inputs: Record<string, ValueEnvelope | undefined>): NodeExecutionResult {
  const bypass = definition.bypass;
  if (!bypass || bypass.strategy === "unsupported") throw new Error(`Bypass is unsupported for ${definition.typeId}`);
  if (bypass.strategy === "block") return { outputs: {} };
  if (bypass.strategy === "constant") return { outputs: { [bypass.outputPortId]: structuredClone(bypass.value) } };
  const value = inputs[bypass.inputPortId];
  return { outputs: value ? { [bypass.outputPortId]: value } : {} };
}

function projectCacheEnabled(node: NodeInstance, definition: NodeDefinition): boolean {
  return definition.pure && node.runtimeHints.cacheEnabled !== false;
}

function assertOutputs(definition: NodeDefinition, result: NodeExecutionResult): void {
  if (!result || typeof result.outputs !== "object") throw new Error(`Node ${definition.typeId} returned an invalid result`);
  for (const [portId, value] of Object.entries(result.outputs)) {
    const port = definition.outputs.find((candidate) => candidate.id === portId);
    if (!port) throw new Error(`Node ${definition.typeId} returned unknown output port ${portId}`);
    if (!value || typeof value.typeId !== "string" || !("value" in value)) throw new Error(`Node ${definition.typeId} returned an invalid envelope for ${portId}`);
  }
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input && typeof input === "object") {
      if (seen.has(input)) return "[Circular]";
      seen.add(input);
      if (Array.isArray(input)) return input.map(normalize);
      return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]));
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

function createTimeoutSignal(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException(`Node timed out after ${timeoutMs} ms`, "TimeoutError")), Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
