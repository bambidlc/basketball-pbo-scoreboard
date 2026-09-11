import * as Dialog from "@radix-ui/react-dialog";
import { CircleX, ClipboardList, Map, Shuffle, Target } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Player, Team, TeamId } from "../api/liveMatch";
import { cn } from "../lib/cn";
import { isPlayerUnavailable, courtOrder, playerKey, type CourtSides, type ScoringView } from "../scoring";

const control = "min-h-11 rounded-lg border px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-40";

export function TeamSelector({ teams, sides, selected, onSelect }: {
  teams: Record<TeamId, Team>; sides: CourtSides; selected: TeamId; onSelect: (team: TeamId) => void;
}) {
  return <div aria-label="Scoring team" role="group" className="grid min-w-0 grid-cols-2 gap-2">
    {courtOrder(sides).map((side, index) => <button type="button" key={side} aria-pressed={selected === side}
      aria-label={`Select ${teams[side].label}: ${teams[side].name}`}
      className={cn(control, "min-w-0 text-left", selected === side ? "bg-neutral-800" : "border-neutral-800 bg-neutral-950 hover:bg-neutral-900")}
      style={{ borderColor: selected === side ? `var(--c-${side})` : undefined }} onClick={() => onSelect(side)}>
      <span className="block text-[10px] text-neutral-400">{index === 0 ? "Left" : "Right"} · {teams[side].label}</span>
      <span className="block truncate" style={{ color: `var(--c-${side}-soft)` }}>{teams[side].name}</span>
    </button>)}
  </div>;
}

export function ScoringToolbar({ teams, sides, selected, view, onSelect, onView, onSwitch, consoleVisible, feedVisible, onToggleConsole, onToggleFeed }: {
  teams: Record<TeamId, Team>; sides: CourtSides; selected: TeamId; view: ScoringView;
  onSelect: (team: TeamId) => void; onView: (view: ScoringView) => void; onSwitch: () => void;
  consoleVisible: boolean; feedVisible: boolean; onToggleConsole: () => void; onToggleFeed: () => void;
}) {
  return <div className="live-scoring-toolbar grid gap-3 border-b border-neutral-800 bg-neutral-950 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
    <TeamSelector teams={teams} sides={sides} selected={selected} onSelect={onSelect} />
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-neutral-700 p-1" role="group" aria-label="Scoring view">
        {(["court", "buttons"] as const).map((mode) => <button key={mode} type="button" aria-pressed={view === mode}
          className={cn("flex min-h-10 items-center gap-1.5 rounded-md px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400", view === mode ? "bg-neutral-100 text-neutral-950" : "text-neutral-400 hover:text-neutral-100")}
          onClick={() => onView(mode)}>{mode === "court" ? <Map size={16} /> : <ClipboardList size={16} />}{mode === "court" ? "Court" : "No court"}</button>)}
      </div>
      <button className={cn(control, "flex items-center gap-2 border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800")}
        aria-label="Switch court sides" type="button" onClick={onSwitch}><Shuffle size={16} />Switch courts</button>
      <div role="group" aria-label="Visible panels" className="flex gap-1">
        {([{ label: "Console", name: "scorer console", visible: consoleVisible, toggle: onToggleConsole },
          { label: "Feed", name: "event feed and summary", visible: feedVisible, toggle: onToggleFeed }]).map((panel) =>
          <button key={panel.label} type="button" aria-pressed={panel.visible}
            aria-label={`${panel.visible ? "Hide" : "Show"} ${panel.name}`} title={`${panel.visible ? "Hide" : "Show"} ${panel.name}`}
            onClick={panel.toggle} className={cn(control, "px-2", panel.visible ? "border-neutral-500 bg-neutral-800 text-neutral-100" : "border-neutral-700 text-neutral-400 hover:text-neutral-100")}>
            {panel.label}
          </button>)}
      </div>
    </div>
  </div>;
}

export function ScoringDialog({ title, description, children, onClose, wide = false }: {
  title: string; description: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [returnFocus] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <div ref={setContainer} />
    {container && <Dialog.Portal container={container}>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/75" />
      <Dialog.Content onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus?.focus(); }} className={cn("scoring-dialog fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 text-neutral-100 shadow-2xl", wide ? "scoring-dialog-wide max-w-5xl" : "max-w-lg")}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-neutral-800 p-4">
          <div className="min-w-0"><Dialog.Title className="text-lg font-bold text-balance">{title}</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-neutral-400 text-pretty">{description}</Dialog.Description></div>
          <Dialog.Close aria-label={`Close ${title.toLowerCase()}`} className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-neutral-700 text-neutral-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"><CircleX size={20} /></Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>}
  </Dialog.Root>;
}

export function ScoringPlayerPicker({ teams, sides, initialTeam, title, description, onClose, onPick, bothTeams = false }: {
  teams: Record<TeamId, Team>; sides: CourtSides; initialTeam: TeamId; title: string; description: string;
  onClose: () => void; onPick: (team: TeamId, player: Player) => void; bothTeams?: boolean;
}) {
  const [team, setTeam] = useState(initialTeam);
  return <ScoringDialog title={title} description={description} onClose={onClose}>
    <div className="min-h-0 overflow-y-auto p-4">
      {!bothTeams && <TeamSelector teams={teams} sides={sides} selected={team} onSelect={setTeam} />}
      <div className={cn("grid gap-4", bothTeams && "grid-cols-2")}>
      {(bothTeams ? courtOrder(sides) : [team]).map((side) => <section key={side} aria-label={`${teams[side].name} shooters`}>
      {bothTeams && <h3 className="truncate text-sm font-bold text-balance" style={{ color: `var(--c-${side}-soft)` }}>{teams[side].name}</h3>}
      <div className={cn("mt-4 grid gap-2", bothTeams ? "grid-cols-2" : "grid-cols-3")}>
        {teams[side].players.map((player) => <button key={playerKey(player)} type="button" aria-label={`Assign to #${player.number}`} title={player.name} disabled={isPlayerUnavailable(player)}
          className="flex min-h-16 min-w-0 flex-col justify-center rounded-lg border border-neutral-700 bg-neutral-900 px-2 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          onClick={() => onPick(side, player)}><span className="font-mono text-2xl font-black tabular-nums" style={{ color: `var(--c-${side}-soft)` }}>#{player.number}</span><span className="text-[10px] text-neutral-400 tabular-nums">{player.points} pt · {player.fouls} f</span></button>)}
      </div>
      {teams[side].players.length === 0 && <p className="mt-3 text-sm text-neutral-400 text-pretty">No players on court. Set the lineup in Pre-game.</p>}
      </section>)}
      </div>
    </div>
  </ScoringDialog>;
}

export function QuickScorePanel({ hasPlayers, onShot, foulOnShot }: {
  hasPlayers: boolean; onShot: (value: 2 | 3, made: boolean) => void; foulOnShot: boolean;
}) {
  return <section aria-label="Scoring without court" className="live-quick-score flex min-w-0 flex-col justify-center bg-neutral-950 p-3">
    <div className="mb-3"><p className="text-xs font-semibold text-neutral-400">Quick scoring · both teams</p>
      <h2 className="mt-1 text-base font-bold text-balance">Record points</h2>
      <p className="mt-2 text-sm text-neutral-400 text-pretty">Choose the shot, then pick any player.</p></div>
    <div className="grid grid-cols-2 gap-3">
      {([2, 3] as const).flatMap((value) => [true, false].map((made) => <button key={`${value}-${made}`} type="button" disabled={!hasPlayers}
        className={cn("flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-40", made ? "border-lime-500/40 bg-lime-500/10 text-lime-200 hover:bg-lime-500/20" : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800")}
        onClick={() => onShot(value, made)}><span className="font-mono text-3xl font-black tabular-nums">{value}<span className="ml-1 text-sm">PT</span></span>
        <span className="flex items-center gap-1.5 text-xs">{made ? <Target size={15} /> : <CircleX size={15} />}{made ? "Made" : "Missed"}</span></button>))}
    </div>
    {foulOnShot && <p className="mt-3 text-xs font-semibold text-amber-300">Foul on shot enabled</p>}
    {!hasPlayers && <p className="mt-3 text-sm text-neutral-400">Set the lineup in Pre-game to start scoring.</p>}
  </section>;
}
