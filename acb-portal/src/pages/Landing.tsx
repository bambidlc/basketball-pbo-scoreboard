import {
  Building2,
  CalendarCheck2,
  CircleDot,
  Clock3,
  FileText,
  MailCheck,
  MapPin,
  Printer,
  ShieldCheck,
  Shirt,
  Users,
} from "lucide-react";
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
  RULES,
  categoryBirthYear,
  formatDateShort,
  money,
} from "../../shared/tournament.js";
import { Footer, Hero, Ticker, TopBar } from "../components/Brand";
import { Link } from "../router";

const LEFT = [
  { label: "Registrar mi club", to: "/registro", orange: true },
  { label: "Entrar al portal", to: "/entrar" },
  { label: "Cómo funciona", to: "#como" },
  { label: "Requisitos", to: "#requisitos" },
  { label: "Costos", to: "#costos" },
  { label: "Fechas clave", to: "#fechas" },
];
const RIGHT = [
  { label: "Calendario 2027", to: "#calendario" },
  { label: "Elegibilidad", to: "#elegibilidad" },
  { label: "Uniformes", to: "#uniformes" },
  { label: "Canchas y acomodos", to: "#canchas" },
  { label: "Documentos", to: "#documentos" },
  { label: "Contacto", to: "#contacto" },
];

export function Landing() {
  const today = new Date().toISOString().slice(0, 10);
  const nextId = KEY_DATES.find((d) => (d.end || d.date) >= today)?.id;
  return (
    <>
      <TopBar />
      <Hero left={LEFT} right={RIGHT} tag="Portal de Inscripción · Torneo #30" />
      <Ticker
        messages={[
          "Inscripción de equipos: sábados 12 y 19 de diciembre de 2026 · Club de Baloncesto Fraigcomar",
          "Inicio del Torneo #30: sábado 6 de febrero de 2027",
          "Fechas de cancha y acomodos de dirigentes: antes del 30 de diciembre",
          "Entrega de uniformes y documentos: sábado 23 de enero de 2027",
        ]}
      />

      <section className="band band--dark">
        <div className="wrap intro">
          <div>
            <p className="eyebrow">Inscripción de equipos</p>
            <h1 className="display" style={{ fontSize: "clamp(54px, 9vw, 120px)" }}>
              Torneo <em>#30</em>
            </h1>
            <div className="intro__start">
              <b>INICIO</b>
              <span>Sábado 6 de febrero de 2027</span>
            </div>
            <div className="chips">
              <span className="chip-skew chip-skew--blue">ACB Regular</span>
              <span className="chip-skew chip-skew--orange">ACB Alternativo</span>
            </div>
          </div>
          <div className="intro__cta">
            <div className="h3">Inscriba su club en línea</div>
            <p>
              Registre la información del club, reciba su acceso por email y complete cada equipo: personal técnico, uniformes, jugadores y autorizaciones. El
              portal genera la Hoja de Uniformes, la Lista Oficial, el Carnet y el Roster listos para imprimir.
            </p>
            <Link to="/registro" className="btn btn--primary btn--lg btn--block">
              Registrar mi club
            </Link>
            <Link to="/entrar" className="btn btn--ghost btn--lg btn--block">
              Ya tengo acceso · Entrar
            </Link>
          </div>
        </div>
      </section>

      <section className="band" id="como">
        <div className="wrap">
          <p className="eyebrow">Cómo funciona</p>
          <h2 className="display">
            Cuatro pasos <em>y listo</em>
          </h2>
          <div className="steps">
            <div className="step">
              <Building2 />
              <div className="h3">Registre su club</div>
              <p>Datos del club, presidente, contacto, cancha sede y póliza de seguro.</p>
            </div>
            <div className="step">
              <MailCheck />
              <div className="h3">Reciba su acceso</div>
              <p>Le enviamos un código de 6 dígitos al email del club. Sin contraseñas.</p>
            </div>
            <div className="step">
              <Users />
              <div className="h3">Complete sus equipos</div>
              <p>Categoría, dirigentes, colores, tallas y los 13 jugadores con autorización del encargado.</p>
            </div>
            <div className="step">
              <Printer />
              <div className="h3">Imprima y entregue</div>
              <p>Lleve los formularios generados y los certificados originales el 23 de enero.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="band band--white" id="requisitos">
        <div className="wrap">
          <p className="eyebrow">Inscripción ACB Regular y ACB Alternativo</p>
          <h2 className="display">
            Requisitos <em>2027</em>
          </h2>
          <div className="split">
            <div className="panel panel--orange">
              <p className="eyebrow">Inscripción presencial</p>
              <div className="panel__big">
                Sábados
                <br />
                12 y 19 de diciembre 2026
              </div>
              <div className="meta">
                <Clock3 /> 10:00 AM – 3:00 PM
              </div>
              <div className="meta">
                <MapPin /> Club de Baloncesto Fraigcomar
              </div>
            </div>
            <div className="panel">
              <p className="eyebrow">Requisitos</p>
              <ul className="reqs">
                <li>Hoja de uniformes completada (el portal la genera por usted).</li>
                <li>
                  Pago total de inscripción o <b>depósito de {money(DEPOSIT_PER_TEAM)}</b> por equipo.
                </li>
                <li>
                  Roster de <b>13 jugadores</b>; ACB provee <b>12 uniformes</b>.
                </li>
                <li>
                  El uniforme #13 debe incluirse en el formulario inicial: <b>{money(EXTRA_UNIFORM_FEE)}</b>.
                </li>
                <li className="is-alert">No se recibirán peticiones de uniformes que no estén incluidos en el formulario de uniformes sometido inicialmente.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="band band--dark" id="costos">
        <div className="wrap">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <p className="eyebrow">Costos de inscripción</p>
              <h2 className="display">
                Inscripción <em>por equipo</em>
              </h2>
            </div>
            <span className="note-pill">★ Se mantienen los mismos costos del pasado torneo</span>
          </div>
          <div className="fees">
            {FEE_BRACKETS.map((b) => (
              <div className="fee" key={b.from}>
                <div className="fee__age">
                  {b.from} – {b.to}
                  <small>AÑOS</small>
                </div>
                <div className="fee__price">{money(b.fee)}</div>
              </div>
            ))}
          </div>
          <div className="perks">
            <div className="perk perk--orange">
              <CircleDot /> Incluye un balón
            </div>
            <div className="perk perk--blue">
              <ShieldCheck /> Mínimo 8 juegos garantizados
            </div>
          </div>
          <p className="lead" style={{ marginTop: 18 }}>
            Adicionales: uniforme #13 {money(EXTRA_UNIFORM_FEE)} · pantalón corto para dirigentes {money(COACH_SHORTS_FEE)} · depósito para separar el equipo{" "}
            {money(DEPOSIT_PER_TEAM)}. Pago final: 23 de enero de 2027.
          </p>
        </div>
      </section>

      <section className="band" id="fechas">
        <div className="wrap wrap--narrow">
          <p className="eyebrow">Agenda</p>
          <h2 className="display">
            Fechas <em>clave</em>
          </h2>
          <div className="timeline">
            {KEY_DATES.map((d) => {
              const day = d.date.slice(8, 10);
              const past = (d.end || d.date) < today;
              return (
                <div key={d.id} className={`tl-item ${past ? "is-past" : ""} ${d.id === nextId ? "is-next" : ""}`}>
                  <div className="tl-date">
                    <b>{Number(day)}</b>
                    <span>{formatDateShort(d.date).split(" ")[2]}</span>
                  </div>
                  <div>
                    <h4>{d.title}</h4>
                    <p className="tl-when">{d.when}</p>
                    <p>
                      <MapPin size={14} /> {d.where}
                    </p>
                    <p>{d.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="band band--white" id="calendario">
        <div className="wrap">
          <p className="eyebrow">Calendario del Torneo ACB 2027</p>
          <h2 className="display">
            Temporada <em>2027</em>
          </h2>
          <div className="cal-grid">
            {CALENDAR.map((g) => (
              <div className="cal-card" key={g.group}>
                <h4>{g.group}</h4>
                {g.phases.map((p) => (
                  <div className="cal-phase" key={p.phase}>
                    <b>{p.phase}</b>
                    <div className="cal-dates">
                      {p.dates.map((d) => (
                        <span key={d} style={{ textTransform: "capitalize" }}>
                          {formatDateShort(d)}
                        </span>
                      ))}
                    </div>
                    {p.note && <p className="small muted" style={{ margin: "6px 0 0" }}>{p.note}</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band band--dark" id="elegibilidad">
        <div className="wrap">
          <p className="eyebrow">Torneo ACB 2027</p>
          <h2 className="display">
            Fecha de elegibilidad <em>por categorías</em>
          </h2>
          <p className="lead">Cada categoría corresponde al año de nacimiento. Un jugador puede jugar en una categoría superior, nunca en una menor.</p>
          <div className="elig">
            {CATEGORIES.map((c) => (
              <div key={c}>
                <b>{c}</b>
                <span>Nacidos en {categoryBirthYear(c)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band" id="uniformes">
        <div className="wrap">
          <p className="eyebrow">Formulario para uniformes 2027</p>
          <h2 className="display">
            Uniformes <em>y tallas</em>
          </h2>
          <div className="split">
            <div className="panel">
              <div className="h3" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Shirt size={22} color="#f26a1b" /> Lo que incluye
              </div>
              <ul className="reqs">
                <li>ACB provee 12 uniformes por equipo (camiseta y pantalón).</li>
                <li>Uniforme #13: {money(EXTRA_UNIFORM_FEE)} y debe estar en el formulario inicial.</li>
                <li>Pantalón corto para dirigentes: {money(COACH_SHORTS_FEE)} (indique el tamaño de cintura).</li>
                <li>Indique color de camiseta, color de letras y números, y color de pantalón.</li>
                <li className="is-alert">{RULES.uniforms}</li>
              </ul>
            </div>
            <div className="panel">
              <div className="h3">Tallas disponibles</div>
              <table className="size-table" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Niños</th>
                    <th>Adulto</th>
                  </tr>
                </thead>
                <tbody>
                  {KID_SIZES.map((k, i) => (
                    <tr key={k.value}>
                      <td>{k.label}</td>
                      <td style={{ textAlign: "left" }}>{ADULT_SIZES[i]?.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="band band--white" id="canchas">
        <div className="wrap">
          <p className="eyebrow">Disponibilidad de canchas y dirigentes con 2 equipos</p>
          <h2 className="display">
            Canchas <em>y acomodos</em>
          </h2>
          <div className="split">
            <div className="panel panel--orange">
              <p className="eyebrow">Fecha límite</p>
              <div className="panel__big">30 de diciembre de 2026</div>
              <p style={{ margin: 0, fontWeight: 600 }}>
                Marque en el portal las fechas disponibles de su cancha para los carnavales y los dirigentes que tendrán 2 equipos.
              </p>
            </div>
            <div className="panel">
              <ul className="reqs">
                <li>Un dirigente no puede dirigir dos equipos en una misma categoría.</li>
                <li>Un dirigente puede dirigir un máximo de 2 equipos.</li>
                <li>El acomodo de horario será AM (hasta el mediodía) o PM (después del mediodía). No se aceptan horas específicas.</li>
                <li className="is-alert">No se aceptarán nuevos acomodos luego de haber iniciado el torneo.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="band" id="documentos">
        <div className="wrap">
          <p className="eyebrow">Documentos oficiales</p>
          <h2 className="display">
            El portal <em>los llena por usted</em>
          </h2>
          <div className="steps" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="step">
              <Shirt />
              <div className="h3">Hoja de uniformes</div>
              <p>Colores, número, nombre y tallas de cada jugador con el resumen por talla.</p>
            </div>
            <div className="step">
              <FileText />
              <div className="h3">Lista oficial</div>
              <p>Jugadores, fecha de nacimiento, escuela, grado y autorización del encargado.</p>
            </div>
            <div className="step">
              <Users />
              <div className="h3">Carnet</div>
              <p>Tarjetas por jugador con foto y número, y espacios para las tarjetas federativas.</p>
            </div>
            <div className="step">
              <CalendarCheck2 />
              <div className="h3">Roster de juego</div>
              <p>Tres copias para ser ponchadas, con la certificación de la Regla 3.</p>
            </div>
          </div>
          <p className="lead" style={{ marginTop: 22 }}>
            {RULES.documents}
          </p>
        </div>
      </section>

      <section className="band band--dark" id="contacto">
        <div className="wrap" style={{ textAlign: "center" }}>
          <p className="eyebrow" style={{ justifyContent: "center" }}>
            ¿Listo para el Torneo #30?
          </p>
          <h2 className="display" style={{ fontSize: "clamp(36px, 6vw, 72px)" }}>
            Inscriba su club <em>hoy</em>
          </h2>
          <p className="lead">
            Dudas sobre la inscripción: Prof. Roberto "Bobby" Ramírez · <a href="tel:+17876324848" style={{ color: "#ffb27a" }}>787-632-4848</a> ·{" "}
            <a href="mailto:bobbyramirez48@yahoo.com" style={{ color: "#ffb27a" }}>
              bobbyramirez48@yahoo.com
            </a>
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 24 }}>
            <Link to="/registro" className="btn btn--primary btn--lg">
              Registrar mi club
            </Link>
            <Link to="/entrar" className="btn btn--ghost btn--lg">
              Entrar al portal
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
