const RESOLVE_PATH = "/api/v1/internal/kernel/resolve";
const MAX_RESPONSE_BYTES = 1024 * 1024;

function clientError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function validateBaseUrl(value) {
  if (!value) return "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("VOLT_URL must be an absolute URL");
  }
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (/change_me/i.test(value) || parsed.hostname === "example.com" || parsed.hostname.endsWith(".example.com")) {
    throw new Error("VOLT_URL must not use an example placeholder host");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("VOLT_URL must use HTTPS or local loopback HTTP");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("VOLT_URL must not contain credentials, query parameters or a fragment");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function createVoltClient({
  baseUrl = "",
  token = "",
  timeoutMs = 3000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const validatedUrl = validateBaseUrl(baseUrl);
  const timeout = Number.isFinite(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 30_000
    ? timeoutMs
    : 3000;

  return {
    async resolve(references) {
      if (!validatedUrl || !token) {
        throw clientError(503, "VOLT_NOT_CONFIGURED", "Kernel value resolution is not configured");
      }
      let response;
      try {
        response = await fetchImpl(`${validatedUrl}${RESOLVE_PATH}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ references }),
          redirect: "manual",
          signal: AbortSignal.timeout(timeout),
        });
      } catch {
        throw clientError(503, "VOLT_UNAVAILABLE", "Volt is unavailable");
      }
      if (!response.ok) {
        const status = response.status === 400 || response.status === 404 ? 422 : 503;
        const code = response.status === 401 ? "VOLT_AUTHENTICATION_FAILED" : "VOLT_RESOLUTION_FAILED";
        throw clientError(status, code, "Volt could not resolve the requested value references");
      }
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
        throw clientError(503, "VOLT_RESPONSE_TOO_LARGE", "Volt returned an oversized response");
      }
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw clientError(503, "VOLT_RESPONSE_INVALID", "Volt returned an invalid response");
      }
      if (payload?.schema !== "volt.resolve.v1" || !payload.values || typeof payload.values !== "object") {
        throw clientError(503, "VOLT_RESPONSE_INVALID", "Volt returned an unsupported response");
      }
      for (const reference of references) {
        const item = payload.values[reference];
        if (
          !item
          || typeof item.value !== "string"
          || !Number.isInteger(item.revision)
          || !["plain", "secret"].includes(item.visibility)
        ) {
          throw clientError(503, "VOLT_RESPONSE_INVALID", "Volt omitted a requested value reference");
        }
      }
      return payload;
    },
  };
}

export { validateBaseUrl as validateVoltUrl };

/** Bootstrap coordinates break the discovery cycle; operational requests use the current Register route. */
export function createDiscoveredVoltClient({ baseUrl, token, getRouteReferences, timeoutMs, fetchImpl }) {
  const bootstrap = createVoltClient({ baseUrl, token, timeoutMs, fetchImpl });
  return {
    async resolve(references) {
      const route = getRouteReferences();
      const reference = /^volt:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[1-5]$/i;
      if (!reference.test(route.sni) || !reference.test(route.port))
        throw clientError(503, "VOLT_ROUTE_NOT_CONFIGURED", "Map the Volt hostname and port in the Kernel Register");
      const resolved = await bootstrap.resolve([...new Set([route.sni, route.port])]);
      const host = resolved.values[route.sni].value;
      const port = resolved.values[route.port].value;
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host) || host.length > 253 || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)
        throw clientError(503, "VOLT_ROUTE_INVALID", "The registered Volt route is invalid");
      const local = ["127.0.0.1", "localhost"].includes(host);
      const scheme = local && new URL(baseUrl).protocol === "http:" ? "http:" : "https:";
      return createVoltClient({ baseUrl: `${scheme}//${host}:${port}`, token, timeoutMs, fetchImpl }).resolve(references);
    },
  };
}
