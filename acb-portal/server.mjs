// Portal de Inscripción ACB 2027 — production server.
//
//   * Serves the built React app from ./dist (SPA fallback).
//   * Exposes a narrow JSON API under /api that reads/writes ONLY the x_acb_*
//     models in Odoo, always scoped to the signed-in club. There is no generic
//     Odoo proxy: the Odoo API key never reaches the browser.
//   * Passwordless sign-in: a 6-digit code is emailed (through Odoo) to the
//     club's registered email; a signed, HttpOnly session cookie follows.
//
// Environment:
//   ODOO_URL, ODOO_API_KEY, ODOO_DB     Odoo connection (required)
//   SESSION_SECRET                      optional; derived from ODOO_API_KEY when unset
//   MAIL_FROM                           default "ACB Inscripciones <info@pbopr.com>"
//   ACB_NOTIFY_EMAIL                    optional; gets new club requests and a copy of every team submission
//   PUBLIC_URL                          optional; absolute URL used in emails
//   DEV_LOGIN_CODES=1                   local development only: print codes, send no email
//   PORT                                default 10000

import { createServer } from "node:http";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

import { createOdoo, readDotEnv } from "./lib/odoo.mjs";
import { CLUB, FILE_FIELDS, PLAYER, TEAM, apiKey, portalFields } from "./shared/schema.js";
import {
  COURT_DAYS,
  COURT_SLOTS,
  MAX_PLAYERS,
  PROGRAMS,
  UNIFORMS_INCLUDED,
  eligibility,
  formatDateShort,
  teamCosts,
  teamLabel,
} from "./shared/tournament.js";
import { isEmail, parseCourtDates, validateClub, validateTeam } from "./shared/validation.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(ROOT, "dist");
const env = { ...(await readDotEnv(join(ROOT, ".env"))), ...process.env };

const PORT = Number(env.PORT) || 10000;
const DEV_CODES = env.DEV_LOGIN_CODES === "1";
const MAIL_FROM = env.MAIL_FROM || "ACB Inscripciones <info@pbopr.com>";
const NOTIFY_EMAIL = (env.ACB_NOTIFY_EMAIL || "").trim();
const SECRET = env.SESSION_SECRET || createHmac("sha256", String(env.ODOO_API_KEY || "")).update("acb-portal-session-v1").digest("hex");
const SESSION_DAYS = 14;
const CODE_MINUTES = 15;
const MAX_CODE_ATTEMPTS = 5;
const MAX_TEAMS_PER_CLUB = 40;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const odoo = createOdoo({ url: env.ODOO_URL, apiKey: env.ODOO_API_KEY, db: env.ODOO_DB });
const compress = promisify(gzip);

// --------------------------------------------------------------- utilities
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const now = () => new Date();
const odooDateTime = (date) => date.toISOString().replace("T", " ").slice(0, 19);
const fromOdooDateTime = (value) => (value ? `${String(value).replace(" ", "T")}Z` : "");
const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

function sign(value) {
  return createHmac("sha256", SECRET).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function codeHash(clubId, code) {
  return createHmac("sha256", SECRET).update(`login:${clubId}:${code}`).digest("hex");
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

/** "jabes@gmail.com" -> "ja•••@gmail.com": enough to recognize, not to harvest. */
function maskEmail(email) {
  const [local = "", domain = ""] = String(email || "").split("@");
  if (!domain) return "";
  return `${local.slice(0, local.length > 3 ? 2 : 1)}•••@${domain}`;
}

/** Club names compared without accents, case, spaces or punctuation. */
function normName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isHttps(req) {
  return String(req.headers["x-forwarded-proto"] || "").includes("https");
}

function publicUrl(req) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, "");
  const proto = isHttps(req) ? "https" : "http";
  return `${proto}://${req.headers.host}`;
}

// Simple fixed-window rate limiter (per process; fine for one instance).
const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const t = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < t) {
    buckets.set(key, { count: 1, reset: t + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new HttpError(429, "Demasiados intentos. Espere unos minutos e intente de nuevo.");
  }
}
setInterval(() => {
  const t = Date.now();
  for (const [key, bucket] of buckets) if (bucket.reset < t) buckets.delete(key);
}, 60_000).unref();

// ------------------------------------------------------------- sessions
function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function sessionCookie(req, value, maxAgeSeconds) {
  const parts = [`acb_session=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (isHttps(req)) parts.push("Secure");
  return parts.join("; ");
}

function issueSession(req, club) {
  const payload = b64url(JSON.stringify({ c: club.id, v: club.x_session_version || 0, e: Date.now() + SESSION_DAYS * 86400_000 }));
  return sessionCookie(req, `${payload}.${sign(payload)}`, SESSION_DAYS * 86400);
}

const sessionCache = new Map();
async function requireClub(req) {
  const raw = readCookies(req).acb_session || "";
  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !safeEqual(sign(payload), signature)) throw new HttpError(401, "Inicie sesión para continuar.");
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(401, "Sesión inválida.");
  }
  if (!data.c || data.e < Date.now()) throw new HttpError(401, "Su sesión expiró. Entre de nuevo.");
  let cached = sessionCache.get(data.c);
  if (!cached || cached.at < Date.now() - 30_000) {
    const [club] = await odoo.read(CLUB.model, [data.c], ["x_state", "x_session_version"]);
    cached = { at: Date.now(), state: club?.x_state, version: club?.x_session_version || 0, exists: Boolean(club) };
    sessionCache.set(data.c, cached);
  }
  if (!cached.exists || cached.state === "blocked" || cached.version !== (data.v || 0)) {
    throw new HttpError(401, "Su acceso no está disponible. Comuníquese con la ACB.");
  }
  return data.c;
}

// ------------------------------------------------------------ mapping
const CLUB_READ = portalFields(CLUB, "r").filter((f) => f.type !== "binary");
const TEAM_READ = portalFields(TEAM, "r").filter((f) => f.type !== "binary" && f.type !== "one2many");
const PLAYER_READ = portalFields(PLAYER, "r").filter((f) => f.type !== "binary");

function fromOdoo(fields, record) {
  const out = { id: record.id };
  for (const field of fields) {
    const value = record[field.name];
    const key = apiKey(field.name);
    switch (field.type) {
      case "boolean":
        out[key] = Boolean(value);
        break;
      case "integer":
      case "float":
        out[key] = Number(value || 0);
        break;
      case "datetime":
        out[key] = fromOdooDateTime(value);
        break;
      case "many2one":
        out[key] = Array.isArray(value) ? value[0] : value || null;
        break;
      default:
        out[key] = value === false || value === null || value === undefined ? "" : value;
    }
  }
  return out;
}

function clean(value, max = 255) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

function toOdoo(model, data) {
  const values = {};
  for (const field of portalFields(model, "rw")) {
    const key = apiKey(field.name);
    if (!(key in data)) continue;
    const value = data[key];
    switch (field.type) {
      case "boolean":
        values[field.name] = Boolean(value);
        break;
      case "integer": {
        const n = Number.parseInt(value, 10);
        values[field.name] = Number.isFinite(n) ? n : 0;
        break;
      }
      case "date":
        values[field.name] = /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? value : false;
        break;
      case "selection":
        values[field.name] = field.selection.some(([v]) => v === value) ? value : false;
        break;
      case "text":
        if (field.json) values[field.name] = JSON.stringify(cleanCourtDates(value));
        else values[field.name] = clean(value, field.max || 4000) || false;
        break;
      default: {
        let text = clean(value, field.max || 255);
        if (field.kind === "email") text = text.toLowerCase();
        values[field.name] = text || false;
      }
    }
  }
  return values;
}

function cleanCourtDates(value) {
  const slots = new Set(COURT_SLOTS.map((s) => s.value));
  const days = new Set(COURT_DAYS);
  const seen = new Set();
  return parseCourtDates(value)
    .filter((item) => item && days.has(item.date) && slots.has(item.slot) && !seen.has(item.date) && seen.add(item.date))
    .map((item) => ({ date: item.date, slot: item.slot }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function courtDatesText(json) {
  const labels = Object.fromEntries(COURT_SLOTS.map((s) => [s.value, s.label]));
  const list = parseCourtDates(json);
  return list.length ? list.map((d) => `${formatDateShort(d.date)} · ${labels[d.slot] || d.slot}`).join("\n") : false;
}

// --------------------------------------------------------------- email
function emailLayout(title, inner, req) {
  const base = publicUrl(req);
  return `<!doctype html><html><body style="margin:0;background:#eef1f8;font-family:Arial,Helvetica,sans-serif;color:#0b1640">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f8;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0b1640;padding:22px 28px">
  <table role="presentation" width="100%"><tr>
    <td width="64"><img src="${base}/acb-logo-256.png" width="58" alt="ACB" style="display:block"></td>
    <td style="color:#ffffff;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold">Asociación de Clubes de<br>Baloncesto de Puerto Rico<br><span style="color:#ff8a3d">Torneo #30 · 2027</span></td>
  </tr></table>
</td></tr>
<tr><td style="height:4px;background:#f26a1b"></td></tr>
<tr><td style="padding:28px">
  <h1 style="margin:0 0 14px;font-size:22px;color:#0b1640">${title}</h1>
  ${inner}
</td></tr>
<tr><td style="background:#f6f7fb;padding:16px 28px;font-size:12px;color:#5b6483">Portal de Inscripción ACB · <a href="${base}" style="color:#1d4ed8">${base.replace(/^https?:\/\//, "")}</a><br>Si usted no solicitó este mensaje, puede ignorarlo.</td></tr>
</table></td></tr></table></body></html>`;
}

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function sendMail({ to, subject, html, text }) {
  if (DEV_CODES) {
    console.log(`[mail:dev] to=${to} subject="${subject}"${text ? `\n${text}` : ""}`);
    return;
  }
  try {
    const id = await odoo.create("mail.mail", {
      email_from: MAIL_FROM,
      email_to: to,
      subject,
      body_html: html,
      auto_delete: true,
    });
    await odoo.call("mail.mail", "send", { ids: [id] }).catch((error) => {
      console.warn("[mail] queued for Odoo cron:", error.message);
    });
  } catch (error) {
    console.error("[mail] failed:", error.message);
    throw new HttpError(502, "No pudimos enviar el email en este momento. Intente de nuevo en unos minutos.");
  }
}

async function sendLoginCode(req, club) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await odoo.write(CLUB.model, [club.id], {
    x_login_hash: codeHash(club.id, code),
    x_login_expiry: odooDateTime(new Date(Date.now() + CODE_MINUTES * 60_000)),
    x_login_attempts: 0,
  });
  const link = `${publicUrl(req)}/mi-club?email=${encodeURIComponent(club.x_email)}`;
  const spaced = code.split("").join(" ");
  await sendMail({
    to: club.x_email,
    subject: `${code} es su código de acceso · Portal ACB 2027`,
    text: `Código para ${club.x_email}: ${code}`,
    html: emailLayout(
      "Su código de acceso",
      `<p style="font-size:15px;line-height:1.5;margin:0 0 18px">Hola, <b>${escapeHtml(club.x_name)}</b>. Use este código para entrar al Portal de Inscripción del Torneo ACB 2027. Vence en ${CODE_MINUTES} minutos.</p>
       <div style="font-size:38px;font-weight:bold;letter-spacing:10px;text-align:center;background:#0b1640;color:#ffffff;border-radius:12px;padding:18px 0;margin:0 0 18px">${spaced}</div>
       <p style="text-align:center;margin:0 0 8px"><a href="${link}" style="display:inline-block;background:#f26a1b;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 26px;border-radius:999px">Entrar al portal</a></p>`,
      req,
    ),
  });
}

// ------------------------------------------------------------- loaders
async function loadClub(clubId) {
  const fields = [...CLUB_READ.map((f) => f.name), "x_court_dates"];
  const [record] = await odoo.read(CLUB.model, [clubId], Array.from(new Set(fields)));
  if (!record) throw new HttpError(404, "Club no encontrado.");
  return fromOdoo(CLUB_READ, record);
}

async function loadTeams(clubId) {
  const rows = await odoo.searchRead(TEAM.model, [["x_club_id", "=", clubId]], TEAM_READ.map((f) => f.name), { order: "x_category asc, id asc" });
  return rows.map((row) => fromOdoo(TEAM_READ, row));
}

async function loadTeamOwned(clubId, teamId) {
  const id = Number(teamId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, "Equipo no encontrado.");
  const [record] = await odoo.searchRead(TEAM.model, [["id", "=", id], ["x_club_id", "=", clubId]], TEAM_READ.map((f) => f.name), { limit: 1 });
  if (!record) throw new HttpError(404, "Equipo no encontrado.");
  return fromOdoo(TEAM_READ, record);
}

async function loadPlayers(teamId) {
  const rows = await odoo.searchRead(PLAYER.model, [["x_team_id", "=", teamId]], PLAYER_READ.map((f) => f.name), { order: "x_sequence asc, id asc" });
  return rows.map((row) => fromOdoo(PLAYER_READ, row));
}

function teamFiles(team) {
  return { coachCard: Boolean(team.coachCardName), asstCard: Boolean(team.asstCardName), scorerCard: Boolean(team.scorerCardName) };
}

function playerFilesMap(players) {
  return Object.fromEntries(players.map((p) => [p.id, { birthCert: Boolean(p.birthCertName), photo: Boolean(p.photoName) }]));
}

function completion(validation) {
  const sections = ["equipo", "personal", "uniformes", "jugadores", "club"];
  const bad = new Set(validation.errors.map((e) => e.section));
  return Math.round((sections.filter((s) => !bad.has(s)).length / sections.length) * 100);
}

async function teamPayload(clubId, team) {
  const [club, players, teams] = await Promise.all([loadClub(clubId), loadPlayers(team.id), loadTeams(clubId)]);
  const validation = validateTeam(team, players, {
    club,
    otherTeams: teams.map((t) => ({ ...t, label: t.name })),
    files: teamFiles(team),
    playerFiles: playerFilesMap(players),
  });
  return { team, players, validation, otherTeams: teams.filter((t) => t.id !== team.id).map(teamSummary) };
}

function teamSummary(team) {
  return {
    id: team.id,
    name: team.name,
    program: team.program,
    category: team.category,
    gender: team.gender,
    division: team.division,
    teamName: team.teamName,
    coachName: team.coachName,
    coachLic: team.coachLic,
    state: team.state,
    playerCount: team.playerCount,
    completion: team.completion,
    total: team.total,
    amountPaid: team.amountPaid,
    adminFeedback: team.adminFeedback,
    submittedOn: team.submittedOn,
    paymentPlan: team.paymentPlan,
  };
}

function uniformSummary(team, players) {
  const count = (key) => {
    const map = new Map();
    for (const p of players) if (p[key]) map.set(p[key], (map.get(p[key]) || 0) + 1);
    return Array.from(map, ([size, n]) => `${size} × ${n}`).join(", ") || "—";
  };
  const lines = [
    `Camisetas: ${count("x_shirt_size")}`,
    `Pantalones: ${count("x_pants_size")}`,
    `Uniformes: ${players.length} (ACB provee ${UNIFORMS_INCLUDED}; adicionales: ${Math.max(0, players.length - UNIFORMS_INCLUDED)})`,
  ];
  const shorts = [];
  if (team.x_coach_shorts) shorts.push(`Dirigente cintura ${team.x_coach_waist || "?"}`);
  if (team.x_asst_shorts) shorts.push(`Asistente cintura ${team.x_asst_waist || "?"}`);
  if (shorts.length) lines.push(`Pantalón corto dirigentes: ${shorts.join("; ")}`);
  return lines.join("\n");
}

// ------------------------------------------------------- club directory
// Public list behind the "Mi club" search: name, town and progress counts
// only. Contact data never leaves the server and the access email is masked.
const DIRECTORY_TTL_MS = 15_000;
let directoryCache = { at: 0, clubs: null };
const invalidateDirectory = () => {
  directoryCache = { at: 0, clubs: null };
};

async function buildDirectory() {
  const fields = Array.from(new Set([...CLUB_READ.map((f) => f.name), "x_court_dates"]));
  const rows = await odoo.searchRead(CLUB.model, [["x_state", "!=", "blocked"]], fields, { order: "x_name asc" });
  const ids = rows.map((r) => r.id);
  const teams = ids.length ? await odoo.searchRead(TEAM.model, [["x_club_id", "in", ids]], ["x_club_id", "x_state"]) : [];
  const counts = new Map();
  for (const team of teams) {
    const clubId = Array.isArray(team.x_club_id) ? team.x_club_id[0] : team.x_club_id;
    const c = counts.get(clubId) || { total: 0, draft: 0, changes: 0, submitted: 0, approved: 0 };
    c.total += 1;
    if (team.x_state in c) c[team.x_state] += 1;
    counts.set(clubId, c);
  }
  return rows.map((row) => {
    const club = fromOdoo(CLUB_READ, row);
    const { errors, warnings } = validateClub(club);
    return {
      id: club.id,
      name: club.name,
      acronym: club.acronym || "",
      municipality: club.municipality || "",
      state: club.state,
      review: club.review || "new",
      emailHint: maskEmail(club.email),
      // Only what is missing (never the values), so a club can see what to complete.
      profile: { missing: errors.length, recommended: warnings.length, items: [...errors, ...warnings].map((i) => i.message) },
      teams: counts.get(club.id) || { total: 0, draft: 0, changes: 0, submitted: 0, approved: 0 },
    };
  });
}

async function handleClubDirectory(req) {
  rateLimit(`directory:${clientIp(req)}`, 120, 600_000);
  if (!directoryCache.clubs || Date.now() - directoryCache.at > DIRECTORY_TTL_MS) {
    directoryCache = { at: Date.now(), clubs: await buildDirectory() };
  }
  return { clubs: directoryCache.clubs };
}

async function handleClubCode(req, clubId) {
  const id = Number(clubId);
  rateLimit(`login:${clientIp(req)}`, 8, 600_000);
  rateLimit(`login-club:${id}`, 4, 600_000);
  const [club] =
    Number.isInteger(id) && id > 0
      ? await odoo.searchRead(CLUB.model, [["id", "=", id], ["x_state", "!=", "blocked"]], ["id", "x_state", "x_email", "x_name"], { limit: 1 })
      : [];
  if (!club || !club.x_email) throw new HttpError(404, "No encontramos ese club. Búsquelo de nuevo en la lista.");
  rateLimit(`login-email:${club.x_email}`, 4, 600_000);
  await sendLoginCode(req, club);
  return { ok: true, emailHint: maskEmail(club.x_email) };
}

// ------------------------------------------------------------- handlers
async function handleRegister(req, body) {
  rateLimit(`register:${clientIp(req)}`, 6, 3600_000);
  if (body.hp) return { ok: true, next: "verify" }; // honeypot
  const email = clean(body.email, 120).toLowerCase();
  if (!isEmail(email)) throw new HttpError(422, "Escriba un email válido para el acceso del club.");
  if (!body.acceptTerms) throw new HttpError(422, "Debe aceptar los términos de la ACB para continuar.");
  const data = body.club || {};
  const { errors } = validateClub(data);
  if (errors.length) throw new HttpError(422, errors[0].message, { errors });

  const values = toOdoo(CLUB, data);
  values.x_court_dates_text = courtDatesText(values.x_court_dates);
  const [existing] = await odoo.searchRead(CLUB.model, [["x_email", "=", email]], ["id", "x_state", "x_email", "x_name"], { limit: 1 });
  const key = normName(values.x_name);
  const others = await odoo.searchRead(CLUB.model, [["x_state", "!=", "blocked"], ["x_email", "!=", email]], ["id", "x_name"]);
  const sameName = others.find((row) => normName(row.x_name) === key);
  if (sameName) {
    throw new HttpError(409, `«${sameName.x_name}» ya está registrado en el portal. Búsquelo en la lista y entre con el código que enviamos al email del club.`, {
      clubId: sameName.id,
    });
  }
  let club = existing;
  if (!existing) {
    const id = await odoo.create(CLUB.model, {
      ...values,
      x_email: email,
      x_state: "pending",
      x_review: "new",
      x_terms_accepted: true,
      x_terms_accepted_on: odooDateTime(now()),
      x_session_version: 0,
    });
    club = { id, x_email: email, x_name: values.x_name, x_state: "pending" };
    if (NOTIFY_EMAIL) {
      const row = (label, value) => (value ? `<tr><td style="padding:4px 12px 4px 0;color:#5b6483">${label}</td><td style="padding:4px 0"><b>${escapeHtml(value)}</b></td></tr>` : "");
      sendMail({
        to: NOTIFY_EMAIL,
        subject: `[ACB 2027] Nueva solicitud de club: ${values.x_name}`,
        html: emailLayout(
          "Nueva solicitud de club",
          `<table style="font-size:14px;border-collapse:collapse">${row("Club", values.x_name)}${row("Municipio", values.x_municipality)}${row("Presidente", values.x_president_name)}${row("Contacto", values.x_contact_name)}${row("Teléfono", values.x_contact_phone || values.x_phone)}${row("Email de acceso", email)}</table>
           <p style="font-size:13px;color:#5b6483;margin-top:16px">Revísela en Odoo → ACB Inscripciones → Clubes (filtro «Solicitudes nuevas») y márquela como «Verificado por la ACB».</p>`,
          req,
        ),
      }).catch((error) => console.warn("[mail] ACB notice:", error.message));
    }
  } else if (existing.x_state === "pending") {
    await odoo.write(CLUB.model, [existing.id], { ...values, x_terms_accepted: true, x_terms_accepted_on: odooDateTime(now()) });
    club = { ...existing, x_name: values.x_name || existing.x_name };
  }
  invalidateDirectory();
  if (club.x_state !== "blocked") await sendLoginCode(req, club);
  return { ok: true, next: "verify", email };
}

async function handleLoginRequest(req, body) {
  const email = clean(body.email, 120).toLowerCase();
  rateLimit(`login:${clientIp(req)}`, 8, 600_000);
  rateLimit(`login-email:${email}`, 4, 600_000);
  if (!isEmail(email)) throw new HttpError(422, "Escriba un email válido.");
  const [club] = await odoo.searchRead(CLUB.model, [["x_email", "=", email]], ["id", "x_state", "x_email", "x_name"], { limit: 1 });
  if (club && club.x_state !== "blocked") await sendLoginCode(req, club);
  // Same answer whether or not the email exists.
  return { ok: true };
}

async function handleLoginVerify(req, body, res) {
  rateLimit(`verify:${clientIp(req)}`, 15, 600_000);
  const clubId = Number(body.clubId);
  const byId = Number.isInteger(clubId) && clubId > 0;
  const email = byId ? "" : clean(body.email, 120).toLowerCase();
  const code = String(body.code || "").replace(/\D/g, "");
  const invalid = new HttpError(400, "Código inválido o vencido. Solicite uno nuevo.");
  if ((!byId && !isEmail(email)) || code.length !== 6) throw invalid;
  const [club] = await odoo.searchRead(
    CLUB.model,
    byId ? [["id", "=", clubId]] : [["x_email", "=", email]],
    ["id", "x_state", "x_login_hash", "x_login_expiry", "x_login_attempts", "x_session_version", "x_name"],
    { limit: 1 },
  );
  if (!club || club.x_state === "blocked" || !club.x_login_hash) throw invalid;
  const expired = !club.x_login_expiry || new Date(fromOdooDateTime(club.x_login_expiry)) < now();
  if (expired || (club.x_login_attempts || 0) >= MAX_CODE_ATTEMPTS) throw invalid;
  if (!safeEqual(codeHash(club.id, code), club.x_login_hash)) {
    await odoo.write(CLUB.model, [club.id], { x_login_attempts: (club.x_login_attempts || 0) + 1 });
    throw invalid;
  }
  await odoo.write(CLUB.model, [club.id], {
    x_login_hash: false,
    x_login_expiry: false,
    x_login_attempts: 0,
    x_last_login: odooDateTime(now()),
    x_state: "active",
  });
  sessionCache.delete(club.id);
  invalidateDirectory();
  res.setHeader("Set-Cookie", issueSession(req, club));
  return { ok: true, clubName: club.x_name };
}

async function handleMe(req) {
  const clubId = await requireClub(req);
  const [club, teams] = await Promise.all([loadClub(clubId), loadTeams(clubId)]);
  return { club, teams: teams.map(teamSummary), clubValidation: validateClub(club) };
}

async function handleUpdateClub(req, body) {
  const clubId = await requireClub(req);
  const values = toOdoo(CLUB, body.club || {});
  if ("x_name" in values && !values.x_name) throw new HttpError(422, "El nombre del club es requerido.");
  if ("x_court_dates" in values) values.x_court_dates_text = courtDatesText(values.x_court_dates);
  if (Object.keys(values).length) await odoo.write(CLUB.model, [clubId], values);
  invalidateDirectory();
  const club = await loadClub(clubId);
  return { club, clubValidation: validateClub(club) };
}

async function handleCreateTeam(req, body) {
  const clubId = await requireClub(req);
  const count = await odoo.searchCount(TEAM.model, [["x_club_id", "=", clubId]]);
  if (count >= MAX_TEAMS_PER_CLUB) throw new HttpError(422, "Su club alcanzó el máximo de equipos permitidos en el portal.");
  const values = toOdoo(TEAM, {
    program: body.program,
    category: body.category,
    gender: body.gender,
    division: body.division,
    teamName: body.teamName,
  });
  if (!values.x_program || !values.x_category || !values.x_gender) {
    throw new HttpError(422, "Seleccione programa, categoría y rama.");
  }
  const club = await loadClub(clubId);
  const team = { program: values.x_program, category: values.x_category, gender: values.x_gender, division: values.x_division };
  const costs = teamCosts(team, 0, 0);
  const id = await odoo.create(TEAM.model, {
    ...values,
    x_club_id: clubId,
    x_name: `${club.acronym || club.name} · ${teamLabel(team)}`,
    x_state: "draft",
    x_schedule_pref: "none",
    x_payment_plan: "deposit",
    x_fee: costs.base,
    x_total: costs.total,
    x_player_count: 0,
    x_completion: 0,
  });
  return { id };
}

async function handleGetTeam(req, teamId) {
  const clubId = await requireClub(req);
  const team = await loadTeamOwned(clubId, teamId);
  return teamPayload(clubId, team);
}

function assertEditable(team) {
  if (team.state === "submitted") throw new HttpError(409, "Este equipo fue enviado. Retire el envío para editarlo.");
  if (team.state === "approved") throw new HttpError(409, "Este equipo ya fue aprobado por la ACB. Comuníquese con la ACB para cambios.");
}

async function handleSaveTeam(req, teamId, body) {
  const clubId = await requireClub(req);
  const team = await loadTeamOwned(clubId, teamId);
  assertEditable(team);

  const incoming = Array.isArray(body.players) ? body.players.slice(0, MAX_PLAYERS + 1) : null;
  if (incoming && incoming.length > MAX_PLAYERS) throw new HttpError(422, `Máximo ${MAX_PLAYERS} jugadores por equipo.`);

  const values = toOdoo(TEAM, body.team || {});
  const merged = {
    program: values.x_program ?? team.program,
    category: values.x_category ?? team.category,
    gender: values.x_gender ?? team.gender,
    division: values.x_division === undefined ? team.division : values.x_division || "",
  };

  const existing = await odoo.searchRead(
    PLAYER.model,
    [["x_team_id", "=", team.id]],
    ["id", "x_consent", "x_consent_on", "x_shirt_size", "x_pants_size"],
  );
  const existingById = new Map(existing.map((p) => [p.id, p]));
  let playerRows = existing;

  if (incoming) {
    const commands = [];
    const keep = new Set();
    playerRows = [];
    incoming.forEach((raw, index) => {
      const vals = toOdoo(PLAYER, raw || {});
      vals.x_sequence = index + 1;
      vals.x_name = `${vals.x_first_name || ""} ${vals.x_last_name || ""}`.trim() || false;
      vals.x_eligibility = eligibility(vals.x_birthdate || "", merged.category).message;
      const current = existingById.get(Number(raw?.id));
      if (vals.x_consent && vals.x_consent_name) {
        vals.x_consent_on = current?.x_consent && current?.x_consent_on ? current.x_consent_on : odooDateTime(now());
      } else {
        vals.x_consent = false;
        vals.x_consent_on = false;
      }
      if (current) {
        keep.add(current.id);
        commands.push([1, current.id, vals]);
      } else {
        commands.push([0, 0, vals]);
      }
      playerRows.push(vals);
    });
    for (const p of existing) if (!keep.has(p.id)) commands.push([2, p.id]);
    values.x_player_ids = commands;
  }

  const teamForCost = {
    x_coach_shorts: values.x_coach_shorts ?? team.coachShorts,
    x_coach_waist: values.x_coach_waist ?? team.coachWaist,
    x_asst_shorts: values.x_asst_shorts ?? team.asstShorts,
    x_asst_waist: values.x_asst_waist ?? team.asstWaist,
  };
  const shorts = (teamForCost.x_coach_shorts ? 1 : 0) + (teamForCost.x_asst_shorts ? 1 : 0);
  const costs = teamCosts(merged, playerRows.length, shorts);
  const club = await loadClub(clubId);
  Object.assign(values, {
    x_name: `${club.acronym || club.name} · ${teamLabel(merged)}${(values.x_team_name ?? team.teamName) ? ` · ${values.x_team_name ?? team.teamName}` : ""}`,
    x_fee: costs.base,
    x_extra_fee: costs.extraFee,
    x_shorts_fee: costs.shortsFee,
    x_total: costs.total,
    x_player_count: playerRows.length,
    x_uniform_summary: uniformSummary(teamForCost, playerRows),
  });

  await odoo.write(TEAM.model, [team.id], values);
  const fresh = await loadTeamOwned(clubId, team.id);
  const payload = await teamPayload(clubId, fresh);
  const pct = completion(payload.validation);
  if (pct !== fresh.completion) {
    await odoo.write(TEAM.model, [team.id], { x_completion: pct });
    payload.team.completion = pct;
  }
  return payload;
}

async function handleSubmitTeam(req, teamId, body) {
  const clubId = await requireClub(req);
  const team = await loadTeamOwned(clubId, teamId);
  assertEditable(team);
  const certifyName = clean(body.certifyName, 120);
  if (!body.certify || certifyName.length < 4) {
    throw new HttpError(422, "Escriba su nombre y marque la certificación de la Regla 3 para enviar.");
  }
  const payload = await teamPayload(clubId, team);
  if (payload.validation.errors.length) {
    throw new HttpError(422, "El equipo tiene información pendiente.", { validation: payload.validation });
  }
  await odoo.write(TEAM.model, [team.id], {
    x_state: "submitted",
    x_submitted_on: odooDateTime(now()),
    x_certify: true,
    x_certify_name: certifyName,
    x_certify_on: odooDateTime(now()),
    x_completion: 100,
  });
  const club = await loadClub(clubId);
  const summary = `<table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 0;color:#5b6483">Club</td><td style="padding:6px 0"><b>${escapeHtml(club.name)}</b></td></tr>
    <tr><td style="padding:6px 0;color:#5b6483">Equipo</td><td style="padding:6px 0"><b>${escapeHtml(team.name)}</b></td></tr>
    <tr><td style="padding:6px 0;color:#5b6483">Dirigente</td><td style="padding:6px 0">${escapeHtml(team.coachName)} · ${escapeHtml(team.coachPhone)}</td></tr>
    <tr><td style="padding:6px 0;color:#5b6483">Jugadores</td><td style="padding:6px 0">${payload.players.length}</td></tr>
    <tr><td style="padding:6px 0;color:#5b6483">Total estimado</td><td style="padding:6px 0">$${Number(team.total || 0).toLocaleString("en-US")}</td></tr>
    <tr><td style="padding:6px 0;color:#5b6483">Certificado por</td><td style="padding:6px 0">${escapeHtml(certifyName)}</td></tr>
  </table>`;
  const tasks = [
    sendMail({
      to: club.email,
      subject: `Equipo enviado: ${team.name}`,
      html: emailLayout(
        "¡Equipo enviado a la ACB!",
        `<p style="font-size:15px;line-height:1.5">Recibimos la inscripción de su equipo. La ACB revisará la información y le notificará cualquier cambio en el portal.</p>${summary}
         <p style="font-size:14px;line-height:1.5;margin-top:18px"><b>Próximo paso:</b> imprima la Hoja de Uniformes, la Lista Oficial de Jugadores, el Carnet y el Roster desde el portal y llévelos con los certificados de nacimiento ORIGINALES el sábado 23 de enero de 2027 (1:00 – 4:00 PM) al Colegio Universitario de San Juan.</p>`,
        req,
      ),
    }),
  ];
  if (NOTIFY_EMAIL) {
    tasks.push(
      sendMail({
        to: NOTIFY_EMAIL,
        subject: `[ACB 2027] Nuevo equipo enviado: ${team.name}`,
        html: emailLayout("Nuevo equipo para revisión", `${summary}<p style="font-size:13px;color:#5b6483">Revíselo en Odoo → ACB Inscripciones → Equipos.</p>`, req),
      }),
    );
  }
  await Promise.allSettled(tasks);
  return { ok: true };
}

async function handleReopenTeam(req, teamId) {
  const clubId = await requireClub(req);
  const team = await loadTeamOwned(clubId, teamId);
  if (team.state === "approved") throw new HttpError(409, "Este equipo ya fue aprobado. Comuníquese con la ACB para cambios.");
  if (team.state === "submitted") await odoo.write(TEAM.model, [team.id], { x_state: "draft", x_certify: false });
  return { ok: true };
}

async function handleDeleteTeam(req, teamId) {
  const clubId = await requireClub(req);
  const team = await loadTeamOwned(clubId, teamId);
  if (team.state === "submitted" || team.state === "approved") {
    throw new HttpError(409, "Solo puede eliminar equipos en borrador.");
  }
  // Delete players through the ORM first: a database-level cascade would leave
  // their birth certificates and photos behind as orphaned attachments.
  const playerIds = (await odoo.searchRead(PLAYER.model, [["x_team_id", "=", team.id]], ["id"])).map((p) => p.id);
  if (playerIds.length) await odoo.unlink(PLAYER.model, playerIds);
  await odoo.unlink(TEAM.model, [team.id]);
  return { ok: true };
}

// --------------------------------------------------------------- files
function sniff(buffer) {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 4).toString("latin1") === "%PDF") return { kind: "pdf", mime: "application/pdf", ext: "pdf" };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: "image", mime: "image/png", ext: "png" };
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return { kind: "image", mime: "image/webp", ext: "webp" };
  const brand = buffer.subarray(4, 12).toString("latin1");
  if (/^ftyp(heic|heix|mif1|msf1|hevc)/.test(brand)) return { kind: "image", mime: "image/heic", ext: "heic" };
  return null;
}

async function resolveFileTarget(clubId, owner, id, field) {
  const spec = FILE_FIELDS[owner]?.[field];
  if (!spec) throw new HttpError(404, "Archivo no permitido.");
  const recordId = Number(id);
  if (!Number.isInteger(recordId) || recordId <= 0) throw new HttpError(404, "Registro no encontrado.");
  if (owner === "club") {
    if (recordId !== clubId) throw new HttpError(404, "Registro no encontrado.");
    return { model: CLUB.model, id: recordId, spec, team: null };
  }
  if (owner === "team") {
    const team = await loadTeamOwned(clubId, recordId);
    return { model: TEAM.model, id: recordId, spec, team };
  }
  const [player] = await odoo.searchRead(PLAYER.model, [["id", "=", recordId]], ["x_team_id"], { limit: 1 });
  if (!player?.x_team_id) throw new HttpError(404, "Registro no encontrado.");
  const team = await loadTeamOwned(clubId, player.x_team_id[0]);
  return { model: PLAYER.model, id: recordId, spec, team };
}

async function handleUploadFile(req, owner, id, field, body) {
  const clubId = await requireClub(req);
  rateLimit(`upload:${clubId}`, 120, 600_000);
  const target = await resolveFileTarget(clubId, owner, id, field);
  if (target.team) assertEditable(target.team);
  const data = String(body.data || "").replace(/^data:[^,]*,/, "");
  const buffer = Buffer.from(data, "base64");
  if (!buffer.length) throw new HttpError(422, "Archivo vacío.");
  if (buffer.length > MAX_FILE_BYTES) throw new HttpError(413, "El archivo excede 8 MB. Use una foto o PDF más liviano.");
  const type = sniff(buffer);
  if (!type || !target.spec.kinds.includes(type.kind)) {
    throw new HttpError(422, target.spec.kinds.includes("pdf") ? "Suba una imagen (JPG, PNG, HEIC) o un PDF." : "Suba una imagen JPG o PNG.");
  }
  const base = clean(body.name, 80).replace(/\.[a-z0-9]+$/i, "").replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]/g, "") || field.replace(/^x_/, "");
  const name = `${base}.${type.ext}`;
  await odoo.write(target.model, [target.id], { [field]: buffer.toString("base64"), [target.spec.nameField]: name });
  return { ok: true, name };
}

async function handleDeleteFile(req, owner, id, field) {
  const clubId = await requireClub(req);
  const target = await resolveFileTarget(clubId, owner, id, field);
  if (target.team) assertEditable(target.team);
  await odoo.write(target.model, [target.id], { [field]: false, [target.spec.nameField]: false });
  return { ok: true };
}

async function handleDownloadFile(req, res, owner, id, field) {
  const clubId = await requireClub(req);
  const target = await resolveFileTarget(clubId, owner, id, field);
  const [record] = await odoo.read(target.model, [target.id], [field, target.spec.nameField]);
  const data = record?.[field];
  if (!data) throw new HttpError(404, "Sin archivo.");
  const buffer = Buffer.from(data, "base64");
  const type = sniff(buffer) || { mime: "application/octet-stream" };
  const filename = String(record[target.spec.nameField] || "archivo").replace(/[^\w.\- ]/g, "_");
  res.writeHead(200, {
    "Content-Type": type.mime,
    "Content-Length": buffer.length,
    "Content-Disposition": `inline; filename="${filename}"`,
    "Cache-Control": "private, max-age=60",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(buffer);
}

// --------------------------------------------------------------- static
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};
const assetCache = new Map();

async function serveStatic(req, res) {
  let urlPath = (req.url || "/").split("?")[0];
  try {
    urlPath = decodeURIComponent(urlPath);
  } catch {
    /* keep raw */
  }
  const relative = normalize(urlPath).replace(/^([/\\]|\.\.([/\\]|$))+/, "");
  let file = join(DIST, relative);
  if (!file.startsWith(DIST + sep) && file !== DIST) file = join(DIST, "index.html");
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(DIST, "index.html");
  }
  try {
    let cached = assetCache.get(file);
    if (!cached) {
      const data = await readFile(file);
      const zippable = /\.(html|js|css|json|svg|webmanifest)$/.test(file) && data.length > 1024;
      cached = { data, gz: zippable ? await compress(data) : null };
      if (assetCache.size < 200) assetCache.set(file, cached);
    }
    const useGz = cached.gz && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
    const body = useGz ? cached.gz : cached.data;
    res.writeHead(200, {
      "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": body.length,
      Vary: "Accept-Encoding",
      ...(useGz ? { "Content-Encoding": "gzip" } : {}),
      "Cache-Control": file.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

// --------------------------------------------------------------- router
async function readJson(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "La solicitud es demasiado grande.");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const routes = [
  ["GET", /^\/api\/health$/, async () => ({ ok: true, programs: PROGRAMS.length })],
  ["GET", /^\/api\/clubs$/, (req) => handleClubDirectory(req)],
  ["POST", /^\/api\/clubs\/(\d+)\/code$/, (req, _b, _r, m) => handleClubCode(req, m[1])],
  ["POST", /^\/api\/register$/, (req, body) => handleRegister(req, body)],
  ["POST", /^\/api\/login\/request$/, (req, body) => handleLoginRequest(req, body)],
  ["POST", /^\/api\/login\/verify$/, (req, body, res) => handleLoginVerify(req, body, res)],
  ["POST", /^\/api\/logout$/, async (req, _body, res) => {
    res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
    return { ok: true };
  }],
  ["GET", /^\/api\/me$/, (req) => handleMe(req)],
  ["PUT", /^\/api\/club$/, (req, body) => handleUpdateClub(req, body)],
  ["POST", /^\/api\/teams$/, (req, body) => handleCreateTeam(req, body)],
  ["GET", /^\/api\/teams\/(\d+)$/, (req, _b, _r, m) => handleGetTeam(req, m[1])],
  ["PUT", /^\/api\/teams\/(\d+)$/, (req, body, _r, m) => handleSaveTeam(req, m[1], body)],
  ["DELETE", /^\/api\/teams\/(\d+)$/, (req, _b, _r, m) => handleDeleteTeam(req, m[1])],
  ["POST", /^\/api\/teams\/(\d+)\/submit$/, (req, body, _r, m) => handleSubmitTeam(req, m[1], body)],
  ["POST", /^\/api\/teams\/(\d+)\/reopen$/, (req, _b, _r, m) => handleReopenTeam(req, m[1])],
  ["PUT", /^\/api\/files\/(club|team|player)\/(\d+)\/(x_[a-z_]+)$/, (req, body, _r, m) => handleUploadFile(req, m[1], m[2], m[3], body)],
  ["DELETE", /^\/api\/files\/(club|team|player)\/(\d+)\/(x_[a-z_]+)$/, (req, _b, _r, m) => handleDeleteFile(req, m[1], m[2], m[3])],
  ["GET", /^\/api\/files\/(club|team|player)\/(\d+)\/(x_[a-z_]+)$/, async (req, _b, res, m) => {
    await handleDownloadFile(req, res, m[1], m[2], m[3]);
    return undefined;
  }],
];

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), payment=()",
};

const server = createServer(async (req, res) => {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
  if (isHttps(req)) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  const path = (req.url || "/").split("?")[0];

  if (!path.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    await serveStatic(req, res);
    return;
  }

  try {
    const route = routes.find(([method, pattern]) => method === req.method && pattern.test(path));
    if (!route) throw new HttpError(404, "Ruta no encontrada.");
    if (req.method !== "GET" && req.headers["x-requested-with"] !== "acb-portal") {
      throw new HttpError(403, "Solicitud no permitida.");
    }
    rateLimit(`api:${clientIp(req)}`, 400, 60_000);
    const isUpload = path.startsWith("/api/files/");
    const body = req.method === "GET" || req.method === "DELETE" ? {} : await readJson(req, isUpload ? 12 * 1024 * 1024 : 1024 * 1024);
    const result = await route[2](req, body, res, path.match(route[1]));
    if (result !== undefined && !res.headersSent) sendJson(res, 200, result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error?.status === 429 ? 503 : 500;
    if (status >= 500) console.error("[api]", req.method, path, error?.message || error);
    if (!res.headersSent) {
      sendJson(res, status, {
        error: status >= 500 && !(error instanceof HttpError) ? "Error del servidor. Intente de nuevo en unos segundos." : error.message,
        ...(error.extra || {}),
      });
    } else {
      res.destroy();
    }
  }
});

server.listen(PORT, () => {
  console.log(`[acb-portal] listening on :${PORT}${DEV_CODES ? " (DEV_LOGIN_CODES: codes printed, no emails)" : ""}`);
});
