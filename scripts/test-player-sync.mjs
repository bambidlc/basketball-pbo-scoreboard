import assert from "node:assert/strict";
import { createServer } from "vite";

const MODEL = {
  game: "x_game",
  player: "x_player",
};

const FIELD = {
  active: "x_active",
  awayTeam: "x_studio_away_team",
  homeTeam: "x_studio_home_team",
  jersey: "x_studio_jersey_number",
  name: "x_name",
  team: "x_studio_team",
};

function makePlayer({ id, localId, name, number, present = true }) {
  return {
    active: false,
    assists: 0,
    blocks: 0,
    defensiveRebounds: 0,
    fouls: 0,
    techFouls: 0,
    freeThrowsAttempted: 0,
    freeThrowsMade: 0,
    id,
    localId,
    name,
    number,
    offensiveRebounds: 0,
    ot: 0,
    points: 0,
    present,
    q1: 0,
    q2: 0,
    q3: 0,
    q4: 0,
    starter: false,
    steals: 0,
    threePointersAttempted: 0,
    threePointersMade: 0,
    turnovers: 0,
    twoPointersAttempted: 0,
    twoPointersMade: 0,
  };
}

function makeMatch({ awayPlayer, awayTeamId = 10, homePlayer }) {
  return {
    away: {
      bench: [awayPlayer],
      fouls: 0,
      id: awayTeamId,
      label: "Visitor",
      name: "Away Team",
      players: [],
      presentCount: 1,
      timeouts: 0,
    },
    awayScore: 0,
    clock: "10:00",
    events: [],
    gameId: 1,
    home: {
      bench: [homePlayer],
      fouls: 0,
      id: 20,
      label: "Home",
      name: "Home Team",
      players: [],
      presentCount: 1,
      timeouts: 0,
    },
    homeScore: 0,
    matchName: "Sync Contract Game",
    period: 1,
    periodLabel: "1st Quarter",
    possession: "home",
    shotClock: 24,
    status: "Scheduled",
    syncMessage: "Test",
  };
}

class MockOdooClient {
  enabled = true;
  createAttempts = 0;
  failFirstPlayerCreateAfterCommit = false;
  nextPlayerId = 300;
  playerCreates = [];
  playerWrites = [];

  constructor(players = []) {
    this.players = players.map((player) => ({ ...player }));
  }

  async read(model, ids) {
    if (model === MODEL.game) {
      return [{ id: 1, [FIELD.awayTeam]: [10, "Away Team"], [FIELD.homeTeam]: [20, "Home Team"] }];
    }
    if (model === MODEL.player) {
      return this.players.filter((player) => ids.includes(player.id)).map((player) => ({ ...player }));
    }
    return [];
  }

  async searchRead(model, domain) {
    if (model === "ir.model" || model === "ir.model.fields") {
      // Capability discovery deliberately degrades to the supported no-attendance path;
      // these tests focus on the permanent x_player create/update contract.
      throw new Error("Optional metadata unavailable in mock");
    }
    if (model !== MODEL.player) {
      return [];
    }
    const teamId = domain.find((term) => Array.isArray(term) && term[0] === FIELD.team)?.[2];
    return this.players
      .filter((player) => player[FIELD.team] === teamId)
      .map((player) => ({ ...player }));
  }

  async write(model, ids, values) {
    if (model !== MODEL.player) {
      return true;
    }
    for (const id of ids) {
      const player = this.players.find((candidate) => candidate.id === id);
      if (!player) {
        return false;
      }
      Object.assign(player, values);
      this.playerWrites.push({ id, values: { ...values } });
    }
    return true;
  }

  async create(model, values) {
    assert.equal(model, MODEL.player);
    this.createAttempts += 1;
    const id = this.nextPlayerId++;
    const player = { id, ...values };
    this.players.push(player);
    this.playerCreates.push({ id, values: { ...values } });
    if (this.failFirstPlayerCreateAfterCommit && this.createAttempts === 1) {
      throw new Error("Simulated dropped response after commit");
    }
    return id;
  }
}

function storedPlayer({ active = true, id, jersey, name, team }) {
  return {
    id,
    [FIELD.active]: active,
    [FIELD.jersey]: jersey,
    [FIELD.name]: name,
    [FIELD.team]: team,
  };
}

const vite = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const { saveGameDayRoster } = await vite.ssrLoadModule("/src/api/liveMatch.ts");
  const homeStored = storedPlayer({ id: 201, jersey: 9, name: "Home Player", team: 20 });
  const homePlayer = makePlayer({ id: 201, name: "Home Player", number: "9" });

  {
    const client = new MockOdooClient([homeStored]);
    const match = makeMatch({
      awayPlayer: makePlayer({ localId: "away:new", name: "  New   Player  ", number: "07" }),
      // A stale cached id must never decide where the permanent player is created.
      awayTeamId: 999,
      homePlayer,
    });
    const result = await saveGameDayRoster(client, match);
    assert.equal(result.saved, true);
    assert.equal(client.playerCreates.length, 1);
    assert.equal(client.playerCreates[0].values[FIELD.team], 10);
    assert.equal(client.playerCreates[0].values[FIELD.jersey], 7);
    assert.equal(client.playerCreates[0].values[FIELD.name], "New Player");
    assert.equal(result.match.away.id, 10);
    assert.equal(result.match.away.bench[0].id, client.playerCreates[0].id);
  }

  {
    const client = new MockOdooClient([homeStored]);
    client.failFirstPlayerCreateAfterCommit = true;
    const match = makeMatch({
      awayPlayer: makePlayer({ localId: "away:retry", name: "Retry Player", number: "12" }),
      homePlayer,
    });
    const first = await saveGameDayRoster(client, match);
    assert.equal(first.saved, false);
    assert.equal(client.createAttempts, 1);
    const retry = await saveGameDayRoster(client, match);
    assert.equal(retry.saved, true);
    assert.equal(client.createAttempts, 1, "retry must reconnect instead of creating a duplicate");
    assert.equal(retry.match.away.bench[0].id, 300);
  }

  {
    const collision = storedPlayer({ id: 101, jersey: 7, name: "Existing Player", team: 10 });
    const client = new MockOdooClient([collision, homeStored]);
    const match = makeMatch({
      awayPlayer: makePlayer({ localId: "away:collision", name: "Different Player", number: "7" }),
      homePlayer,
    });
    const result = await saveGameDayRoster(client, match);
    assert.equal(result.saved, true);
    assert.equal(client.playerCreates.length, 1, "a different person must get a distinct Odoo record");
    assert.equal(client.players.find((player) => player.id === 101)[FIELD.name], "Existing Player");
    assert.equal(client.playerWrites.some((write) => write.id === 101), false, "the existing person must never be overwritten");
  }

  {
    const archived = storedPlayer({ active: false, id: 102, jersey: 7, name: "Archived Player", team: 10 });
    const client = new MockOdooClient([archived, homeStored]);
    const match = makeMatch({
      awayPlayer: makePlayer({ localId: "away:reuse", name: "Current Player", number: "7" }),
      homePlayer,
    });
    const result = await saveGameDayRoster(client, match);
    assert.equal(result.saved, true);
    assert.equal(client.playerCreates.length, 1, "an archived different person must not block jersey reuse");
  }

  {
    const client = new MockOdooClient([homeStored]);
    const match = makeMatch({
      awayPlayer: makePlayer({ localId: "away:duplicate-1", name: "Player One", number: "1" }),
      homePlayer,
    });
    match.away.bench.push(makePlayer({ localId: "away:duplicate-01", name: "Player Two", number: "01" }));
    const result = await saveGameDayRoster(client, match);
    assert.equal(result.saved, false);
    assert.match(result.log.detail, /assigned more than once/i);
    assert.equal(client.playerCreates.length, 0);
  }

  {
    const client = new MockOdooClient([homeStored]);
    const match = makeMatch({
      awayPlayer: makePlayer({ localId: "away:present-1", name: "Game Day Player", number: "1" }),
      homePlayer,
    });
    match.away.bench.push(
      makePlayer({
        localId: "away:absent-01",
        name: "Historical Player",
        number: "01",
        present: false,
      }),
    );
    const result = await saveGameDayRoster(client, match);
    assert.equal(result.saved, true, "an absent historical duplicate must not block the game-day roster");
    assert.equal(client.playerCreates.length, 2);
  }

  process.stdout.write("Player sync contract tests passed: create, verify, safe retry, team authority, same-jersey identity safety, archived-number reuse, numeric duplicate validation, and absent-player history.\n");
} finally {
  await vite.close();
}
