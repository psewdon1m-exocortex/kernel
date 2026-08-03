import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("../..", import.meta.url));
const packageSource = (name: string) => `${root}/packages/${name}/src/index.${name === "ui" || name === "embed" ? "tsx" : "ts"}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: Object.fromEntries([
      "model", "type-system", "commands", "scheduler", "engine", "timeline", "assets", "sdk", "core-nodes", "io", "machine-api", "mcp-adapter", "telemetry", "ui", "embed",
    ].map((name) => [`@open-node/${name}`, packageSource(name)])),
  },
  server: { port: 3000, strictPort: false },
  preview: { port: 4173 },
  build: { target: "es2022", sourcemap: true },
});
