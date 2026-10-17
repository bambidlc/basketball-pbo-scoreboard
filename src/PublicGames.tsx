import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, ChevronRight, Circle, Clock3, Radio, RefreshCw, Trophy } from "lucide-react";
import { cn } from "./lib/cn";

type Team = { id: number; name: string; category: string; logo: string };
type Game = { id: number; publicUrl: string; stage: string; division: string; datetime: string | null; status: string; away: Team; home: Team; awayScore: number; homeScore: number; location: string; period: number; clock: number | null };
type Player = { id: number; name: string; teamId: number; points: number; quarters: number[]; fouls: number };
type Event = { id: number; action: string; player: string; teamId: number; period: number; clock: number | null; points: number; score: string };
type Feed = { games?: Game[]; game?: Game; players?: Player[]; events?: Event[]; updatedAt: string; stale: boolean };
const WEBSITE = "https://www.pbopr.com";
const FACEBOOK = "https://www.facebook.com/stories/105611368887941/UzpfSVNDOjExMzg1MTA1MDE5MzU3NDQ=/?view_single=1&source=shared_permalink&mibextid=wwXIfr";
const zone = "America/Puerto_Rico";
const dayKey = (date: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
const dayLabel = (date: string) => new Intl.DateTimeFormat("es-PR", { timeZone: zone, weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00-04:00`));
const timeLabel = (date: string | null) => date ? new Intl.DateTimeFormat("es-PR", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(date)) : "Hora por confirmar";
const syncLabel = (date: string) => new Intl.DateTimeFormat("es-PR", { timeZone: zone, hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(date));
const clockLabel = (value: number | null) => value === null ? "" : `${Math.floor(Math.max(0, value) / 60)}:${String(Math.floor(Math.max(0, value) % 60)).padStart(2, "0")}`;
const periodLabel = (period: number) => period > 4 ? `TE ${period - 4}` : period > 0 ? `${period}º cuarto` : "";
const final = (g: Game) => ["Played", "Final"].includes(g.status);
const statusLabel = (g: Game) => g.status === "Live" ? "En vivo" : final(g) ? "Finalizado" : g.status === "Suspended" ? "Suspendido" : g.status === "Cancelled" ? "Cancelado" : "Por jugar";
const actionLabels: Record<string, string> = { "made 2pt": "Canasta de 2", "made 3pt": "Triple", "free throw made": "Tiro libre anotado", "free throw missed": "Tiro libre fallado", "missed 2pt": "Tiro de 2 fallado", "missed 3pt": "Triple fallado", made: "Canasta", missed: "Tiro fallado", "offensive rebound": "Rebote ofensivo", "defensive rebound": "Rebote defensivo", assist: "Asistencia", turnover: "Pérdida de balón", steal: "Robo", block: "Tapón", "personal foul": "Falta personal", "tech foul": "Falta técnica", "admin tech": "Falta técnica administrativa", warning: "Advertencia", substitution: "Cambio de jugador", suspension: "Suspensión", cancellation: "Cancelación" };
const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600";

function useFeed(path: string) {
  const [data, setData] = useState<Feed>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let disposed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function load() {
      if (disposed || running || document.hidden) return;
      clearTimeout(timer);
      running = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 18000);
      try {
        const response = await fetch(path, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 404 ? "Este partido no está disponible en las finales." : "No se pudo actualizar. Conservamos la última información disponible.");
        const result = await response.json() as Feed;
        if (!disposed) { setData(result); setError(result.stale ? "La conexión está demorada. Estos son los últimos datos recibidos." : ""); }
      } catch (e) {
        if (!disposed) setError(e instanceof Error && e.name !== "AbortError" ? e.message : "La conexión está demorada. Volveremos a intentar actualizar.");
      } finally {
        clearTimeout(timeout);
        running = false;
        if (!disposed) { setLoading(false); timer = setTimeout(load, 15000); }
      }
    }
    function onVisible() { if (document.hidden) clearTimeout(timer); else void load(); }
    void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", onVisible); };
  }, [path, version]);
  return { data, error, loading, refresh: () => setVersion(value => value + 1) };
}

function Badge({ game }: { game: Game }) {
  return <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", game.status === "Live" ? "bg-orange-600 text-white" : final(game) ? "bg-neutral-900 text-white" : "bg-stone-100 text-stone-600")}>
    {game.status === "Live" && <Radio className="size-3.5" aria-hidden="true" />}{final(game) && <Check className="size-3" aria-hidden="true" />}{statusLabel(game)}
  </span>;
}

function TeamLogo({ team, large = false }: { team: Team; large?: boolean }) {
  return <span className={cn("flex shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-white font-black text-stone-400", large ? "size-16 sm:size-20" : "size-10")}>
    {team.logo ? <img src={team.logo} alt="" loading="lazy" className="size-full object-contain p-1.5" /> : team.name.slice(0, 1)}
  </span>;
}

function GameCard({ game }: { game: Game }) {
  const scored = game.status === "Live" || final(game);
  return <a href={`/juegos/${game.id}`} aria-label={`Seguir ${game.away.name} contra ${game.home.name}, ${statusLabel(game)}`} className={cn("block min-w-0 rounded-2xl border bg-white p-5 shadow-sm hover:border-orange-600", focus, game.status === "Live" ? "border-orange-600" : "border-stone-200")}>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-semibold text-stone-500">{game.away.category || game.home.category} · {game.stage}{game.division && ` · Div. ${game.division}`}</span><Badge game={game} />
    </div>
    {([['away', game.away, game.awayScore], ['home', game.home, game.homeScore]] as const).map(([side, team, score]) => <div key={side} className="mt-3 flex items-center gap-3">
      <TeamLogo team={team} /><span className="min-w-0 flex-1 text-base font-bold leading-snug text-pretty">{team.name}</span>
      <span className={cn("text-3xl font-black tabular-nums", final(game) && score < (side === "away" ? game.homeScore : game.awayScore) && "text-stone-400")}>{scored ? score : "—"}</span>
    </div>)}
    <div className="mt-5 flex items-center justify-between gap-3 border-t border-stone-100 pt-3 text-xs">
      <span className="flex items-center gap-1.5 text-stone-500"><Clock3 className="size-3.5" aria-hidden="true" />{game.status === "Live" ? [periodLabel(game.period), clockLabel(game.clock)].filter(Boolean).join(" · ") || "Partido en curso" : timeLabel(game.datetime)}</span>
      <span className="inline-flex items-center gap-1 font-bold text-orange-700">{final(game) ? "Ver resultado" : "Seguir partido"}<ChevronRight className="size-4" aria-hidden="true" /></span>
    </div>
    {game.location && <p className="mt-2 truncate text-xs text-stone-500">{game.location}</p>}
  </a>;
}

function GameDetail({ data }: { data: Feed }) {
  const game = data.game!;
  const players = data.players || [];
  const scored = game.status === "Live" || final(game);
  return <>
    <a href="/juegos" className={cn("mb-6 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-stone-600", focus)}><ArrowLeft className="size-4" aria-hidden="true" />Todos los juegos de las finales</a>
    <section aria-label="Marcador del partido" className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-center gap-3 text-sm"><span className="font-bold text-stone-500">{game.away.category} · {game.stage} · División {game.division}</span><Badge game={game} /></div>
      <div className="mx-auto mt-8 grid max-w-3xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3 sm:gap-8">
        {([['away', game.away, game.awayScore], ['home', game.home, game.homeScore]] as const).map(([side, team, score], index) => <div key={side} className={cn("flex min-w-0 flex-col items-center text-center", index === 1 && "col-start-3 row-start-1")}>
          <TeamLogo team={team} large /><h2 className="mt-3 min-h-12 text-sm font-bold text-balance sm:text-lg">{team.name}</h2><span className="mt-3 text-6xl font-black tabular-nums sm:text-7xl">{scored ? score : "—"}</span><span className="mt-2 text-xs text-stone-500">{side === "away" ? "Visitante" : "Local"}</span>
        </div>)}
        <div className="col-start-2 row-start-1 mt-8 text-center"><span className="text-xs font-bold text-stone-400">{game.status === "Live" ? periodLabel(game.period) : "VS"}</span>{game.status === "Live" && game.clock !== null && <p className="mt-2 text-xl font-bold tabular-nums">{clockLabel(game.clock)}</p>}</div>
      </div>
      <p className="mt-8 text-center text-sm text-stone-500 text-pretty">{game.datetime && dayLabel(dayKey(game.datetime))} · {timeLabel(game.datetime)}{game.location && ` · ${game.location}`}</p>
      {!scored && <p className="mt-4 text-center text-sm text-stone-600 text-pretty">El marcador aparecerá cuando la mesa inicie el partido.</p>}
    </section>
    <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <section className="min-w-0 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6" aria-labelledby="players-title">
        <h2 id="players-title" className="text-lg font-bold text-balance">Puntos por jugador</h2><p className="mt-1 text-sm text-stone-500 text-pretty">Estadísticas registradas por la mesa del partido.</p>
        {[game.away, game.home].map(team => {
          const roster = players.filter(p => p.teamId === team.id).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
          return <div className="mt-6" key={team.id}><h3 className="mb-3 text-sm font-bold text-balance">{team.name}</h3>{roster.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular-nums"><thead><tr className="border-b border-stone-200 text-xs text-stone-500"><th className="py-2 pr-3 font-medium">Jugador</th>{['1C', '2C', '3C', '4C', 'TE', 'PTS'].map(q => <th key={q} className="px-2 text-right font-medium">{q}</th>)}</tr></thead><tbody>{roster.map(p => <tr key={p.id} className="border-b border-stone-100 last:border-0"><th scope="row" className="min-w-32 py-3 pr-3 font-medium">{p.name}</th>{p.quarters.map((q, i) => <td key={i} className="px-2 text-right text-stone-500">{q}</td>)}<td className="pl-2 text-right font-bold">{p.points}</td></tr>)}</tbody><tfoot><tr className="border-t border-stone-200 font-bold"><th className="py-3">Total</th>{[0, 1, 2, 3, 4].map(i => <td className="px-2 text-right" key={i}>{roster.reduce((sum, p) => sum + p.quarters[i], 0)}</td>)}<td className="pl-2 text-right">{roster.reduce((sum, p) => sum + p.points, 0)}</td></tr></tfoot></table></div> : <p className="rounded-xl bg-stone-50 p-4 text-sm text-stone-500 text-pretty">Todavía no hay estadísticas publicadas para este equipo.</p>}</div>;
        })}
        <a href={`${WEBSITE}${game.publicUrl}`} className={cn("mt-6 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-orange-700", focus)}>Ficha completa del partido<ArrowUpRight className="size-4" aria-hidden="true" /></a>
      </section>
      <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6" aria-labelledby="action-title"><h2 id="action-title" className="text-lg font-bold text-balance">Última acción</h2><p className="mt-1 text-sm text-stone-500 text-pretty">Las jugadas más recientes aparecen primero.</p>
        {data.events?.length ? <ol className="mt-5 divide-y divide-stone-100">{data.events.map(event => <li key={event.id} className="flex gap-3 py-4"><span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-bold tabular-nums">{event.points > 0 ? `+${event.points}` : <Circle className="size-2" aria-hidden="true" />}</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-pretty">{actionLabels[event.action] || "Acción registrada"}</p>{event.player && <p className="mt-1 text-sm text-stone-600 text-pretty">{event.player}</p>}<p className="mt-1 text-xs text-stone-500 tabular-nums">{[periodLabel(event.period), clockLabel(event.clock), event.score].filter(Boolean).join(" · ")}</p></div></li>)}</ol> : <div className="mt-5 rounded-xl bg-stone-50 p-5"><Radio className="size-5 text-stone-400" aria-hidden="true" /><p className="mt-3 text-sm font-semibold">En espera de las primeras jugadas</p><p className="mt-1 text-sm text-stone-500 text-pretty">Las acciones aparecerán aquí cuando la mesa las registre. Esta vista se actualiza automáticamente.</p></div>}
      </section>
    </div>
  </>;
}

export default function PublicGames() {
  const id = window.location.pathname.match(/^\/juegos\/([1-9]\d*)\/?$/)?.[1];
  const { data, error, loading, refresh } = useFeed(`/api/public/games${id ? `/${id}` : ""}`);
  const [selectedDay, setDay] = useState<string>();
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("all");
  const games = data?.games || [];
  const dates = [...new Set(games.flatMap(g => g.datetime ? [dayKey(g.datetime)] : []))].sort();
  const today = dayKey(new Date());
  const day = selectedDay ?? (dates.includes(today) ? today : dates.find(d => d > today) || dates.at(-1) || "all");
  const categories = [...new Set(games.map(g => g.away.category || g.home.category).filter(Boolean))].sort((a, b) => parseInt(a) - parseInt(b));
  const visible = games.filter(g => (day === "all" || (g.datetime && dayKey(g.datetime) === day)) && (!category || g.away.category === category || g.home.category === category));
  const sections = [
    { key: "live", title: "En vivo ahora", games: visible.filter(g => g.status === "Live") },
    { key: "scheduled", title: "Próximos partidos", games: visible.filter(g => g.status === "Scheduled") },
    { key: "final", title: "Resultados de las finales", games: visible.filter(final) },
    { key: "other", title: "Otros partidos", games: visible.filter(g => !["Live", "Scheduled", "Played", "Final"].includes(g.status)) },
  ];
  const filtered = sections.filter(s => status === "all" || s.key === status);
  return <main className="min-h-dvh bg-stone-50 font-sans text-neutral-900 [color-scheme:light]">
    <header className="border-b border-stone-200 bg-white"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8"><a href={WEBSITE} className={cn("flex items-center gap-3", focus)} aria-label="PBO, ir a Inicio"><span className="rounded-xl bg-orange-600 px-3 py-2 text-xl font-black text-white">PBO</span><span className="text-sm font-bold">Finales 2026</span></a><nav aria-label="Navegación principal" className="flex items-center gap-5 text-sm font-semibold"><a href={WEBSITE} className={cn("text-stone-500", focus)}>Inicio</a><a href="/juegos" aria-current="page" className={cn("text-orange-700", focus)}>Juegos</a><a href={`${WEBSITE}/model/games`} className={cn("text-stone-500", focus)}>Temporada</a></nav></div></header>
    <div className="mx-auto max-w-7xl px-5 pb-12 pt-8 sm:px-8 sm:pt-12">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5"><div><p className="flex items-center gap-2 text-xs font-bold text-orange-700"><Trophy className="size-4" aria-hidden="true" />PBO · CAMPEONATOS 2026</p><h1 className="mt-3 text-3xl font-black text-balance sm:text-5xl">{id ? "La acción del partido" : "Las finales, juego a juego."}</h1><p className="mt-3 max-w-xl text-sm leading-relaxed text-stone-600 text-pretty">{id ? "Marcador, puntos por jugador y últimas jugadas en un solo lugar." : "Sigue a tu equipo. Consulta los marcadores, abre cada partido y acompaña el camino al campeonato."}</p></div>
        <div className="text-sm"><button type="button" onClick={refresh} className={cn("inline-flex min-h-11 items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 font-semibold shadow-sm hover:border-orange-600", focus)}><RefreshCw className="size-4" aria-hidden="true" />Actualizar</button><p className="mt-2 text-xs text-stone-500 tabular-nums" role="status">{data ? `Última actualización: ${syncLabel(data.updatedAt)}` : "Conectando con los partidos…"}</p></div>
      </div>
      {error && <div role="alert" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 text-pretty">{error}{!data && <a className={cn("ml-2 underline", focus)} href="/juegos">Volver a los juegos</a>}</div>}
      {loading && !data && <div role="status" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><span className="sr-only">Cargando partidos…</span>{[1, 2, 3].map(i => <div key={i} className="h-64 rounded-2xl border border-stone-200 bg-stone-100" />)}</div>}
      {data?.game ? <GameDetail data={data} /> : !id && data && <>
        <section aria-label="Filtrar partidos" className="mb-8 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex flex-wrap items-center gap-2"><CalendarDays className="mr-1 size-4 text-stone-400" aria-hidden="true" />{["all", ...dates].map(date => <button key={date} type="button" aria-pressed={day === date} onClick={() => setDay(date)} className={cn("min-h-11 rounded-xl px-4 text-sm font-semibold", focus, day === date ? "bg-neutral-900 text-white" : "bg-stone-50 text-stone-600 hover:bg-stone-100")}>{date === "all" ? "Todas las fechas" : `${date === today ? "Hoy · " : ""}${dayLabel(date)}`}</button>)}</div><label className="flex items-center gap-2 text-sm"><span className="sr-only">Categoría</span><select className={cn("min-h-11 max-w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm", focus)} value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas las categorías</option>{categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}</select></label></div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-stone-100 pt-4">{[{ key: "all", title: "Todos", count: visible.length }, ...sections.slice(0, 3).map(s => ({ key: s.key, title: s.key === "live" ? "En vivo" : s.key === "final" ? "Finalizados" : "Por jugar", count: s.games.length }))].map(filter => <button type="button" key={filter.key} aria-pressed={status === filter.key} onClick={() => setStatus(filter.key)} className={cn("inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-xs font-bold", focus, status === filter.key ? "bg-orange-600 text-white" : "bg-stone-100 text-stone-600")}>{filter.title}<span className="tabular-nums">{filter.count}</span></button>)}</div>
        </section>
        {visible.length > 0 && !visible.some(g => g.status === "Live") && status === "all" && <p className="mb-6 flex items-start gap-2 text-sm text-stone-500 text-pretty"><Radio className="mt-0.5 size-4 shrink-0" aria-hidden="true" />No hay partidos marcados en vivo en esta selección. Los marcadores aparecerán cuando la mesa inicie cada juego.</p>}
        {filtered.map(section => section.games.length > 0 && <section className="mb-9" key={section.key} aria-labelledby={`section-${section.key}`}><h2 id={`section-${section.key}`} className="mb-4 flex items-center gap-2 text-xl font-bold text-balance">{section.key === "live" && <Radio className="size-5 text-orange-600" aria-hidden="true" />}{section.title}<span className="ml-1 text-sm font-medium text-stone-400 tabular-nums">{section.games.length}</span></h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{section.games.map(g => <GameCard game={g} key={g.id} />)}</div></section>)}
        {!filtered.some(s => s.games.length) && <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center"><h2 className="text-xl font-bold text-balance">No hay partidos en esta selección</h2><p className="mt-2 text-sm text-stone-500 text-pretty">Consulta todas las fechas y categorías de las finales.</p><button type="button" onClick={() => { setDay("all"); setCategory(""); setStatus("all"); }} className={cn("mt-5 min-h-11 rounded-xl bg-neutral-900 px-5 text-sm font-bold text-white", focus)}>Ver todos los partidos</button></div>}
      </>}
      <aside className="mt-8 flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-stone-200 bg-stone-100 p-5 sm:p-6"><div className="max-w-2xl"><h2 className="text-sm font-bold text-balance">Sigue la acción desde aquí</h2><p className="mt-1 text-sm leading-relaxed text-stone-600 text-pretty">Los datos se consultan cada 15 segundos mientras esta página está abierta. El marcador, el reloj y las jugadas reflejan lo registrado por la mesa. Para ver el video, abre la transmisión de PBO en Facebook.</p></div><a href={FACEBOOK} target="_blank" rel="noopener noreferrer" className={cn("inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold", focus)}>Video en Facebook<ArrowUpRight className="size-4" aria-hidden="true" /></a></aside>
      <footer className="mt-8 text-xs text-stone-500">Play Basketball Organization · Horas de Puerto Rico</footer>
    </div>
  </main>;
}
