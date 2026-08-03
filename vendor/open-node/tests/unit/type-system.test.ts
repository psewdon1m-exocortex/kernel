import { describe, expect, it } from "vitest";
import { createEmptyProject, createId, type ComputationalConnection } from "@open-node/model";
import { createNodeFromDefinition, NodeRegistry } from "@open-node/sdk";
import { createCoreTypeRegistry, genericType, validateConnection } from "@open-node/type-system";
import { registerCoreNodes } from "@open-node/core-nodes";

describe("TypeRegistry", () => {
  it("allows exact types and the safe integer to float conversion", () => {
    const types = createCoreTypeRegistry();
    expect(types.compatibility("core.string", "core.string")).toMatchObject({ compatible: true, implicit: false });
    expect(types.compatibility("core.integer", "core.float")).toMatchObject({ compatible: true, implicit: true });
    expect(types.compatibility("core.string", "core.float")).toMatchObject({ compatible: false, converterTypeId: "open-node.core.parse-number" });
  });

  it("keeps stream and scalar types distinct", () => {
    const types = createCoreTypeRegistry();
    expect(types.has(genericType("stream", "core.float"))).toBe(true);
    expect(types.compatibility("core.float", "stream<core.float>").compatible).toBe(false);
    expect(types.compatibility("stream<core.integer>", "stream<core.float>")).toMatchObject({ compatible: true, implicit: true });
  });

  it("rejects incompatible and cyclic connections", () => {
    const types = createCoreTypeRegistry();
    const registry = new NodeRegistry();
    registerCoreNodes(registry);
    const project = createEmptyProject();
    const text = createNodeFromDefinition(registry.require("open-node.core.text"));
    const add = createNodeFromDefinition(registry.require("open-node.core.add"));
    project.nodes.push(text, add);
    const invalid: ComputationalConnection = connection(text.id, "value", add.id, "a");
    expect(validateConnection(project, invalid, types).issues[0]?.code).toBe("incompatible-types");

    const first = createNodeFromDefinition(registry.require("open-node.core.add"));
    const second = createNodeFromDefinition(registry.require("open-node.core.add"));
    project.nodes = [first, second];
    project.connections = [connection(first.id, "result", second.id, "a")];
    const cycle = connection(second.id, "result", first.id, "a");
    expect(validateConnection(project, cycle, types).issues.some((issue) => issue.code === "computational-cycle")).toBe(true);
  });
});

function connection(sourceElementId: string, sourcePortId: string, targetElementId: string, targetPortId: string): ComputationalConnection {
  return { id: createId("connection"), kind: "data", source: { elementId: sourceElementId, portId: sourcePortId }, target: { elementId: targetElementId, portId: targetPortId }, thickness: 2, opacity: 1, arrowhead: "end", routing: "bezier", reroutePoints: [] };
}
