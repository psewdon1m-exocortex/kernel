# Architecture

Open Node has four independently replaceable layers.

```text
Model Layer        Project data, validation, commands, types, persistence
Runtime Layer      DAG scheduler, execution, caching, streaming, Timeline
Presentation Layer React Canvas, Library, Inspector, Minimap, dashboard
Integration Layer  Embed API, Machine API, MCP, host/asset/telemetry adapters
```

The `OpenNodeProject` object is the single source of truth. It never stores renderer-internal structures and does not import React. Rendering is a projection of world-space elements and endpoint IDs. The canvas can therefore be replaced without migrating project files.

Execution ignores Groups and decorative connections. Top-level Nodes and Containers form a computational DAG. Nodes inside a Container are excluded from the external DAG and run serially through a `ValueEnvelope`.

## Presentation state and persistence

Durable studio choices live in `OpenNodeProject`: viewport, background, hierarchical grid and snapping, layer/panel visibility, Library position/size and recent Library items. Node parameters, instantiated ports, UI state and connection presentation overrides are model data as well. They therefore survive JSON/ZIP export, reload and autosave through the same validated serialization path.

Transient interaction state stays in the React presentation layer: selection, clipboard, pointer interaction, open context menus, Inspector visibility and the current set of project tabs. Multi-selection operations are translated into one command; copy/paste includes only connections whose two endpoints are part of the copied subgraph.

## Dependency direction

```text
model ← type-system ← sdk ← core-nodes
  ↑          ↑          ↑
commands   machine-api  engine ← scheduler
  ↑          ↑          ↑
  io       mcp-adapter  embed → ui
```

Host-specific business logic belongs in plugins and adapters, not Core. See [ADR 0001](adr/0001-framework-boundaries.md).

## Transactions

Commands create and validate a cloned draft, then replace the live project atomically. A failed Machine API transaction never exposes partial state. Undo/Redo restores complete before/after snapshots, while drag interaction is aggregated into one command.

## IDs and versions

- Type: `namespace.type`;
- Node: `publisher.package.node`;
- Node and packages: Semantic Versioning;
- entity instances: opaque UUID-prefixed IDs.
