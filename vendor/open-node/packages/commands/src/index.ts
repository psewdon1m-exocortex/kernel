import {
  cloneProject,
  createId,
  type CanvasAnnotation,
  type Connection,
  type ContainerInstance,
  type GroupInstance,
  type NodeInstance,
  type OpenNodeProject,
  type ProjectChangeReason,
  type ProjectStore,
} from "@open-node/model";

export interface Command {
  readonly label: string;
  execute(): void | Promise<void>;
  undo(): void | Promise<void>;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
}

type HistoryListener = (state: HistoryState) => void;

export class CommandHistory {
  #undo: Command[] = [];
  #redo: Command[] = [];
  #listeners = new Set<HistoryListener>();
  #busy = false;

  constructor(readonly limit = 200) {}

  get state(): HistoryState {
    const undoLabel = this.#undo.at(-1)?.label;
    const redoLabel = this.#redo.at(-1)?.label;
    return {
      canUndo: this.#undo.length > 0,
      canRedo: this.#redo.length > 0,
      ...(undoLabel ? { undoLabel } : {}),
      ...(redoLabel ? { redoLabel } : {}),
    };
  }

  subscribe(listener: HistoryListener): () => void {
    this.#listeners.add(listener);
    listener(this.state);
    return () => this.#listeners.delete(listener);
  }

  async execute(command: Command): Promise<void> {
    this.#assertIdle();
    this.#busy = true;
    try {
      await command.execute();
      this.#undo.push(command);
      if (this.#undo.length > this.limit) this.#undo.shift();
      this.#redo = [];
    } finally {
      this.#busy = false;
      this.#emit();
    }
  }

  async undo(): Promise<boolean> {
    this.#assertIdle();
    const command = this.#undo.pop();
    if (!command) return false;
    this.#busy = true;
    try {
      await command.undo();
      this.#redo.push(command);
      return true;
    } catch (error) {
      this.#undo.push(command);
      throw error;
    } finally {
      this.#busy = false;
      this.#emit();
    }
  }

  async redo(): Promise<boolean> {
    this.#assertIdle();
    const command = this.#redo.pop();
    if (!command) return false;
    this.#busy = true;
    try {
      await command.execute();
      this.#undo.push(command);
      return true;
    } catch (error) {
      this.#redo.push(command);
      throw error;
    } finally {
      this.#busy = false;
      this.#emit();
    }
  }

  clear(): void {
    this.#undo = [];
    this.#redo = [];
    this.#emit();
  }

  #assertIdle(): void {
    if (this.#busy) throw new Error("Command history is already executing a command");
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.state);
  }
}

export function projectCommand(
  store: ProjectStore,
  label: string,
  mutator: (project: OpenNodeProject) => void,
  reason: ProjectChangeReason = "transaction",
): Command {
  let before: OpenNodeProject | undefined;
  let after: OpenNodeProject | undefined;
  return {
    label,
    execute() {
      if (after) {
        store.replace(after, reason);
        return;
      }
      before = store.snapshot();
      store.mutate(mutator, reason);
      after = store.snapshot();
    },
    undo() {
      if (!before) throw new Error(`Command was never executed: ${label}`);
      store.replace(before, reason);
    },
  };
}

export class ProjectTransaction {
  #mutators: Array<(project: OpenNodeProject) => void> = [];
  #closed = false;

  constructor(
    private readonly store: ProjectStore,
    readonly label = "Transaction",
  ) {}

  mutate(mutator: (project: OpenNodeProject) => void): this {
    if (this.#closed) throw new Error("Transaction is already closed");
    this.#mutators.push(mutator);
    return this;
  }

  toCommand(): Command {
    if (this.#closed) throw new Error("Transaction is already closed");
    this.#closed = true;
    const mutators = [...this.#mutators];
    return projectCommand(this.store, this.label, (project) => {
      for (const mutate of mutators) mutate(project);
    });
  }

  rollback(): void {
    this.#closed = true;
    this.#mutators = [];
  }
}

export function removeElements(project: OpenNodeProject, elementIds: Iterable<string>): void {
  const ids = new Set(elementIds);
  const deletedContainers = new Set(project.containers.filter((container) => ids.has(container.id)).map((container) => container.id));
  const containerChildren = project.nodes.filter((node) => node.parentContainerId && deletedContainers.has(node.parentContainerId)).map((node) => node.id);
  for (const id of containerChildren) ids.add(id);
  project.nodes = project.nodes.filter((node) => !ids.has(node.id)).map((node) => ({
    ...node,
    parentContainerId: node.parentContainerId && ids.has(node.parentContainerId) ? null : node.parentContainerId,
    parentGroupId: node.parentGroupId && ids.has(node.parentGroupId) ? null : node.parentGroupId,
  }));
  project.containers = project.containers.filter((container) => !ids.has(container.id)).map((container) => ({
    ...container,
    nodeIds: container.nodeIds.filter((id) => !ids.has(id)),
    parentGroupId: container.parentGroupId && ids.has(container.parentGroupId) ? null : container.parentGroupId,
  }));
  project.groups = project.groups.filter((group) => !ids.has(group.id)).map((group) => ({
    ...group,
    memberNodeIds: group.memberNodeIds.filter((id) => !ids.has(id)),
    memberContainerIds: group.memberContainerIds.filter((id) => !ids.has(id)),
  }));
  project.annotations = project.annotations.filter((annotation) => !ids.has(annotation.id));
  project.connections = project.connections.filter((connection) => !ids.has(connection.source.elementId) && !ids.has(connection.target.elementId));
}

export interface ClipboardGraph {
  nodes: NodeInstance[];
  containers: ContainerInstance[];
  groups: GroupInstance[];
  annotations: CanvasAnnotation[];
  connections: Connection[];
}

export function copySelection(project: OpenNodeProject, elementIds: Iterable<string>): ClipboardGraph {
  const ids = new Set(elementIds);
  const groups = project.groups.filter((group) => ids.has(group.id));
  for (const group of groups) {
    for (const nodeId of group.memberNodeIds) ids.add(nodeId);
    for (const containerId of group.memberContainerIds) ids.add(containerId);
  }
  const containers = project.containers.filter((container) => ids.has(container.id));
  for (const container of containers) for (const nodeId of container.nodeIds) ids.add(nodeId);
  return {
    nodes: cloneProject({ ...project, nodes: project.nodes.filter((node) => ids.has(node.id)) }).nodes,
    containers: structuredClone(containers),
    groups: structuredClone(groups),
    annotations: structuredClone(project.annotations.filter((annotation) => ids.has(annotation.id))),
    connections: structuredClone(project.connections.filter((connection) => ids.has(connection.source.elementId) && ids.has(connection.target.elementId))),
  };
}

export function pasteSelection(project: OpenNodeProject, clipboard: ClipboardGraph, offset = { x: 32, y: 32 }): string[] {
  const idMap = new Map<string, string>();
  for (const item of [...clipboard.nodes, ...clipboard.containers, ...clipboard.groups, ...clipboard.annotations]) idMap.set(item.id, createId(item.kind));
  const mapId = (id: string | null): string | null => (id ? idMap.get(id) ?? null : null);
  const mapContainerParent = (id: string | null): string | null => id ? idMap.get(id) ?? (project.containers.some((container) => container.id === id) ? id : null) : null;
  const mapGroupParent = (id: string | null): string | null => id ? idMap.get(id) ?? (project.groups.some((group) => group.id === id) ? id : null) : null;
  const nodes = clipboard.nodes.map((node) => ({
    ...structuredClone(node),
    id: idMap.get(node.id)!,
    position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
    parentContainerId: mapContainerParent(node.parentContainerId),
    parentGroupId: mapGroupParent(node.parentGroupId),
  }));
  const containers = clipboard.containers.map((container) => ({
    ...structuredClone(container),
    id: idMap.get(container.id)!,
    position: { x: container.position.x + offset.x, y: container.position.y + offset.y },
    nodeIds: container.nodeIds.map((id) => idMap.get(id)).filter((id): id is string => Boolean(id)),
    parentGroupId: mapGroupParent(container.parentGroupId),
  }));
  const groups = clipboard.groups.map((group) => ({
    ...structuredClone(group),
    id: idMap.get(group.id)!,
    position: { x: group.position.x + offset.x, y: group.position.y + offset.y },
    memberNodeIds: group.memberNodeIds.map((id) => idMap.get(id)).filter((id): id is string => Boolean(id)),
    memberContainerIds: group.memberContainerIds.map((id) => idMap.get(id)).filter((id): id is string => Boolean(id)),
    bypassSnapshot: undefined,
  }));
  const annotations = clipboard.annotations.map((annotation) => ({
    ...structuredClone(annotation),
    id: idMap.get(annotation.id)!,
    position: { x: annotation.position.x + offset.x, y: annotation.position.y + offset.y },
  }));
  const connections = clipboard.connections.map((connection) => ({
    ...structuredClone(connection),
    id: createId("connection"),
    source: { ...connection.source, elementId: idMap.get(connection.source.elementId)! },
    target: { ...connection.target, elementId: idMap.get(connection.target.elementId)! },
  })) as Connection[];
  project.nodes.push(...nodes);
  project.containers.push(...containers);
  project.groups.push(...groups);
  project.annotations.push(...annotations);
  project.connections.push(...connections);
  for (const node of nodes) {
    if (node.parentContainerId) {
      const parent = project.containers.find((container) => container.id === node.parentContainerId);
      if (parent && !parent.nodeIds.includes(node.id)) parent.nodeIds.push(node.id);
    }
    if (node.parentGroupId) {
      const parent = project.groups.find((group) => group.id === node.parentGroupId);
      if (parent && !parent.memberNodeIds.includes(node.id)) parent.memberNodeIds.push(node.id);
    }
  }
  for (const container of containers) {
    if (!container.parentGroupId) continue;
    const parent = project.groups.find((group) => group.id === container.parentGroupId);
    if (parent && !parent.memberContainerIds.includes(container.id)) parent.memberContainerIds.push(container.id);
  }
  return [...nodes, ...containers, ...groups, ...annotations].map((item) => item.id);
}

export function moveElements(project: OpenNodeProject, elementIds: Iterable<string>, delta: { x: number; y: number }): void {
  const ids = new Set(elementIds);
  const groups = project.groups.filter((group) => ids.has(group.id));
  for (const group of groups) {
    for (const memberId of [...group.memberNodeIds, ...group.memberContainerIds]) ids.add(memberId);
  }
  for (const element of [...project.nodes, ...project.containers, ...project.groups, ...project.annotations]) {
    if (ids.has(element.id)) element.position = { x: element.position.x + delta.x, y: element.position.y + delta.y };
  }
}

export function setGroupBypass(project: OpenNodeProject, groupId: string, bypassed: boolean): void {
  const group = project.groups.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error(`Group not found: ${groupId}`);
  const members = [...project.nodes, ...project.containers].filter((element) => element.parentGroupId === groupId);
  if (bypassed && !group.bypassed) {
    group.bypassSnapshot = Object.fromEntries(members.map((element) => [element.id, element.bypassed]));
    for (const member of members) member.bypassed = true;
  } else if (!bypassed && group.bypassed) {
    for (const member of members) member.bypassed = group.bypassSnapshot?.[member.id] ?? false;
    group.bypassSnapshot = undefined;
  }
  group.bypassed = bypassed;
}
