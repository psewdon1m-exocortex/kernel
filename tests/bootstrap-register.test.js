import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

test("bootstrap Register forwards an opaque Access Key without trimming or a size policy", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-bootstrap-register-"));
  const accessKey = ` CHANGE_ME:${"ж".repeat(5000)}\n`;
  const accessKeyFile = path.join(directory, "access-key");
  fs.writeFileSync(accessKeyFile, accessKey, "utf8");
  let submitted;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.url === "/api/auth/login") {
        submitted = JSON.parse(Buffer.concat(chunks).toString("utf8")).access_key;
        response.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "kernel_session=test; Path=/" });
        response.end('{"authenticated":true}');
        return;
      }
      if (request.url === "/api/register/profile/check") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"ready":true}');
        return;
      }
      response.writeHead(request.url === "/api/auth/logout" ? 200 : 404, { "Content-Type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const result = await execute(process.execPath, [
      "scripts/bootstrap-register.mjs",
      "check",
      "--kernel-url",
      `http://127.0.0.1:${address.port}`,
      "--access-key-file",
      accessKeyFile,
    ], { cwd: path.resolve(".") });
    assert.deepEqual(JSON.parse(result.stdout), { ready: true });
    assert.equal(submitted, accessKey);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
