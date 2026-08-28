import type { LiveMatch, SaveMatchActionInput } from "./liveMatch";

// A durable, FIFO queue of Odoo mutations that have not yet been confirmed synced. While
// the device is offline (or a write fails), the optimistic local match is the source of
// truth and the corresponding mutation is parked here; a flusher replays the queue in
// order once the connection returns, so "score offline, sync when back online" needs no
// server-side database — just this client-side outbox.
//
// Replay is safe to run more than once per op because the Odoo write path is idempotent:
// player stats upsert by (game, player), and the game score is written absolutely
// (last-write-wins). Events are only created after the throw-prone steps succeed, so a
// failed op never leaves a half-written event behind to be duplicated on retry.
export type OutboxOp =
  | {
      id: string;
      kind: "action";
      createdAt: number;
      attempts: number;
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
      match: LiveMatch;
    };

let opCounter = 0;

// Monotonic, collision-free id for a queued op. Time-based prefix keeps ids sortable for
// debugging; the counter guarantees uniqueness within a session even within the same ms.
export function makeOpId(): string {
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
