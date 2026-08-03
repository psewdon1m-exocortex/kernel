# Technical specification coverage

This matrix maps the v0 acceptance criteria in `OPEN_NODE_TECHNICAL_SPEC(1).md` to the implementation. “Foundation” means the public contract and a working reference path exist, while production host/device coverage still depends on an adapter or external decoder.

| Criteria | Status | Implementation |
|---|---|---|
| 1–3 delivery and separation | Implemented | `embed`, `standalone-web`, `model`, headless tests |
| 4–12 Canvas, viewport, minimap, backgrounds, themes | Implemented | `ui`; color/gradient/image models, pan/zoom/origin, hierarchical grid, optional entity snapping and minimap navigation |
| 13–19 Node Library, SDK, DnD, color, preview/import | Implemented | `sdk`, `ui`, `assets`, `core-nodes`; pointer-positioned Library with Recently/Nodes/Containers |
| 20–26 Container model, order, ports, preset, collapse/bypass | Implemented | canonical model, serial engine, Inspector reorder/preset controls |
| 27–29 Group creation, move, color, collapse and bypass | Implemented | Alt-drag, explicit membership, snapshot restore, size Inspector |
| 30–34 connections, routing and typing | Implemented | three connection kinds, four route renderers, Type Registry and cycle/cardinality checks |
| 35–37 core Nodes and Universal Import detection | Implemented | Values/Math/Conversion/Import/Media/Output Nodes; signature-first probes |
| 38–43 Run, progress, cancel, status and parallel branches | Implemented | `ExecutionSession`, `DagScheduler`, UI controls and tests |
| 44–46 Worker/GPU capability and abstraction | Foundation | real Worker protocol/dispatcher and stable GPU interface; host supplies Worker bundle/GPU adapter |
| 47 Reactive Mode | Foundation | downstream invalidation/cache plus debounced embed re-execution; side effects remain permission-gated |
| 48 Continuous/Streaming | Implemented v0 | bounded queues, `ContinuousRuntime`, `NodeStreamSession`, Counter and Log stream Nodes |
| 49–51 Timeline and synchronized media preview | Implemented v0 | playback/scrub/frame runtime and shared-time video preview seeking; host decoder quality varies |
| 52–55 project JSON/ZIP, assets, unresolved state | Implemented | full schema plus graph validation, JSON-safety checks, safe ZIP package, migrations and complete JSON/ZIP state-equivalence tests |
| 56–58 hotkeys and config | Implemented API | validated import/export/reset/merge model and conflict detection; the reference UI exposes the fixed v0 defaults |
| 59–60 resource dashboard | Implemented | Browser adapter uses real available metrics and renders unavailable values as `N/A` |
| 61–65 Embed, Machine API and MCP | Implemented | in-process Embed/Machine APIs, transactions, permissions, tools and JSON-RPC prototype |
| 66 Undo/Redo | Implemented | command history and aggregated mutations |
| 67 tests | Implemented | Vitest unit/integration and Playwright E2E scenarios |
| 68 documentation | Implemented | built-in Documentation dialog, Studio User Guide, project persistence contract, extension authoring/verification guide, ADR, schema and type-checked examples |
| 69 Kernel integration example | Implemented | `mountKernelTopologyMap` in `examples/src/index.ts` |
| 70 no Exocortex logic in Core | Implemented | all Core packages are domain-neutral |

## Environment-dependent checks

- Exact CPU/GPU/Disk values require a host telemetry adapter; browsers may return `N/A`.
- MOV/MKV/FLAC/TIFF/PDF/3D preview quality depends on installed host/plugin decoders.
- GPU execution needs a registered `GpuBackend`; no vendor API is built into a Node.
- Playwright E2E execution needs a Chromium binary. The test source is checked by TypeScript even when the browser is absent.
- Benchmark targets are hardware-dependent; `tests/bench/runtime.bench.ts` supplies repeatable model/scheduler fixtures.
