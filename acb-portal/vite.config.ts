import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API server (server.mjs) runs on :8787 during development; Vite proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 900 },
});
