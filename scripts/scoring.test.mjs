import assert from "node:assert/strict";
import test from "node:test";
import { applyPlayerDiscipline, technicalSuspensionNote, isPlayerUnavailable, formatGameCategory, BENCH_ORDER, courtOrder, lineupReview, nextEventId, playerKey, shotLocationFromCoordinates, swappedCourts } from "../src/scoring.ts";

const player = (id, extras = {}) => ({ id, name: `Player ${id}`, number: String(id), present: true, fouls: 0, ...extras });
const team = () => ({ players: [1, 2, 3, 4, 5].map((id) => player(id)), bench: [player(6), player(7)] });
const draft = (ids, reason = "") => ({ keys: ids.map((id) => playerKey(player(id))), reason });

test("court changes preserve bench order and are reversible", () => {
  const original = { left: "away", right: "home" };
  assert.deepEqual(courtOrder(swappedCourts(original)), ["home", "away"]);
  assert.deepEqual(BENCH_ORDER, ["away", "home"]);
  assert.deepEqual(swappedCourts(swappedCourts(original)), original);
  assert.deepEqual(original, { left: "away", right: "home" });
});

test("each team retains its own note and lineup when preparing simultaneous substitutions", () => {
  const away = lineupReview(team(), draft([2, 3, 4, 5, 6], "Rest"), 1);
  const home = lineupReview(team(), draft([1, 2, 3, 4, 7], "Tactical"), 1);
  assert.equal(away.error, undefined);
  assert.equal(home.error, undefined);
  assert.deepEqual(away.outgoing.map((p) => p.id), [1]);
  assert.deepEqual(home.incoming.map((p) => p.id), [7]);
  assert.ok(lineupReview(team(), draft([1, 2, 3, 4, 7]), 1).error);
});

test("an unchanged team needs no Q1 reason and does not block the other team", () => {
  const review = lineupReview(team(), draft([1, 2, 3, 4, 5]), 1);
  assert.equal(review.changed, false);
  assert.equal(review.error, undefined);
  assert.equal(lineupReview(team(), draft([2, 3, 4, 5, 6]), 2).error, undefined);
});

test("incomplete, duplicated, absent, unknown and fouled-out selections are rejected", () => {
  const side = team();
  side.bench.push(player(8, { present: false }), player(9, { fouls: 5 }));
  for (const ids of [[1, 2, 3, 4], [1, 2, 3, 6, 6], [1, 2, 3, 4, 8], [1, 2, 3, 4, 9], [1, 2, 3, 4, 99]]) {
    assert.ok(lineupReview(side, draft(ids), 2).error, ids.join(","));
  }
});

test("a fouled-out player can leave and a short-handed lineup can substitute", () => {
  const side = team();
  side.players[0].fouls = 5;
  side.players[0].present = false;
  assert.equal(lineupReview(side, draft([2, 3, 4, 5, 6]), 2).error, undefined);
  side.players.pop();
  assert.equal(lineupReview(side, draft([2, 3, 4, 6]), 2).error, undefined);
});

test("local player identity remains stable after Odoo resolves its record ID", () => {
  assert.equal(playerKey(player(undefined, { localId: "away-123" })), "local:away-123");
  assert.equal(playerKey(player(99, { localId: "away-123" })), "local:away-123");
  assert.equal(playerKey(player(99)), "id:99");
});

test("both teams receive unique event IDs even with the same timestamp", () => {
  const history = [{ id: 1000 }];
  const first = nextEventId(history, 1000);
  const firstTeamEvents = [0, 1, 2].map((offset) => ({ id: first + offset }));
  const second = nextEventId([...firstTeamEvents, ...history], 1000);
  const ids = [...firstTeamEvents.map((event) => event.id), second, second + 1];
  assert.equal(new Set(ids).size, 5);
  assert.equal(second, 1004);
});

test("court-free and legacy free-throw events never gain a fictitious shot-chart position", () => {
  for (const zone of ["", "2pt", "3pt", "free throw"]) {
    assert.equal(shotLocationFromCoordinates(0, 0, zone, 3), undefined);
  }
  assert.deepEqual(shotLocationFromCoordinates(610, 200, "Paint", 2), {
    x: 610, y: 200, zone: "Paint", side: "right", value: 2,
  });
});

const disciplineMatch = (events = [], extras = {}) => ({
  away: { players: [player(1, { techFouls: 0, ...extras })], bench: [] },
  home: { players: [player(2, { number: "1", techFouls: 0 })], bench: [] }, events,
});
const techEvent = (id, note) => ({ id, action: "tech foul", team: "away", playerId: 1, player: "#1", note });

test("first technical stays eligible; second automatically suspends for this game", () => {
  assert.equal(technicalSuspensionNote(player(1, { techFouls: 0 }), false, ""), undefined);
  assert.equal(isPlayerUnavailable(applyPlayerDiscipline(disciplineMatch([techEvent(1)])).away.players[0]), false);
  const match = applyPlayerDiscipline(disciplineMatch([techEvent(2), techEvent(1)]));
  assert.equal(match.away.players[0].suspensionReason, "Dos faltas técnicas");
  assert.equal(isPlayerUnavailable(match.home.players[0]), false);
  assert.match(technicalSuspensionNote(player(1, { techFouls: 1 }), false, ""), /Dos faltas técnicas/);
});

test("manual suspension requires a reason and survives a serialized reload", () => {
  assert.throws(() => technicalSuspensionNote(player(1, { techFouls: 0 }), true, "  "), /motivo/);
  const note = technicalSuspensionNote(player(1, { techFouls: 0 }), true, " Conducta antideportiva ");
  const match = applyPlayerDiscipline(JSON.parse(JSON.stringify(disciplineMatch([techEvent(1, note)]))));
  assert.equal(match.away.players[0].suspensionReason, "Conducta antideportiva");
  assert.equal(isPlayerUnavailable(match.away.players[0]), true);
  assert.equal(isPlayerUnavailable(match.home.players[0]), false);
});

test("undoing suspension or second technical restores eligibility without leaking into another game", () => {
  const match = applyPlayerDiscipline(disciplineMatch([techEvent(1), techEvent(2)]));
  assert.equal(isPlayerUnavailable(applyPlayerDiscipline({ ...match, away: { ...match.away, players: [{ ...match.away.players[0], techFouls: 1 }] }, events: [techEvent(1)] }).away.players[0]), false);
  assert.equal(applyPlayerDiscipline({ ...match, away: { ...match.away, players: [{ ...match.away.players[0], techFouls: 0 }] }, events: [] }).away.players[0].suspensionReason, undefined);
});

test("suspended players can leave but cannot enter a lineup", () => {
  const side = team();
  side.players[0].suspensionReason = "Dos faltas técnicas";
  side.bench[0].techFouls = 2;
  assert.ok(lineupReview(side, draft([1, 2, 3, 4, 5]), 2).error);
  assert.ok(lineupReview(side, draft([2, 3, 4, 5, 6]), 2).error);
  assert.equal(lineupReview(side, draft([2, 3, 4, 5, 7]), 2).error, undefined);
});

test("game categories use both teams without guessing missing age groups", () => {
  assert.equal(formatGameCategory("12u", "12U"), "Categoría 12U");
  assert.equal(formatGameCategory("12U", "13U"), "Categoría 12U / 13U");
  assert.equal(formatGameCategory(), "Categoría por confirmar");
});
