import assert from "node:assert/strict";
import { createServer } from "vite";

const GAME = {
  awayScore: "x_studio_away_score",
  homeScore: "x_studio_home_score",
  status: "x_studio_status",
};

const EVENT = {
  actionType: "x_studio_action_type",
  game: "x_studio_game",
  note: "x_studio_note",
};

class MockOdooClient {
  enabled = true;
  eventCreates = 0;
  dropFirstEventResponse = false;
  nextEventId = 900;
  writeConfirmed = true;

  constructor() {
    this.game = {
      id: 77,
      [GAME.awayScore]: 0,
      [GAME.homeScore]: 0,
      [GAME.status]: "Scheduled",
    };
    this.events = [];
  }

  async searchRead(model, domain) {
    if (model === "ir.model" || model === "ir.model.fields") {
      throw new Error("Optional metadata unavailable in mock");
    }
    if (model !== "x_game_event") {
      return [];
    }
    const gameId = domain.find((term) => Array.isArray(term) && term[0] === EVENT.game)?.[2];
    const action = domain.find((term) => Array.isArray(term) && term[0] === EVENT.actionType)?.[2];
    const note = domain.find((term) => Array.isArray(term) && term[0] === EVENT.note)?.[2];
    return this.events.filter(
      (event) => event[EVENT.game] === gameId && event[EVENT.actionType] === action && event[EVENT.note] === note,
    );
  }

  async write(model, ids, values) {
    assert.equal(model, "x_game");
    assert.deepEqual(ids, [77]);
    if (!this.writeConfirmed) {
      return false;
    }
    Object.assign(this.game, values);
    return true;
  }

  async read(model, ids) {
    assert.equal(model, "x_game");
    assert.deepEqual(ids, [77]);
    return [{ ...this.game }];
  }

  async create(model, values) {
    assert.equal(model, "x_game_event");
    this.eventCreates += 1;
    const id = this.nextEventId++;
    this.events.push({ id, ...values });
    if (this.dropFirstEventResponse && this.eventCreates === 1) {
      throw new Error("Simulated dropped event-create response");
    }
    return id;
  }
}

const vite = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const { fallbackMatch, saveMatchStatus } = await vite.ssrLoadModule("/src/api/liveMatch.ts");
  const makeMatch = (awayScore, homeScore) => ({
    ...fallbackMatch,
    away: { ...fallbackMatch.away, name: "Visitor Team" },
    awayScore,
    gameId: 77,
    home: { ...fallbackMatch.home, name: "Home Team" },
    homeScore,
  });

  {
    const client = new MockOdooClient();
    const result = await saveMatchStatus(client, makeMatch(71, 68), "Final", "Official result");
    assert.equal(result.saved, true);
    assert.equal(client.game[GAME.awayScore], 71);
    assert.equal(client.game[GAME.homeScore], 68);
    assert.equal(client.game[GAME.status], "Final");
    assert.equal("x_studio_website_description" in client.game, false);
    assert.equal(client.eventCreates, 0, "a final result must not create a suspension event");
  }

  {
    const client = new MockOdooClient();
    const result = await saveMatchStatus(client, makeMatch(35, 41), "Suspended", "Power outage");
    assert.equal(result.saved, true);
    assert.equal(client.game[GAME.status], "Suspended");
    assert.equal("x_studio_website_description" in client.game, false);
    assert.equal(client.eventCreates, 1);
    assert.equal(client.events[0][EVENT.note], "Power outage");

    const retry = await saveMatchStatus(client, makeMatch(35, 41), "Suspended", "Power outage");
    assert.equal(retry.saved, true);
    assert.equal(client.eventCreates, 1, "retry must reuse the existing suspension event");
    assert.equal(retry.eventId, client.events[0].id);
  }

  {
    const client = new MockOdooClient();
    client.dropFirstEventResponse = true;
    const first = await saveMatchStatus(client, makeMatch(22, 19), "Suspended", "Unsafe court");
    assert.equal(first.saved, false);
    const retry = await saveMatchStatus(client, makeMatch(22, 19), "Suspended", "Unsafe court");
    assert.equal(retry.saved, true);
    assert.equal(client.eventCreates, 1, "a dropped create response must not duplicate the reason");
  }

  {
    const client = new MockOdooClient();
    const result = await saveMatchStatus(client, makeMatch(10, 12), "Suspended", "   ");
    assert.equal(result.saved, false);
    assert.match(result.log.detail, /reason is required/i);
    assert.equal(client.game[GAME.status], "Scheduled");
  }

  {
    const client = new MockOdooClient();
    client.writeConfirmed = false;
    const result = await saveMatchStatus(client, makeMatch(50, 49), "Final");
    assert.equal(result.saved, false);
    assert.match(result.log.detail, /did not confirm/i);
  }

  process.stdout.write("Game resolution contract tests passed: score/status write-back, required suspension reason, play-by-play notes, verified Odoo writes, and idempotent retries.\n");
} finally {
  await vite.close();
}
