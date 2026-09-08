import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SERVICE_STATUS_DEFINITIONS,
  createServiceStatusCollector,
} from "../server/service-status.js";

function configuredRegister() {
  return Object.fromEntries(SERVICE_STATUS_DEFINITIONS.flatMap((service) => [
    [`services.${service.id}.sni`, `${service.id}.services.test`],
    [`services.${service.id}.port`, "443"],
    [`services.${service.id}.health.path`, service.healthPath],
    [`services.${service.id}.health.contract`, service.contract],
  ]));
}

test("service collector reports only dashboard services and distinguishes readiness from liveness", async () => {
  const calls = [];
  const collector = createServiceStatusCollector({
    getRegisterValues: configuredRegister,
    intervalMs: 60_000,
    fetchImpl: async (input) => {
      const url = new URL(input);
      calls.push(url.href);
      if (url.pathname === "/api/public/reachability") {
        return Response.json({ status: "available" });
      }
      if (url.pathname === "/health/ready") {
        return Response.json({ status: "ok", checks: { database: { state: "pass" } } });
      }
      if (["/api/health", "/api/v1/health"].includes(url.pathname)) {
        return Response.json({ status: "ok" });
      }
      return new Response("", { status: 200 });
    },
  });
  try {
    const snapshot = await collector.snapshot();
    assert.deepEqual(snapshot.services.map((service) => service.id), [
      "kernel", "chronos", "perimetr", "saturn", "laboratory", "volt",
    ]);
    assert.equal(snapshot.services.find((service) => service.id === "kernel").status, "available");
    assert.equal(snapshot.services.find((service) => service.id === "chronos").status, "available");
    assert.equal(snapshot.services.find((service) => service.id === "saturn").status, "available");
    assert.equal(snapshot.services.find((service) => service.id === "perimetr").status, "degraded");
    assert.equal(snapshot.services.find((service) => service.id === "laboratory").checks.readiness.level, "liveness");
    assert.equal(snapshot.services.find((service) => service.id === "laboratory").status, "degraded");
    assert.equal(snapshot.services.find((service) => service.id === "volt").status, "degraded");
    assert.ok(calls.every((url) => !url.includes("neptune") && !url.includes("updater")));
    assert.ok(calls.every((url) => url.startsWith("https://")));
  } finally {
    collector.close();
  }
});

test("service collector refuses placeholder and local-address Register targets", async () => {
  let calls = 0;
  const values = configuredRegister();
  values["services.kernel.sni"] = "127.0.0.1";
  values["services.chronos.sni"] = "chronos.example.com";
  const collector = createServiceStatusCollector({
    getRegisterValues: () => values,
    intervalMs: 60_000,
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ status: "ok" });
    },
  });
  try {
    const snapshot = await collector.snapshot();
    assert.equal(snapshot.services.find((service) => service.id === "kernel").status, "unconfigured");
    assert.equal(snapshot.services.find((service) => service.id === "chronos").status, "unconfigured");
    assert.equal(calls, 7);
  } finally {
    collector.close();
  }
});

test("service collector requires three consecutive failures before unavailable", async () => {
  const collector = createServiceStatusCollector({
    getRegisterValues: configuredRegister,
    intervalMs: 60_000,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  try {
    let snapshot = await collector.snapshot();
    assert.equal(snapshot.services.find((service) => service.id === "chronos").status, "degraded");
    await collector.refresh();
    snapshot = await collector.snapshot();
    assert.equal(snapshot.services.find((service) => service.id === "chronos").status, "degraded");
    await collector.refresh();
    snapshot = await collector.snapshot();
    assert.equal(snapshot.services.find((service) => service.id === "chronos").status, "unavailable");
  } finally {
    collector.close();
  }
});
