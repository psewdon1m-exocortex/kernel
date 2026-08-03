import { describe, expect, it } from "vitest";
import { registerCoreNodes } from "@open-node/core-nodes";
import { ExecutionRuntime } from "@open-node/engine";
import { createContainer, createEmptyProject, createId, type ComputationalConnection } from "@open-node/model";
import { createNodeFromDefinition, NodeRegistry } from "@open-node/sdk";

describe("ExecutionRuntime", () => {
  it("executes a typed one-shot graph and returns outputs", async () => {
    const registry = coreRegistry();
    const project = createEmptyProject();
    const integer = createNodeFromDefinition(registry.require("open-node.core.integer")); integer.parameters["value"] = 2;
    const float = createNodeFromDefinition(registry.require("open-node.core.float")); float.parameters["value"] = 3;
    const add = createNodeFromDefinition(registry.require("open-node.core.add"));
    project.nodes.push(integer, float, add);
    project.connections.push(connect(integer.id, "value", add.id, "a"), connect(float.id, "value", add.id, "b"));
    const session = new ExecutionRuntime(registry).run(project);
    await session.completion;
    expect(session.status).toBe("success");
    expect(session.results.get(add.id)?.outputs["result"]?.value).toBe(5);
    expect(session.progress.percent).toBe(100);
  });

  it("executes a Container serial processor and respects bypass", async () => {
    const registry = coreRegistry();
    const project = createEmptyProject();
    const container = createContainer();
    const integer = createNodeFromDefinition(registry.require("open-node.core.integer")); integer.parameters["value"] = 7; integer.parentContainerId = container.id;
    const string = createNodeFromDefinition(registry.require("open-node.core.to-string")); string.parentContainerId = container.id;
    container.nodeIds = [integer.id, string.id];
    project.nodes.push(integer, string); project.containers.push(container);
    const runtime = new ExecutionRuntime(registry);
    const session = runtime.run(project);
    await session.completion;
    expect(session.results.get(container.id)?.outputs["output"]?.value).toBe("7");
    container.bypassed = true;
    const bypassed = runtime.run(project);
    await bypassed.completion;
    expect(bypassed.results.get(container.id)?.outputs["output"]?.value).toBeUndefined();
  });

  it("reports formal errors without breaking the host process", async () => {
    const registry = coreRegistry();
    const project = createEmptyProject();
    const divide = createNodeFromDefinition(registry.require("open-node.core.divide"));
    project.nodes.push(divide);
    const session = new ExecutionRuntime(registry).run(project);
    await session.completion;
    expect(session.status).toBe("success");
    expect(session.results.get(divide.id)?.outputs["result"]?.value).toBe(0);
    divide.parameters = {};
  });

  it("runs a bounded core stream with lifecycle metrics", async () => {
    const registry = coreRegistry();
    const project = createEmptyProject();
    const counter = createNodeFromDefinition(registry.require("open-node.stream.counter"));
    counter.parameters = { start: 5, step: 2, intervalMs: 0, limit: 3 };
    project.nodes.push(counter);
    const stream = new ExecutionRuntime(registry).streamNode(project, counter.id, { capacity: 2, backpressure: "block" });
    const values: unknown[] = [];
    for await (const item of stream) values.push(item.outputs["count"]?.value);
    expect(values).toEqual([5, 7, 9]);
    expect((await stream.completion).status).toBe("success");
    expect(stream.processedItems).toBe(3);
  });
});

function coreRegistry() { const registry = new NodeRegistry(); registerCoreNodes(registry); return registry; }
function connect(sourceElementId: string, sourcePortId: string, targetElementId: string, targetPortId: string): ComputationalConnection { return { id: createId("connection"), kind: "data", source: { elementId: sourceElementId, portId: sourcePortId }, target: { elementId: targetElementId, portId: targetPortId }, thickness: 2, opacity: 1, arrowhead: "end", routing: "bezier", reroutePoints: [] }; }
