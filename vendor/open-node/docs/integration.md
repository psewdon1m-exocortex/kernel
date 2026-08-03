# Embedding, Machine API and MCP

## Delivery modes

- `standalone`: full file-oriented reference shell;
- `embedded-edit`: full editor inside a host element;
- `embedded-readonly`: navigation and inspection without mutation;
- `headless`: model and execution without React/DOM.

`createOpenNode()` returns load, serialization, execution, registries, Timeline and viewport APIs. Subscribe with `editor.on(eventName, listener)` and always call `destroy()` to release Workers, GPU resources, timers and plugins.

## Machine API

Remote transports are disabled by default; the in-process host grants explicit scopes (`read`, `write`, `execute`, `timeline`, `files`) and can restrict Node type IDs and transaction size.

```ts
const tx = editor.machineApi.beginTransaction();
const source = tx.createNode("open-node.core.integer", { x: 0, y: 0 }, { value: 2 });
const add = tx.createNode("open-node.core.add", { x: 300, y: 0 });
tx.connect(source, "value", add, "a");
await tx.commit();
```

Any failure rolls back every operation. Audit hooks receive operation, scope, timestamp, details and success/error.

## MCP adapter

`OpenNodeMcpAdapter` exposes `open_project`, `inspect_graph`, `search_nodes`, `create_node`, `connect_nodes`, `set_parameter`, `run_pipeline`, `stop_pipeline`, `get_execution_status`, `set_timeline_frame`, and `export_project`. It also provides a small JSON-RPC `tools/list` / `tools/call` handler. MCP is strictly a façade over Machine API.
