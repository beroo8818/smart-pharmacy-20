import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
  resolve: {
    // Shared navigation must use the same router context as the desktop app.
    dedupe: ["react", "react-dom", "react-router", "react-router-dom", "@tanstack/react-query"],
    alias: { "@": path.resolve(__dirname, "src") },
  },
  plugins: [react()],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(process.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "desktop-local-unused-key"),
  },
  build: { outDir: "dist", emptyOutDir: true },
});
