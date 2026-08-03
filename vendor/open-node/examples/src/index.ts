import { AssetRegistry, type ImportableFile } from "@open-node/assets";
import { registerCoreNodes } from "@open-node/core-nodes";
import { createHeadlessOpenNode, createOpenNode, type OpenNodeInstance } from "@open-node/embed";
import type { BackendExecutionRequest, ExecutionBackend } from "@open-node/engine";
import { BoundedAsyncQueue } from "@open-node/scheduler";
import { invalidResult, validResult, type NodeDefinition, type NodeExecutionResult, NodeRegistry } from "@open-node/sdk";
import { createEmptyProject, createGroup, createId, type ComputationalConnection, type OpenNodeProject } from "@open-node/model";
import { createNodeFromDefinition } from "@open-node/sdk";

export const clampNode: NodeDefinition<{ min: number; max: number }> = {
  typeId: "example.math.clamp",
  version: "1.0.0",
  displayName: "Clamp",
  category: "Math",
  inputs: [{ id: "value", label: "Value", kind: "data", typeId: "core.float", required: true }],
  outputs: [{ id: "result", label: "Result", kind: "data", typeId: "core.float" }],
  parameters: [
    { id: "min", label: "Minimum", control: "number" },
    { id: "max", label: "Maximum", control: "number" },
  ],
  pure: true,
  containerCompatible: true,
  bypass: { strategy: "passthrough", inputPortId: "value", outputPortId: "result" },
  capabilities: { cpu: true, worker: true },
  resources: { parallelSafe: true },
  createDefaultParams: () => ({ min: 0, max: 1 }),
  validate: ({ min, max }) => min <= max ? validResult() : invalidResult("invalid-range", "Minimum must not exceed maximum"),
  execute: async ({ inputs, params }) => ({ outputs: { result: { typeId: "core.float", value: Math.min(params.max, Math.max(params.min, Number(inputs["value"]?.value))) } } }),
  containerAdapter: async ({ value, params }) => ({ typeId: "core.float", value: Math.min(params.max, Math.max(params.min, Number(value.value))) }),
};

export const timelineLabelNode: NodeDefinition = {
  typeId: "example.timeline.frame-label",
  version: "1.0.0",
  displayName: "Frame Label",
  category: "Timeline",
  inputs: [],
  outputs: [{ id: "label", label: "Label", kind: "data", typeId: "core.string" }],
  parameters: [],
  pure: true,
  capabilities: { cpu: true, timelineAware: true },
  createDefaultParams: () => ({}),
  validate: validResult,
  execute: async ({ timeline }) => ({ outputs: { label: { typeId: "core.string", value: `Frame ${timeline.frame} @ ${timeline.timeSeconds.toFixed(3)}s` } } }),
};

export class ExampleHostBackend implements ExecutionBackend {
  readonly id = "host" as const;
  readonly available = true;
  constructor(private readonly bridge: (request: { typeId: string; params: Record<string, unknown>; inputs: BackendExecutionRequest["context"]["inputs"] }, signal: AbortSignal) => Promise<NodeExecutionResult>) {}
  canExecute(definition: NodeDefinition): boolean { return definition.resources?.preferredBackend === "host"; }
  execute({ definition, context }: BackendExecutionRequest) { return this.bridge({ typeId: definition.typeId, params: context.params, inputs: context.inputs }, context.signal); }
}

export function createMathPipeline(): OpenNodeProject {
  const registry = new NodeRegistry();
  registerCoreNodes(registry);
  const project = createEmptyProject("Math Pipeline");
  const left = createNodeFromDefinition(registry.require("open-node.core.integer"), { x: 0, y: 0 });
  const right = createNodeFromDefinition(registry.require("open-node.core.float"), { x: 0, y: 180 });
  const add = createNodeFromDefinition(registry.require("open-node.core.add"), { x: 340, y: 80 });
  project.nodes.push(left, right, add);
  project.connections.push(connect(left.id, "value", add.id, "a"), connect(right.id, "value", add.id, "b"));
  return project;
}

export function createDecorativeArchitectureMap(): OpenNodeProject {
  const registry = new NodeRegistry(); registerCoreNodes(registry);
  const project = createEmptyProject("Architecture Map");
  const services = ["Gateway", "Worker", "Database"].map((label, index) => {
    const node = createNodeFromDefinition(registry.require("open-node.core.text"), { x: index * 310, y: index % 2 * 160 });
    node.label = label;
    return node;
  });
  const group = createGroup({ x: -60, y: -60, width: 920, height: 380 }, "Platform");
  group.memberNodeIds = services.map((node) => node.id);
  for (const node of services) node.parentGroupId = group.id;
  project.nodes.push(...services); project.groups.push(group);
  project.connections.push({ id: createId("connection"), kind: "decorative", source: { elementId: services[0]!.id, normalizedAnchor: { x: 1, y: 0.5 } }, target: { elementId: services[1]!.id, normalizedAnchor: { x: 0, y: 0.5 } }, thickness: 2, opacity: 0.8, arrowhead: "end", routing: "smooth-step", reroutePoints: [] });
  return project;
}

export async function runMachineCreatedGraph(): Promise<unknown> {
  const editor = createHeadlessOpenNode();
  const tx = editor.machineApi.beginTransaction("Example pipeline");
  const value = tx.createNode("open-node.core.integer", { x: 0, y: 0 }, { value: 42 });
  const display = tx.createNode("open-node.output.display", { x: 300, y: 0 });
  tx.connect(value, "value", display, "value");
  await tx.commit();
  const session = editor.run();
  await session.completion;
  const result = session.results.get(display)?.outputs["result"]?.value;
  await editor.destroy();
  return result;
}

export async function streamingCounter(values: AsyncIterable<number>): Promise<number[]> {
  const queue = new BoundedAsyncQueue<number>(16, "block");
  const output: number[] = [];
  const consumer = (async () => { for await (const value of queue) output.push(value + 1); })();
  for await (const value of values) await queue.enqueue(value);
  queue.close();
  await consumer;
  return output;
}

export async function runCoreStreamingCounter(): Promise<number[]> {
  const registry = new NodeRegistry(); registerCoreNodes(registry);
  const project = createEmptyProject("Streaming Counter");
  const counter = createNodeFromDefinition(registry.require("open-node.stream.counter"));
  counter.parameters = { start: 10, step: 2, intervalMs: 0, limit: 3 };
  project.nodes.push(counter);
  const editor = createHeadlessOpenNode({ project });
  const stream = editor.runtime.streamNode(project, counter.id);
  const values: number[] = [];
  for await (const item of stream) values.push(Number(item.outputs["count"]?.value));
  await editor.destroy();
  return values;
}

export async function importAsset(file: ImportableFile) {
  const registry = new AssetRegistry();
  return registry.import(file, { storage: "embedded" });
}

export function registerJsonLinesProbe(registry: AssetRegistry): void {
  registry.registerProbe({
    id: "example.json-lines",
    probe(file, head) {
      if (!file.name.toLowerCase().endsWith(".jsonl")) return null;
      const lines = new TextDecoder().decode(head).trim().split(/\r?\n/);
      try { lines.slice(0, 3).forEach((line) => JSON.parse(line)); }
      catch { return null; }
      return { mimeType: "application/x-ndjson", mediaType: "text", extension: "jsonl", confidence: "content" };
    },
  });
}

export function mountKernelTopologyMap(container: HTMLElement, project: OpenNodeProject, readonly = true): OpenNodeInstance {
  return createOpenNode({
    container,
    project,
    mode: readonly ? "embedded-readonly" : "embedded-edit",
    adapters: {
      services: {
        "kernel.navigate": (entityId: string) => window.dispatchEvent(new CustomEvent("kernel:navigate", { detail: { entityId } })),
      },
    },
  });
}

function connect(sourceElementId: string, sourcePortId: string, targetElementId: string, targetPortId: string): ComputationalConnection {
  return { id: createId("connection"), kind: "data", source: { elementId: sourceElementId, portId: sourcePortId }, target: { elementId: targetElementId, portId: targetPortId }, thickness: 2, opacity: 1, arrowhead: "end", routing: "bezier", reroutePoints: [] };
}
