import { describe, expect, it } from "vitest";
import { createAnnotation, createContainer, createEmptyProject, createGroup, createId, hasComputationalCycle, ProjectStore, topologicalSort, validateProject, type ComputationalConnection } from "@open-node/model";
import { createNodeFromDefinition, NodeRegistry } from "@open-node/sdk";
import { registerCoreNodes } from "@open-node/core-nodes";

describe("project model", () => {
  it("creates and clones a valid canonical project", () => {
    const project = createEmptyProject("Example");
    expect(validateProject(project).valid).toBe(true);
    const store = new ProjectStore(project);
    store.mutate((draft) => { draft.metadata.name = "Changed"; });
    expect(store.project.metadata.name).toBe("Changed");
    expect(project.metadata.name).toBe("Example");
  });

  it("uses hierarchical grid and white Container defaults", () => {
    const project = createEmptyProject();
    const container = createContainer();
    expect(project.metadata.name).toBe("Untitled");
    expect(project.settings.grid.majorEvery).toBe(10);
    expect(project.settings.panelLayout?.library.size).toEqual({ width: 620, height: 430 });
    expect(project.settings.connectionsVisible).toBe(true);
    expect(project.settings.portsVisible).toBe(true);
    expect(project.settings.groupsVisible).toBe(true);
    expect(project.settings.annotationsVisible).toBe(true);
    expect(project.settings.recentLibraryItems).toEqual([]);
    expect(container.color).toBe("#ffffff");
  });

  it("creates persistent Canvas annotations above the graph layer", () => {
    const project = createEmptyProject();
    const text = createAnnotation("text", { x: 40, y: 60 });
    const brush = createAnnotation("brush");
    project.annotations.push(text, brush);
    expect(text.text).toBe("Text");
    expect(brush.points?.length).toBeGreaterThan(1);
    expect(validateProject(project).valid).toBe(true);
  });

  it("detects cycles and returns deterministic topological order", () => {
    const registry = new NodeRegistry(); registerCoreNodes(registry);
    const project = createEmptyProject();
    const a = createNodeFromDefinition(registry.require("open-node.core.add"));
    const b = createNodeFromDefinition(registry.require("open-node.core.add"));
    project.nodes.push(a, b);
    project.connections.push(connection(a.id, b.id));
    expect(topologicalSort(project)).toEqual([a.id, b.id]);
    project.connections.push(connection(b.id, a.id));
    expect(hasComputationalCycle(project)).toBe(true);
    expect(validateProject(project).issues.some((issue) => issue.code === "computational-cycle")).toBe(true);
  });

  it("validates explicit Container and Group membership", () => {
    const registry = new NodeRegistry(); registerCoreNodes(registry);
    const project = createEmptyProject();
    const node = createNodeFromDefinition(registry.require("open-node.core.integer"));
    const container = createContainer();
    const group = createGroup({ x: -10, y: -10, width: 500, height: 500 });
    node.parentContainerId = container.id;
    node.parentGroupId = group.id;
    container.nodeIds.push(node.id);
    group.memberNodeIds.push(node.id);
    project.nodes.push(node); project.containers.push(container); project.groups.push(group);
    expect(validateProject(project).valid).toBe(true);
    container.nodeIds = [];
    expect(validateProject(project).issues.some((issue) => issue.code === "missing-container-parent")).toBe(true);
  });
});

function connection(sourceElementId: string, targetElementId: string): ComputationalConnection {
  return { id: createId("connection"), kind: "data", source: { elementId: sourceElementId, portId: "result" }, target: { elementId: targetElementId, portId: "a" }, thickness: 2, opacity: 1, arrowhead: "end", routing: "bezier", reroutePoints: [] };
}
