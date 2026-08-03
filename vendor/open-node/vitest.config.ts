import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@open-node/model": `${root}packages/model/src/index.ts`,
      "@open-node/type-system": `${root}packages/type-system/src/index.ts`,
      "@open-node/commands": `${root}packages/commands/src/index.ts`,
      "@open-node/scheduler": `${root}packages/scheduler/src/index.ts`,
      "@open-node/engine": `${root}packages/engine/src/index.ts`,
      "@open-node/timeline": `${root}packages/timeline/src/index.ts`,
      "@open-node/assets": `${root}packages/assets/src/index.ts`,
      "@open-node/sdk": `${root}packages/sdk/src/index.ts`,
      "@open-node/core-nodes": `${root}packages/core-nodes/src/index.ts`,
      "@open-node/io": `${root}packages/io/src/index.ts`,
      "@open-node/machine-api": `${root}packages/machine-api/src/index.ts`,
      "@open-node/mcp-adapter": `${root}packages/mcp-adapter/src/index.ts`,
      "@open-node/telemetry": `${root}packages/telemetry/src/index.ts`,
      "@open-node/ui": `${root}packages/ui/src/index.tsx`,
      "@open-node/embed": `${root}packages/embed/src/index.tsx`
    }
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"]
    }
  }
});
