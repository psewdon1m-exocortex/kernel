import http from "node:http";
import fs from "node:fs";

function request(socketPath, projectId, controlToken, method, route, body, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? undefined : Buffer.from(JSON.stringify(body));
    const call = http.request({
      socketPath,
      path: `/v1/projects/${encodeURIComponent(projectId)}${route}`,
      method,
      timeout: timeoutMs,
      headers: {
        Host: "neptune.local",
        Accept: "application/json",
        "X-Neptune-Token": controlToken,
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
      response.on("end", () => {
        let result = {};
        try { result = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
        catch { reject(Object.assign(new Error("Neptune returned invalid JSON"), { status: 502 })); return; }
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          reject(Object.assign(new Error(result.error || `Neptune returned HTTP ${response.statusCode}`), { status: response.statusCode === 409 ? 409 : 502 }));
          return;
        }
        resolve(result);
      });
    });
    call.on("timeout", () => call.destroy(new Error("Neptune request timed out")));
    call.on("error", (error) => reject(Object.assign(new Error(
      ["ENOENT", "ECONNREFUSED", "EACCES"].includes(error?.code) ? "Neptune is not installed or is unavailable on this VPS" : error.message,
    ), { status: ["ENOENT", "ECONNREFUSED", "EACCES"].includes(error?.code) ? 503 : 502 })));
    if (payload) call.write(payload);
    call.end();
  });
}

export function createNeptuneClient(socketPath, projectId, controlTokenFile) {
  const token = () => {
    if (!controlTokenFile) throw Object.assign(new Error("Neptune control token is not configured"), { status: 503 });
    return fs.readFileSync(controlTokenFile, "utf8").trim();
  };
  return {
    status: () => request(socketPath, projectId, token(), "GET", "/status"),
    schedule: (enabled, intervalHours) => request(socketPath, projectId, token(), "PUT", "/schedule", { enabled, intervalHours }),
    run: () => request(socketPath, projectId, token(), "POST", "/runs"),
  };
}
