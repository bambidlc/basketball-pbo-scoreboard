import type { LiveMatch, Team, TeamId } from "./api/liveMatch";
import { playerKey } from "./scoring.ts";

export type PeriodState = {
  clock: string;
  shotClock: number;
  possession: TeamId;
  lineups: Record<TeamId, string[]>;
  starters?: Record<TeamId, string[]>;
  fouls: Record<TeamId, number>;
  foulEvents: Record<TeamId, number>;
};

function countFouls(match: LiveMatch, period: number, team: TeamId) {
  return match.events.filter(event => event.team === team && event.period === period &&
    (event.action === "personal foul" || event.action === "tech foul")).length;
}

export function periodFouls(match: LiveMatch, period: number, team: TeamId): number {
  if (period === match.period) return match[team].fouls;
  const saved = match.periodStates?.[period];
  // Retain any pre-existing server total while reflecting later event corrections.
  return Math.max(0, countFouls(match, period, team) + (saved ? saved.fouls[team] - saved.foulEvents[team] : 0));
}

export function capturePeriod(match: LiveMatch): PeriodState {
  return {
    clock: match.clock, shotClock: match.shotClock, possession: match.possession,
    lineups: { away: match.away.players.map(playerKey), home: match.home.players.map(playerKey) },
    starters: match.periodStates?.[match.period]?.starters,
    fouls: { away: match.away.fouls, home: match.home.fouls },
    foulEvents: { away: countFouls(match, match.period, "away"), home: countFouls(match, match.period, "home") },
  };
}

export function restorePeriodLineup(team: Team, keys?: string[]): Team {
  if (!keys) return team;
  const selected = new Set(keys);
  const roster = [...team.players, ...team.bench];
  const players = roster.filter(player => selected.has(playerKey(player)) && player.present !== false && !player.removedFromRoster)
    .slice(0, 5).map(player => ({ ...player, active: true }));
  const active = new Set(players.map(playerKey));
  return { ...team, players, bench: roster.filter(player => !active.has(playerKey(player))).map(player => ({ ...player, active: false })) };
}

export function highestPeriod(match: LiveMatch): number {
  return Math.max(match.period, ...Object.keys(match.periodStates ?? {}).map(Number), ...match.events.map(event => event.period ?? 1));
}
