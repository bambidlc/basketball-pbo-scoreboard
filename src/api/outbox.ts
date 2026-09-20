import type { LiveMatch, SaveMatchActionInput } from "./liveMatch";

// A durable, FIFO queue of Odoo mutations that have not yet been confirmed synced. While
// the device is offline (or a write fails), the optimistic local match is the source of
// truth and the corresponding mutation is parked here; a flusher replays the queue in
// order once the connection returns, so "score offline, sync when back online" needs no
// server-side database — just this client-side outbox.
//
// Replay is safe to run more than once per op because the Odoo write path is idempotent:
// player stats upsert by (game, player), and the game score is written absolutely
// (last-write-wins). Each action carries its stable operation ID into the event note,
// so a retry recognizes an event even if its original create response was lost.
export type OutboxOp =
  | {
      id: string;
      kind: "action";
      createdAt: number;
      attempts: number;
      lastError?: string;
      // Local event id this action produced, so the flusher can stamp the returned
      // serverEventId back onto the right event/undo record after a delayed sync.
      eventId?: number;
      input: SaveMatchActionInput;
    }
  | {
      id: string;
      kind: "status";
      createdAt: number;
      attempts: number;
      lastError?: string;
      eventId?: number;
      match: LiveMatch;
      status: string;
      note?: string;
    }
  | {
      id: string;
      kind: "roster";
      createdAt: number;
      attempts: number;
      lastError?: string;
      match: LiveMatch;
    }
  | {
      id: string;
      kind: "flow";
      createdAt: number;
      attempts: number;
      lastError?: string;
      match: LiveMatch;
      includeScores: boolean;
    };

let opCounter = 0;

// Monotonic, collision-free id for a queued op. Time-based prefix keeps ids sortable for
// debugging; the counter guarantees uniqueness within a session even within the same ms.
export function makeOpId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  opCounter += 1;
  return `${Date.now().toString(36)}-${opCounter.toString(36)}`;
}

// The Odoo write path never reads match.events (events are created fresh from the action
// fields; flow/stat writes use scalars + rosters), so drop the unboundedly-growing event
// history before persisting a snapshot. This keeps each queued op a few KB even across a
// long offline stretch, well clear of the localStorage quota.
export function trimMatchForOutbox(match: LiveMatch): LiveMatch {
  return { ...match, events: [] };
}

// Pending writes override stale reads, including reads started before a write completed.
export function applyPendingResult<T extends { awayScore: number; homeScore: number; status: string; statusNote?: string }>(
  value: T, gameId: number | undefined, ops: OutboxOp[],
): T {
  return ops.reduce((current, op) => {
    const snapshot = op.kind === "action" ? op.input.match : op.match;
    if (!gameId || snapshot.gameId !== gameId || op.kind === "roster") return current;
    if (op.kind === "action") return { ...current, awayScore: op.input.nextAwayScore,
      homeScore: op.input.nextHomeScore, status: "Live" };
    if (op.kind === "flow") return op.includeScores
      ? { ...current, awayScore: snapshot.awayScore, homeScore: snapshot.homeScore } : current;
    return { ...current, awayScore: op.match.awayScore, homeScore: op.match.homeScore,
      status: op.status, statusNote: op.note || undefined };
  }, value);
}

// A successful HTTP read can still be older than the device's unsent plays.
// Restore the last queued snapshot, including player stats and Q3 flow, before rendering.
export function restorePendingMatch(server: LiveMatch, cached: LiveMatch | undefined, ops: OutboxOp[]): LiveMatch {
  let restored = server;
  const events = new Map<number, LiveMatch["events"][number]>();
  if (cached && cached.gameId === server.gameId) for (const event of cached.events) events.set(event.id, event);
  for (const event of server.events) events.set(event.id, event);
  for (const op of ops) {
    const snapshot = op.kind === "action" ? op.input.match : op.match;
    if (!server.gameId || snapshot.gameId !== server.gameId || op.kind === "roster") continue;
    restored = { ...server, ...snapshot, events: server.events, syncedAt: server.syncedAt };
    if (op.kind === "action") restored = { ...restored, status: "Live", awayScore: op.input.nextAwayScore, homeScore: op.input.nextHomeScore };
    if (op.kind === "action" && op.eventId != null && !events.has(op.eventId)) {
      const input = op.input;
      events.set(op.eventId, { id: op.eventId, action: input.action, label: input.label,
        icon: input.points > 0 ? "made" : input.action.includes("missed") ? "missed" : "rebound",
        period: input.match.period, time: input.match.clock, team: input.selectedTeam,
        player: `#${input.player.number}`, playerId: input.player.id, points: input.points,
        score: `${input.nextAwayScore}-${input.nextHomeScore}`, note: input.note,
        shotType: input.shotType, shotLocation: input.shotLocation, issuedByRef: input.issuedByRef });
    }
    if (op.kind === "status") restored = { ...restored, status: op.status, statusNote: op.note || undefined };
  }
  if (restored !== server) return { ...restored, events: [...events.values()].sort((a, b) => b.id - a.id), syncMessage: "Cambios guardados en este dispositivo; pendientes de Odoo." };
  // Protect legacy local games with evidence of scoring from an empty Scheduled record.
  // Do not override an intentional final/cancelled result or choose the maximum score.
  if (cached && cached.gameId === server.gameId && server.gameId && server.status === "Scheduled" &&
      server.awayScore === 0 && server.homeScore === 0 && server.events.length === 0 &&
      (cached.awayScore > 0 || cached.homeScore > 0) && cached.events.some(event => (event.points ?? 0) > 0)) {
    return { ...cached, syncMessage: "Odoo devolvió 0–0 sin jugadas. Se conservó el marcador local; revisa la sincronización." };
  }
  return server;
}
