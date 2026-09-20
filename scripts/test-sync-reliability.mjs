import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const vite = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
try {
  const { restorePendingMatch, applyPendingResult, trimMatchForOutbox } = await vite.ssrLoadModule("/src/api/outbox.ts");
  const { fallbackMatch, saveMatchAction } = await vite.ssrLoadModule("/src/api/liveMatch.ts");
  const schema = await vite.ssrLoadModule("/src/api/schema.ts");
  const { GAME: G, PLAYER_STAT: P, GAME_EVENT: E, MODELS: M } = schema;
  const match = (awayScore = 0, homeScore = 0) => ({ ...structuredClone(fallbackMatch), gameId: 260, period: 3, clock: "08:00", awayScore, homeScore,
    away: { ...structuredClone(fallbackMatch.away), id: 125 }, home: { ...structuredClone(fallbackMatch.home), id: 101 }, events: [], status: "Scheduled" });
  const actor = { ...match().away.players[0], id: 201, name: "Test player", number: "7", statId: undefined, points: 0, q1: 0, q2: 0, q3: 0, q4: 0, ot: 0,
    twoPointersAttempted: 0, twoPointersMade: 0 };
  const input = (points = 2) => {
    const snapshot = match(points);
    snapshot.away.players = [{ ...actor, points, q3: points }];
    return { action: "made 2pt", operationId: "test-op-1", match: snapshot, nextAwayScore: points, nextHomeScore: 0,
      player: actor, points, label: "2PT Made", selectedTeam: "away", shotType: "2pt", shotMade: true };
  };

  // 184 offline plays survive JSON storage, a stale online read, and a Q3 checkpoint.
  const pending = JSON.parse(JSON.stringify(Array.from({ length: 184 }, (_, i) => ({ id: `op-${i}`, kind: "action", attempts: 0, eventId: 1000 + i,
    input: { ...input(2 * (i + 1)), player: { ...actor, points: 2 * i } } }))));
  pending.push({ id: "q3", kind: "flow", attempts: 0, match: { ...pending[183].input.match, period: 3, clock: "08:00" }, includeScores: true });
  const restored = restorePendingMatch(match(), undefined, pending);
  assert.equal(restored.awayScore, 368);
  assert.equal(restored.period, 3);
  assert.equal(restored.away.players[0].points, 368);
  assert.equal(restored.away.players[0].q3, 368);
  assert.equal(restored.events.length, 184);
  assert.equal(restorePendingMatch(match(), restored, pending).events.length, 184);
  assert.equal(applyPendingResult(match(), 260, pending).awayScore, 368);
  assert.equal(restorePendingMatch({ ...match(), gameId: 999 }, restored, pending).awayScore, 0);
  assert.equal(restorePendingMatch({ ...match(), status: "Cancelled" }, restored, []).awayScore, 0);
  assert.equal(restorePendingMatch(match(), restored, []).awayScore, 368);
  const missingCache = restorePendingMatch(match(), undefined, pending.slice(0, 1));
  assert.equal(missingCache.events[0].playerId, 201);
  assert.equal(missingCache.events[0].points, 2);

  class Client {
    enabled = true;
    game = { id: 260, [G.awayScore]: 0, [G.homeScore]: 0 };
    stats = []; events = []; failEvent = false; lostEventResponse = false; rejectScore = false;
    async searchRead(model, domain) {
      const fields = { [M.game]: Object.values(G), [M.playerGameStat]: Object.values(P), [M.gameEvent]: Object.values(E) };
      if (model === "ir.model") return Object.keys(fields).map(model => ({ model }));
      if (model === "ir.model.fields") return Object.entries(fields).flatMap(([model, names]) => names.map(name => ({ model, name })));
      if (model === M.playerGameStat) return this.stats;
      if (model === M.gameEvent) return this.events.filter(row => row[E.game] === 260 && row[E.note]?.includes(domain.find(term => term[0] === E.note)?.[2]));
      return [];
    }
    async write(model, ids, values) {
      if (model === M.game) { if (this.rejectScore) return false; Object.assign(this.game, values); }
      else this.stats.filter(row => ids.includes(row.id)).forEach(row => Object.assign(row, values));
      return true;
    }
    async read() { return [{ ...this.game }]; }
    async create(model, values) {
      if (model === M.gameEvent && this.failEvent) throw new Error("Event permission denied");
      const rows = model === M.gameEvent ? this.events : this.stats;
      const id = rows.length + 1;
      rows.push({ id, ...values });
      if (model === M.gameEvent && this.lostEventResponse) { this.lostEventResponse = false; throw new Error("Lost response after commit"); }
      return id;
    }
  }
  const blocked = new Client(); blocked.failEvent = true;
  const failed = await saveMatchAction(blocked, input());
  assert.equal(failed.saved, false);
  assert.match(failed.log.detail, /Event permission denied/);
  blocked.failEvent = false;
  assert.equal((await saveMatchAction(blocked, input())).saved, true);
  assert.equal(blocked.events.length, 1);
  assert.equal(blocked.stats[0][P.totalPoints], 2);
  const lost = new Client(); lost.lostEventResponse = true;
  assert.equal((await saveMatchAction(lost, input())).saved, false);
  assert.equal((await saveMatchAction(lost, input())).saved, true);
  assert.equal(lost.events.length, 1, "retry must not duplicate a committed event");
  assert.equal(lost.game[G.awayScore], 2);
  const rejected = new Client(); rejected.rejectScore = true;
  assert.equal((await saveMatchAction(rejected, input())).saved, false);
  assert.equal(rejected.events.length, 0);
  assert.equal((await saveMatchAction(new Client(), { ...input(), player: { ...actor, id: undefined } })).saved, false);

  // Execute the application's actual FIFO flusher with a failing head and an appended play.
  const source = ts.createSourceFile("App.tsx", readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let flusher, flowWriter, cacheReader;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "flushOutbox") flusher = node.initializer.getText(source);
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "syncFlowState") flowWriter = node.initializer.getText(source);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "readStoredLiveMatch") cacheReader = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const writes = [];
  const context = vm.createContext({ apiClient: { enabled: true }, flushingRef: { current: false }, inFlightOpIdsRef: { current: new Set() },
    pendingOpsRef: { current: [{ id: "a", kind: "action", attempts: 0, input: input() }, { id: "b", kind: "flow", attempts: 0, match: match(2), includeScores: true }] },
    navigator: { onLine: true }, useCallback: fn => fn, linkServerEventId: () => {}, reconcileRosterSync: () => {}, appendLog: () => {},
    setLastDatabaseSave: () => {}, setConnectionStatus: () => {}, setResultFeedback: () => {}, createLog: (_level, message) => ({ message }) });
  context.setPendingOps = fn => { context.pendingOpsRef.current = fn(context.pendingOpsRef.current); };
  context.saveMatchAction = async () => ({ saved: false, log: { level: "error", detail: "Blocked head" } });
  context.saveMatchFlowState = async () => { writes.push("flow"); return { saved: true }; };
  vm.runInContext(ts.transpile(`var flush = ${flusher}`, { target: ts.ScriptTarget.ES2022 }), context);
  await context.flush();
  assert.equal(context.pendingOpsRef.current.length, 2);
  assert.equal(context.pendingOpsRef.current[0].lastError, "Blocked head");
  assert.equal(writes.length, 0, "flow must not bypass blocked scoring writes");
  context.saveMatchAction = async (_client, action) => {
    writes.push(action.operationId);
    if (action.operationId === "a") context.pendingOpsRef.current.push({ id: "c", kind: "action", input: input(4) });
    return { saved: true };
  };
  await context.flush();
  assert.deepEqual(writes, ["a", "flow", "c"]);
  assert.equal(context.pendingOpsRef.current.length, 0);

  let persisted;
  Object.assign(context, { trimMatchForOutbox, restorePendingMatch, matchRef: { current: restored }, makeOpId: () => "quarter-transition",
    flushOutbox: context.flush, persistStoredLiveMatch: value => { persisted = structuredClone(value); } });
  context.navigator.onLine = false;
  vm.runInContext(ts.transpile(`var syncFlow = ${flowWriter}`, { target: ts.ScriptTarget.ES2022 }), context);
  context.syncFlow("Period changed", restored);
  assert.equal(persisted.awayScore, 368, "Q3 is backed up synchronously while offline");
  assert.equal(context.pendingOpsRef.current[0].includeScores, true);
  assert.equal(context.pendingOpsRef.current[0].match.period, 3);
  // A crash before the React snapshot effect still restores the outbox on startup.
  Object.assign(context, { STORAGE_KEYS: { liveMatches: "matches", liveMatch: "legacy", outbox: "queue" },
    readStoredJson: key => key === "queue" ? pending : undefined });
  vm.runInContext(ts.transpile(cacheReader, { target: ts.ScriptTarget.ES2022 }), context);
  assert.equal(context.readStoredLiveMatch(260).awayScore, 368);
  assert.equal(context.readStoredLiveMatch(999), undefined);

  const { DatabaseSyncStatus } = await vite.ssrLoadModule("/src/components/DatabaseSyncStatus.tsx");
  const html = renderToStaticMarkup(createElement(DatabaseSyncStatus, { online: true, enabled: true, pending: 184, error: "Blocked head", reading: true, onRetry() {}, onExport() {} }));
  assert.match(html, /184 pendientes/);
  assert.match(html, /guardado bloqueado/);
  assert.match(html, /Blocked head/);
  assert.doesNotMatch(html, /guardado confirmado/);
  console.log("Sync reliability passed: 184 offline plays, Q3/reload, game isolation, failed writes, duplicate-safe retries, FIFO draining and truthful status.");
} finally { await vite.close(); }
