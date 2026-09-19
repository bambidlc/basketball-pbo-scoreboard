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

  {
    const client = new MockOdooClient([
      storedPlayer({ id: 101, jersey: 7, name: 'Away Player', team: 10 }), homeStored,
    ]);
    const match = makeMatch({ awayPlayer: makePlayer({ id: 101, number: '7', name: 'Away Player' }), homePlayer });
    assert.equal((await saveGameDayRoster(client, match)).saved, true);
    assert.equal(client.playerWrites.length, 0, 'unchanged players must not generate writes');
    match.away.bench[0].name = 'Edited Player';
    assert.equal((await saveGameDayRoster(client, match)).saved, true);
    assert.equal(client.playerWrites.length, 1, 'only the edited player should be written');
  }

  {
    const s = await vite.ssrLoadModule('/src/api/schema.ts');
    const { MODELS: M, ATTENDANCE: A } = s;
    const fields = { [M.game]: [...s.GAME_FIELDS, ...s.GAME_OPTIONAL_FIELDS], [M.gameAttendance]: s.ATTENDANCE_FIELDS, [M.gameEvent]: s.GAME_EVENT_FIELDS, [M.playerGameStat]: s.PLAYER_STAT_FIELDS };
    class AttendanceClient extends MockOdooClient {
      attendance = []; attendanceLookups = 0; attendanceWrites = 0; attendanceCreates = 0;
      async searchRead(model, domain) {
        if (model === 'ir.model') return Object.keys(fields).map(model => ({ model }));
        if (model === 'ir.model.fields') return Object.entries(fields).flatMap(([model, names]) => names.map(name => ({ model, name })));
        if (model === M.gameAttendance) { this.attendanceLookups++; return this.attendance.map(row => ({ ...row })); }
        return super.searchRead(model, domain);
      }
      async write(model, ids, vals) {
        if (model !== M.gameAttendance) return super.write(model, ids, vals);
        this.attendanceWrites++;
        for (const row of this.attendance) if (ids.includes(row.id)) Object.assign(row, vals);
        return true;
      }
      async create(model, vals) {
        if (model !== M.gameAttendance) return super.create(model, vals);
        this.attendanceCreates++;
        const id = 500 + this.attendance.length;
        this.attendance.push({ id, ...vals }); return id;
      }
    }
    const client = new AttendanceClient([storedPlayer({ id: 101, jersey: 7, name: 'Away Player', team: 10 }), homeStored]);
    const match = makeMatch({ awayPlayer: makePlayer({ id: 101, number: '7', name: 'Away Player' }), homePlayer });
    assert.equal((await saveGameDayRoster(client, match)).saved, true);
    assert.equal(client.attendanceLookups, 1, 'one attendance lookup covers both teams');
    assert.equal(client.attendanceCreates, 2);
    assert.equal((await saveGameDayRoster(client, match)).saved, true);
    assert.equal(client.attendanceWrites, 0, 'unchanged attendance should not be rewritten');
    match.away.bench[0].present = false;
    match.away.bench[0].removedFromRoster = true;
    assert.equal((await saveGameDayRoster(client, match)).saved, true);
    assert.equal(client.attendanceWrites, 1);
    assert.equal(client.attendance.find(row => row[A.player] === 101)[A.present], false);
    assert.equal(client.players.length, 2, 'game removal preserves permanent player records');
    match.away.bench[0].present = true;
    match.away.bench[0].removedFromRoster = false;
    assert.equal((await saveGameDayRoster(client, match)).saved, true);
    assert.equal(client.attendance.find(row => row[A.player] === 101)[A.present], true);
    assert.equal(client.attendanceCreates, 2, 'restore does not duplicate attendance');
  }

  process.stdout.write("Player sync contract tests passed, including unchanged roster/attendance writes, edit-only saves, batch attendance lookup, and reversible game removal.\n");
} finally {
  await vite.close();
}
