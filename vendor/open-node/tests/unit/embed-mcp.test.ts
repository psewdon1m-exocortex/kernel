import { describe, expect, it } from "vitest";
import { createHeadlessOpenNode } from "@open-node/embed";
import { OpenNodeMcpAdapter } from "@open-node/mcp-adapter";

describe("headless Embed API and MCP adapter", () => {
  it("creates, connects, runs and exports a graph without UI", async () => {
    const editor = createHeadlessOpenNode();
    const mcp = new OpenNodeMcpAdapter(editor.machineApi);
    const a = await mcp.callTool("create_node", { typeId: "open-node.core.integer", x: 0, y: 0, parameters: { value: 4 } });
    expect(a.isError).not.toBe(true);
    const inspect = await mcp.callTool("inspect_graph");
    expect(inspect.content[0]?.text).toContain("open-node.core.integer");
    const run = await mcp.callTool("run_pipeline", { mode: "manual" });
    expect(run.content[0]?.text).toContain("sessionId");
    expect((await mcp.handleJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).result).toBeDefined();
    expect(editor.serialize().format).toBe("open-node-project");
    await editor.destroy();
  });
});
