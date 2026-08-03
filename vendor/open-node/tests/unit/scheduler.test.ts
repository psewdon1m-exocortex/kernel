import { describe, expect, it } from "vitest";
import { BoundedAsyncQueue, DagScheduler } from "@open-node/scheduler";

describe("DagScheduler", () => {
  it("runs independent branches in parallel before their merge", async () => {
    const scheduler = new DagScheduler();
    const started: string[] = [];
    const done: string[] = [];
    const task = (id: string, dependencies: string[]) => ({ id, dependencies, run: async () => { started.push(id); await new Promise((resolve) => setTimeout(resolve, 15)); done.push(id); return id; } });
    const result = await scheduler.schedule([task("input", []), task("a", ["input"]), task("b", ["input"]), task("merge", ["a", "b"])], { concurrency: 2 }).result;
    expect(result.status).toBe("success");
    expect(started.indexOf("merge")).toBeGreaterThan(done.indexOf("a"));
    expect(started.indexOf("merge")).toBeGreaterThan(done.indexOf("b"));
  });

  it("supports cancellation", async () => {
    const scheduler = new DagScheduler();
    const handle = scheduler.schedule([{ id: "slow", dependencies: [], run: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) }]);
    handle.cancel();
    expect((await handle.result).status).toBe("cancelled");
  });

  it("applies bounded queue drop policy and metrics", async () => {
    const queue = new BoundedAsyncQueue<number>(2, "drop-oldest");
    await queue.enqueue(1); await queue.enqueue(2); await queue.enqueue(3);
    const iterator = queue[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe(2);
    expect(queue.metrics.dropped).toBe(1);
    queue.close();
  });
});
