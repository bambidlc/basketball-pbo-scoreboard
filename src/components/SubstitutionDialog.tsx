import { Check, Shuffle } from "lucide-react";
import { useState } from "react";
import type { Team, TeamId } from "../api/liveMatch";
import { cn } from "../lib/cn";
import { BENCH_ORDER, lineupReview, playerKey, type LineupDraft, type LineupDrafts } from "../scoring";
import { ScoringDialog } from "./ScoringControls";

const reasons = ["Foul trouble", "Rest", "Tactical", "Injury", "Discipline"];

export function SubstitutionDialog({ teams, period, onApply, onClose }: {
  teams: Record<TeamId, Team>; period: number; onApply: (drafts: LineupDrafts) => void; onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<LineupDrafts>(() => ({
    away: { keys: teams.away.players.map(playerKey), reason: "" },
    home: { keys: teams.home.players.map(playerKey), reason: "" },
  }));
  const reviews = BENCH_ORDER.map((side) => lineupReview(teams[side], drafts[side], period));
  const changed = reviews.some((review) => review.changed);
  const canApply = changed && reviews.every((review) => !review.error);
  const swaps = reviews.reduce((count, review) => count + review.incoming.length, 0);

  function update(side: TeamId, draft: LineupDraft) {
    setDrafts((current) => ({ ...current, [side]: draft }));
  }

  return <ScoringDialog title="Substitutions" description="Visitor bench stays left. Home bench stays right. Prepare one or both teams, then apply together." onClose={onClose} wide>
    <div className="grid min-h-0 grid-cols-2 gap-px overflow-y-auto scrollbar-slim bg-neutral-800">
      {BENCH_ORDER.map((side, index) => <LineupEditor key={side} side={side} team={teams[side]} period={period}
        bench={index === 0 ? "Left bench" : "Right bench"} draft={drafts[side]} onChange={(draft) => update(side, draft)} />)}
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-neutral-800 bg-neutral-950 p-4">
      <p className="text-xs text-neutral-400" role="status">{changed ? `${swaps} substitution${swaps === 1 ? "" : "s"} prepared` : "Current lineups selected"}</p>
      <div className="flex gap-2">
        <button type="button" className="min-h-11 rounded-lg border border-neutral-700 px-4 text-sm font-semibold hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400" onClick={onClose}>Cancel</button>
        <button type="button" disabled={!canApply} onClick={() => onApply(drafts)}
          className="flex min-h-11 items-center gap-2 rounded-lg bg-neutral-100 px-4 text-sm font-bold text-neutral-950 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-40"><Shuffle size={16} />Apply substitutions</button>
      </div>
    </div>
  </ScoringDialog>;
}

function LineupEditor({ side, team, period, bench, draft, onChange }: {
  side: TeamId; team: Team; period: number; bench: string; draft: LineupDraft; onChange: (draft: LineupDraft) => void;
}) {
  const { eligible, incoming, outgoing, changed, target, error } = lineupReview(team, draft, period);
  const current = new Set(team.players.map(playerKey));
  const selected = new Set(draft.keys);

  return <section aria-label={`${team.label} substitutions`} className="min-w-0 bg-neutral-950 p-2 sm:p-4">
    <div className="mb-3 border-t-2 pt-3" style={{ borderColor: `var(--c-${side})` }}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-neutral-400"><span>{bench} · {team.label}</span><span className="font-mono tabular-nums">{selected.size}/{target}</span></div>
      <h3 className="mt-1 truncate text-base font-bold text-balance" style={{ color: `var(--c-${side}-soft)` }}>{team.name}</h3>
      <p className="mt-2 min-h-8 text-xs text-neutral-400 text-pretty">Tap a player out, then tap their replacement in.</p>
    </div>
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
      {eligible.map((player) => {
        const key = playerKey(player);
        const picked = selected.has(key);
        const fouledOut = player.fouls >= 5;
        const disabled = !picked && (selected.size >= target || fouledOut);
        return <button key={key} type="button" aria-pressed={picked} disabled={disabled}
          aria-label={`${picked ? "Take out" : "Bring in"} #${player.number}`}
          onClick={() => onChange({ ...draft, keys: picked ? draft.keys.filter((value) => value !== key) : [...draft.keys, key] })}
          className={cn("relative flex min-h-20 min-w-0 flex-col items-center justify-center rounded-lg border p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-40", picked ? "border-neutral-400 bg-neutral-800" : "border-neutral-800 bg-neutral-900 hover:bg-neutral-800")}>
          <span className="flex min-h-4 items-center gap-1 text-[9px] font-semibold text-neutral-400">{picked && <Check size={11} />}{fouledOut ? "5 fouls" : current.has(key) ? "On court" : "Bench"}</span>
          <span className="font-mono text-2xl font-black tabular-nums">{player.number}</span>
          <span className="text-[10px] text-neutral-400 tabular-nums">{player.points} pt · {player.fouls} f</span>
        </button>;
      })}
    </div>
    {eligible.length === 0 && <p className="py-4 text-xs text-neutral-400">Mark attendance in Pre-game first.</p>}
    <div className="my-3 space-y-1 rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-xs tabular-nums">
      <p><span className="text-lime-300">IN</span> <span className="font-mono">{incoming.map((p) => `#${p.number}`).join(" · ") || "—"}</span></p>
      <p><span className="text-red-300">OUT</span> <span className="font-mono">{outgoing.map((p) => `#${p.number}`).join(" · ") || "—"}</span></p>
    </div>
    <label htmlFor={`sub-reason-${side}`} className="block text-xs font-semibold text-neutral-400">Reason {period === 1 ? "· Q1 required" : "· optional"}</label>
    <input id={`sub-reason-${side}`} value={draft.reason} onChange={(event) => onChange({ ...draft, reason: event.currentTarget.value })}
      aria-invalid={changed && period === 1 && !draft.reason.trim()} aria-describedby={error ? `sub-error-${side}` : undefined}
      className="mt-2 h-11 w-full min-w-0 rounded-lg border border-neutral-700 bg-neutral-900 px-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400" placeholder="Reason for change" />
    <div className="mt-2 flex flex-wrap gap-1.5">{reasons.map((reason) => <button key={reason} type="button" aria-pressed={draft.reason === reason}
      className={cn("min-h-8 rounded-md border px-2 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400", draft.reason === reason ? "border-neutral-400 bg-neutral-800" : "border-neutral-800 text-neutral-400 hover:bg-neutral-900")}
      onClick={() => onChange({ ...draft, reason })}>{reason}</button>)}</div>
    <div className="mt-3 min-h-8 text-xs text-amber-300" role="status" id={`sub-error-${side}`}>{error}</div>
    <button type="button" className="min-h-9 text-xs font-semibold text-neutral-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
      onClick={() => onChange({ keys: team.players.map(playerKey), reason: "" })}>Reset to current lineup</button>
  </section>;
}
