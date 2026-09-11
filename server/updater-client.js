import http from "node:http";
import { randomUUID } from "node:crypto";

function request(socketPath, controlToken, method, route, body, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? undefined : Buffer.from(JSON.stringify(body));
    const call = http.request({
      socketPath,
      path: route,
      method,
      timeout: timeoutMs,
      headers: {
        Host: "updater.local",
        Accept: "application/json",
        ...(controlToken ? { "X-Updater-Token": controlToken } : {}),
        ...(payload ? {
          "Content-Type": "application/json",
          "Content-Length": String(payload.length),
        } : {}),
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) {
          response.destroy(new Error("Updater response exceeds 4 MB"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        let result = {};
        try {
          result = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch {
          reject(Object.assign(new Error("Updater returned invalid JSON"), { status: 502 }));
          return;
        }
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          reject(Object.assign(
            new Error(result.error || `Updater returned HTTP ${response.statusCode}`),
            { status: response.statusCode === 409 ? 409 : 502 },
          ));
          return;
        }
        resolve(result);
      });
    });
    call.on("timeout", () => call.destroy(new Error("Updater request timed out")));
    call.on("error", (error) => {
      const unavailable = ["ENOENT", "ECONNREFUSED", "EACCES"].includes(error?.code);
      reject(Object.assign(
        new Error(unavailable
          ? "Updater is not installed or is unavailable on this VPS"
          : error.message),
        { status: unavailable ? 503 : 502, code: unavailable ? "UPDATER_UNAVAILABLE" : "UPDATER_ERROR" },
      ));
    });
    if (payload) call.write(payload);
    call.end();
  });
}

export function createUpdaterClient(socketPath, controlToken = "") {
  return {
    async status() {
      try {
        const value = await request(socketPath, "", "GET", "/v1/health");
        return { installed: true, available: true, ...value };
      } catch (error) {
        if (error.code === "UPDATER_UNAVAILABLE") {
          return {
            installed: false,
            available: false,
            status: "unavailable",
            service: "updater",
            message: error.message,
          };
        }
        throw error;
      }
    },
    createUpdate(payload) {
      return request(socketPath, controlToken, "POST", "/v1/updates", payload, 30_000);
    },
    selfUpdate(headId) {
      return request(socketPath, controlToken, "POST", "/v1/lifecycle/updater-self-update", { head_id: headId }, 30_000);
    },
    updateNeptune(payload) {
      return request(socketPath, controlToken, "POST", "/v1/components/neptune-linux/update", payload, 300_000);
    },
    initializeNeptune({ headId, projectId, exportUrl, enrollmentCode }) {
      return request(socketPath, controlToken, "POST", "/v1/components/neptune-linux/initialize", {
        request_id: randomUUID(), head_id: headId, project_id: projectId, export_url: exportUrl, enrollment_code: enrollmentCode,
      }, 30_000);
    },
    neptuneInitialization(id, headId) {
      return request(socketPath, controlToken, "GET", `/v1/components/neptune-linux/initializations/${encodeURIComponent(id)}?head_id=${encodeURIComponent(headId)}`);
    },
    job(id) {
      return request(socketPath, controlToken, "GET", `/v1/jobs/${encodeURIComponent(id)}`);
    },
    rollback(id) {
      return request(socketPath, controlToken, "POST", `/v1/jobs/${encodeURIComponent(id)}/rollback`);
    },
  };
}
