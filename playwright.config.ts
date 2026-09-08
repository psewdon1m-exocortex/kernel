import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:18183",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "node server/index.js",
    url: "http://127.0.0.1:18183/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      KERNEL_PORT: "18183",
      KERNEL_DATA_DIR: join(tmpdir(), `kernel-e2e-${process.pid}`),
      KERNEL_ACCESS_KEY: "browser-test-access-key",
      KERNEL_SESSION_SECRET: "browser-test-session-secret-32-characters-long",
      KERNEL_SERVICE_TOKEN: "browser-test-api-token-24-characters",
      VOLT_URL: "http://127.0.0.1:18184",
      VOLT_KERNEL_TOKEN: "browser-test-kernel-to-volt-token-32-characters",
      KERNEL_COOKIE_SECURE: "false",
    },
  },
});
