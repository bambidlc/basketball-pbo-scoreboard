// "Torneo #30" registration flyer: the first section after the hero, laid out
// like the ACB's printed announcement (title, start date, registration days,
// requisitos and costos). Used as a string by the Odoo website builder and
// injected by the portal's landing page, so both show the same sheet. The
// markup is XHTML-safe (Odoo QWeb). Styles live in shared/brand.css.
import {
  DEPOSIT_PER_TEAM,
  EXTRA_UNIFORM_FEE,
  FEE_BRACKETS,
  KEY_DATES,
  MAX_PLAYERS,
  ORG_NAME,
  ORG_SHORT,
  TOURNAMENT_NUMBER,
  UNIFORMS_INCLUDED,
} from "./tournament.js";

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  calendar: svg('<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>'),
  clock: svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3.5 2"/>'),
  pin: svg('<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
};

const cents = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dollars = (n) => `$${Number(n).toLocaleString("en-US")}`;

/**
 * @param {{ logoSrc?: string, ctaHref?: string, ctaLabel?: string }} [options]
 */
export function flyerHtml({ logoSrc = "/acb-logo.png", ctaHref = "/mi-club", ctaLabel = "Buscar o inscribir mi club" } = {}) {
  const signup = KEY_DATES.find((d) => d.id === "inscripcion");
  const start = KEY_DATES.find((d) => d.id === "inicio");
  const [days, hours] = String(signup?.when || "").split(" · ");
  const startText = String(start?.when || "").replace(/^Sábado/, "sábado");

  const requisitos = [
    "Hoja de Uniformes.",
    `Pago total de inscripción o depósito de <b>${cents(DEPOSIT_PER_TEAM)}</b> por equipo.`,
    `Roster por equipo será de ${MAX_PLAYERS} jugadores. <b>ACB proveerá ${UNIFORMS_INCLUDED} uniformes.</b>`,
    `De un equipo someter ${MAX_PLAYERS} jugadores, deberá incluir el uniforme adicional en el formulario de uniformes. Costo de uniforme adicional <b>${cents(EXTRA_UNIFORM_FEE)}</b>.`,
    "No se recibirán peticiones de uniformes que no estén incluidos en el formulario de uniformes sometido inicialmente.",
  ];

  return `<section class="acb-flyer" id="torneo-30" aria-labelledby="acb-flyer-title">
  <div class="acb-flyer__sheet">
    <p class="acb-flyer__org">${ORG_NAME} (${ORG_SHORT})</p>
    <div class="acb-flyer__title">
      <h2 id="acb-flyer-title">Torneo <span>#${TOURNAMENT_NUMBER}</span></h2>
      <img src="${logoSrc}" alt="" width="627" height="533"/>
    </div>
    <p class="acb-flyer__start">Inicio del Torneo: <b>${startText}</b></p>
    <h3 class="acb-flyer__sub">Inscripción de Equipos ACB Regular y ACB Alternativo</h3>
    <div class="acb-flyer__when">
      <span>${ICONS.calendar}${days || ""}</span>
      <span>${ICONS.clock}${hours || ""}</span>
      <span>${ICONS.pin}${signup?.where || ""}</span>
    </div>
    <div class="acb-flyer__cols">
      <div class="acb-flyer__block">
        <h4 class="acb-flyer__h">Requisitos</h4>
        <ul class="acb-flyer__list">${requisitos.map((r) => `<li>${r}</li>`).join("")}</ul>
      </div>
      <div class="acb-flyer__block acb-flyer__block--fees">
        <h4 class="acb-flyer__h">Costos de Inscripción <span>Incluye un balón</span></h4>
        <p class="acb-flyer__note">Se mantienen los mismos costos del pasado torneo y se garantizan <b>8 juegos como mínimo</b>.</p>
        <div class="acb-flyer__fees" role="table" aria-label="Costos de inscripción por edad">
          ${FEE_BRACKETS.map(
            (b) => `<div class="acb-flyer__fee" role="row"><span role="cell">${b.from} – ${b.to} años</span><b role="cell">${dollars(b.fee)}</b></div>`,
          ).join("")}
        </div>
      </div>
    </div>
    <div class="acb-flyer__cta">
      <a class="acb-flyer__btn" href="${ctaHref}">${ctaLabel}${ICONS.arrow}</a>
      <span>Inscríbase en línea o en persona en las fechas indicadas.</span>
    </div>
  </div>
</section>`;
}
