import { CommandHistory, moveElements, projectCommand, removeElements, setGroupBypass, type Command } from "@open-node/commands";
import type { ExecutionRunOptions, ExecutionRuntime, ExecutionSession } from "@open-node/engine";
import { loadProjectJson, serializeProject, type ProjectLoadReport } from "@open-node/io";
import {
  cloneProject,
  createContainer,
  createGroup,
  createId,
  getElement,
  type Connection,
  type ConnectionRouting,
  type OpenNodeProject,
  type Point,
  type ProjectStore,
  type Rect,
} from "@open-node/model";
import { createNodeFromDefinition, type NodeRegistry } from "@open-node/sdk";
import type { TimelineRuntime } from "@open-node/timeline";
import { validateConnection, type TypeRegistry } from "@open-node/type-system";

export type MachineScope = "read" | "write" | "execute" | "timeline" | "files";

export interface MachinePermissions {
  scopes: MachineScope[];
  allowedNodeTypes?: string[];
  maxTransactionOperations?: number;
}

export interface AuditEvent {
  timestamp: string;
  operation: string;
  scope: MachineScope;
  details: Record<string, unknown>;
  success: boolean;
  error?: string;
}

export interface MachineApiOptions {
  permissions?: MachinePermissions;
  audit?: (event: AuditEvent) => void;
}

export interface SearchQuery {
  id?: string;
  typeId?: string;
  name?: string;
  tag?: string;
}

interface MachineContext {
  store: ProjectStore;
  history: CommandHistory;
  nodes: NodeRegistry;
  types: TypeRegistry;
  runtime: ExecutionRuntime;
  timeline: TimelineRuntime;
}

type ProjectOperation = (project: OpenNodeProject) => void;

export class MachineApi {
  readonly permissions: MachinePermissions;
  #selected = new Set<string>();
  #activeSession?: ExecutionSession;

  constructor(
    readonly context: MachineContext,
    private readonly options: MachineApiOptions = {},
  ) {
    this.permissions = options.permissions ?? { scopes: ["read"], maxTransactionOperations: 100 };
  }

  getProjectMetadata() {
    this.#require("read", "getProjectMetadata");
    return structuredClone(this.context.store.project.metadata);
  }

  getElements() {
    this.#require("read", "getElements");
    const project = this.context.store.project;
    return { nodes: structuredClone(project.nodes), containers: structuredClone(project.containers), groups: structuredClone(project.groups) };
  }

  getConnections(): Connection[] {
    this.#require("read", "getConnections");
    return structuredClone(this.context.store.project.connections);
  }

  getSelected(): string[] {
    this.#require("read", "getSelected");
    return [...this.#selected];
  }

  setSelected(ids: Iterable<string>): void {
    this.#require("write", "setSelected");
    const valid = new Set([...ids].filter((id) => getElement(this.context.store.project, id)));
    this.#selected = valid;
  }

  search(query: SearchQuery) {
    this.#require("read", "search");
    const project = this.context.store.project;
    return [...project.nodes, ...project.containers, ...project.groups].filter((element) => {
      if (query.id && element.id !== query.id) return false;
      if (query.typeId && (element.kind !== "node" || element.nodeTypeId !== query.typeId)) return false;
      const name = element.kind === "node" ? element.label : element.kind === "container" ? element.name : element.name ?? "";
      if (query.name && !name.toLocaleLowerCase().includes(query.name.toLocaleLowerCase())) return false;
      if (query.tag && !(element.tags ?? []).includes(query.tag)) return false;
      return true;
    }).map((element) => structuredClone(element));
  }

  beginTransaction(label = "Machine API transaction"): MachineTransaction {
    this.#require("write", "beginTransaction");
    return new MachineTransaction(this, label);
  }

  async createNode(typeId: string, position: Point, parameters?: Record<string, unknown>): Promise<string> {
    const transaction = this.beginTransaction("Create Node");
    const id = transaction.createNode(typeId, position, parameters);
    await transaction.commit();
    return id;
  }

  async createContainer(rect: Rect, name?: string): Promise<string> {
    const transaction = this.beginTransaction("Create Container");
    const id = transaction.createContainer(rect, name);
    await transaction.commit();
    return id;
  }

  async createGroup(rect: Rect, name?: string): Promise<string> {
    const transaction = this.beginTransaction("Create Group");
    const id = transaction.createGroup(rect, name);
    await transaction.commit();
    return id;
  }

  async connect(sourceElementId: string, sourcePortId: string, targetElementId: string, targetPortId: string, kind: "data" | "control" = "data"): Promise<string> {
    const transaction = this.beginTransaction("Connect Elements");
    const id = transaction.connect(sourceElementId, sourcePortId, targetElementId, targetPortId, kind);
    await transaction.commit();
    return id;
  }

  async connectDecorative(sourceElementId: string, sourceAnchor: Point, targetElementId: string, targetAnchor: Point): Promise<string> {
    const transaction = this.beginTransaction("Create Decorative Connection");
    const id = transaction.connectDecorative(sourceElementId, sourceAnchor, targetElementId, targetAnchor);
    await transaction.commit();
    return id;
  }

  async deleteElements(ids: string[]): Promise<void> {
    const transaction = this.beginTransaction("Delete Elements");
    transaction.deleteElements(ids);
    await transaction.commit();
  }

  serialize(): string {
    this.#require("read", "serialize");
    return serializeProject(this.context.store.project);
  }

  async load(source: string | unknown): Promise<ProjectLoadReport> {
    this.#require("write", "load");
    const report = loadProjectJson(source);
    if (!report.valid || !report.project) return report;
    const before = this.context.store.snapshot();
    const after = cloneProject(report.project);
    await this.context.history.execute({
      label: "Load Project",
      execute: () => this.context.store.replace(after, "load"),
      undo: () => this.context.store.replace(before, "load"),
    });
    return report;
  }

  run(options: ExecutionRunOptions = {}): ExecutionSession {
    this.#require("execute", "run");
    this.#activeSession = this.context.runtime.run(this.context.store.snapshot(), options);
    return this.#activeSession;
  }

  stop(): void {
    this.#require("execute", "stop");
    this.#activeSession?.cancel();
    this.context.timeline.stop();
  }

  pause(): void {
    this.#require("timeline", "pause");
    this.context.timeline.pause();
  }

  getExecutionStatus() {
    this.#require("read", "getExecutionStatus");
    const session = this.#activeSession;
    if (!session) return null;
    return { id: session.id, status: session.status, progress: structuredClone(session.progress), errors: structuredClone(session.errors), results: [...session.results.values()].map((result) => structuredClone(result)) };
  }

  setTimelineTime(seconds: number): void {
    this.#require("timeline", "setTimelineTime");
    this.context.timeline.setTime(seconds);
  }

  setTimelineFrame(frame: number): void {
    this.#require("timeline", "setTimelineFrame");
    this.context.timeline.setFrame(frame);
  }

  fitViewport(ids?: string[]): void {
    this.#require("write", "fitViewport");
    this.#audit("fitViewport", "write", { ids: ids ?? [] }, true);
  }

  _queueOperation(transaction: MachineTransaction, operation: ProjectOperation): void {
    transaction._push(operation);
  }

  _assertNodeType(typeId: string): void {
    const allowed = this.permissions.allowedNodeTypes;
    if (allowed && !allowed.includes(typeId)) throw new Error(`Node type is not permitted: ${typeId}`);
  }

  _commit(label: string, operations: ProjectOperation[]): Promise<void> {
    const max = this.permissions.maxTransactionOperations ?? 100;
    if (operations.length > max) throw new Error(`Transaction exceeds the ${max} operation limit`);
    const command: Command = projectCommand(this.context.store, label, (project) => {
      for (const operation of operations) operation(project);
    });
    return this.#audited("transaction.commit", "write", { label, operations: operations.length }, () => this.context.history.execute(command));
  }

  #require(scope: MachineScope, operation: string): void {
    if (!this.permissions.scopes.includes(scope)) {
      this.#audit(operation, scope, {}, false, `Missing scope: ${scope}`);
      throw new Error(`Machine API permission denied: ${scope}`);
    }
  }

  async #audited<T>(operation: string, scope: MachineScope, details: Record<string, unknown>, action: () => Promise<T>): Promise<T> {
    this.#require(scope, operation);
    try {
      const value = await action();
      this.#audit(operation, scope, details, true);
      return value;
    } catch (error) {
      this.#audit(operation, scope, details, false, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  #audit(operation: string, scope: MachineScope, details: Record<string, unknown>, success: boolean, error?: string): void {
    this.options.audit?.({ timestamp: new Date().toISOString(), operation, scope, details, success, ...(error ? { error } : {}) });
  }
}

export class MachineTransaction {
  #operations: ProjectOperation[] = [];
  #closed = false;

  constructor(
    private readonly api: MachineApi,
    readonly label: string,
  ) {}

  get size(): number {
    return this.#operations.length;
  }

  createNode(typeId: string, position: Point, parameters?: Record<string, unknown>): string {
    this.#assertOpen();
    this.api._assertNodeType(typeId);
    const definition = this.api.context.nodes.require(typeId);
    const node = createNodeFromDefinition(definition, position);
    if (parameters) node.parameters = { ...node.parameters, ...structuredClone(parameters) };
    const validation = definition.validate(node.parameters);
    if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.message).join("; "));
    this._push((project) => project.nodes.push(structuredClone(node)));
    return node.id;
  }

  createContainer(rect: Rect, name?: string): string {
    this.#assertOpen();
    const container = createContainer({ x: rect.x, y: rect.y }, name);
    container.size = { width: rect.width, height: rect.height };
    this._push((project) => project.containers.push(structuredClone(container)));
    return container.id;
  }

  createGroup(rect: Rect, name?: string): string {
    this.#assertOpen();
    const group = createGroup(rect, name);
    this._push((project) => project.groups.push(structuredClone(group)));
    return group.id;
  }

  connect(sourceElementId: string, sourcePortId: string, targetElementId: string, targetPortId: string, kind: "data" | "control" = "data", routing: ConnectionRouting = "bezier"): string {
    this.#assertOpen();
    const connection: Connection = {
      id: createId("connection"), kind,
      source: { elementId: sourceElementId, portId: sourcePortId }, target: { elementId: targetElementId, portId: targetPortId },
      thickness: 2, opacity: 1, arrowhead: "end", routing, reroutePoints: [],
    };
    this._push((project) => {
      const validation = validateConnection(project, connection, this.api.context.types);
      if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.message).join("; "));
      project.connections.push(structuredClone(connection));
    });
    return connection.id;
  }

  connectDecorative(sourceElementId: string, sourceAnchor: Point, targetElementId: string, targetAnchor: Point, routing: ConnectionRouting = "straight"): string {
    this.#assertOpen();
    const connection: Connection = {
      id: createId("connection"), kind: "decorative",
      source: { elementId: sourceElementId, normalizedAnchor: sourceAnchor },
      target: { elementId: targetElementId, normalizedAnchor: targetAnchor },
      thickness: 1.5, opacity: 0.8, arrowhead: "none", routing, reroutePoints: [],
    };
    this._push((project) => {
      const validation = validateConnection(project, connection, this.api.context.types);
      if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.message).join("; "));
      project.connections.push(structuredClone(connection));
    });
    return connection.id;
  }

  deleteConnection(id: string): this {
    this.#assertOpen();
    this._push((project) => { project.connections = project.connections.filter((connection) => connection.id !== id); });
    return this;
  }

  deleteElements(ids: string[]): this {
    this.#assertOpen();
    this._push((project) => removeElements(project, ids));
    return this;
  }

  move(ids: string[], delta: Point): this {
    this.#assertOpen();
    this._push((project) => moveElements(project, ids, delta));
    return this;
  }

  resize(id: string, size: { width: number; height: number }): this {
    this.#assertOpen();
    if (size.width <= 0 || size.height <= 0) throw new Error("Element size must be positive");
    this._push((project) => {
      const element = getElement(project, id);
      if (!element) throw new Error(`Element not found: ${id}`);
      element.size = { ...size };
    });
    return this;
  }

  setParameters(nodeId: string, patch: Record<string, unknown>): this {
    this.#assertOpen();
    this._push((project) => {
      const node = project.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      const definition = this.api.context.nodes.require(node.nodeTypeId, node.nodeTypeVersion);
      const next = { ...node.parameters, ...structuredClone(patch) };
      const validation = definition.validate(next);
      if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.message).join("; "));
      node.parameters = next;
    });
    return this;
  }

  setBypass(id: string, bypassed: boolean): this {
    this.#assertOpen();
    this._push((project) => {
      const element = getElement(project, id);
      if (!element) throw new Error(`Element not found: ${id}`);
      if (element.kind === "group") setGroupBypass(project, id, bypassed);
      else element.bypassed = bypassed;
    });
    return this;
  }

  addNodeToContainer(nodeId: string, containerId: string, index?: number): this {
    this.#assertOpen();
    this._push((project) => {
      const node = project.nodes.find((candidate) => candidate.id === nodeId);
      const container = project.containers.find((candidate) => candidate.id === containerId);
      if (!node || !container) throw new Error("Node or Container not found");
      const definition = this.api.context.nodes.require(node.nodeTypeId, node.nodeTypeVersion);
      if (!definition.containerCompatible || !definition.containerAdapter) throw new Error(`${definition.displayName} is not Container-compatible`);
      if (node.parentContainerId) {
        const old = project.containers.find((candidate) => candidate.id === node.parentContainerId);
        if (old) old.nodeIds = old.nodeIds.filter((id) => id !== nodeId);
      }
      node.parentContainerId = containerId;
      const target = Math.max(0, Math.min(index ?? container.nodeIds.length, container.nodeIds.length));
      container.nodeIds.splice(target, 0, nodeId);
    });
    return this;
  }

  reorderContainer(containerId: string, nodeId: string, index: number): this {
    this.#assertOpen();
    this._push((project) => {
      const container = project.containers.find((candidate) => candidate.id === containerId);
      if (!container || !container.nodeIds.includes(nodeId)) throw new Error("Container or child Node not found");
      container.nodeIds = container.nodeIds.filter((id) => id !== nodeId);
      container.nodeIds.splice(Math.max(0, Math.min(index, container.nodeIds.length)), 0, nodeId);
    });
    return this;
  }

  addToGroup(elementId: string, groupId: string): this {
    this.#assertOpen();
    this._push((project) => {
      const element = getElement(project, elementId);
      const group = project.groups.find((candidate) => candidate.id === groupId);
      if (!element || !group || element.kind === "group") throw new Error("Only Nodes and Containers can be Group members");
      for (const current of project.groups) {
        current.memberNodeIds = current.memberNodeIds.filter((id) => id !== elementId);
        current.memberContainerIds = current.memberContainerIds.filter((id) => id !== elementId);
      }
      element.parentGroupId = groupId;
      if (element.kind === "node") group.memberNodeIds.push(elementId);
      else group.memberContainerIds.push(elementId);
    });
    return this;
  }

  _push(operation: ProjectOperation): void {
    this.#assertOpen();
    this.#operations.push(operation);
  }

  async commit(): Promise<void> {
    this.#assertOpen();
    this.#closed = true;
    await this.api._commit(this.label, [...this.#operations]);
  }

  rollback(): void {
    this.#assertOpen();
    this.#closed = true;
    this.#operations = [];
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Transaction is already closed");
  }
}
