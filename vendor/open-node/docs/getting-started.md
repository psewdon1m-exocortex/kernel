# Getting Started

## Requirements

- Node.js 22 or 24;
- npm 10 or newer;
- a modern desktop browser for the standalone UI.

Install and launch:

```bash
npm install
npm run dev
```

The reference shell starts at `http://localhost:3000`. It opens a sample math graph: select Nodes, press **Run**, inspect progress and outputs, pan with middle mouse or `Space + drag`, zoom under the cursor with the wheel, and double-tap `Space` to return to world origin.

## Basic workflow

1. Open the Library at the pointer with left `Alt` or a double-click on empty Canvas space.
2. Drag a Node to the Canvas or double-click it.
3. Drag from an output port to a compatible input port.
4. Edit parameters in Inspector.
5. Press **Run**. Use **Stop** to cancel an active session.
6. Save a canonical `.onode.json` file.

The Library separates Recently used items, all Nodes and empty/saved Containers. Its toolbar creates annotations and controls visual layers.

Drag an empty Canvas region to marquee-select, or use `Shift + click` to build a multi-selection. Copy, cut, duplicate and paste retain connections internal to that selection. Hold `Alt` and drag an empty Canvas region to create a Group. All editing operations are reversible with `Ctrl/Cmd + Z`.

Canvas Settings include an optional **Snap to grid** mode for Nodes, Containers and Groups. Annotations never snap. See the [Studio User Guide](user-guide.md) for the complete interaction reference.

## Headless smoke test

```ts
import { createHeadlessOpenNode } from "@open-node/embed";

const editor = createHeadlessOpenNode();
const nodeId = await editor.machineApi.createNode(
  "open-node.core.integer",
  { x: 0, y: 0 },
  { value: 42 },
);
const session = editor.run();
await session.completion;
await editor.destroy();
```

## Troubleshooting

- **Unresolved Node:** install/register the exact package version. Raw state is retained and can be saved again.
- **Connection rejected:** inspect direction, kind, cardinality and type compatibility. Conversions other than integer → float require an explicit converter Node.
- **No system metric:** browsers cannot expose every resource statistic; `N/A` is intentional.
- **Worker unavailable:** register a Worker backend; supported Nodes fall back to CPU unless they declare `gpu-required`.
- **E2E browser missing:** run `npx playwright install chromium`.
