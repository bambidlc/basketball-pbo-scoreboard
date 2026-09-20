import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { MODELS, PLAYER, PLAYER_FIELDS, PLAYER_STAT, PLAYER_STAT_FIELDS, PLAYER_STAT_OPTIONAL_FIELDS } from "../src/api/schema.ts";

// Run the production normalization/read/write functions without a live Odoo connection.
const source = ts.createSourceFile("liveMatch.ts", readFileSync(new URL("../src/api/liveMatch.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const app = vm.createContext({ MODELS, PLAYER, PLAYER_STAT, PLAYER_STAT_FIELDS, PLAYER_STAT_OPTIONAL_FIELDS });
for (const name of ["numberValue", "optionalNumberValue", "stringValue", "createPlayer", "normalizePlayer", "loadStatsForGame", "filterReadableFields", "filterWritableValues", "uniqueStrings", "getPeriodField", "periodFieldToPlayerKey", "fieldsAreSame", "savePlayerStat"]) {
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, name);
  vm.runInContext(ts.transpile(fn.getText(source), { target: ts.ScriptTarget.ES2022 }), app);
}
const record = id => ({ id, [PLAYER.name]: `Player ${id}`, [PLAYER.jerseyNumber]: id, [PLAYER.totalPoints]: 150 });
const normalize = (stat, id = 1) => app.normalizePlayer(record(id), new Map(stat ? [[id, stat]] : []), 0);

test("unmarked players never inherit points from other games", () => {
  assert.equal(normalize().points, 0);
  assert.equal(normalize({ id: 101, [PLAYER_STAT.fouls]: 1 }).points, 0);
  assert.equal(normalize({ id: 101, [PLAYER_STAT.totalPoints]: 0 }).points, 0);
  assert.equal(PLAYER_FIELDS.includes(PLAYER.totalPoints), false);
});

test("an explicitly saved zero is retained, including after a scoring correction", () => {
  assert.equal(normalize({ [PLAYER_STAT.totalPoints]: 0, [PLAYER_STAT.q1]: 2 }).points, 0);
});

test("missing game totals fall back only to this game's quarters and overtime", () => {
  for (const total of [undefined, false, null, NaN]) {
    assert.equal(normalize({ [PLAYER_STAT.totalPoints]: total, [PLAYER_STAT.q1]: 2, [PLAYER_STAT.q2]: 3, [PLAYER_STAT.q3]: 4, [PLAYER_STAT.q4]: 5, [PLAYER_STAT.overtime]: 1 }).points, 15);
  }
  assert.equal(normalize({ [PLAYER_STAT.totalPoints]: 7, [PLAYER_STAT.q1]: 2 }).points, 7);
});

test("only the selected scorer's game stat receives the new points, including on retry", async () => {
  const writes = [];
  app.upsertPlayerStat = async (_client, input, values) => {
    writes.push({ game: input.match.gameId, player: input.player.id, values });
    return 101;
  };
  const shooter = normalize();
  const untouched = normalize(undefined, 2);
  const input = { action: "made 2pt", points: 2, player: shooter, match: { gameId: 42, period: 2 }, shotType: "2pt", shotMade: true };
  const capabilities = { playerGameStat: { fields: new Set(Object.values(PLAYER_STAT)) } };
  await app.savePlayerStat({}, input, capabilities);
  await app.savePlayerStat({}, input, capabilities);
  assert.equal(writes.length, 2);
  for (const write of writes) {
    assert.equal(write.game, 42);
    assert.equal(write.player, 1);
    assert.equal(write.values[PLAYER_STAT.totalPoints], 2);
    assert.equal(write.values[PLAYER_STAT.q2], 2);
  }
  assert.equal(untouched.points, 0);
  const reloaded = normalize({ ...writes[0].values, id: 101 });
  assert.equal(reloaded.points, 2);
});

test("failed game-stat reads propagate instead of manufacturing zero stats", async () => {
  const failure = new Error("Connection failed");
  const client = { searchRead: async () => { throw failure; } };
  await assert.rejects(app.loadStatsForGame(client, 42, { playerGameStat: { fields: new Set() } }), failure);
  await assert.rejects(app.loadStatsForGame(client, 42, { playerGameStat: { fields: new Set(PLAYER_STAT_OPTIONAL_FIELDS) } }), failure);
});

test("empty successful reads and core-field retry remain scoped to the requested game", async () => {
  let calls = 0;
  const client = { searchRead: async (model, domain) => {
    assert.equal(model, MODELS.playerGameStat);
    assert.equal(domain[0][0], PLAYER_STAT.game);
    assert.equal(domain[0][2], 42);
    if (++calls === 1) throw new Error("Optional field unavailable");
    return [];
  } };
  const result = await app.loadStatsForGame(client, 42, { playerGameStat: { fields: new Set(PLAYER_STAT_OPTIONAL_FIELDS) } });
  assert.equal(result.length, 0);
  assert.equal(calls, 2);
});
