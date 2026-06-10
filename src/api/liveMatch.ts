import {
  GAME,
  GAME_EVENT,
  GAME_EVENT_FIELDS,
  GAME_FIELDS,
  GAME_OPTIONAL_FIELDS,
  MODELS,
  PLAYER,
  PLAYER_FIELDS,
  PLAYER_STAT,
  PLAYER_STAT_FIELDS,
  PLAYER_STAT_OPTIONAL_FIELDS,
  TEAM,
  TEAM_FIELDS,
} from "./schema";
import { OdooClient, type OdooRecord } from "./odooClient";

export type TeamId = "away" | "home";

export type ActionKey =
  | "made 2pt"
  | "missed 2pt"
  | "made 3pt"
  | "missed 3pt"
  | "free throw made"
  | "free throw missed"
  | "made"
  | "missed"
  | "offensive rebound"
  | "defensive rebound"
  | "assist"
  | "turnover"
  | "steal"
  | "block"
  | "personal foul"
  | "tech foul"
  | "substitution";

export type ShotType = "2pt" | "3pt" | "free throw";

export type ShotLocation = {
  side: "left" | "right";
  value: 2 | 3;
  x: number;
  y: number;
  zone: string;
};

export type Player = {
  active?: boolean;
  assists: number;
  blocks: number;
  defensiveRebounds: number;
  fouls: number;
  freeThrowsAttempted: number;
  freeThrowsMade: number;
  id?: number;
  name: string;
  number: string;
  offensiveRebounds: number;
  points: number;
  position?: string;
  q1: number;
  q2: number;
  q3: number;
  q4: number;
  ot: number;
  statId?: number;
  steals: number;
  threePointersAttempted: number;
  threePointersMade: number;
  turnovers: number;
  twoPointersAttempted: number;
  twoPointersMade: number;
};

export type Team = {
  bench: Player[];
  category?: string;
  fouls: number;
  id?: number;
  label: "Away" | "Home";
  name: string;
  players: Player[];
  record?: string;
  timeouts: number;
};

export type GameEvent = {
  action?: ActionKey;
  icon: "made" | "missed" | "turnover" | "rebound";
  id: number;
  label: string;
  period?: number;
  player: string;
  playerId?: number;
  points?: number;
  score?: string;
  serverEventId?: number;
  shotLocation?: ShotLocation;
  shotType?: ShotType;
  team: TeamId;
  time: string;
};

export type SyncLogEntry = {
  detail?: string;
  id: number;
  level: "info" | "success" | "warning" | "error";
  message: string;
  time: string;
};

export type LiveMatch = {
  away: Team;
  awayScore: number;
  clock: string;
  events: GameEvent[];
  gameId?: number;
  home: Team;
  homeScore: number;
  matchName: string;
  period: number;
  periodLabel: string;
  possession: TeamId;
  shotClock: number;
  status: string;
  syncMessage: string;
  syncedAt?: string;
};

export type LoadMatchResult = {
  log: SyncLogEntry;
  match: LiveMatch;
  source: "api" | "local";
};

export type MatchOption = {
  awayName: string;
  awayScore: number;
  datetime?: string;
  homeName: string;
  homeScore: number;
  id: number;
  location?: string;
  name: string;
  status: string;
  week?: string;
};

export type SaveMatchActionInput = {
  action: ActionKey;
  foulOnShot?: boolean;
  freeThrowsAttempted?: number;
  freeThrowsMade?: number;
  label: string;
  match: LiveMatch;
  nextAwayScore: number;
  nextHomeScore: number;
  opponentTurnoverPlayer?: Player;
  opponentTurnoverTeam?: TeamId;
  points: number;
  player: Player;
  selectedTeam: TeamId;
  shotLocation?: ShotLocation;
  shotMade?: boolean;
  shotType?: ShotType;
  shotValue?: 1 | 2 | 3;
};

export type SaveMatchActionResult = {
  eventId?: number;
  log: SyncLogEntry;
  opponentTurnoverStatId?: number;
  playerStatId?: number;
  saved: boolean;
};

export type SaveMatchCorrectionInput = {
  label: string;
  match: LiveMatch;
  player?: Player;
  players?: Player[];
  serverEventId?: number;
};

type TeamSide = {
  fallback: Team;
  fouls?: number;
  label: "Away" | "Home";
  relationName?: string;
  side: TeamId;
  team?: OdooRecord;
  teamId?: number;
  timeouts?: number;
};

type ModelCapability = {
  exists: boolean;
  fields: Set<string>;
};

type SchemaCapabilities = {
  game: ModelCapability;
  gameEvent: ModelCapability;
  playerGameStat: ModelCapability;
};

type PlayerStatSaveResult = {
  message: string;
  statId?: number;
};

const capabilityCache = new WeakMap<OdooClient, Promise<SchemaCapabilities>>();
const statUpsertQueues = new WeakMap<OdooClient, Map<string, Promise<number | undefined>>>();

export const fallbackMatch: LiveMatch = {
  away: {
    bench: [],
    fouls: 0,
    label: "Away",
    name: "Away",
    players: [],
    timeouts: 0,
  },
  awayScore: 0,
  clock: "00:00",
  events: [],
  home: {
    bench: [],
    fouls: 0,
    label: "Home",
    name: "Home",
    players: [],
    timeouts: 0,
  },
  homeScore: 0,
  matchName: "Waiting for match",
  period: 1,
  periodLabel: "1st Quarter",
  possession: "home",
  shotClock: 24,
  status: "Waiting",
  syncMessage: "Waiting for live data",
};

export async function loadLiveMatch(client: OdooClient, gameId?: number): Promise<LoadMatchResult> {
  if (!client.enabled) {
    return {
      log: createLog("warning", "Local data loaded", "Add live connection values to enable sync."),
      match: fallbackMatch,
      source: "local",
    };
  }

  try {
    const capabilities = await getSchemaCapabilities(client);
    const game = await loadGameRecord(client, gameId, capabilities);
    if (!game) {
      return {
        log: createLog("warning", "No live game found", "Set VITE_LIVE_GAME_ID or mark one game as Live."),
        match: fallbackMatch,
        source: "local",
      };
    }

    const match = await normalizeGameRecord(client, game, capabilities);
    return {
      log: createLog(
        "success",
        "Live data synced",
        `Loaded ${match.matchName}.`,
      ),
      match,
      source: "api",
    };
  } catch (error) {
    return {
      log: createLog("error", "Sync failed", getErrorMessage(error)),
      match: fallbackMatch,
      source: "local",
    };
  }
}

export async function loadMatchOptions(client: OdooClient): Promise<MatchOption[]> {
  if (!client.enabled) {
    return [];
  }

  const games = await client.searchRead<OdooRecord>(
    MODELS.game,
    [],
    GAME_FIELDS,
    { limit: 40, order: `${GAME.datetime} desc` },
  );

  return games
    .map((game): MatchOption | undefined => {
      const id = numberValue(game.id);
      if (!id) {
        return undefined;
      }

      return {
        awayName: relationName(game[GAME.awayTeam]) || "Away",
        awayScore: numberValue(game[GAME.awayScore]),
        datetime: stringValue(game[GAME.datetime]),
        homeName: relationName(game[GAME.homeTeam]) || "Home",
        homeScore: numberValue(game[GAME.homeScore]),
        id,
        location: stringValue(game[GAME.location]),
        name:
          stringValue(game[GAME.matchName]) ||
          stringValue(game[GAME.name]) ||
          stringValue(game.display_name) ||
          `Game ${id}`,
        status: stringValue(game[GAME.status]) || "Scheduled",
        week: stringValue(game[GAME.week]),
      } satisfies MatchOption;
    })
    .filter((option): option is MatchOption => Boolean(option));
}

export async function saveMatchAction(
  client: OdooClient,
  input: SaveMatchActionInput,
): Promise<SaveMatchActionResult> {
  if (!client.enabled || !input.match.gameId) {
    return {
      log: createLog("warning", "Action kept locally", "No live connection is configured."),
      saved: false,
    };
  }

  try {
    const capabilities = await getSchemaCapabilities(client);
    await client.write(MODELS.game, [input.match.gameId], {
      [GAME.awayScore]: input.nextAwayScore,
      [GAME.homeScore]: input.nextHomeScore,
      [GAME.status]: "Live",
    });

    const statResult = await savePlayerStat(client, input, capabilities);
    const forcedTurnoverResult = await saveForcedTurnoverStat(client, input, capabilities);
    const eventResult = await saveGameEvent(client, input, capabilities);
    const flowMessage = await saveGameFlowFields(client, input.match, capabilities);

    return {
      eventId: eventResult.eventId,
      log: createLog("success", "Action synced", compactMessages([
        statResult.message,
        forcedTurnoverResult.message,
        eventResult.message,
        flowMessage,
      ])),
      opponentTurnoverStatId: forcedTurnoverResult.statId,
      playerStatId: statResult.statId,
      saved: true,
    };
  } catch (error) {
    return {
      log: createLog("error", "Action sync failed", getErrorMessage(error)),
      saved: false,
    };
  }
}

export async function saveMatchFlowState(
  client: OdooClient,
  match: LiveMatch,
): Promise<SaveMatchActionResult> {
  if (!client.enabled || !match.gameId) {
    return {
      log: createLog("warning", "Timer kept locally", "No live connection is configured."),
      saved: false,
    };
  }

  try {
    const capabilities = await getSchemaCapabilities(client);
    const flowMessage = await saveGameFlowFields(client, match, capabilities);

    return {
      log: createLog("success", "Timer synced", flowMessage || "Game clock saved."),
      saved: true,
    };
  } catch (error) {
    return {
      log: createLog("error", "Timer sync failed", getErrorMessage(error)),
      saved: false,
    };
  }
}

export async function saveMatchStatus(
  client: OdooClient,
  match: LiveMatch,
  status: string,
): Promise<SaveMatchActionResult> {
  if (!client.enabled || !match.gameId) {
    return {
      log: createLog("warning", "Status kept locally", "No live connection is configured."),
      saved: false,
    };
  }

  try {
    const capabilities = await getSchemaCapabilities(client);
    await client.write(MODELS.game, [match.gameId], { [GAME.status]: status });
    const flowMessage = await saveGameFlowFields(client, match, capabilities);

    return {
      log: createLog("success", `Game marked ${status}`, flowMessage || `Status set to ${status}.`),
      saved: true,
    };
  } catch (error) {
    return {
      log: createLog("error", "Status sync failed", getErrorMessage(error)),
      saved: false,
    };
  }
}

export async function saveGameEventLabel(
  client: OdooClient,
  event: GameEvent,
  label: string,
): Promise<SaveMatchActionResult> {
  if (!client.enabled || !event.serverEventId) {
    return {
      log: createLog("warning", "Event edit kept locally", "No synced event record is available."),
      saved: false,
    };
  }

  try {
    const capabilities = await getSchemaCapabilities(client);
    if (!capabilities.gameEvent.exists) {
      return {
        log: createLog("warning", "Event edit kept locally", "Event feed fields are not available."),
        saved: false,
      };
    }

    const values = filterWritableValues({
      [GAME_EVENT.name]: label,
    }, capabilities.gameEvent);

    if (Object.keys(values).length === 0) {
      return {
        log: createLog("warning", "Event edit kept locally", "Event name field is not writable."),
        saved: false,
      };
    }

    await client.write(MODELS.gameEvent, [event.serverEventId], values);

    return {
      log: createLog("success", "Event edit synced", label),
      saved: true,
    };
  } catch (error) {
    return {
      log: createLog("error", "Event edit sync failed", getErrorMessage(error)),
      saved: false,
    };
  }
}

export async function saveMatchCorrection(
  client: OdooClient,
  input: SaveMatchCorrectionInput,
): Promise<SaveMatchActionResult> {
  if (!client.enabled || !input.match.gameId) {
    return {
      log: createLog("warning", "Undo kept locally", "No live connection is configured."),
      saved: false,
    };
  }

  try {
    const capabilities = await getSchemaCapabilities(client);
    const messages = [await saveGameFlowFields(client, input.match, capabilities)];

    const correctionPlayers = uniquePlayers([
      input.player,
      ...(input.players ?? []),
    ]);

    for (const player of correctionPlayers) {
      if (!player.statId) {
        continue;
      }

      const values = filterWritableValues(playerToStatValues(player), capabilities.playerGameStat);
      if (Object.keys(values).length > 0) {
        await client.write(MODELS.playerGameStat, [player.statId], values);
        messages.push("Player stat corrected.");
      }
    }

    if (input.serverEventId && capabilities.gameEvent.exists) {
      await client.unlink(MODELS.gameEvent, [input.serverEventId]);
      messages.push("Event removed.");
    }

    return {
      log: createLog("success", "Undo synced", compactMessages(messages) || input.label),
      saved: true,
    };
  } catch (error) {
    return {
      log: createLog("error", "Undo sync failed", getErrorMessage(error)),
      saved: false,
    };
  }
}

export function createLog(
  level: SyncLogEntry["level"],
  message: string,
  detail?: string,
): SyncLogEntry {
  return {
    detail: detail ? sanitizeDashboardText(detail) : undefined,
    id: Date.now() + Math.round(Math.random() * 1000),
    level,
    message: sanitizeDashboardText(message),
    time: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}

function sanitizeDashboardText(value: string) {
  return value.replace(/odoo/gi, "server");
}

function createPlayer(player: Partial<Player> & Pick<Player, "name" | "number">): Player {
  return {
    assists: 0,
    blocks: 0,
    defensiveRebounds: 0,
    fouls: 0,
    freeThrowsAttempted: 0,
    freeThrowsMade: 0,
    offensiveRebounds: 0,
    ot: 0,
    points: 0,
    q1: 0,
    q2: 0,
    q3: 0,
    q4: 0,
    steals: 0,
    threePointersAttempted: 0,
    threePointersMade: 0,
    turnovers: 0,
    twoPointersAttempted: 0,
    twoPointersMade: 0,
    ...player,
  };
}

async function loadGameRecord(
  client: OdooClient,
  selectedGameId: number | undefined,
  capabilities: SchemaCapabilities,
) {
  const requestedGameId = selectedGameId ?? client.liveGameId;

  if (requestedGameId) {
    const records = await client.read<OdooRecord>(MODELS.game, [requestedGameId], GAME_FIELDS);
    return enrichGameRecord(client, records[0], capabilities);
  }

  const liveGames = await client.searchRead<OdooRecord>(
    MODELS.game,
    [[GAME.status, "=", "Live"]],
    GAME_FIELDS,
    { limit: 1, order: `${GAME.datetime} desc` },
  );

  if (liveGames[0]) {
    return enrichGameRecord(client, liveGames[0], capabilities);
  }

  const upcomingGames = await client.searchRead<OdooRecord>(
    MODELS.game,
    [[GAME.status, "=", "Scheduled"]],
    GAME_FIELDS,
    { limit: 1, order: `${GAME.datetime} asc` },
  );

  return enrichGameRecord(client, upcomingGames[0], capabilities);
}

async function enrichGameRecord(
  client: OdooClient,
  game: OdooRecord | undefined,
  capabilities: SchemaCapabilities,
) {
  const gameId = numberValue(game?.id);
  if (!game || !gameId) {
    return game;
  }

  const optionalFields = filterReadableFields(GAME_OPTIONAL_FIELDS, capabilities.game);
  if (optionalFields.length === 0) {
    return game;
  }

  try {
    const [optional] = await client.read<OdooRecord>(
      MODELS.game,
      [gameId],
      ["id", ...optionalFields],
    );

    return { ...game, ...optional };
  } catch {
    return game;
  }
}

async function loadStatsForGame(
  client: OdooClient,
  gameId: number | undefined,
  capabilities: SchemaCapabilities,
) {
  if (!gameId) {
    return [];
  }

  const optionalFields = filterReadableFields(PLAYER_STAT_OPTIONAL_FIELDS, capabilities.playerGameStat);
  const fields = uniqueStrings([...PLAYER_STAT_FIELDS, ...optionalFields]);

  try {
    return await client.searchRead<OdooRecord>(
      MODELS.playerGameStat,
      [[PLAYER_STAT.game, "=", gameId]],
      fields,
    );
  } catch {
    if (optionalFields.length === 0) {
      return [];
    }

    return client.searchRead<OdooRecord>(
      MODELS.playerGameStat,
      [[PLAYER_STAT.game, "=", gameId]],
      PLAYER_STAT_FIELDS,
    );
  }
}

async function loadGameEvents(
  client: OdooClient,
  gameId?: number,
  awayTeamId?: number,
  homeTeamId?: number,
  capabilities?: SchemaCapabilities,
) {
  if (!gameId || !capabilities?.gameEvent.exists) {
    return [];
  }

  const eventFields = filterReadableFields(GAME_EVENT_FIELDS, capabilities.gameEvent);
  if (eventFields.length === 0) {
    return [];
  }

  try {
    const events = await client.searchRead<OdooRecord>(
      MODELS.gameEvent,
      [[GAME_EVENT.game, "=", gameId]],
      eventFields,
      { limit: 300, order: "create_date desc" },
    );

    return events
      .map((event) => normalizeGameEvent(event, awayTeamId, homeTeamId))
      .filter((event): event is GameEvent => Boolean(event));
  } catch {
    return [];
  }
}

async function normalizeGameRecord(
  client: OdooClient,
  game: OdooRecord,
  capabilities: SchemaCapabilities,
): Promise<LiveMatch> {
  const gameId = numberValue(game.id);
  const awayTeamId = relationId(game[GAME.awayTeam]);
  const homeTeamId = relationId(game[GAME.homeTeam]);
  const teamIds = [awayTeamId, homeTeamId].filter((id): id is number => Boolean(id));
  const [teams, players, stats, events] = await Promise.all([
    teamIds.length > 0 ? client.read<OdooRecord>(MODELS.team, teamIds, TEAM_FIELDS) : [],
    teamIds.length > 0
      ? client.searchRead<OdooRecord>(
          MODELS.player,
          [[PLAYER.team, "in", teamIds]],
          PLAYER_FIELDS,
          { order: `${PLAYER.jerseyNumber} asc` },
        )
      : [],
    loadStatsForGame(client, gameId, capabilities),
    loadGameEvents(client, gameId, awayTeamId, homeTeamId, capabilities),
  ]);

  const teamsById = new Map(teams.map((team) => [numberValue(team.id), team]));
  const statsByPlayerId = new Map(
    stats
      .map((stat) => [relationId(stat[PLAYER_STAT.player]), stat] as const)
      .filter(([playerId]) => Boolean(playerId)),
  );

  const away = normalizeTeam({
    fallback: fallbackMatch.away,
    fouls: optionalNumberValue(game[GAME.awayTeamFouls]),
    label: "Away",
    relationName: relationName(game[GAME.awayTeam]),
    side: "away",
    team: awayTeamId ? teamsById.get(awayTeamId) : undefined,
    teamId: awayTeamId,
    timeouts: numberValue(game[GAME.awayTimeouts]),
  }, players, statsByPlayerId);

  const home = normalizeTeam({
    fallback: fallbackMatch.home,
    fouls: optionalNumberValue(game[GAME.homeTeamFouls]),
    label: "Home",
    relationName: relationName(game[GAME.homeTeam]),
    side: "home",
    team: homeTeamId ? teamsById.get(homeTeamId) : undefined,
    teamId: homeTeamId,
    timeouts: numberValue(game[GAME.homeTimeouts]),
  }, players, statsByPlayerId);

  const period = normalizePeriod(game[GAME.period], fallbackMatch.period);
  const clockSeconds = numberValue(game[GAME.gameClockSeconds], clockToSeconds(fallbackMatch.clock));
  const possessionTeamId = relationId(game[GAME.possessionTeam]);
  const possession =
    possessionTeamId && possessionTeamId === awayTeamId
      ? "away"
      : possessionTeamId && possessionTeamId === homeTeamId
        ? "home"
        : fallbackMatch.possession;

  return {
    away,
    awayScore: numberValue(game[GAME.awayScore]),
    clock: secondsToClock(clockSeconds),
    events,
    gameId,
    home,
    homeScore: numberValue(game[GAME.homeScore]),
    matchName:
      stringValue(game[GAME.matchName]) ||
      stringValue(game[GAME.name]) ||
      stringValue(game.display_name) ||
      fallbackMatch.matchName,
    period,
    periodLabel: getPeriodLabel(period),
    possession,
    shotClock: numberValue(game[GAME.shotClockSeconds], fallbackMatch.shotClock),
    status: stringValue(game[GAME.status]) || "Scheduled",
    syncMessage: "Live data connected",
    syncedAt: new Date().toISOString(),
  };
}

function normalizeTeam(
  side: TeamSide,
  players: OdooRecord[],
  statsByPlayerId: Map<number | undefined, OdooRecord>,
): Team {
  if (!side.teamId) {
    return side.fallback;
  }

  const sidePlayers = players
    .filter((player) => relationId(player[PLAYER.team]) === side.teamId)
    .map((player, index) => normalizePlayer(player, statsByPlayerId, index));

  const roster = sidePlayers.length > 0 ? sidePlayers : side.fallback.players;
  const bench = sidePlayers.length > 0 ? sidePlayers.slice(5) : side.fallback.bench;
  const activePlayers = roster.slice(0, 5).map((player) => ({ ...player, active: true }));
  const playerFouls = [...activePlayers, ...bench].reduce((total, player) => total + player.fouls, 0);
  const wins = numberValue(side.team?.[TEAM.wins]);
  const losses = numberValue(side.team?.[TEAM.losses]);

  return {
    bench,
    category: stringValue(side.team?.[TEAM.category]),
    fouls: side.fouls ?? playerFouls,
    id: side.teamId,
    label: side.label,
    name:
      stringValue(side.team?.[TEAM.name]) ||
      stringValue(side.team?.display_name) ||
      side.relationName ||
      side.fallback.name,
    players: activePlayers,
    record: wins || losses ? `${wins}-${losses}` : side.fallback.record,
    timeouts: side.timeouts ?? side.fallback.timeouts,
  };
}

function normalizePlayer(
  player: OdooRecord,
  statsByPlayerId: Map<number | undefined, OdooRecord>,
  index: number,
): Player {
  const playerId = numberValue(player.id);
  const stat = statsByPlayerId.get(playerId);
  const q1 = numberValue(stat?.[PLAYER_STAT.q1]);
  const q2 = numberValue(stat?.[PLAYER_STAT.q2]);
  const q3 = numberValue(stat?.[PLAYER_STAT.q3]);
  const q4 = numberValue(stat?.[PLAYER_STAT.q4]);
  const ot = numberValue(stat?.[PLAYER_STAT.overtime]);
  const statTotal = numberValue(stat?.[PLAYER_STAT.totalPoints]);
  const playerTotal = numberValue(player[PLAYER.totalPoints]);

  return createPlayer({
    active: index < 5,
    assists: numberValue(stat?.[PLAYER_STAT.assists]),
    blocks: numberValue(stat?.[PLAYER_STAT.blocks]),
    defensiveRebounds: numberValue(stat?.[PLAYER_STAT.defensiveRebounds]),
    fouls: numberValue(stat?.[PLAYER_STAT.fouls]),
    freeThrowsAttempted: numberValue(stat?.[PLAYER_STAT.freeThrowsAttempted]),
    freeThrowsMade: numberValue(stat?.[PLAYER_STAT.freeThrowsMade]),
    id: playerId,
    name: stringValue(player[PLAYER.name]) || stringValue(player.display_name) || "Player",
    number: String(numberValue(player[PLAYER.jerseyNumber], 0)).padStart(1, "0"),
    offensiveRebounds: numberValue(stat?.[PLAYER_STAT.offensiveRebounds]),
    ot,
    points: statTotal || q1 + q2 + q3 + q4 + ot || playerTotal,
    position: stringValue(player[PLAYER.position]),
    q1,
    q2,
    q3,
    q4,
    statId: numberValue(stat?.id),
    steals: numberValue(stat?.[PLAYER_STAT.steals]),
    threePointersAttempted: numberValue(stat?.[PLAYER_STAT.threePointersAttempted]),
    threePointersMade: numberValue(stat?.[PLAYER_STAT.threePointersMade]),
    turnovers: numberValue(stat?.[PLAYER_STAT.turnovers]),
    twoPointersAttempted: numberValue(stat?.[PLAYER_STAT.twoPointersAttempted]),
    twoPointersMade: numberValue(stat?.[PLAYER_STAT.twoPointersMade]),
  });
}

async function savePlayerStat(
  client: OdooClient,
  input: SaveMatchActionInput,
  capabilities: SchemaCapabilities,
): Promise<PlayerStatSaveResult> {
  const fullValues: Record<string, unknown> = {};
  const coreValues: Record<string, unknown> = {};
  const pointValue = input.points;
  const foulValue = input.action === "personal foul" || input.action === "tech foul" ? 1 : 0;

  if (!input.player.id) {
    return { message: "Score saved. Player stat was skipped because the player has no record id." };
  }

  if (pointValue > 0) {
    const periodField = getPeriodField(input.match.period);
    const periodPoints = input.player[periodFieldToPlayerKey(periodField)] + pointValue;
    coreValues[periodField] = periodPoints;
    coreValues[PLAYER_STAT.totalPoints] = input.player.points + pointValue;
  }

  if (foulValue > 0) {
    coreValues[PLAYER_STAT.fouls] = input.player.fouls + foulValue;
  }

  Object.assign(fullValues, coreValues);

  if (input.shotType === "2pt") {
    fullValues[PLAYER_STAT.twoPointersAttempted] = input.player.twoPointersAttempted + 1;
    if (input.shotMade) {
      fullValues[PLAYER_STAT.twoPointersMade] = input.player.twoPointersMade + 1;
    }
  }

  if (input.shotType === "3pt") {
    fullValues[PLAYER_STAT.threePointersAttempted] = input.player.threePointersAttempted + 1;
    if (input.shotMade) {
      fullValues[PLAYER_STAT.threePointersMade] = input.player.threePointersMade + 1;
    }
  }

  if (input.freeThrowsAttempted && input.freeThrowsAttempted > 0) {
    fullValues[PLAYER_STAT.freeThrowsAttempted] =
      input.player.freeThrowsAttempted + input.freeThrowsAttempted;
    fullValues[PLAYER_STAT.freeThrowsMade] =
      input.player.freeThrowsMade + (input.freeThrowsMade ?? 0);
  }

  if (input.action === "assist") {
    fullValues[PLAYER_STAT.assists] = input.player.assists + 1;
  }
  if (input.action === "block") {
    fullValues[PLAYER_STAT.blocks] = input.player.blocks + 1;
  }
  if (input.action === "defensive rebound") {
    fullValues[PLAYER_STAT.defensiveRebounds] = input.player.defensiveRebounds + 1;
  }
  if (input.action === "offensive rebound") {
    fullValues[PLAYER_STAT.offensiveRebounds] = input.player.offensiveRebounds + 1;
  }
  if (input.action === "steal") {
    fullValues[PLAYER_STAT.steals] = input.player.steals + 1;
  }
  if (input.action === "turnover") {
    fullValues[PLAYER_STAT.turnovers] = input.player.turnovers + 1;
  }

  if (Object.keys(fullValues).length === 0) {
    return {
      message: "Score saved. No player stat changed for this action.",
      statId: input.player.statId,
    };
  }

  const supportedFullValues = filterWritableValues(fullValues, capabilities.playerGameStat);
  const supportedCoreValues = filterWritableValues(coreValues, capabilities.playerGameStat);

  if (Object.keys(supportedFullValues).length === 0) {
    return { message: "Detail stat kept locally. Run the field script to persist this action type." };
  }

  try {
    const statId = await upsertPlayerStat(client, input, supportedFullValues);
    return {
      message: fieldsAreSame(supportedFullValues, fullValues)
        ? "Score and player detail saved."
        : "Core score saved. Run the field script to persist detail stats.",
      statId,
    };
  } catch (error) {
    if (Object.keys(supportedCoreValues).length === 0) {
      return { message: "Detail stat kept locally. Run the field script to persist this action type." };
    }

    if (fieldsAreSame(supportedFullValues, supportedCoreValues)) {
      throw error;
    }

    const statId = await upsertPlayerStat(client, input, supportedCoreValues);
    return {
      message: "Core score saved. Run the field script to persist detail stats.",
      statId,
    };
  }
}

async function upsertPlayerStat(
  client: OdooClient,
  input: SaveMatchActionInput,
  values: Record<string, unknown>,
) {
  return upsertPlayerStatForMatch(client, input.match, input.player, values);
}

async function saveForcedTurnoverStat(
  client: OdooClient,
  input: SaveMatchActionInput,
  capabilities: SchemaCapabilities,
): Promise<PlayerStatSaveResult> {
  const player = input.opponentTurnoverPlayer;
  if (!player) {
    return { message: "" };
  }

  if (!player.id) {
    return { message: "Forced turnover kept locally because the player has no record id." };
  }

  const values = filterWritableValues({
    [PLAYER_STAT.turnovers]: player.turnovers + 1,
  }, capabilities.playerGameStat);

  if (Object.keys(values).length === 0) {
    return { message: "Forced turnover kept locally." };
  }

  const statId = await upsertPlayerStatForMatch(client, input.match, player, values);
  return {
    message: "Forced turnover saved.",
    statId,
  };
}

async function upsertPlayerStatForMatch(
  client: OdooClient,
  match: LiveMatch,
  player: Player,
  values: Record<string, unknown>,
) {
  if (player.statId) {
    await client.write(MODELS.playerGameStat, [player.statId], values);
    return player.statId;
  }

  if (!match.gameId || !player.id) {
    return undefined;
  }

  const queueKey = `${match.gameId}:${player.id}`;
  const queues = getStatUpsertQueues(client);
  const previous = queues.get(queueKey) ?? Promise.resolve(undefined);
  const next = previous
    .catch(() => undefined)
    .then(() => upsertPlayerStatForMatchNow(client, match, player, values));

  queues.set(queueKey, next);

  try {
    return await next;
  } finally {
    if (queues.get(queueKey) === next) {
      queues.delete(queueKey);
    }
  }
}

async function upsertPlayerStatForMatchNow(
  client: OdooClient,
  match: LiveMatch,
  player: Player,
  values: Record<string, unknown>,
) {
  const [existingStat] = await client.searchRead<OdooRecord>(
    MODELS.playerGameStat,
    [
      [PLAYER_STAT.game, "=", match.gameId],
      [PLAYER_STAT.player, "=", player.id],
    ],
    ["id"],
    { limit: 1, order: "id desc" },
  );
  const existingStatId = numberValue(existingStat?.id);

  if (existingStatId) {
    await client.write(MODELS.playerGameStat, [existingStatId], values);
    return existingStatId;
  }

  return client.create(MODELS.playerGameStat, {
    ...values,
    [PLAYER_STAT.game]: match.gameId,
    [PLAYER_STAT.name]: `${match.matchName} - ${player.name}`,
    [PLAYER_STAT.player]: player.id,
  });
}

function getStatUpsertQueues(client: OdooClient) {
  let queues = statUpsertQueues.get(client);

  if (!queues) {
    queues = new Map<string, Promise<number | undefined>>();
    statUpsertQueues.set(client, queues);
  }

  return queues;
}

async function saveGameEvent(
  client: OdooClient,
  input: SaveMatchActionInput,
  capabilities: SchemaCapabilities,
) {
  if (!capabilities.gameEvent.exists) {
    return { message: "Event kept locally." };
  }

  try {
    const scoreAfter = `${input.nextAwayScore}-${input.nextHomeScore}`;
    const values = filterWritableValues({
      [GAME_EVENT.active]: true,
      [GAME_EVENT.actionType]: input.action,
      [GAME_EVENT.clockSeconds]: clockToSeconds(input.match.clock),
      [GAME_EVENT.game]: input.match.gameId,
      [GAME_EVENT.name]: `${input.match.clock} ${input.player.number} ${input.player.name} ${input.label}`,
      [GAME_EVENT.note]: input.foulOnShot ? "Shooting foul/free throws included" : "",
      [GAME_EVENT.period]: input.match.period,
      [GAME_EVENT.player]: input.player.id ?? false,
      [GAME_EVENT.points]: input.points,
      [GAME_EVENT.scoreAfter]: scoreAfter,
      [GAME_EVENT.shotValue]: input.shotValue ?? 0,
      [GAME_EVENT.shotX]: input.shotLocation?.x ?? 0,
      [GAME_EVENT.shotY]: input.shotLocation?.y ?? 0,
      [GAME_EVENT.shotZone]: input.shotLocation?.zone ?? input.shotType ?? "",
      [GAME_EVENT.team]: input.match[input.selectedTeam].id ?? false,
    }, capabilities.gameEvent);

    if (!values[GAME_EVENT.name]) {
      return { message: "Event kept locally." };
    }

    const eventId = await client.create(MODELS.gameEvent, values);

    return { eventId, message: "Event feed saved." };
  } catch {
    return { message: "Event kept locally. Run the field script to persist the event feed." };
  }
}

async function saveGameFlowFields(
  client: OdooClient,
  match: LiveMatch,
  capabilities: SchemaCapabilities,
) {
  const values = filterWritableValues({
    [GAME.awayScore]: match.awayScore,
    [GAME.awayTimeouts]: match.away.timeouts,
    [GAME.gameClockSeconds]: clockToSeconds(match.clock),
    [GAME.awayTeamFouls]: match.away.fouls,
    [GAME.homeScore]: match.homeScore,
    [GAME.homeTimeouts]: match.home.timeouts,
    [GAME.homeTeamFouls]: match.home.fouls,
    [GAME.period]: match.period,
    [GAME.possessionTeam]: match[match.possession].id,
    [GAME.shotClockSeconds]: match.shotClock,
  }, capabilities.game);

  if (Object.keys(values).length === 0) {
    return "";
  }

  try {
    await client.write(MODELS.game, [match.gameId!], values);

    return "Game flow saved.";
  } catch {
    return "";
  }
}

function playerToStatValues(player: Player) {
  return {
    [PLAYER_STAT.assists]: player.assists,
    [PLAYER_STAT.blocks]: player.blocks,
    [PLAYER_STAT.defensiveRebounds]: player.defensiveRebounds,
    [PLAYER_STAT.fouls]: player.fouls,
    [PLAYER_STAT.freeThrowsAttempted]: player.freeThrowsAttempted,
    [PLAYER_STAT.freeThrowsMade]: player.freeThrowsMade,
    [PLAYER_STAT.offensiveRebounds]: player.offensiveRebounds,
    [PLAYER_STAT.overtime]: player.ot,
    [PLAYER_STAT.q1]: player.q1,
    [PLAYER_STAT.q2]: player.q2,
    [PLAYER_STAT.q3]: player.q3,
    [PLAYER_STAT.q4]: player.q4,
    [PLAYER_STAT.steals]: player.steals,
    [PLAYER_STAT.threePointersAttempted]: player.threePointersAttempted,
    [PLAYER_STAT.threePointersMade]: player.threePointersMade,
    [PLAYER_STAT.totalPoints]: player.points,
    [PLAYER_STAT.turnovers]: player.turnovers,
    [PLAYER_STAT.twoPointersAttempted]: player.twoPointersAttempted,
    [PLAYER_STAT.twoPointersMade]: player.twoPointersMade,
  };
}

function getSchemaCapabilities(client: OdooClient) {
  let cached = capabilityCache.get(client);
  if (!cached) {
    cached = discoverSchemaCapabilities(client);
    capabilityCache.set(client, cached);
  }

  return cached;
}

async function discoverSchemaCapabilities(client: OdooClient): Promise<SchemaCapabilities> {
  const fallback = createFallbackCapabilities();

  try {
    const modelNames = [MODELS.game, MODELS.playerGameStat, MODELS.gameEvent];
    const fieldNames = uniqueStrings([
      ...GAME_FIELDS,
      ...GAME_OPTIONAL_FIELDS,
      ...PLAYER_STAT_FIELDS,
      ...PLAYER_STAT_OPTIONAL_FIELDS,
      ...GAME_EVENT_FIELDS,
    ]);

    const [models, fields] = await Promise.all([
      client.searchRead<OdooRecord>(
        "ir.model",
        [["model", "in", modelNames]],
        ["model"],
        { limit: modelNames.length },
      ),
      client.searchRead<OdooRecord>(
        "ir.model.fields",
        [
          ["model", "in", modelNames],
          ["name", "in", fieldNames],
        ],
        ["model", "name"],
        { limit: fieldNames.length * modelNames.length },
      ),
    ]);

    const existingModels = new Set(models.map((model) => stringValue(model.model)));
    const fieldsByModel = fields.reduce((byModel, field) => {
      const model = stringValue(field.model);
      const name = stringValue(field.name);
      if (model && name) {
        byModel.get(model)?.add(name);
      }
      return byModel;
    }, new Map<string, Set<string>>(modelNames.map((model) => [model, new Set<string>()])));

    const discoveredGameEventFields = fieldsByModel.get(MODELS.gameEvent);

    return {
      game: {
        exists: existingModels.has(MODELS.game),
        fields: mergeKnownCoreFields(fieldsByModel.get(MODELS.game), GAME_FIELDS),
      },
      gameEvent: {
        exists: existingModels.has(MODELS.gameEvent),
        fields: discoveredGameEventFields?.size
          ? discoveredGameEventFields
          : new Set(GAME_EVENT_FIELDS),
      },
      playerGameStat: {
        exists: existingModels.has(MODELS.playerGameStat),
        fields: mergeKnownCoreFields(fieldsByModel.get(MODELS.playerGameStat), PLAYER_STAT_FIELDS),
      },
    };
  } catch {
    return fallback;
  }
}

function createFallbackCapabilities(): SchemaCapabilities {
  return {
    game: {
      exists: true,
      fields: new Set(GAME_FIELDS),
    },
    gameEvent: {
      exists: true,
      fields: new Set(GAME_EVENT_FIELDS),
    },
    playerGameStat: {
      exists: true,
      fields: new Set(PLAYER_STAT_FIELDS),
    },
  };
}

function mergeKnownCoreFields(
  discoveredFields: Set<string> | undefined,
  coreFields: readonly string[],
) {
  return new Set([...(discoveredFields ?? []), ...coreFields]);
}

function filterReadableFields(fields: readonly string[], capability: ModelCapability) {
  return fields.filter((field) => capability.fields.has(field));
}

function filterWritableValues(
  values: Record<string, unknown>,
  capability: ModelCapability,
) {
  return Object.fromEntries(
    Object.entries(values).filter(([field]) => capability.fields.has(field)),
  );
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values)];
}

function uniquePlayers(players: Array<Player | undefined>) {
  const seen = new Set<string>();
  return players.filter((player): player is Player => {
    if (!player) {
      return false;
    }

    const key = player.statId
      ? `stat:${player.statId}`
      : player.id
        ? `player:${player.id}`
        : `local:${player.number}:${player.name}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizeGameEvent(
  record: OdooRecord,
  awayTeamId?: number,
  homeTeamId?: number,
): GameEvent | undefined {
  const id = numberValue(record.id);
  if (!id) {
    return undefined;
  }

  const action = normalizeActionKey(record[GAME_EVENT.actionType]);
  const points = numberValue(record[GAME_EVENT.points]);
  const teamId = relationId(record[GAME_EVENT.team]);
  const team: TeamId = teamId === awayTeamId ? "away" : teamId === homeTeamId ? "home" : "home";
  const shotValue = numberValue(record[GAME_EVENT.shotValue]);
  const shotType =
    shotValue === 3 ? "3pt" : shotValue === 2 ? "2pt" : shotValue === 1 ? "free throw" : undefined;
  const x = numberValue(record[GAME_EVENT.shotX]);
  const y = numberValue(record[GAME_EVENT.shotY]);
  const zone = stringValue(record[GAME_EVENT.shotZone]);

  return {
    action,
    icon: getEventIcon(action, points),
    id,
    label: stringValue(record[GAME_EVENT.name]) || titleCase(action),
    period: numberValue(record[GAME_EVENT.period]),
    player: relationName(record[GAME_EVENT.player]) || "Player",
    playerId: relationId(record[GAME_EVENT.player]),
    points,
    score: stringValue(record[GAME_EVENT.scoreAfter]),
    serverEventId: id,
    shotLocation:
      x || y || zone
        ? {
            side: x <= 380 ? "left" : "right",
            value: shotValue === 3 ? 3 : 2,
            x,
            y,
            zone,
          }
        : undefined,
    shotType,
    team,
    time: secondsToClock(numberValue(record[GAME_EVENT.clockSeconds])),
  };
}

function getPeriodField(period: LiveMatch["period"]) {
  if (period === 1) {
    return PLAYER_STAT.q1;
  }
  if (period === 2) {
    return PLAYER_STAT.q2;
  }
  if (period === 3) {
    return PLAYER_STAT.q3;
  }
  if (period === 4) {
    return PLAYER_STAT.q4;
  }
  return PLAYER_STAT.overtime;
}

function periodFieldToPlayerKey(field: string): "q1" | "q2" | "q3" | "q4" | "ot" {
  if (field === PLAYER_STAT.q1) {
    return "q1";
  }
  if (field === PLAYER_STAT.q2) {
    return "q2";
  }
  if (field === PLAYER_STAT.q3) {
    return "q3";
  }
  if (field === PLAYER_STAT.q4) {
    return "q4";
  }
  return "ot";
}

function normalizeActionKey(value: unknown): ActionKey {
  const action = stringValue(value) as ActionKey;
  const validActions: ActionKey[] = [
    "made 2pt",
    "missed 2pt",
    "made 3pt",
    "missed 3pt",
    "free throw made",
    "free throw missed",
    "made",
    "missed",
    "offensive rebound",
    "defensive rebound",
    "assist",
    "turnover",
    "steal",
    "block",
    "personal foul",
    "tech foul",
    "substitution",
  ];

  return validActions.includes(action) ? action : "made";
}

function getEventIcon(action: ActionKey, points = 0): GameEvent["icon"] {
  if (action.includes("missed")) {
    return "missed";
  }
  if (points > 0 || action.includes("made")) {
    return "made";
  }
  if (action === "turnover") {
    return "turnover";
  }
  return "rebound";
}

function compactMessages(messages: string[]) {
  return messages.filter(Boolean).join(" ");
}

function fieldsAreSame(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
) {
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  if (firstKeys.length !== secondKeys.length) {
    return false;
  }

  return firstKeys.every((key) => first[key] === second[key]);
}

function normalizePeriod(value: unknown, fallback: LiveMatch["period"]): LiveMatch["period"] {
  const period = numberValue(value, fallback);
  return period >= 1 && period <= 12 ? period : fallback;
}

export function getPeriodLabel(period: LiveMatch["period"], periodCount = 4) {
  if (period > periodCount) {
    const overtimeNumber = period - periodCount;
    return overtimeNumber === 1 ? "Overtime" : `Overtime ${overtimeNumber}`;
  }
  if (period === 1) {
    return "1st Quarter";
  }
  if (period === 2) {
    return "2nd Quarter";
  }
  if (period === 3) {
    return "3rd Quarter";
  }
  if (period === 4) {
    return "4th Quarter";
  }
  return `Period ${period}`;
}

function clockToSeconds(clock: string) {
  const [minutes = "0", seconds = "0"] = clock.split(":");
  const parsedMinutes = Number(minutes);
  const parsedSeconds = Number(seconds);

  if (!Number.isFinite(parsedMinutes) || !Number.isFinite(parsedSeconds)) {
    return 0;
  }

  return Math.max(0, Math.round(parsedMinutes * 60 + parsedSeconds));
}

function secondsToClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function titleCase(value: string) {
  return value
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function relationId(value: unknown) {
  if (Array.isArray(value) && typeof value[0] === "number") {
    return value[0];
  }
  if (typeof value === "number") {
    return value;
  }
  return undefined;
}

function relationName(value: unknown) {
  if (Array.isArray(value) && typeof value[1] === "string") {
    return value[1];
  }
  return undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNumberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown API error";
}
