export type TaskStatus = "queued" | "running" | "success" | "error" | "cancelled" | "skipped";

export interface SchedulerTask<T = unknown> {
  id: string;
  dependencies: string[];
  priority?: number;
  parallelSafe?: boolean;
  run(context: SchedulerTaskContext): Promise<T>;
}

export interface SchedulerTaskContext {
  signal: AbortSignal;
  dependencyResults: ReadonlyMap<string, unknown>;
}

export interface SchedulerEvent {
  taskId: string;
  status: TaskStatus;
  completed: number;
  total: number;
  running: number;
  error?: unknown;
}

export interface SchedulerResult<T = unknown> {
  status: "success" | "error" | "cancelled";
  results: Map<string, T>;
  errors: Map<string, unknown>;
  taskStatuses: Map<string, TaskStatus>;
  startedAt: number;
  finishedAt: number;
}

export interface SchedulerOptions {
  concurrency?: number;
  signal?: AbortSignal;
  stopOnError?: boolean;
  onEvent?: (event: SchedulerEvent) => void;
}

export interface SchedulerHandle<T = unknown> {
  readonly result: Promise<SchedulerResult<T>>;
  cancel(reason?: unknown): void;
}

export class DagScheduler {
  schedule<T>(tasks: SchedulerTask<T>[], options: SchedulerOptions = {}): SchedulerHandle<T> {
    validateTasks(tasks);
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    const result = this.#run(tasks, { ...options, signal: controller.signal }).finally(() => options.signal?.removeEventListener("abort", abort));
    return {
      result,
      cancel: (reason?: unknown) => controller.abort(reason ?? new DOMException("Execution cancelled", "AbortError")),
    };
  }

  async #run<T>(tasks: SchedulerTask<T>[], options: SchedulerOptions): Promise<SchedulerResult<T>> {
    const startedAt = performance.now();
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const statuses = new Map(tasks.map((task) => [task.id, "queued" as TaskStatus]));
    const results = new Map<string, T>();
    const errors = new Map<string, unknown>();
    const running = new Map<string, Promise<void>>();
    let completed = 0;

    const emit = (taskId: string, status: TaskStatus, error?: unknown) => {
      statuses.set(taskId, status);
      options.onEvent?.({ taskId, status, completed, total: tasks.length, running: running.size, ...(error === undefined ? {} : { error }) });
    };

    const markSkippedDependents = () => {
      let changed = true;
      while (changed) {
        changed = false;
        for (const task of tasks) {
          if (statuses.get(task.id) !== "queued") continue;
          if (task.dependencies.some((id) => ["error", "cancelled", "skipped"].includes(statuses.get(id) ?? ""))) {
            completed += 1;
            emit(task.id, "skipped");
            changed = true;
          }
        }
      }
    };

    const start = (task: SchedulerTask<T>) => {
      emit(task.id, "running");
      const dependencyResults = new Map(task.dependencies.map((id) => [id, results.get(id)]));
      const promise = task
        .run({ signal: options.signal!, dependencyResults })
        .then((value) => {
          results.set(task.id, value);
          completed += 1;
          emit(task.id, "success");
        })
        .catch((error: unknown) => {
          completed += 1;
          if (options.signal?.aborted || isAbortError(error)) emit(task.id, "cancelled");
          else {
            errors.set(task.id, error);
            emit(task.id, "error", error);
          }
        })
        .finally(() => running.delete(task.id));
      running.set(task.id, promise);
    };

    while (completed < tasks.length) {
      if (options.signal?.aborted) {
        for (const task of tasks) {
          if (statuses.get(task.id) === "queued") {
            completed += 1;
            emit(task.id, "cancelled");
          }
        }
        await Promise.allSettled(running.values());
        break;
      }

      markSkippedDependents();
      if (options.stopOnError && errors.size > 0) {
        for (const task of tasks) {
          if (statuses.get(task.id) === "queued") {
            completed += 1;
            emit(task.id, "skipped");
          }
        }
      }

      const serialRunning = [...running.keys()].some((id) => taskMap.get(id)?.parallelSafe === false);
      const ready = tasks
        .filter((task) => statuses.get(task.id) === "queued" && task.dependencies.every((id) => statuses.get(id) === "success"))
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));

      for (const task of ready) {
        if (running.size >= concurrency || serialRunning) break;
        if (task.parallelSafe === false && running.size > 0) break;
        start(task);
        if (task.parallelSafe === false) break;
      }

      if (running.size === 0) {
        if (completed < tasks.length) throw new Error("Scheduler deadlock: unresolved task dependencies");
        break;
      }
      await Promise.race(running.values());
    }

    const status = options.signal?.aborted ? "cancelled" : errors.size > 0 ? "error" : "success";
    return { status, results, errors, taskStatuses: statuses, startedAt, finishedAt: performance.now() };
  }
}

export function validateTasks(tasks: SchedulerTask[]): void {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error(`Duplicate scheduler task: ${task.id}`);
    ids.add(task.id);
  }
  for (const task of tasks) {
    for (const dependency of task.dependencies) if (!ids.has(dependency)) throw new Error(`Task ${task.id} depends on unknown task ${dependency}`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const map = new Map(tasks.map((task) => [task.id, task]));
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`Scheduler task cycle detected at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of map.get(id)?.dependencies ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
}

export interface QueueMetrics {
  enqueued: number;
  dequeued: number;
  dropped: number;
  size: number;
}

export class BoundedAsyncQueue<T> implements AsyncIterable<T> {
  #values: T[] = [];
  #readers: Array<(result: IteratorResult<T>) => void> = [];
  #writers: Array<() => void> = [];
  #closed = false;
  #error: unknown;
  #enqueued = 0;
  #dequeued = 0;
  #dropped = 0;

  constructor(
    readonly capacity: number,
    readonly policy: "block" | "drop-oldest" | "drop-newest" = "drop-oldest",
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Queue capacity must be a positive integer");
  }

  get metrics(): QueueMetrics {
    return { enqueued: this.#enqueued, dequeued: this.#dequeued, dropped: this.#dropped, size: this.#values.length };
  }

  async enqueue(value: T, signal?: AbortSignal): Promise<boolean> {
    if (this.#closed) throw new Error("Queue is closed");
    if (signal?.aborted) throw signal.reason;
    const reader = this.#readers.shift();
    if (reader) {
      this.#enqueued += 1;
      this.#dequeued += 1;
      reader({ value, done: false });
      return true;
    }
    if (this.#values.length >= this.capacity) {
      if (this.policy === "drop-newest") {
        this.#dropped += 1;
        return false;
      }
      if (this.policy === "drop-oldest") {
        this.#values.shift();
        this.#dropped += 1;
      } else {
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(signal?.reason);
          signal?.addEventListener("abort", abort, { once: true });
          this.#writers.push(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
          });
        });
        return this.enqueue(value, signal);
      }
    }
    this.#values.push(value);
    this.#enqueued += 1;
    return true;
  }

  close(error?: unknown): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#error = error;
    for (const reader of this.#readers.splice(0)) reader({ value: undefined as T, done: true });
    for (const writer of this.#writers.splice(0)) writer();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.#values.shift();
        if (value !== undefined || this.#values.length > 0) {
          this.#dequeued += 1;
          this.#writers.shift()?.();
          return { value: value as T, done: false };
        }
        if (this.#closed) {
          if (this.#error) throw this.#error;
          return { value: undefined as T, done: true };
        }
        return new Promise<IteratorResult<T>>((resolve) => this.#readers.push(resolve));
      },
    };
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
}
