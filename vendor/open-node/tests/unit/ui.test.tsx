import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssetRegistry } from "@open-node/assets";
import { CommandHistory } from "@open-node/commands";
import { registerCoreNodes } from "@open-node/core-nodes";
import { ExecutionRuntime } from "@open-node/engine";
import { createEmptyProject, ProjectStore } from "@open-node/model";
import { NodeRegistry } from "@open-node/sdk";
import { TimelineRuntime } from "@open-node/timeline";
import { createCoreTypeRegistry } from "@open-node/type-system";
import { OpenNodeEditor } from "@open-node/ui";

describe("OpenNodeEditor", () => {
  it("server-renders the reference shell without browser globals", () => {
    const project = createEmptyProject("Render test");
    project.timeline.enabled = true;
    const store = new ProjectStore(project);
    const nodes = new NodeRegistry(); registerCoreNodes(nodes);
    const html = renderToString(createElement(OpenNodeEditor, {
      controller: {
        store,
        history: new CommandHistory(),
        nodes,
        types: createCoreTypeRegistry(),
        runtime: new ExecutionRuntime(nodes),
        timeline: new TimelineRuntime(project.timeline),
        assets: new AssetRegistry(),
      },
      mode: "embedded-readonly",
    }));
    expect(html).toContain("OPEN NODE");
    expect(html).toContain("Infinite graph canvas");
    expect(html).toContain("Left Alt — Library");
    expect(html).not.toContain("on-panel on-library");
    expect(html).toContain("Minimap");
  });
});
