import assert from "node:assert/strict";
import { IDBFactory, IDBDatabase } from "fake-indexeddb";
import { createServer } from "vite";

const vite = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
try {
  const { DeviceStorage } = await vite.ssrLoadModule("/src/api/deviceStorage.ts");
  const { parseScorerBackup, mergeBackupOperations, backupMatches } = await vite.ssrLoadModule("/src/api/backup.ts");
  const { fallbackMatch } = await vite.ssrLoadModule("/src/api/liveMatch.ts");
  class LocalStorage {
    values = new Map();
    quota = 5 * 1024 * 1024;
    get length() { return this.values.size; }
    key(index) { return [...this.values.keys()][index]; }
    getItem(key) { return this.values.get(key) ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) {
      const next = new Map(this.values).set(key, value);
      if ([...next.values()].reduce((total, value) => total + value.length * 2, 0) > this.quota) throw new DOMException("Quota exceeded", "QuotaExceededError");
      this.values = next;
    }
  }
  const game = { ...structuredClone(fallbackMatch), gameId: 261, events: [], period: 1, status: "Live" };
  for (const side of ["away", "home"]) {
    game[side].id = side === "away" ? 54 : 96;
    const roster = Array.from({ length: 18 }, (_, index) => ({ ...structuredClone(game[side].players[0]),
      assists: 0, blocks: 0, defensiveRebounds: 0, fouls: 0, techFouls: 0, freeThrowsAttempted: 0, freeThrowsMade: 0,
      offensiveRebounds: 0, points: 0, q1: 0, q2: 0, q3: 0, q4: 0, ot: 0, steals: 0,
      threePointersAttempted: 0, threePointersMade: 0, turnovers: 0, twoPointersAttempted: 0, twoPointersMade: 0,
      id: 100 + index + (side === "home" ? 100 : 0), number: String(index), name: `Player ${side} ${index}` }));
    game[side].players = roster.slice(0, 5);
    game[side].bench = roster.slice(5);
  }
  const ops = Array.from({ length: 321 }, (_, index) => ({ id: `offline-${index}`, kind: "action", attempts: 0, createdAt: index + 1, eventId: 1000 + index,
    input: { match: { ...structuredClone(game), awayScore: (index + 1) * 2, period: 1 + Math.floor(index / 81) },
      action: "made 2pt", label: "2PT Made", selectedTeam: "away", points: 2, nextAwayScore: (index + 1) * 2, nextHomeScore: 0,
      player: { ...game.away.players[0], points: index * 2 }, shotType: "2pt", shotMade: true } }));
  const json = JSON.stringify(ops);
  assert.ok(json.length * 2 > 5 * 1024 * 1024, "reproduce the legacy quota failure with full roster snapshots");
  const legacy = new LocalStorage();
  legacy.setItem("pbo:outbox", JSON.stringify(ops.slice(0, 100)));
  legacy.setItem("pbo:selectedGameId", "261");
  assert.throws(() => legacy.setItem("pbo:outbox", json), /Quota/);
  const factory = new IDBFactory();
  const store = new DeviceStorage(legacy, factory);
  await store.initialize();
  assert.equal(JSON.parse(store.get("pbo:outbox")).length, 100, "legacy queue migrates before the scorer starts");
  store.set("pbo:outbox", json);
  store.set("pbo:liveMatches:v2", JSON.stringify({ 261: { match: ops.at(-1).input.match } }));
  assert.equal(await store.flush(), true);
  const reloaded = new DeviceStorage(legacy, factory);
  await reloaded.initialize();
  assert.equal(reloaded.get("pbo:outbox"), json, "all 321 full operations survive a restart despite full localStorage");
  assert.equal(JSON.parse(reloaded.get("pbo:liveMatches:v2"))[261].match.period, 4);
  assert.equal(reloaded.failed, false);
  // An aborted transaction must not claim success or lose its in-memory recovery copy.
  const originalTransaction = IDBDatabase.prototype.transaction;
  let abortOnce = true;
  IDBDatabase.prototype.transaction = function (...args) {
    const transaction = originalTransaction.apply(this, args);
    if (abortOnce && args[1] === "readwrite") { abortOnce = false; queueMicrotask(() => transaction.abort()); }
    return transaction;
  };
  const remaining = JSON.stringify(ops.slice(1));
  store.set("pbo:outbox", remaining);
  store.set("pbo:confirmedOperations:v1", JSON.stringify({ "offline-0": 1 }));
  assert.equal(await store.flush(), false);
  assert.equal(store.failed, true);
  assert.equal(store.get("pbo:outbox"), remaining, "failed data remains exportable");
  IDBDatabase.prototype.transaction = originalTransaction;
  const afterAbort = new DeviceStorage(legacy, factory);
  await afterAbort.initialize();
  assert.equal(afterAbort.get("pbo:outbox"), json, "old committed backup remains intact on abort");
  assert.equal(afterAbort.get("pbo:confirmedOperations:v1"), undefined, "ack ledger and outbox commit atomically");
  assert.equal(await store.flush(), true, "retry persists the retained batch");
  const afterRetry = new DeviceStorage(legacy, factory);
  await afterRetry.initialize();
  assert.equal(afterRetry.get("pbo:outbox"), remaining);
  assert.equal(afterRetry.get("pbo:confirmedOperations:v1"), '{"offline-0":1}');
  IDBDatabase.prototype.transaction = function (...args) {
    if (args[1] === "readonly") throw new Error("Read unavailable");
    return originalTransaction.apply(this, args);
  };
  const failedStartup = new DeviceStorage(legacy, factory);
  await assert.rejects(failedStartup.initialize(), /No se pudo abrir/, "a failed database read must not resume an older legacy score");
  IDBDatabase.prototype.transaction = originalTransaction;

  const backup = parseScorerBackup(JSON.stringify({ savedAt: new Date().toISOString(), match: ops.at(-1).input.match, pendingOps: ops }));
  const correctedRoster = { id: "roster-corrected", kind: "roster", createdAt: 999, attempts: 0, match: { ...game,
    away: { ...game.away, players: game.away.players.map(player => ({ ...player, number: String(Number(player.number) + 50) })) } } };
  const merged = mergeBackupOperations([correctedRoster, ...ops.slice(100)], backup, { "offline-0": 1 });
  assert.equal(merged.length, 321);
  assert.equal(merged[0].id, "roster-corrected", "newer roster still precedes restored plays");
  assert.equal(merged[1].id, "offline-1");
  assert.equal(merged[1].input.player.number, "50", "current jersey corrections carry into restored plays");
  assert.equal(merged[1].input.player.points, 2, "pre-action stats are never rewritten from the current roster");
  assert.deepEqual(mergeBackupOperations(merged, backup, { "offline-0": 1 }), merged, "importing twice never duplicates an operation");
  const recovered = backupMatches(backup, merged)[0];
  assert.equal(recovered.awayScore, 642);
  assert.equal(recovered.period, 4);
  assert.equal(recovered.events.length, 320);
  assert.throws(() => parseScorerBackup('{"pendingOps":[]}'), /válido/);
  assert.throws(() => parseScorerBackup(JSON.stringify({ ...backup, pendingOps: [...ops, ops[0]] })), /duplicados/);
  // With no IndexedDB, do not claim that a quota-failed fallback write is durable.
  const fallback = new DeviceStorage(legacy);
  await fallback.initialize();
  fallback.set("pbo:outbox", json);
  assert.equal(await fallback.flush(), false);
  assert.equal(fallback.failed, true);
  assert.equal(fallback.snapshot()["pbo:outbox"], json);
  console.log("Device storage passed: 321 plays above legacy quota, migration/restart, atomic abort/retry, backup restoration, corrected rosters and duplicate imports.");
} finally { await vite.close(); }
