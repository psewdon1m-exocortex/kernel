# Project Format

The canonical text format is `*.onode.json`; packaged projects use a ZIP-based `*.onode` container.

```json
{
  "format": "open-node-project",
  "schemaVersion": "1.0.0",
  "createdWith": "0.1.0",
  "metadata": {},
  "dependencies": [],
  "settings": {},
  "execution": {},
  "timeline": {},
  "viewport": {},
  "background": {},
  "nodes": [],
  "containers": [],
  "groups": [],
  "connections": [],
  "annotations": [],
  "presets": [],
  "assets": []
}
```

## Serialization contract

`serializeProject()` validates both the graph model and the complete runtime schema before it writes JSON. Arbitrary Node parameters, `uiState`, `runtimeHints`, asset metadata and unresolved raw state must contain JSON-safe values: strings, booleans, finite numbers, `null`, arrays and plain objects. Export rejects functions, symbols, bigints, non-finite numbers, circular references, class instances and undefined array items instead of silently changing them.

The same canonical `project.json` is used by JSON download, autosave, Embed/Machine API export and the ZIP package.

| Area | Persisted data |
|---|---|
| Node | type and version, label/color/bypass, parameters, instantiated ports, transform, Container/Group parents, `uiState`, runtime hints, tags and unresolved raw state |
| Connection | kind, endpoints, label/color, thickness, opacity, dash, arrowheads, routing override and reroute points |
| Structure | ordered Containers, Groups and membership, annotations and saved presets |
| Studio | viewport, background, hierarchical grid/snapping, theme, preview quality, layer/panel visibility, recent Library items and Library position/size |
| Runtime | execution policy, Timeline settings/current time, dependencies and asset references |

Studio controls that have a durable user choice are in `OpenNodeProject`. Minimap, Resources and Timeline visibility round-trip; the movable Library restores its saved position and size. The Inspector and fixed overlays do not currently have a user-defined position.

Interaction-only state such as selection, clipboard contents, an open context menu, Inspector visibility, active pointer gestures and the collection of open project tabs is deliberately not serialized. Each project tab exports its own project.

## Loading and packages

Load validation covers syntax, format/schema version, structural schema, IDs, parents, connections, cycles, Timeline and execution limits. Loading is transactional. Migrations operate on a clone and never overwrite the original source.

An `.onode` package contains `project.json`, optional `dependencies.lock.json`, and `assets/`. Unpack rejects absolute paths, drive paths and `..`, and enforces entry and uncompressed-size limits.

Assets explicitly declare `embedded`, `external`, `remote`, or `host-managed` storage. Missing assets and unknown Node definitions preserve their original references/state.

The runtime Zod schema in `@open-node/io` is authoritative. Its documentation mirror is [open-node-project.schema.json](schema/open-node-project.schema.json). Extension authors should also read [Extension Authoring and Verification](extension-authoring.md).
