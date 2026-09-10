import assert from "node:assert/strict";
import test from "node:test";
import { BENCH_ORDER, courtOrder, lineupReview, nextEventId, playerKey, shotLocationFromCoordinates, swappedCourts } from "../src/scoring.ts";

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
