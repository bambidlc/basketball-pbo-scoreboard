#!/usr/bin/env node
// Serves a static folder the way Render's static sites do (/canchas -> canchas/index.html).
//   node scripts/serve-static.mjs dist-site 5190
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const dir = path.resolve(process.argv[2] || "dist-site");
const port = Number(process.argv[3] || 5190);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".js": "text/javascript" };

createServer(async (req, res) => {
  let file = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(dir)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(await readFile(file));
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
}).listen(port, () => console.log(`serving ${dir} on http://localhost:${port}`));
