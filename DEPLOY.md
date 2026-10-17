# Deploying to Render

The app is published as a single **Node web service** that:

1. Serves the built Vite app from `dist/`.
2. Reverse-proxies `/odoo/*` to your Odoo instance, **injecting the API key
   server-side** ([server.js](server.js)) so the private key is never shipped
   to browsers.

A [render.yaml](render.yaml) blueprint is included for one-click setup.

## Before you deploy

- Push this repo to GitHub/GitLab. The [.gitignore](.gitignore) keeps `.env`,
  `node_modules/`, and `dist/` out of the repo — **never commit your real
  Odoo API key.**
- Have your Odoo values ready: instance URL, API key, and database name.

## Option A — Blueprint (recommended)

1. In the Render dashboard: **New → Blueprint**, then connect this repository.
2. Render reads `render.yaml` and creates the `basketball-pbo-scoreboard` web
   service.
3. When prompted, fill in the two secret values:
   - `ODOO_URL` → e.g. `https://pbopr.odoo.com`
   - `ODOO_API_KEY` → your private Odoo API key
4. Click **Apply**. First deploy runs `npm ci && npm run build`, then
   `node server.js`.

## Option B — Manual web service

**New → Web Service**, connect the repo, and set:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci && npm run build` |
| Start command | `node server.js` |
| Health check path | `/` |

Then add the environment variables below.

## Environment variables

**Server-side (secret — set in dashboard, never commit):**

| Key | Example | Notes |
| --- | --- | --- |
| `ODOO_URL` | `https://pbopr.odoo.com` | Proxy target |
| `ODOO_API_KEY` | `c1a5…` | Injected server-side; not in the bundle |
| `ODOO_DB` | `pbopr` | Sent as `X-Odoo-Database` |

**Client build-time (safe to expose, already in `render.yaml`):**

| Key | Value |
| --- | --- |
| `VITE_ODOO_PROXY_PATH` | `/odoo` |
| `VITE_ODOO_API_MODE` | `json2` |
| `VITE_ODOO_DB` | `pbopr` |
| `VITE_ODOO_API_KEY` | `managed-by-proxy` (placeholder) |
| `VITE_MATCH_POLL_MS` | `15000` |
| `NODE_VERSION` | `22` |

## Notes

- **Security:** the real key lives only in `ODOO_API_KEY` on the server. The
  browser bundle carries the harmless `managed-by-proxy` placeholder; the proxy
  overwrites the `Authorization` header with the real key on every `/odoo`
  request.
- **Free plan** spins the service down after ~15 min idle, so the first request
  after a quiet period has a cold start (~50s). For live game days, use a paid
  instance (e.g. Starter) to keep it always on.
- **Local production preview:** `npm run build` then
  `PORT=8787 ODOO_URL=… ODOO_API_KEY=… ODOO_DB=pbopr node server.js`, and open
  http://localhost:8787.
