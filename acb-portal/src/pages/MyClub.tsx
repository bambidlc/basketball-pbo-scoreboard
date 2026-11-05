// "Mi club": the single entry point for clubs. Search the clubs already in the
// portal and see each one's status; if it's yours, get a code and go complete
// what's missing; if it isn't there, request it right here. Every state lives
// in the URL (?club=, ?solicitar=, ?email=) so the browser's back button works.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  CircleAlert,
  CircleCheck,
  Clock3,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { api } from "../api";
import { Footer, TopBar } from "../components/Brand";
import { Alert, EmailField } from "../components/ui";
import { VerifyCode } from "../components/VerifyCode";
import { ClubRequestForm } from "../clubRequest";
import { highlightParts, hueFor, initials, matchesClub, pendingSteps } from "../clubSearch";
import { navigate, useLocation } from "../router";
import { KEY_DATES } from "../../shared/tournament.js";
import { isEmail } from "../../shared/validation.js";
import type { DirectoryClub } from "../types";

// ---------------------------------------------------------------- data
let directoryCache: { at: number; clubs: DirectoryClub[] } | null = null;

function useDirectory() {
  const [clubs, setClubs] = useState<DirectoryClub[] | null>(directoryCache?.clubs ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.get<{ clubs: DirectoryClub[] }>("/api/clubs");
      directoryCache = { at: Date.now(), clubs: result.clubs };
      setClubs(result.clubs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!directoryCache || Date.now() - directoryCache.at > 15_000) void load();
  }, [load]);
  return { clubs, loading, error, reload: load };
}

// ------------------------------------------------------------ pieces
const STEPS = [
  { title: "Busque su club", text: "Vea si ya está y qué le falta. Si no aparece, solicítelo." },
  { title: "Confirme su acceso", text: "Código de 6 dígitos al email del club." },
  { title: "Complete lo que falte", text: "Perfil, equipos y jugadores. Luego envíe a la ACB." },
];

function Avatar({ club, large }: { club: Pick<DirectoryClub, "id" | "name">; large?: boolean }) {
  return (
    <span className={`club-avatar${large ? " club-avatar--lg" : ""}`} style={{ ["--h" as string]: hueFor(club.id) }} aria-hidden="true">
      {initials(club.name)}
    </span>
  );
}

function StatusBadge({ club }: { club: DirectoryClub }) {
  if (club.state === "pending")
    return (
      <span className="mc-badge mc-badge--warn">
        <Clock3 /> Email sin confirmar
      </span>
    );
  if (club.review === "verified")
    return (
      <span className="mc-badge mc-badge--ok">
        <BadgeCheck /> Verificado ACB
      </span>
    );
  return (
    <span className="mc-badge mc-badge--info">
      <ShieldCheck /> En revisión ACB
    </span>
  );
}

function teamsLine(t: DirectoryClub["teams"]) {
  if (!t.total) return "Sin equipos todavía";
  const parts = [`${t.total} ${t.total === 1 ? "equipo" : "equipos"}`];
  const sent = t.submitted + t.approved;
  if (sent) parts.push(`${sent} ${sent === 1 ? "enviado" : "enviados"}`);
  if (t.approved) parts.push(`${t.approved} ${t.approved === 1 ? "aprobado" : "aprobados"}`);
  if (t.changes) parts.push(`${t.changes} con cambios`);
  return parts.join(" · ");
}

function Highlight({ text, query }: { text: string; query: string }) {
  return <>{highlightParts(text, query).map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}</>;
}

function ClubRow({ club, query, onOpen }: { club: DirectoryClub; query: string; onOpen: () => void }) {
  const teamsDone = club.teams.total > 0 && club.teams.draft + club.teams.changes === 0;
  const pending = club.profile.missing + club.profile.recommended;
  return (
    <button type="button" className="club-row" onClick={onOpen}>
      <Avatar club={club} />
      <span className="club-row__main">
        <span className="club-row__name">
          <Highlight text={club.name} query={query} />
        </span>
        <span className="club-row__sub">
          {club.acronym && (
            <>
              <Highlight text={club.acronym} query={query} /> ·{" "}
            </>
          )}
          <Highlight text={club.municipality || "Municipio sin indicar"} query={query} />
        </span>
        <span className="club-row__chips">
          <span className={`mc-chip ${pending ? "mc-chip--warn" : "mc-chip--ok"}`}>
            {pending ? <CircleAlert /> : <CircleCheck />}
            {pending ? `Perfil: ${pending} ${pending === 1 ? "pendiente" : "pendientes"}` : "Perfil completo"}
          </span>
          <span className={`mc-chip ${teamsDone ? "mc-chip--ok" : club.teams.total ? "mc-chip--info" : "mc-chip--muted"}`}>
            <Users />
            {teamsLine(club.teams)}
          </span>
        </span>
      </span>
      <span className="club-row__side">
        <StatusBadge club={club} />
        <span className="club-row__go">
          <span className="club-row__go-text">Ver estado</span> <ArrowRight />
        </span>
      </span>
    </button>
  );
}

function SkeletonRows() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="club-row club-row--skeleton">
          <span className="club-avatar" />
          <span className="club-row__main">
            <span className="sk sk--title" />
            <span className="sk sk--line" />
            <span className="sk sk--chips" />
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusItem({ tone, title, children }: { tone: "ok" | "warn" | "info"; title: string; children: React.ReactNode }) {
  const Icon = tone === "ok" ? CircleCheck : tone === "warn" ? CircleAlert : Clock3;
  return (
    <li className={`mc-check mc-check--${tone}`}>
      <Icon />
      <div>
        <b>{title}</b>
        <span>{children}</span>
      </div>
    </li>
  );
}

// ------------------------------------------------------------- views
function SearchView({
  clubs,
  loading,
  error,
  reload,
  query,
  setQuery,
  openClub,
  startRequest,
  goEmail,
}: {
  clubs: DirectoryClub[] | null;
  loading: boolean;
  error: string;
  reload: () => void;
  query: string;
  setQuery: (q: string) => void;
  openClub: (id: number) => void;
  startRequest: () => void;
  goEmail: (email: string) => void;
}) {
  const results = useMemo(() => (clubs || []).filter((c) => matchesClub(c, query)), [clubs, query]);
  const total = clubs?.length || 0;
  const noMatch = Boolean(clubs) && !results.length;
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState("");

  const sendEmail = async () => {
    const value = email.trim().toLowerCase();
    if (!isEmail(value)) return setEmailError("Escriba el email de acceso del club.");
    setEmailBusy(true);
    setEmailError("");
    try {
      await api.post("/api/login/request", { email: value });
      goEmail(value);
    } catch (e) {
      setEmailError((e as Error).message);
      setEmailBusy(false);
    }
  };

  return (
    <>
      <div className="mc-search">
        <Search className="mc-search__icon" aria-hidden="true" />
        <input
          className="mc-search__input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nombre, siglas o municipio"
          aria-label="Buscar club"
          autoComplete="off"
          enterKeyHint="search"
        />
        {query && (
          <button type="button" className="mc-search__clear" onClick={() => setQuery("")} aria-label="Borrar búsqueda">
            <X />
          </button>
        )}
      </div>

      <div className="mc-list" aria-live="polite">
        <div className="mc-list__head">
          <span>
            {!clubs
              ? "Cargando clubes…"
              : query
                ? `${results.length} de ${total} ${total === 1 ? "club" : "clubes"}`
                : `${total} ${total === 1 ? "club inscrito" : "clubes inscritos"} en el portal`}
          </span>
          <button type="button" className="mc-list__refresh" onClick={reload} disabled={loading} aria-label="Actualizar lista" title="Actualizar lista">
            <RefreshCw className={loading ? "spin" : ""} />
          </button>
        </div>
        {error && !clubs ? (
          <div className="mc-list__empty">
            <Alert kind="error" title="No pudimos cargar los clubes">
              {error}
            </Alert>
            <button type="button" className="btn btn--ghost btn--sm" onClick={reload}>
              <RefreshCw /> Reintentar
            </button>
          </div>
        ) : !clubs ? (
          <SkeletonRows />
        ) : results.length ? (
          results.map((club) => <ClubRow key={club.id} club={club} query={query} onOpen={() => openClub(club.id)} />)
        ) : (
          <div className="mc-list__empty">
            <Building2 />
            {total ? (
              <p>
                No encontramos <b>«{query}»</b> entre los clubes inscritos. Revise cómo lo escribió o pruebe con el municipio.
              </p>
            ) : (
              <p>
                Todavía no hay clubes inscritos para el Torneo #30. <b>¡Sea el primero!</b>
              </p>
            )}
          </div>
        )}
      </div>

      <div className={`mc-cta${noMatch ? " mc-cta--strong" : ""}`}>
        <span className="mc-cta__icon">
          <Plus />
        </span>
        <div className="mc-cta__text">
          <b>¿Su club no aparece?</b>
          <span>Solicite su inscripción aquí mismo. Toma unos 5 minutos y luego entra directo a crear sus equipos.</span>
        </div>
        <button type="button" className={`btn ${noMatch ? "btn--primary" : "btn--blue"}`} onClick={startRequest}>
          {query.trim() && noMatch ? `Solicitar «${query.trim().slice(0, 28)}»` : "Solicitar inscripción"} <ArrowRight />
        </button>
      </div>

      <div className="mc-email">
        {!emailOpen ? (
          <button type="button" className="mc-email__toggle" onClick={() => setEmailOpen(true)}>
            <Mail /> ¿Prefiere entrar con el email del club?
          </button>
        ) : (
          <form
            className="mc-email__form"
            onSubmit={(e) => {
              e.preventDefault();
              void sendEmail();
            }}
          >
            <EmailField label="Email de acceso del club" value={email} onChange={setEmail} error={emailError || undefined} autoFocus />
            <button className="btn btn--blue" disabled={emailBusy}>
              {emailBusy ? "Enviando…" : "Enviarme el código"}
            </button>
          </form>
        )}
      </div>
    </>
  );
}

function ClubView({ club, loading, onBack }: { club: DirectoryClub | undefined; loading: boolean; onBack: () => void }) {
  const [sent, setSent] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const clubId = club?.id;

  useEffect(() => {
    setSent("");
    setError("");
  }, [clubId]);

  if (!club) {
    return (
      <>
        <button type="button" className="link-back" onClick={onBack}>
          <ArrowLeft /> Todos los clubes
        </button>
        <div className="mc-card">
          {loading ? (
            <SkeletonRows />
          ) : (
            <Alert kind="warn" title="No encontramos ese club">
              Búsquelo de nuevo en la lista.
            </Alert>
          )}
        </div>
      </>
    );
  }

  const send = async () => {
    setSending(true);
    setError("");
    try {
      const result = await api.post<{ emailHint: string }>(`/api/clubs/${club.id}/code`);
      setSent(result.emailHint || club.emailHint);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const todo = pendingSteps(club);
  const t = club.teams;
  const teamsTone = t.total && !t.draft && !t.changes ? "ok" : t.changes || !t.total ? "warn" : "info";

  return (
    <>
      <button type="button" className="link-back" onClick={onBack}>
        <ArrowLeft /> Todos los clubes
      </button>
      <div className="mc-card mc-club">
        <div className="mc-club__head">
          <Avatar club={club} large />
          <div className="mc-club__title">
            <h2 className="h2">{club.name}</h2>
            <p className="muted">{[club.acronym, club.municipality].filter(Boolean).join(" · ")}</p>
          </div>
          <StatusBadge club={club} />
        </div>

        <div className="mc-club__body">
          <section className="mc-status" aria-label="Estado de la inscripción">
            <div className="mc-status__title">Estado de la inscripción</div>
            <ul className="mc-checks">
              <StatusItem tone="ok" title="Club registrado">
                Ya está en el portal de la ACB.
              </StatusItem>
              <StatusItem tone={club.state === "active" ? "ok" : "warn"} title="Acceso por email">
                {club.state === "active" ? `Confirmado · ${club.emailHint}` : `Sin confirmar · ${club.emailHint}`}
              </StatusItem>
              <StatusItem tone={club.profile.missing + club.profile.recommended ? "warn" : "ok"} title="Perfil del club">
                {club.profile.missing
                  ? club.profile.missing === 1 ? "Falta 1 dato requerido" : `Faltan ${club.profile.missing} datos requeridos`
                  : club.profile.recommended
                    ? `${club.profile.recommended === 1 ? "Falta 1 dato" : `Faltan ${club.profile.recommended} datos`} (póliza, cancha o fechas)`
                    : "Completo"}
              </StatusItem>
              <StatusItem tone={teamsTone} title="Equipos">
                {teamsLine(t)}
              </StatusItem>
              <StatusItem tone={club.review === "verified" ? "ok" : "info"} title="Revisión de la ACB">
                {club.review === "verified" ? "Club verificado por la ACB." : "La ACB revisará el club. Puede seguir trabajando mientras tanto."}
              </StatusItem>
            </ul>
            {todo.length ? (
              <div className="mc-todo">
                <b>Le falta</b>
                <ol>
                  {todo.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="mc-todo mc-todo--done">
                <b>¡Todo enviado!</b> Imprima los documentos de cada equipo y llévelos el sábado 23 de enero de 2027.
              </div>
            )}
          </section>

          <section className="mc-access" aria-label="Entrar al portal del club">
            {!sent ? (
              <>
                <span className="mc-access__icon">
                  <Mail />
                </span>
                <div className="h3">¿Es su club?</div>
                <p>
                  Entre para completar lo que falta. Enviaremos un código de 6 dígitos al email de acceso del club: <b>{club.emailHint}</b>
                </p>
                {error && <Alert kind="error">{error}</Alert>}
                <button type="button" className="btn btn--primary btn--lg btn--block" onClick={send} disabled={sending}>
                  {sending ? "Enviando…" : "Enviar código"} {!sending && <ArrowRight />}
                </button>
                <p className="small mc-access__help">
                  ¿Ya no usa ese email? Llame a la ACB (Prof. Bobby Ramírez) al <a href="tel:+17876324848">787-632-4848</a> para actualizarlo.
                </p>
              </>
            ) : (
              <VerifyCode
                target={{ clubId: club.id }}
                shownEmail={sent}
                title="Escriba su código"
                intro="Lo enviamos a"
                onBack={() => setSent("")}
                backLabel="Cancelar"
              />
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function Aside() {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = KEY_DATES.filter((d) => (d.end || d.date) >= today).slice(0, 3);
  return (
    <aside className="mc-aside">
      <div className="mc-side">
        <div className="h3">Qué va a necesitar</div>
        <ul className="reqs">
          <li>Datos del club, del presidente y de un contacto principal.</li>
          <li>Póliza de seguro de accidentes del club.</li>
          <li>Cancha sede y fechas disponibles (puede completarlas después).</li>
          <li>Por equipo: dirigentes con tarjeta federativa, colores y hasta 13 jugadores con certificado de nacimiento.</li>
        </ul>
      </div>
      {upcoming.length > 0 && (
        <div className="mc-side mc-side--dark">
          <div className="h3">Próximas fechas</div>
          <ul className="mc-dates">
            {upcoming.map((d) => (
              <li key={d.id}>
                <b>{d.title}</b>
                <span>{d.when}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mc-side">
        <div className="h3">¿Necesita ayuda?</div>
        <p className="small muted" style={{ margin: "4px 0 10px" }}>
          Prof. Roberto "Bobby" Ramírez · Director Ejecutivo
        </p>
        <a className="mc-contact" href="tel:+17876324848">
          <Phone /> 787-632-4848
        </a>
        <a className="mc-contact" href="mailto:bobbyramirez48@yahoo.com">
          <Mail /> bobbyramirez48@yahoo.com
        </a>
      </div>
    </aside>
  );
}

// -------------------------------------------------------------- page
export function MyClub() {
  const { search } = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const clubId = Number(params.get("club")) || 0;
  const requesting = params.get("solicitar") === "1";
  const email = (params.get("email") || "").trim().toLowerCase();
  const justRequested = params.get("nuevo") === "1";
  const next = params.get("next") || "";
  const { clubs, loading, error, reload } = useDirectory();
  const [query, setQuery] = useState("");

  const go = (values: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    if (next) p.set("next", next);
    for (const [key, value] of Object.entries(values)) if (value) p.set(key, value);
    const qs = p.toString();
    navigate(`/mi-club${qs ? `?${qs}` : ""}`);
  };

  const view = email ? "verify" : requesting ? "request" : clubId ? "club" : "search";
  const stepIndex = view === "search" || view === "request" ? 0 : 1;
  const selected = clubs?.find((c) => c.id === clubId);

  // Moving between views keeps the steps and the new content in sight
  // (navigate() jumps to the top of the page).
  const viewKey = `${view}:${clubId}`;
  const lastView = useRef(viewKey);
  useEffect(() => {
    if (lastView.current === viewKey) return;
    lastView.current = viewKey;
    document.querySelector(".mc-steps")?.scrollIntoView({ block: "start" });
  }, [viewKey]);

  // A new request or a fresh sign-in should show up in the list right away.
  useEffect(() => {
    if (view === "search" && directoryCache && Date.now() - directoryCache.at > 15_000) void reload();
  }, [view, reload]);

  let content;
  if (view === "verify") {
    content = (
      <div className="mc-card mc-card--narrow">
        <VerifyCode
          target={{ email }}
          shownEmail={email}
          title={justRequested ? "¡Solicitud enviada!" : "Revise su email"}
          intro={
            justRequested
              ? "Para confirmar su email y entrar a crear sus equipos, escriba el código de 6 dígitos que enviamos a"
              : "Escriba el código de 6 dígitos que enviamos a"
          }
          onBack={() => go()}
          backLabel="Buscar mi club"
        />
      </div>
    );
  } else if (view === "request") {
    content = (
      <ClubRequestForm
        initialName={params.get("nombre") || query}
        clubs={clubs || []}
        onCancel={() => go()}
        onSubmitted={(value) => go({ email: value, nuevo: "1" })}
        onShowClub={(id) => go({ club: String(id) })}
      />
    );
  } else if (view === "club") {
    content = <ClubView club={selected} loading={!clubs || loading} onBack={() => go()} />;
  } else {
    content = (
      <SearchView
        clubs={clubs}
        loading={loading}
        error={error}
        reload={reload}
        query={query}
        setQuery={setQuery}
        openClub={(id) => go({ club: String(id) })}
        startRequest={() => go({ solicitar: "1", nombre: query.trim() })}
        goEmail={(value) => go({ email: value })}
      />
    );
  }

  return (
    <>
      <TopBar />
      <section className="mc-head">
        <div className="wrap">
          <p className="eyebrow">Portal de clubes · Torneo #30</p>
          <h1 className="display">
            Su club, <em>en un solo lugar</em>
          </h1>
          <p className="mc-head__lead">
            Busque su club para ver el estado de su inscripción. Si ya está, entre con un código y complete lo que falte. Si no aparece, solicite su inscripción
            aquí mismo.
          </p>
          <ol className="mc-steps" aria-label="Pasos">
            {STEPS.map((s, i) => (
              <li key={s.title} className={i < stepIndex ? "is-done" : i === stepIndex ? "is-current" : ""} aria-current={i === stepIndex ? "step" : undefined}>
                <span className="mc-steps__num">{i < stepIndex ? <CircleCheck /> : i + 1}</span>
                <span className="mc-steps__text">
                  <b>{s.title}</b>
                  <small>{s.text}</small>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <main className="mc-main" id="mi-club-main">
        <div className={`wrap mc-grid${view === "request" ? " mc-grid--wide" : ""}`}>
          <div className="mc-col">{content}</div>
          <Aside />
        </div>
      </main>
      <Footer />
    </>
  );
}
