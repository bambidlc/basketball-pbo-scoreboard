// Production server for the Basketball PBO Scoreboard.
//
// Responsibilities:
//   1. Serve the built Vite SPA from ./dist (with single-page fallback).
//   2. Reverse-proxy /odoo/* to the Odoo instance, injecting the API key
//      SERVER-SIDE so the private key never ships in the browser bundle.
//
// Zero runtime dependencies — uses only Node.js built-ins.
//
// Required environment variables (set as secrets on your host):
//   ODOO_URL      e.g. https://pbopr.odoo.com
//   ODOO_API_KEY  the Odoo API key / bearer token
// Optional:
//   ODOO_DB           Odoo database name (sent as X-Odoo-Database)
//   ODOO_PROXY_PATH   request prefix to proxy (default "/odoo")
//   PORT              port to listen on (set automatically by Render)

import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const compress = promisify(gzip);
const assetCache = new Map();

const ROOT_DIR = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = join(ROOT_DIR, "dist");

const PORT = Number(process.env.PORT) || 10000;
const PROXY_PREFIX = process.env.ODOO_PROXY_PATH || "/odoo";
const ODOO_URL = (process.env.ODOO_URL || process.env.VITE_ODOO_URL || "").replace(/\/+$/, "");
const ODOO_API_KEY = process.env.ODOO_API_KEY || "";
const ODOO_DB = process.env.ODOO_DB || process.env.VITE_ODOO_DB || "";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function serveStatic(req, res) {
  let urlPath = (req.url || "/").split("?")[0];
  try {
    urlPath = decodeURIComponent(urlPath);
  } catch {
    // keep raw on malformed encoding
  }
  if (urlPath.endsWith("/")) {
    urlPath = `${urlPath}index.html`;
  }

  // Resolve safely inside DIST_DIR; fall back to the SPA entry point.
  const safeRelative = normalize(urlPath).replace(/^([/\\]|\.\.([/\\]|$))+/, "");
  let filePath = join(DIST_DIR, safeRelative);
  if (!filePath.startsWith(DIST_DIR + sep) && filePath !== DIST_DIR) {
    filePath = join(DIST_DIR, "index.html");
  }

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      filePath = join(filePath, "index.html");
    }
  } catch {
    filePath = join(DIST_DIR, "index.html");
  }

  try {
    let cached = assetCache.get(filePath);
    if (!cached) {
      const data = await readFile(filePath);
      const compressible = /\.(?:html|js|mjs|css|json|svg|webmanifest)$/.test(filePath);
      cached = { data, gzip: compressible && data.length > 1024 ? await compress(data) : undefined };
      if (assetCache.size < 100) assetCache.set(filePath, cached);
    }
    const type = MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
    const isHashedAsset = filePath.includes(`${sep}assets${sep}`);
    const acceptsGzip = (req.headers["accept-encoding"] || "").split(",").some((encoding) => {
      const [name, ...parameters] = encoding.trim().toLowerCase().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return name === "gzip" && (!quality || Number(quality.trim().slice(2)) > 0);
    });
    const useGzip = cached.gzip && acceptsGzip;
    const body = useGzip ? cached.gzip : cached.data;
    send(res, 200, req.method === "HEAD" ? undefined : body, {
      "Content-Type": type,
      "Content-Length": body.length,
      "Vary": "Accept-Encoding",
      ...(useGzip ? { "Content-Encoding": "gzip" } : {}),
      "Cache-Control": isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache",
    });
  } catch {
    send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
  }
}

function proxyOdoo(req, res) {
  if (!ODOO_URL) {
    send(res, 502, JSON.stringify({ error: "ODOO_URL is not configured on the server." }), {
      "Content-Type": "application/json; charset=utf-8",
    });
    return;
  }

  const target = new URL(ODOO_URL);
  const isHttps = target.protocol === "https:";
  const doRequest = isHttps ? httpsRequest : httpRequest;
  const subPath = (req.url || "").slice(PROXY_PREFIX.length) || "/";

  const headers = { ...req.headers };
  headers.host = target.host;
  // Inject credentials server-side; ignore whatever the browser sent.
  if (ODOO_API_KEY) {
    headers.authorization = `bearer ${ODOO_API_KEY}`;
  }
  if (ODOO_DB) {
    headers["x-odoo-database"] = ODOO_DB;
  }

  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    method: req.method,
    path: `${target.pathname.replace(/\/$/, "")}${subPath}`,
    headers,
  };

  const upstream = doRequest(options, (upstreamRes) => {
    if (res.destroyed) { upstreamRes.destroy(); return; }
    const publicClubThumbnail = /^\/web\/image\/x_club\/\d+\/x_studio_image\/96x96$/.test(subPath) && upstreamRes.statusCode === 200;
    res.writeHead(upstreamRes.statusCode || 502, { ...upstreamRes.headers, "cache-control": publicClubThumbnail ? "public, max-age=300" : "no-store" });
    upstreamRes.pipe(res);
  });

  upstream.setTimeout(22000, () => upstream.destroy(new Error("Upstream timeout")));
  res.on("close", () => { if (!res.writableEnded) upstream.destroy(); });
  upstream.on("error", () => {
    if (res.headersSent || res.destroyed) { res.destroy(); return; }
    send(res, 502, JSON.stringify({ error: "Upstream request failed. Please retry." }), {
      "Content-Type": "application/json; charset=utf-8",
    });
  });

  req.pipe(upstream);
}

const server = createServer((req, res) => {
  const url = req.url || "/";
  if (url === PROXY_PREFIX || url.startsWith(`${PROXY_PREFIX}/`)) {
    proxyOdoo(req, res);
    return;
  }
  void serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
  console.log(`[server] proxy ${ODOO_URL ? "configured" : "not configured"}`);
  if (!ODOO_API_KEY) {
    console.warn("[server] warning: ODOO_API_KEY is not set; /odoo requests will be unauthenticated.");
  }
});
