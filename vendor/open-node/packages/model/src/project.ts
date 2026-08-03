import type {
  AnnotationType,
  CanvasAnnotation,
  Connection,
  ContainerInstance,
  GraphElement,
  GroupInstance,
  NodeInstance,
  OpenNodeProject,
  Point,
  ProjectChangeEvent,
  ProjectChangeReason,
  Rect,
  ValidationIssue,
  ValidationResult,
} from "./types";

export const OPEN_NODE_VERSION = "0.1.0";
export const PROJECT_SCHEMA_VERSION = "1.0.0" as const;

export function createId(prefix = "id"): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function cloneProject(project: OpenNodeProject): OpenNodeProject {
  return structuredClone(project);
}

export function createEmptyProject(name = "Untitled"): OpenNodeProject {
  const now = new Date().toISOString();
  return {
    format: "open-node-project",
    schemaVersion: PROJECT_SCHEMA_VERSION,
    createdWith: OPEN_NODE_VERSION,
    metadata: {
      id: createId("project"),
      name,
      createdAt: now,
      updatedAt: now,
      tags: [],
    },
    dependencies: [],
    settings: {
      theme: "dark",
      grid: { enabled: true, step: 24, majorEvery: 10, color: "#75809a", opacity: 0.16, snapping: false },
      minimapVisible: true,
      timelineVisible: true,
      dashboardVisible: true,
      reducedMotion: false,
      previewQuality: "medium",
      connectionRouting: "bezier",
      connectionsVisible: true,
      portsVisible: true,
      groupsVisible: true,
      annotationsVisible: true,
      recentLibraryItems: [],
      panelLayout: { library: { position: { x: 70, y: 64 }, size: { width: 620, height: 430 } } },
    },
    execution: {
      mode: "manual",
      concurrency: 4,
      preferredBackend: "auto",
      cacheEnabled: true,
      nodeTimeoutMs: 30_000,
      continuousQueueSize: 64,
      backpressure: "drop-oldest",
    },
    timeline: {
      enabled: false,
      fps: 30,
      durationSeconds: 60,
      startTime: 0,
      endTime: 60,
      loop: false,
      playbackRate: 1,
      timeUnit: "seconds",
      currentTime: 0,
    },
    viewport: { x: 0, y: 0, zoom: 1 },
    background: { type: "solid", color: "#111318" },
    nodes: [],
    containers: [],
    groups: [],
    connections: [],
    annotations: [],
    presets: [],
    assets: [],
  };
}

export function createNodeInstance(
  definition: {
    typeId: string;
    version: string;
    displayName: string;
    defaultColor?: string;
    inputs: NodeInstance["ports"];
    outputs: NodeInstance["ports"];
    createDefaultParams(): Record<string, unknown>;
  },
  position: Point = { x: 0, y: 0 },
): NodeInstance {
  return {
    id: createId("node"),
    kind: "node",
    nodeTypeId: definition.typeId,
    nodeTypeVersion: definition.version,
    position,
    size: { width: 240, height: 148 },
    label: definition.displayName,
    ...(definition.defaultColor ? { color: definition.defaultColor } : {}),
    bypassed: false,
    parameters: definition.createDefaultParams(),
    ports: [...definition.inputs.map((port) => ({ ...port, direction: "input" as const })), ...definition.outputs.map((port) => ({ ...port, direction: "output" as const }))],
    parentContainerId: null,
    parentGroupId: null,
    uiState: {},
    runtimeHints: {},
  };
}

export function createContainer(position: Point = { x: 0, y: 0 }, name = "Container"): ContainerInstance {
  return {
    id: createId("container"),
    kind: "container",
    name,
    position,
    size: { width: 280, height: 240 },
    color: "#ffffff",
    collapsed: false,
    bypassed: false,
    nodeIds: [],
    parentGroupId: null,
    inputPort: { id: "input", label: "Input", direction: "input", kind: "data", typeId: "core.any", required: false },
    outputPort: { id: "output", label: "Output", direction: "output", kind: "data", typeId: "core.any" },
    errorPolicy: "stop-on-error",
  };
}

export function createGroup(rect: Rect, name?: string): GroupInstance {
  return {
    id: createId("group"),
    kind: "group",
    ...(name ? { name } : {}),
    position: { x: rect.x, y: rect.y },
    size: { width: Math.max(80, rect.width), height: Math.max(60, rect.height) },
    color: "#4b84ff",
    opacity: 0.12,
    borderStyle: "solid",
    collapsed: false,
    bypassed: false,
    memberNodeIds: [],
    memberContainerIds: [],
  };
}

export function createAnnotation(type: AnnotationType, position: Point = { x: 0, y: 0 }): CanvasAnnotation {
  const defaults: Record<AnnotationType, { size: { width: number; height: number }; color: string; fillColor?: string; strokeWidth: number }> = {
    rectangle: { size: { width: 180, height: 120 }, color: "#ffffff", fillColor: "#ffffff18", strokeWidth: 2 },
    ellipse: { size: { width: 180, height: 120 }, color: "#ffffff", fillColor: "#ffffff18", strokeWidth: 2 },
    diamond: { size: { width: 180, height: 120 }, color: "#ffffff", fillColor: "#ffffff18", strokeWidth: 2 },
    arrow: { size: { width: 180, height: 80 }, color: "#ffffff", strokeWidth: 3 },
    brush: { size: { width: 160, height: 80 }, color: "#ffffff", strokeWidth: 4 },
    text: { size: { width: 220, height: 80 }, color: "#ffffff", strokeWidth: 1 },
  };
  const preset = defaults[type];
  return {
    id: createId("annotation"), kind: "annotation", annotationType: type, position: { ...position }, size: { ...preset.size }, rotation: 0,
    color: preset.color, ...(preset.fillColor ? { fillColor: preset.fillColor } : {}), strokeWidth: preset.strokeWidth, opacity: 1,
    ...(type === "text" ? { text: "Text", fontSize: 24 } : {}),
    ...(type === "arrow" ? { points: [{ x: 0, y: preset.size.height / 2 }, { x: preset.size.width, y: preset.size.height / 2 }] } : {}),
    ...(type === "brush" ? { points: [{ x: 0, y: preset.size.height / 2 }, { x: preset.size.width, y: preset.size.height / 2 }] } : {}),
  };
}

export function getElement(project: OpenNodeProject, id: string): GraphElement | undefined {
  return project.nodes.find((node) => node.id === id) ?? project.containers.find((container) => container.id === id) ?? project.groups.find((group) => group.id === id);
}

export function getAnnotation(project: OpenNodeProject, id: string): CanvasAnnotation | undefined {
  return project.annotations.find((annotation) => annotation.id === id);
}

export function getComputationalElement(project: OpenNodeProject, id: string): NodeInstance | ContainerInstance | undefined {
  return project.nodes.find((node) => node.id === id) ?? project.containers.find((container) => container.id === id);
}

export function elementRect(element: GraphElement): Rect {
  return { ...element.position, ...element.size };
}

export function rectContainsPoint(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return rectContainsPoint(outer, { x: inner.x, y: inner.y }) && rectContainsPoint(outer, { x: inner.x + inner.width, y: inner.y + inner.height });
}

export function getBounds(project: OpenNodeProject, ids?: ReadonlySet<string>): Rect | null {
  const elements = [...project.groups, ...project.containers, ...project.nodes.filter((node) => !node.parentContainerId), ...project.annotations].filter((element) => !ids || ids.has(element.id));
  if (elements.length === 0) return null;
  const left = Math.min(...elements.map((element) => element.position.x));
  const top = Math.min(...elements.map((element) => element.position.y));
  const right = Math.max(...elements.map((element) => element.position.x + element.size.width));
  const bottom = Math.max(...elements.map((element) => element.position.y + element.size.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function findPort(project: OpenNodeProject, elementId: string, portId: string) {
  const node = project.nodes.find((candidate) => candidate.id === elementId);
  if (node) return node.ports.find((port) => port.id === portId);
  const container = project.containers.find((candidate) => candidate.id === elementId);
  if (container) return [container.inputPort, container.outputPort].find((port) => port.id === portId);
  return undefined;
}

export function hasComputationalCycle(project: OpenNodeProject, extra?: Connection): boolean {
  const edges = [...project.connections, ...(extra ? [extra] : [])].filter((connection) => connection.kind !== "decorative");
  const adjacency = new Map<string, string[]>();
  for (const connection of edges) {
    const targets = adjacency.get(connection.source.elementId) ?? [];
    targets.push(connection.target.elementId);
    adjacency.set(connection.source.elementId, targets);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) if (visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...adjacency.keys()].some(visit);
}

export function topologicalSort(project: OpenNodeProject, includedIds?: ReadonlySet<string>): string[] {
  const ids = new Set(
    [...project.nodes.filter((node) => !node.parentContainerId), ...project.containers]
      .map((element) => element.id)
      .filter((id) => !includedIds || includedIds.has(id)),
  );
  const indegree = new Map([...ids].map((id) => [id, 0]));
  const adjacency = new Map<string, string[]>();
  for (const connection of project.connections) {
    if (connection.kind === "decorative" || !ids.has(connection.source.elementId) || !ids.has(connection.target.elementId)) continue;
    adjacency.set(connection.source.elementId, [...(adjacency.get(connection.source.elementId) ?? []), connection.target.elementId]);
    indegree.set(connection.target.elementId, (indegree.get(connection.target.elementId) ?? 0) + 1);
  }
  const queue = [...ids].filter((id) => indegree.get(id) === 0).sort();
  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    sorted.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const degree = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  if (sorted.length !== ids.size) throw new Error("Computational graph contains a cycle");
  return sorted;
}

export function downstreamIds(project: OpenNodeProject, startIds: Iterable<string>): Set<string> {
  const result = new Set(startIds);
  const queue = [...result];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const connection of project.connections) {
      if (connection.kind !== "decorative" && connection.source.elementId === current && !result.has(connection.target.elementId)) {
        result.add(connection.target.elementId);
        queue.push(connection.target.elementId);
      }
    }
  }
  return result;
}

export function upstreamIds(project: OpenNodeProject, startIds: Iterable<string>): Set<string> {
  const result = new Set(startIds);
  const queue = [...result];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const connection of project.connections) {
      if (connection.kind !== "decorative" && connection.target.elementId === current && !result.has(connection.source.elementId)) {
        result.add(connection.source.elementId);
        queue.push(connection.source.elementId);
      }
    }
  }
  return result;
}

export function validateProject(project: OpenNodeProject): ValidationResult {
  const issues: ValidationIssue[] = [];
  const error = (code: string, message: string, path: string) => issues.push({ code, message, path, severity: "error" });
  const allElements = [...project.nodes, ...project.containers, ...project.groups, ...project.annotations];
  const ids = new Set<string>();
  for (const element of allElements) {
    if (ids.has(element.id)) error("duplicate-id", `Duplicate element id: ${element.id}`, element.id);
    ids.add(element.id);
    if (!Number.isFinite(element.position.x) || !Number.isFinite(element.position.y)) error("invalid-position", "Element position must be finite", element.id);
    if (element.size.width <= 0 || element.size.height <= 0) error("invalid-size", "Element size must be positive", element.id);
  }
  const connectionIds = new Set<string>();
  for (const connection of project.connections) {
    if (connectionIds.has(connection.id)) error("duplicate-connection-id", `Duplicate connection id: ${connection.id}`, `connections.${connection.id}`);
    connectionIds.add(connection.id);
    if (!ids.has(connection.source.elementId)) error("missing-source", `Missing source element ${connection.source.elementId}`, `connections.${connection.id}.source`);
    if (!ids.has(connection.target.elementId)) error("missing-target", `Missing target element ${connection.target.elementId}`, `connections.${connection.id}.target`);
    if (connection.kind !== "decorative") {
      const source = findPort(project, connection.source.elementId, connection.source.portId);
      const target = findPort(project, connection.target.elementId, connection.target.portId);
      if (!source) error("missing-port", `Missing source port ${connection.source.portId}`, `connections.${connection.id}.source`);
      if (!target) error("missing-port", `Missing target port ${connection.target.portId}`, `connections.${connection.id}.target`);
      if (source?.direction !== "output") error("invalid-direction", "Connection source must be an output", `connections.${connection.id}.source`);
      if (target?.direction !== "input") error("invalid-direction", "Connection target must be an input", `connections.${connection.id}.target`);
      const targetNode = project.nodes.find((node) => node.id === connection.target.elementId);
      const sourceNode = project.nodes.find((node) => node.id === connection.source.elementId);
      if (targetNode?.parentContainerId || sourceNode?.parentContainerId) error("container-boundary", "External connections cannot target nodes inside a Container", `connections.${connection.id}`);
    }
  }
  for (const container of project.containers) {
    const unique = new Set(container.nodeIds);
    if (unique.size !== container.nodeIds.length) error("duplicate-container-member", "Container contains a node more than once", `containers.${container.id}.nodeIds`);
    for (const nodeId of container.nodeIds) {
      const node = project.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) error("missing-container-member", `Container member ${nodeId} does not exist`, `containers.${container.id}.nodeIds`);
      else if (node.parentContainerId !== container.id) error("container-parent-mismatch", `Node ${nodeId} parent does not match Container`, `nodes.${nodeId}.parentContainerId`);
    }
  }
  for (const node of project.nodes) {
    const portIds = node.ports.map((port) => port.id);
    if (new Set(portIds).size !== portIds.length) error("duplicate-port-id", `Node ${node.id} has duplicate port ids`, `nodes.${node.id}.ports`);
    if (node.parentContainerId && !project.containers.some((container) => container.id === node.parentContainerId && container.nodeIds.includes(node.id))) {
      error("missing-container-parent", `Node parent Container ${node.parentContainerId} is missing or inconsistent`, `nodes.${node.id}.parentContainerId`);
    }
    if (node.parentGroupId && !project.groups.some((group) => group.id === node.parentGroupId && group.memberNodeIds.includes(node.id))) {
      error("missing-group-parent", `Node parent Group ${node.parentGroupId} is missing or inconsistent`, `nodes.${node.id}.parentGroupId`);
    }
  }
  for (const container of project.containers) {
    if (container.parentGroupId && !project.groups.some((group) => group.id === container.parentGroupId && group.memberContainerIds.includes(container.id))) {
      error("missing-group-parent", `Container parent Group ${container.parentGroupId} is missing or inconsistent`, `containers.${container.id}.parentGroupId`);
    }
  }
  for (const group of project.groups) {
    if (new Set(group.memberNodeIds).size !== group.memberNodeIds.length || new Set(group.memberContainerIds).size !== group.memberContainerIds.length) {
      error("duplicate-group-member", "Group contains an element more than once", `groups.${group.id}`);
    }
    for (const nodeId of group.memberNodeIds) {
      const node = project.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) error("missing-group-member", `Group member ${nodeId} does not exist`, `groups.${group.id}.memberNodeIds`);
      else if (node.parentGroupId !== group.id) error("group-parent-mismatch", `Node ${nodeId} parent does not match Group`, `nodes.${nodeId}.parentGroupId`);
    }
    for (const containerId of group.memberContainerIds) {
      const container = project.containers.find((candidate) => candidate.id === containerId);
      if (!container) error("missing-group-member", `Group member ${containerId} does not exist`, `groups.${group.id}.memberContainerIds`);
      else if (container.parentGroupId !== group.id) error("group-parent-mismatch", `Container ${containerId} parent does not match Group`, `containers.${containerId}.parentGroupId`);
    }
  }
  const edgeKeys = new Set<string>();
  for (const connection of project.connections) {
    const key = `${connection.kind}:${JSON.stringify(connection.source)}:${JSON.stringify(connection.target)}`;
    if (edgeKeys.has(key)) error("duplicate-edge", "Duplicate connection endpoints are not allowed", `connections.${connection.id}`);
    edgeKeys.add(key);
    if (connection.kind !== "decorative") {
      const target = findPort(project, connection.target.elementId, connection.target.portId);
      if (!target?.multiple) {
        const incoming = project.connections.filter((candidate) => candidate.kind !== "decorative" && candidate.target.elementId === connection.target.elementId && candidate.target.portId === connection.target.portId);
        if (incoming.length > 1) error("port-cardinality", `Port ${connection.target.portId} accepts only one connection`, `connections.${connection.id}.target`);
      }
    }
  }
  if (hasComputationalCycle(project)) error("computational-cycle", "Arbitrary computational cycles are not allowed in v0", "connections");
  if (project.timeline.fps <= 0 || project.timeline.fps > 1000) error("invalid-fps", "Timeline FPS must be between 0 and 1000", "timeline.fps");
  if (project.execution.concurrency < 1) error("invalid-concurrency", "Execution concurrency must be at least 1", "execution.concurrency");
  return { valid: issues.every((issue) => issue.severity !== "error"), issues };
}

type Listener = (event: ProjectChangeEvent) => void;

export class ProjectStore {
  #project: OpenNodeProject;
  #revision = 0;
  #listeners = new Set<Listener>();

  constructor(project: OpenNodeProject = createEmptyProject()) {
    const validation = validateProject(project);
    if (!validation.valid) throw new Error(`Invalid project: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    this.#project = cloneProject(project);
  }

  get revision(): number {
    return this.#revision;
  }

  get project(): OpenNodeProject {
    return this.#project;
  }

  snapshot(): OpenNodeProject {
    return cloneProject(this.#project);
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  replace(project: OpenNodeProject, reason: ProjectChangeReason = "load", validate = true): void {
    const next = cloneProject(project);
    if (validate) {
      const result = validateProject(next);
      if (!result.valid) throw new Error(`Invalid project: ${result.issues.map((issue) => issue.message).join("; ")}`);
    }
    this.#project = next;
    this.#emit(reason);
  }

  mutate(mutator: (draft: OpenNodeProject) => void, reason: ProjectChangeReason = "transaction"): void {
    const draft = cloneProject(this.#project);
    mutator(draft);
    draft.metadata.updatedAt = new Date().toISOString();
    const result = validateProject(draft);
    if (!result.valid) throw new Error(`Invalid project mutation: ${result.issues.map((issue) => issue.message).join("; ")}`);
    this.#project = draft;
    this.#emit(reason);
  }

  #emit(reason: ProjectChangeReason): void {
    this.#revision += 1;
    const event = { project: this.#project, reason, revision: this.#revision };
    for (const listener of this.#listeners) listener(event);
  }
}
