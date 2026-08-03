# Node SDK

A Node Definition declares stable metadata, typed ports, parameters, bypass behavior, execution capabilities and optional render/stream/Container hooks.

```ts
import { validResult, type NodeDefinition } from "@open-node/sdk";

export const doubleNode: NodeDefinition = {
  typeId: "acme.math.double",
  version: "1.0.0",
  displayName: "Double",
  category: "Math",
  inputs: [{ id: "value", label: "Value", kind: "data", typeId: "core.float" }],
  outputs: [{ id: "result", label: "Result", kind: "data", typeId: "core.float" }],
  parameters: [],
  pure: true,
  containerCompatible: true,
  bypass: { strategy: "passthrough", inputPortId: "value", outputPortId: "result" },
  capabilities: { cpu: true, worker: true },
  resources: { parallelSafe: true, backendPolicy: "cpu-only" },
  createDefaultParams: () => ({}),
  validate: validResult,
  execute: async ({ inputs }) => ({
    outputs: { result: { typeId: "core.float", value: Number(inputs.value?.value) * 2 } },
  }),
  containerAdapter: async ({ value }) => ({
    typeId: "core.float",
    value: Number(value.value) * 2,
  }),
};
```

Register it with `editor.registerNode(doubleNode)` or pass it in `createOpenNode({ nodeDefinitions: [...] })`. The Library updates from the registry automatically.

Node parameters, UI state, runtime hints and migration output must be JSON-safe. Project export rejects values that JSON cannot preserve losslessly. Stable port and parameter IDs are part of the saved-file contract and must not be repurposed between versions.

## Custom types

Register a stable `TypeDefinition`, then use its ID in ports. Safe implicit conversions must be explicitly registered; all other conversions use converter Nodes. Scalar `T` and `stream<T>` are intentionally incompatible.

## Migration and permissions

Definitions may implement `migrate(oldVersion, state)`. If no safe migration exists, the instance becomes an Unresolved Node with its complete raw state. v0 plugins are trusted build-time packages; project JSON never embeds code. Permission names are declared by plugin manifests and enforced by host-provided services.

For the complete authoring contract, compatibility rules and required verification matrix, see [Extension Authoring and Verification](extension-authoring.md).
