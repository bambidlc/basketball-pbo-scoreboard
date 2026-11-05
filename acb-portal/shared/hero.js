// HTML for the ACB hero. Used as a string by the Odoo website builder and
// injected by the portal's <Hero> component, so both render the exact same
// banner on a plain neutral background. Styles live in shared/brand.css.

export function heroCenterHtml({ years = 30, season = 2027, logoSrc = "/acb-logo.png" } = {}) {
  // Three stacked copies make the outlined, shadowed lettering; screen readers get one.
  const layered = (text, cls) =>
    `<span class="${cls}"><span class="l-back" aria-hidden="true">${text}</span><span class="l-mid" aria-hidden="true">${text}</span><span class="l-front">${text}</span></span>`;
  return `
    <img class="acb-hero__logo" src="${logoSrc}" alt="ACB — Asociación de Clubes de Baloncesto de Puerto Rico" width="627" height="533"/>
    <div class="acb-hero__years">
      ${layered(years, "acb-hero__years-num")}
      ${layered("años", "acb-hero__years-word")}
    </div>
    <div class="acb-hero__season">${layered(`Torneo ${season}`, "acb-hero__season-num")}</div>`;
}

/** Full hero as one HTML string (for the Odoo website). */
export function heroHtml({ left = [], right = [], compact = false, logoSrc, years, season } = {}) {
  const pill = (item) =>
    `<li><a class="acb-pill${item.orange ? " acb-pill--orange" : ""}${item.active ? " is-active" : ""}" href="${item.href}"${item.active ? ' aria-current="page"' : ""}>${item.label}</a></li>`;
  return `<section class="acb-hero${compact ? " acb-hero--compact" : ""}" aria-label="ACB Torneo #30">
  <div class="acb-hero__inner">
    <ul class="acb-hero__pills acb-hero__pills--left">${left.map(pill).join("")}</ul>
    <div class="acb-hero__center">${heroCenterHtml({ logoSrc, years, season })}</div>
    <ul class="acb-hero__pills acb-hero__pills--right">${right.map(pill).join("")}</ul>
  </div>
</section>`;
}

export function tickerHtml(messages) {
  const items = messages.map((m) => `<span>${m}</span>`).join("");
  return `<div class="acb-ticker" role="marquee" aria-label="Avisos"><div class="acb-ticker__track">${items}${items}</div></div>`;
}

