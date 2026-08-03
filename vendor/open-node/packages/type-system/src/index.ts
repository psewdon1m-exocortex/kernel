import {
  findPort,
  getComputationalElement,
  getElement,
  hasComputationalCycle,
  type ComputationalConnection,
  type Connection,
  type OpenNodeProject,
  type ValidationIssue,
  type ValidationResult,
} from "@open-node/model";

export interface TypeDefinition<T = unknown> {
  id: string;
  displayName: string;
  family: string;
  color?: string;
  validate(value: unknown): boolean;
  serialize?(value: T): unknown;
  deserialize?(value: unknown): T;
}

export interface CompatibilityResult {
  compatible: boolean;
  implicit: boolean;
  reason?: string;
  converterTypeId?: string;
}

export interface ParsedTypeId {
  kind: "plain" | "list" | "optional" | "stream" | "frame";
  id: string;
  inner?: ParsedTypeId;
}

const TYPE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const GENERIC_TYPE = /^(list|optional|stream|frame)<(.+)>$/;

export function parseTypeId(id: string): ParsedTypeId {
  const match = GENERIC_TYPE.exec(id);
  if (!match) return { kind: "plain", id };
  return { kind: match[1] as ParsedTypeId["kind"], id, inner: parseTypeId(match[2] ?? "core.any") };
}

export function genericType(kind: Exclude<ParsedTypeId["kind"], "plain">, innerTypeId: string): string {
  return `${kind}<${innerTypeId}>`;
}

export class TypeRegistry {
  #types = new Map<string, TypeDefinition>();
  #implicit = new Map<string, Set<string>>();
  #converters = new Map<string, string>();

  register<T>(definition: TypeDefinition<T>): this {
    if (!TYPE_ID.test(definition.id)) throw new Error(`Invalid stable type id: ${definition.id}`);
    if (this.#types.has(definition.id)) throw new Error(`Type is already registered: ${definition.id}`);
    this.#types.set(definition.id, definition as TypeDefinition);
    return this;
  }

  registerImplicit(from: string, to: string): this {
    const targets = this.#implicit.get(from) ?? new Set<string>();
    targets.add(to);
    this.#implicit.set(from, targets);
    return this;
  }

  registerConverter(from: string, to: string, nodeTypeId: string): this {
    this.#converters.set(`${from}->${to}`, nodeTypeId);
    return this;
  }

  get(id: string): TypeDefinition | undefined {
    const parsed = parseTypeId(id);
    if (parsed.kind !== "plain") return this.#genericDefinition(parsed);
    return this.#types.get(id);
  }

  has(id: string): boolean {
    return Boolean(this.get(id));
  }

  list(): TypeDefinition[] {
    return [...this.#types.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  validate(typeId: string, value: unknown): boolean {
    return this.get(typeId)?.validate(value) ?? false;
  }

  compatibility(from: string, to: string): CompatibilityResult {
    if (from === to || from === "core.any" || to === "core.any") return { compatible: true, implicit: false };
    if (this.#implicit.get(from)?.has(to)) return { compatible: true, implicit: true };
    const fromParsed = parseTypeId(from);
    const toParsed = parseTypeId(to);
    if (fromParsed.kind === toParsed.kind && fromParsed.kind !== "plain" && fromParsed.inner && toParsed.inner) {
      const inner = this.compatibility(fromParsed.inner.id, toParsed.inner.id);
      if (inner.compatible) return inner;
    }
    const converterTypeId = this.#converters.get(`${from}->${to}`);
    return {
      compatible: false,
      implicit: false,
      reason: converterTypeId ? `Explicit converter required: ${converterTypeId}` : `Type ${from} is not compatible with ${to}`,
      ...(converterTypeId ? { converterTypeId } : {}),
    };
  }

  #genericDefinition(parsed: ParsedTypeId): TypeDefinition | undefined {
    if (!parsed.inner || !this.get(parsed.inner.id)) return undefined;
    const innerId = parsed.inner.id;
    const validateInner = (value: unknown) => this.validate(innerId, value);
    switch (parsed.kind) {
      case "list":
        return { id: parsed.id, displayName: `List<${innerId}>`, family: "Values", validate: (value): value is unknown[] => Array.isArray(value) && value.every(validateInner) };
      case "optional":
        return { id: parsed.id, displayName: `Optional<${innerId}>`, family: "Values", validate: (value) => value == null || validateInner(value) };
      case "stream":
        return { id: parsed.id, displayName: `Stream<${innerId}>`, family: "IO", validate: (value) => value != null && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function" };
      case "frame":
        return { id: parsed.id, displayName: `Frame<${innerId}>`, family: "Media", validate: (value) => typeof value === "object" && value !== null && "frame" in value && validateInner((value as { frame: unknown }).frame) };
      default:
        return undefined;
    }
  }
}

const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function createCoreTypeRegistry(): TypeRegistry {
  const registry = new TypeRegistry();
  const definitions: TypeDefinition[] = [
    { id: "core.exec", displayName: "Execution", family: "Control", validate: (value) => value === undefined || value === null || value === true },
    { id: "core.boolean", displayName: "Boolean", family: "Values", validate: (value) => typeof value === "boolean" },
    { id: "core.integer", displayName: "Integer", family: "Values", validate: (value) => Number.isInteger(value) },
    { id: "core.float", displayName: "Float", family: "Values", validate: number },
    { id: "core.string", displayName: "String", family: "Text", validate: (value) => typeof value === "string" },
    { id: "core.color", displayName: "Color", family: "Color", validate: (value) => typeof value === "string" && /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(value) },
    { id: "core.vector2", displayName: "Vector 2", family: "Values", validate: (value) => Array.isArray(value) && value.length === 2 && value.every(number) },
    { id: "core.vector3", displayName: "Vector 3", family: "Values", validate: (value) => Array.isArray(value) && value.length === 3 && value.every(number) },
    { id: "core.list", displayName: "List", family: "Values", validate: Array.isArray },
    { id: "core.table", displayName: "Table", family: "Table/Data", validate: (value) => Array.isArray(value) && value.every(record) },
    { id: "core.json", displayName: "JSON", family: "Table/Data", validate: (value) => value === null || ["string", "number", "boolean"].includes(typeof value) || Array.isArray(value) || record(value) },
    { id: "core.binary", displayName: "Binary", family: "IO", validate: (value) => value instanceof Uint8Array || value instanceof ArrayBuffer },
    { id: "core.file", displayName: "File", family: "IO", validate: (value) => record(value) && typeof value["name"] === "string" },
    { id: "core.any", displayName: "Any", family: "Custom", validate: (_value) => true },
    { id: "media.image", displayName: "Image", family: "Media", validate: record },
    { id: "media.video", displayName: "Video", family: "Media", validate: record },
    { id: "media.audio", displayName: "Audio", family: "Media", validate: record },
  ];
  for (const definition of definitions) registry.register(definition);
  registry.registerImplicit("core.integer", "core.float");
  registry.registerConverter("core.integer", "core.string", "open-node.core.to-string");
  registry.registerConverter("core.float", "core.string", "open-node.core.to-string");
  registry.registerConverter("core.string", "core.float", "open-node.core.parse-number");
  registry.registerConverter("core.table", "core.json", "open-node.core.table-to-json");
  registry.registerConverter("core.json", "core.table", "open-node.core.json-to-table");
  return registry;
}

export interface ConnectionValidationOptions {
  allowDuplicate?: boolean;
}

export function validateConnection(
  project: OpenNodeProject,
  connection: Connection,
  types: TypeRegistry,
  options: ConnectionValidationOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const reject = (code: string, message: string, path = "connection") => issues.push({ code, message, path, severity: "error" as const });
  if (connection.source.elementId === connection.target.elementId) reject("self-connection", "An element cannot connect to itself");
  const sourceElement = getElement(project, connection.source.elementId);
  const targetElement = getElement(project, connection.target.elementId);
  if (!sourceElement) reject("missing-source", `Source element not found: ${connection.source.elementId}`, "connection.source");
  if (!targetElement) reject("missing-target", `Target element not found: ${connection.target.elementId}`, "connection.target");

  if (connection.kind === "decorative") {
    const anchors = [connection.source.normalizedAnchor, connection.target.normalizedAnchor];
    if (anchors.some((anchor) => anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1)) reject("invalid-anchor", "Decorative anchors must be normalized between 0 and 1");
    return { valid: issues.length === 0, issues };
  }

  const source = findPort(project, connection.source.elementId, connection.source.portId);
  const target = findPort(project, connection.target.elementId, connection.target.portId);
  if (!source) reject("missing-port", `Source port not found: ${connection.source.portId}`, "connection.source.portId");
  if (!target) reject("missing-port", `Target port not found: ${connection.target.portId}`, "connection.target.portId");
  if (source?.direction !== "output") reject("invalid-direction", "Connection source must be an output", "connection.source.portId");
  if (target?.direction !== "input") reject("invalid-direction", "Connection target must be an input", "connection.target.portId");
  if (source && source.kind !== connection.kind) reject("invalid-kind", `Source port is ${source.kind}, connection is ${connection.kind}`);
  if (target && target.kind !== connection.kind) reject("invalid-kind", `Target port is ${target.kind}, connection is ${connection.kind}`);
  if (source && target && connection.kind === "data") {
    const compatibility = types.compatibility(source.typeId, target.typeId);
    if (!compatibility.compatible) reject("incompatible-types", compatibility.reason ?? "Port types are incompatible");
  }
  const sourceNode = project.nodes.find((node) => node.id === connection.source.elementId);
  const targetNode = project.nodes.find((node) => node.id === connection.target.elementId);
  if (sourceNode?.parentContainerId || targetNode?.parentContainerId) reject("container-boundary", "Nodes inside a Container cannot have external connections");
  const incoming = project.connections.filter(
    (candidate): candidate is ComputationalConnection =>
      candidate.kind !== "decorative" && candidate.target.elementId === connection.target.elementId && candidate.target.portId === connection.target.portId,
  );
  if (incoming.length > 0 && !target?.multiple) reject("cardinality", "Target port only accepts one connection");
  if (!options.allowDuplicate && project.connections.some((candidate) => candidate.kind === connection.kind && JSON.stringify(candidate.source) === JSON.stringify(connection.source) && JSON.stringify(candidate.target) === JSON.stringify(connection.target))) {
    reject("duplicate-edge", "This connection already exists");
  }
  if (getComputationalElement(project, connection.source.elementId) && getComputationalElement(project, connection.target.elementId) && hasComputationalCycle(project, connection)) reject("computational-cycle", "Arbitrary computational cycles are not allowed in v0");
  return { valid: issues.length === 0, issues };
}
