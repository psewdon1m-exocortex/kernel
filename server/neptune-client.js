import http from "node:http";
import fs from "node:fs";

function request(socketPath, projectId, controlToken, method, route, body, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? undefined : Buffer.from(JSON.stringify(body));
    const call = http.request({
      socketPath,
      path: projectId ? `/v1/projects/${encodeURIComponent(projectId)}${route}` : route,
      method,
      timeout: timeoutMs,
      headers: {
        Host: "neptune.local",
        Accept: "application/json",
        ...(controlToken ? { "X-Neptune-Token": controlToken } : {}),
        ...(payload ? { "Content-Type": "application/json", "Content-Length": String(payload.length) } : {}),
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) response.destroy(new Error("Neptune response exceeds 1 MB"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        let result = {};
        try { result = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
        catch { reject(Object.assign(new Error("Neptune returned invalid JSON"), { status: 502 })); return; }
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          reject(Object.assign(new Error(result.error || `Neptune returned HTTP ${response.statusCode}`), { status: [400, 404, 409, 410, 413, 422, 426, 503].includes(response.statusCode) ? response.statusCode : 502, upstreamStatus: response.statusCode }));
          return;
        }
        resolve(result);
      });
    });
    call.on("timeout", () => call.destroy(new Error("Neptune request timed out")));
    call.on("error", (error) => reject(Object.assign(new Error(
      ["ENOENT", "ECONNREFUSED", "EACCES"].includes(error?.code) ? "Neptune is not installed or is unavailable on this VPS" : error.message,
    ), { status: ["ENOENT", "ECONNREFUSED", "EACCES"].includes(error?.code) ? 503 : 502, code: "NEPTUNE_UNAVAILABLE" })));
    if (payload) call.write(payload);
    call.end();
  });
}

const REQUIRED_POLICY_PROTOCOL = 1;

export function createNeptuneClient(socketPath, projectId, controlTokenFile, transport = request) {
  const token = () => {
    if (!controlTokenFile) throw Object.assign(new Error("Neptune control token is not configured"), { status: 503, code: "NEPTUNE_NOT_CONFIGURED" });
    return fs.readFileSync(controlTokenFile, "utf8").trim();
  };
  let lastKnown = null;
  return {
    async availability() {
      // Missing enrollment configuration says nothing about host installation.
      if (!controlTokenFile) return { installed: null, linked: false, configured: false, state: "unlinked", version: null };
      try {
        const health = await transport(socketPath, "", "", "GET", "/v1/health", null, 3_000);
        try {
          const policyProtocol = Number.isSafeInteger(health.policy_protocol) ? health.policy_protocol : 0;
          const policySupported = policyProtocol >= REQUIRED_POLICY_PROTOCOL;
          lastKnown = { installed: true, linked: true, ...(await this.status()),
            state: policySupported ? "linked" : "upgrade_required", policy_protocol: policyProtocol,
            policy_supported: policySupported, required_policy_protocol: REQUIRED_POLICY_PROTOCOL,
            last_verified_at: new Date().toISOString() };
          return lastKnown;
        } catch (error) {
          return { ...lastKnown, installed: true, linked: error.upstreamStatus === 404 ? false : lastKnown?.linked ?? null,
            state: error.upstreamStatus === 404 ? "unlinked" : [401,403].includes(error.upstreamStatus) ? "authorization_failed" : "unavailable",
            version: health.version ?? lastKnown?.version ?? null, error: "Scoped Neptune status could not be verified" };
        }
      } catch {
        return { ...lastKnown, installed: lastKnown?.installed ?? null, linked: lastKnown?.linked ?? null,
          state: "unavailable", version: lastKnown?.version ?? null, error: "Neptune is unreachable; installation state is not confirmed" };
      }
    },
    policy: async (method = "GET", body, suffix = "") => {
      if (!["", "/runs"].includes(suffix) || !["GET", "PUT", "POST"].includes(method))
        throw Object.assign(new Error("Invalid backup policy operation"), { status: 400 });
      try {
        return await transport(socketPath, projectId, token(), method, "/policy" + suffix, body);
      } catch (error) {
        if (error?.upstreamStatus === 404) {
          throw Object.assign(new Error("Backup policy protocol is unavailable. Update Saturn and Neptune, then retry."),
            { status: 426, code: "NEPTUNE_POLICY_UPGRADE_REQUIRED", upstreamStatus: 404 });
        }
        throw error;
      }
    },
    status: () => transport(socketPath, projectId, token(), "GET", "/status"),
    schedule: (enabled, intervalHours) => transport(socketPath, projectId, token(), "PUT", "/schedule", { enabled, intervalHours }),
    run: () => transport(socketPath, projectId, token(), "POST", "/runs"),
  };
}
