import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { BENCH_ORDER, computeEqualization, isPlayerUnavailable, nextEventId, playerKey } from "../src/scoring.ts";

// Execute the real application handlers with isolated storage and no network.
const source = ts.createSourceFile("App.tsx", readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, name);
  return ts.transpile(found, { target: ts.ScriptTarget.ES2022 });
}
const player = id => ({ id, number: String(id), name: `Player ${id}`, present: true, fouls: 0, techFouls: 0 });
function harness() {
  const storage = {};
  const side = offset => ({ name: "Team", players: [1, 2, 3, 4, 5].map(id => player(id + offset)), bench: [6, 7, 8, 9, 10].map(id => player(id + offset)) });
  const match = { gameId: 42, period: 2, clock: "08:00", away: side(0), home: side(10), events: [] };
  const context = vm.createContext({
    matchRef: { current: match }, mutationRevisionRef: { current: 0 }, selectedPlayersRef: { current: {} },
    clockRunningRef: { current: true }, running: true, STORAGE_KEYS: { starters: "starters", gameDayRosters: "rosters" }, UNDO_LIMIT: 50,
    getPlayerKey: playerKey, isPlayerUnavailable, nextEventId,
    readStoredJson: key => storage[key], writeStoredJson: (key, value) => { storage[key] = JSON.parse(JSON.stringify(value)); },
    getEventIcon: () => "", formatPlayer: p => `#${p.number}`, appendLog: () => {}, createLog: () => {},
    setMatch: () => {}, setUndoStack: () => {}, setSelectedPlayers: () => {}, setConnectionStatus: () => {},
    dispatchSaveAction: async () => ({ saved: true, log: { level: "success" } }),
    setTechOpen: () => {}, setFoulPrompt: () => {}, setFoulPlayerOpen: () => {}, setFreeThrowPrompt: () => {},
    syncFlowState: () => {}, persistStoredLiveMatch: () => {}, pendingOpsRef: { current: [] },
    dispatchSaveRoster: async () => ({ saved: true }),
  });
  context.setIsClockRunning = value => { context.running = value; };
  for (const name of ["getRoster", "withStarterKeys", "getStarterStorageId", "writeStoredStarterKeys", "writeStoredGameDayRoster", "applyStoredStarters", "applyStoredGameDayRoster", "commitLineupChange", "stopClockForFoul", "openFoul", "openTech", "recordFreeThrow", "closeFoul", "closeTech", "closeFreeThrow", "removeRosterPlayer", "updateRosterPlayer", "mergeResolvedRosterIds", "rewriteOutboxRoster", "togglePresent", "writeStoredAttendance"]) vm.runInContext(handler(name), context);
  return context;
}

test("removing a player then filling the empty lineup slot survives roster refresh without changing scores", () => {
  const app = harness();
  Object.assign(app.matchRef.current, { awayScore: 18, homeScore: 21 });
  const original = structuredClone(app.matchRef.current);
  app.removeRosterPlayer("away", app.matchRef.current.away.players[0]);
  assert.equal(app.matchRef.current.away.players.length, 4);
  app.commitLineupChange("away", [2, 3, 4, 5, 6].map(id => `id:${id}`));
  assert.equal(app.matchRef.current.away.players.length, 5);
  assert.equal(app.matchRef.current.awayScore, 18);
  const loaded = app.applyStoredGameDayRoster(original);
  assert.deepEqual(Array.from(loaded.away.players, p => p.id), [2, 3, 4, 5, 6]);
  assert.equal(loaded.away.bench.find(p => p.id === 1).removedFromRoster, true);
});

test("a new offline player survives edits, removal, restore and delayed ID resolution with stats intact", () => {
  const app = harness();
  const newcomer = { ...player(undefined), localId: "added-offline", name: "New Player", number: "30", points: 7 };
  app.matchRef.current.away.bench.push(newcomer);
  app.matchRef.current.events.push({ id: 999, team: "away", player: "#30", playerLocalId: newcomer.localId, points: 7 });
  const old = structuredClone(app.matchRef.current);
  app.updateRosterPlayer("away", newcomer, { name: "Corrected Name", number: "31" });
  app.removeRosterPlayer("away", { ...newcomer, number: "31" });
  const removed = app.matchRef.current.away.bench.find(p => p.localId === newcomer.localId);
  assert.ok(removed, "an unsynced player with events stays available for history");
  assert.equal(removed.removedFromRoster, true);
  app.removeRosterPlayer("away", removed);
  app.commitLineupChange("away", ["id:2", "id:3", "id:4", "id:5", "local:added-offline"]);
  old.away.bench.find(p => p.localId === newcomer.localId).id = 777;
  const merged = app.mergeResolvedRosterIds(app.matchRef.current, old);
  app.writeStoredGameDayRoster(merged);
  const refreshed = app.applyStoredGameDayRoster(old);
  const actual = refreshed.away.players.find(p => p.localId === newcomer.localId);
  assert.equal(actual.id, 777);
  assert.equal(actual.name, "Corrected Name");
  assert.equal(actual.number, "31");
  assert.equal(actual.points, 7);
  assert.equal(actual.removedFromRoster, false);
  assert.equal(merged.events.find(e => e.id === 999).playerId, 777);
  assert.deepEqual(Array.from(refreshed.away.players, p => p.localId || p.id), [2, 3, 4, 5, "added-offline"]);
});

test("marking an on-court player absent vacates the slot and stays absent on reload", () => {
  const app = harness();
  const original = structuredClone(app.matchRef.current);
  app.togglePresent("away", app.matchRef.current.away.players[0]);
  assert.equal(app.matchRef.current.away.players.length, 4);
  const refreshed = app.applyStoredGameDayRoster(original);
  assert.equal(refreshed.away.players.some(p => p.id === 1), false);
  assert.equal(refreshed.away.bench.find(p => p.id === 1).present, false);
});

test("both Q2 squads survive a server refresh and reload with current player stats", () => {
  const app = harness();
  const original = structuredClone(app.matchRef.current);
  app.writeStoredGameDayRoster(original);
  app.writeStoredStarterKeys(original, "away");
  app.writeStoredStarterKeys(original, "home");
  app.commitLineupChange("away", [6, 7, 8, 9, 10].map(id => `id:${id}`), "Inicio Q2");
  app.commitLineupChange("home", [16, 17, 18, 19, 20].map(id => `id:${id}`), "Inicio Q2");
  original.away.bench[0].points = 9;
  const refreshed = app.applyStoredGameDayRoster(app.applyStoredStarters(original));
  assert.deepEqual(Array.from(refreshed.away.players, p => p.id), [6, 7, 8, 9, 10]);
  assert.deepEqual(Array.from(refreshed.home.players, p => p.id), [16, 17, 18, 19, 20]);
  assert.equal(refreshed.away.players[0].points, 9);
  assert.equal(app.mutationRevisionRef.current, 2);
  // A subsequent substitution (including a reversal) must replace the saved five too.
  app.commitLineupChange("away", [1, 7, 8, 9, 10].map(id => `id:${id}`));
  const reloaded = app.applyStoredGameDayRoster(app.applyStoredStarters(original));
  assert.deepEqual(Array.from(reloaded.away.players, p => p.id), [7, 8, 9, 10, 1]);
});

for (const [open, close] of [["openFoul", "closeFoul"], ["openTech", "closeTech"], ["recordFreeThrow", "closeFreeThrow"]]) {
  test(`${open} immediately stops the clock and closing keeps it stopped`, () => {
    const app = harness();
    app[open](true);
    assert.equal(app.running, false);
    assert.equal(app.clockRunningRef.current, false);
    assert.equal(app.matchRef.current.clock, "08:00");
    app[close]();
    assert.equal(app.running, false);
  });
}

function equalizationHarness(awayPresent, homePresent, awayCategory = "13u", homeCategory = awayCategory) {
  const app = harness();
  Object.assign(app, {
    computeEqualization, periodSettings: { periodCount: 4 }, FULL_SHOT_CLOCK: 24,
    arrowChangedThisPeriodRef: { current: false },
    setEndPeriodPrompt: () => {}, setPossessionArrow: () => {},
    getDefaultClockSeconds: () => 480, secondsToClock: () => "08:00",
    getPeriodLabel: period => `Q${period}`,
    buildEqualizationEvent: (team, points) => ({ equalization: true, team, points }),
  });
  Object.assign(app.matchRef.current, { awayScore: 20, homeScore: 30 });
  Object.assign(app.matchRef.current.away, { name: "Aguas Buenas", presentCount: awayPresent, category: awayCategory });
  Object.assign(app.matchRef.current.home, { name: "Fraigcomar", presentCount: homePresent, category: homeCategory });
  for (const name of ["setPeriod", "applyEqualization", "removeEqualization"]) vm.runInContext(handler(name), app);
  return app;
}

test("11 Aguas Buenas vs 12 Fraigcomar awards Fraigcomar +2 once at Q3 and supports undo", () => {
  const app = equalizationHarness(11, 12);
  const before = structuredClone(app.matchRef.current);
  const preview = computeEqualization(before);
  assert.deepEqual(preview, { team: "home", points: 2 });
  app.setPeriod(2);
  assert.equal(app.matchRef.current.homeScore, 30);
  app.setPeriod(3);
  const awarded = app.matchRef.current;
  assert.equal(awarded.awayScore, 20);
  assert.equal(awarded.homeScore, 32);
  assert.equal(awarded.equalizationTeam, preview.team);
  assert.equal(awarded.events[0].team, preview.team);
  assert.deepEqual(awarded.away.players, before.away.players);
  assert.deepEqual(awarded.home.players, before.home.players);
  app.setPeriod(3);
  assert.equal(app.matchRef.current.homeScore, 32);
  assert.equal(app.matchRef.current.events.length, 1);
  const undone = app.removeEqualization(app.matchRef.current);
  assert.equal(undone.homeScore, 30);
  assert.equal(undone.awayScore, 20);
  assert.equal(undone.equalizationApplied, false);
  assert.equal(undone.events.length, 0);
});

test("equalization follows the larger squad on either side and does not award tied attendance", () => {
  for (const [away, home, team, points] of [[12, 11, "away", 2], [9, 12, "home", 6], [12, 9, "away", 6], [12, 12, undefined, 0]]) {
    const app = equalizationHarness(away, home);
    app.setPeriod(3);
    const match = app.matchRef.current;
    assert.equal(match.equalizationTeam, team);
    assert.equal(match.awayScore, 20 + (team === "away" ? points : 0));
    assert.equal(match.homeScore, 30 + (team === "home" ? points : 0));
    assert.equal(match.events.length, points ? 1 : 0);
  }
});

test("14U and older, unknown and mismatched categories never award equalization at Q3", () => {
  for (const [away, home] of [["14u", "14u"], ["15U", "15U"], ["16u", "16u"], ["18u", "18u"], ["", ""], ["13u", "14u"], ["12u", "13u"]]) {
    const app = equalizationHarness(12, 9, away, home);
    assert.equal(computeEqualization(app.matchRef.current), undefined);
    app.setPeriod(3);
    assert.equal(app.matchRef.current.awayScore, 20);
    assert.equal(app.matchRef.current.homeScore, 30);
    assert.equal(app.matchRef.current.events.length, 0);
    assert.equal(app.matchRef.current.equalizationApplied, undefined);
  }
});

test("younger categories still award two points per player", () => {
  for (const category of ["10u", "11u", "12u", " 13U "]) {
    const app = equalizationHarness(12, 9, category);
    app.setPeriod(3);
    assert.equal(app.matchRef.current.awayScore, 26);
    assert.equal(app.matchRef.current.equalizationPoints, 6);
  }
});

function freeThrowHarness() {
  const app = harness();
  Object.assign(app, {
    BENCH_ORDER, timeoutClockSeconds: 0,
    clockToSeconds: clock => clock.split(":").reduce((total, part) => total * 60 + Number(part), 0),
    setFoulOutPrompt: () => {}, checkFoulOut: () => {},
    oppositeTeam: team => team === "away" ? "home" : "away",
    commitAction: () => true,
    foulPrompt: { team: "away", player: app.matchRef.current.away.players[0] },
  });
  app.matchRef.current.shotClock = 18;
  for (const name of ["resumeClockAfterFreeThrows", "commitFreeThrowFor", "recordFoul"]) vm.runInContext(handler(name), app);
  app.stopClockForFoul();
  return app;
}

test("confirmed made and missed standalone free throws resume without resetting either clock", () => {
  for (const made of [true, false]) {
    const app = freeThrowHarness();
    app.commitFreeThrowFor("home", app.matchRef.current.home.players[0], made);
    assert.equal(app.running, true);
    assert.equal(app.clockRunningRef.current, true);
    assert.equal(app.matchRef.current.clock, "08:00");
    assert.equal(app.matchRef.current.shotClock, 18);
  }
});

test("a foul resumes only after the entire free-throw result is recorded, including all misses", () => {
  for (const made of [0, 1, 2]) {
    const app = freeThrowHarness();
    const actions = [];
    app.commitAction = detail => {
      assert.equal(app.running, false);
      actions.push(detail);
      return true;
    };
    app.recordFoul({ fouledPlayer: app.matchRef.current.home.players[0], freeThrowsAttempted: 2, freeThrowsMade: made });
    assert.equal(actions.length, 2);
    assert.equal(actions[1].freeThrowsMade, made);
    assert.equal(app.running, true);
  }
});

test("no free throws or rejected scoring actions leave the clock paused", () => {
  const app = freeThrowHarness();
  app.recordFoul({ freeThrowsAttempted: 0, freeThrowsMade: 0 });
  assert.equal(app.running, false);
  app.commitAction = () => undefined;
  app.commitFreeThrowFor("home", app.matchRef.current.home.players[0], true);
  assert.equal(app.running, false);
  app.recordFoul({ fouledPlayer: app.matchRef.current.home.players[0], freeThrowsAttempted: 2, freeThrowsMade: 1 });
  assert.equal(app.running, false);
});

test("free throws do not restart an expired period, timeout, ended game or unavailable lineup", () => {
  const setups = [
    app => { app.matchRef.current.clock = "00:00"; },
    app => { app.timeoutClockSeconds = 30; },
    ...["Final", "Suspended", "Cancelled"].map(status => app => { app.matchRef.current.status = status; }),
    app => { app.matchRef.current.away.players[0].fouls = 5; },
  ];
  for (const setup of setups) {
    const app = freeThrowHarness();
    setup(app);
    app.commitFreeThrowFor("home", app.matchRef.current.home.players[0], true);
    assert.equal(app.running, false);
    assert.equal(app.clockRunningRef.current, false);
  }
});
