import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const odooUrl = env.VITE_ODOO_URL;

  return {
    plugins: [react(), tailwindcss()],
    server: odooUrl
      ? {
          proxy: {
            "/odoo": {
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/odoo/, ""),
              secure: true,
              target: odooUrl,
            },
          },
        }
      : undefined,
  };
});
