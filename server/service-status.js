import { isIP } from "node:net";

const HEALTHY_STATUS = new Set(["ok", "available", "healthy", "ready"]);
const MAX_RESPONSE_BYTES = 16 * 1024;

export const SERVICE_STATUS_DEFINITIONS = [
  { id: "kernel", name: "KERNEL", healthPath: "/api/v1/health", contract: "private-readiness", localReady: true },
  { id: "chronos", name: "Chronos", healthPath: "/api/public/reachability", contract: "public-readiness" },
  { id: "perimetr", name: "Perimetr", healthPath: "/v1/health", contract: "private-readiness" },
  { id: "saturn", name: "Saturn", healthPath: "/health/ready", contract: "public-readiness" },
  { id: "laboratory", name: "Laboratory", healthPath: "/api/health", contract: "public-liveness" },
  { id: "volt", name: "Volt", healthPath: "/api/v1/health", contract: "public-liveness" },
];

function validPublicHostname(value) {
  if (typeof value !== "string") return false;
  const hostname = value.trim().toLowerCase();
  return hostname.length > 0
    && hostname.length <= 253
    && hostname.includes(".")
    && !hostname.endsWith(".example.com")
    && hostname !== "example.com"
    && hostname !== "localhost"
    && !hostname.endsWith(".local")
    && isIP(hostname) === 0
    && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname);
}

function readConfiguration(values, definition) {
  const hostname = String(values[`services.${definition.id}.sni`] ?? "").trim().toLowerCase();
  const portText = String(values[`services.${definition.id}.port`] ?? "").trim();
  const healthPath = String(values[`services.${definition.id}.health.path`] ?? "").trim();
  const contract = String(values[`services.${definition.id}.health.contract`] ?? "").trim();
  const port = Number(portText);
  if (
    !validPublicHostname(hostname)
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
    || healthPath !== definition.healthPath
    || contract !== definition.contract
  ) {
    return null;
  }
  const origin = port === 443 ? `https://${hostname}` : `https://${hostname}:${port}`;
  return { hostname, port, origin, healthPath, contract };
}

async function discardBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    // The network result is still usable when a runtime cannot cancel a body.
  }
}

async function readJsonBounded(response) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("response_too_large");
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function request(fetchImpl, url, timeoutMs, readBody) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: {
        Accept: readBody ? "application/json" : "*/*",
        "User-Agent": "exocortex-kernel-service-monitor/1",
      },
      signal: controller.signal,
    });
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    return { response, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

function networkFailure(error) {
  if (error?.name === "AbortError") return "timeout";
  const code = error?.cause?.code ?? error?.code;
  if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) return code.toLowerCase();
  return "network_error";
}

async function probeEdge(fetchImpl, origin, timeoutMs) {
  try {
    const { response, latencyMs } = await request(fetchImpl, `${origin}/`, timeoutMs, false);
    await discardBody(response);
    return {
      state: response.status >= 100 && response.status < 500 ? "pass" : "fail",
      latency_ms: latencyMs,
      code: `http_${response.status}`,
    };
  } catch (error) {
    return { state: "fail", latency_ms: null, code: networkFailure(error) };
  }
}

async function probeHealth(fetchImpl, url, timeoutMs, level) {
  try {
    const { response, latencyMs } = await request(fetchImpl, url, timeoutMs, true);
    if (response.status < 200 || response.status >= 300) {
      await discardBody(response);
      return { state: "fail", level, latency_ms: latencyMs, code: `http_${response.status}` };
    }
    const payload = await readJsonBounded(response);
    const status = typeof payload?.status === "string" ? payload.status.toLowerCase() : "";
    return {
      state: HEALTHY_STATUS.has(status) ? "pass" : "fail",
      level,
      latency_ms: latencyMs,
      code: HEALTHY_STATUS.has(status) ? status : status || "invalid_payload",
    };
  } catch (error) {
    return { state: "fail", level, latency_ms: null, code: networkFailure(error) };
  }
}

async function mapLimited(items, limit, action) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await action(items[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

export function createServiceStatusCollector({
  fetchImpl = globalThis.fetch,
  getRegisterValues,
  intervalMs = 30_000,
  timeoutMs = 3_000,
  staleAfterMs = 90_000,
  onTransition = () => {},
}) {
  let timer;
  let inFlight;
  let started = false;
  let collectedAt = null;
  const state = new Map();

  async function check(definition, values) {
    const checkedAt = new Date().toISOString();
    const configuration = readConfiguration(values, definition);
    if (!configuration) {
      return {
        id: definition.id,
        name: definition.name,
        status: "unconfigured",
        hostname: null,
        checked_at: checkedAt,
        checks: {
          edge: { state: "unknown", latency_ms: null, code: "configuration_missing" },
          readiness: { state: "unknown", level: "readiness", latency_ms: null, code: "configuration_missing" },
        },
        consecutive_failures: 0,
      };
    }

    const edge = await probeEdge(fetchImpl, configuration.origin, timeoutMs);
    let readiness;
    if (definition.localReady) {
      readiness = { state: "pass", level: "readiness", latency_ms: 0, code: "local_runtime" };
    } else if (configuration.contract === "private-readiness") {
      readiness = { state: "unknown", level: "readiness", latency_ms: null, code: "private_probe_required" };
    } else {
      const level = configuration.contract === "public-readiness" ? "readiness" : "liveness";
      readiness = await probeHealth(
        fetchImpl,
        `${configuration.origin}${configuration.healthPath}`,
        timeoutMs,
        level,
      );
    }

    const rawStatus = edge.state === "fail" || readiness.state === "fail"
      ? "unavailable"
      : readiness.state === "pass" && readiness.level === "readiness"
        ? "available"
        : "degraded";
    const previous = state.get(definition.id);
    const consecutiveFailures = rawStatus === "unavailable"
      ? (previous?.consecutive_failures ?? 0) + 1
      : 0;
    const status = rawStatus === "unavailable" && consecutiveFailures < 3
      ? "degraded"
      : rawStatus;
    return {
      id: definition.id,
      name: definition.name,
      status,
      hostname: configuration.hostname,
      checked_at: checkedAt,
      checks: { edge, readiness },
      consecutive_failures: consecutiveFailures,
    };
  }

  async function refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const values = await getRegisterValues() ?? {};
      const results = await mapLimited(SERVICE_STATUS_DEFINITIONS, 4, (definition) => check(definition, values));
      for (const result of results) {
        const previous = state.get(result.id);
        state.set(result.id, result);
        if (previous && previous.status !== result.status) {
          try { onTransition(previous, result); } catch { /* Status collection must remain available. */ }
        }
      }
      collectedAt = new Date().toISOString();
      return results;
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  }

  function start() {
    if (started) return;
    started = true;
    timer = setInterval(() => { void refresh(); }, intervalMs);
    timer.unref?.();
  }

  async function snapshot() {
    start();
    if (state.size === 0) await refresh();
    const now = Date.now();
    const services = SERVICE_STATUS_DEFINITIONS.map((definition) => {
      const current = state.get(definition.id) ?? {
        id: definition.id,
        name: definition.name,
        status: "unknown",
        hostname: null,
        checked_at: null,
        checks: {
          edge: { state: "unknown", latency_ms: null, code: "not_checked" },
          readiness: { state: "unknown", level: "readiness", latency_ms: null, code: "not_checked" },
        },
        consecutive_failures: 0,
      };
      const stale = current.checked_at
        && current.status !== "unconfigured"
        && now - Date.parse(current.checked_at) > staleAfterMs;
      return { ...current, status: stale ? "stale" : current.status };
    });
    return {
      collected_at: collectedAt,
      refresh_interval_seconds: Math.round(intervalMs / 1000),
      stale_after_seconds: Math.round(staleAfterMs / 1000),
      services,
    };
  }

  return {
    snapshot,
    refresh,
    close() {
      if (timer) clearInterval(timer);
    },
  };
}
