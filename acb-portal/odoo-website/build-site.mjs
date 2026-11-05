#!/usr/bin/env node
// Builds the ACB website on Odoo website #2 ("ACB").
//
//   node odoo-website/build-site.mjs --preview   # writes local HTML to .preview/site (no Odoo calls)
//   node odoo-website/build-site.mjs             # publishes to Odoo
//
// Environment (read from acb-portal/.env, then the process environment):
//   ODOO_URL, ODOO_API_KEY, ODOO_DB   Odoo connection (same as the portal)
//   ACB_WEBSITE_ID                    default 2
//   PORTAL_URL                        public URL of the registration portal (no trailing slash)
//   ACB_ARCHIVE_URL                   where the 2026 PDFs live, default https://www.acbpr.com
//   ACB_DOCS_DIR                      folder with the 2027 Word forms (optional)
//
// Safe to re-run. It uploads the logo, flyer, stylesheet and forms as public
// attachments, (re)writes one website-specific QWeb view per page, creates or
// updates the website.page records (Odoo header/footer hidden, the ACB ones are
// part of each page) and points website #2's menu at the new pages.
// Re-running overwrites edits made to these pages in the Odoo website editor.

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createOdoo, readDotEnv } from "../lib/odoo.mjs";
import { buildPages } from "./content.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const env = { ...(await readDotEnv(path.join(root, ".env"))), ...process.env };

const PREVIEW = process.argv.includes("--preview");
const WEBSITE_ID = Number(env.ACB_WEBSITE_ID || 2);
const PORTAL_URL = String(env.PORTAL_URL || "https://acb-portal.onrender.com").replace(/\/+$/, "");
const ARCHIVE_URL = String(env.ACB_ARCHIVE_URL || "https://www.acbpr.com").replace(/\/+$/, "");
const DOCS_DIR = env.ACB_DOCS_DIR || path.resolve(root, "../../Documents ");

const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800&family=Barlow:wght@400;500;600;700&family=Bungee&display=swap";

const DOCS = [
  { key: "info", file: "INFORMACION INSCRIPCION ACB 2027.docx", name: "Informacion Inscripcion ACB 2027.docx" },
  { key: "uniformes", file: "HOJA DE UNIFORMES 2027.docx", name: "Hoja de Uniformes ACB 2027.docx" },
  { key: "carnet", file: "3. CARNET Y LISTA DE JUGADORES  ACB 2026.doc", name: "Carnet y Lista de Jugadores ACB.doc" },
  { key: "roster", file: "2. ROSTER DE JUEGO  2027.doc", name: "Roster de Juego ACB 2027.doc" },
  { key: "disponibilidad", file: "DISPONIBILIDAD DE CANCHA Y DIRIGENTES CON 2 EQUIPOS 2027.docx", name: "Disponibilidad de Cancha y Dirigentes ACB 2027.docx" },
];
const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".css": "text/css",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const exists = (p) => access(p).then(() => true, () => false);
const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");
const log = (...args) => console.log("[acb-site]", ...args);

const courts = JSON.parse(await readFile(path.join(here, "data/canchas.json"), "utf8"));
const resoluciones = JSON.parse(await readFile(path.join(here, "data/resoluciones.json"), "utf8"));
const css = `${await readFile(path.join(root, "shared/brand.css"), "utf8")}\n${await readFile(path.join(here, "site.css"), "utf8")}`;

if (PREVIEW) {
  await preview();
} else {
  await publish();
}

// ------------------------------------------------------------------ preview
async function preview() {
  const out = path.join(root, ".preview/site");
  await mkdir(out, { recursive: true });
  await copyFile(path.join(here, "assets/flyer-torneo30-2027.jpg"), path.join(out, "flyer.jpg"));
  const docs = {};
  for (const d of DOCS) if (await exists(path.join(DOCS_DIR, d.file))) docs[d.key] = `/web/content/0?download=true#${d.key}`;
  const pages = buildPages({
    portal: PORTAL_URL,
    archive: ARCHIVE_URL,
    assets: { logo: "/acb-logo.png", logoSmall: "/acb-logo-256.png", flyer: "/.preview/site/flyer.jpg", docs },
    courts,
    resoluciones,
  });
  const slugByUrl = Object.fromEntries(pages.map((p) => [p.url, p.slug]));
  for (const page of pages) {
    // Internal links point at the other preview files.
    const html = page.html.replace(/href="(\/[a-z0-9-]*)"/g, (m, url) => (slugByUrl[url] ? `href="/.preview/site/${slugByUrl[url]}.html"` : m));
    const doc = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${page.title}</title>
<!-- Odoo's frontend ships Bootstrap 5; load it so the preview shows the same cascade. -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin=""/>
<link rel="stylesheet" href="${FONTS_URL}"/>
<link rel="stylesheet" href="/shared/brand.css"/><link rel="stylesheet" href="/odoo-website/site.css"/>
</head><body><div id="wrapwrap"><main><div class="acb acb-site">${html}</div></main></div></body></html>`;
    await writeFile(path.join(out, `${page.slug}.html`), doc);
    await writeFile(path.join(out, `${page.slug}.arch.xml`), archFor(page, "acb_site.preview", "/preview.css"));
  }
  log(`preview: ${pages.length} pages in ${path.relative(root, out)} — open http://localhost:5180/.preview/site/home.html`);
}

// ------------------------------------------------------------------ Odoo
function headHtml(cssUrl) {
  const amp = (u) => u.replace(/&/g, "&amp;");
  return `<meta name="theme-color" content="#0b1640"/><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin=""/><link rel="stylesheet" href="${amp(FONTS_URL)}"/><link rel="stylesheet" href="${amp(cssUrl)}"/>`;
}

/** QWeb arch for one page. The ACB top bar, hero and footer wrap Odoo's editable #wrap. */
function archFor(page, tname, cssUrl) {
  const [chrome, rest] = splitChrome(page.html);
  return `<t t-name="${tname}"><t t-call="website.layout"><t t-set="pageName" t-value="'acb_${page.slug.replace(/-/g, "_")}'"/><t t-set="head">${headHtml(cssUrl)}</t><div class="acb acb-site">${chrome}<div id="wrap" class="oe_structure">${rest.body}</div>${rest.footer}</div></t></t>`;
}

/** Split generated HTML into [top bar + hero + ticker] and { body, footer }. */
function splitChrome(html) {
  const tickerEnd = html.indexOf("</div></div>", html.indexOf('class="acb-ticker"')) + "</div></div>".length;
  const footerStart = html.lastIndexOf('<footer class="acbw-footer">');
  return [html.slice(0, tickerEnd), { body: html.slice(tickerEnd, footerStart), footer: html.slice(footerStart) }];
}

async function publish() {
  const odoo = createOdoo({ url: env.ODOO_URL, apiKey: env.ODOO_API_KEY, db: env.ODOO_DB });
  const [site] = await odoo.read("website", [WEBSITE_ID], ["id", "name"]);
  if (!site) throw new Error(`Website ${WEBSITE_ID} not found`);
  log(`publishing to website #${site.id} "${site.name}" · portal ${PORTAL_URL}`);

  async function upsertAttachment(key, name, data) {
    const mimetype = MIME[path.extname(name).toLowerCase()] || "application/octet-stream";
    const checksum = sha1(data);
    const tag = `acb_site:${key}`;
    const [existing] = await odoo.searchRead("ir.attachment", [["description", "=", tag]], ["id", "checksum"], { limit: 1 });
    const vals = { name, mimetype, datas: data.toString("base64"), public: true, res_model: "ir.ui.view", res_id: 0, description: tag, website_id: WEBSITE_ID };
    let id = existing?.id;
    if (!id) id = await odoo.create("ir.attachment", vals);
    else if (existing.checksum !== checksum) await odoo.write("ir.attachment", [id], vals);
    return { id, unique: checksum.slice(0, 10) };
  }

  const logo = await upsertAttachment("logo", "acb-logo.png", await readFile(path.join(root, "public/acb-logo.png")));
  const logoSmall = await upsertAttachment("logo256", "acb-logo-256.png", await readFile(path.join(root, "public/acb-logo-256.png")));
  const flyer = await upsertAttachment("flyer", "flyer-torneo30-2027.jpg", await readFile(path.join(here, "assets/flyer-torneo30-2027.jpg")));
  const sheet = await upsertAttachment("css", "acb-site.css", Buffer.from(css));
  const docs = {};
  for (const d of DOCS) {
    const file = path.join(DOCS_DIR, d.file);
    if (!(await exists(file))) {
      log(`skipping missing form: ${d.file}`);
      continue;
    }
    const att = await upsertAttachment(`doc:${d.key}`, d.name, await readFile(file));
    docs[d.key] = `/web/content/${att.id}?download=true`;
  }
  log(`attachments ok (css #${sheet.id}, ${Object.keys(docs).length} forms)`);

  const pages = buildPages({
    portal: PORTAL_URL,
    archive: ARCHIVE_URL,
    assets: {
      logo: `/web/image/${logo.id}/acb-logo.png?unique=${logo.unique}`,
      logoSmall: `/web/image/${logoSmall.id}/acb-logo-256.png?unique=${logoSmall.unique}`,
      flyer: `/web/image/${flyer.id}/flyer-torneo30-2027.jpg?unique=${flyer.unique}`,
      docs,
    },
    courts,
    resoluciones,
  });
  const cssUrl = `/web/content/${sheet.id}/acb-site.css?unique=${sheet.unique}`;

  const pageFields = await odoo.call("website.page", "fields_get", { attributes: ["type"] });
  const seo = (p) => ({
    ...(pageFields.website_meta_title ? { website_meta_title: p.title } : {}),
    ...(pageFields.website_meta_description ? { website_meta_description: p.description } : {}),
  });

  for (const page of pages) {
    const flags = { is_published: true, header_visible: false, footer_visible: false, website_indexed: true, ...seo(page) };
    if (page.url === "/") {
      // Website #2 already has its own copy of the homepage view; rewrite it in place.
      const [home] = await odoo.searchRead("website.page", [["url", "=", "/"], ["website_id", "=", WEBSITE_ID]], ["id", "view_id"], { limit: 1 });
      if (!home) throw new Error("Website homepage not found");
      await odoo.write("ir.ui.view", [home.view_id[0]], { arch: archFor(page, "website.homepage", cssUrl) });
      await odoo.write("website.page", [home.id], { name: page.name, ...flags });
      log(`page / (view #${home.view_id[0]})`);
      continue;
    }
    const key = `acb_site.${page.slug.replace(/-/g, "_")}`;
    const arch = archFor(page, key, cssUrl);
    const [view] = await odoo.searchRead("ir.ui.view", [["key", "=", key], ["website_id", "=", WEBSITE_ID]], ["id"], { limit: 1 });
    const viewId = view ? view.id : await odoo.create("ir.ui.view", { name: page.name, key, type: "qweb", arch, website_id: WEBSITE_ID });
    if (view) await odoo.write("ir.ui.view", [viewId], { name: page.name, arch });
    const [existing] = await odoo.searchRead("website.page", [["url", "=", page.url], ["website_id", "=", WEBSITE_ID]], ["id"], { limit: 1 });
    if (existing) await odoo.write("website.page", [existing.id], { view_id: viewId, ...flags });
    else await odoo.create("website.page", { url: page.url, view_id: viewId, website_id: WEBSITE_ID, ...flags });
    log(`page ${page.url} (view #${viewId})`);
  }

  await syncMenu(odoo, pages);

  // Favicon for the browser tab.
  await odoo.write("website", [WEBSITE_ID], { favicon: (await readFile(path.join(root, "public/acb-logo-256.png"))).toString("base64") });
  log("done");
}

/** Website #2's menu lists every ACB page (used by Odoo's sitemap and editor). */
async function syncMenu(odoo, pages) {
  const [top] = await odoo.searchRead("website.menu", [["website_id", "=", WEBSITE_ID], ["parent_id", "=", false]], ["id"], { limit: 1 });
  if (!top) return log("no top menu found; skipped menu sync");
  const wanted = pages.map((p, i) => ({ name: p.name, url: p.url, sequence: (i + 1) * 10 }));
  const current = await odoo.searchRead("website.menu", [["website_id", "=", WEBSITE_ID], ["parent_id", "=", top.id]], ["id", "name", "url"]);
  const byUrl = new Map(current.map((m) => [m.url, m]));
  for (const w of wanted) {
    const found = byUrl.get(w.url);
    if (found) {
      await odoo.write("website.menu", [found.id], { name: w.name, sequence: w.sequence });
      byUrl.delete(w.url);
    } else {
      await odoo.create("website.menu", { ...w, parent_id: top.id, website_id: WEBSITE_ID });
    }
  }
  const stale = [...byUrl.values()];
  if (stale.length) {
    await odoo.unlink("website.menu", stale.map((m) => m.id));
    log(`removed default menu items: ${stale.map((m) => m.name).join(", ")}`);
  }
  log(`menu: ${wanted.length} items`);
}
