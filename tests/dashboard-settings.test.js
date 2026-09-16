import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { KernelStore } from "../server/store.js";

test("existing dashboard order appends the registered head availability cards", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-dashboard-order-"));
  const store = new KernelStore({
    dataDir: directory,
    defaultsDir: path.resolve("data/defaults"),
    initialPasswordHash: "synthetic-test-verifier",
  });
  try {
    const previousOrder = [
      "cpu", "ram", "disk", "uptime",
      "service-kernel", "service-saturn", "service-volt",
    ];
    store.setSetting("dashboard_order", JSON.stringify(previousOrder));
    assert.deepEqual(store.getUiSettings().presentation.dashboard_order, [
      ...previousOrder,
      "service-laboratory",
      "service-chronos",
    ]);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
