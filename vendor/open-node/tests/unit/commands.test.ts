import { describe, expect, it } from "vitest";
import { CommandHistory, copySelection, pasteSelection, projectCommand, setGroupBypass } from "@open-node/commands";
import { createContainer, createEmptyProject, createGroup, ProjectStore } from "@open-node/model";
import { createNodeFromDefinition, NodeRegistry } from "@open-node/sdk";
import { registerCoreNodes } from "@open-node/core-nodes";

describe("CommandHistory", () => {
  it("undoes and redoes an atomic project mutation", async () => {
    const store = new ProjectStore(createEmptyProject());
    const history = new CommandHistory();
    await history.execute(projectCommand(store, "Rename", (draft) => { draft.metadata.name = "Renamed"; }));
    expect(store.project.metadata.name).toBe("Renamed");
    expect(await history.undo()).toBe(true);
    expect(store.project.metadata.name).toBe("Untitled");
    await history.redo();
    expect(store.project.metadata.name).toBe("Renamed");
  });

  it("copies internal graph state with new IDs", () => {
    const registry = new NodeRegistry(); registerCoreNodes(registry);
    const project = createEmptyProject();
    const node = createNodeFromDefinition(registry.require("open-node.core.integer"), { x: 1, y: 2 });
    project.nodes.push(node);
    const clipboard = copySelection(project, [node.id]);
    const ids = pasteSelection(project, clipboard, { x: 10, y: 20 });
    expect(ids).toHaveLength(1);
    expect(project.nodes[1]).toMatchObject({ position: { x: 11, y: 22 } });
    expect(project.nodes[1]?.id).not.toBe(node.id);
  });

  it("copies and pastes a Group together with all of its members", () => {
    const registry = new NodeRegistry(); registerCoreNodes(registry);
    const project = createEmptyProject();
    const a = createNodeFromDefinition(registry.require("open-node.core.integer"), { x: 20, y: 30 });
    const b = createNodeFromDefinition(registry.require("open-node.core.float"), { x: 180, y: 30 });
    const group = createGroup({ x: 0, y: 0, width: 420, height: 240 });
    group.memberNodeIds = [a.id, b.id];
    a.parentGroupId = group.id;
    b.parentGroupId = group.id;
    project.nodes.push(a, b);
    project.groups.push(group);
    const clipboard = copySelection(project, [group.id]);
    expect(clipboard.nodes.map((node) => node.id)).toEqual([a.id, b.id]);
    const ids = pasteSelection(project, clipboard, { x: 50, y: 60 });
    expect(ids).toHaveLength(3);
    const pastedGroup = project.groups[1];
    expect(pastedGroup?.memberNodeIds).toHaveLength(2);
    expect(project.nodes.filter((node) => node.parentGroupId === pastedGroup?.id)).toHaveLength(2);
  });

  it("keeps a duplicated contained Node in its existing Container", () => {
    const registry = new NodeRegistry(); registerCoreNodes(registry);
    const project = createEmptyProject();
    const container = createContainer({ x: 0, y: 0 });
    const node = createNodeFromDefinition(registry.require("open-node.core.integer"));
    node.parentContainerId = container.id;
    container.nodeIds.push(node.id);
    project.containers.push(container);
    project.nodes.push(node);
    const ids = pasteSelection(project, copySelection(project, [node.id]), { x: 0, y: 0 });
    expect(ids).toHaveLength(1);
    expect(project.nodes[1]?.parentContainerId).toBe(container.id);
    expect(container.nodeIds).toContain(project.nodes[1]?.id);
  });

  it("restores the original bypass snapshot for Group members", () => {
    const registry = new NodeRegistry(); registerCoreNodes(registry);
    const project = createEmptyProject();
    const a = createNodeFromDefinition(registry.require("open-node.core.integer"));
    const b = createNodeFromDefinition(registry.require("open-node.core.float"));
    b.bypassed = true;
    const group = createGroup({ x: 0, y: 0, width: 400, height: 300 });
    group.memberNodeIds = [a.id, b.id]; a.parentGroupId = group.id; b.parentGroupId = group.id;
    project.nodes.push(a, b); project.groups.push(group);
    setGroupBypass(project, group.id, true);
    expect(a.bypassed && b.bypassed).toBe(true);
    setGroupBypass(project, group.id, false);
    expect(a.bypassed).toBe(false);
    expect(b.bypassed).toBe(true);
  });
});
