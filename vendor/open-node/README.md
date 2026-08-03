# Open Node

Open Node is a TypeScript framework for embeddable node interfaces, visual maps, and executable graphs. Its project model is independent from React and from any canvas renderer; the standalone application is a reference shell over the same public APIs used by host products.

## Current v0 implementation

- canonical `.onode.json` model with Node, Container, Group, connections, assets, Timeline, settings, dependencies and presets;
- transaction-safe model validation, multi-selection copy/paste with internal connections, command history and Undo/Redo;
- extensible Node SDK, Type Registry and explicit connection compatibility;
- parallel DAG scheduler, cancellation, progress, caching, Container serial execution and bounded streaming queues;
- main-thread, Web Worker, host and GPU backend contracts with CPU fallback policy;
- signature-aware Universal Import foundation, Asset Registry, SVG safety checks and `.onode` ZIP packages;
- React infinite Canvas with cursor-relative zoom, pan, marquee/Shift multi-selection, optional entity snapping, groups, minimap, recent-aware Library, Inspector, Timeline, dashboard and Light/Dark themes;
- standalone, embedded-edit, embedded-readonly and headless delivery modes;
- transactional Machine API plus an MCP/JSON-RPC adapter prototype;
- Vitest unit/integration coverage and Playwright E2E scenarios.

## Start locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The standalone app exposes its instance as `window.openNode` for development diagnostics.

## Verify

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Playwright needs a locally installed Chromium (`npx playwright install chromium`) before the final command.

## Embed

```ts
import { createOpenNode } from "@open-node/embed";

const editor = createOpenNode({
  container: document.querySelector("#graph")!,
  mode: "embedded-edit",
  project,
  nodeDefinitions: [myNode],
});

editor.on("executionFinished", ({ detail }) => console.log(detail));
editor.run({ mode: "manual" });
```

For server jobs and tests, use `createHeadlessOpenNode()` without React or a DOM container.

## Packages

| Package | Responsibility |
|---|---|
| `@open-node/model` | Canonical, UI-independent project model |
| `@open-node/commands` | Commands, history, copy/paste and grouped mutations |
| `@open-node/type-system` | Stable types and connection validation |
| `@open-node/sdk` | Node/Plugin definitions and registries |
| `@open-node/scheduler` | Parallel DAG scheduling and bounded queues |
| `@open-node/engine` | Execution sessions, backends, caching and Containers |
| `@open-node/timeline` | Frame/time conversion and playback runtime |
| `@open-node/assets` | Asset registry and content detection |
| `@open-node/io` | JSON/ZIP persistence, migrations, config and autosave |
| `@open-node/core-nodes` | Value, Math, Conversion, Import/Media and Output Nodes |
| `@open-node/ui` | Replaceable React presentation layer |
| `@open-node/embed` | Framework composition and public Embed API |
| `@open-node/machine-api` | Permissioned transactional automation API |
| `@open-node/mcp-adapter` | MCP-compatible tool and JSON-RPC adapter |
| `@open-node/telemetry` | Honest resource metrics adapters (`N/A` when unavailable) |

## Documentation

Start with [Getting Started](docs/getting-started.md) and the complete [Studio User Guide](docs/user-guide.md), then see [Architecture](docs/architecture.md), [Node SDK](docs/node-sdk.md), [Extension Authoring and Verification](docs/extension-authoring.md), [Execution Runtime](docs/execution-runtime.md), [Project Format](docs/project-format.md), [Embedding and Machine API](docs/integration.md), [Security and Performance](docs/security-performance.md), and [Migration Guide](docs/migration-guide.md).

The implementation-to-requirement audit is maintained in [Technical specification coverage](docs/spec-coverage.md).

MIT licensed. Project files never contain executable plugin code.
