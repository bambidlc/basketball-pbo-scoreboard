import { useMemo, type MouseEvent, type ReactNode } from "react";
import { LogOut, Mail, MapPin, Phone, Search } from "lucide-react";
import { heroCenterHtml } from "../../shared/hero.js";
import { flyerHtml } from "../../shared/flyer.js";
import { Link, navigate, useLocation } from "../router";
import { api } from "../api";

export type PillItem = { label: string; to: string; orange?: boolean };

export function Hero({ left, right, compact }: { left: PillItem[]; right: PillItem[]; compact?: boolean }) {
  const center = useMemo(() => ({ __html: heroCenterHtml({ logoSrc: "/acb-logo.png" }) }), []);
  const pill = (item: PillItem) => (
    <li key={item.label}>
      <Link to={item.to} className={`acb-pill${item.orange ? " acb-pill--orange" : ""}`}>
        {item.label}
      </Link>
    </li>
  );
  return (
    <section className={`acb-hero${compact ? " acb-hero--compact" : ""}`} aria-label="ACB Torneo #30">
      <div className="acb-hero__inner">
        <ul className="acb-hero__pills acb-hero__pills--left">{left.map(pill)}</ul>
        <div className="acb-hero__center" dangerouslySetInnerHTML={center} />
        <ul className="acb-hero__pills acb-hero__pills--right">{right.map(pill)}</ul>
      </div>
    </section>
  );
}

export function Ticker({ messages }: { messages: string[] }) {
  const items = messages.map((m, i) => <span key={i}>{m}</span>);
  return (
    <div className="acb-ticker" role="marquee" aria-label="Avisos">
      <div className="acb-ticker__track">
        {items}
        {messages.map((m, i) => (
          <span key={`b${i}`} aria-hidden="true">
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The "Torneo #30" announcement sheet shown right after the hero (shared with the Odoo site). */
export function Flyer() {
  const html = useMemo(() => ({ __html: flyerHtml({ logoSrc: "/acb-logo.png", ctaHref: "/mi-club" }) }), []);
  // Keep in-app links inside the single-page app.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest("a");
    const href = link?.getAttribute("href") || "";
    if (!link || !href.startsWith("/") || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };
  return <div onClick={onClick} dangerouslySetInnerHTML={html} />;
}

export function TopBar({ clubName, children }: { clubName?: string; children?: ReactNode }) {
  const { path } = useLocation();
  const logout = async () => {
    await api.post("/api/logout").catch(() => undefined);
    navigate("/mi-club");
  };
  return (
    <header className="topbar">
      <div className="wrap topbar__inner">
        <Link to={clubName ? "/portal" : "/"} className="brand" aria-label="Portal ACB">
          <img src="/acb-logo-256.png" alt="" width={46} height={39} />
          <span className="brand__text">
            <span className="brand__title">Inscripción ACB</span>
            <span className="brand__sub">Torneo #30 · 2027</span>
          </span>
        </Link>
        <nav className="topbar__nav">
          {children}
          {clubName ? (
            <>
              <Link to="/portal" className="topbar__link" aria-current={path === "/portal" ? "page" : undefined}>
                Equipos
              </Link>
              <Link to="/portal/club" className="topbar__link" aria-current={path === "/portal/club" ? "page" : undefined}>
                Perfil del club
              </Link>
              <div className="topbar__club">
                <span className="topbar__club-name" title={clubName}>
                  {clubName}
                </span>
                <button className="icon-btn" type="button" onClick={logout} aria-label="Salir" title="Salir">
                  <LogOut />
                </button>
              </div>
            </>
          ) : (
            <>
              {path !== "/" && (
                <Link to="/" className="topbar__link">
                  Información
                </Link>
              )}
              <Link to="/mi-club" className="btn btn--primary btn--sm" aria-current={path === "/mi-club" ? "page" : undefined}>
                <Search /> Mi club
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer__grid">
          <div>
            <h5>Asociación de Clubes de Baloncesto de Puerto Rico</h5>
            <p style={{ margin: 0 }}>
              Torneo #30 · Temporada 2027. Tres décadas de baloncesto juvenil de clubes en Puerto Rico.
            </p>
          </div>
          <div>
            <h5>Directiva</h5>
            <p style={{ margin: "0 0 6px" }}>
              <b style={{ color: "#fff" }}>Lic. Miguel Laborde Freyre</b> · Presidente
              <br />
              <Phone size={13} /> <a href="tel:+17874623842">787-462-3842</a>
            </p>
            <p style={{ margin: 0 }}>
              <b style={{ color: "#fff" }}>Prof. Roberto "Bobby" Ramírez</b> · Director Ejecutivo
              <br />
              <Phone size={13} /> <a href="tel:+17876324848">787-632-4848</a> · <Mail size={13} />{" "}
              <a href="mailto:bobbyramirez48@yahoo.com">bobbyramirez48@yahoo.com</a>
            </p>
          </div>
          <div>
            <h5>Fechas clave</h5>
            <p style={{ margin: "0 0 6px" }}>
              <MapPin size={13} /> Inscripción: 12 y 19 de diciembre de 2026 · Club de Baloncesto Fraigcomar
            </p>
            <p style={{ margin: 0 }}>
              <MapPin size={13} /> Entrega de uniformes y documentos: 23 de enero de 2027 · Colegio Universitario de San Juan
            </p>
          </div>
        </div>
        <div className="footer__bottom">
          <span>© 2027 ACB Puerto Rico · Portal de Inscripción</span>
          <span>Sus datos se usan solo para la inscripción y organización del torneo.</span>
        </div>
      </div>
    </footer>
  );
}
