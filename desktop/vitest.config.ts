import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import { createRequire } from "node:module";

const rootRequire = createRequire(path.resolve(__dirname, "../package.json"));

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { fs: { allow: [path.resolve(__dirname, "..")] } },
  test: {
    environment: "jsdom",
    globals: true,
    server: { deps: { inline: ["react-router", "react-router-dom"] } },
    setupFiles: [path.resolve(__dirname, "../src/test/setup.ts")],
    include: ["src/test/**/*.test.tsx"],
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "src"),
      "react": path.dirname(rootRequire.resolve("react/package.json")),
      "react-dom": path.dirname(rootRequire.resolve("react-dom/package.json")),
    },
  },
});
