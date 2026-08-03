import { bench, describe } from "vitest";
import { createEmptyProject, createId, validateProject, type NodeInstance } from "@open-node/model";
import { DagScheduler, type SchedulerTask } from "@open-node/scheduler";

describe("model scale", () => {
  const project = createEmptyProject("1k element fixture");
  project.nodes = Array.from({ length: 1_000 }, (_, index): NodeInstance => ({
    id: createId("node"), kind: "node", nodeTypeId: "benchmark.core.dummy", nodeTypeVersion: "1.0.0",
    position: { x: (index % 40) * 280, y: Math.floor(index / 40) * 180 }, size: { width: 240, height: 140 }, label: `Node ${index}`,
    bypassed: false, parameters: {}, ports: [], parentContainerId: null, parentGroupId: null, uiState: {}, runtimeHints: {},
  }));
  bench("validate 1,000 elements", () => { validateProject(project); });
  bench("serialize 1,000 elements", () => { JSON.stringify(project); });
});

describe("scheduler scale", () => {
  const scheduler = new DagScheduler();
  const serial: SchedulerTask<number>[] = Array.from({ length: 250 }, (_, index) => ({ id: `task-${index}`, dependencies: index ? [`task-${index - 1}`] : [], run: async () => index }));
  const parallel: SchedulerTask<number>[] = Array.from({ length: 250 }, (_, index) => ({ id: `task-${index}`, dependencies: [], run: async () => index }));
  bench("250 serial tasks", async () => { await scheduler.schedule(serial, { concurrency: 8 }).result; });
  bench("250 parallel-ready tasks", async () => { await scheduler.schedule(parallel, { concurrency: 8 }).result; });
});
