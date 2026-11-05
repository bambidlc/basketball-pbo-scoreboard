// HTML for the ACB hero. Used as a string by the Odoo website builder and
// injected by the portal's <Hero> component, so both render the exact same
// banner. Styles live in shared/brand.css.

const HOOP_SVG = `<svg class="acb-hero__hoop" viewBox="0 0 160 170" aria-hidden="true">
  <defs>
    <linearGradient id="acbGlass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".55"/>
      <stop offset="1" stop-color="#cfe0ff" stop-opacity=".18"/>
    </linearGradient>
  </defs>
  <rect x="78" y="0" width="6" height="22" fill="#9aa6c4"/>
  <rect x="14" y="18" width="134" height="84" rx="4" fill="url(#acbGlass)" stroke="#ffffff" stroke-width="3"/>
  <rect x="58" y="52" width="46" height="34" fill="none" stroke="#f26a1b" stroke-width="3"/>
  <rect x="76" y="98" width="10" height="12" fill="#c9d2ea"/>
  <ellipse cx="81" cy="112" rx="30" ry="6" fill="none" stroke="#ff6a1a" stroke-width="4"/>
  <g stroke="#ffffff" stroke-opacity=".85" stroke-width="1.6" fill="none">
    <path d="M52 113 L60 150 M62 116 L66 154 M72 117 L74 156 M81 118 L81 157 M90 117 L88 156 M100 116 L96 154 M110 113 L102 150"/>
    <path d="M55 125 Q81 134 107 125 M58 138 Q81 146 104 138 M62 150 Q81 157 100 150"/>
  </g>
</svg>`;

const COURT_SVG = `<svg viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">
  <g fill="none" stroke="rgba(255,255,255,.7)" stroke-width="3">
    <line x1="0" y1="2" x2="1000" y2="2"/>
    <line x1="500" y1="2" x2="500" y2="300"/>
    <ellipse cx="500" cy="2" rx="110" ry="70"/>
    <path d="M150 2 Q150 220 0 240"/>
    <path d="M850 2 Q850 220 1000 240"/>
  </g>
</svg>`;

const BOARD_TEXT = "ACB · Torneo #30 · Temporada 2027 · Asociación de Clubes de Baloncesto de Puerto Rico · ";

export function heroBackgroundHtml() {
  const board = (cls) =>
    `<div class="acb-hero__board ${cls}"><span>${BOARD_TEXT.repeat(3)}</span></div>`;
  return `
    <div class="acb-hero__sky"></div>
    <div class="acb-hero__lights"></div>
    ${board("acb-hero__board--left")}
    ${board("acb-hero__board--right")}
    <div class="acb-hero__stands"></div>
    ${board("acb-hero__board--left acb-hero__board--low")}
    ${board("acb-hero__board--right acb-hero__board--low")}
    <div class="acb-hero__floor">${COURT_SVG}</div>
    <div class="acb-hero__floor-shine"></div>
    ${HOOP_SVG}
    <div class="acb-hero__vignette"></div>`;
}

export function heroCenterHtml({ years = 30, season = 2027, logoSrc = "/acb-logo.png", tag = "" } = {}) {
  const layered = (text, cls) =>
    `<span class="${cls}"><span class="l-back">${text}</span><span class="l-mid">${text}</span><span class="l-front">${text}</span></span>`;
  return `
    <div class="acb-hero__years">
      <svg viewBox="0 0 140 52" aria-hidden="true">
        <path id="acbArc" d="M14 50 Q70 4 126 50" fill="none"/>
        <text font-family="'Baloo 2', 'Arial Rounded MT Bold', sans-serif" font-weight="800" font-size="30" fill="#fff" stroke="#0b1a55" stroke-width="5" paint-order="stroke" letter-spacing="1">
          <textPath href="#acbArc" startOffset="50%" text-anchor="middle">años</textPath>
        </text>
      </svg>
      <span class="acb-hero__years-num">${layered(years, "stack")}</span>
    </div>
    <img class="acb-hero__logo" src="${logoSrc}" alt="ACB — Asociación de Clubes de Baloncesto de Puerto Rico" width="627" height="533"/>
    ${layered(season, "acb-hero__season")}
    ${tag ? `<div class="acb-hero__tag">${tag}</div>` : ""}`;
}

/** Full hero as one HTML string (for the Odoo website). */
export function heroHtml({ left = [], right = [], compact = false, logoSrc, tag, years, season } = {}) {
  const pill = (item) =>
    `<li style="--shift:${item.shift || 0}"><a class="acb-pill${item.orange ? " acb-pill--orange" : ""}${item.active ? " is-active" : ""}" href="${item.href}"${item.active ? ' aria-current="page"' : ""}>${item.label}</a></li>`;
  return `<section class="acb-hero${compact ? " acb-hero--compact" : ""}" aria-label="ACB Torneo #30">
  <div class="acb-hero__bg">${heroBackgroundHtml()}</div>
  <div class="acb-hero__inner">
    <ul class="acb-hero__pills acb-hero__pills--left">${left.map(pill).join("")}</ul>
    <div class="acb-hero__center">${heroCenterHtml({ logoSrc, tag, years, season })}</div>
    <ul class="acb-hero__pills acb-hero__pills--right">${right.map(pill).join("")}</ul>
  </div>
</section>`;
}

export function tickerHtml(messages) {
  const items = messages.map((m) => `<span>${m}</span>`).join("");
  return `<div class="acb-ticker" role="marquee" aria-label="Avisos"><div class="acb-ticker__track">${items}${items}</div></div>`;
}

/** Stagger used by the original banner (px toward the ball). */
export const PILL_SHIFT = [36, 4, -22, -34, -6, 30];
