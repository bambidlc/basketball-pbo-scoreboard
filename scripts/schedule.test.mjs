import assert from "node:assert/strict";
import test from "node:test";
import {
  currentOdooDateTimeKey,
  currentPboDateKey,
  findRelevantGame,
  matchDateKey,
  orderGamesByRelevance,
  shouldAdvanceToRelevantGame,
} from "../src/schedule.ts";

function game(id, datetime, status = "Scheduled") {
  return {
    awayName: `Away ${id}`,
    awayScore: 0,
    datetime,
    homeName: `Home ${id}`,
    homeScore: 0,
    id,
    name: `Game ${id}`,
    status,
    week: "",
  };
}

test("Puerto Rico date is independent of the browser's local timezone", () => {
  assert.equal(currentPboDateKey(new Date("2026-09-04T03:30:00Z")), "2026-09-03");
  assert.equal(currentOdooDateTimeKey(new Date("2026-09-04T03:30:00Z")), "2026-09-04 03:30:00");
  assert.equal(matchDateKey("2026-09-04 03:30:00"), "2026-09-03");
});

test("orders the nearest future date first and recent past dates afterward", () => {
  const ordered = orderGamesByRelevance([
    game(1, "2026-08-29 10:00:00", "Played"),
    game(2, "2026-09-06 12:00:00"),
    game(3, "2026-09-05 14:00:00"),
    game(4, "2026-08-30 09:00:00", "Played"),
  ], "2026-09-03", "2026-09-03 18:00:00");

  assert.deepEqual(ordered.map(({ id }) => id), [3, 2, 4, 1]);
  assert.equal(findRelevantGame(ordered, "2026-09-03", "2026-09-03 18:00:00")?.id, 3);
});

test("a current live game wins and stale stored games advance", () => {
  const stale = game(1, "2026-08-30 10:00:00", "Played");
  const live = game(2, "2026-09-03 19:00:00", "Live");
  const next = game(3, "2026-09-03 20:00:00");
  const oldLive = game(4, "2026-08-30 11:00:00", "Live");
  const now = "2026-09-03 18:00:00";

  assert.equal(findRelevantGame([next, stale, oldLive, live], "2026-09-03", now)?.id, 2);
  assert.equal(shouldAdvanceToRelevantGame(stale, "2026-09-03", now), true);
  assert.equal(shouldAdvanceToRelevantGame(oldLive, "2026-09-03", now), true);
  assert.equal(shouldAdvanceToRelevantGame(next, "2026-09-03", now), false);
  assert.equal(shouldAdvanceToRelevantGame(live, "2026-09-03", now), false);
});

test("passed games from today move behind the next tip-off", () => {
  const ordered = orderGamesByRelevance([
    game(1, "2026-09-03 14:00:00"),
    game(2, "2026-09-03 21:00:00"),
    game(3, "2026-09-05 13:00:00"),
  ], "2026-09-03", "2026-09-03 18:00:00");

  assert.deepEqual(ordered.map(({ id }) => id), [2, 3, 1]);
  assert.equal(findRelevantGame(ordered, "2026-09-03", "2026-09-03 18:00:00")?.id, 2);
});
