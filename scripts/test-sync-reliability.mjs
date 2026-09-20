import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const vite = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
try {
  const { restorePendingMatch, applyPendingResult, trimMatchForOutbox, operationGameId, nextPendingOperation, queueRosterCorrection } = await vite.ssrLoadModule("/src/api/outbox.ts");
  const { playerKey } = await vite.ssrLoadModule("/src/scoring.ts");
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
  let flusher, flowWriter, cacheReader, rosterReader, refreshReader;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "flushOutbox") flusher = node.initializer.getText(source);
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "syncFlowState") flowWriter = node.initializer.getText(source);
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "refreshMatch") refreshReader = node.initializer.getText(source);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "readStoredLiveMatch") cacheReader = node.getText(source);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "applyStoredGameDayRoster") rosterReader = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const writes = [];
  const context = vm.createContext({ apiClient: { enabled: true }, flushingRef: { current: false }, inFlightOpIdsRef: { current: new Set() },
    pendingOpsRef: { current: [{ id: "a", kind: "action", attempts: 0, input: input() }, { id: "b", kind: "flow", attempts: 0, match: match(2), includeScores: true }] },
    navigator: { onLine: true }, useCallback: fn => fn, linkServerEventId: () => {}, reconcileRosterSync: () => {}, appendLog: () => {}, operationGameId, nextPendingOperation,
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

  // A failed Fraigcomar roster cannot stop Yauco's plays, but its own plays wait.
  const priorGame = { ...match(), gameId: 259 };
  const priorRoster = { id: "old-roster", kind: "roster", attempts: 0, match: priorGame };
  const priorPlay = { id: "prior-play", kind: "action", attempts: 0, input: { ...input(), match: { ...input().match, gameId: 259 } } };
  const otherPlay = { id: "other-play", kind: "action", attempts: 0, input: input(4) };
  writes.length = 0;
  context.pendingOpsRef.current = [priorRoster, priorPlay, otherPlay];
  context.saveGameDayRoster = async () => ({ saved: false, log: { level: "error", detail: "Roster blocked" } });
  context.saveMatchAction = async (_client, action) => { writes.push(action.operationId); return { saved: true }; };
  await context.flush();
  assert.deepEqual(writes, ["other-play"]);
  assert.deepEqual(Array.from(context.pendingOpsRef.current, op => op.id), ["old-roster", "prior-play"]);

  // Correct the queued snapshot in place, before dependent plays, without changing
  // their pre-action stats or already-assigned event/operation IDs.
  const corrected = { ...priorGame, away: { ...priorGame.away, players: [{ ...actor, number: "31", name: "Edited", points: 37 }], bench: [] } };
  const correction = { id: "new-roster", kind: "roster", attempts: 0, match: corrected };
  const repaired = queueRosterCorrection([priorRoster, priorPlay, otherPlay, { ...priorRoster, id: "older-roster" }], correction);
  assert.deepEqual(repaired.map(op => op.id), ["new-roster", "prior-play", "other-play"]);
  assert.equal(repaired[1].input.player.number, "31");
  assert.equal(repaired[1].input.player.points, 0, "new totals must not be copied into old stat baselines");
  assert.equal(repaired[1].input.match.away.players[0].points, 2);
  assert.equal(repaired[1].input.nextAwayScore, 2);
  assert.equal(repaired[2], otherPlay, "other games remain untouched");

  // A roster may be edited while its old request is in flight. Neither failure nor
  // acknowledgement of that old ID can discard or block the replacement.
  for (const oldSaved of [false, true]) {
    writes.length = 0;
    context.pendingOpsRef.current = [priorRoster, priorPlay];
    let release;
    let started;
    const startedPromise = new Promise(resolve => { started = resolve; });
    const oldRequest = new Promise(resolve => { release = resolve; });
    context.saveGameDayRoster = async (_client, roster) => {
      if (roster === priorGame) { started(); return oldRequest; }
      writes.push("corrected-roster"); return { saved: true };
    };
    const draining = context.flush();
    await startedPromise;
    context.setPendingOps(ops => queueRosterCorrection(ops, correction));
    release({ saved: oldSaved, log: { level: "error", detail: "Obsolete result" } });
    await draining;
    assert.equal(context.pendingOpsRef.current.length, 0);
    assert.deepEqual(writes, ["corrected-roster", "prior-play"]);
  }

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
  Object.assign(context, { STORAGE_KEYS: { liveMatches: "matches", liveMatch: "legacy", outbox: "queue", gameDayRosters: "rosters" },
    getRoster: team => [...team.players, ...team.bench], getPlayerKey: playerKey,
    readStoredJson: key => key === "queue" ? pending : undefined });
  vm.runInContext(ts.transpile(rosterReader, { target: ts.ScriptTarget.ES2022 }), context);
  vm.runInContext(ts.transpile(cacheReader, { target: ts.ScriptTarget.ES2022 }), context);
  assert.equal(context.readStoredLiveMatch(260).awayScore, 368);
  assert.equal(context.readStoredLiveMatch(999), undefined);

  // A newer roster draft overrides names/lineups in old queued plays, while the
  // queued scoring totals remain authoritative on refresh and every quarter.
  const editedPlayer = { ...actor, number: "31", name: "Edited", points: 0 };
  const rosterStore = { 260: { teams: {
    away: { players: [editedPlayer], starterKeys: [playerKey(editedPlayer)] },
    home: { players: [], starterKeys: [] },
  } } };
  for (const quarter of [2, 3, 4, 5]) {
    const ops = [...pending, { id: `quarter-${quarter}`, kind: "flow", match: { ...restored, period: quarter }, includeScores: true }];
    context.readStoredJson = key => key === "queue" ? ops : key === "rosters" ? rosterStore : undefined;
    const reloaded = context.readStoredLiveMatch(260);
    assert.equal(reloaded.period, quarter);
    assert.equal(reloaded.awayScore, 368);
    assert.equal(reloaded.away.players[0].points, 368);
    assert.equal(reloaded.away.players[0].number, "31");
    assert.equal(reloaded.away.players[0].name, "Edited");
  }

  // Exercise the actual refresh callback: an in-flight server response cannot erase
  // a roster edit, and a failed offline game load cannot switch back to an old game.
  const refreshContext = vm.createContext({ apiClient: { enabled: true }, apiConfig: { enabled: true }, useCallback: fn => fn,
    customModeRef: { current: false }, mutationRevisionRef: { current: 0 }, pendingOpsRef: { current: [] },
    selectedGameIdRef: { current: 260 }, inFlightRefreshRef: { current: false }, pendingRefreshRef: { current: null },
    rateLimitUntilRef: { current: 0 }, clockRunningRef: { current: false }, matchOptionsLoadedRef: { current: true },
    matchOptionsLoadedAtRef: { current: Date.now() }, MATCH_OPTIONS_REFRESH_MS: 1e9, loadedGameIdRef: { current: 259 },
    setIsRefreshing() {}, setConnectionStatus() {}, setMatchOptions() {}, appendLog() {}, isRateLimitLog: () => false,
    currentMatch: match(18), readStoredLiveMatch: () => undefined, restorePendingMatch,
    applyStoredOfficials: value => value, applyStoredAttendance: value => value, applyStoredStarters: value => value,
    applyStoredGameDayRoster: value => value, applyPlayerDiscipline: value => value, mergeEventHistory: (_current, loaded) => loaded,
  });
  refreshContext.setMatch = fn => { refreshContext.currentMatch = fn(refreshContext.currentMatch); };
  refreshContext.setSelectedGameId = value => { refreshContext.selected = value; };
  let finishRead;
  refreshContext.loadLiveMatch = () => new Promise(resolve => { finishRead = resolve; });
  vm.runInContext(ts.transpile(`var refresh = ${refreshReader}`, { target: ts.ScriptTarget.ES2022 }), refreshContext);
  const reading = refreshContext.refresh(260, { force: true });
  refreshContext.currentMatch.away.bench.push({ ...actor, id: undefined, localId: "new-offline", number: "31" });
  refreshContext.mutationRevisionRef.current++;
  finishRead({ source: "api", match: match(), log: { level: "success" } });
  await reading;
  assert.equal(refreshContext.currentMatch.awayScore, 18);
  assert.ok(refreshContext.currentMatch.away.bench.some(p => p.localId === "new-offline"));
  refreshContext.loadLiveMatch = async () => ({ source: "local", match: priorGame, log: { level: "error", detail: "Offline" } });
  await refreshContext.refresh(260, { force: true });
  assert.equal(refreshContext.selected, 260, "a cached prior game's ID must not take over the selection");
  assert.equal(refreshContext.currentMatch.gameId, 260);
  assert.equal(refreshContext.currentMatch.awayScore, 18);

  const { DatabaseSyncStatus } = await vite.ssrLoadModule("/src/components/DatabaseSyncStatus.tsx");
  const html = renderToStaticMarkup(createElement(DatabaseSyncStatus, { online: true, enabled: true, pending: 184, error: "Blocked head", reading: true, onRetry() {}, onExport() {}, onCorrectRoster() {} }));
  assert.match(html, /184 pendientes/);
  assert.match(html, /guardado bloqueado/);
  assert.match(html, /Blocked head/);
  assert.match(html, /Corregir plantilla/);
  assert.doesNotMatch(html, /guardado confirmado/);
  console.log("Sync reliability passed: 184 offline plays, quarters/reload, roster corrections, in-flight edits, per-game FIFO, failed writes, duplicate-safe retries and truthful status.");
} finally { await vite.close(); }
