# Extension Authoring and Verification

This document defines the acceptance rules for new Nodes, custom value types, plugins and new third-party Canvas/model elements. The public contracts live in `@open-node/sdk`, `@open-node/type-system` and `@open-node/model`.

## 1. Node identity and compatibility

- Use a globally stable `publisher.package.node` `typeId`.
- Use Semantic Versioning for `version`.
- Treat port IDs, parameter IDs, types, units and meaning as persisted API. Never reuse an existing ID for different semantics.
- Add a `migrate(oldVersion, state)` function for compatible saved-state upgrades. If migration cannot be safe, allow the instance to remain Unresolved with its original raw state.
- Keep `createDefaultParams()` deterministic and return a fresh object.

`NodeRegistry.register()` rejects malformed IDs/versions, duplicate port or parameter IDs, contradictory pure/side-effect declarations, missing execution implementations and Container-compatible Nodes without a `containerAdapter`.

## 2. Ports, parameters and saved state

- Give every port a stable ID, label, direction, kind (`data` or `control`) and registered `typeId`.
- Mark cardinality explicitly with `multiple`; required inputs with `required`; runtime-changing ports with `dynamic`.
- Prefer explicit converter Nodes over surprising implicit conversions.
- Validate every parameter combination in `validate()`, with actionable issue paths.
- Store only JSON-safe state in parameters, `uiState`, runtime hints, asset metadata and migration output: strings, booleans, finite numbers, `null`, arrays and plain objects.
- Do not store `File`, `Blob`, DOM nodes, class instances, functions, symbols, bigints, `NaN`, infinities or circular references. Put binary/media data in the Asset Registry and save an asset ID.

Project export validates this rule and fails loudly rather than producing a lossy file.

## 3. Execution contract

- Implement at least one of `execute`, `executeStream` or `containerAdapter`.
- Observe `AbortSignal` and release resources when cancelled.
- Return `ValueEnvelope` objects whose `typeId` matches the declared output.
- Report bounded progress from `0` to `1`.
- A `pure` Node must be deterministic for its inputs, parameters and declared Timeline context. Do not read undeclared external state.
- Declare side effects and required plugin permissions. Network, filesystem, camera, microphone, clipboard, GPU, Worker and host access must come through host-provided services.
- Declare backend/resource hints honestly and provide fallback behavior unless `gpu-required` is intentional.
- Define bypass behavior. Use passthrough only when input/output semantics are genuinely compatible.
- Set `containerCompatible: true` only when a serial `containerAdapter` preserves the Node's intended behavior.

## 4. Preview and Studio behavior

- Preview generation must be cancellable, bounded and safe for the selected quality level.
- Supply clear display metadata, category, tags, color and icon so Library search and preview cards remain useful.
- Keep inline controls equivalent to Inspector values; both must update the same persisted parameter.
- Check labels at minimum Node size so ports and content do not overlap.
- Dynamic ports must update the saved Node instance deterministically and preserve connection validation.
- New visual controls need keyboard operation, focus treatment, readable labels and reduced-motion behavior.

## 5. Plugin and third-party package rules

An `OpenNodePlugin` must have a stable manifest ID/version and declare all permissions. Register custom types before Nodes that reference them. Setup must be repeatable for one plugin instance, and `dispose()` must release listeners, Workers, GPU resources and host handles.

Project files contain package/version dependencies and Node state, never executable plugin code. Loading without a required package must preserve the Node as Unresolved; it must not discard state or execute fallback code silently.

## 6. Adding a new Canvas or model element kind

Plugins may register Nodes and value types through public registries. Adding a brand-new canonical entity kind is a framework change and must update every persistence and editing layer:

1. model types, IDs, cloning and defaults;
2. `validateProject()` ownership, bounds and reference checks;
3. `@open-node/io` runtime schema, migration and JSON/ZIP round-trip fixtures;
4. commands for create/move/resize/copy/cut/paste/delete and Undo/Redo;
5. Canvas rendering, hit testing, selection, Inspector, context menu, minimap and visibility;
6. connection endpoint rules if the entity can connect;
7. Embed/Machine/MCP inspection and mutation contracts;
8. user guide, project-format schema and migration documentation.

Never hide an extension-only field on a React object or module global if it must survive reload. Put durable state in the canonical project model.

## 7. Required verification

Every new Node or extension should add tests appropriate to its capabilities:

| Area | Minimum check |
|---|---|
| Registry | valid definition registers; invalid IDs, duplicate IDs and invalid capability combinations reject |
| Defaults | `createDefaultParams()` passes `validate()` and returns independent state |
| Types | valid connections pass; wrong direction/kind/type/cardinality reject |
| Execution | outputs and envelope types are correct; errors and cancellation are deterministic |
| Bypass | declared strategy produces the documented result |
| Container | adapter parity and ordered serial execution, when supported |
| Streaming/Timeline | backpressure, cancellation, frame/time behavior, when supported |
| Migration | old fixture migrates without source mutation; unsafe migration preserves unresolved raw state |
| Persistence | configured instance and plugin-owned JSON state are identical after JSON and ZIP round-trip |
| UI | Library discovery, card preview, inline/Inspector editing, resize/layout and accessibility |
| Security | permission denial, untrusted inputs, asset limits and cleanup |

Run the repository gates before merging:

```bash
npm run typecheck
npm test -- --run
npm run build
npm run test:e2e
```

`npm run test:e2e` requires an installed Chromium. A change is not complete if only the happy-path execution test passes; persistence, cancellation, invalid input and missing-plugin behavior must also be covered.
