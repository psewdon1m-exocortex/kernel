import { describe, expect, it } from "vitest";
import { CommandHistory } from "@open-node/commands";
import { registerCoreNodes } from "@open-node/core-nodes";
import { ExecutionRuntime } from "@open-node/engine";
import { MachineApi } from "@open-node/machine-api";
import { createEmptyProject, ProjectStore } from "@open-node/model";
import { NodeRegistry } from "@open-node/sdk";
import { TimelineRuntime } from "@open-node/timeline";
import { createCoreTypeRegistry } from "@open-node/type-system";

describe("MachineApi", () => {
  it("commits graph changes as one undoable transaction", async () => {
    const { api, store, history } = fixture();
    const tx = api.beginTransaction();
    const a = tx.createNode("open-node.core.integer", { x: 0, y: 0 }, { value: 2 });
    const b = tx.createNode("open-node.core.float", { x: 100, y: 0 }, { value: 3 });
    const add = tx.createNode("open-node.core.add", { x: 200, y: 0 });
    tx.connect(a, "value", add, "a"); tx.connect(b, "value", add, "b");
    await tx.commit();
    expect(store.project.nodes).toHaveLength(3);
    expect(store.project.connections).toHaveLength(2);
    await history.undo();
    expect(store.project.nodes).toHaveLength(0);
  });

  it("rolls back the whole transaction when validation fails", async () => {
    const { api, store } = fixture();
    const tx = api.beginTransaction();
    const text = tx.createNode("open-node.core.text", { x: 0, y: 0 });
    const add = tx.createNode("open-node.core.add", { x: 100, y: 0 });
    tx.connect(text, "value", add, "a");
    await expect(tx.commit()).rejects.toThrow(/converter required|not compatible/i);
    expect(store.project.nodes).toHaveLength(0);
  });

  it("enforces scopes", () => {
    const { store, history, nodes, types, runtime, timeline } = fixture();
    const readonly = new MachineApi({ store, history, nodes, types, runtime, timeline });
    expect(() => readonly.beginTransaction()).toThrow(/permission denied/);
  });
});

function fixture() {
  const store = new ProjectStore(createEmptyProject());
  const history = new CommandHistory();
  const nodes = new NodeRegistry(); registerCoreNodes(nodes);
  const types = createCoreTypeRegistry();
  const runtime = new ExecutionRuntime(nodes);
  const timeline = new TimelineRuntime(store.project.timeline);
  const api = new MachineApi({ store, history, nodes, types, runtime, timeline }, { permissions: { scopes: ["read", "write", "execute", "timeline"], maxTransactionOperations: 100 } });
  return { api, store, history, nodes, types, runtime, timeline };
}
