import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const odooUrl = env.VITE_ODOO_URL;
  const port = process.env.PORT ? Number(process.env.PORT) : undefined;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      // Honor PORT so tooling can pin the dev server to a chosen port
      // (consistent with server.js / render.yaml in this repo).
      ...(port ? { port, strictPort: true } : {}),
      proxy: odooUrl
        ? {
            "/odoo": {
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/odoo/, ""),
              secure: true,
              target: odooUrl,
            },
          }
        : undefined,
    },
  };
});
