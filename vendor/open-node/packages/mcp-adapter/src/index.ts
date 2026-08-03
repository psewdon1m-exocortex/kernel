import type { MachineApi } from "@open-node/machine-api";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" };
const number = { type: "number" };

export const openNodeMcpTools: McpToolDefinition[] = [
  { name: "open_project", description: "Validate and transactionally load an Open Node project JSON document.", inputSchema: objectSchema({ project: { type: ["object", "string"] } }, ["project"]) },
  { name: "inspect_graph", description: "Return project metadata, elements, connections, selection and execution status.", inputSchema: objectSchema({}) },
  { name: "search_nodes", description: "Find graph elements by id, Node type, name or tag.", inputSchema: objectSchema({ id: string, typeId: string, name: string, tag: string }) },
  { name: "create_node", description: "Create a registered Node at world coordinates.", inputSchema: objectSchema({ typeId: string, x: number, y: number, parameters: { type: "object" } }, ["typeId", "x", "y"]) },
  { name: "connect_nodes", description: "Create a typed data or control connection between ports.", inputSchema: objectSchema({ sourceElementId: string, sourcePortId: string, targetElementId: string, targetPortId: string, kind: { enum: ["data", "control"] } }, ["sourceElementId", "sourcePortId", "targetElementId", "targetPortId"]) },
  { name: "set_parameter", description: "Update one Node parameter transactionally.", inputSchema: objectSchema({ nodeId: string, parameter: string, value: {} }, ["nodeId", "parameter"]) },
  { name: "run_pipeline", description: "Run the graph in a supported execution mode.", inputSchema: objectSchema({ mode: { enum: ["manual", "reactive", "continuous", "timeline"] }, scope: { enum: ["all", "selected", "downstream", "from"] }, elementIds: { type: "array", items: string }, allowSideEffects: { type: "boolean" } }) },
  { name: "stop_pipeline", description: "Cancel the active execution session.", inputSchema: objectSchema({}) },
  { name: "get_execution_status", description: "Return active execution progress, results and formal errors.", inputSchema: objectSchema({}) },
  { name: "set_timeline_frame", description: "Set the project Timeline playhead frame.", inputSchema: objectSchema({ frame: { type: "integer", minimum: 0 } }, ["frame"]) },
  { name: "export_project", description: "Serialize the canonical .onode.json project document.", inputSchema: objectSchema({}) },
];

export class OpenNodeMcpAdapter {
  constructor(readonly api: MachineApi) {}

  listTools(): McpToolDefinition[] {
    return structuredClone(openNodeMcpTools);
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    try {
      const value = await this.#dispatch(name, args);
      return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
    }
  }

  async handleJsonRpc(request: { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> }) {
    const id = request.id ?? null;
    try {
      if (request.method === "tools/list") return { jsonrpc: "2.0" as const, id, result: { tools: this.listTools() } };
      if (request.method === "tools/call") {
        const params = request.params ?? {};
        const result = await this.callTool(requiredString(params, "name"), (params["arguments"] as Record<string, unknown> | undefined) ?? {});
        return { jsonrpc: "2.0" as const, id, result };
      }
      return { jsonrpc: "2.0" as const, id, error: { code: -32601, message: `Method not found: ${request.method}` } };
    } catch (error) {
      return { jsonrpc: "2.0" as const, id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } };
    }
  }

  async #dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "open_project": {
        const report = await this.api.load(args["project"]);
        return { valid: report.valid, issues: report.issues, migrated: report.migrated, migrationPath: report.migrationPath };
      }
      case "inspect_graph":
        return { metadata: this.api.getProjectMetadata(), ...this.api.getElements(), connections: this.api.getConnections(), selected: this.api.getSelected(), execution: this.api.getExecutionStatus() };
      case "search_nodes":
        return this.api.search({
          ...(typeof args["id"] === "string" ? { id: args["id"] } : {}),
          ...(typeof args["typeId"] === "string" ? { typeId: args["typeId"] } : {}),
          ...(typeof args["name"] === "string" ? { name: args["name"] } : {}),
          ...(typeof args["tag"] === "string" ? { tag: args["tag"] } : {}),
        });
      case "create_node": {
        const id = await this.api.createNode(requiredString(args, "typeId"), { x: requiredNumber(args, "x"), y: requiredNumber(args, "y") }, asRecord(args["parameters"]));
        return { id };
      }
      case "connect_nodes": {
        const id = await this.api.connect(requiredString(args, "sourceElementId"), requiredString(args, "sourcePortId"), requiredString(args, "targetElementId"), requiredString(args, "targetPortId"), args["kind"] === "control" ? "control" : "data");
        return { id };
      }
      case "set_parameter": {
        const transaction = this.api.beginTransaction("MCP: set parameter");
        transaction.setParameters(requiredString(args, "nodeId"), { [requiredString(args, "parameter")]: args["value"] });
        await transaction.commit();
        return { ok: true };
      }
      case "run_pipeline": {
        const session = this.api.run({
          mode: isExecutionMode(args["mode"]) ? args["mode"] : "manual",
          scope: isScope(args["scope"]) ? args["scope"] : "all",
          elementIds: Array.isArray(args["elementIds"]) ? args["elementIds"].filter((id): id is string => typeof id === "string") : [],
          allowSideEffects: args["allowSideEffects"] === true,
        });
        return { sessionId: session.id, status: session.status };
      }
      case "stop_pipeline":
        this.api.stop();
        return { ok: true };
      case "get_execution_status":
        return this.api.getExecutionStatus();
      case "set_timeline_frame":
        this.api.setTimelineFrame(Math.max(0, Math.round(requiredNumber(args, "frame"))));
        return { ok: true };
      case "export_project":
        return this.api.serialize();
      default:
        throw new Error(`Unknown MCP tool: ${name}`);
    }
  }
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isExecutionMode(value: unknown): value is "manual" | "reactive" | "continuous" | "timeline" {
  return ["manual", "reactive", "continuous", "timeline"].includes(String(value));
}

function isScope(value: unknown): value is "all" | "selected" | "downstream" | "from" {
  return ["all", "selected", "downstream", "from"].includes(String(value));
}
