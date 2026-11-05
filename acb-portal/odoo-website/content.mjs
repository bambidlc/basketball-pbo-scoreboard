// Page content for the ACB website (Odoo website #2).
// Every page is generated as XHTML (Odoo QWeb arch must be well-formed XML)
// from the same tournament data the registration portal uses, so dates,
// fees and rules never drift between the website and the portal.

import { heroHtml, tickerHtml, PILL_SHIFT } from "../shared/hero.js";
import {
  ADULT_SIZES,
  CALENDAR,
  CATEGORIES,
  COACH_SHORTS_FEE,
  DEPOSIT_PER_TEAM,
  EXTRA_UNIFORM_FEE,
  FEE_BRACKETS,
  KEY_DATES,
  KID_SIZES,
  MAX_PLAYERS,
  RULES,
  UNIFORMS_INCLUDED,
  categoryBirthYear,
  formatDateShort,
  money,
} from "../shared/tournament.js";

export const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ------------------------------------------------------------------ icons
// Lucide icons (ISC license), inlined so the site needs no icon font.
const ICONS = {
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  check: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 14l2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1ZM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1ZM7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  table: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18M3 9h18M3 15h18"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  dollar: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  ball: '<circle cx="12" cy="12" r="10"/><path d="M4.93 4.93c4.08 2.38 8.25 6.67 9.83 14.6M19.07 4.93c-4.08 2.38-8.25 6.67-9.83 14.6M2 12h20M12 2v20"/>',
  bracket: '<path d="M3 4h5v6h5M3 20h5v-6M13 10v4h8M13 14H8"/>',
};
const icon = (name) =>
  `<svg class="acbw-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;

// ------------------------------------------------------------------ navigation
// Same twelve buttons, in the same order, as the classic acbpr.com banner.
export const LEFT_PILLS = [
  { label: "Itinerarios", href: "/itinerarios" },
  { label: "Tabla de posiciones", href: "/tabla-de-posiciones" },
  { label: "Cuartos de final", href: "/cuartos-de-final" },
  { label: "Todos VS Todos", href: "/todos-vs-todos" },
  { label: "Secciones y Divisiones", href: "/secciones-y-divisiones" },
  { label: "Canchas", href: "/canchas" },
];
export const RIGHT_PILLS = [
  { label: "Campeones", href: "/campeones" },
  { label: "Resoluciones", href: "/resoluciones" },
  { label: "Directiva", href: "/directiva" },
  { label: "Documentos", href: "/documentos" },
  { label: "Reglamento", href: "/reglamento" },
  { label: "Fotos", href: "/fotos" },
];
const TOP_NAV = [
  { label: "Inicio", href: "/" },
  { label: "Inscripción 2027", href: "/inscripcion" },
  { label: "Calendario", href: "/itinerarios" },
  { label: "Canchas", href: "/canchas" },
  { label: "Documentos", href: "/documentos" },
  { label: "Contacto", href: "/contacto" },
];

const TICKER = [
  "Inscripción de equipos: sábados 12 y 19 de diciembre de 2026 · Club de Baloncesto Fraigcomar",
  "Nuevo: inscriba su club y sus equipos en línea en el Portal de Inscripción ACB",
  "Inicio del Torneo #30: sábado 6 de febrero de 2027",
  "Fechas de cancha y acomodos de dirigentes: antes del 30 de diciembre",
  "Entrega de uniformes y documentos: sábado 23 de enero de 2027",
];

export const DIRECTIVA = [
  { role: "Presidente", name: "Lic. Miguel Laborde Freyre", phone: "787-462-3842", initials: "ML" },
  { role: "Director Ejecutivo", name: 'Prof. Roberto "Bobby" Ramírez', phone: "787-632-4848", email: "bobbyramirez48@yahoo.com", initials: "RR" },
  { role: "Administrador", name: "Julio Betancurt", phone: "787-370-4145", email: "julio89_@hotmail.com", initials: "JB" },
];

const FACEBOOK_URL = "https://www.facebook.com/LigaACBPR/";

// ------------------------------------------------------------------ helpers
const telHref = (phone) => `tel:+1${String(phone).replace(/\D/g, "")}`;
const monthShort = (iso) => ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(iso.slice(5, 7)) - 1];

function band(inner, tone = "", id = "") {
  return `<section class="acbw-band${tone ? ` acbw-band--${tone}` : ""}"${id ? ` id="${id}"` : ""}><div class="acbw-wrap">${inner}</div></section>`;
}

function head(eyebrow, title, lead = "", side = "") {
  return `<div class="acbw-head"><div><p class="acbw-eyebrow">${eyebrow}</p><h2 class="acbw-h2">${title}</h2>${lead ? `<p class="acbw-lead">${lead}</p>` : ""}</div>${side}</div>`;
}

function docLink({ href, title, sub, iconName = "file", orange = false, external = false, archive = false }) {
  const attrs = external ? ' target="_blank" rel="noopener"' : "";
  return `<li><a class="acbw-doc" href="${esc(href)}"${attrs}><span class="acbw-doc__icon${orange ? " acbw-doc__icon--orange" : ""}">${icon(iconName)}</span><span class="acbw-doc__body"><b>${esc(title)}${archive ? '<span class="acbw-archive-tag">ARCHIVO</span>' : ""}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</span><span class="acbw-doc__go">${icon(external ? "external" : href.startsWith("/web/content") ? "download" : "arrow")}</span></a></li>`;
}

function notice(title, text, warm = false) {
  return `<div class="acbw-notice${warm ? " acbw-notice--warm" : ""}">${icon("info")}<div><b>${title}</b>${text}</div></div>`;
}

// ------------------------------------------------------------------ shared sections
function sectionFees() {
  const fees = FEE_BRACKETS.map(
    (b) => `<div class="acbw-fee"><div class="acbw-fee__cat">${b.from} – ${b.to}<small>AÑOS</small></div><div class="acbw-fee__amt">${money(b.fee)}</div></div>`,
  ).join("");
  return band(
    `${head("Costos de inscripción", "Inscripción <em>por equipo</em>", "", '<span class="acbw-badge">★ Se mantienen los mismos costos del pasado torneo</span>')}
    <div class="acbw-fees">${fees}</div>
    <div class="acbw-includes"><div class="acbw-include acbw-include--orange">${icon("ball")} Incluye un balón</div><div class="acbw-include acbw-include--blue">${icon("check")} Mínimo 8 juegos garantizados</div></div>
    <p class="acbw-note">Adicionales: uniforme #13 ${money(EXTRA_UNIFORM_FEE)} · pantalón corto para dirigentes ${money(COACH_SHORTS_FEE)} · depósito para separar el equipo ${money(DEPOSIT_PER_TEAM)}. Pago final: 23 de enero de 2027.</p>`,
    "dark",
    "costos",
  );
}

function timeline() {
  const items = KEY_DATES.map(
    (d) => `<li><div class="acbw-date"><b>${Number(d.date.slice(8, 10))}</b><span>${monthShort(d.date)}</span></div><div><h3>${esc(d.title)}</h3><div class="when">${esc(d.when)}</div><div class="where">${icon("pin")} ${esc(d.where)}</div><p>${esc(d.detail)}</p></div></li>`,
  ).join("");
  return `<ul class="acbw-timeline">${items}</ul>`;
}

function sectionKeyDates(tone = "white") {
  return band(`${head("Agenda", "Fechas <em>clave</em>")}${timeline()}`, tone, "fechas");
}

function calendarCards(filter = () => true) {
  return `<div class="acbw-cal">${CALENDAR.map((g) => {
    const phases = g.phases.filter(filter);
    if (!phases.length) return "";
    return `<div class="acbw-card"><div class="acbw-h3" style="color: var(--acb-blue-600)">${esc(g.group)}</div>${phases
      .map(
        (p) =>
          `<div class="acbw-cal__phase"><b>${esc(p.phase)}</b><div class="acbw-days">${p.dates.map((d) => `<span>${esc(formatDateShort(d))}</span>`).join("")}</div>${p.note ? `<div class="acbw-cal__note">${esc(p.note)}</div>` : ""}</div>`,
      )
      .join("")}</div>`;
  }).join("")}</div>`;
}

function sectionEligibility(tone = "dark") {
  const tiles = CATEGORIES.map((c) => `<div class="acbw-cat"><b>${c}</b><span>Nacidos en ${categoryBirthYear(c)}</span></div>`).join("");
  return band(
    `${head("Torneo ACB 2027", "Fecha de elegibilidad <em>por categorías</em>", "Cada categoría corresponde al año de nacimiento: un jugador nacido en ese año o después es elegible. Un jugador puede jugar en una categoría superior, nunca en una menor.")}<div class="acbw-cats">${tiles}</div>`,
    tone,
    "elegibilidad",
  );
}

function sectionUniforms(tone = "white") {
  const rows = KID_SIZES.map((k, i) => `<tr><td><b>${esc(k.label.split(" · ")[0])}</b></td><td>${esc(k.label.split(" · ")[1])}</td><td><b>${esc(ADULT_SIZES[i].label)}</b></td></tr>`).join("");
  return band(
    `${head("Formulario para uniformes 2027", "Uniformes <em>y tallas</em>")}
    <div class="acbw-grid acbw-grid--2">
      <div class="acbw-card"><div class="acbw-h3">Lo que incluye</div><ul class="acbw-list">
        <li>ACB provee ${UNIFORMS_INCLUDED} uniformes por equipo (camiseta y pantalón).</li>
        <li>Uniforme #13: ${money(EXTRA_UNIFORM_FEE)} y debe estar en el formulario inicial.</li>
        <li>Pantalón corto para dirigentes: ${money(COACH_SHORTS_FEE)} (indique el tamaño de cintura).</li>
        <li>Colores: camiseta, letras y números, y pantalón.</li>
        <li class="is-alert">${esc(RULES.uniforms)}</li>
      </ul></div>
      <div><div class="acbw-table-wrap"><table class="acbw-table"><thead><tr><th>Niños</th><th>Edad aprox.</th><th>Adulto</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="acbw-muted acbw-small" style="margin-top:12px">En el Portal de Inscripción cada jugador tiene su talla de camiseta y pantalón; la Hoja de Uniformes se genera con el resumen por talla.</p></div>
    </div>`,
    tone,
    "uniformes",
  );
}

function sectionRequirements(tone = "") {
  return band(
    `${head("Inscripción ACB Regular y ACB Alternativo", "Requisitos <em>2027</em>")}
    <div class="acbw-grid acbw-grid--2">
      <div class="acbw-card acbw-card--orange">
        <p class="acbw-eyebrow">Inscripción presencial</p>
        <div class="acbw-h2" style="font-size: clamp(30px, 4vw, 44px); color:#fff">Sábados<br/>12 y 19 de diciembre 2026</div>
        <div class="acbw-meta">${icon("clock")} 10:00 AM – 3:00 PM</div>
        <div class="acbw-meta">${icon("pin")} Club de Baloncesto Fraigcomar</div>
      </div>
      <div class="acbw-card"><p class="acbw-eyebrow">Requisitos</p><ul class="acbw-list">
        <li>Hoja de uniformes completada (el portal la genera por usted).</li>
        <li>Pago total de inscripción o depósito de ${money(DEPOSIT_PER_TEAM)} por equipo.</li>
        <li>Roster de ${MAX_PLAYERS} jugadores; ACB provee ${UNIFORMS_INCLUDED} uniformes.</li>
        <li>El uniforme #13 debe incluirse en el formulario inicial: ${money(EXTRA_UNIFORM_FEE)}.</li>
        <li class="is-alert">${esc(RULES.uniforms)}</li>
      </ul></div>
    </div>`,
    tone,
    "requisitos",
  );
}

function sectionCourtRules(portal, tone = "") {
  return band(
    `${head("Fecha límite: 30 de diciembre de 2026", "Canchas <em>y acomodos</em>", "Cada club indica las fechas en que su cancha está disponible para los carnavales y los dirigentes con dos equipos solicitan su acomodo.")}
    <div class="acbw-grid acbw-grid--2">
      <div class="acbw-card"><div class="acbw-card__icon acbw-card__icon--orange">${icon("calendar")}</div><div class="acbw-h3">Disponibilidad de cancha</div><p>Marque en el portal las fechas de la temporada en que su cancha está disponible (todo el día, solo AM o solo PM). También puede enviarlas a bobbyramirez48@yahoo.com antes del 30 de diciembre.</p><div class="acbw-btns" style="margin-top:16px"><a class="acbw-btn acbw-btn--orange acbw-btn--sm" href="${esc(portal)}/entrar">Marcar fechas en el portal</a></div></div>
      <div class="acbw-card"><div class="acbw-card__icon">${icon("users")}</div><div class="acbw-h3">Dirigentes con 2 equipos</div><ul class="acbw-list"><li>Máximo 2 equipos por dirigente.</li><li>Nunca dos equipos en la misma categoría.</li><li>Acomodo AM (hasta el mediodía) o PM (después del mediodía); no se aceptan horas específicas.</li><li>No se aceptan nuevos acomodos luego de iniciado el torneo.</li></ul></div>
    </div>`,
    tone,
    "canchas-acomodos",
  );
}

function sectionRequiredDocs(tone = "white") {
  const docs = [
    ["Hoja de uniformes", "Colores, número, nombre y tallas de cada jugador con el resumen por talla."],
    ["Lista oficial", "Jugadores, fecha de nacimiento, escuela, grado y autorización del encargado."],
    ["Carnet", "Espacios por jugador con foto y número, y copias de tarjetas federativas."],
    ["Roster de juego", "Tres copias para ser ponchadas, con la certificación de la Regla 3."],
  ];
  return band(
    `${head("Documentos oficiales", "Lo que debe <em>entregar</em>")}
    <div class="acbw-steps">${docs.map(([t, d]) => `<div class="acbw-step"><div class="acbw-h3">${t}</div><p>${d}</p></div>`).join("")}</div>
    <div style="margin-top:18px">${notice("Documentos completos", esc(RULES.documents), true)}</div>`,
    tone,
    "documentos-requeridos",
  );
}

function sectionPortalSteps(portal, tone = "white") {
  const steps = [
    ["Registre su club", "Datos del club, directiva, cancha sede y póliza de seguro. Recibirá un código de acceso por email."],
    ["Cree sus equipos", "Categoría, rama, programa y personal técnico con copia de las tarjetas federativas."],
    ["Uniformes y jugadores", "Colores del uniforme y hasta 13 jugadores con tallas, escuela, grado y autorización firmada del encargado."],
    ["Revise, imprima y envíe", "El portal valida la elegibilidad, calcula los costos y genera la Hoja de Uniformes, la Lista Oficial, el Carnet y el Roster."],
  ];
  return band(
    `${head("Portal de Inscripción ACB", "Inscriba su club <em>en línea</em>", "Cada club entra con su email y completa todos sus equipos en un solo lugar. Los documentos oficiales salen listos para imprimir.", `<div class="acbw-btns"><a class="acbw-btn acbw-btn--orange" href="${esc(portal)}/registro">Registrar mi club</a><a class="acbw-btn acbw-btn--ghost" href="${esc(portal)}/entrar">Entrar al portal</a></div>`)}
    <div class="acbw-steps">${steps.map(([t, d]) => `<div class="acbw-step"><div class="acbw-h3">${t}</div><p>${d}</p></div>`).join("")}</div>`,
    tone,
    "portal",
  );
}

function cta(portal, title = "Inscriba su club <em>hoy</em>", text = 'Dudas sobre la inscripción: Prof. Roberto "Bobby" Ramírez · 787-632-4848 · bobbyramirez48@yahoo.com') {
  return `<section class="acbw-cta"><div class="acbw-wrap"><p class="acbw-eyebrow" style="justify-content:center">¿Listo para el Torneo #30?</p><h2 class="acbw-h2">${title}</h2><p>${esc(text)}</p><div class="acbw-btns"><a class="acbw-btn acbw-btn--orange" href="${esc(portal)}/registro">Registrar mi club</a><a class="acbw-btn acbw-btn--light" href="${esc(portal)}/entrar">Entrar al portal</a></div></div></section>`;
}

function archiveList(archive, items) {
  return `<ul class="acbw-docs">${items
    .map((it) => docLink({ href: it.href.startsWith("http") ? it.href : `${archive}/${encodeURI(it.href)}`, title: it.title, sub: it.sub || "Temporada 2026 · acbpr.com", external: true, archive: true }))
    .join("")}</ul>`;
}

function personCard(p, { dark = false } = {}) {
  return `<div class="acbw-card"><div class="acbw-person"><div class="acbw-person__avatar">${esc(p.initials)}</div><div><div class="acbw-person__role">${esc(p.role)}</div><div class="acbw-person__name">${esc(p.name)}</div><a class="acbw-contact" href="${telHref(p.phone)}">${icon("phone")} ${esc(p.phone)}</a>${p.email ? `<a class="acbw-contact" href="mailto:${esc(p.email)}">${icon("mail")} ${esc(p.email)}</a>` : ""}</div></div></div>`;
}

// ------------------------------------------------------------------ chrome
export function topbar({ active, portal, logo }) {
  const nav = TOP_NAV.map((n) => `<a href="${n.href}"${n.href === active ? ' aria-current="page"' : ""}>${esc(n.label)}</a>`).join("");
  return `<div class="acbw-top"><div class="acbw-top__inner"><a class="acbw-brand" href="/"><img src="${esc(logo)}" alt="ACB" width="46" height="39"/><span><b>ACB Puerto Rico</b><small>Torneo #30 · 2027</small></span></a><a class="acbw-btn acbw-btn--orange acbw-btn--sm acbw-top__cta" href="${esc(portal)}">Portal</a><nav class="acbw-nav" aria-label="Principal">${nav}<a class="acbw-btn acbw-btn--orange acbw-btn--sm" href="${esc(portal)}">Portal de clubes</a></nav></div></div>`;
}

export function footer({ portal, logo }) {
  const dates = KEY_DATES.slice(0, 5)
    .map((d) => `<li>${esc(d.title)}: ${esc(d.when.split(" · ")[0])}</li>`)
    .join("");
  return `<footer class="acbw-footer"><div class="acbw-wrap"><div class="acbw-footer__grid">
    <div><div class="acbw-footer__brand"><img src="${esc(logo)}" alt="ACB" width="52" height="44"/><b>Asociación de Clubes de Baloncesto de Puerto Rico, Inc.</b></div><p>Torneo #30 · Temporada 2027. Baloncesto juvenil de clubes en Puerto Rico, categorías 6 a 19 años.</p><a class="acbw-contact" style="color:#fff" href="${FACEBOOK_URL}" target="_blank" rel="noopener">${icon("facebook")} Facebook · Liga ACB PR</a></div>
    <div><h4>Torneo</h4><ul><li><a href="/inscripcion">Inscripción 2027</a></li><li><a href="/itinerarios">Itinerarios y calendario</a></li><li><a href="/secciones-y-divisiones">Secciones y divisiones</a></li><li><a href="/canchas">Canchas</a></li><li><a href="/documentos">Documentos</a></li><li><a href="/reglamento">Reglamento</a></li><li><a href="${esc(portal)}">Portal de clubes</a></li></ul></div>
    <div><h4>Directiva</h4><ul>${DIRECTIVA.map((p) => `<li><b style="color:#fff">${esc(p.name)}</b><br/>${esc(p.role)} · <a href="${telHref(p.phone)}">${esc(p.phone)}</a></li>`).join("")}</ul></div>
    <div><h4>Fechas clave</h4><ul>${dates}</ul></div>
  </div><div class="acbw-footer__bottom"><span>© 2027 Asociación de Clubes de Baloncesto de Puerto Rico, Inc.</span><span>acbpr.com</span></div></div></footer>`;
}

function pageTitle(crumb, title, lead) {
  return `<section class="acbw-title"><div class="acbw-wrap"><div class="acbw-crumbs"><a href="/">Inicio</a> / ${esc(crumb)}</div><h1>${title}</h1>${lead ? `<p>${lead}</p>` : ""}</div></section>`;
}

function hero({ active, logo, compact }) {
  const mark = (pills) => pills.map((p, i) => ({ ...p, shift: PILL_SHIFT[i], active: p.href === active }));
  return heroHtml({ left: mark(LEFT_PILLS), right: mark(RIGHT_PILLS), compact, logoSrc: logo, tag: "Torneo #30 · Temporada 2027" });
}

// ------------------------------------------------------------------ pages
/**
 * @param {{ portal: string, archive: string, assets: { logo: string, logoSmall: string, flyer?: string, docs: Record<string, string> }, courts: {name: string, info: string}[], resoluciones: {year: string, items: {label: string, href: string}[]}[] }} ctx
 */
export function buildPages(ctx) {
  const { portal, archive, assets, courts, resoluciones } = ctx;
  const A = (path) => `${archive}/${encodeURI(path)}`;
  const pages = [];
  const add = (page) => pages.push(page);

  // ---------------------------------------------------------------- home
  const quick = [
    ["/inscripcion", "Inscripción 2027", "Requisitos, costos, fechas y el portal en línea para clubes.", "check", true],
    ["/itinerarios", "Itinerarios y calendario", "Fechas de la serie regular, postemporada y finales por grupo.", "calendar"],
    ["/secciones-y-divisiones", "Secciones y divisiones", "Categorías de 6 a 19 años, ACB Regular y ACB Alternativo.", "grid"],
    ["/canchas", "Canchas", "Directorio de canchas con direcciones y fecha límite de disponibilidad.", "pin"],
    ["/documentos", "Documentos", "Formularios 2027 y documentos oficiales para descargar.", "file"],
    ["/reglamento", "Reglamento", "Reglas de participación, Regla 3 y accesorios permitidos.", "book"],
    ["/resoluciones", "Resoluciones", "Resoluciones oficiales de la ACB por temporada.", "scale"],
    ["/directiva", "Directiva", "Presidente, Director Ejecutivo y Administrador.", "users"],
  ];
  add({
    slug: "home",
    url: "/",
    name: "Inicio",
    title: "ACB Puerto Rico · Torneo #30 · Temporada 2027",
    description: "Asociación de Clubes de Baloncesto de Puerto Rico. Torneo #30, temporada 2027: inscripción, calendario, canchas, documentos y portal de clubes.",
    hero: hero({ active: "/", logo: assets.logo, compact: false }),
    body: [
      band(
        `<div class="acbw-intro"><div><p class="acbw-eyebrow">Asociación de Clubes de Baloncesto de Puerto Rico</p><h1 class="acbw-big">Torneo <em>#30</em></h1><div class="acbw-start"><b>INICIO</b><span>Sábado 6 de febrero de 2027</span></div><div class="acbw-chips"><span class="acbw-chip">ACB Regular</span><span class="acbw-chip acbw-chip--orange">ACB Alternativo</span></div></div>
        <div class="acbw-panel"><div class="acbw-h3">Inscripción 2027 en línea</div><p>Registre su club, complete cada equipo (personal técnico, uniformes, jugadores y autorizaciones) y el portal genera la Hoja de Uniformes, la Lista Oficial, el Carnet y el Roster listos para imprimir.</p><div class="acbw-btns" style="margin:18px 0 10px"><a class="acbw-btn acbw-btn--orange" href="${esc(portal)}/registro">Registrar mi club</a><a class="acbw-btn acbw-btn--light" href="${esc(portal)}/entrar">Entrar al portal</a></div><div class="acbw-meta">${icon("calendar")} Inscripción presencial: sábados 12 y 19 de diciembre · 10 AM – 3 PM</div><div class="acbw-meta">${icon("pin")} Club de Baloncesto Fraigcomar</div></div></div>`,
        "dark",
      ),
      band(
        `${head("Temporada 2027", "Todo el <em>torneo</em>")}<div class="acbw-grid acbw-grid--4">${quick
          .map(
            ([href, t, d, ic, orange]) =>
              `<a class="acbw-card acbw-card--link" href="${href}"><div class="acbw-card__icon${orange ? " acbw-card__icon--orange" : ""}">${icon(ic)}</div><div class="acbw-h3">${t}</div><p>${d}</p><span class="acbw-card__more">Ver ${icon("arrow")}</span></a>`,
          )
          .join("")}</div>`,
      ),
      sectionKeyDates("white"),
      sectionFees(),
      assets.flyer
        ? band(
            `<div class="acbw-flyer"><img src="${esc(assets.flyer)}" alt="Inscripción Torneo #30 ACB 2027" loading="lazy" width="738" height="926"/><div>${head("Información general", "Torneo #30 <em>ACB 2027</em>", "Inscripción ACB Regular y ACB Alternativo. Se mantienen los mismos costos del pasado torneo: incluye un balón y un mínimo de 8 juegos.")}<ul class="acbw-docs">${assets.docs.info ? docLink({ href: assets.docs.info, title: "Información de inscripción 2027", sub: "Documento oficial · Word", orange: true }) : ""}${docLink({ href: "/inscripcion", title: "Ver toda la información", sub: "Requisitos, costos, fechas, elegibilidad y uniformes", iconName: "info", external: false })}</ul></div></div>`,
          )
        : "",
      cta(portal),
    ].join(""),
  });

  // ---------------------------------------------------------------- inscripción
  add({
    slug: "inscripcion",
    url: "/inscripcion",
    name: "Inscripción 2027",
    title: "Inscripción 2027 · Torneo #30 · ACB Puerto Rico",
    description: "Requisitos, costos, fechas clave, elegibilidad, uniformes y documentos para inscribir equipos en el Torneo #30 de la ACB.",
    active: "/inscripcion",
    hero: hero({ active: "", logo: assets.logo, compact: true }),
    title_html: pageTitle("Inscripción 2027", "Inscripción <em>2027</em>", "Toda la información de inscripción del Torneo #30 en un solo lugar: requisitos, costos, fechas, elegibilidad, uniformes y documentos. Inscriba su club y sus equipos en línea."),
    body: [
      sectionRequirements(""),
      sectionFees(),
      sectionPortalSteps(portal, "white"),
      sectionKeyDates(""),
      sectionEligibility("dark"),
      sectionUniforms("white"),
      sectionCourtRules(portal, ""),
      sectionRequiredDocs("white"),
      band(`${head("Consentimiento", "Autorización <em>del encargado</em>")}${notice("Firma del padre, madre o encargado", esc(RULES.consent))}`, ""),
      cta(portal),
    ].join(""),
  });

  // ---------------------------------------------------------------- itinerarios
  add({
    slug: "itinerarios",
    url: "/itinerarios",
    name: "Itinerarios",
    title: "Itinerarios y calendario 2027 · ACB Puerto Rico",
    description: "Calendario de la temporada 2027 de la ACB: serie regular, postemporada y finales por grupo de categorías.",
    hero: hero({ active: "/itinerarios", logo: assets.logo, compact: true }),
    active: "/itinerarios",
    title_html: pageTitle("Itinerarios", "Itinerarios <em>2027</em>", "Calendario de la temporada 2027 por grupo de categorías. Los itinerarios de juegos por categoría se publicarán en esta página."),
    body: [
      band(`${head("Calendario del Torneo ACB 2027", "Temporada <em>2027</em>")}${calendarCards()}`),
      band(
        `${head("Archivo", "Itinerarios <em>2026</em>")}${archiveList(archive, [
          { href: "2026/17.pdf", title: "Itinerario 17 años" },
          { href: "2026/18.pdf", title: "Itinerario 18 años" },
          { href: "2026/19.pdf", title: "Itinerario 19 años" },
        ])}`,
        "white",
      ),
    ].join(""),
  });

  // ---------------------------------------------------------------- tabla
  add({
    slug: "tabla-de-posiciones",
    url: "/tabla-de-posiciones",
    name: "Tabla de posiciones",
    title: "Tabla de posiciones 2027 · ACB Puerto Rico",
    description: "Tablas de posiciones del Torneo #30 de la ACB.",
    active: "/tabla-de-posiciones",
    hero: hero({ active: "/tabla-de-posiciones", logo: assets.logo, compact: true }),
    title_html: pageTitle("Tabla de posiciones", "Tabla de <em>posiciones</em>", "Las tablas de posiciones 2027 se publicarán aquí una vez comience la temporada, el sábado 6 de febrero de 2027."),
    body: [
      band(`${notice("Temporada 2027", "Cada equipo tiene garantizado un mínimo de 8 juegos. La serie regular de las categorías 6 a 13 años comienza el 6 de febrero; 14 a 16 años el 7 de febrero; y 17 a 19 años el 1 de mayo de 2027.")}<div style="margin-top:22px">${calendarCards((p) => /regular/i.test(p.phase))}</div>`),
      band(`${head("Archivo", "Tablas <em>2026</em>")}${archiveList(archive, [{ href: "2026/tabla1719.pdf", title: "Tabla de posiciones ACB 17 – 19" }])}`, "white"),
    ].join(""),
  });

  // ---------------------------------------------------------------- cuartos
  add({
    slug: "cuartos-de-final",
    url: "/cuartos-de-final",
    name: "Cuartos de final",
    title: "Cuartos de final y postemporada 2027 · ACB Puerto Rico",
    description: "Fechas de postemporada, Final Four y finales del Torneo #30 de la ACB.",
    active: "/cuartos-de-final",
    hero: hero({ active: "/cuartos-de-final", logo: assets.logo, compact: true }),
    title_html: pageTitle("Cuartos de final", "Cuartos <em>de final</em>", "Postemporada, Final Four y finales de la temporada 2027. Las llaves se publicarán al terminar la serie regular."),
    body: [
      band(`${head("Postemporada 2027", "Fechas de <em>postemporada</em>")}${calendarCards((p) => !/regular|uniformes/i.test(p.phase))}`),
      band(
        `${head("Archivo", "Cuartos de final <em>2026</em>")}${archiveList(archive, [
          { href: "2026/4f.pdf", title: "6 – 13 Cuartos de final" },
          { href: "2026/713f4.pdf", title: "7 – 13 Cuartos de final" },
          { href: "2026/4fa.pdf", title: "Cuartos de final Alternativo" },
          { href: "2026/msa.pdf", title: "Cuartos de final Alternativo · muerte súbita" },
          { href: "2026/ms7.pdf", title: "Cuartos de final 7 – 8 · muerte súbita" },
          { href: "2026/ms9.pdf", title: "Cuartos de final 9 · muerte súbita" },
          { href: "2026/ms10.pdf", title: "Cuartos de final 10 – 13 · muerte súbita" },
        ])}`,
        "white",
      ),
    ].join(""),
  });

  // ---------------------------------------------------------------- todos vs todos
  add({
    slug: "todos-vs-todos",
    url: "/todos-vs-todos",
    name: "Todos VS Todos",
    title: "Todos contra todos 2027 · ACB Puerto Rico",
    description: "Llaves de todos contra todos del Torneo #30 de la ACB.",
    active: "/todos-vs-todos",
    hero: hero({ active: "/todos-vs-todos", logo: assets.logo, compact: true }),
    title_html: pageTitle("Todos VS Todos", "Todos <em>VS</em> Todos", "Las llaves de todos contra todos de la temporada 2027 se publicarán en esta página."),
    body: [
      band(`${head("Temporada 2027", "Calendario <em>2027</em>")}${calendarCards()}`),
      band(`${head("Archivo", "Llaves <em>2026</em>")}${archiveList(archive, [{ href: "2026/llaves14.pdf", title: "Llaves 14 – 16" }])}`, "white"),
    ].join(""),
  });

  // ---------------------------------------------------------------- secciones
  const feeRows = FEE_BRACKETS.map((b) => `<tr><td><b>${b.from} – ${b.to} años</b></td><td>${CATEGORIES.filter((c) => c >= b.from && c <= b.to).map((c) => categoryBirthYear(c)).join(", ")}</td><td><b>${money(b.fee)}</b></td></tr>`).join("");
  add({
    slug: "secciones-y-divisiones",
    url: "/secciones-y-divisiones",
    name: "Secciones y Divisiones",
    title: "Secciones y divisiones 2027 · ACB Puerto Rico",
    description: "Categorías de 6 a 19 años, programas ACB Regular y ACB Alternativo, y grupos de la temporada 2027.",
    active: "/secciones-y-divisiones",
    hero: hero({ active: "/secciones-y-divisiones", logo: assets.logo, compact: true }),
    title_html: pageTitle("Secciones y divisiones", "Secciones <em>y divisiones</em>", "Programas, categorías por año de nacimiento y grupos de calendario de la temporada 2027. Las secciones por categoría se publicarán al cerrar la inscripción."),
    body: [
      band(
        `${head("Programas", "ACB Regular <em>y Alternativo</em>")}<div class="acbw-grid acbw-grid--2"><div class="acbw-card"><div class="acbw-card__icon">${icon("trophy")}</div><div class="acbw-h3">ACB Regular</div><p>Categorías de 6 a 19 años, rama masculina y femenina. Serie regular, postemporada, Final Four (6 a 13) y finales.</p></div><div class="acbw-card"><div class="acbw-card__icon acbw-card__icon--orange">${icon("ball")}</div><div class="acbw-h3">ACB Alternativo</div><p>Se juega con el grupo de 6 a 13 años; finales del Alternativo el 10 y 11 de abril de 2027.</p></div></div>`,
      ),
      sectionEligibility("dark"),
      band(`${head("Costos por división", "Divisiones <em>por edad</em>")}<div class="acbw-table-wrap"><table class="acbw-table"><thead><tr><th>División</th><th>Nacidos en</th><th>Inscripción</th></tr></thead><tbody>${feeRows}</tbody></table></div>`, "white"),
      band(`${head("Grupos de calendario", "Tres grupos <em>de temporada</em>")}${calendarCards((p) => /regular/i.test(p.phase))}`),
      band(`${head("Archivo", "Secciones <em>2026</em>")}${archiveList(archive, [{ href: "2026/secciones.pdf", title: "ACB Secciones 2026" }])}`, "white"),
    ].join(""),
  });

  // ---------------------------------------------------------------- canchas
  const sorted = [...courts].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base", numeric: true }));
  let lastLetter = "";
  const courtHtml = sorted
    .map((c) => {
      const first = c.name.normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : "#";
      const heading = letter !== lastLetter ? `<div class="acbw-letter">${letter}</div>` : "";
      lastLetter = letter;
      const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.name}, Puerto Rico`)}`;
      return `${heading}<details class="acbw-court"><summary>${icon("pin")} ${esc(c.name)}</summary><div class="acbw-court__body">${esc(c.info)}<br/><a class="acbw-btn acbw-btn--ghost acbw-btn--sm" href="${esc(maps)}" target="_blank" rel="noopener">${icon("external")} Ver en Google Maps</a></div></details>`;
    })
    .join("");
  add({
    slug: "canchas",
    url: "/canchas",
    name: "Canchas",
    title: "Canchas · ACB Puerto Rico",
    description: "Directorio de canchas de la ACB con direcciones y contactos, y fecha límite de disponibilidad de canchas para la temporada 2027.",
    active: "/canchas",
    hero: hero({ active: "/canchas", logo: assets.logo, compact: true }),
    title_html: pageTitle("Canchas", "<em>Canchas</em>", `Directorio de canchas de los clubes (${sorted.length}) con cómo llegar y personas de contacto, y la información de disponibilidad para la temporada 2027.`),
    body: [
      sectionCourtRules(portal, ""),
      band(`${head("Directorio", "Cómo <em>llegar</em>", "Toque una cancha para ver las direcciones y el contacto. Información del directorio histórico de la ACB; confirme con el club anfitrión antes de su juego.")}<div class="acbw-courts">${courtHtml}</div><div style="margin-top:22px">${archiveList(archive, [{ href: "documentos/CANCHAS ACB 2017.pdf", title: "Documento para imprimir canchas", sub: "Localizaciones de canchas · acbpr.com" }])}</div>`, "white"),
    ].join(""),
  });

  // ---------------------------------------------------------------- campeones
  add({
    slug: "campeones",
    url: "/campeones",
    name: "Campeones",
    title: "Campeones · ACB Puerto Rico",
    description: "Campeones de la ACB y fechas de finales del Torneo #30.",
    active: "/campeones",
    hero: hero({ active: "/campeones", logo: assets.logo, compact: true }),
    title_html: pageTitle("Campeones", "<em>Campeones</em>", "Treinta torneos de baloncesto juvenil de clubes. Los campeones del Torneo #30 se publicarán aquí al terminar cada final."),
    body: [
      band(`${head("Torneo #30", "Finales <em>2027</em>")}${calendarCards((p) => /final/i.test(p.phase))}`),
      band(`${head("Archivo", "Campeones <em>2026</em>")}${archiveList(archive, [{ href: `${archive}/campeones.html`, title: "Campeones ACB 2026", sub: "Fotos de los campeones · acbpr.com" }])}`, "white"),
    ].join(""),
  });

  // ---------------------------------------------------------------- resoluciones
  add({
    slug: "resoluciones",
    url: "/resoluciones",
    name: "Resoluciones",
    title: "Resoluciones · ACB Puerto Rico",
    description: "Resoluciones oficiales de la Asociación de Clubes de Baloncesto de Puerto Rico por temporada.",
    active: "/resoluciones",
    hero: hero({ active: "/resoluciones", logo: assets.logo, compact: true }),
    title_html: pageTitle("Resoluciones", "<em>Resoluciones</em>", "Resoluciones oficiales de la ACB por temporada."),
    body: band(
      resoluciones
        .map(
          (g) =>
            `<div style="margin-bottom:26px"><p class="acbw-eyebrow">Resoluciones ${esc(g.year)}</p><ul class="acbw-docs">${g.items
              .map((it) => docLink({ href: it.href, title: it.label, sub: `Resolución ${g.year} · PDF`, iconName: "scale", external: true }))
              .join("")}</ul></div>`,
        )
        .join(""),
      "white",
    ),
  });

  // ---------------------------------------------------------------- directiva
  add({
    slug: "directiva",
    url: "/directiva",
    name: "Directiva",
    title: "Directiva · ACB Puerto Rico",
    description: "Directiva de la Asociación de Clubes de Baloncesto de Puerto Rico.",
    active: "/directiva",
    hero: hero({ active: "/directiva", logo: assets.logo, compact: true }),
    title_html: pageTitle("Directiva", "<em>Directiva</em>", "Asociación de Clubes de Baloncesto de Puerto Rico, Inc."),
    body: [
      band(`<div class="acbw-grid acbw-grid--3">${DIRECTIVA.map((p) => personCard(p)).join("")}</div><div style="margin-top:22px">${notice("Inscripción, canchas y acomodos", 'Para dudas sobre la inscripción, la disponibilidad de canchas y los acomodos de dirigentes, comuníquese con el Prof. Roberto "Bobby" Ramírez.')}</div>`),
    ].join(""),
  });

  // ---------------------------------------------------------------- documentos
  const forms = [
    ["info", "Información de inscripción 2027", "Requisitos, costos y fechas · Word"],
    ["uniformes", "Hoja de uniformes 2027", "Formulario para uniformes · Word"],
    ["carnet", "Carnet y Lista de Jugadores", "Lista oficial y carnet · Word"],
    ["roster", "Roster de juego 2027", "Tres copias para ponchar · Word"],
    ["disponibilidad", "Disponibilidad de cancha y dirigentes con 2 equipos", "Entregar antes del 30 de diciembre · Word"],
  ].filter(([key]) => assets.docs[key]);
  add({
    slug: "documentos",
    url: "/documentos",
    name: "Documentos",
    title: "Documentos · ACB Puerto Rico",
    description: "Formularios oficiales 2027 de la ACB: hoja de uniformes, lista oficial, carnet, roster y disponibilidad de canchas.",
    active: "/documentos",
    hero: hero({ active: "/documentos", logo: assets.logo, compact: true }),
    title_html: pageTitle("Documentos", "Documentos <em>oficiales</em>", "Formularios 2027 para descargar. Si inscribe su club en el portal, estos documentos se generan automáticamente con la información de cada equipo."),
    body: [
      band(
        `<div class="acbw-grid acbw-grid--2"><div>${head("Temporada 2027", "Formularios <em>2027</em>")}<ul class="acbw-docs">${forms.map(([key, t, s]) => docLink({ href: assets.docs[key], title: t, sub: s, orange: key === "info" })).join("")}</ul></div><div class="acbw-card" style="align-self:start"><div class="acbw-card__icon acbw-card__icon--orange">${icon("check")}</div><div class="acbw-h3">Mejor aún: hágalo en línea</div><p>En el Portal de Inscripción complete cada equipo una sola vez y el portal genera la Hoja de Uniformes, la Lista Oficial, el Carnet y el Roster (3 copias) listos para imprimir y firmar.</p><div class="acbw-btns" style="margin-top:16px"><a class="acbw-btn acbw-btn--orange acbw-btn--sm" href="${esc(portal)}/registro">Registrar mi club</a><a class="acbw-btn acbw-btn--ghost acbw-btn--sm" href="${esc(portal)}/entrar">Entrar al portal</a></div></div></div>`,
      ),
      sectionRequiredDocs("white"),
      band(
        `${head("Archivo", "Documentos <em>2026</em>")}${archiveList(archive, [
          { href: "2027/info2027.pdf", title: "Información general 2027", sub: "PDF · acbpr.com" },
          { href: "2026/uniformes.pdf", title: "Formulario uniforme 2026" },
          { href: "2026/CARNET.pdf", title: "Carnet y lista de jugadores 2026" },
          { href: "2026/ROSTER.pdf", title: "Hoja roster 2026" },
          { href: "2026/reglamento2026.pdf", title: "Reglamento ACB 2026" },
          { href: "2026/REGLAS.pdf", title: "Reglas de participación 2026" },
          { href: "2026/accesorios 2025.pdf", title: "Accesorios permitidos 2026" },
        ])}`,
      ),
    ].join(""),
  });

  // ---------------------------------------------------------------- reglamento
  const ruleCards = [
    ["Roster", RULES.roster, "users"],
    ["Uniformes", RULES.uniforms, "shirt"],
    ["Documentos", RULES.documents, "file"],
    ["Dirigentes y horarios", RULES.schedule, "clock"],
    ["Autorización", RULES.consent, "shield"],
  ];
  add({
    slug: "reglamento",
    url: "/reglamento",
    name: "Reglamento",
    title: "Reglamento · ACB Puerto Rico",
    description: "Reglamento de la ACB, reglas de participación, Regla 3 y accesorios permitidos.",
    active: "/reglamento",
    hero: hero({ active: "/reglamento", logo: assets.logo, compact: true }),
    title_html: pageTitle("Reglamento", "<em>Reglamento</em>", "Reglas clave del Torneo #30 y el reglamento oficial de la ACB."),
    body: [
      band(`${head("Torneo #30", "Reglas <em>clave 2027</em>")}<div class="acbw-grid acbw-grid--3">${ruleCards.map(([t, d, ic]) => `<div class="acbw-card"><div class="acbw-card__icon">${icon(ic)}</div><div class="acbw-h3">${t}</div><p>${esc(d)}</p></div>`).join("")}</div>`),
      band(`${head("Certificación del roster", "Regla <em>3</em>")}${notice("Certificación", esc(RULES.rule3), true)}`, "white"),
      band(
        `${head("Documentos", "Reglamento <em>oficial</em>")}${archiveList(archive, [
          { href: "2026/reglamento2026.pdf", title: "Reglamento ACB 2026" },
          { href: "2026/REGLAS.pdf", title: "Reglas de participación 2026" },
          { href: "2026/accesorios 2025.pdf", title: "Accesorios permitidos 2026" },
        ])}`,
      ),
    ].join(""),
  });

  // ---------------------------------------------------------------- fotos
  add({
    slug: "fotos",
    url: "/fotos",
    name: "Fotos",
    title: "Fotos · ACB Puerto Rico",
    description: "Fotos de los juegos, campeones y actividades de la ACB.",
    active: "/fotos",
    hero: hero({ active: "/fotos", logo: assets.logo, compact: true }),
    title_html: pageTitle("Fotos", "<em>Fotos</em>", "Juegos, campeones y actividades de la ACB."),
    body: band(
      `<div class="acbw-grid acbw-grid--2"><a class="acbw-card acbw-card--link" href="${FACEBOOK_URL}" target="_blank" rel="noopener"><div class="acbw-card__icon">${icon("facebook")}</div><div class="acbw-h3">Facebook · Liga ACB PR</div><p>Las fotos y noticias de cada fin de semana se publican en la página de Facebook de la Asociación de Clubes de Baloncesto.</p><span class="acbw-card__more">Ver fotos ${icon("external")}</span></a>${
        assets.flyer ? `<div class="acbw-card"><img src="${esc(assets.flyer)}" alt="Torneo #30 ACB 2027" loading="lazy" width="738" height="926" style="border-radius:16px; display:block; margin:0 auto"/></div>` : ""
      }</div>`,
      "white",
    ),
  });

  // ---------------------------------------------------------------- contacto
  add({
    slug: "contacto",
    url: "/contacto",
    name: "Contacto",
    title: "Contacto · ACB Puerto Rico",
    description: "Contacto de la Asociación de Clubes de Baloncesto de Puerto Rico.",
    active: "/contacto",
    hero: hero({ active: "", logo: assets.logo, compact: true }),
    title_html: pageTitle("Contacto", "<em>Contacto</em>", "Comuníquese con la directiva de la ACB."),
    body: [
      band(`<div class="acbw-grid acbw-grid--3">${DIRECTIVA.map((p) => personCard(p)).join("")}</div>`),
      band(
        `<div class="acbw-grid acbw-grid--2"><div class="acbw-card"><div class="acbw-card__icon acbw-card__icon--orange">${icon("pin")}</div><div class="acbw-h3">Inscripción presencial</div><p>Sábados 12 y 19 de diciembre de 2026 · 10:00 AM – 3:00 PM<br/>Club de Baloncesto Fraigcomar</p></div><div class="acbw-card"><div class="acbw-card__icon">${icon("calendar")}</div><div class="acbw-h3">Entrega de uniformes y documentos</div><p>Sábado 23 de enero de 2027 · 1:00 – 4:00 PM<br/>Colegio Universitario de San Juan · Ave. José Oliver #180, San Juan</p></div></div>`,
        "white",
      ),
      cta(portal, "Portal de <em>clubes</em>", "Registre su club y complete sus equipos en línea."),
    ].join(""),
  });

  // Shared chrome around each page body.
  return pages.map((p) => ({
    ...p,
    html: `${topbar({ active: p.active || p.url, portal, logo: assets.logoSmall })}${p.hero}${tickerHtml(TICKER)}${p.title_html || ""}${p.body}${footer({ portal, logo: assets.logoSmall })}`,
  }));
}
