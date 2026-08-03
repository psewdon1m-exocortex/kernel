import { createOpenNode, type OpenNodeInstance } from "@open-node/embed";
import { registerCoreNodes } from "@open-node/core-nodes";
import { serializeProject } from "@open-node/io";
import { createEmptyProject, createId, type ComputationalConnection, type OpenNodeProject } from "@open-node/model";
import { createNodeFromDefinition, NodeRegistry } from "@open-node/sdk";
import "./standalone.css";

const mount = document.querySelector<HTMLElement>("#root");
if (!mount) throw new Error("Application mount point not found");

const project = createWelcomeProject();
let editor: OpenNodeInstance;

editor = createOpenNode({
  container: mount,
  mode: "standalone",
  project,
  onSaveRequest(current) {
    const blob = new Blob([serializeProject(current)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeName(current.metadata.name)}.onode.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
});

editor.on("executionFinished", () => console.info("Open Node execution completed"));
editor.on("connectionRejected", (event) => console.warn("Connection rejected", event.detail));

declare global {
  interface Window { openNode: OpenNodeInstance; }
}
window.openNode = editor;

function createWelcomeProject(): OpenNodeProject {
  const registry = new NodeRegistry();
  registerCoreNodes(registry);
  const project = createEmptyProject("Untitled");
  project.timeline.enabled = true;
  project.timeline.durationSeconds = 12;
  project.timeline.endTime = 12;
  project.settings.timelineVisible = true;

  const integer = createNodeFromDefinition(registry.require("open-node.core.integer"), { x: -430, y: -170 });
  integer.parameters["value"] = 21;
  integer.label = "First number";
  const float = createNodeFromDefinition(registry.require("open-node.core.float"), { x: -430, y: 50 });
  float.parameters["value"] = 21;
  float.label = "Second number";
  const add = createNodeFromDefinition(registry.require("open-node.core.add"), { x: -70, y: -65 });
  const display = createNodeFromDefinition(registry.require("open-node.output.display"), { x: 300, y: -65 });

  const groupId = createId("group");
  const group = {
    id: groupId,
    kind: "group" as const,
    name: "Simple math pipeline",
    position: { x: -500, y: -240 },
    size: { width: 1110, height: 460 },
    color: "#4b84ff",
    opacity: 0.08,
    borderStyle: "solid" as const,
    collapsed: false,
    bypassed: false,
    memberNodeIds: [integer.id, float.id, add.id, display.id],
    memberContainerIds: [],
  };
  for (const node of [integer, float, add, display]) node.parentGroupId = groupId;

  const container = {
    id: createId("container"),
    kind: "container" as const,
    name: "Serial formatter",
    position: { x: -130, y: 320 },
    size: { width: 300, height: 190 },
    color: "#ffffff",
    collapsed: false,
    bypassed: false,
    nodeIds: [] as string[],
    parentGroupId: null,
    inputPort: { id: "input", label: "Input", direction: "input" as const, kind: "data" as const, typeId: "core.any" },
    outputPort: { id: "output", label: "Output", direction: "output" as const, kind: "data" as const, typeId: "core.any" },
    errorPolicy: "stop-on-error" as const,
  };
  const containerInteger = createNodeFromDefinition(registry.require("open-node.core.integer"));
  containerInteger.parameters["value"] = 7;
  containerInteger.parentContainerId = container.id;
  const toString = createNodeFromDefinition(registry.require("open-node.core.to-string"));
  toString.parentContainerId = container.id;
  container.nodeIds.push(containerInteger.id, toString.id);

  const connections: ComputationalConnection[] = [
    connect(integer.id, "value", add.id, "a"),
    connect(float.id, "value", add.id, "b"),
    connect(add.id, "result", display.id, "value"),
  ];
  project.nodes.push(integer, float, add, display, containerInteger, toString);
  project.containers.push(container);
  project.groups.push(group);
  project.connections.push(...connections);
  project.viewport = { x: 30, y: 100, zoom: 0.85 };
  return project;
}

function connect(sourceElementId: string, sourcePortId: string, targetElementId: string, targetPortId: string): ComputationalConnection {
  return {
    id: createId("connection"),
    kind: "data",
    source: { elementId: sourceElementId, portId: sourcePortId },
    target: { elementId: targetElementId, portId: targetPortId },
    thickness: 2,
    opacity: 1,
    arrowhead: "end",
    routing: "bezier",
    reroutePoints: [],
  };
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, "-").replace(/^-+|-+$/g, "") || "project";
}
