import type { GameEvent, LiveMatch, Player, ShotLocation, Team, TeamId } from "./api/liveMatch";

export const PLAYER_SUSPENSION_PREFIX = "Suspensión del jugador por este partido: ";

export function isPlayerUnavailable(player: Player) {
  return player.fouls >= 5 || player.techFouls >= 2 || Boolean(player.suspensionReason);
}

export function technicalSuspensionNote(player: Player, suspend: boolean, reason: string) {
  if (!suspend && (player.techFouls ?? 0) < 1) return undefined;
  const text = reason.trim() || (player.techFouls >= 1 ? "Dos faltas técnicas" : "");
  if (!text) throw new Error("Escribe el motivo de la suspensión.");
  return PLAYER_SUSPENSION_PREFIX + text;
}

export function applyPlayerDiscipline(match: LiveMatch): LiveMatch {
  const updateTeam = (side: TeamId): Team => {
    const update = (player: Player): Player => {
      const belongs = (event: GameEvent) => event.team === side &&
        (event.playerId ? event.playerId === player.id : event.player === `#${player.number}`);
      const technicals = match.events.filter(event => event.action === "tech foul" && belongs(event));
      const suspension = technicals.find(event => event.note?.startsWith(PLAYER_SUSPENSION_PREFIX));
      return { ...player, techFouls: Math.max(player.techFouls || 0, technicals.length), suspensionReason: suspension?.note?.slice(PLAYER_SUSPENSION_PREFIX.length) ||
        (player.techFouls >= 2 || technicals.length >= 2 ? "Dos faltas técnicas" : undefined) };
    };
    return { ...match[side], players: match[side].players.map(update), bench: match[side].bench.map(update) };
  };
  return { ...match, away: updateTeam("away"), home: updateTeam("home") };
}

export function formatGameCategory(away?: string, home?: string) {
  const categories = [...new Set([away, home].map(value => value?.trim().toUpperCase()).filter(Boolean))];
  return categories.length ? `Categoría ${categories.join(" / ")}` : "Categoría por confirmar";
}

export type CourtSides = { left: TeamId; right: TeamId };
export type ScoringView = "court" | "buttons";
export type LineupDraft = { keys: string[]; reason: string };
export type LineupDrafts = Record<TeamId, LineupDraft>;

export const BENCH_ORDER: readonly TeamId[] = ["away", "home"];

export function playerKey(player: Player) {
  return player.localId ? `local:${player.localId}` : player.id ? `id:${player.id}` : `local:${player.number}:${player.name}`;
}

export function courtOrder(sides: CourtSides): TeamId[] {
  return [sides.left, sides.right];
}

export function swappedCourts(sides: CourtSides): CourtSides {
  return { left: sides.right, right: sides.left };
}

export function shotLocationFromCoordinates(x: number, y: number, zone: string, value: number): ShotLocation | undefined {
  // Buttons and free throws have no position. Older events may still carry a
  // shot-type label in the zone field; that is not evidence of court input.
  if (!x && !y) return undefined;
  return { x, y, zone, side: x <= 380 ? "left" : "right", value: value === 3 ? 3 : 2 };
}

export function lineupReview(team: Team, draft: LineupDraft, period: number) {
  const roster = [...team.players, ...team.bench];
  const current = new Set(team.players.map(playerKey));
  const eligible = roster.filter((player) => player.present !== false || current.has(playerKey(player)));
  const selected = new Set(draft.keys);
  const incoming = eligible.filter((player) => selected.has(playerKey(player)) && !current.has(playerKey(player)));
  const outgoing = team.players.filter((player) => !selected.has(playerKey(player)));
  const changed = incoming.length > 0 || outgoing.length > 0;
  const target = team.players.length || Math.min(5, eligible.length);
  const invalidPlayer = draft.keys.some((key) => !eligible.some((player) => playerKey(player) === key)) ||
    incoming.some(isPlayerUnavailable) || team.players.some(player => selected.has(playerKey(player)) && isPlayerUnavailable(player));
  const error = invalidPlayer ? "Choose present players who are not suspended and have fewer than five fouls."
    : selected.size !== draft.keys.length || selected.size !== target || incoming.length !== outgoing.length
      ? `Select ${target} players to complete the lineup.`
    : changed && period === 1 && !draft.reason.trim() ? "Add a reason for this Q1 substitution."
    : undefined;
  return { eligible, incoming, outgoing, changed, target, error };
}

// Consecutive team commits and multi-player swaps can share a millisecond.
// Reserve a range above existing events so each swap can be undone independently.
export function nextEventId(events: { id: number }[], now = Date.now()) {
  return events.reduce((next, event) => Math.max(next, event.id + 1), now);
}
