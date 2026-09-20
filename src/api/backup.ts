import type { LiveMatch } from "./liveMatch";
import { operationGameId, queueRosterCorrection, restorePendingMatch, type OutboxOp } from "./outbox";
import { deviceStorage } from "./deviceStorage";

export const CONFIRMED_OPERATIONS = "pbo:confirmedOperations:v1";
export type ScorerBackup = { savedAt: string; match: LiveMatch; pendingOps: OutboxOp[]; storage?: Record<string, string> };

export function recordConfirmedOperation(id: string) {
  const confirmed = JSON.parse(deviceStorage.get(CONFIRMED_OPERATIONS) ?? "{}") as Record<string, number>;
  confirmed[id] = Date.now();
  deviceStorage.set(CONFIRMED_OPERATIONS, JSON.stringify(confirmed));
}

function validMatch(value: unknown): value is LiveMatch {
  if (!value || typeof value !== "object") return false;
  const match = value as LiveMatch;
  return Number.isInteger(match.gameId) && Number(match.gameId) > 0 &&
    Number.isFinite(match.awayScore) && Number.isFinite(match.homeScore) && Number.isFinite(match.period) &&
    typeof match.clock === "string" && typeof match.status === "string" && Array.isArray(match.events) &&
    [match.away, match.home].every(team => team && Number.isInteger(team.id) && typeof team.name === "string" &&
      Array.isArray(team.players) && Array.isArray(team.bench) && [...team.players, ...team.bench].every(player =>
        player && typeof player.name === "string" && typeof player.number === "string"));
}

export function parseScorerBackup(text: string): ScorerBackup {
  const value = JSON.parse(text) as ScorerBackup;
  if (!value || !Number.isFinite(Date.parse(value.savedAt)) || !validMatch(value.match) || !Array.isArray(value.pendingOps)) {
    throw new Error("El archivo no es un respaldo válido de PBO.");
  }
  const ids = new Set<string>();
  for (const op of value.pendingOps) {
    if (!op || typeof op.id !== "string" || !op.id || ids.has(op.id) || !Number.isFinite(op.createdAt) ||
        !["action", "status", "flow", "roster"].includes(op.kind) || !validMatch(op.kind === "action" ? op.input?.match : op.match)) {
      throw new Error("El respaldo contiene cambios incompletos o duplicados. Conserva el archivo original.");
    }
    ids.add(op.id);
    if (op.kind === "action" && (!op.input.player || !["home", "away"].includes(op.input.selectedTeam) ||
        typeof op.input.action !== "string" || typeof op.input.label !== "string" ||
        !Number.isFinite(op.input.points) || !Number.isFinite(op.input.nextAwayScore) || !Number.isFinite(op.input.nextHomeScore))) {
      throw new Error("El respaldo contiene una jugada incompleta.");
    }
    if (op.kind === "status" && typeof op.status !== "string") throw new Error("Resultado incompleto en el respaldo.");
    if (op.kind === "flow" && typeof op.includeScores !== "boolean") throw new Error("Período incompleto en el respaldo.");
  }
  return value;
}

// Preserve IDs: they are the server's idempotency keys. Current copies include newer
// roster corrections/resolved player IDs, and therefore win over the exported copy.
export function mergeBackupOperations(current: OutboxOp[], backup: ScorerBackup, confirmed: Record<string, number>): OutboxOp[] {
  const merged = new Map(current.map(op => [op.id, op]));
  for (const op of backup.pendingOps) {
    if (!merged.has(op.id) && !confirmed[op.id]) merged.set(op.id, op);
  }
  let result = [...merged.values()].sort((a, b) => a.createdAt - b.createdAt);
  // Roster corrections intentionally precede older plays despite their newer date.
  const rosters = new Map<number | undefined, Extract<OutboxOp, { kind: "roster" }>>();
  for (const op of result) if (op.kind === "roster") rosters.set(op.match.gameId, op);
  for (const roster of rosters.values()) result = queueRosterCorrection(result, roster);
  return result;
}

export function backupMatches(backup: ScorerBackup, ops: OutboxOp[]) {
  const matches = new Map<number, LiveMatch>();
  for (const op of ops) {
    const snapshot = op.kind === "action" ? op.input.match : op.match;
    if (snapshot.gameId) matches.set(snapshot.gameId, snapshot);
  }
  if (backup.match.gameId && ops.some(op => operationGameId(op) === backup.match.gameId)) {
    matches.set(backup.match.gameId, backup.match);
  }
  return [...matches.values()].map(match => restorePendingMatch(match, match.gameId === backup.match.gameId ? backup.match : undefined, ops));
}
