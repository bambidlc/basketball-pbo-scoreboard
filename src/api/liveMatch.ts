import {
  ATTENDANCE,
  ATTENDANCE_FIELDS,
  CLUB,
  CLUB_FIELDS,
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
  TEAM_STAFF,
  TEAM_STAFF_FIELDS,
} from "./schema";
import { OdooClient, type OdooRecord } from "./odooClient";
import { resolveClubColor } from "./colorPalette";

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
  | "admin tech"
  | "warning"
  | "substitution"
  | "suspension";

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
  attendanceId?: number;
  blocks: number;
  defensiveRebounds: number;
  fouls: number;
  techFouls: number;
  freeThrowsAttempted: number;
  freeThrowsMade: number;
  id?: number;
  // Stable device identity for players entered at game time. It survives the transition
  // from an offline-only player to a real Odoo player id, keeping selections/outbox ops valid.
  localId?: string;
  name: string;
  number: string;
  offensiveRebounds: number;
  points: number;
  position?: string;
  present?: boolean;
  starter?: boolean;
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
  accentColor?: string;
  bench: Player[];
  category?: string;
  // Team identity colors sourced from the team's club (x_club). `color` is the shirt
  // color used as the team accent; `textColor` is the club's letter color for text that
  // sits on top of `color`. Both are undefined when the club has no color set.
  color?: string;
  coach?: string;
  fouls: number;
  id?: number;
  label: "Visitor" | "Home";
  name: string;
  players: Player[];
  presentCount: number;
  record?: string;
  textColor?: string;
  timeouts: number;
};

export type GameEvent = {
  action?: ActionKey;
  equalization?: boolean;
  foulBall?: boolean;
  icon: "made" | "missed" | "turnover" | "rebound";
  id: number;
  issuedByRef?: boolean;
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
  equalizationApplied?: boolean;
  equalizationPoints?: number;
  equalizationTeam?: TeamId;
  events: GameEvent[];
  gameId?: number;
  home: Team;
  homeScore: number;
  matchName: string;
  period: number;
  periodLabel: string;
  possession: TeamId;
  referee?: string;
  refereeAssistant?: string;
  referee3?: string;
  scorekeeper?: string;
  scorekeeper2?: string;
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
  awayTeamId?: number;
  datetime?: string;
  homeName: string;
  homeScore: number;
  homeTeamId?: number;
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
  issuedByRef?: boolean;
  label: string;
  match: LiveMatch;
  nextAwayScore: number;
  nextHomeScore: number;
  note?: string;
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
  match?: LiveMatch;
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
  accentColor?: string;
  color?: string;
  coach?: string;
  fallback: Team;
  fouls?: number;
  label: "Visitor" | "Home";
  relationName?: string;
  side: TeamId;
  team?: OdooRecord;
  teamId?: number;
  textColor?: string;
  timeouts?: number;
};

type ModelCapability = {
  exists: boolean;
  fields: Set<string>;
};

type SchemaCapabilities = {
  game: ModelCapability;
  gameAttendance: ModelCapability;
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
    label: "Visitor",
    name: "Visitor",
    players: [],
    presentCount: 0,
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
    presentCount: 0,
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
        awayName: relationName(game[GAME.awayTeam]) || "Visitor",
        awayScore: numberValue(game[GAME.awayScore]),
        awayTeamId: relationId(game[GAME.awayTeam]),
        datetime: stringValue(game[GAME.datetime]),
        homeName: relationName(game[GAME.homeTeam]) || "Home",
        homeScore: numberValue(game[GAME.homeScore]),
        homeTeamId: relationId(game[GAME.homeTeam]),
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
  note?: string,
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

    // A note (e.g. the suspension reason) is persisted as a game event so it survives a
    // reload and is visible in the play-by-play when the game is resumed.
    let eventId: number | undefined;
    let noteMessage = "";
    const trimmedNote = note?.trim();
    if (trimmedNote && capabilities.gameEvent.exists) {
      const eventValues = filterWritableValues(
        {
          [GAME_EVENT.active]: true,
          [GAME_EVENT.actionType]: "suspension",
          [GAME_EVENT.clockSeconds]: clockToSeconds(match.clock),
          [GAME_EVENT.game]: match.gameId,
          [GAME_EVENT.name]: `${match.clock} ${status} · ${trimmedNote}`,
          [GAME_EVENT.note]: trimmedNote,
          [GAME_EVENT.period]: match.period,
          [GAME_EVENT.points]: 0,
        },
        capabilities.gameEvent,
      );

      if (eventValues[GAME_EVENT.name]) {
        eventId = await client.create(MODELS.gameEvent, eventValues);
        noteMessage = "Reason saved.";
      }
    }

    return {
      eventId,
      log: createLog(
        "success",
        `Game marked ${status}`,
        compactMessages([flowMessage, noteMessage]) || `Status set to ${status}.`,
      ),
      saved: true,
    };
  } catch (error) {
    return {
      log: createLog("error", "Status sync failed", getErrorMessage(error)),
      saved: false,
    };
  }
}

export async function saveGameAttendance(
  client: OdooClient,
  match: LiveMatch,
): Promise<SaveMatchActionResult> {
  if (!client.enabled || !match.gameId) {
    return {
      log: createLog("warning", "Roster kept locally", "No live connection is configured."),
      saved: false,
    };
  }

  try {
    const capabilities = await getSchemaCapabilities(client);
    if (!capabilities.gameAttendance.exists) {
      return {
        log: createLog(
          "warning",
          "Roster kept locally",
          "Run the field script to add the attendance model.",
        ),
        saved: false,
      };
    }

    let saved = 0;
    for (const side of ["away", "home"] as TeamId[]) {
      const team = match[side];
      const starterIds = new Set(team.players.map((player) => player.id));
      for (const player of [...team.players, ...team.bench]) {
        if (!player.id) {
          continue;
        }

        const values = filterWritableValues(
          {
            [ATTENDANCE.present]: player.present ?? true,
            // Source of truth for "is a starter" is membership in team.players, not the
            // load-time player.starter hint (which goes stale after substitutions).
            [ATTENDANCE.starter]: starterIds.has(player.id),
            [ATTENDANCE.jersey]: Number(player.number) || 0,
            [ATTENDANCE.team]: team.id ?? false,
          },
          capabilities.gameAttendance,
        );

        if (Object.keys(values).length === 0) {
          continue;
        }

        await upsertAttendanceRow(client, match, player, values);
        saved += 1;
      }
    }

    const setupMessage = await saveGameSetupFields(client, match, capabilities);

    return {
      log: createLog(
        "success",
        "Roster synced",
        compactMessages([`Saved ${saved} attendance rows.`, setupMessage]),
      ),
      saved: true,
    };
  } catch (error) {
    return {
      log: createLog("error", "Roster sync failed", getErrorMessage(error)),
      saved: false,
    };
  }
}

/**
 * Syncs the editable game-day roster before attendance/stat writes. New offline players
 * are matched by team + jersey before creation, making retries safe after a dropped
 * response. The returned match contains the real ids and is used to repair queued stats.
 */
export async function saveGameDayRoster(
  client: OdooClient,
  match: LiveMatch,
): Promise<SaveMatchActionResult> {
  if (!client.enabled || !match.gameId) {
    return {
      log: createLog("warning", "Roster kept offline", "It will sync when a live connection is available."),
      match,
      saved: false,
    };
  }

  try {
    let resolvedMatch = match;
    if (!match.away.id || !match.home.id) {
      const [game] = await client.read<OdooRecord>(
        MODELS.game,
        [match.gameId],
        ["id", GAME.awayTeam, GAME.homeTeam],
      );
      resolvedMatch = {
        ...match,
        away: { ...match.away, id: match.away.id ?? relationId(game?.[GAME.awayTeam]) },
        home: { ...match.home, id: match.home.id ?? relationId(game?.[GAME.homeTeam]) },
      };
    }
    if (!resolvedMatch.away.id || !resolvedMatch.home.id) {
      throw new Error("The scheduled game's team links are not available yet.");
    }
    let syncedPlayers = 0;
    let syncedCoaches = 0;

    for (const side of ["away", "home"] as TeamId[]) {
      const team = resolvedMatch[side];
      if (!team.id) {
        continue;
      }

      const originalStarters = new Set(team.players.map(getSyncPlayerKey));
      const resolvedRoster: Player[] = [];
      for (const player of [...team.players, ...team.bench]) {
        const number = player.number.trim();
        const name = player.name.trim();
        if (!number || !name) {
          continue;
        }

        const jersey = Number(number);
        if (!Number.isInteger(jersey) || jersey < 0 || jersey > 999) {
          continue;
        }

        const values = {
          [PLAYER.active]: true,
          [PLAYER.jerseyNumber]: jersey,
          [PLAYER.name]: name,
          [PLAYER.team]: team.id,
        };
        let playerId = player.id && player.id > 0 ? player.id : undefined;

        if (!playerId) {
          const existing = await client.searchRead<OdooRecord>(
            MODELS.player,
            [
              [PLAYER.team, "=", team.id],
              [PLAYER.jerseyNumber, "=", jersey],
            ],
            ["id"],
            { limit: 1 },
          );
          playerId = numberValue(existing[0]?.id) || undefined;
        }

        if (playerId) {
          await client.write(MODELS.player, [playerId], values);
        } else {
          playerId = await client.create(MODELS.player, values);
        }

        if (!playerId) {
          throw new Error(`Could not sync #${number} ${name}.`);
        }

        resolvedRoster.push({ ...player, id: playerId, name, number });
        syncedPlayers += 1;
      }

      const starters = resolvedRoster
        .filter((player) => originalStarters.has(getSyncPlayerKey(player)))
        .slice(0, 5)
        .map((player) => ({ ...player, active: true }));
      const starterKeys = new Set(starters.map(getSyncPlayerKey));
      const bench = resolvedRoster
        .filter((player) => !starterKeys.has(getSyncPlayerKey(player)))
        .map((player) => ({ ...player, active: false }));
      const presentCount = resolvedRoster.filter((player) => player.present ?? true).length;
      const resolvedTeam = { ...team, bench, players: starters, presentCount };

      if (team.coach?.trim()) {
        const coachSaved = await upsertTeamCoach(client, team.id, team.coach.trim());
        syncedCoaches += coachSaved ? 1 : 0;
      }

      resolvedMatch = { ...resolvedMatch, [side]: resolvedTeam };
    }

    const attendanceResult = await saveGameAttendance(client, resolvedMatch);
    const detail = compactMessages([
      `${syncedPlayers} players and ${syncedCoaches} coach names synced.`,
      attendanceResult.saved
        ? attendanceResult.log.detail ?? "Attendance synced."
        : "Attendance remains safely stored on this device.",
    ]);

    return {
      log: createLog(
        attendanceResult.saved ? "success" : "warning",
        attendanceResult.saved ? "Game-day roster synced" : "Roster players synced",
        detail,
      ),
      match: resolvedMatch,
      saved: true,
    };
  } catch (error) {
    return {
      log: createLog("error", "Roster sync failed", getErrorMessage(error)),
      match,
      saved: false,
    };
  }
}

function getSyncPlayerKey(player: Player) {
  return player.localId ?? (player.id ? `id:${player.id}` : `local:${player.number}:${player.name}`);
}

async function upsertTeamCoach(client: OdooClient, teamId: number, name: string) {
  try {
    const existing = await client.searchRead<OdooRecord>(
      MODELS.teamStaff,
      [
        [TEAM_STAFF.team, "=", teamId],
        [TEAM_STAFF.role, "=", "Coach"],
      ],
      ["id"],
      { limit: 1 },
    );
    const values = {
      [TEAM_STAFF.name]: name,
      [TEAM_STAFF.role]: "Coach",
      [TEAM_STAFF.team]: teamId,
    };
    const staffId = numberValue(existing[0]?.id) || undefined;

    if (staffId) {
      await client.write(MODELS.teamStaff, [staffId], values);
    } else {
      await client.create(MODELS.teamStaff, values);
    }
    return true;
  } catch {
    // Coach names still live in the device's per-game roster when the optional staff model
    // is unavailable. Player/attendance syncing must not be held hostage by that add-on.
    return false;
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

// There is only ever one equalization event per game, so a fixed negative id keeps it
// stable across reloads and out of the way of real Odoo record ids (positive) and
// locally-stamped event ids (Date.now(), large positive).
export const EQUALIZATION_EVENT_ID = -101;

export function buildEqualizationEvent(
  team: TeamId,
  points: number,
  period: number,
  clock: string,
  teamName: string,
): GameEvent {
  return {
    equalization: true,
    icon: "made",
    id: EQUALIZATION_EVENT_ID,
    label: `Equalization +${points} ${teamName}`,
    period,
    player: "—",
    points,
    team,
    time: clock,
  };
}

function createPlayer(player: Partial<Player> & Pick<Player, "name" | "number">): Player {
  return {
    assists: 0,
    blocks: 0,
    defensiveRebounds: 0,
    fouls: 0,
    techFouls: 0,
    freeThrowsAttempted: 0,
    freeThrowsMade: 0,
    offensiveRebounds: 0,
    ot: 0,
    points: 0,
    present: true,
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

async function loadAttendanceForGame(
  client: OdooClient,
  gameId: number | undefined,
  capabilities: SchemaCapabilities,
): Promise<OdooRecord[]> {
  if (!gameId || !capabilities.gameAttendance.exists) {
    return [];
  }

  const fields = filterReadableFields(ATTENDANCE_FIELDS, capabilities.gameAttendance);
  if (fields.length === 0) {
    return [];
  }

  try {
    return await client.searchRead<OdooRecord>(
      MODELS.gameAttendance,
      [[ATTENDANCE.game, "=", gameId]],
      fields,
    );
  } catch {
    return [];
  }
}

async function loadTeamStaff(
  client: OdooClient,
  teamIds: number[],
): Promise<OdooRecord[]> {
  if (teamIds.length === 0) {
    return [];
  }

  try {
    return await client.searchRead<OdooRecord>(
      MODELS.teamStaff,
      [[TEAM_STAFF.team, "in", teamIds]],
      TEAM_STAFF_FIELDS,
      { order: "id asc" },
    );
  } catch {
    // Staff is an optional enhancement. Older Odoo databases can still score normally.
    return [];
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
  const [teams, players, stats, events, attendance, teamStaff] = await Promise.all([
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
    loadAttendanceForGame(client, gameId, capabilities),
    loadTeamStaff(client, teamIds),
  ]);

  const teamsById = new Map(teams.map((team) => [numberValue(team.id), team]));
  const clubColorsByTeamId = await loadTeamClubColors(client, teams);
  const statsByPlayerId = new Map(
    stats
      .map((stat) => [relationId(stat[PLAYER_STAT.player]), stat] as const)
      .filter(([playerId]) => Boolean(playerId)),
  );
  const attendanceByPlayerId = new Map(
    attendance
      .map((record) => [relationId(record[ATTENDANCE.player]), record] as const)
      .filter(([playerId]) => Boolean(playerId)),
  );

  const awayColors = awayTeamId ? clubColorsByTeamId.get(awayTeamId) : undefined;
  const homeColors = homeTeamId ? clubColorsByTeamId.get(homeTeamId) : undefined;
  const coachByTeamId = new Map<number, string>();
  for (const staff of teamStaff) {
    const teamId = relationId(staff[TEAM_STAFF.team]);
    const role = stringValue(staff[TEAM_STAFF.role]).toLowerCase();
    const name = stringValue(staff[TEAM_STAFF.name]) || stringValue(staff.display_name);
    if (
      teamId &&
      name &&
      !coachByTeamId.has(teamId) &&
      (role.includes("coach") || role.includes("dirigente") || role.includes("entrenador"))
    ) {
      coachByTeamId.set(teamId, name);
    }
  }

  const away = normalizeTeam({
    accentColor: awayColors?.accentColor,
    color: awayColors?.color,
    coach:
      (awayTeamId ? coachByTeamId.get(awayTeamId) : undefined) ||
      relationName(awayTeamId ? teamsById.get(awayTeamId)?.[TEAM.coach] : undefined),
    fallback: fallbackMatch.away,
    fouls: optionalNumberValue(game[GAME.awayTeamFouls]),
    label: "Visitor",
    relationName: relationName(game[GAME.awayTeam]),
    side: "away",
    team: awayTeamId ? teamsById.get(awayTeamId) : undefined,
    teamId: awayTeamId,
    textColor: awayColors?.textColor,
    timeouts: numberValue(game[GAME.awayTimeouts]),
  }, players, statsByPlayerId, attendanceByPlayerId);

  const home = normalizeTeam({
    accentColor: homeColors?.accentColor,
    color: homeColors?.color,
    coach:
      (homeTeamId ? coachByTeamId.get(homeTeamId) : undefined) ||
      relationName(homeTeamId ? teamsById.get(homeTeamId)?.[TEAM.coach] : undefined),
    fallback: fallbackMatch.home,
    fouls: optionalNumberValue(game[GAME.homeTeamFouls]),
    label: "Home",
    relationName: relationName(game[GAME.homeTeam]),
    side: "home",
    team: homeTeamId ? teamsById.get(homeTeamId) : undefined,
    teamId: homeTeamId,
    textColor: homeColors?.textColor,
    timeouts: numberValue(game[GAME.homeTimeouts]),
  }, players, statsByPlayerId, attendanceByPlayerId);

  const period = normalizePeriod(game[GAME.period], fallbackMatch.period);
  const clockSeconds = numberValue(game[GAME.gameClockSeconds], clockToSeconds(fallbackMatch.clock));
  const possessionTeamId = relationId(game[GAME.possessionTeam]);
  const possession =
    possessionTeamId && possessionTeamId === awayTeamId
      ? "away"
      : possessionTeamId && possessionTeamId === homeTeamId
        ? "home"
        : fallbackMatch.possession;

  const equalizationTeamId = relationId(game[GAME.equalizationTeam]);
  const equalizationTeam: TeamId | undefined =
    equalizationTeamId && equalizationTeamId === awayTeamId
      ? "away"
      : equalizationTeamId && equalizationTeamId === homeTeamId
        ? "home"
        : undefined;
  const equalizationApplied = Boolean(game[GAME.equalizationApplied]);
  const equalizationPoints = optionalNumberValue(game[GAME.equalizationPoints]);

  // Re-inject the equalization line on reload so the play-by-play stays consistent.
  // The synthetic event is local-only; the authoritative score already includes the points.
  const eventsWithEqualization =
    equalizationApplied && equalizationTeam && equalizationPoints
      ? [
          buildEqualizationEvent(
            equalizationTeam,
            equalizationPoints,
            period,
            secondsToClock(clockSeconds),
            (equalizationTeam === "away" ? away : home).name,
          ),
          ...events,
        ]
      : events;

  return {
    away,
    awayScore: numberValue(game[GAME.awayScore]),
    clock: secondsToClock(clockSeconds),
    equalizationApplied,
    equalizationPoints,
    equalizationTeam,
    events: eventsWithEqualization,
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
    referee: stringValue(game[GAME.refereeName]) || undefined,
    refereeAssistant: stringValue(game[GAME.refereeAssistant]) || undefined,
    referee3: stringValue(game[GAME.referee3]) || undefined,
    scorekeeper: stringValue(game[GAME.scorekeeper]) || undefined,
    scorekeeper2: stringValue(game[GAME.scorekeeper2]) || undefined,
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
  attendanceByPlayerId: Map<number | undefined, OdooRecord>,
): Team {
  if (!side.teamId) {
    return side.fallback;
  }

  const sidePlayers = players
    .filter((player) => relationId(player[PLAYER.team]) === side.teamId)
    .map((player, index) => normalizePlayer(player, statsByPlayerId, index))
    .map((player) => {
      const row = player.id ? attendanceByPlayerId.get(player.id) : undefined;
      return row
        ? {
            ...player,
            attendanceId: numberValue(row.id) || undefined,
            present: Boolean(row[ATTENDANCE.present]),
            starter: Boolean(row[ATTENDANCE.starter]),
          }
        : player;
    });

  const roster = sidePlayers.length > 0 ? sidePlayers : side.fallback.players;
  // When attendance rows exist they decide the starting five; otherwise keep the legacy
  // "first five players are starters, the rest are bench" behavior.
  const hasAttendance = roster.some((player) => player.attendanceId);
  const starters = (hasAttendance ? roster.filter((player) => player.starter) : roster).slice(0, 5);
  const starterSet = new Set(starters);
  const activePlayers = starters.map((player) => ({ ...player, active: true }));
  const bench = roster
    .filter((player) => !starterSet.has(player))
    .map((player) => ({ ...player, active: false }));
  const presentCount = hasAttendance
    ? roster.filter((player) => player.present).length
    : roster.length;
  const playerFouls = [...activePlayers, ...bench].reduce((total, player) => total + player.fouls, 0);
  const wins = numberValue(side.team?.[TEAM.wins]);
  const losses = numberValue(side.team?.[TEAM.losses]);

  return {
    accentColor: side.accentColor,
    bench,
    category: stringValue(side.team?.[TEAM.category]),
    color: side.color,
    coach: side.coach,
    fouls: side.fouls ?? playerFouls,
    id: side.teamId,
    label: side.label,
    name:
      stringValue(side.team?.[TEAM.name]) ||
      stringValue(side.team?.display_name) ||
      side.relationName ||
      side.fallback.name,
    players: activePlayers,
    presentCount,
    record: wins || losses ? `${wins}-${losses}` : side.fallback.record,
    textColor: side.textColor,
    timeouts: side.timeouts ?? side.fallback.timeouts,
  };
}

type TeamClubColors = {
  accentColor?: string;
  color?: string;
  textColor?: string;
};

// Team colors live on the club (x_club), so resolve each team's club, read the club
// color fields once, and map them back to the owning team id. Best-effort: any failure
// (missing club link, model not present, read error) simply yields no colors.
async function loadTeamClubColors(
  client: OdooClient,
  teams: OdooRecord[],
): Promise<Map<number, TeamClubColors>> {
  const byTeamId = new Map<number, TeamClubColors>();
  const clubIdByTeamId = new Map<number, number>();

  for (const team of teams) {
    const teamId = numberValue(team.id);
    const clubId = relationId(team[TEAM.club]);
    if (teamId && clubId) {
      clubIdByTeamId.set(teamId, clubId);
    }
  }

  const clubIds = uniqueNumbers([...clubIdByTeamId.values()]);
  if (clubIds.length === 0) {
    return byTeamId;
  }

  try {
    const clubs = await client.read<OdooRecord>(MODELS.club, clubIds, CLUB_FIELDS);
    const colorsByClubId = new Map<number, TeamClubColors>();

    for (const club of clubs) {
      const clubId = numberValue(club.id);
      if (!clubId) {
        continue;
      }

      const color = resolveClubColor(club[CLUB.primaryColor]);
      const textColor = resolveClubColor(club[CLUB.secondaryColor]);
      const accentColor = resolveClubColor(club[CLUB.accentColor]);
      if (color || textColor || accentColor) {
        colorsByClubId.set(clubId, { accentColor, color, textColor });
      }
    }

    for (const [teamId, clubId] of clubIdByTeamId) {
      const colors = colorsByClubId.get(clubId);
      if (colors) {
        byTeamId.set(teamId, colors);
      }
    }
  } catch {
    return byTeamId;
  }

  return byTeamId;
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
    techFouls: numberValue(stat?.[PLAYER_STAT.techFouls]),
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

  // A technical foul is also tallied as its own stat (counts toward fouls above too).
  if (input.action === "tech foul") {
    fullValues[PLAYER_STAT.techFouls] = input.player.techFouls + 1;
  }

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
      [GAME_EVENT.name]: `${input.match.clock} #${input.player.number} ${input.label}`,
      [GAME_EVENT.note]: input.note ?? (input.foulOnShot ? "Shooting foul/free throws included" : ""),
      [GAME_EVENT.period]: input.match.period,
      [GAME_EVENT.player]: input.player.id ?? false,
      [GAME_EVENT.points]: input.points,
      [GAME_EVENT.scoreAfter]: scoreAfter,
      [GAME_EVENT.shotValue]: input.shotValue ?? 0,
      [GAME_EVENT.shotX]: input.shotLocation?.x ?? 0,
      [GAME_EVENT.shotY]: input.shotLocation?.y ?? 0,
      [GAME_EVENT.shotZone]: input.shotLocation?.zone ?? input.shotType ?? "",
      [GAME_EVENT.team]: input.match[input.selectedTeam].id ?? false,
      [GAME_EVENT.issuedByRef]: input.issuedByRef ?? false,
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
    [GAME.equalizationPoints]: match.equalizationPoints ?? 0,
    [GAME.equalizationTeam]: match.equalizationTeam ? match[match.equalizationTeam].id ?? false : false,
    [GAME.equalizationApplied]: match.equalizationApplied ?? false,
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

async function upsertAttendanceRow(
  client: OdooClient,
  match: LiveMatch,
  player: Player,
  values: Record<string, unknown>,
) {
  if (player.attendanceId) {
    await client.write(MODELS.gameAttendance, [player.attendanceId], values);
    return player.attendanceId;
  }

  const [existing] = await client.searchRead<OdooRecord>(
    MODELS.gameAttendance,
    [
      [ATTENDANCE.game, "=", match.gameId],
      [ATTENDANCE.player, "=", player.id],
    ],
    ["id"],
    { limit: 1, order: "id desc" },
  );
  const existingId = numberValue(existing?.id);

  if (existingId) {
    await client.write(MODELS.gameAttendance, [existingId], values);
    return existingId;
  }

  return client.create(MODELS.gameAttendance, {
    ...values,
    [ATTENDANCE.game]: match.gameId,
    [ATTENDANCE.player]: player.id,
    [ATTENDANCE.name]: `${match.matchName} - ${player.name}`,
  });
}

async function saveGameSetupFields(
  client: OdooClient,
  match: LiveMatch,
  capabilities: SchemaCapabilities,
): Promise<string> {
  const values = filterWritableValues(
    {
      [GAME.refereeName]: match.referee ?? "",
      [GAME.refereeAssistant]: match.refereeAssistant ?? "",
      [GAME.referee3]: match.referee3 ?? "",
      [GAME.scorekeeper]: match.scorekeeper ?? "",
      [GAME.scorekeeper2]: match.scorekeeper2 ?? "",
      [GAME.awayPresent]: match.away.presentCount,
      [GAME.homePresent]: match.home.presentCount,
    },
    capabilities.game,
  );

  if (Object.keys(values).length === 0) {
    return "";
  }

  try {
    await client.write(MODELS.game, [match.gameId!], values);
    return "Officials saved.";
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
    [PLAYER_STAT.techFouls]: player.techFouls,
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
    const modelNames = [MODELS.game, MODELS.playerGameStat, MODELS.gameEvent, MODELS.gameAttendance];
    const fieldNames = uniqueStrings([
      ...GAME_FIELDS,
      ...GAME_OPTIONAL_FIELDS,
      ...PLAYER_STAT_FIELDS,
      ...PLAYER_STAT_OPTIONAL_FIELDS,
      ...GAME_EVENT_FIELDS,
      ...ATTENDANCE_FIELDS,
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
      gameAttendance: {
        exists: existingModels.has(MODELS.gameAttendance),
        // Raw discovered set (no merge): a missing model yields an empty set so every
        // attendance read/write is skipped until the field script runs.
        fields: fieldsByModel.get(MODELS.gameAttendance) ?? new Set<string>(),
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
    gameAttendance: {
      // Degrade attendance to "kept locally" on a total discovery failure rather than
      // assuming the model exists and throwing on every save.
      exists: false,
      fields: new Set<string>(),
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

function uniqueNumbers(values: readonly number[]) {
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
    "admin tech",
    "warning",
    "substitution",
    "suspension",
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
