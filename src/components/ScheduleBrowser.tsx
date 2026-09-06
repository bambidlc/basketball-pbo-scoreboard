import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Search } from "lucide-react";
import type { MatchOption } from "../api/liveMatch";
import { currentPboDateKey, findRelevantGame, matchDateKey, orderGamesByTipoff } from "../schedule";
import { cn } from "../lib/cn";

const STORAGE_KEY = "pbo:schedule-navigation:v1";
type Navigation = { date?: string; court?: string; page: number; query: string };
function restoreNavigation(): Navigation {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    if (saved && typeof saved.page === "number" && typeof saved.query === "string") return saved;
  } catch { /* Storage may be unavailable. */ }
  return { page: 0, query: "" };
}
function dateLabel(value: string) {
  if (!value) return "Date pending";
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

export function ScheduleBrowser({ games, selectedGameId, renderGame }: {
  games: MatchOption[];
  selectedGameId?: number;
  renderGame: (game: MatchOption) => ReactNode;
}) {
  const [navigation, setNavigation] = useState(restoreNavigation);
  const gridRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(() => window.innerWidth >= 1280 ? 3 : window.innerWidth >= 768 ? 2 : 1);
  useEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const columns = window.innerWidth >= 1280 ? 3 : window.innerWidth >= 768 ? 2 : 1;
      const rows = Math.max(1, Math.min(2, Math.floor(element.clientHeight / 280)));
      setPageSize(columns * rows);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const ordered = useMemo(() => orderGamesByTipoff(games), [games]);
  const dates = useMemo(() => [...new Set(ordered.map(game => matchDateKey(game.datetime)))], [ordered]);
  const initialGame = games.find(game => game.id === selectedGameId) ?? findRelevantGame(games);
  const date = navigation.date ?? matchDateKey(initialGame?.datetime);
  const dateGames = ordered.filter(game => matchDateKey(game.datetime) === date);
  const courts = [...new Set(dateGames.map(game => game.location?.trim() || "Court pending"))].sort();
  const court = navigation.court && courts.includes(navigation.court)
    ? navigation.court : courts.includes(initialGame?.location?.trim() || "Court pending")
      ? initialGame?.location?.trim() || "Court pending" : courts[0];
  const query = navigation.query.trim().toLocaleLowerCase();
  const visibleGames = dateGames.filter(game => (game.location?.trim() || "Court pending") === court
    && (!query || `${game.name} ${game.awayName} ${game.homeName}`.toLocaleLowerCase().includes(query)));
  const pages = Math.max(1, Math.ceil(visibleGames.length / pageSize));
  const page = Math.max(0, Math.min(navigation.page, pages - 1));
  const dateIndex = dates.indexOf(date);
  const update = (values: Partial<Navigation>) => {
    const next = { ...navigation, date, court, ...values };
    setNavigation(next);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Optional preference. */ }
  };
  const selectDate = (value: string) => update({ date: value, court: undefined, page: 0, query: "" });
  const control = "h-11 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-30";

  return (
    <section aria-label="Find a game" className="flex min-h-0 flex-1 flex-col rounded-2xl border border-neutral-800 bg-neutral-900">
      <div className="shrink-0 border-b border-neutral-800 p-3 sm:space-y-4 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr]">
          <div>
            <label className="mb-2 flex items-center gap-2 text-xs font-semibold text-neutral-400" htmlFor="schedule-date"><CalendarDays size={14} />1. Choose date</label>
            <div className="flex gap-1.5">
              <button aria-label="Previous game date" className={cn(control, "px-2")} disabled={dateIndex <= 0} onClick={() => selectDate(dates[dateIndex - 1])}><ChevronLeft size={16} /></button>
              <select id="schedule-date" className={cn(control, "min-w-0 flex-1 font-semibold")} value={date} onChange={event => selectDate(event.target.value)}>
                {!dates.includes(date) && <option value={date}>{dateLabel(date)}</option>}
                {dates.map(value => <option key={value} value={value}>{value === currentPboDateKey() ? "Today · " : ""}{dateLabel(value)}</option>)}
              </select>
              <button aria-label="Next game date" className={cn(control, "px-2")} disabled={dateIndex < 0 || dateIndex >= dates.length - 1} onClick={() => selectDate(dates[dateIndex + 1])}><ChevronRight size={16} /></button>
            </div>
          </div>
          <div>
            <label className="mb-2 flex items-center gap-2 text-xs font-semibold text-neutral-400" htmlFor="schedule-court"><MapPin size={14} />2. Choose court</label>
            <select id="schedule-court" className={cn(control, "w-full font-semibold")} value={court || ""} onChange={event => update({ court: event.target.value, page: 0 })}>
              {!courts.length && <option value="">No courts on this date</option>}
              {courts.map(value => <option key={value} value={value}>{value} · {dateGames.filter(game => (game.location?.trim() || "Court pending") === value).length} games</option>)}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="sr-only mb-2 items-center gap-2 text-xs font-semibold text-neutral-400 sm:not-sr-only sm:flex" htmlFor="schedule-search"><Search size={14} />Find a team</label>
            <input id="schedule-search" type="search" className={cn(control, "w-full")} placeholder="Team or game name" value={navigation.query} onChange={event => update({ query: event.target.value, page: 0 })} />
          </div>
        </div>
        {courts.length > 1 && courts.length <= 6 && (
          <div aria-label="Courts" className="hidden flex-wrap gap-2 sm:flex">
            {courts.map(value => <button key={value} aria-pressed={court === value} onClick={() => update({ court: value, page: 0 })} className={cn("min-h-9 rounded-lg border px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300", court === value ? "border-amber-300 bg-amber-300 text-neutral-950" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800")}>{value}</button>)}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0"><h2 className="truncate text-sm font-semibold text-balance">{court || "Choose a court"}</h2><p className="text-xs text-neutral-500 tabular-nums">{dateLabel(date)} · {visibleGames.length} games</p></div>
        <button className="rounded-lg px-2 py-1 text-xs font-semibold text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300" onClick={() => selectDate(currentPboDateKey())}>Today</button>
      </div>
      <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 [overflow-anchor:none]" aria-label="Games at selected court">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleGames.slice(page * pageSize, (page + 1) * pageSize).map(game => <div key={game.id}>{renderGame(game)}</div>)}
        </div>
        {!visibleGames.length && <div className="rounded-xl border border-dashed border-neutral-700 px-4 py-10 text-center"><p className="text-sm font-semibold">{query ? "No matching teams at this court" : "No games on this date"}</p><button className="mt-3 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-amber-300" onClick={() => query ? update({ query: "", page: 0 }) : selectDate(matchDateKey(findRelevantGame(games)?.datetime))}>{query ? "Clear search" : "Go to next available games"}</button></div>}
      </div>
      <nav aria-label="Game pages" className="flex shrink-0 items-center justify-between border-t border-neutral-800 px-4 py-2">
        <span className="text-xs text-neutral-500 tabular-nums">{visibleGames.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, visibleGames.length)} of {visibleGames.length}</span>
        <div className="flex items-center gap-3"><button aria-label="Previous game page" className={cn(control, "h-9 px-2")} disabled={page === 0} onClick={() => update({ page: page - 1 })}><ChevronLeft size={16} /></button><span className="text-xs text-neutral-400 tabular-nums">{page + 1} / {pages}</span><button aria-label="Next game page" className={cn(control, "h-9 px-2")} disabled={page + 1 >= pages} onClick={() => update({ page: page + 1 })}><ChevronRight size={16} /></button></div>
      </nav>
    </section>
  );
}
