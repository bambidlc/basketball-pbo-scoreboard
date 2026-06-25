import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const odooUrl = env.VITE_ODOO_URL;
  const port = process.env.PORT ? Number(process.env.PORT) : undefined;

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Thin PWA: precache the app shell so the scorer opens with no signal at all,
      // and auto-update the cached bundle on the next visit after a deploy. Odoo API
      // traffic is deliberately NEVER cached here — the app's own outbox + polling own
      // offline data, so the service worker must pass /odoo straight through.
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: "auto",
        includeAssets: ["court.svg", "pwa-icon.svg"],
        manifest: {
          name: "Basketball PBO Scoring",
          short_name: "PBO Scoring",
          description: "Live basketball scoring for PBO — works offline.",
          lang: "es",
          theme_color: "#0a0a0a",
          background_color: "#0a0a0a",
          display: "standalone",
          orientation: "any",
          start_url: "/",
          scope: "/",
          icons: [
            { src: "pwa-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
            { src: "pwa-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,woff,woff2}"],
          navigateFallback: "/index.html",
          // Navigations to /odoo (and the API calls themselves) must hit the network,
          // never the cached SPA shell.
          navigateFallbackDenylist: [/^\/odoo/],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith("/odoo"),
              handler: "NetworkOnly",
            },
          ],
        },
        // Keep the service worker out of `vite dev` so local development never serves a
        // stale cached bundle; it activates in production builds only.
        devOptions: { enabled: false },
      }),
    ],
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
