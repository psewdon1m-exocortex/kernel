import type { AssetReference, ValidationResult, ValueEnvelope } from "@open-node/model";
import {
  invalidResult,
  type ExecuteContext,
  type NodeDefinition,
  type NodeExecutionResult,
  type PreviewResult,
  validResult,
} from "@open-node/sdk";

type Params = Record<string, unknown>;

const envelope = <T>(typeId: string, value: T, metadata?: Record<string, unknown>): ValueEnvelope<T> => ({ typeId, value, ...(metadata ? { metadata } : {}) });
const output = <T>(typeId: string, value: T, port = "value", metadata?: Record<string, unknown>): NodeExecutionResult => ({ outputs: { [port]: envelope(typeId, value, metadata) } });
const valueInput = (id = "value", typeId = "core.any") => ({ id, label: title(id), kind: "data" as const, typeId, required: true });
const valueOutput = (id = "value", typeId = "core.any") => ({ id, label: title(id), kind: "data" as const, typeId });

function constantNode(typeId: string, displayName: string, valueType: string, defaultValue: unknown, control: "text" | "number" | "toggle" | "color" | "table" = "text"): NodeDefinition {
  return {
    typeId,
    version: "1.0.0",
    displayName,
    description: `Creates a ${displayName.toLocaleLowerCase()} value.`,
    category: "Values",
    tags: ["constant", "value", valueType],
    defaultColor: "#5b75d6",
    inputs: [],
    outputs: [valueOutput("value", valueType)],
    parameters: [{ id: "value", label: "Value", control }],
    pure: true,
    containerCompatible: true,
    bypass: { strategy: "constant", outputPortId: "value", value: envelope(valueType, defaultValue) },
    capabilities: { cpu: true },
    createDefaultParams: () => ({ value: structuredClone(defaultValue) }),
    validate: (params) => validateValue(valueType, params["value"]),
    execute: async ({ params }) => output(valueType, params["value"]),
    containerAdapter: async ({ params }) => envelope(valueType, params["value"]),
  };
}

const colorNode: NodeDefinition = {
  typeId: "open-node.core.color",
  version: "1.0.0",
  displayName: "Color",
  description: "Creates a color value in a selectable color space.",
  category: "Values",
  tags: ["constant", "value", "color", "srgb", "display-p3", "oklch"],
  defaultColor: "#4b84ff",
  icon: "◉",
  inputs: [],
  outputs: [valueOutput("value", "core.color")],
  parameters: [
    { id: "value", label: "Color", control: "color" },
    {
      id: "colorSpace",
      label: "Color space",
      control: "select",
      options: [
        { label: "sRGB", value: "srgb" },
        { label: "Display P3", value: "display-p3" },
        { label: "Linear RGB", value: "linear-rgb" },
        { label: "HSL", value: "hsl" },
        { label: "OKLCH", value: "oklch" },
      ],
    },
  ],
  pure: true,
  containerCompatible: true,
  bypass: { strategy: "constant", outputPortId: "value", value: envelope("core.color", "#4b84ff", { colorSpace: "srgb" }) },
  capabilities: { cpu: true },
  createDefaultParams: () => ({ value: "#4b84ff", colorSpace: "srgb" }),
  validate: (params) => {
    const spaces = new Set(["srgb", "display-p3", "linear-rgb", "hsl", "oklch"]);
    if (typeof params["value"] !== "string") return invalidResult("invalid-color", "Color must be a string", "parameters.value");
    return spaces.has(String(params["colorSpace"] ?? "srgb")) ? validResult() : invalidResult("invalid-color-space", "Unsupported color space", "parameters.colorSpace");
  },
  execute: async ({ params }) => output("core.color", params["value"], "value", { colorSpace: String(params["colorSpace"] ?? "srgb") }),
  containerAdapter: async ({ params }) => envelope("core.color", params["value"], { colorSpace: String(params["colorSpace"] ?? "srgb") }),
};

function mathNode(operation: "add" | "subtract" | "multiply" | "divide", symbol: string, run: (a: number, b: number) => number): NodeDefinition {
  return {
    typeId: `open-node.core.${operation}`,
    version: "1.0.0",
    displayName: title(operation),
    description: `${title(operation)} two numeric values (${symbol}).`,
    category: "Math",
    tags: ["math", operation, symbol],
    defaultColor: "#9a5bd6",
    icon: symbol,
    inputs: [{ ...valueInput("a", "core.float"), defaultValue: 0 }, { ...valueInput("b", "core.float"), defaultValue: operation === "multiply" || operation === "divide" ? 1 : 0 }],
    outputs: [valueOutput("result", "core.float")],
    parameters: [],
    pure: true,
    containerCompatible: true,
    bypass: { strategy: "passthrough", inputPortId: "a", outputPortId: "result" },
    capabilities: { cpu: true, worker: true },
    resources: { parallelSafe: true, preferredBackend: "main" },
    createDefaultParams: () => ({}),
    validate: validResult,
    execute: async ({ inputs }) => {
      const a = Number(inputs["a"]?.value ?? 0);
      const b = Number(inputs["b"]?.value ?? 0);
      if (operation === "divide" && b === 0) throw new Error("Division by zero");
      return output("core.float", run(a, b), "result");
    },
    containerAdapter: async ({ value }) => {
      const current = Number(value.value);
      if (!Number.isFinite(current)) throw new Error(`${title(operation)} Container adapter requires a numeric envelope`);
      return envelope("core.float", run(current, operation === "multiply" || operation === "divide" ? 1 : 0));
    },
  };
}

const valueNodes: NodeDefinition[] = [
  constantNode("open-node.core.text", "Text", "core.string", "", "text"),
  constantNode("open-node.core.integer", "Integer", "core.integer", 0, "number"),
  constantNode("open-node.core.float", "Float", "core.float", 0, "number"),
  constantNode("open-node.core.boolean", "Boolean", "core.boolean", false, "toggle"),
  colorNode,
  constantNode("open-node.core.table", "Table", "core.table", [], "table"),
  constantNode("open-node.core.json", "JSON", "core.json", {}, "table"),
  constantNode("open-node.core.file-reference", "File Reference", "core.file", { assetId: "" }, "text"),
];

const mathNodes: NodeDefinition[] = [
  mathNode("add", "+", (a, b) => a + b),
  mathNode("subtract", "−", (a, b) => a - b),
  mathNode("multiply", "×", (a, b) => a * b),
  mathNode("divide", "/", (a, b) => a / b),
];

const conversionNodes: NodeDefinition[] = [
  conversion("integer-to-float", "Integer to Float", "core.integer", "core.float", (value) => Number(value)),
  conversion("to-string", "To String", "core.any", "core.string", (value) => typeof value === "string" ? value : JSON.stringify(value) ?? String(value)),
  conversion("parse-number", "Parse Number", "core.string", "core.float", (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`Cannot parse a finite number from ${String(value)}`);
    return parsed;
  }),
  conversion("table-to-json", "Table to JSON", "core.table", "core.json", (value) => structuredClone(value)),
  conversion("json-to-table", "JSON to Table", "core.json", "core.table", (value) => {
    if (!Array.isArray(value) || value.some((row) => typeof row !== "object" || row === null || Array.isArray(row))) throw new Error("JSON must be an array of objects to convert to a Table");
    return structuredClone(value);
  }),
];

function conversion(id: string, displayName: string, from: string, to: string, convert: (value: unknown) => unknown): NodeDefinition {
  return {
    typeId: `open-node.core.${id}`,
    version: "1.0.0",
    displayName,
    description: `Explicit conversion from ${from} to ${to}.`,
    category: "Conversion",
    tags: ["convert", from, to],
    defaultColor: "#3f9b8d",
    inputs: [valueInput("value", from)],
    outputs: [valueOutput("result", to)],
    parameters: [],
    pure: true,
    containerCompatible: true,
    bypass: { strategy: "passthrough", inputPortId: "value", outputPortId: "result" },
    capabilities: { cpu: true, worker: true },
    resources: { parallelSafe: true },
    createDefaultParams: () => ({}),
    validate: validResult,
    execute: async ({ inputs }) => output(to, convert(inputs["value"]?.value), "result"),
    containerAdapter: async ({ value }) => envelope(to, convert(value.value)),
  };
}

const universalImport: NodeDefinition = {
  typeId: "open-node.import.universal",
  version: "1.0.0",
  displayName: "Universal Import",
  description: "Resolves an Asset Registry entry and exposes one output whose type follows the selected file.",
  category: "Import / Media",
  tags: ["file", "asset", "image", "video", "audio", "import"],
  defaultColor: "#d27c3e",
  inputs: [],
  outputs: [{ ...valueOutput("result", "core.file"), dynamic: true }],
  parameters: [{ id: "assetId", label: "Asset", control: "file", required: true }],
  pure: true,
  containerCompatible: true,
  bypass: { strategy: "block" },
  capabilities: { cpu: true, preview: true, timelineAware: true },
  createDefaultParams: () => ({ assetId: "" }),
  validate: (params) => typeof params["assetId"] === "string" && params["assetId"] ? validResult() : invalidResult("asset-required", "Select an asset", "parameters.assetId"),
  execute: async ({ params, services }) => {
    const result = resolveImportedAsset(params, services);
    const asset = result.metadata?.["asset"] as AssetReference | undefined ?? result.value as AssetReference;
    return { outputs: { result }, metadata: { assetId: asset.id, missing: asset.missing ?? false, outputTypeId: result.typeId } };
  },
  containerAdapter: async ({ params, services }) => resolveImportedAsset(params, services),
  renderPreview: async ({ outputs }) => previewAsset(outputs),
};

const timelineNodes: NodeDefinition[] = [
  {
    typeId: "open-node.timeline.current-time",
    version: "1.0.0",
    displayName: "Current Timeline Time",
    category: "Import / Media",
    defaultColor: "#c45d91",
    inputs: [], outputs: [valueOutput("seconds", "core.float")], parameters: [], pure: true, containerCompatible: true,
    capabilities: { cpu: true, timelineAware: true },
    createDefaultParams: () => ({}), validate: validResult,
    execute: async ({ timeline }) => output("core.float", timeline.timeSeconds, "seconds"),
    containerAdapter: async ({ timeline }) => envelope("core.float", timeline.timeSeconds),
  },
  {
    typeId: "open-node.timeline.current-frame",
    version: "1.0.0",
    displayName: "Current Timeline Frame",
    category: "Import / Media",
    defaultColor: "#c45d91",
    inputs: [], outputs: [valueOutput("frame", "core.integer")], parameters: [], pure: true, containerCompatible: true,
    capabilities: { cpu: true, timelineAware: true },
    createDefaultParams: () => ({}), validate: validResult,
    execute: async ({ timeline }) => output("core.integer", timeline.frame, "frame"),
    containerAdapter: async ({ timeline }) => envelope("core.integer", timeline.frame),
  },
];

const previewNodes: NodeDefinition[] = ["image", "video", "audio"].map((media): NodeDefinition => ({
  typeId: `open-node.media.${media}-preview`,
  version: "1.0.0",
  displayName: `${title(media)} Preview`,
  description: `Displays a synchronized ${media} preview.`,
  category: "Import / Media",
  defaultColor: "#d27c3e",
  inputs: [valueInput("media", `media.${media}`)], outputs: [valueOutput("result", `media.${media}`)], parameters: [], pure: true,
  containerCompatible: true,
  bypass: { strategy: "passthrough", inputPortId: "media", outputPortId: "result" },
  capabilities: { cpu: true, preview: true, timelineAware: media === "video" },
  createDefaultParams: () => ({}), validate: validResult,
  execute: async ({ inputs }) => ({ outputs: { result: inputs["media"] ?? envelope(`media.${media}`, null) } }),
  containerAdapter: async ({ value }) => value,
  renderPreview: async ({ outputs }) => previewAsset(outputs),
}));

const outputNodes: NodeDefinition[] = [
  {
    typeId: "open-node.output.display", version: "1.0.0", displayName: "Display", description: "Displays any input value.", category: "Output", defaultColor: "#4e9d62",
    inputs: [valueInput()], outputs: [valueOutput("result")], parameters: [], pure: true,
    containerCompatible: true, bypass: { strategy: "passthrough", inputPortId: "value", outputPortId: "result" }, capabilities: { cpu: true, preview: true },
    createDefaultParams: () => ({}), validate: validResult,
    execute: async ({ inputs }) => ({ outputs: { result: inputs["value"] ?? envelope("core.any", null) } }),
    containerAdapter: async ({ value }) => value,
    renderPreview: async ({ outputs }) => ({ kind: "text", text: stringify(outputs["result"]?.value) }),
  },
  {
    typeId: "open-node.output.log", version: "1.0.0", displayName: "Log", description: "Writes a value through the host logger.", category: "Output", defaultColor: "#4e9d62",
    inputs: [valueInput()], outputs: [valueOutput("result")], parameters: [{ id: "level", label: "Level", control: "select", options: ["debug", "info", "warn", "error"].map((value) => ({ label: title(value), value })) }],
    pure: false, sideEffect: true, containerCompatible: true, bypass: { strategy: "passthrough", inputPortId: "value", outputPortId: "result" }, capabilities: { cpu: true },
    createDefaultParams: () => ({ level: "info" }), validate: validResult,
    execute: async ({ inputs, params, services }) => {
      const logger = services["logger"] as Partial<Record<string, (value: unknown) => void>> | undefined;
      const value = inputs["value"] ?? envelope("core.any", null);
      logger?.[String(params["level"])]?.(value.value);
      return { outputs: { result: value } };
    },
    containerAdapter: async ({ value, params, services }) => {
      const logger = services["logger"] as Partial<Record<string, (value: unknown) => void>> | undefined;
      logger?.[String(params["level"])]?.(value.value);
      return value;
    },
  },
  {
    typeId: "open-node.output.export-file", version: "1.0.0", displayName: "Export File", description: "Exports data through an authorized host adapter.", category: "Output", defaultColor: "#4e9d62",
    inputs: [valueInput()], outputs: [{ id: "done", label: "Done", kind: "control", typeId: "core.exec" }],
    parameters: [{ id: "filename", label: "Filename", control: "text", required: true }], pure: false, sideEffect: true, containerCompatible: true, bypass: { strategy: "block" }, capabilities: { cpu: true },
    createDefaultParams: () => ({ filename: "output.json" }), validate: (params) => typeof params["filename"] === "string" && params["filename"] ? validResult() : invalidResult("filename-required", "Filename is required"),
    execute: async ({ inputs, params, services, signal }) => {
      const exporter = services["exportFile"] as ((filename: string, value: unknown, signal: AbortSignal) => Promise<void>) | undefined;
      if (!exporter) throw new Error("File export requires a host adapter and explicit permission");
      await exporter(String(params["filename"]), inputs["value"]?.value, signal);
      return { outputs: { done: envelope("core.exec", true) } };
    },
    containerAdapter: async ({ value, params, services, signal }) => {
      const exporter = services["exportFile"] as ((filename: string, value: unknown, signal: AbortSignal) => Promise<void>) | undefined;
      if (!exporter) throw new Error("File export requires a host adapter and explicit permission");
      await exporter(String(params["filename"]), value.value, signal);
      return value;
    },
  },
];

const streamingNodes: NodeDefinition[] = [
  {
    typeId: "open-node.stream.counter",
    version: "1.0.0",
    displayName: "Streaming Counter",
    description: "Emits an incrementing integer stream until cancelled or the optional limit is reached.",
    category: "Streaming",
    tags: ["stream", "counter", "source"],
    defaultColor: "#3c9e9b",
    inputs: [],
    outputs: [valueOutput("count", "stream<core.integer>")],
    parameters: [
      { id: "start", label: "Start", control: "number" },
      { id: "step", label: "Step", control: "number" },
      { id: "intervalMs", label: "Interval (ms)", control: "number", min: 0 },
      { id: "limit", label: "Item limit (0 = infinite)", control: "number", min: 0 },
    ],
    pure: false,
    bypass: { strategy: "block" },
    capabilities: { cpu: true, streaming: true },
    createDefaultParams: () => ({ start: 0, step: 1, intervalMs: 100, limit: 0 }),
    validate: (params) => Number(params["intervalMs"]) >= 0 && Number(params["limit"]) >= 0 ? validResult() : invalidResult("invalid-stream-settings", "Interval and limit must not be negative"),
    execute: async ({ params }) => output("core.integer", Number(params["start"]), "count"),
    executeStream: async function* ({ params, signal }) {
      const start = Number(params["start"]); const step = Number(params["step"]); const limit = Math.floor(Number(params["limit"])); const interval = Number(params["intervalMs"]);
      for (let index = 0; limit === 0 || index < limit; index += 1) {
        if (signal.aborted) return;
        if (index > 0 && interval > 0) await abortableDelay(interval, signal);
        yield { outputs: { count: envelope("core.integer", start + index * step) }, progress: limit > 0 ? (index + 1) / limit : undefined };
      }
    },
  },
  {
    typeId: "open-node.stream.log",
    version: "1.0.0",
    displayName: "Streaming Log",
    description: "Logs and forwards values from an input stream.",
    category: "Streaming",
    tags: ["stream", "log", "sink"],
    defaultColor: "#3c9e9b",
    inputs: [valueInput("value", "stream<core.any>")],
    outputs: [valueOutput("result", "stream<core.any>")],
    parameters: [],
    pure: false,
    sideEffect: true,
    bypass: { strategy: "passthrough", inputPortId: "value", outputPortId: "result" },
    capabilities: { cpu: true, streaming: true },
    createDefaultParams: () => ({}),
    validate: validResult,
    executeStream: async function* ({ streams, services, signal }) {
      const logger = services["logger"] as { info?(value: unknown): void } | undefined;
      const stream = streams["value"];
      if (!stream) throw new Error("Streaming Log requires an input stream");
      for await (const value of stream) {
        if (signal.aborted) return;
        logger?.info?.(value.value);
        yield { outputs: { result: value } };
      }
    },
  },
];

export const coreNodeDefinitions: NodeDefinition[] = [
  ...valueNodes,
  ...mathNodes,
  ...conversionNodes,
  universalImport,
  ...previewNodes,
  ...timelineNodes,
  ...outputNodes,
  ...streamingNodes,
];

export function registerCoreNodes(registry: { register(definition: NodeDefinition): unknown }): void {
  for (const definition of coreNodeDefinitions) registry.register(definition);
}

function validateValue(typeId: string, value: unknown): ValidationResult {
  const valid = typeId === "core.string" || typeId === "core.color" ? typeof value === "string"
    : typeId === "core.integer" ? Number.isInteger(value)
      : typeId === "core.float" ? typeof value === "number" && Number.isFinite(value)
        : typeId === "core.boolean" ? typeof value === "boolean"
          : typeId === "core.table" ? Array.isArray(value)
            : typeId === "core.file" ? typeof value === "object" && value !== null
              : true;
  return valid ? validResult() : invalidResult("invalid-value", `Value does not match ${typeId}`, "parameters.value");
}

function previewAsset(outputs: Readonly<Record<string, ValueEnvelope | undefined>>): PreviewResult {
  const media = outputs["result"] ?? outputs["media"] ?? outputs["image"] ?? outputs["video"] ?? outputs["audio"] ?? outputs["file"];
  const asset = media?.value as Partial<AssetReference> | undefined;
  if (asset?.uri && (asset.mediaType === "image" || asset.mediaType === "video" || asset.mediaType === "audio")) return { kind: asset.mediaType, url: asset.uri, alt: asset.name };
  if (asset?.name) return { kind: "text", text: `${asset.name}\n${asset.mimeType ?? "Unknown type"}${asset.missing ? "\nMissing Asset" : ""}` };
  return { kind: "text", text: "No preview" };
}

function resolveImportedAsset(params: Params, services: Readonly<Record<string, unknown>>): ValueEnvelope {
  const assets = services["assets"] as { get(id: string): AssetReference | undefined } | undefined;
  if (!assets) throw new Error("Asset Registry service is unavailable");
  const asset = assets.get(String(params["assetId"]));
  if (!asset) throw new Error(`Asset not found: ${String(params["assetId"])}`);
  if (asset.mediaType === "image" || asset.mediaType === "video" || asset.mediaType === "audio") return envelope(`media.${asset.mediaType}`, asset, { asset });
  if (asset.mediaType === "table") return envelope("core.table", asset.metadata["rows"] ?? [], { asset });
  if (asset.mediaType === "text" && asset.mimeType === "application/json" && asset.metadata["json"] !== undefined) return envelope("core.json", asset.metadata["json"], { asset });
  if (asset.mediaType === "text") return envelope("core.string", asset.metadata["text"] ?? "", { asset });
  if (asset.mediaType === "binary") return envelope("core.binary", { assetId: asset.id, size: asset.size }, { asset });
  return envelope("core.file", asset, { asset });
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function title(value: string): string {
  return value.replace(/(^|[-_])([a-z])/g, (_match, prefix: string, letter: string) => `${prefix ? " " : ""}${letter.toUpperCase()}`);
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}
