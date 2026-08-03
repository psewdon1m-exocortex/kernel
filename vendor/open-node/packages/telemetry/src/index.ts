export type MetricValue = number | null;

export interface ResourceMetrics {
  timestamp: number;
  ram: { usedBytes: MetricValue; totalBytes: MetricValue; percent: MetricValue };
  cpu: { percent: MetricValue };
  gpu: { percent: MetricValue; memoryUsedBytes: MetricValue; memoryTotalBytes: MetricValue };
  disk: { usedBytes: MetricValue; totalBytes: MetricValue; percent: MetricValue };
}

export interface TelemetryAdapter {
  readonly id: string;
  sample(signal?: AbortSignal): Promise<ResourceMetrics>;
}

export const unavailableMetrics = (): ResourceMetrics => ({
  timestamp: Date.now(),
  ram: { usedBytes: null, totalBytes: null, percent: null },
  cpu: { percent: null },
  gpu: { percent: null, memoryUsedBytes: null, memoryTotalBytes: null },
  disk: { usedBytes: null, totalBytes: null, percent: null },
});

export class BrowserTelemetryAdapter implements TelemetryAdapter {
  readonly id = "browser-approximation";

  async sample(signal?: AbortSignal): Promise<ResourceMetrics> {
    if (signal?.aborted) throw signal.reason;
    const metrics = unavailableMetrics();
    const performanceMemory = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };
    if (performanceMemory.memory) {
      metrics.ram.usedBytes = performanceMemory.memory.usedJSHeapSize;
      metrics.ram.totalBytes = performanceMemory.memory.jsHeapSizeLimit;
      metrics.ram.percent = percent(performanceMemory.memory.usedJSHeapSize, performanceMemory.memory.jsHeapSizeLimit);
    }
    const scheduledAt = performance.now();
    await new Promise<void>((resolve) => setTimeout(resolve, 32));
    const eventLoopDelay = Math.max(0, performance.now() - scheduledAt - 32);
    metrics.cpu.percent = Math.min(100, (eventLoopDelay / 32) * 100);
    if (typeof navigator !== "undefined" && "storage" in navigator && navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        if (estimate.quota !== undefined && estimate.usage !== undefined) {
          metrics.disk.usedBytes = estimate.usage;
          metrics.disk.totalBytes = estimate.quota;
          metrics.disk.percent = percent(estimate.usage, estimate.quota);
        }
      } catch {
        // Browser storage estimates are optional; unavailable remains honest.
      }
    }
    return metrics;
  }
}

type TelemetryListener = (metrics: ResourceMetrics) => void;

export class TelemetryMonitor {
  #listeners = new Set<TelemetryListener>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #controller: AbortController | undefined;
  #last = unavailableMetrics();

  constructor(
    readonly adapter: TelemetryAdapter,
    readonly intervalMs = 2000,
  ) {
    if (intervalMs < 250) throw new Error("Telemetry polling interval must be at least 250 ms");
  }

  get current(): ResourceMetrics {
    return structuredClone(this.#last);
  }

  subscribe(listener: TelemetryListener): () => void {
    this.#listeners.add(listener);
    listener(this.current);
    return () => this.#listeners.delete(listener);
  }

  start(): void {
    if (this.#controller) return;
    this.#controller = new AbortController();
    void this.#tick();
  }

  stop(): void {
    this.#controller?.abort();
    this.#controller = undefined;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async sample(): Promise<ResourceMetrics> {
    const metrics = await this.adapter.sample(this.#controller?.signal);
    this.#last = sanitize(metrics);
    for (const listener of this.#listeners) listener(this.current);
    return this.current;
  }

  async #tick(): Promise<void> {
    if (!this.#controller || this.#controller.signal.aborted) return;
    try {
      await this.sample();
    } catch (error) {
      if (!this.#controller.signal.aborted) {
        this.#last = unavailableMetrics();
        for (const listener of this.#listeners) listener(this.current);
      }
    }
    if (!this.#controller?.signal.aborted) this.#timer = setTimeout(() => void this.#tick(), this.intervalMs);
  }
}

export function formatMetric(value: MetricValue, unit: "percent" | "bytes" = "percent"): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  if (unit === "percent") return `${value.toFixed(0)}%`;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let index = 0;
  while (Math.abs(current) >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function percent(used: number, total: number): number | null {
  return total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : null;
}

function sanitize(input: ResourceMetrics): ResourceMetrics {
  const metric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  return {
    timestamp: metric(input.timestamp) ?? Date.now(),
    ram: { usedBytes: metric(input.ram.usedBytes), totalBytes: metric(input.ram.totalBytes), percent: metric(input.ram.percent) },
    cpu: { percent: metric(input.cpu.percent) },
    gpu: { percent: metric(input.gpu.percent), memoryUsedBytes: metric(input.gpu.memoryUsedBytes), memoryTotalBytes: metric(input.gpu.memoryTotalBytes) },
    disk: { usedBytes: metric(input.disk.usedBytes), totalBytes: metric(input.disk.totalBytes), percent: metric(input.disk.percent) },
  };
}
