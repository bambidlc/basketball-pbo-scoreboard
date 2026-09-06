import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  Activity,
  ArrowLeft,
  ArrowUpDown,
  BarChart3,
  Blocks,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  Clock3,
  ClipboardList,
  Crown,
  Gauge,
  Hand,
  Handshake,
  MapPin,
  OctagonAlert,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Shield,
  Shuffle,
  Star,
  Target,
  TriangleAlert,
  Trophy,
  Undo2,
  UserRoundX,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LazyMotion, m, useInView, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import {
  buildEqualizationEvent,
  createLog,
  fallbackMatch,
  getPeriodLabel,
  loadLiveMatch,
  loadMatchOptions,
  saveGameDayRoster,
  saveMatchCorrection,
  saveMatchAction,
  saveMatchStatus,
  saveGameEventLabel,
  saveMatchFlowState,
  type ActionKey,
  type GameEvent,
  type LiveMatch,
  type MatchOption,
  type Player,
  type SaveMatchActionInput,
  type SaveMatchActionResult,
  type ShotLocation,
  type ShotType,
  type SyncLogEntry,
  type Team,
  type TeamId,
} from "./api/liveMatch";
import {
  findRelevantGame,
  formatGameTime,
} from "./schedule";
import { OdooClient, getOdooConfig } from "./api/odooClient";
import { applyPendingResult, makeOpId, trimMatchForOutbox, type OutboxOp } from "./api/outbox";
import { ScheduleBrowser } from "./components/ScheduleBrowser";
import { CourtSvg } from "./components/CourtSvg";
import { cn } from "./lib/cn";

const loadMotionFeatures = () => import("./motionFeatures").then((module) => module.default);

type ConnectionStatus = "connected" | "error" | "local" | "syncing";
type CourtSide = ShotLocation["side"];
type CourtSides = Record<CourtSide, TeamId>;
type PlayerSelection = Partial<Record<TeamId, string>>;
type ScreenMode = "dashboard" | "live";
type StarterSelection = Partial<Record<TeamId, string[]>>;
type StarterSelectionStore = Record<string, StarterSelection>;
type AttendanceSelection = Partial<Record<TeamId, Record<string, boolean>>>;
type AttendanceSelectionStore = Record<string, AttendanceSelection>;
type StoredGameDayRoster = {
  savedAt: number;
  teams: Record<TeamId, { coach?: string; players: Player[]; starterKeys: string[] }>;
};
type GameDayRosterStore = Record<string, StoredGameDayRoster>;
type OfficialKey = "referee" | "refereeAssistant" | "referee3" | "scorekeeper" | "scorekeeper2";
type OfficialsSelection = Partial<Record<OfficialKey, string>>;
type OfficialsSelectionStore = Record<string, OfficialsSelection>;
type StatsMode = "professional" | "youth";
type GameResolutionStatus = "Final" | "Suspended" | "Cancelled";
type GameResolutionInput = {
  awayScore: number;
  homeScore: number;
  note: string;
  status: GameResolutionStatus;
};
type GameResolutionTeam = Pick<Team, "accentColor" | "color" | "logoUrl" | "name" | "textColor">;

type PeriodSettings = {
  overtimeSeconds: number;
  periodCount: number;
  periodSeconds: number;
};

type ActionDetail = {
  action: ActionKey;
  foulOnShot?: boolean;
  freeThrowsAttempted?: number;
  freeThrowsMade?: number;
  issuedByRef?: boolean;
  label: string;
  opponentTurnoverPlayer?: Player;
  opponentTurnoverTeam?: TeamId;
  points: number;
  shotLocation?: ShotLocation;
  shotMade?: boolean;
  shotType?: ShotType;
  shotValue?: 1 | 2 | 3;
  subInKey?: string;
  subOutKey?: string;
  subTeam?: TeamId;
};

type RefreshOptions = {
  force?: boolean;
  loadOptions?: boolean;
  selectRelevant?: boolean;
};

type UndoItem = {
  detail: ActionDetail;
  event: GameEvent;
  eventId: number;
  period: LiveMatch["period"];
  playerKey: string;
  previousPossession: TeamId;
  previousShotClock: number;
  selectedTeam: TeamId;
  serverEventId?: number;
};

const statActions: Array<{
  key: ActionKey;
  label: string;
  icon: LucideIcon;
  color: string;
}> = [
  { key: "assist", label: "Assist", icon: Handshake, color: "text-lime-400" },
  {
    key: "offensive rebound",
    label: "Off Reb",
    icon: Hand,
    color: "text-green-400",
  },
  {
    key: "defensive rebound",
    label: "Def Reb",
    icon: Shield,
    color: "text-sky-400",
  },
  { key: "steal", label: "Steal", icon: UserRoundX, color: "text-violet-400" },
  { key: "block", label: "Block", icon: Blocks, color: "text-cyan-400" },
  {
    key: "turnover",
    label: "Turnover",
    icon: RotateCcw,
    color: "text-orange-400",
  },
  {
    key: "personal foul",
    label: "P. Foul",
    icon: OctagonAlert,
    color: "text-yellow-400",
  },
  { key: "tech foul", label: "Tech", icon: Trophy, color: "text-amber-400" },
  { key: "warning", label: "Warning", icon: TriangleAlert, color: "text-amber-300" },
];

type WarningTarget = "team" | "player" | "coach" | "public";

type WarningType = {
  key: string;
  label: string;
  hint: string;
  target: WarningTarget;
};

// The six referee warning types. None count as a foul (the separate "Tech" action is for
// technical fouls that do). "Técnica" splits into indirecta (a jugador) and directa (al
// coach). Player-targeted types pick up the selected player's number when one is chosen.
const WARNING_TYPES: WarningType[] = [
  { key: "defensa", label: "Por defensa", hint: "Defensive warning", target: "team" },
  { key: "jugador", label: "A jugador", hint: "Warning to a player", target: "player" },
  { key: "coach", label: "Al coach", hint: "Warning to the coach", target: "coach" },
  { key: "publico", label: "Al público", hint: "Warning to the crowd", target: "public" },
  { key: "no-ventaja", label: "De no ventaja", hint: "No-advantage warning", target: "team" },
  { key: "tecnica-indirecta", label: "Técnica indirecta", hint: "Indirect technical — a jugador", target: "player" },
  { key: "tecnica-directa", label: "Técnica directa", hint: "Direct technical — al coach", target: "coach" },
];

// Quick-pick reasons for substitutions (free text is always available too).
const SUB_REASON_PRESETS = ["Foul trouble", "Rest", "Tactical", "Injury", "Discipline"] as const;

// Quick-pick reasons for suspending a game (free text is always available too).
const SUSPENSION_REASON_PRESETS = ["Injury", "Safety", "Power / lights", "Weather", "Facility", "Brawl"] as const;

// A warning may be issued without a player selected (e.g. al coach / al público). The save
// path needs a Player, so this no-id placeholder lets the event persist while savePlayerStat
// skips the (non-existent) player's stat row.
const WARNING_PLACEHOLDER_PLAYER: Player = {
  assists: 0,
  blocks: 0,
  defensiveRebounds: 0,
  fouls: 0,
  techFouls: 0,
  freeThrowsAttempted: 0,
  freeThrowsMade: 0,
  name: "—",
  number: "",
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
};

// --- Custom (local) match: a roster typed straight into the app, no Odoo behind it. ---
type CustomPlayerInput = { number: string; name: string };
type CustomMatchSetup = {
  awayCoach: string;
  awayName: string;
  homeName: string;
  homeCoach: string;
  awayPlayers: CustomPlayerInput[];
  homePlayers: CustomPlayerInput[];
};

function buildCustomTeam(
  label: "Visitor" | "Home",
  name: string,
  coach: string,
  inputs: CustomPlayerInput[],
  idBase: number,
): Team {
  const players = inputs
    .filter((input) => input.number.trim().length > 0)
    .map((input, index): Player => ({
      ...WARNING_PLACEHOLDER_PLAYER,
      id: idBase - index, // synthetic negative ids keep player keys unique and off Odoo's range
      localId: makeLocalPlayerId(label === "Visitor" ? "away" : "home"),
      name: input.name.trim() || `#${input.number.trim()}`,
      number: input.number.trim(),
      present: true,
    }));

  return {
    bench: players.slice(5).map((player) => ({ ...player, active: false })),
    coach: coach.trim() || undefined,
    fouls: 0,
    label,
    name: name.trim() || label,
    players: players.slice(0, 5).map((player) => ({ ...player, active: true })),
    presentCount: players.length,
    timeouts: 0,
  };
}

function buildCustomMatch(
  setup: CustomMatchSetup,
  periodSeconds: number,
  periodCount: number,
): LiveMatch {
  const away = buildCustomTeam("Visitor", setup.awayName, setup.awayCoach, setup.awayPlayers, -1000);
  const home = buildCustomTeam("Home", setup.homeName, setup.homeCoach, setup.homePlayers, -2000);
  return {
    away,
    awayScore: 0,
    clock: secondsToClock(periodSeconds),
    events: [],
    home,
    homeScore: 0,
    matchName: `${away.name} vs ${home.name}`,
    period: 1,
    periodLabel: getPeriodLabel(1, periodCount),
    possession: "home",
    shotClock: FULL_SHOT_CLOCK,
    status: "Live",
    syncMessage: "Custom local match — no Odoo sync.",
  };
}

const eventIconClass: Record<GameEvent["icon"], string> = {
  made: "text-lime-400",
  missed: "text-red-400",
  rebound: "text-sky-400",
  turnover: "text-orange-400",
};

const logLevelClass: Record<SyncLogEntry["level"], string> = {
  error: "text-red-400",
  info: "text-sky-400",
  success: "text-lime-400",
  warning: "text-amber-400",
};

const STORAGE_KEYS = {
  attendance: "pbo:attendance",
  officials: "pbo:officials",
  foulOnShot: "pbo:foulOnShot",
  mode: "pbo:mode:v2",
  customMatch: "pbo:customMatch",
  customMode: "pbo:customMode",
  liveMatch: "pbo:liveMatch",
  liveMatches: "pbo:liveMatches:v2",
  matchOptions: "pbo:matchOptions:v1",
  gameDayRosters: "pbo:gameDayRosters:v1",
  outbox: "pbo:outbox",
  courtSides: "pbo:courtSides",
  openingJumpWinner: "pbo:openingJumpWinner",
  possessionArrow: "pbo:possessionArrow",
  overtimeSeconds: "pbo:overtimeSeconds",
  periodCount: "pbo:periodCount:v2",
  periodSeconds: "pbo:periodSeconds:v2",
  selectedGameId: "pbo:selectedGameId",
  selectedPlayers: "pbo:selectedPlayers",
  selectedTeam: "pbo:selectedTeam",
  starters: "pbo:starters",
  syncLog: "pbo:syncLog",
  timeoutSeconds: "pbo:timeoutSeconds",
} as const;

const SYNC_LOG_LIMIT = 25;
const VISIBLE_SYNC_LOG_LIMIT = 3;
const UNDO_LIMIT = 500;
const MATCH_OPTIONS_REFRESH_MS = 60_000;
const REGULATION_CLOCK_SECONDS = 5 * 60;
const OVERTIME_CLOCK_SECONDS = 5 * 60;
const DEFAULT_PERIOD_COUNT = 5;
const FULL_SHOT_CLOCK = 24;
const SHORT_SHOT_CLOCK = 14;
const DEFAULT_TIMEOUT_SECONDS = 60;
const DEFAULT_COURT_SIDES: CourtSides = {
  left: "away",
  right: "home",
};

function App() {
  const apiConfig = useMemo(() => getOdooConfig(), []);
  const apiClient = useMemo(() => new OdooClient(apiConfig), [apiConfig]);
  const initialSelectedGameId = useMemo(
    () => readStoredNumber(STORAGE_KEYS.selectedGameId) ?? apiConfig.liveGameId,
    [apiConfig.liveGameId],
  );
  // Last Odoo-backed match scored on this device, persisted on every change. Restored on
  // load so a reload/crash — or a cold start with no signal — resumes the whole game
  // (events, score, clock) instead of an empty board. Only seeded when it matches the
  // selected game; a live Odoo poll later merges fresh server data over it.
  const initialLiveMatch = useMemo(
    () => readStoredLiveMatch(initialSelectedGameId),
    [initialSelectedGameId],
  );
  const seededMatch = initialLiveMatch;
  const initialMatchOptions = useMemo(
    () => readStoredJson<MatchOption[]>(STORAGE_KEYS.matchOptions) ?? [],
    [],
  );
  // Custom games deliberately live in this tab's React state only. Persisting this flag in
  // localStorage made every newly opened tab inherit local mode and stop polling Odoo.
  const [customMode, setCustomMode] = useState(false);
  const [customMatchOpen, setCustomMatchOpen] = useState(false);
  const [match, setMatch] = useState<LiveMatch>(() => seededMatch ?? fallbackMatch);
  const [resultFeedback, setResultFeedback] = useState<Record<number, string>>({});
  const [matchOptions, setMatchOptions] = useState<MatchOption[]>(initialMatchOptions);
  const [selectedGameId, setSelectedGameId] = useState<number | undefined>(initialSelectedGameId);
  const [screenMode, setScreenMode] = useState<ScreenMode>(() =>
    // Resume straight into the live view when the seeded game is still in progress.
    initialLiveMatch?.status === "Live"
      ? "live"
      : "dashboard",
  );
  const [statsMode, setStatsMode] = useState<StatsMode>(() => readStoredStatsMode("youth"));
  const [periodSettings, setPeriodSettings] = useState<PeriodSettings>(() => ({
    overtimeSeconds: readStoredPositiveNumber(STORAGE_KEYS.overtimeSeconds) ?? OVERTIME_CLOCK_SECONDS,
    periodCount: readStoredIntegerInRange(STORAGE_KEYS.periodCount, 1, 8) ?? DEFAULT_PERIOD_COUNT,
    periodSeconds: readStoredPositiveNumber(STORAGE_KEYS.periodSeconds) ?? REGULATION_CLOCK_SECONDS,
  }));
  const [selectedTeam, setSelectedTeam] = useState<TeamId>(() =>
    readStoredTeam(STORAGE_KEYS.selectedTeam, "home"),
  );
  const [possessionArrow, setPossessionArrow] = useState<TeamId>(() =>
    readStoredTeam(STORAGE_KEYS.possessionArrow, "away"),
  );
  const [jumpBallOpen, setJumpBallOpen] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState<PlayerSelection>(() =>
    readStoredJson<PlayerSelection>(STORAGE_KEYS.selectedPlayers) ?? {},
  );
  const [courtSides, setCourtSides] = useState<CourtSides>(() => readStoredCourtSides(DEFAULT_COURT_SIDES));
  const [foulOnShot, setFoulOnShot] = useState(() => readStoredBoolean(STORAGE_KEYS.foulOnShot, false));
  const [timeoutDurationSeconds, setTimeoutDurationSeconds] = useState(
    () => readStoredPositiveNumber(STORAGE_KEYS.timeoutSeconds) ?? DEFAULT_TIMEOUT_SECONDS,
  );
  const [timeoutClockSeconds, setTimeoutClockSeconds] = useState(0);
  const [timeoutTeam, setTimeoutTeam] = useState<TeamId | undefined>(undefined);
  const [isClockRunning, setIsClockRunning] = useState(false);
  const [substitutionTeam, setSubstitutionTeam] = useState<TeamId | undefined>(undefined);
  const [boxScoreOpen, setBoxScoreOpen] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [foulPrompt, setFoulPrompt] = useState<{ player: Player; team: TeamId } | undefined>(undefined);
  const [freeThrowPrompt, setFreeThrowPrompt] = useState<{ made: boolean } | undefined>(undefined);
  const [techOpen, setTechOpen] = useState(false);
  const [endGameOpen, setEndGameOpen] = useState(false);
  const [quickResultOption, setQuickResultOption] = useState<MatchOption | undefined>(undefined);
  // When the scorer advances the period, show a summary of the period that just ended.
  const [endPeriodPrompt, setEndPeriodPrompt] = useState<number | undefined>(undefined);
  // After the period summary, pick the starting five for the new period.
  const [periodStartersOpen, setPeriodStartersOpen] = useState(false);
  // When a player reaches 5 fouls they must come off — prompt for the replacement.
  const [foulOutPrompt, setFoulOutPrompt] = useState<{ player: Player; team: TeamId } | undefined>(undefined);
  const [preGameOpen, setPreGameOpen] = useState(false);
  const [isRosterSaving, setIsRosterSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    apiConfig.enabled ? "syncing" : "local",
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>(() =>
    readStoredSyncLog(apiConfig.enabled),
  );
  // Durable outbox of Odoo writes not yet confirmed synced (parked while offline / on
  // failure) and a live online/offline flag, both surfaced in the sync indicator.
  const [pendingOps, setPendingOpsState] = useState<OutboxOp[]>(
    () => readStoredJson<OutboxOp[]>(STORAGE_KEYS.outbox) ?? [],
  );
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const arrowChangedThisPeriodRef = useRef(false);
  const canceledEventIdsRef = useRef(new Set<number>());
  const clockRunningRef = useRef(false);
  const inFlightRefreshRef = useRef(false);
  const loadedGameIdRef = useRef<number | undefined>(undefined);
  const matchRef = useRef<LiveMatch>(seededMatch ?? fallbackMatch);
  const customModeRef = useRef(customMode);
  const clockExpiryHandledRef = useRef(false);
  const matchOptionsLoadedAtRef = useRef(0);
  const matchOptionsLoadedRef = useRef(false);
  const preGameOpenRef = useRef(false);
  const pendingRefreshRef = useRef<{ gameId?: number; options: RefreshOptions } | null>(null);
  const previousPossessionRef = useRef<{ playerKey?: string; team: TeamId } | null>(null);
  const rateLimitUntilRef = useRef(0);
  const selectedGameIdRef = useRef<number | undefined>(initialSelectedGameId);
  const selectedPlayersRef = useRef<PlayerSelection>({});
  // Mirrors `pendingOps` for use inside the flush loop; `flushingRef` serializes flushes;
  // `inFlightOpIdsRef` marks ops the inline path is sending so a flush never double-sends.
  const pendingOpsRef = useRef(pendingOps);
  const mutationRevisionRef = useRef(0);
  const flushingRef = useRef(false);
  const inFlightOpIdsRef = useRef<Set<string>>(new Set());

  const appendLog = useCallback((entry: SyncLogEntry) => {
    setSyncLog((current) => [entry, ...current].slice(0, SYNC_LOG_LIMIT));
  }, []);

  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  useEffect(() => {
    selectedPlayersRef.current = selectedPlayers;
  }, [selectedPlayers]);

  useEffect(() => {
    clockRunningRef.current = isClockRunning;
  }, [isClockRunning]);

  useEffect(() => {
    customModeRef.current = customMode;
  }, [customMode]);

  // Clean up the legacy shared custom-game state. New tabs must always be free to connect
  // to Odoo, even if another tab is currently running a temporary local game.
  useEffect(() => {
    writeStoredBoolean(STORAGE_KEYS.customMode, false);
    writeStoredJson(STORAGE_KEYS.customMatch, undefined);
  }, []);

  // Persist every Odoo-backed match snapshot so the game survives a reload/crash and is
  // available offline. Keyed by gameId; the loader only restores it for the same game.
  useEffect(() => {
    if (!customMode && match.gameId) {
      persistStoredLiveMatch(match);
    }
  }, [customMode, match]);

  useEffect(() => {
    writeStoredJson(STORAGE_KEYS.matchOptions, matchOptions);
  }, [matchOptions]);

  // Persist before starting network work, so an immediate reload cannot lose a save.
  const setPendingOps = useCallback((update: (current: OutboxOp[]) => OutboxOp[]) => {
    const next = update(pendingOpsRef.current);
    mutationRevisionRef.current += 1;
    pendingOpsRef.current = next;
    writeStoredJson(STORAGE_KEYS.outbox, next);
    setPendingOpsState(next);
  }, []);

  const refreshMatch = useCallback(
    async (gameId?: number, options: RefreshOptions = {}) => {
      // A custom (local) match owns the state — never let an Odoo load replace it.
      if (customModeRef.current) {
        return;
      }

      const revisionAtStart = mutationRevisionRef.current;
      const pendingAtStart = pendingOpsRef.current;
      const now = Date.now();
      const requestedGameId = gameId ?? selectedGameIdRef.current;

      if (inFlightRefreshRef.current) {
        if (options.force) {
          pendingRefreshRef.current = {
            gameId: requestedGameId,
            options: { ...options, force: true },
          };
        }
        return;
      }

      if (!options.force && now < rateLimitUntilRef.current) {
        return;
      }

      if (!options.force && clockRunningRef.current) {
        return;
      }

      // Give queued writes priority over background reads on a slow connection.
      if (!options.force && pendingOpsRef.current.length > 0) {
        return;
      }

      inFlightRefreshRef.current = true;
      setIsRefreshing(true);
      setConnectionStatus("syncing");

      try {
        const shouldLoadOptions = Boolean(
          options.loadOptions ||
          !matchOptionsLoadedRef.current ||
          now - matchOptionsLoadedAtRef.current >= MATCH_OPTIONS_REFRESH_MS
        );
        let optionsResult: MatchOption[] | undefined;
        let scheduleError: string | undefined;
        if (shouldLoadOptions) {
          try {
            optionsResult = await loadMatchOptions(apiClient);
          } catch (error) {
            scheduleError = readableError(error);
          }
        }

        let targetGameId = requestedGameId;
        if (options.selectRelevant && optionsResult && optionsResult.length > 0) {
          const selectedOption = optionsResult.find((option) => option.id === requestedGameId);
          const relevantOption = findRelevantGame(optionsResult);
          if (relevantOption && !selectedOption) {
            targetGameId = relevantOption.id;
          }
        }

        const result = await loadLiveMatch(apiClient, targetGameId);
        const rateLimited = isRateLimitLog(result.log) || Boolean(scheduleError?.includes("429"));

        if (rateLimited) {
          rateLimitUntilRef.current = Date.now() + 30000;
        }

        // A custom match may have started while this load was in flight — keep it.
        if (customModeRef.current || revisionAtStart !== mutationRevisionRef.current || requestedGameId !== selectedGameIdRef.current) {
          return;
        }

        setMatch((current) => {
          if (result.source === "api") {
            loadedGameIdRef.current = result.match.gameId;
          }

          if (
            apiConfig.enabled &&
            result.source === "local" &&
            current.gameId &&
            current.gameId === targetGameId
          ) {
            return {
              ...current,
              syncMessage: rateLimited
                ? "Rate limited. Holding current live data and retrying shortly."
                : scheduleError
                  ? `Schedule refresh failed: ${scheduleError}`
                  : result.log.detail ?? result.log.message,
            };
          }

          const cachedMatch = readStoredLiveMatch(targetGameId);
          const sourceMatch = result.source === "api" ? result.match : cachedMatch ?? result.match;
          const loadedMatch = applyPendingResult(applyStoredGameDayRoster(
            applyStoredOfficials(applyStoredAttendance(applyStoredStarters(sourceMatch))),
          ), sourceMatch.gameId, [...pendingAtStart, ...pendingOpsRef.current]);

          return {
            ...loadedMatch,
            syncMessage: scheduleError
              ? `Schedule refresh failed: ${scheduleError}`
              : loadedMatch.syncMessage,
            events: result.source === "api"
              ? mergeEventHistory(
                  current.gameId === loadedMatch.gameId ? current.events : [],
                  loadedMatch.events,
                )
              : current.events,
          };
        });

        if (optionsResult) {
          matchOptionsLoadedRef.current = true;
          matchOptionsLoadedAtRef.current = Date.now();
          setMatchOptions(optionsResult.map((option) => applyPendingResult(
            option, option.id, [...pendingAtStart, ...pendingOpsRef.current],
          )));
        }

        const nextGameId = result.source === "api"
          ? result.match.gameId
          : (loadedGameIdRef.current ?? targetGameId);
        selectedGameIdRef.current = nextGameId;
        setSelectedGameId(nextGameId);
        appendLog(result.log);
        if (scheduleError) {
          appendLog(createLog("error", "Schedule refresh failed", scheduleError));
        }
        setConnectionStatus(
          scheduleError || result.log.level === "error"
            ? "error"
            : result.source === "api"
              ? "connected"
              : "local",
        );
      } finally {
        inFlightRefreshRef.current = false;
        setIsRefreshing(false);

        const pending = pendingRefreshRef.current;
        if (pending) {
          pendingRefreshRef.current = null;
          window.setTimeout(() => {
            void refreshMatch(pending.gameId, pending.options);
          }, 0);
        }
      }
    },
    [apiClient, apiConfig.enabled, appendLog],
  );

  const syncFlowState = useCallback(
    (label: string, nextMatch: LiveMatch = matchRef.current, quiet = false) => {
      void saveMatchFlowState(apiClient, nextMatch, label === "Equalization removed").then((result) => {
        if (!quiet || result.log.level === "error") {
          appendLog({
            ...result.log,
            detail: result.log.detail ?? label,
          });
        }
        setConnectionStatus(result.log.level === "error" ? "error" : result.saved ? "connected" : "local");
      });
    },
    [apiClient, appendLog],
  );

  // Stamp a delayed sync's serverEventId back onto the matching local event + undo record,
  // so a later edit/undo of an action first synced offline can still target the server row.
  const linkServerEventId = useCallback((localEventId: number, serverEventId: number) => {
    setUndoStack((current) =>
      current.map((item) => (item.eventId === localEventId ? { ...item, serverEventId } : item)),
    );
    setMatch((current) => {
      const next = {
        ...current,
        events: current.events.map((event) =>
          event.id === localEventId ? { ...event, serverEventId } : event,
        ),
      };
      matchRef.current = next;
      return next;
    });
  }, []);

  const reconcileRosterSync = useCallback((resolvedMatch: LiveMatch) => {
    setMatch((current) => {
      if (current.gameId !== resolvedMatch.gameId) {
        return current;
      }
      const next = mergeResolvedRosterIds(current, resolvedMatch);
      matchRef.current = next;
      writeStoredGameDayRoster(next);
      return next;
    });
    setPendingOps((current) => current.map((op) => rewriteOutboxRoster(op, resolvedMatch)));
  }, []);

  // Replay parked writes in FIFO order once back online. Stops at the first failure to keep
  // ordering, skips ops the inline path is still sending, and drops each op only after Odoo
  // confirms it (the write path is idempotent, so a retried op never duplicates data).
  const flushOutbox = useCallback(async () => {
    if (!apiClient.enabled || flushingRef.current || inFlightOpIdsRef.current.size > 0) {
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return;
    }

    flushingRef.current = true;
    try {
      let queue = pendingOpsRef.current.filter((op) => !inFlightOpIdsRef.current.has(op.id));
      let failed = false;

      for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
        const op = queue[queueIndex];
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          failed = true;
          break;
        }

        let result: SaveMatchActionResult;
        try {
          if (op.kind === "action") {
            result = await saveMatchAction(apiClient, op.input);
          } else if (op.kind === "status") {
            result = await saveMatchStatus(apiClient, op.match, op.status, op.note);
          } else {
            result = await saveGameDayRoster(apiClient, op.match);
          }
        } catch {
          result = { saved: false, log: createLog("error", "Sync retry failed", "Network error") };
        }

        if (result.match) {
          reconcileRosterSync(result.match);
          // A player create can succeed before a later attendance request fails. Repair ids
          // immediately even while the roster op remains queued for that final retry.
          queue = queue.map((queued) => rewriteOutboxRoster(queued, result.match!));
        }
        if (result.saved) {
          if (op.kind === "status" && op.match.gameId) setResultFeedback(current => ({ ...current, [op.match.gameId!]: "Saved to Odoo" }));
          if (result.eventId && "eventId" in op && op.eventId != null) {
            linkServerEventId(op.eventId, result.eventId);
          }
          setPendingOps((current) => current.filter((item) => item.id !== op.id));
        } else {
          setPendingOps((current) =>
            current.map((item) => (item.id === op.id ? { ...item, attempts: item.attempts + 1 } : item)),
          );
          failed = true;
          break;
        }
      }

      if (queue.length > 0) {
        setConnectionStatus(failed ? (navigator.onLine ? "error" : "local") : "connected");
      }
    } finally {
      flushingRef.current = false;
    }
  }, [apiClient, linkServerEventId, reconcileRosterSync]);

  // Optimistic, durable send of a scoring action: park it in the outbox, fire the write,
  // and drop it on confirmed success. If offline/failed it stays queued for `flushOutbox`.
  // Returns the live result so each call site's existing reconcile runs unchanged.
  const dispatchSaveAction = useCallback(
    (input: SaveMatchActionInput, eventId?: number): Promise<SaveMatchActionResult> => {
      if (!apiClient.enabled || !input.match.gameId) {
        return saveMatchAction(apiClient, input);
      }
      const op: OutboxOp = {
        id: makeOpId(),
        kind: "action",
        createdAt: Date.now(),
        attempts: 0,
        eventId,
        input: { ...input, match: trimMatchForOutbox(input.match) },
      };
      const mustQueue = pendingOpsRef.current.length > 0 || flushingRef.current;
      setPendingOps((current) => [...current, op]);
      if (mustQueue) {
        return Promise.resolve({ saved: false, log: createLog("warning", "Saved on this device", "Waiting to sync earlier changes.") });
      }
      inFlightOpIdsRef.current.add(op.id);

      return saveMatchAction(apiClient, input)
        .then((result) => {
          if (result.saved) {
            setPendingOps((current) => current.filter((item) => item.id !== op.id));
          }
          return result;
        })
        .catch(
          () =>
            ({ saved: false, log: createLog("error", "Action sync failed", "Network error") }) as SaveMatchActionResult,
        )
        .finally(() => {
          inFlightOpIdsRef.current.delete(op.id);
          void flushOutbox();
        });
    },
    [apiClient, flushOutbox, setPendingOps],
  );

  // Same optimistic + durable wrapper for a game-status change (start / suspend / end).
  const dispatchSaveStatus = useCallback(
    (nextMatch: LiveMatch, status: string, note?: string, eventId?: number): Promise<SaveMatchActionResult> => {
      persistStoredLiveMatch(nextMatch);
      if (!apiClient.enabled || !nextMatch.gameId) {
        return saveMatchStatus(apiClient, nextMatch, status, note);
      }
      const op: OutboxOp = {
        id: makeOpId(),
        kind: "status",
        createdAt: Date.now(),
        attempts: 0,
        eventId,
        match: trimMatchForOutbox(nextMatch),
        status,
        note,
      };
      const mustQueue = pendingOpsRef.current.length > 0 || flushingRef.current;
      setPendingOps((current) => [...current, op]);
      if (mustQueue) {
        return Promise.resolve({ saved: false, log: createLog("warning", "Saved on this device", "Waiting to sync earlier changes.") });
      }
      inFlightOpIdsRef.current.add(op.id);

      return saveMatchStatus(apiClient, nextMatch, status, note)
        .then((result) => {
          if (result.saved) {
            setPendingOps((current) => current.filter((item) => item.id !== op.id));
          }
          return result;
        })
        .catch(
          () =>
            ({ saved: false, log: createLog("error", "Status sync failed", "Network error") }) as SaveMatchActionResult,
        )
        .finally(() => {
          inFlightOpIdsRef.current.delete(op.id);
          void flushOutbox();
        });
    },
    [apiClient, flushOutbox, setPendingOps],
  );

  const dispatchSaveRoster = useCallback(
    (nextMatch: LiveMatch): Promise<SaveMatchActionResult> => {
      if (!apiClient.enabled || !nextMatch.gameId) {
        return saveGameDayRoster(apiClient, nextMatch);
      }

      const op: OutboxOp = {
        id: makeOpId(),
        kind: "roster",
        createdAt: Date.now(),
        attempts: 0,
        match: trimMatchForOutbox(nextMatch),
      };
      const mustQueue = pendingOpsRef.current.length > 0 || flushingRef.current;
      setPendingOps((current) => [...current, op]);
      if (mustQueue) {
        return Promise.resolve({ saved: false, log: createLog("warning", "Saved on this device", "Waiting to sync earlier changes.") });
      }
      inFlightOpIdsRef.current.add(op.id);

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        inFlightOpIdsRef.current.delete(op.id);
        return Promise.resolve({
          saved: false,
          log: createLog("warning", "Roster saved offline", "It is queued to sync automatically when the connection returns."),
        });
      }

      return saveGameDayRoster(apiClient, nextMatch)
        .then((result) => {
          if (result.match) {
            reconcileRosterSync(result.match);
          }
          if (result.saved) {
            setPendingOps((current) => current.filter((item) => item.id !== op.id));
          }
          return result;
        })
        .catch(
          () =>
            ({ saved: false, log: createLog("error", "Roster sync failed", "Network error") }) as SaveMatchActionResult,
        )
        .finally(() => {
          inFlightOpIdsRef.current.delete(op.id);
          void flushOutbox();
        });
    },
    [apiClient, flushOutbox, reconcileRosterSync, setPendingOps],
  );

  // Reconnect handling: track the browser online/offline flag, and whenever connectivity
  // returns, drain the outbox and pull fresh server data. A periodic sweep covers cases
  // where the `online` event never fires (e.g. flaky links that just start working).
  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleOnline = () => {
      setIsOnline(true);
      void (async () => {
        await flushOutbox();
        await refreshMatch(undefined, { force: true });
      })();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setConnectionStatus("local");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [flushOutbox, refreshMatch]);

  useEffect(() => {
    if (!apiConfig.enabled) {
      return undefined;
    }

    // Try to drain on mount (crash recovery) and on an interval while anything is queued.
    void flushOutbox();
    const timerId = window.setInterval(() => {
      if (pendingOpsRef.current.length > 0) {
        void flushOutbox();
      }
    }, Math.max(5000, Math.min(15000, apiConfig.pollMs)));
    return () => window.clearInterval(timerId);
  }, [apiConfig.enabled, apiConfig.pollMs, flushOutbox]);

  useEffect(() => {
    // A custom (local) match owns the state; don't load or poll Odoo over it.
    if (customModeRef.current) {
      return undefined;
    }

    void refreshMatch(undefined, { loadOptions: true, selectRelevant: true });

    if (!apiConfig.enabled) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      // Don't let a background poll clobber in-progress roster/attendance edits, or a custom match.
      if (document.visibilityState === "visible" && !preGameOpenRef.current && !customModeRef.current) {
        void refreshMatch();
      }
    }, apiConfig.pollMs);

    return () => window.clearInterval(timerId);
  }, [apiConfig.enabled, apiConfig.pollMs, refreshMatch]);

  useEffect(() => {
    if (!isClockRunning) {
      return undefined;
    }

    let lastTick = Date.now();
    const timerId = window.setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = Math.floor((now - lastTick) / 1000);

      if (elapsedSeconds <= 0) {
        return;
      }

      lastTick += elapsedSeconds * 1000;
      setMatch((current) => {
        const clockSeconds = clockToSeconds(current.clock);
        if (clockSeconds <= 0) {
          setIsClockRunning(false);
          return current;
        }

        const nextClockSeconds = Math.max(0, clockSeconds - elapsedSeconds);
        const nextMatch = {
          ...current,
          clock: secondsToClock(nextClockSeconds),
          shotClock: Math.max(0, current.shotClock - elapsedSeconds),
        };

        matchRef.current = nextMatch;
        if (nextClockSeconds === 0) {
          setIsClockRunning(false);
          // The running clock just hit 0 — the quarter is over. Defer the advance out of this
          // updater (and guard against the next tick) so it runs once.
          if (!clockExpiryHandledRef.current) {
            clockExpiryHandledRef.current = true;
            window.setTimeout(() => advanceOnClockExpiry(), 0);
          }
        }

        return nextMatch;
      });
    }, 250);

    return () => window.clearInterval(timerId);
  }, [isClockRunning]);

  useEffect(() => {
    if (timeoutClockSeconds <= 0) {
      return undefined;
    }

    let lastTick = Date.now();
    const timerId = window.setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = Math.floor((now - lastTick) / 1000);

      if (elapsedSeconds <= 0) {
        return;
      }

      lastTick += elapsedSeconds * 1000;
      setTimeoutClockSeconds((current) => {
        const nextSeconds = Math.max(0, current - elapsedSeconds);
        if (nextSeconds === 0) {
          setTimeoutTeam(undefined);
        }
        return nextSeconds;
      });
    }, 250);

    return () => window.clearInterval(timerId);
  }, [timeoutClockSeconds]);

  useEffect(() => {
    if (!isClockRunning) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      syncFlowState("Timer checkpoint", matchRef.current, true);
    }, 15000);

    return () => window.clearInterval(timerId);
  }, [isClockRunning, syncFlowState]);

  useEffect(() => {
    writeStoredNumber(STORAGE_KEYS.selectedGameId, selectedGameId);
  }, [selectedGameId]);

  useEffect(() => {
    writeStoredText(STORAGE_KEYS.selectedTeam, selectedTeam);
  }, [selectedTeam]);

  useEffect(() => {
    writeStoredText(STORAGE_KEYS.possessionArrow, possessionArrow);
  }, [possessionArrow]);

  useEffect(() => {
    writeStoredText(STORAGE_KEYS.mode, statsMode);
  }, [statsMode]);

  useEffect(() => {
    writeStoredNumber(STORAGE_KEYS.periodCount, periodSettings.periodCount);
    writeStoredNumber(STORAGE_KEYS.periodSeconds, periodSettings.periodSeconds);
    writeStoredNumber(STORAGE_KEYS.overtimeSeconds, periodSettings.overtimeSeconds);
  }, [periodSettings]);

  useEffect(() => {
    writeStoredJson(STORAGE_KEYS.selectedPlayers, selectedPlayers);
  }, [selectedPlayers]);

  useEffect(() => {
    writeStoredJson(STORAGE_KEYS.courtSides, courtSides);
  }, [courtSides]);

  useEffect(() => {
    writeStoredText(STORAGE_KEYS.foulOnShot, String(foulOnShot));
  }, [foulOnShot]);

  useEffect(() => {
    writeStoredNumber(STORAGE_KEYS.timeoutSeconds, timeoutDurationSeconds);
  }, [timeoutDurationSeconds]);

  useEffect(() => {
    writeStoredJson(STORAGE_KEYS.syncLog, syncLog.slice(0, SYNC_LOG_LIMIT));
  }, [syncLog]);

  const currentRoster = useMemo(() => getRoster(match[selectedTeam]), [match, selectedTeam]);
  const currentPlayer = useMemo(
    () => resolveSelectedPlayer(currentRoster, selectedPlayers[selectedTeam]),
    [currentRoster, selectedPlayers, selectedTeam],
  );
  const foulBallTeam = possessionArrow;
  const summary = useMemo(
    () => [
      { label: "Status", value: match.status },
      {
        label: "Largest Lead",
        value:
          match.homeScore >= match.awayScore
            ? `${match.home.name} by ${match.homeScore - match.awayScore}`
            : `${match.away.name} by ${match.awayScore - match.homeScore}`,
      },
      { label: "Visitor Record", value: match.away.record ?? "Pending" },
      { label: "Home Record", value: match.home.record ?? "Pending" },
    ],
    [match],
  );
  const periodOptions = useMemo(
    () => createPeriodOptions(periodSettings.periodCount),
    [periodSettings.periodCount],
  );

  function handleGameSelect(gameId: number | undefined) {
    setIsClockRunning(false);
    setUndoStack([]);
    canceledEventIdsRef.current.clear();
    // Choosing a real Odoo game leaves custom (local) mode.
    if (customModeRef.current) {
      customModeRef.current = false;
      setCustomMode(false);
      writeStoredJson(STORAGE_KEYS.customMatch, undefined);
    }
    selectedGameIdRef.current = gameId;
    setSelectedGameId(gameId);
    if (gameId) {
      const cached = readStoredLiveMatch(gameId);
      const option = matchOptions.find((candidate) => candidate.id === gameId);
      const localMatch = cached ?? (option ? buildScheduledMatchShell(option, periodSettings) : undefined);
      if (localMatch) {
        const prepared = applyStoredGameDayRoster(
          applyStoredOfficials(applyStoredAttendance(applyStoredStarters(localMatch))),
        );
        matchRef.current = prepared;
        setMatch(prepared);
      }
    }
    void refreshMatch(gameId, { force: true });
  }

  function openGameDayRoster(gameId: number) {
    handleGameSelect(gameId);
    preGameOpenRef.current = true;
    setPreGameOpen(true);
  }

  function openQuickResult(option: MatchOption) {
    handleGameSelect(option.id);
    setQuickResultOption(option);
  }

  function saveQuickResult(result: GameResolutionInput) {
    const option = quickResultOption;
    if (!option) {
      return;
    }

    const cached = readStoredLiveMatch(option.id);
    const baseMatch = cached ?? buildScheduledMatchShell(option, periodSettings);
    const note = result.note.trim();
    const nextMatch: LiveMatch = {
      ...baseMatch,
      awayScore: result.awayScore,
      homeScore: result.homeScore,
      status: result.status,
      statusNote: note || baseMatch.statusNote,
      syncMessage: isOnline
        ? "Game result queued for Odoo verification."
        : "Game result saved offline — it will sync automatically.",
    };

    setQuickResultOption(undefined);
    setMatchOptions((current) =>
      current.map((saved) =>
        saved.id === option.id
          ? {
              ...saved,
              awayScore: result.awayScore,
              homeScore: result.homeScore,
              status: result.status,
              statusNote: note || saved.statusNote,
            }
          : saved,
      ),
    );
    persistStoredLiveMatch(nextMatch);
    if (matchRef.current.gameId === option.id) {
      matchRef.current = nextMatch;
      setMatch(nextMatch);
      setIsClockRunning(false);
    }

    appendLog(
      createLog(
        result.status === "Final" ? "success" : "warning",
        result.status === "Final" ? "Manual result saved" : `Game ${result.status.toLowerCase()}`,
        `${option.awayName} ${result.awayScore}–${result.homeScore} ${option.homeName}${note ? ` · ${note}` : ""}`,
      ),
    );

    setResultFeedback(current => ({ ...current, [option.id]: "Saving result…" }));
    void dispatchSaveStatus(nextMatch, result.status, note || undefined).then((saveResult) => {
      setResultFeedback(current => ({ ...current, [option.id]: saveResult.saved ? "Saved to Odoo" : saveResult.log.detail || "Saved on device · sync pending" }));
      appendLog(saveResult.log);
      setConnectionStatus(
        saveResult.log.level === "error" ? "error" : saveResult.saved ? "connected" : "local",
      );
    });
  }

  function activateLiveView(mode: StatsMode, gameId: number | undefined = selectedGameIdRef.current) {
    setStatsMode(mode);
    setScreenMode("live");
    if (gameId !== selectedGameIdRef.current) {
      handleGameSelect(gameId);
      return;
    }

    void refreshMatch(gameId, { force: true, loadOptions: true });
  }

  function startCustomMatch(setup: CustomMatchSetup) {
    const built = buildCustomMatch(setup, periodSettings.periodSeconds, periodSettings.periodCount);
    setIsClockRunning(false);
    setUndoStack([]);
    canceledEventIdsRef.current.clear();
    setSelectedPlayers({});
    selectedPlayersRef.current = {};
    setSelectedTeam("home");
    customModeRef.current = true;
    setCustomMode(true);
    selectedGameIdRef.current = undefined;
    setSelectedGameId(undefined);
    matchRef.current = built;
    setMatch(built);
    setCustomMatchOpen(false);
    setScreenMode("live");
    appendLog(createLog("success", "Custom match started", built.matchName));
  }

  function exitCustomMatch() {
    setIsClockRunning(false);
    customModeRef.current = false;
    setCustomMode(false);
    writeStoredJson(STORAGE_KEYS.customMatch, undefined);
    setScreenMode("dashboard");
    appendLog(createLog("info", "Custom match closed", "Back to Odoo games."));
    void refreshMatch(undefined, { force: true, loadOptions: true, selectRelevant: true });
  }

  function updatePeriodSettings(values: Partial<PeriodSettings>) {
    setPeriodSettings((current) => ({
      overtimeSeconds: clampWholeNumber(
        values.overtimeSeconds ?? current.overtimeSeconds,
        60,
        20 * 60,
      ),
      periodCount: clampWholeNumber(values.periodCount ?? current.periodCount, 1, 8),
      periodSeconds: clampWholeNumber(values.periodSeconds ?? current.periodSeconds, 60, 20 * 60),
    }));
  }

  function resetMatchState() {
    setIsClockRunning(false);
    setSelectedTeam("home");
    setSelectedPlayers({});
    setFoulOnShot(false);
    appendLog(createLog("info", "Match state reset", "Local scorer controls were reset."));
    void refreshMatch(selectedGameIdRef.current, { force: true });
  }

  function selectPlayer(team: TeamId, player: Player) {
    const currentPossession = matchRef.current.possession;
    if (team !== currentPossession) {
      previousPossessionRef.current = {
        playerKey: selectedPlayersRef.current[currentPossession],
        team: currentPossession,
      };
    } else {
      previousPossessionRef.current = null;
    }

    const nextSelectedPlayers = {
      ...selectedPlayersRef.current,
      [team]: getPlayerKey(player),
    };
    selectedPlayersRef.current = nextSelectedPlayers;
    setSelectedTeam(team);
    setSelectedPlayers(nextSelectedPlayers);
  }

  function toggleStarter(team: TeamId, player: Player) {
    const playerKey = getPlayerKey(player);
    const side = matchRef.current[team];
    const isStarter = side.players.some((candidate) => getPlayerKey(candidate) === playerKey);

    if (!isStarter && side.players.length >= 5) {
      appendLog(createLog("warning", "Starter limit", "Remove one starter before adding another."));
      return;
    }

    const nextMatch = withStarterToggled(matchRef.current, team, playerKey);
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    writeStoredStarterKeys(nextMatch, team);
    writeStoredGameDayRoster(nextMatch);
    appendLog(createLog(
      "info",
      isStarter ? "Starter removed" : "Starter added",
      `${formatPlayer(player)} - ${nextMatch[team].name}`,
    ));
  }

  function openPreGame() {
    preGameOpenRef.current = true;
    setPreGameOpen(true);
  }

  function closePreGame() {
    preGameOpenRef.current = false;
    setPreGameOpen(false);
  }

  function togglePresent(team: TeamId, player: Player) {
    const playerKey = getPlayerKey(player);
    const side = matchRef.current[team];
    const flip = (candidate: Player): Player =>
      getPlayerKey(candidate) === playerKey
        ? { ...candidate, present: !(candidate.present ?? true) }
        : candidate;
    const players = side.players.map(flip);
    const bench = side.bench.map(flip);
    const presentCount = [...players, ...bench].filter((candidate) => candidate.present ?? true).length;
    const nextMatch = {
      ...matchRef.current,
      [team]: { ...side, bench, players, presentCount },
    };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    // Remember attendance locally so it survives polls/reloads and can be changed any time.
    writeStoredAttendance(nextMatch, team);
    writeStoredGameDayRoster(nextMatch);
  }

  function setTeamCoach(team: TeamId, value: string) {
    const nextMatch = {
      ...matchRef.current,
      [team]: { ...matchRef.current[team], coach: value },
    };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    writeStoredGameDayRoster(nextMatch);
  }

  function addRosterPlayer(team: TeamId) {
    const side = matchRef.current[team];
    if (getRoster(side).length >= 30) {
      appendLog(createLog("warning", "Roster limit reached", "A game-day roster can contain up to 30 players."));
      return;
    }

    const player: Player = {
      ...WARNING_PLACEHOLDER_PLAYER,
      active: false,
      localId: makeLocalPlayerId(team),
      name: "",
      number: "",
      present: true,
    };
    const nextMatch = {
      ...matchRef.current,
      [team]: {
        ...side,
        bench: [...side.bench, player],
        presentCount: side.presentCount + 1,
      },
    };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    writeStoredGameDayRoster(nextMatch);
  }

  function updateRosterPlayer(team: TeamId, player: Player, values: Pick<Player, "name" | "number">) {
    const key = getPlayerKey(player);
    const side = matchRef.current[team];
    const update = (candidate: Player): Player =>
      getPlayerKey(candidate) === key ? { ...candidate, ...values } : candidate;
    const nextMatch = {
      ...matchRef.current,
      [team]: {
        ...side,
        bench: side.bench.map(update),
        players: side.players.map(update),
      },
    };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    writeStoredGameDayRoster(nextMatch);
  }

  function removeRosterPlayer(team: TeamId, player: Player) {
    const key = getPlayerKey(player);
    const side = matchRef.current[team];
    const players = side.players.filter((candidate) => getPlayerKey(candidate) !== key);
    const bench = side.bench.filter((candidate) => getPlayerKey(candidate) !== key);
    const presentCount = [...players, ...bench].filter((candidate) => candidate.present ?? true).length;
    const nextMatch = { ...matchRef.current, [team]: { ...side, bench, players, presentCount } };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    writeStoredGameDayRoster(nextMatch);
  }

  function setOfficial(field: OfficialKey, value: string) {
    const nextMatch = { ...matchRef.current, [field]: value };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    // Remember officials locally so they survive polls/reloads (and offline).
    writeStoredOfficials(nextMatch);
  }

  async function savePreGame() {
    if (isRosterSaving) {
      return;
    }
    const validation = validateGameDayRoster(matchRef.current);
    if (validation.length > 0) {
      appendLog(createLog("warning", "Roster needs attention", validation[0]));
      return;
    }

    // Keep starters in localStorage too, so they survive an offline reload.
    writeStoredStarterKeys(matchRef.current, "away");
    writeStoredStarterKeys(matchRef.current, "home");
    writeStoredGameDayRoster(matchRef.current);
    appendLog(createLog("info", "Saving game-day roster", "Players, coaches, attendance, starters and officials."));
    setIsRosterSaving(true);
    const result = await dispatchSaveRoster(matchRef.current);
    appendLog(result.log);
    setConnectionStatus(result.log.level === "error" ? "error" : result.saved ? "connected" : "local");
    setIsRosterSaving(false);

    if (result.log.level !== "error" || !isOnline) {
      preGameOpenRef.current = false;
      setPreGameOpen(false);
    }
  }

  function switchCourtSides() {
    setCourtSides((current) => ({
      left: current.right,
      right: current.left,
    }));
    appendLog(createLog("info", "Court sides switched", "Left and right basket assignments were flipped."));
  }

  // The running game clock hit 0 — end the quarter: advance to the next period, which fires
  // the end-of-period summary (and the starters chain) and resets team fouls.
  function advanceOnClockExpiry() {
    clockExpiryHandledRef.current = false;
    const current = matchRef.current;
    appendLog(createLog(
      "info",
      "Quarter ended",
      `Clock hit 0 — ${getPeriodLabel(current.period, periodSettings.periodCount)} ended.`,
    ));
    setPeriod((current.period + 1) as LiveMatch["period"]);
  }

  function setPeriod(period: LiveMatch["period"]) {
    setIsClockRunning(false);
    const endingPeriod = matchRef.current.period;
    const periodChanged = period !== endingPeriod;

    // Advancing to a later period ends the current one — show its summary to the scorer.
    if (period > endingPeriod) {
      setEndPeriodPrompt(endingPeriod);
    }

    // A new quarter flips the possession arrow (alternating possession), but only
    // if a jump ball during the quarter that just ended did not already change it.
    if (periodChanged) {
      if (arrowChangedThisPeriodRef.current) {
        arrowChangedThisPeriodRef.current = false;
      } else {
        setPossessionArrow((current) => oppositeTeam(current));
      }
    }

    const baseMatch = {
      ...matchRef.current,
      // Team fouls (the bonus count) reset at the start of each period. Individual player
      // fouls are cumulative and untouched, so fouling out at 5 still works.
      away: periodChanged ? { ...matchRef.current.away, fouls: 0 } : matchRef.current.away,
      home: periodChanged ? { ...matchRef.current.home, fouls: 0 } : matchRef.current.home,
      clock: secondsToClock(getDefaultClockSeconds(period, periodSettings)),
      period,
      periodLabel: getPeriodLabel(period, periodSettings.periodCount),
      shotClock: FULL_SHOT_CLOCK,
    };

    // Equalization (puntos de equiparación): at the start of the 3rd quarter the
    // short-handed team receives 2 points per missing player, evaluated against the
    // attendance as it stands right now. Applied once and undoable from the feed.
    let nextMatch = baseMatch;
    if (period === 3 && !matchRef.current.equalizationApplied) {
      const equalization = computeEqualization(baseMatch);
      if (equalization) {
        nextMatch = applyEqualization(baseMatch, equalization);
        appendLog(createLog(
          "success",
          "Equalization applied",
          `${baseMatch[equalization.team].name} +${equalization.points} (attendance ${baseMatch.away.presentCount}-${baseMatch.home.presentCount}).`,
        ));
      }
    }

    matchRef.current = nextMatch;
    setMatch(nextMatch);
    syncFlowState("Period changed", nextMatch);
  }

  // Sets the on-court five for each team at the start of the new period. Reuses the
  // substitution path so any change vs. the previous five is logged (no change = no-op).
  function applyPeriodStarters(awayKeys: string[], homeKeys: string[]) {
    const label = `Inicio ${getPeriodLabel(matchRef.current.period, periodSettings.periodCount)}`;
    commitLineupChange("away", awayKeys, label);
    commitLineupChange("home", homeKeys, label);
    setPeriodStartersOpen(false);
  }

  function setGameClock(seconds: number) {
    setIsClockRunning(false);
    const nextMatch = {
      ...matchRef.current,
      clock: secondsToClock(seconds),
    };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    syncFlowState("Clock set", nextMatch);
  }

  function toggleClock() {
    if (isClockRunning) {
      setIsClockRunning(false);
      syncFlowState("Clock paused");
      return;
    }

    const current = matchRef.current;
    if (clockToSeconds(current.clock) <= 0) {
      const nextMatch = {
        ...current,
        clock: secondsToClock(getDefaultClockSeconds(current.period, periodSettings)),
        shotClock: current.shotClock > 0 ? current.shotClock : FULL_SHOT_CLOCK,
      };
      matchRef.current = nextMatch;
      setMatch(nextMatch);
    }

    appendLog(createLog("info", "Clock started", matchRef.current.clock));
    setIsClockRunning(true);
  }

  function adjustGameClock(seconds: number) {
    setIsClockRunning(false);
    const current = matchRef.current;
    const nextMatch = {
      ...current,
      clock: secondsToClock(clockToSeconds(current.clock) + seconds),
    };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    syncFlowState("Clock adjusted", nextMatch);
  }

  function resetGameClock() {
    setIsClockRunning(false);
    const current = matchRef.current;
    const nextMatch = {
      ...current,
      clock: secondsToClock(getDefaultClockSeconds(current.period, periodSettings)),
      shotClock: FULL_SHOT_CLOCK,
    };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    syncFlowState("Clock reset", nextMatch);
  }

  function resetShotClock(seconds: number) {
    const current = matchRef.current;
    const nextMatch = {
      ...current,
      shotClock: seconds,
    };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    syncFlowState(`Shot clock set to ${seconds}`, nextMatch);
  }

  function adjustShotClock(seconds: number) {
    const current = matchRef.current;
    const nextShotClock = clampWholeNumber(current.shotClock + seconds, 0, 99);
    const nextMatch = {
      ...current,
      shotClock: nextShotClock,
    };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    syncFlowState(`Shot clock adjusted to ${nextShotClock}`, nextMatch);
  }

  function adjustTimeoutDuration(seconds: number) {
    setTimeoutDurationSeconds((current) => clampWholeNumber(current + seconds, 15, 180));
  }

  function stopTimeoutClock() {
    setTimeoutClockSeconds(0);
    setTimeoutTeam(undefined);
  }

  function adjustTimeout(team: TeamId, delta: number) {
    const current = matchRef.current;
    const side = current[team];
    const nextMatch = {
      ...current,
      [team]: {
        ...side,
        timeouts: clampWholeNumber(side.timeouts + delta, 0, 9),
      },
    };
    if (delta > 0) {
      setIsClockRunning(false);
      setTimeoutTeam(team);
      setTimeoutClockSeconds(timeoutDurationSeconds);
    }
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    syncFlowState(`${current[team].label} timeout adjusted`, nextMatch);
  }

  function setPossession(team: TeamId) {
    const current = matchRef.current;
    const nextMatch = {
      ...current,
      possession: team,
      shotClock: FULL_SHOT_CLOCK,
    };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    syncFlowState(`${current[team].label} ball`, nextMatch);
  }

  // Possession (alternating) arrow changes are logged to the event feed so the book has a
  // record of every arrow swing, the same way subs and techs are recorded.
  function buildFoulBallEvent(current: LiveMatch, team: TeamId, label: string): GameEvent {
    return {
      foulBall: true,
      icon: "rebound",
      id: Date.now(),
      label,
      period: current.period,
      player: "—",
      points: 0,
      team,
      time: current.clock,
    };
  }

  function toggleFoulBall() {
    const current = matchRef.current;
    const nextTeam = oppositeTeam(possessionArrow);
    setPossessionArrow(nextTeam);
    // A manual change counts as this period's arrow change, so the quarter break won't flip it.
    arrowChangedThisPeriodRef.current = true;
    const label = `Possession → ${current[nextTeam].name}`;
    const event = buildFoulBallEvent(current, nextTeam, label);
    const nextMatch = { ...current, events: [event, ...current.events] };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    appendLog(createLog("info", "Possession", label));
  }

  function openJumpBall() {
    setJumpBallOpen(true);
  }

  function recordJumpBall(took: TeamId) {
    const nextArrow = oppositeTeam(took);
    setPossessionArrow(nextArrow);
    // A jump ball during the quarter counts as the arrow change for this period,
    // so the upcoming quarter break will not flip it again.
    arrowChangedThisPeriodRef.current = true;
    setJumpBallOpen(false);
    setPossession(took);
    const current = matchRef.current;
    const label = `Jump ball — possession → ${current[nextArrow].name}`;
    const event = buildFoulBallEvent(current, nextArrow, label);
    const nextMatch = { ...current, events: [event, ...current.events] };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    appendLog(createLog("info", "Jump ball", label));
  }

  function getStealTurnoverContext(stealingTeam: TeamId) {
    const current = matchRef.current;
    if (stealingTeam === current.possession) {
      return undefined;
    }

    const currentPossessionKey = selectedPlayersRef.current[current.possession];
    if (currentPossessionKey) {
      const player = findPlayerByKey(current[current.possession], currentPossessionKey);
      if (player) {
        return { player, team: current.possession };
      }
    }

    const previous = previousPossessionRef.current;
    if (!previous || previous.team !== oppositeTeam(stealingTeam) || !previous.playerKey) {
      return undefined;
    }

    const player = findPlayerByKey(matchRef.current[previous.team], previous.playerKey);
    return player ? { player, team: previous.team } : undefined;
  }

  // `actor` lets a caller commit for a specific player/team without waiting a render for the
  // selection state to settle (used by the court popup, where picking the number commits the
  // shot immediately). When omitted, the current selection is used — unchanged behavior.
  function commitAction(
    detail: ActionDetail,
    actor?: { player: Player; team: TeamId },
    eventId?: number,
  ) {
    const actingPlayer = actor?.player ?? currentPlayer;
    const actingTeam = actor?.team ?? selectedTeam;

    if (!actingPlayer) {
      appendLog(createLog("warning", "Action skipped", "Select a player before logging actions."));
      return;
    }

    if (!isActionAllowedForMode(detail.action, statsMode)) {
      appendLog(createLog(
        "warning",
        "Action blocked",
        "This action is not available in the selected stats mode.",
      ));
      return;
    }

    // Base off the live ref, not the render's `match` closure, so two commits fired from the
    // same handler (e.g. a foul plus its free throws) chain instead of clobbering each other.
    const baseMatch = matchRef.current;
    const stealContext = detail.action === "steal" ? getStealTurnoverContext(actingTeam) : undefined;
    const committedDetail = stealContext
      ? {
          ...detail,
          label: `${detail.label} / TO ${formatPlayer(stealContext.player)}`,
          opponentTurnoverPlayer: stealContext.player,
          opponentTurnoverTeam: stealContext.team,
        }
      : detail;
    const nextAwayScore = baseMatch.awayScore + (actingTeam === "away" ? committedDetail.points : 0);
    const nextHomeScore = baseMatch.homeScore + (actingTeam === "home" ? committedDetail.points : 0);
    const event: GameEvent = {
      action: committedDetail.action,
      icon: getEventIcon(committedDetail.action, committedDetail.points),
      id: eventId ?? Date.now(),
      issuedByRef: committedDetail.issuedByRef,
      label: committedDetail.label,
      period: baseMatch.period,
      player: formatPlayer(actingPlayer),
      playerId: actingPlayer.id,
      points: committedDetail.points,
      score: committedDetail.points > 0 ? `${nextAwayScore}-${nextHomeScore}` : undefined,
      shotLocation: committedDetail.shotLocation,
      shotType: committedDetail.shotType,
      team: actingTeam,
      time: baseMatch.clock,
    };
    const undoItem: UndoItem = {
      detail: committedDetail,
      event,
      eventId: event.id,
      period: baseMatch.period,
      playerKey: getPlayerKey(actingPlayer),
      previousPossession: baseMatch.possession,
      previousShotClock: baseMatch.shotClock,
      selectedTeam: actingTeam,
    };
    const playerKey = getPlayerKey(actingPlayer);
    const opponentTurnoverKey = committedDetail.opponentTurnoverPlayer
      ? getPlayerKey(committedDetail.opponentTurnoverPlayer)
      : undefined;
    const nextMatch = updateMatchAfterAction(
      baseMatch,
      actingTeam,
      actingPlayer,
      committedDetail,
      event,
      nextAwayScore,
      nextHomeScore,
    );

    matchRef.current = nextMatch;
    setMatch(nextMatch);
    setUndoStack((current) => [undoItem, ...current].slice(0, UNDO_LIMIT));
    previousPossessionRef.current = null;
    appendLog(createLog("info", "Action queued", `${committedDetail.label} - ${formatPlayer(actingPlayer)}`));

    void dispatchSaveAction({
      ...committedDetail,
      match: nextMatch,
      nextAwayScore,
      nextHomeScore,
      player: actingPlayer,
      selectedTeam: actingTeam,
    }, event.id).then((result) => {
      if (result.eventId || result.playerStatId || result.opponentTurnoverStatId) {
        const wasCanceled = result.eventId ? canceledEventIdsRef.current.has(event.id) : false;

        if (result.eventId) {
          setUndoStack((current) =>
            current.map((item) =>
              item.eventId === event.id ? { ...item, serverEventId: result.eventId } : item,
            ),
          );
        }

        setMatch((current) => {
          let nextMatch = result.eventId
            ? {
                ...current,
                events: current.events.map((savedEvent) =>
                  savedEvent.id === event.id
                    ? { ...savedEvent, serverEventId: result.eventId }
                    : savedEvent,
                ),
              }
            : current;

          if (result.playerStatId) {
            nextMatch = withPlayerStatId(nextMatch, actingTeam, playerKey, result.playerStatId);
          }

          if (
            result.opponentTurnoverStatId &&
            committedDetail.opponentTurnoverTeam &&
            opponentTurnoverKey
          ) {
            nextMatch = withPlayerStatId(
              nextMatch,
              committedDetail.opponentTurnoverTeam,
              opponentTurnoverKey,
              result.opponentTurnoverStatId,
            );
          }

          matchRef.current = nextMatch;
          return nextMatch;
        });

        if (wasCanceled && result.eventId) {
          void saveMatchCorrection(apiClient, {
            label: "Undo saved event",
            match: matchRef.current,
            players: [
              findPlayerByKey(matchRef.current[actingTeam], undoItem.playerKey),
              undoItem.detail.opponentTurnoverTeam && undoItem.detail.opponentTurnoverPlayer
                ? findPlayerByKey(
                    matchRef.current[undoItem.detail.opponentTurnoverTeam],
                    getPlayerKey(undoItem.detail.opponentTurnoverPlayer),
                  )
                : undefined,
            ].filter((player): player is Player => Boolean(player)),
            serverEventId: result.eventId,
          });
          canceledEventIdsRef.current.delete(event.id);
        }
      }

      appendLog(result.log);
      setConnectionStatus(result.log.level === "error" ? "error" : result.saved ? "connected" : "local");
    });
  }

  function recordCourtShot(location: ShotLocation, made: boolean, player: Player) {
    const team = courtSides[location.side];
    const shotPoints = made ? location.value : 0;

    commitAction(
      {
        action: made ? (`made ${location.value}pt` as ActionKey) : (`missed ${location.value}pt` as ActionKey),
        foulOnShot,
        label: getShotLabel(location, made, foulOnShot),
        points: shotPoints,
        shotLocation: location,
        shotMade: made,
        shotType: location.value === 3 ? "3pt" : "2pt",
        shotValue: location.value,
      },
      { player, team },
    );
  }

  // Pressing FT Made / FT Miss opens a picker of the players currently on court; the chosen
  // shooter (and their team) records the free throw via the explicit-actor path.
  function recordFreeThrow(made: boolean) {
    setFreeThrowPrompt({ made });
  }

  function closeFreeThrow() {
    setFreeThrowPrompt(undefined);
  }

  function commitFreeThrowFor(team: TeamId, player: Player, made: boolean) {
    commitAction(
      {
        action: made ? "free throw made" : "free throw missed",
        freeThrowsAttempted: 1,
        freeThrowsMade: made ? 1 : 0,
        label: made ? "Free Throw Made" : "Free Throw Missed",
        points: made ? 1 : 0,
        shotMade: made,
        shotType: "free throw",
        shotValue: 1,
      },
      { player, team },
    );
    setFreeThrowPrompt(undefined);
  }

  function recordStatAction(action: ActionKey) {
    if (!isActionAllowedForMode(action, statsMode)) {
      appendLog(createLog(
        "warning",
        statsMode === "youth" ? "Youth mode blocked" : "Action blocked",
        statsMode === "youth"
          ? "Youth mode uses the court for points and the console for fouls/free throws."
          : "This action is not available.",
      ));
      return;
    }

    commitAction({
      action,
      issuedByRef: action === "tech foul" || action === "warning",
      label: titleCase(action),
      points: 0,
    });
  }

  function openTech() {
    setTechOpen(true);
  }

  function closeTech() {
    setTechOpen(false);
  }

  // A technical on a player counts as a foul (player + team), recorded on the picked on-court
  // player via the explicit-actor path.
  function recordPlayerTech(team: TeamId, player: Player) {
    commitAction(
      {
        action: "tech foul",
        issuedByRef: true,
        label: `Tech · #${player.number}`,
        points: 0,
      },
      { player, team },
    );
    setTechOpen(false);
    checkFoulOut(team, getPlayerKey(player));
  }

  // A 5th personal/tech foul means the player must leave — open the replacement popup.
  function checkFoulOut(team: TeamId, playerKey: string) {
    const updated = findPlayerByKey(matchRef.current[team], playerKey);
    if (updated && updated.fouls >= 5) {
      setFoulOutPrompt({ player: updated, team });
    }
  }

  function replaceFouledOut(replacement: Player) {
    if (!foulOutPrompt) {
      return;
    }
    const team = foulOutPrompt.team;
    const fouledKey = getPlayerKey(foulOutPrompt.player);
    const replacementKey = getPlayerKey(replacement);
    const nextKeys = matchRef.current[team].players
      .map(getPlayerKey)
      .map((key) => (key === fouledKey ? replacementKey : key));
    commitLineupChange(team, nextKeys, `Salió por 5 faltas #${foulOutPrompt.player.number}`);
    setFoulOutPrompt(undefined);
  }

  // An administrative technical (bench/coach/procedure) is ref-issued and does NOT add a
  // personal foul — logged as its own event against the team, the same way warnings are.
  function recordAdminTech(team: TeamId) {
    const current = matchRef.current;
    const label = "Tech · Administrativa (coach/banca)";
    const event: GameEvent = {
      action: "admin tech",
      icon: getEventIcon("admin tech", 0),
      id: Date.now(),
      issuedByRef: true,
      label,
      period: current.period,
      player: "—",
      points: 0,
      team,
      time: current.clock,
    };
    const undoItem: UndoItem = {
      detail: { action: "admin tech", issuedByRef: true, label, points: 0 },
      event,
      eventId: event.id,
      period: current.period,
      playerKey: "",
      previousPossession: current.possession,
      previousShotClock: current.shotClock,
      selectedTeam: team,
    };
    const nextMatch = { ...current, events: [event, ...current.events] };

    matchRef.current = nextMatch;
    setMatch(nextMatch);
    setUndoStack((stack) => [undoItem, ...stack].slice(0, UNDO_LIMIT));
    setTechOpen(false);
    appendLog(createLog("info", "Administrative tech", nextMatch[team].name));

    void dispatchSaveAction({
      action: "admin tech",
      issuedByRef: true,
      label,
      match: nextMatch,
      nextAwayScore: nextMatch.awayScore,
      nextHomeScore: nextMatch.homeScore,
      note: "Administrative",
      player: WARNING_PLACEHOLDER_PLAYER,
      points: 0,
      selectedTeam: team,
    }, event.id).then((result) => {
      if (result.eventId) {
        setUndoStack((stack) =>
          stack.map((item) =>
            item.eventId === event.id ? { ...item, serverEventId: result.eventId } : item,
          ),
        );
        setMatch((latest) => {
          const withServerId = {
            ...latest,
            events: latest.events.map((saved) =>
              saved.id === event.id ? { ...saved, serverEventId: result.eventId } : saved,
            ),
          };
          matchRef.current = withServerId;
          return withServerId;
        });
      }

      appendLog(result.log);
      setConnectionStatus(result.log.level === "error" ? "error" : result.saved ? "connected" : "local");
    });
  }

  function openFoul() {
    if (!currentPlayer) {
      appendLog(createLog("warning", "Foul skipped", "Select the fouling player first."));
      return;
    }
    setFoulPrompt({ player: currentPlayer, team: selectedTeam });
  }

  function closeFoul() {
    setFoulPrompt(undefined);
  }

  // Records a personal foul on the committing player, plus (optionally) who drew the foul and
  // any resulting free throws shot by that fouled player. The foul and the FTs are two events
  // with explicit ids so they don't collide, and commitAction chains them off matchRef.
  function recordFoul(result: { fouledPlayer?: Player; freeThrowsAttempted: number; freeThrowsMade: number }) {
    if (!foulPrompt) {
      return;
    }

    const committer = foulPrompt.player;
    const committerTeam = foulPrompt.team;
    const opponentTeam = oppositeTeam(committerTeam);
    const baseId = Date.now();

    const fouledNote = result.fouledPlayer ? ` · falta a ${formatPlayer(result.fouledPlayer)}` : "";
    const ftNote =
      result.freeThrowsAttempted > 0 ? ` · ${result.freeThrowsMade}/${result.freeThrowsAttempted} TL` : "";

    commitAction(
      {
        action: "personal foul",
        label: `P. Foul${fouledNote}${ftNote}`,
        points: 0,
      },
      { player: committer, team: committerTeam },
      baseId,
    );

    if (result.fouledPlayer && result.freeThrowsAttempted > 0) {
      const made = result.freeThrowsMade;
      commitAction(
        {
          action: made > 0 ? "free throw made" : "free throw missed",
          freeThrowsAttempted: result.freeThrowsAttempted,
          freeThrowsMade: made,
          label: `Free throws ${made}/${result.freeThrowsAttempted}`,
          points: made,
          shotType: "free throw",
          shotValue: 1,
        },
        { player: result.fouledPlayer, team: opponentTeam },
        baseId + 1,
      );
    }

    setFoulPrompt(undefined);
    checkFoulOut(committerTeam, getPlayerKey(committer));
  }

  function openSubstitution() {
    setSubstitutionTeam(selectedTeam);
  }

  function closeSubstitution() {
    setSubstitutionTeam(undefined);
  }

  function openBoxScore() {
    setBoxScoreOpen(true);
  }

  function closeBoxScore() {
    setBoxScoreOpen(false);
  }

  // The coach picks the five who should be on the floor; we diff that against the players
  // currently on court to derive who is coming IN and who is going OUT, then log every swap
  // (one event each, so each stays individually undoable) and persist them. An optional
  // reason/note is appended to the event and saved (required in Q1, enforced by the dialog).
  function commitLineupChange(team: TeamId, nextKeys: string[], reason?: string) {
    const current = matchRef.current;
    const reasonText = reason?.trim();
    const reasonSuffix = reasonText ? ` · ${reasonText}` : "";
    const side = current[team];
    const roster = getRoster(side);
    const playersByKey = new Map(roster.map((player) => [getPlayerKey(player), player]));
    const rosterOrder = new Map(roster.map((player, index) => [getPlayerKey(player), index]));

    const nextSet = new Set(nextKeys.filter((key) => playersByKey.has(key)));
    const onCourtSet = new Set(side.players.map(getPlayerKey));

    const outgoing = side.players.filter((player) => !nextSet.has(getPlayerKey(player)));
    const incoming = roster.filter(
      (player) => nextSet.has(getPlayerKey(player)) && !onCourtSet.has(getPlayerKey(player)),
    );

    // No net change, or a selection we cannot pair into clean swaps — just close the dialog.
    if (outgoing.length === 0 || outgoing.length !== incoming.length) {
      setSubstitutionTeam(undefined);
      return;
    }

    // Keep the on-court list in a stable roster order rather than tap order.
    const orderedKeys = [...nextSet].sort(
      (a, b) => (rosterOrder.get(a) ?? 0) - (rosterOrder.get(b) ?? 0),
    );

    // Date.now() can repeat across a tight loop, so stamp each event from a single base id.
    const baseId = Date.now();
    const pairs = outgoing.map((outPlayer, index) => ({ outPlayer, inPlayer: incoming[index] }));
    const events: GameEvent[] = pairs.map((pair, index) => ({
      action: "substitution",
      icon: getEventIcon("substitution", 0),
      id: baseId + index,
      // Only the first swap of a multi-swap lineup change carries the reason, so the feed
      // shows it once rather than repeating it on every line.
      label: `${formatPlayer(pair.inPlayer)} in / ${formatPlayer(pair.outPlayer)} out${index === 0 ? reasonSuffix : ""}`,
      period: current.period,
      player: formatPlayer(pair.inPlayer),
      playerId: pair.inPlayer.id,
      points: 0,
      team,
      time: current.clock,
    }));
    const undoItems: UndoItem[] = pairs.map((pair, index) => ({
      detail: {
        action: "substitution",
        label: events[index].label,
        points: 0,
        subInKey: getPlayerKey(pair.inPlayer),
        subOutKey: getPlayerKey(pair.outPlayer),
        subTeam: team,
      },
      event: events[index],
      eventId: events[index].id,
      period: current.period,
      playerKey: getPlayerKey(pair.inPlayer),
      previousPossession: current.possession,
      previousShotClock: current.shotClock,
      selectedTeam: team,
    }));

    const lineup = withStarterKeys(current, team, orderedKeys);
    const nextMatch = { ...lineup, events: [...events, ...lineup.events] };

    matchRef.current = nextMatch;
    setMatch(nextMatch);
    setUndoStack((stack) => [...undoItems, ...stack].slice(0, UNDO_LIMIT));

    // If the player chosen for stat entry just left the floor, follow the first sub in.
    const selectedKey = selectedPlayersRef.current[team];
    if (selectedKey && outgoing.some((player) => getPlayerKey(player) === selectedKey)) {
      const nextSelectedPlayers = { ...selectedPlayersRef.current, [team]: getPlayerKey(incoming[0]) };
      selectedPlayersRef.current = nextSelectedPlayers;
      setSelectedPlayers(nextSelectedPlayers);
    }

    setSubstitutionTeam(undefined);
    const summary =
      pairs.length === 1
        ? `${formatPlayer(pairs[0].inPlayer)} in / ${formatPlayer(pairs[0].outPlayer)} out`
        : `IN ${incoming.map(formatPlayer).join(" ")} · OUT ${outgoing.map(formatPlayer).join(" ")}`;
    appendLog(
      createLog(
        "info",
        pairs.length === 1 ? "Substitution" : `Lineup change (${pairs.length})`,
        `${nextMatch[team].name}: ${summary}${reasonSuffix}`,
      ),
    );

    // Persist each swap as its own event/undo record, mirroring the single-sub path.
    pairs.forEach((pair, index) => {
      const event = events[index];
      void dispatchSaveAction({
        action: "substitution",
        label: event.label,
        match: nextMatch,
        nextAwayScore: nextMatch.awayScore,
        nextHomeScore: nextMatch.homeScore,
        note: index === 0 ? reasonText : undefined,
        player: pair.inPlayer,
        points: 0,
        selectedTeam: team,
      }, event.id).then((result) => {
        if (result.eventId) {
          setUndoStack((stack) =>
            stack.map((item) =>
              item.eventId === event.id ? { ...item, serverEventId: result.eventId } : item,
            ),
          );
          setMatch((latest) => {
            const withServerId = {
              ...latest,
              events: latest.events.map((savedEvent) =>
                savedEvent.id === event.id
                  ? { ...savedEvent, serverEventId: result.eventId }
                  : savedEvent,
              ),
            };
            matchRef.current = withServerId;
            return withServerId;
          });
        }

        appendLog(result.log);
        setConnectionStatus(result.log.level === "error" ? "error" : result.saved ? "connected" : "local");
      });
    });
  }

  function handleApplyLineup(nextKeys: string[], reason?: string) {
    if (!substitutionTeam) {
      return;
    }

    commitLineupChange(substitutionTeam, nextKeys, reason);
  }

  function openWarning() {
    setWarningOpen(true);
  }

  function closeWarning() {
    setWarningOpen(false);
  }

  // Referee warnings (6 types). None count as a foul or change the score — they are logged
  // ref-issued events. Player-targeted types attach the currently selected player's number
  // when one is picked; coach/public/team types stand on their own.
  function commitWarning(type: WarningType) {
    const current = matchRef.current;
    const targetsPlayer = type.target === "player";
    const player = targetsPlayer ? currentPlayer : undefined;
    const label = `Warning · ${type.label}${player ? ` ${formatPlayer(player)}` : ""}`;
    const event: GameEvent = {
      action: "warning",
      icon: getEventIcon("warning", 0),
      id: Date.now(),
      issuedByRef: true,
      label,
      period: current.period,
      player: player ? formatPlayer(player) : "—",
      playerId: player?.id,
      points: 0,
      team: selectedTeam,
      time: current.clock,
    };
    const undoItem: UndoItem = {
      detail: { action: "warning", issuedByRef: true, label, points: 0 },
      event,
      eventId: event.id,
      period: current.period,
      playerKey: player ? getPlayerKey(player) : "",
      previousPossession: current.possession,
      previousShotClock: current.shotClock,
      selectedTeam,
    };
    const nextMatch = { ...current, events: [event, ...current.events] };

    matchRef.current = nextMatch;
    setMatch(nextMatch);
    setUndoStack((stack) => [undoItem, ...stack].slice(0, UNDO_LIMIT));
    setWarningOpen(false);
    appendLog(createLog("info", "Warning", `${nextMatch[selectedTeam].name}: ${type.label}`));

    void dispatchSaveAction({
      action: "warning",
      issuedByRef: true,
      label,
      match: nextMatch,
      nextAwayScore: nextMatch.awayScore,
      nextHomeScore: nextMatch.homeScore,
      note: type.label,
      player: player ?? WARNING_PLACEHOLDER_PLAYER,
      points: 0,
      selectedTeam,
    }, event.id).then((result) => {
      if (result.eventId) {
        setUndoStack((stack) =>
          stack.map((item) =>
            item.eventId === event.id ? { ...item, serverEventId: result.eventId } : item,
          ),
        );
        setMatch((latest) => {
          const withServerId = {
            ...latest,
            events: latest.events.map((savedEvent) =>
              savedEvent.id === event.id ? { ...savedEvent, serverEventId: result.eventId } : savedEvent,
            ),
          };
          matchRef.current = withServerId;
          return withServerId;
        });
      }

      appendLog(result.log);
      setConnectionStatus(result.log.level === "error" ? "error" : result.saved ? "connected" : "local");
    });
  }

  function endGame() {
    setEndGameOpen(true);
  }

  function closeEndGame() {
    setEndGameOpen(false);
  }

  // status "Final" closes the game out; "Suspended" parks it so it can be resumed later
  // (the saved state reloads, and the next recorded action flips it back to Live). A
  // suspension carries a reason that is logged, dropped into the play-by-play, and saved
  // so it is still visible when the game is resumed.
  function finishGame(result: GameResolutionInput) {
    const current = matchRef.current;
    const reasonText = result.note.trim();
    const status = result.status;
    const winner =
      result.homeScore === result.awayScore
        ? "Tie game"
        : result.homeScore > result.awayScore
          ? `${current.home.name} win`
          : `${current.away.name} win`;

    setIsClockRunning(false);
    setEndGameOpen(false);

    const suspensionEvent: GameEvent | undefined =
      status !== "Final" && reasonText
        ? {
            action: status === "Cancelled" ? "cancellation" : "suspension",
            icon: getEventIcon("suspension", 0),
            id: Date.now(),
            issuedByRef: true,
            label: `${status} · ${reasonText}`,
            note: reasonText,
            period: current.period,
            player: "—",
            points: 0,
            team: current.possession,
            time: current.clock,
          }
        : undefined;

    const nextMatch = {
      ...current,
      awayScore: result.awayScore,
      homeScore: result.homeScore,
      status,
      statusNote: reasonText || current.statusNote,
      events: suspensionEvent ? [suspensionEvent, ...current.events] : current.events,
    };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    appendLog(
      status === "Final"
        ? createLog("success", "Game ended", `${winner} (${result.awayScore}-${result.homeScore})`)
        : createLog(
            "warning",
            `Game ${status.toLowerCase()}`,
            `${reasonText} · ${result.awayScore}-${result.homeScore}`,
          ),
    );

    if (current.gameId) {
      setMatchOptions((options) =>
        options.map((option) =>
          option.id === current.gameId
            ? {
                ...option,
                awayScore: result.awayScore,
                homeScore: result.homeScore,
                status,
                statusNote: reasonText || option.statusNote,
              }
            : option,
        ),
      );
    }

    void dispatchSaveStatus(
      nextMatch,
      status,
      reasonText || undefined,
      suspensionEvent?.id,
    ).then((result) => {
      if (result.eventId && suspensionEvent) {
        setMatch((latest) => {
          const withServerId = {
            ...latest,
            events: latest.events.map((saved) =>
              saved.id === suspensionEvent.id ? { ...saved, serverEventId: result.eventId } : saved,
            ),
          };
          matchRef.current = withServerId;
          return withServerId;
        });
      }

      appendLog(result.log);
      setConnectionStatus(result.log.level === "error" ? "error" : result.saved ? "connected" : "local");
    });
  }

  function undoEvent(eventId: number) {
    const event = matchRef.current.events.find((candidate) => candidate.id === eventId);

    // The equalization line has no player/action, so it can't run through the normal
    // revert path. Subtract the points, clear the flag, and re-sync.
    if (event?.equalization) {
      const nextMatch = removeEqualization(matchRef.current);
      matchRef.current = nextMatch;
      setMatch(nextMatch);
      appendLog(createLog("info", "Equalization removed", event.label));
      syncFlowState("Equalization removed", nextMatch);
      return;
    }

    // Foul-ball lines are local annotations: drop the line and swing the arrow back.
    if (event?.foulBall) {
      const nextMatch = {
        ...matchRef.current,
        events: matchRef.current.events.filter((candidate) => candidate.id !== eventId),
      };
      matchRef.current = nextMatch;
      setMatch(nextMatch);
      setPossessionArrow(oppositeTeam(event.team));
      appendLog(createLog("info", "Possession undone", event.label));
      return;
    }

    const undoItem =
      undoStack.find((item) => item.eventId === eventId) ??
      (event ? createUndoItemFromEvent(matchRef.current, event) : undefined);
    if (!undoItem) {
      appendLog(createLog("warning", "Undo unavailable", "This event is missing player/action data."));
      return;
    }

    canceledEventIdsRef.current.add(eventId);
    const nextMatch = revertMatchAfterAction(matchRef.current, undoItem);
    const correctedPlayer = findPlayerByKey(nextMatch[undoItem.selectedTeam], undoItem.playerKey);
    const correctedOpponent = undoItem.detail.opponentTurnoverTeam && undoItem.detail.opponentTurnoverPlayer
      ? findPlayerByKey(
          nextMatch[undoItem.detail.opponentTurnoverTeam],
          getPlayerKey(undoItem.detail.opponentTurnoverPlayer),
        )
      : undefined;

    matchRef.current = nextMatch;
    setMatch(nextMatch);
    setUndoStack((current) => current.filter((item) => item.eventId !== eventId));
    appendLog(createLog("info", "Event undone", undoItem.event.label));

    // If the undone action is still parked in the outbox and was never sent, cancel it —
    // to Odoo it simply never happened, so no server correction is needed. (An action that
    // is mid-flight falls through; the canceledEventIdsRef path corrects it once it syncs.)
    const queuedOp = pendingOpsRef.current.find((op) => "eventId" in op && op.eventId === eventId);
    if (queuedOp && !inFlightOpIdsRef.current.has(queuedOp.id)) {
      setPendingOps((current) => current.filter((op) => op.id !== queuedOp.id));
      return;
    }

    void saveMatchCorrection(apiClient, {
      label: `Undo ${undoItem.event.label}`,
      match: nextMatch,
      players: [correctedPlayer, correctedOpponent].filter((player): player is Player => Boolean(player)),
      serverEventId: undoItem.serverEventId,
    }).then((result) => {
      appendLog(result.log);
      setConnectionStatus(result.log.level === "error" ? "error" : result.saved ? "connected" : "local");
    });
  }

  function editEvent(eventId: number) {
    const event = matchRef.current.events.find((candidate) => candidate.id === eventId);
    if (!event) {
      appendLog(createLog("warning", "Edit unavailable", "This event is no longer in the feed."));
      return;
    }

    const nextLabel = window.prompt("Edit event", event.label)?.trim();
    if (!nextLabel || nextLabel === event.label) {
      return;
    }

    const nextMatch = {
      ...matchRef.current,
      events: matchRef.current.events.map((candidate) =>
        candidate.id === eventId ? { ...candidate, label: nextLabel } : candidate,
      ),
    };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    setUndoStack((current) =>
      current.map((item) =>
        item.eventId === eventId
          ? {
              ...item,
              detail: { ...item.detail, label: nextLabel },
              event: { ...item.event, label: nextLabel },
            }
          : item,
      ),
    );
    appendLog(createLog("info", "Event updated", nextLabel));

    void saveGameEventLabel(apiClient, event, nextLabel).then((result) => {
      appendLog(result.log);
      setConnectionStatus(result.log.level === "error" ? "error" : result.saved ? "connected" : "local");
    });
  }

  if (screenMode === "dashboard") {
    return (
      <LazyMotion features={loadMotionFeatures}>
        <GameDashboard
          apiEnabled={apiConfig.enabled}
          connectionStatus={connectionStatus}
          currentMatch={match}
          customMatchActive={customMode}
          isRefreshing={isRefreshing}
          isOnline={isOnline}
          matchOptions={matchOptions}
          periodSettings={periodSettings}
          pendingOps={pendingOps}
          resultFeedback={resultFeedback}
          selectedGameId={selectedGameId}
          statsMode={statsMode}
          syncMessage={match.syncMessage}
          onActivate={activateLiveView}
          onExitCustomMatch={exitCustomMatch}
          onGameSelect={handleGameSelect}
          onManageRoster={openGameDayRoster}
          onOpenCustomMatch={() => setCustomMatchOpen(true)}
          onOpenResult={openQuickResult}
          onPeriodSettingsChange={updatePeriodSettings}
          onRefresh={() => { void flushOutbox().then(() => refreshMatch(undefined, { force: true, loadOptions: true })); }}
          onResumeCustomMatch={() => setScreenMode("live")}
          onStatsModeChange={setStatsMode}
        />
        {customMatchOpen && (
          <CustomMatchDialog onClose={() => setCustomMatchOpen(false)} onStart={startCustomMatch} />
        )}
        {preGameOpen && (
          <PreGameDialog
            isOnline={isOnline}
            isSaving={isRosterSaving}
            match={match}
            onAddPlayer={addRosterPlayer}
            onChangeCoach={setTeamCoach}
            onChangeOfficial={setOfficial}
            onClose={closePreGame}
            onRemovePlayer={removeRosterPlayer}
            onSave={() => void savePreGame()}
            onTogglePresent={togglePresent}
            onToggleStarter={toggleStarter}
            onUpdatePlayer={updateRosterPlayer}
          />
        )}
        {quickResultOption && (
          <GameResolutionDialog
            away={matchOptionTeamIdentity(quickResultOption, "away")}
            awayScore={quickResultOption.awayScore}
            home={matchOptionTeamIdentity(quickResultOption, "home")}
            homeScore={quickResultOption.homeScore}
            initialNote={quickResultOption.statusNote}
            initialStatus={quickResultOption.status}
            isOnline={isOnline}
            onClose={() => setQuickResultOption(undefined)}
            onFinish={saveQuickResult}
          />
        )}
      </LazyMotion>
    );
  }

  return (
    <LazyMotion features={loadMotionFeatures}>
    <main
      className="min-h-dvh bg-neutral-950 p-2 text-neutral-100 [font-family:Inter,ui-sans-serif,system-ui,sans-serif] sm:p-3 2xl:h-dvh 2xl:overflow-hidden"
      style={teamColorVars(match.away, match.home)}
    >
      <section className="mx-auto max-w-[1640px] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-800 shadow-xl shadow-black/40 2xl:h-full">
        <div className="grid gap-px bg-neutral-800 md:grid-cols-2 lg:grid-cols-[240px_minmax(0,1fr)_240px] xl:grid-cols-[260px_minmax(0,1fr)_260px] 2xl:h-full 2xl:min-h-0 2xl:grid-cols-[200px_minmax(0,1fr)_200px_350px] 2xl:grid-rows-[auto_minmax(0,1fr)_182px]">
          <ScoreHeader
            away={match.away}
            awayScore={match.awayScore}
            clock={match.clock}
            equalizationApplied={match.equalizationApplied}
            equalizationPoints={match.equalizationPoints}
            equalizationTeam={match.equalizationTeam}
            home={match.home}
            homeScore={match.homeScore}
            foulBallTeam={foulBallTeam}
            matchName={match.matchName}
            periodLabel={getPeriodLabel(match.period, periodSettings.periodCount)}
            selectedTeam={selectedTeam}
            shotClock={match.shotClock}
            statsMode={statsMode}
            status={match.status}
            onBackToDashboard={() => setScreenMode("dashboard")}
            onSelectTeam={setSelectedTeam}
            onToggleFoulBall={toggleFoulBall}
          />

          <CourtPanel
            courtSides={courtSides}
            currentPlayer={currentPlayer}
            events={match.events}
            foulOnShot={foulOnShot}
            selectedTeam={selectedTeam}
            teams={{ away: match.away, home: match.home }}
            onCourtShot={recordCourtShot}
            onSelectPlayer={selectPlayer}
            onSwitchCourtSides={switchCourtSides}
          />

          <RosterPanel
            side="away"
            team={match.away}
            selectedPlayerKey={selectedPlayers.away}
            selectedTeam={selectedTeam === "away"}
            onSelectPlayer={selectPlayer}
            onSelectTeam={() => setSelectedTeam("away")}
          />

          <RosterPanel
            side="home"
            team={match.home}
            selectedPlayerKey={selectedPlayers.home}
            selectedTeam={selectedTeam === "home"}
            onSelectPlayer={selectPlayer}
            onSelectTeam={() => setSelectedTeam("home")}
          />

          <BottomPanel
            events={match.events}
            summary={summary}
            teams={{ away: match.away, home: match.home }}
            onEditEvent={editEvent}
            onUndoEvent={undoEvent}
          />

          <ActionPanel
            canRecordShot={Boolean(currentPlayer)}
            clock={match.clock}
            connectionStatus={connectionStatus}
            foulOnShot={foulOnShot}
            isClockRunning={isClockRunning}
            isOnline={isOnline}
            isRefreshing={isRefreshing}
            pendingCount={pendingOps.length}
            mode={statsMode}
            period={match.period}
            periodOptions={periodOptions}
            periodSettings={periodSettings}
            shotClock={match.shotClock}
            syncLog={syncLog}
            syncMessage={match.syncMessage}
            teams={{ away: match.away, home: match.home }}
            timeoutClockSeconds={timeoutClockSeconds}
            timeoutDurationSeconds={timeoutDurationSeconds}
            timeoutTeam={timeoutTeam}
            onAdjustShotClock={adjustShotClock}
            onAdjustTimeout={adjustTimeout}
            onAdjustTimeoutDuration={adjustTimeoutDuration}
            onAction={recordStatAction}
            onAdjustClock={adjustGameClock}
            onEndGame={endGame}
            onFreeThrow={recordFreeThrow}
            isActionAllowed={(action) => isActionAllowedForMode(action, statsMode)}
            onJumpBall={openJumpBall}
            onOpenBoxScore={openBoxScore}
            onOpenFoul={openFoul}
            onOpenPreGame={openPreGame}
            onOpenSubstitution={openSubstitution}
            onOpenTech={openTech}
            onOpenWarning={openWarning}
            onPeriodChange={setPeriod}
            onPeriodSettingsChange={updatePeriodSettings}
            onRefresh={() => refreshMatch(undefined, { force: true, loadOptions: true })}
            onResetMatchState={resetMatchState}
            onResetGameClock={resetGameClock}
            onResetShotClock={resetShotClock}
            onSetGameClock={setGameClock}
            onSetFoulOnShot={setFoulOnShot}
            onStopTimeoutClock={stopTimeoutClock}
            onToggleClock={toggleClock}
          />
        </div>
      </section>

      {substitutionTeam && (
        <SubstitutionDialog
          key={substitutionTeam}
          period={match.period}
          side={substitutionTeam}
          team={match[substitutionTeam]}
          onApply={handleApplyLineup}
          onClose={closeSubstitution}
        />
      )}

      {boxScoreOpen && (
        <BoxScoreDialog
          initialTeam={selectedTeam}
          match={match}
          mode={statsMode}
          periodCount={periodSettings.periodCount}
          onClose={closeBoxScore}
        />
      )}

      {warningOpen && (
        <WarningDialog
          side={selectedTeam}
          team={match[selectedTeam]}
          onClose={closeWarning}
          onSelect={commitWarning}
        />
      )}

      {foulPrompt && (
        <FoulDialog
          committer={foulPrompt.player}
          committerSide={foulPrompt.team}
          opponent={match[oppositeTeam(foulPrompt.team)]}
          opponentSide={oppositeTeam(foulPrompt.team)}
          onClose={closeFoul}
          onConfirm={recordFoul}
        />
      )}

      {freeThrowPrompt && (
        <FreeThrowDialog
          made={freeThrowPrompt.made}
          teams={{ away: match.away, home: match.home }}
          onClose={closeFreeThrow}
          onPick={(team, player) => commitFreeThrowFor(team, player, freeThrowPrompt.made)}
        />
      )}

      {techOpen && (
        <TechDialog
          teams={{ away: match.away, home: match.home }}
          onClose={closeTech}
          onPlayerTech={recordPlayerTech}
          onAdminTech={recordAdminTech}
        />
      )}

      {endGameOpen && (
        <GameResolutionDialog
          away={match.away}
          home={match.home}
          awayScore={match.awayScore}
          homeScore={match.homeScore}
          initialNote={match.statusNote}
          initialStatus={match.status}
          isOnline={isOnline}
          onClose={closeEndGame}
          onFinish={finishGame}
        />
      )}

      {endPeriodPrompt !== undefined && (
        <EndOfPeriodDialog
          endedPeriod={endPeriodPrompt}
          match={match}
          periodCount={periodSettings.periodCount}
          summary={summary}
          onClose={() => setEndPeriodPrompt(undefined)}
          onContinue={() => {
            setEndPeriodPrompt(undefined);
            setPeriodStartersOpen(true);
          }}
        />
      )}

      {periodStartersOpen && (
        <PeriodStartersDialog
          periodLabel={getPeriodLabel(match.period, periodSettings.periodCount)}
          teams={{ away: match.away, home: match.home }}
          onApply={applyPeriodStarters}
          onClose={() => setPeriodStartersOpen(false)}
        />
      )}

      {foulOutPrompt && (
        <FoulOutDialog
          player={foulOutPrompt.player}
          side={foulOutPrompt.team}
          team={match[foulOutPrompt.team]}
          onClose={() => setFoulOutPrompt(undefined)}
          onReplace={replaceFouledOut}
        />
      )}

      {jumpBallOpen && (
        <JumpBallDialog
          arrowTeam={possessionArrow}
          teams={{ away: match.away, home: match.home }}
          onClose={() => setJumpBallOpen(false)}
          onChoose={recordJumpBall}
        />
      )}

      {preGameOpen && (
        <PreGameDialog
          isOnline={isOnline}
          isSaving={isRosterSaving}
          match={match}
          onAddPlayer={addRosterPlayer}
          onChangeCoach={setTeamCoach}
          onChangeOfficial={setOfficial}
          onClose={closePreGame}
          onRemovePlayer={removeRosterPlayer}
          onSave={() => void savePreGame()}
          onTogglePresent={togglePresent}
          onToggleStarter={toggleStarter}
          onUpdatePlayer={updateRosterPlayer}
        />
      )}
    </main>
    </LazyMotion>
  );
}

function GameDashboard({
  apiEnabled,
  connectionStatus,
  currentMatch,
  customMatchActive,
  isRefreshing,
  isOnline,
  matchOptions,
  periodSettings,
  pendingOps,
  resultFeedback,
  selectedGameId,
  statsMode,
  syncMessage,
  onActivate,
  onExitCustomMatch,
  onGameSelect,
  onManageRoster,
  onOpenCustomMatch,
  onOpenResult,
  onPeriodSettingsChange,
  onRefresh,
  onResumeCustomMatch,
  onStatsModeChange,
}: {
  apiEnabled: boolean;
  connectionStatus: ConnectionStatus;
  currentMatch: LiveMatch;
  customMatchActive: boolean;
  isRefreshing: boolean;
  isOnline: boolean;
  matchOptions: MatchOption[];
  periodSettings: PeriodSettings;
  pendingOps: OutboxOp[];
  resultFeedback: Record<number, string>;
  selectedGameId?: number;
  statsMode: StatsMode;
  syncMessage: string;
  onActivate: (mode: StatsMode, gameId?: number) => void;
  onExitCustomMatch: () => void;
  onGameSelect: (gameId: number | undefined) => void;
  onManageRoster: (gameId: number) => void;
  onOpenCustomMatch: () => void;
  onOpenResult: (option: MatchOption) => void;
  onPeriodSettingsChange: (settings: Partial<PeriodSettings>) => void;
  onRefresh: () => void;
  onResumeCustomMatch: () => void;
  onStatsModeChange: (mode: StatsMode) => void;
}) {
  const pendingCount = pendingOps.length;
  const statusText = !isOnline ? "Offline · saved on this device"
    : pendingCount ? `${pendingCount} ${pendingCount === 1 ? "change" : "changes"} waiting to sync`
    : connectionStatus === "error" ? "Connection interrupted"
    : isRefreshing ? "Checking for updates" : connectionStatus === "connected" ? "Connected to Odoo" : apiEnabled ? "Connecting to Odoo" : "Local mode";
  return (
    <main className="h-dvh overflow-hidden bg-neutral-950 p-3 text-neutral-100 [font-family:Inter,ui-sans-serif,system-ui,sans-serif] sm:p-5 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
      <section className="mx-auto flex h-full max-w-[1640px] flex-col gap-3">
        <header className="flex shrink-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-amber-300 text-neutral-950"><CalendarDays size={20} /></div>
            <div><p className="text-xs font-semibold text-neutral-500">BASKETBALL PBO</p><h1 className="text-lg font-semibold text-balance">Game center</h1></div>
          </div>
          <button className="flex h-10 items-center gap-2 rounded-lg border border-neutral-700 px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-40" disabled={isRefreshing} onClick={onRefresh}><RefreshCw size={14} /><span>{pendingCount ? "Retry sync" : "Refresh"}</span></button>
        </header>
        <div role="status" aria-live="polite" className="flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
          {!isOnline ? <WifiOff size={14} /> : <Wifi size={14} />}
          <span className={cn("shrink-0", (pendingCount > 0 || connectionStatus === "error") && "text-amber-300")}>{statusText}</span>
          <span className="hidden truncate border-l border-neutral-700 pl-2 text-neutral-500 sm:block" title={syncMessage}>{syncMessage}</span>
        </div>
        {isRefreshing && !matchOptions.length ? <DashboardLoadingState message={syncMessage} /> : <ScheduleBrowser games={matchOptions} selectedGameId={selectedGameId} renderGame={option => (
          <GameCard option={option} selected={option.id === selectedGameId} statsMode={statsMode}
            pending={pendingOps.some(op => (op.kind === "action" ? op.input.match.gameId : op.match.gameId) === option.id)}
            saveFeedback={resultFeedback[option.id]}
            onActivate={onActivate} onManageRoster={() => onManageRoster(option.id)}
            onOpenResult={() => onOpenResult(option)} onSelect={() => onGameSelect(option.id)} />
        )} />}
        <details className="shrink-0 rounded-xl border border-neutral-800 bg-neutral-900">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-semibold text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"><span>Scorer settings · {statsMode === "youth" ? "Youth" : "Pro"} mode</span><ChevronDown size={14} /></summary>
          <div className="grid max-h-64 gap-3 overflow-auto border-t border-neutral-800 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid grid-cols-2 gap-2"><ModeButton active={statsMode === "youth"} icon={<Users size={14} />} label="Youth" onClick={() => onStatsModeChange("youth")} /><ModeButton active={statsMode === "professional"} icon={<Target size={14} />} label="Pro" onClick={() => onStatsModeChange("professional")} /></div>
            <PeriodSettingsControls settings={periodSettings} onChange={onPeriodSettingsChange} />
            <button className="h-11 rounded-lg border border-neutral-700 text-xs font-semibold" onClick={onOpenCustomMatch}>Create custom game</button>
            {customMatchActive && <div className="flex gap-2"><button className="h-11 rounded-lg border border-neutral-700 px-3 text-xs" onClick={onResumeCustomMatch}>Resume custom game</button><button className="h-11 rounded-lg border border-neutral-700 px-3 text-xs" onClick={onExitCustomMatch}>Exit</button></div>}
            <p className="text-xs text-neutral-500">Selected: {currentMatch.matchName || "Choose a game above"}</p>
          </div>
        </details>
      </section>
    </main>
  );
}

function gameStatusClass(status: string) {
  if (status === "Final") {
    return "border-lime-500/40 bg-lime-500/10 text-lime-300";
  }
  if (status === "Suspended") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  }
  if (status === "Live") {
    return "border-red-500/40 bg-red-500/10 text-red-300";
  }
  return "border-neutral-700 bg-neutral-900 text-neutral-400";
}

function DashboardLoadingState({ message }: { message: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef, { amount: 0.2 });
  const reduceMotion = useReducedMotion();
  const animate = inView && !reduceMotion;

  return (
    <div
      aria-live="polite"
      className="flex min-h-[440px] flex-col justify-center rounded-xl border border-neutral-800 bg-neutral-950 p-5"
      ref={containerRef}
      role="status"
    >
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <div className="relative flex size-16 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900">
          <m.div
            aria-hidden="true"
            className="absolute inset-1 rounded-full border border-neutral-700"
            animate={animate ? { rotate: 360 } : { rotate: 0 }}
            transition={animate ? { duration: 1.4, ease: "linear", repeat: Infinity } : { duration: 0 }}
          >
            <span className="absolute -top-0.5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-amber-300" />
          </m.div>
          <m.div
            aria-hidden="true"
            animate={animate ? { opacity: [0.55, 1, 0.55], scale: [0.94, 1, 0.94] } : { opacity: 1, scale: 1 }}
            transition={animate ? { duration: 1.6, ease: "easeInOut", repeat: Infinity } : { duration: 0.15 }}
          >
            <Gauge className="text-amber-300" size={24} />
          </m.div>
        </div>
        <h3 className="mt-4 text-lg font-semibold text-balance text-neutral-50">Syncing game operations</h3>
        <p className="mt-1 text-sm text-pretty text-neutral-500">
          Loading the schedule, rosters, and latest match status.
        </p>
        <div className="mt-3 max-w-sm truncate text-xs text-neutral-600" title={message}>{message}</div>
      </div>

      <div aria-hidden="true" className="mx-auto mt-7 grid w-full max-w-2xl gap-3 lg:grid-cols-2">
        {[0, 1].map((index) => (
          <m.div
            className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
            animate={animate ? { opacity: [0.42, 0.8, 0.42] } : { opacity: 0.6 }}
            key={index}
            transition={animate
              ? { delay: index * 0.14, duration: 1.6, ease: "easeInOut", repeat: Infinity }
              : { duration: 0.15 }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="h-3 w-20 rounded-full bg-neutral-800" />
              <span className="h-3 w-10 rounded-full bg-neutral-800" />
            </div>
            <div className="mt-4 h-4 w-2/3 rounded-full bg-neutral-800" />
            <div className="mt-4 space-y-2">
              <div className="h-9 rounded-lg border border-neutral-800 bg-neutral-950" />
              <div className="h-9 rounded-lg border border-neutral-800 bg-neutral-950" />
            </div>
          </m.div>
        ))}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "flex h-11 items-center justify-center gap-2 rounded-lg border text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400/60",
        active
          ? "border-amber-300 bg-amber-300 text-neutral-950"
          : "border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800 hover:text-neutral-100",
      )}
      type="button"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function emptyCustomRoster(): CustomPlayerInput[] {
  return Array.from({ length: 6 }, () => ({ number: "", name: "" }));
}

function CustomMatchDialog({
  onClose,
  onStart,
}: {
  onClose: () => void;
  onStart: (setup: CustomMatchSetup) => void;
}) {
  const [awayName, setAwayName] = useState("Visitor");
  const [homeName, setHomeName] = useState("Home");
  const [awayCoach, setAwayCoach] = useState("");
  const [homeCoach, setHomeCoach] = useState("");
  const [awayPlayers, setAwayPlayers] = useState<CustomPlayerInput[]>(emptyCustomRoster);
  const [homePlayers, setHomePlayers] = useState<CustomPlayerInput[]>(emptyCustomRoster);

  const awayValid = awayPlayers.filter((player) => player.number.trim().length > 0).length;
  const homeValid = homePlayers.filter((player) => player.number.trim().length > 0).length;
  const canStart = awayValid >= 1 && homeValid >= 1;

  function start() {
    if (canStart) {
      onStart({ awayCoach, awayName, homeCoach, homeName, awayPlayers, homePlayers });
    }
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Users className="shrink-0 text-violet-300" size={20} />
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest text-violet-300">Custom match · local</div>
              <h2 className="truncate text-lg font-black text-neutral-50">Type in a roster (no Odoo)</h2>
            </div>
          </div>
          <button
            aria-label="Close custom match"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            <CircleX size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-px overflow-y-auto scrollbar-slim bg-neutral-800 sm:grid-cols-2">
          <CustomTeamColumn
            accent={AWAY_FALLBACK.base}
            coach={awayCoach}
            label="Visitor"
            name={awayName}
            players={awayPlayers}
            validCount={awayValid}
            onNameChange={setAwayName}
            onCoachChange={setAwayCoach}
            onPlayersChange={setAwayPlayers}
          />
          <CustomTeamColumn
            accent={HOME_FALLBACK.base}
            coach={homeCoach}
            label="Home"
            name={homeName}
            players={homePlayers}
            validCount={homeValid}
            onNameChange={setHomeName}
            onCoachChange={setHomeCoach}
            onPlayersChange={setHomePlayers}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3">
          <div className="min-w-0 truncate text-xs font-semibold text-neutral-400">
            {canStart
              ? `${awayName || "Visitor"} (${awayValid}) vs ${homeName || "Home"} (${homeValid}) · first 5 start`
              : "Add at least one number per team (5 recommended)."}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 px-4 text-xs font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="flex h-10 items-center gap-2 rounded-lg border border-violet-500/50 bg-violet-500/15 px-4 text-xs font-black uppercase tracking-wide text-violet-100 transition-colors hover:bg-violet-500/25 focus:outline-none focus:ring-2 focus:ring-violet-500/50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canStart}
              type="button"
              onClick={start}
            >
              <Play size={16} />
              Start Match
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomTeamColumn({
  accent,
  coach,
  label,
  name,
  players,
  validCount,
  onNameChange,
  onCoachChange,
  onPlayersChange,
}: {
  accent: string;
  coach: string;
  label: "Visitor" | "Home";
  name: string;
  players: CustomPlayerInput[];
  validCount: number;
  onNameChange: (name: string) => void;
  onCoachChange: (name: string) => void;
  onPlayersChange: (players: CustomPlayerInput[]) => void;
}) {
  function updateRow(index: number, field: keyof CustomPlayerInput, value: string) {
    onPlayersChange(players.map((player, i) => (i === index ? { ...player, [field]: value } : player)));
  }

  return (
    <div className="bg-neutral-900 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden className="h-4 w-1 rounded-full" style={{ backgroundColor: accent }} />
        <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: accent }}>{label}</span>
        <span className="ml-auto rounded-full border border-neutral-700 bg-neutral-950 px-2 py-0.5 font-mono text-[11px] font-black tabular-nums text-neutral-400">
          {validCount} {validCount === 1 ? "player" : "players"}
        </span>
      </div>
      <input
        aria-label={`${label} team name`}
        className="mb-2 h-10 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm font-bold text-neutral-100 outline-none focus:ring-2 focus:ring-neutral-500"
        placeholder={`${label} team name`}
        value={name}
        onChange={(event) => onNameChange(event.currentTarget.value)}
      />
      <input
        aria-label={`${label} coach name`}
        className="mb-2 h-10 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm font-semibold text-neutral-100 outline-none focus:ring-2 focus:ring-neutral-500"
        placeholder="Coach name"
        value={coach}
        onChange={(event) => onCoachChange(event.currentTarget.value)}
      />
      <div className="space-y-1.5">
        {players.map((player, index) => (
          <div className="flex items-center gap-1.5" key={index}>
            <input
              aria-label={`${label} player ${index + 1} number`}
              className="h-9 w-14 shrink-0 rounded-lg border border-neutral-800 bg-neutral-950 px-2 text-center font-mono text-sm font-black tabular-nums text-neutral-100 outline-none focus:ring-2 focus:ring-neutral-500"
              inputMode="numeric"
              placeholder="#"
              value={player.number}
              onChange={(event) => updateRow(index, "number", event.currentTarget.value.replace(/[^0-9]/g, "").slice(0, 3))}
            />
            <input
              aria-label={`${label} player ${index + 1} name`}
              className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2 text-sm font-semibold text-neutral-100 outline-none focus:ring-2 focus:ring-neutral-500"
              placeholder="Name (optional)"
              value={player.name}
              onChange={(event) => updateRow(index, "name", event.currentTarget.value)}
            />
            <button
              aria-label={`Remove ${label} player ${index + 1}`}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:opacity-30"
              disabled={players.length <= 1}
              type="button"
              onClick={() => onPlayersChange(players.filter((_, i) => i !== index))}
            >
              <CircleX size={15} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-700 bg-neutral-950 text-[11px] font-black uppercase tracking-wide text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
        type="button"
        onClick={() => onPlayersChange([...players, { number: "", name: "" }])}
      >
        <Plus size={14} />
        Add player
      </button>
      <p className="mt-2 text-[10px] font-semibold text-neutral-500">First 5 start; the rest are bench.</p>
    </div>
  );
}

function GameCard({
  pending,
  saveFeedback,
  statsMode,
  option,
  selected,
  onActivate,
  onManageRoster,
  onOpenResult,
  onSelect,
}: {
  pending: boolean;
  saveFeedback?: string;
  statsMode: StatsMode;
  option: MatchOption;
  selected: boolean;
  onActivate: (mode: StatsMode, gameId?: number) => void;
  onManageRoster: () => void;
  onOpenResult: () => void;
  onSelect: () => void;
}) {
  return (
    <article
      className={cn(
        "rounded-xl border bg-neutral-950 p-3 transition-colors",
        selected
          ? "border-amber-400/70 ring-1 ring-inset ring-amber-400/20"
          : "border-neutral-800 hover:border-neutral-700",
      )}
      style={matchOptionColorVars(option)}
    >
      <button className="block w-full rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-amber-400/50" type="button" onClick={onSelect}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            {selected && <span className="text-xs font-semibold text-amber-300">Selected</span>}
            <span className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
              gameStatusClass(option.status),
            )}>
              {option.status}
            </span>
          </div>
          <span className="font-mono text-xs text-neutral-500 tabular-nums">{option.week || `#${option.id}`}</span>
        </div>
        <h3 className="sr-only">{option.name}</h3>
        <div className="mt-2 grid gap-1.5">
          <GameTeamLine
            accentColor={option.awayAccentColor}
            color={option.awayColor}
            label="Visitor"
            logoUrl={option.awayLogoUrl}
            name={option.awayName}
            score={option.awayScore}
            team="away"
            textColor={option.awayTextColor}
          />
          <GameTeamLine
            accentColor={option.homeAccentColor}
            color={option.homeColor}
            label="Home"
            logoUrl={option.homeLogoUrl}
            name={option.homeName}
            score={option.homeScore}
            team="home"
            textColor={option.homeTextColor}
          />
        </div>
        <div className="mt-2 grid gap-1 text-xs text-neutral-500 sm:grid-cols-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <Clock3 className="shrink-0" size={12} />
            <span className="truncate">
              {formatGameTime(option.datetime)
                ? `Tip-off ${formatGameTime(option.datetime)}`
                : option.datetime || "Time pending"}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 sm:justify-end">
            <MapPin className="shrink-0" size={12} />
            <span className="truncate">{option.location || "Location pending"}</span>
          </span>
        </div>
        {(option.status === "Suspended" || option.status === "Cancelled") && option.statusNote && (
          <div className="mt-2 line-clamp-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-pretty text-amber-100">
            <span className="font-semibold">{option.status}:</span> {option.statusNote}
          </div>
        )}
      </button>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-neutral-800 pt-2.5">
        <button
          className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          type="button"
          onClick={onManageRoster}
        >
          <ClipboardList size={14} />
          Roster
        </button>
        <button
          className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 text-xs font-semibold text-neutral-200 transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500"
          type="button"
          onClick={onOpenResult}
        >
          <Trophy size={14} />
          {option.status === "Final" || option.status === "Suspended" || option.status === "Cancelled" ? "Edit result" : "Result"}
        </button>
        <button className="flex h-9 items-center justify-center gap-1 rounded-lg bg-amber-300 text-xs font-semibold text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300" type="button" onClick={() => onActivate(statsMode, option.id)}>Open stats <ChevronRight size={14} /></button>
      </div>
      <p role="status" className={cn("mt-2 min-h-4 truncate text-xs", pending ? "text-amber-300" : "text-neutral-500")} title={saveFeedback}>{pending ? "Saved on device · waiting for Odoo" : saveFeedback || ""}</p>
    </article>
  );
}

function GameTeamLine({
  accentColor,
  color,
  label,
  logoUrl,
  name,
  score,
  team,
  textColor,
}: {
  accentColor?: string;
  color?: string;
  label: string;
  logoUrl?: string;
  name: string;
  score: number;
  team: TeamId;
  textColor?: string;
}) {
  const identity = { accentColor, color, logoUrl, name, textColor };
  return (
    <div
      className="grid grid-cols-[32px_44px_minmax(0,1fr)_36px] items-center gap-2 rounded-lg border border-neutral-800 px-2 py-1.5"
      style={{
        backgroundColor: `var(--c-${team}-tint)`,
        borderColor: `var(--c-${team}-ring)`,
      }}
    >
      <ClubLogo compact side={team} team={identity} />
      <span className="text-xs font-semibold" style={{ color: `var(--c-${team}-soft)` }}>
        {label}
      </span>
      <span className="truncate text-sm font-semibold text-neutral-200">{name}</span>
      <span className="text-right font-mono text-base font-bold tabular-nums text-neutral-50">{score}</span>
    </div>
  );
}

function PeriodSettingsControls({
  settings,
  onChange,
}: {
  settings: PeriodSettings;
  onChange: (settings: Partial<PeriodSettings>) => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 2xl:rounded-md 2xl:p-2">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-neutral-400">
        <Clock3 size={14} />
        Period Setup
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberField
          label="Periods"
          max={8}
          min={1}
          value={settings.periodCount}
          onChange={(value) => onChange({ periodCount: value })}
        />
        <NumberField
          label="Minutes"
          max={20}
          min={1}
          step={0.5}
          value={secondsToMinutes(settings.periodSeconds)}
          onChange={(value) => onChange({ periodSeconds: minutesToSeconds(value) })}
        />
        <NumberField
          label="OT Min"
          max={20}
          min={1}
          step={0.5}
          value={secondsToMinutes(settings.overtimeSeconds)}
          onChange={(value) => onChange({ overtimeSeconds: minutesToSeconds(value) })}
        />
      </div>
    </div>
  );
}

function NumberField({
  label,
  max,
  min,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  max: number;
  min: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-neutral-500">{label}</span>
      <input
        className="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2 text-center text-base font-bold text-neutral-100 outline-none tabular-nums focus:ring-2 focus:ring-neutral-500 2xl:h-8 2xl:rounded-md 2xl:text-sm"
        max={max}
        min={min}
        step={step}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

// Default away/home identity colors. When a team has no club color these keep the app
// looking exactly as before (red = away, blue = home).
const AWAY_FALLBACK = { base: "#ef4444", soft: "#fca5a5" } as const;
const HOME_FALLBACK = { base: "#3b82f6", soft: "#93c5fd" } as const;

function parseHexColor(hex: string) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  const int = Number.parseInt(full, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function lightenHex(hex: string, amount: number) {
  const { r, g, b } = parseHexColor(hex);
  const lift = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return `rgb(${lift(r)}, ${lift(g)}, ${lift(b)})`;
}

function hexToRgba(hex: string, alpha: number) {
  const { r, g, b } = parseHexColor(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// The court rim label sits on a near-black (#0a0a0a) box. A club "Color de Letra" can
// itself be black / very dark — it is meant to sit on the shirt color, not on the court —
// which made the team name unreadable there (black on black). Lighten any too-dark color
// toward white (keeping its hue) so it stays legible on the dark box.
function readableOnDark(hex: string): string {
  const { r, g, b } = parseHexColor(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance >= 0.5) {
    return hex;
  }
  return lightenHex(hex, Math.min(0.78, 0.55 + (0.5 - luminance)));
}

function teamPalette(color: string | undefined, fallback: { base: string; soft: string }) {
  const base = color ?? fallback.base;
  const soft = color ? lightenHex(color, 0.42) : fallback.soft;
  return { base, soft, tint: hexToRgba(base, 0.1), ring: hexToRgba(base, 0.36) };
}

// Exposes each side's identity color as CSS variables so descendants (score header,
// court labels, rosters, event feed) can reference var(--c-away) / var(--c-home) instead
// of hard-coded red/blue. Falls back to the original palette when no club color is set.
function teamColorVars(away: GameResolutionTeam, home: GameResolutionTeam): CSSProperties {
  const a = teamPalette(away.color, AWAY_FALLBACK);
  const h = teamPalette(home.color, HOME_FALLBACK);
  return {
    "--c-away": a.base,
    "--c-away-soft": a.soft,
    "--c-away-tint": a.tint,
    "--c-away-ring": a.ring,
    "--c-away-accent": away.accentColor ?? a.base,
    "--c-away-letter": away.textColor ?? "#ffffff",
    "--c-home": h.base,
    "--c-home-soft": h.soft,
    "--c-home-tint": h.tint,
    "--c-home-ring": h.ring,
    "--c-home-accent": home.accentColor ?? h.base,
    "--c-home-letter": home.textColor ?? "#ffffff",
  } as CSSProperties;
}

function matchOptionColorVars(option: MatchOption): CSSProperties {
  return teamColorVars(
    {
      ...fallbackMatch.away,
      accentColor: option.awayAccentColor,
      color: option.awayColor,
      logoUrl: option.awayLogoUrl,
      name: option.awayName,
      textColor: option.awayTextColor,
    },
    {
      ...fallbackMatch.home,
      accentColor: option.homeAccentColor,
      color: option.homeColor,
      logoUrl: option.homeLogoUrl,
      name: option.homeName,
      textColor: option.homeTextColor,
    },
  );
}

function matchOptionTeamIdentity(option: MatchOption, side: TeamId): GameResolutionTeam {
  return side === "away"
    ? {
        accentColor: option.awayAccentColor,
        color: option.awayColor,
        logoUrl: option.awayLogoUrl,
        name: option.awayName,
        textColor: option.awayTextColor,
      }
    : {
        accentColor: option.homeAccentColor,
        color: option.homeColor,
        logoUrl: option.homeLogoUrl,
        name: option.homeName,
        textColor: option.homeTextColor,
      };
}

type ClubIdentityVisual = Pick<Team, "accentColor" | "color" | "logoUrl" | "name" | "textColor">;

function ClubLogo({
  compact = false,
  side,
  team,
}: {
  compact?: boolean;
  side: TeamId;
  team: ClubIdentityVisual;
}) {
  const initial = team.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border font-black shadow-sm",
        compact ? "size-8 text-xs" : "size-12 text-lg 2xl:size-10 2xl:text-base",
      )}
      style={{
        backgroundColor: team.logoUrl ? "#fafafa" : `var(--c-${side})`,
        borderColor: `var(--c-${side}-ring)`,
        color: `var(--c-${side}-letter)`,
      }}
      title={`${team.name} club`}
    >
      {team.logoUrl ? (
        <img
          alt={`${team.name} club logo`}
          className="size-full object-contain p-0.5"
          decoding="async"
          src={team.logoUrl}
        />
      ) : (
        <span aria-hidden>{initial}</span>
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1"
        style={{ backgroundColor: team.accentColor ?? `var(--c-${side}-accent)` }}
      />
    </span>
  );
}

function ScoreHeader({
  away,
  awayScore,
  clock,
  equalizationApplied,
  equalizationPoints,
  equalizationTeam,
  foulBallTeam,
  home,
  homeScore,
  matchName,
  periodLabel,
  selectedTeam,
  shotClock,
  statsMode,
  status,
  onBackToDashboard,
  onSelectTeam,
  onToggleFoulBall,
}: {
  away: Team;
  awayScore: number;
  clock: string;
  equalizationApplied?: boolean;
  equalizationPoints?: number;
  equalizationTeam?: TeamId;
  foulBallTeam: TeamId;
  home: Team;
  homeScore: number;
  matchName: string;
  periodLabel: string;
  selectedTeam: TeamId;
  shotClock: number;
  statsMode: StatsMode;
  status: string;
  onBackToDashboard: () => void;
  onSelectTeam: (team: TeamId) => void;
  onToggleFoulBall: () => void;
}) {
  return (
    <header className="order-1 grid items-stretch bg-neutral-950 md:col-span-2 md:grid-cols-[minmax(0,1fr)_minmax(224px,260px)_minmax(0,1fr)] lg:col-span-3 lg:col-start-1 lg:row-start-1 2xl:items-center 2xl:grid-cols-[minmax(0,1fr)_290px_minmax(0,1fr)]">
      <TeamHeaderBlock
        align="right"
        score={awayScore}
        selected={selectedTeam === "away"}
        team={away}
        onClick={() => onSelectTeam("away")}
      />

      <div className="flex flex-col items-center justify-center gap-2 border-y border-neutral-800 px-3 py-3 text-center md:border-x md:border-y-0 lg:gap-1 lg:py-2 2xl:gap-0.5 2xl:py-1">
        <div className="flex w-full items-center justify-between gap-2">
          <button
            aria-label="Back to dashboard"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:size-7 2xl:rounded-md"
            type="button"
            onClick={onBackToDashboard}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-neutral-300">
            <span className="block truncate">{statsMode}</span>
          </div>
          {/* The shot clock is not used in youth games; keep the slot (invisible) so the mode pill stays centered. */}
          <div
            aria-hidden={statsMode === "youth"}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1 2xl:rounded-md",
              statsMode === "youth" && "invisible",
            )}
          >
            <span className="text-[9px] font-black uppercase tracking-wide text-neutral-500">SC</span>
            <span className="font-mono text-sm font-black tabular-nums text-neutral-100">{shotClock}</span>
          </div>
        </div>
        <button
          aria-label="Possession arrow"
          className="flex h-9 w-full min-w-0 items-center justify-center gap-2 rounded-lg border bg-neutral-900 px-2 text-[11px] font-black uppercase tracking-wide transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-amber-500/50 2xl:h-7 2xl:rounded-md"
          style={{ borderColor: `var(--c-${foulBallTeam}-ring)`, color: `var(--c-${foulBallTeam}-soft)` }}
          title="Possession arrow (alternating possession). Tap to flip it — every flip is logged in the event feed."
          type="button"
          onClick={onToggleFoulBall}
        >
          <span className="text-neutral-300">Possession</span>
          <PossessionArrow possession={foulBallTeam} />
          <span>{foulBallTeam === "away" ? "Visitor" : "Home"}</span>
        </button>
        <button className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300" onClick={onBackToDashboard}><span className="truncate">{matchName}</span><span className="shrink-0 text-amber-300">Change game</span></button>
        <div className="mt-0.5 font-mono text-5xl font-black leading-none text-neutral-50 tabular-nums lg:text-4xl 2xl:text-5xl">
          {clock}
        </div>
        <div className="rounded-full bg-amber-400/10 px-3 py-0.5 text-[11px] font-black uppercase tracking-wide text-amber-300">
          {periodLabel}
        </div>
        {equalizationApplied && equalizationPoints ? (
          <div
            className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-300"
            title="Equalization points awarded for uneven attendance"
          >
            EQ +{equalizationPoints} {(equalizationTeam ? (equalizationTeam === "away" ? away : home).label : "")}
          </div>
        ) : null}
        <div className="flex max-w-full items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-neutral-500 lg:hidden">
          <Activity size={12} />
          <span className="truncate">{status}</span>
        </div>
      </div>

      <TeamHeaderBlock
        align="left"
        score={homeScore}
        selected={selectedTeam === "home"}
        team={home}
        onClick={() => onSelectTeam("home")}
      />
    </header>
  );
}

function TeamHeaderBlock({
  align,
  score,
  selected,
  team,
  onClick,
}: {
  align: "left" | "right";
  score: number;
  selected: boolean;
  team: Team;
  onClick: () => void;
}) {
  const side: TeamId = align === "right" ? "away" : "home";
  const cBase = `var(--c-${side})`;
  const cSoft = `var(--c-${side}-soft)`;
  const cTint = `var(--c-${side}-tint)`;
  const cRing = `var(--c-${side}-ring)`;

  return (
    <button
      className={cn(
        "relative flex items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-neutral-900/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neutral-500 sm:gap-4 sm:px-4 lg:py-2 2xl:py-1.5",
        align === "right" ? "justify-start sm:justify-end sm:text-right" : "justify-start",
      )}
      style={selected ? { backgroundColor: cTint, boxShadow: `inset 0 0 0 1px ${cRing}` } : undefined}
      type="button"
      onClick={onClick}
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: cBase }} />
      {align === "right" && (
        <div className="hidden sm:block">
          <ScoreNumber value={score} />
        </div>
      )}
      <ClubLogo side={side} team={team} />
      <div className={cn("min-w-0 max-w-52", align === "right" && "sm:flex sm:flex-col sm:items-end")}>
        <div className="text-[11px] font-black uppercase tracking-wide" style={{ color: cSoft }}>{team.label}</div>
        <div className="mt-0.5 max-w-full truncate text-xl font-bold text-neutral-50 sm:text-2xl lg:text-xl">{team.name}</div>
        {team.clubName && team.clubName !== team.name && (
          <div className="mt-0.5 max-w-full truncate text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            {team.clubName}
          </div>
        )}
        {team.record && <div className="mt-0.5 text-xs font-semibold text-neutral-500 tabular-nums lg:hidden">{team.record}</div>}
        {/* Fouls and time-outs are kept as two clearly-labelled, separated groups so the numbers
            can't be mis-read as a single "3 to 2". The 7th team foul triggers the bonus (6 balls). */}
        <div className={cn("mt-2 flex flex-col gap-1 lg:mt-1", align === "right" && "sm:items-end")}>
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-wide text-neutral-500">Fouls</span>
            <span className="flex gap-0.5">
              {[0, 1, 2, 3, 4, 5].map((dot) => (
                <span
                  className={cn("size-1.5 rounded-full transition-colors", dot < team.fouls ? "" : "bg-neutral-700")}
                  style={dot < team.fouls ? { backgroundColor: cBase } : undefined}
                  key={dot}
                />
              ))}
            </span>
            <span className="font-mono text-sm font-black tabular-nums text-neutral-100 2xl:text-base">{team.fouls}</span>
            {team.fouls >= 7 && (
              <span className="rounded-full border border-amber-500/60 bg-amber-500/15 px-1.5 py-px text-[9px] font-black uppercase tracking-wide text-amber-300">
                Bonus
              </span>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-wide text-neutral-500">Timeouts</span>
            <span className="font-mono text-sm font-black tabular-nums text-neutral-100 2xl:text-base">{team.timeouts}</span>
          </span>
        </div>
      </div>
      {align === "left" && <ScoreNumber value={score} />}
      {align === "right" && (
        <div className="sm:hidden">
          <ScoreNumber value={score} />
        </div>
      )}
    </button>
  );
}

function ScoreNumber({ value }: { value: number }) {
  return (
    <span className="font-mono text-5xl font-black leading-none text-neutral-100 tabular-nums lg:text-5xl">
      {value}
    </span>
  );
}

function PossessionArrow({ possession }: { possession: TeamId }) {
  return (
    <span
      aria-label={`${possession} ball`}
      className={cn(
        "inline-block h-0 w-0 border-y-[5px] border-y-transparent",
        possession === "away"
          ? "border-r-[9px] border-r-red-500"
          : "border-l-[9px] border-l-blue-400",
      )}
      role="img"
    />
  );
}

function CourtPanel({
  courtSides,
  currentPlayer,
  events,
  foulOnShot,
  selectedTeam,
  onCourtShot,
  onSelectPlayer,
  onSwitchCourtSides,
  teams,
}: {
  courtSides: CourtSides;
  currentPlayer?: Player;
  events: GameEvent[];
  foulOnShot: boolean;
  selectedTeam: TeamId;
  onCourtShot: (location: ShotLocation, made: boolean, player: Player) => void;
  onSelectPlayer: (team: TeamId, player: Player) => void;
  onSwitchCourtSides: () => void;
  teams: Record<TeamId, Team>;
}) {
  const [pendingShot, setPendingShot] = useState<ShotLocation | undefined>(undefined);
  // The result (event) is chosen first, then the player. undefined = still on the event step.
  const [pendingMade, setPendingMade] = useState<boolean | undefined>(undefined);
  const markers = events.filter((event) => event.shotLocation).slice(0, 8);
  const pendingTeamId = pendingShot ? courtSides[pendingShot.side] : undefined;
  const pendingTeam = pendingTeamId ? teams[pendingTeamId] : undefined;
  // Open the popup on the OPPOSITE side from the tap so it never covers the spot you marked.
  const popupSideClass = pendingShot?.side === "right" ? "left-3" : "right-3";

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    const location = svgPointToShotLocation(event);
    if (location) {
      // Tapping a side drops the shot marker and opens the result → player popup.
      setPendingShot(location);
      setPendingMade(undefined);
    }
  }

  function chooseResult(made: boolean) {
    setPendingMade(made);
  }

  function pickShooter(player: Player) {
    if (!pendingShot || !pendingTeamId || pendingMade === undefined) {
      return;
    }

    // Keep the visible "Selected" indicator in sync, then commit with the explicit shooter
    // (passing the player avoids waiting a render for selection state to settle).
    onSelectPlayer(pendingTeamId, player);
    onCourtShot(pendingShot, pendingMade, player);
    setPendingShot(undefined);
    setPendingMade(undefined);
  }

  function cancelPendingShot() {
    setPendingShot(undefined);
    setPendingMade(undefined);
  }

  function renderCourtSideLabel(side: CourtSide) {
    const teamId = courtSides[side];
    const isSelectedSide = teamId === selectedTeam;
    const isLeft = side === "left";
    const boxX = isLeft ? 48 : 600;
    const textX = isLeft ? 56 : 704;
    const textAnchor = isLeft ? "start" : "end";
    const teamName = teams[teamId].name.toUpperCase();
    const displayName = teamName.length > 15 ? `${teamName.slice(0, 12)}...` : teamName;
    const fallback = teamId === "away" ? AWAY_FALLBACK : HOME_FALLBACK;
    const teamColor = teams[teamId].color;
    const accentColor = teamColor ?? fallback.base;
    const letterColor = teams[teamId].textColor;
    const textColor = letterColor
      ? readableOnDark(letterColor)
      : teamColor
        ? lightenHex(teamColor, 0.42)
        : fallback.soft;

    return (
      <g pointerEvents="none">
        <rect
          fill="#0a0a0a"
          fillOpacity="0.94"
          height="28"
          rx="4"
          stroke={isSelectedSide ? "#fafafa" : accentColor}
          strokeOpacity={isSelectedSide ? "0.95" : "0.72"}
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
          width="112"
          x={boxX}
          y="404"
        />
        <text
          fill="#737373"
          fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
          fontSize="8"
          fontWeight="900"
          letterSpacing="0.3"
          textAnchor={textAnchor}
          x={textX}
          y="415"
        >
          {isLeft ? "LEFT RIM" : "RIGHT RIM"}
        </text>
        <text
          fill={textColor}
          fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
          fontSize="11"
          fontWeight="900"
          textAnchor={textAnchor}
          x={textX}
          y="428"
        >
          {displayName}
        </text>
      </g>
    );
  }

  return (
    <section className="relative order-2 self-stretch overflow-hidden bg-neutral-950 md:col-span-2 lg:col-span-1 lg:col-start-2 lg:row-start-2 lg:min-h-0">
      <div className="absolute left-3 top-3 z-10 rounded-xl border border-neutral-800 bg-neutral-950/85 px-3 py-2 shadow-lg shadow-black/40 backdrop-blur">
        <div className="text-[10px] font-black uppercase tracking-wide text-neutral-500">Selected</div>
        <div className="mt-0.5 max-w-[200px] truncate font-mono text-sm font-bold tabular-nums text-neutral-50">
          {currentPlayer ? `#${currentPlayer.number}` : "Tap a side"}
        </div>
      </div>
      <button
        aria-label="Switch court sides"
        className="absolute right-3 top-3 z-10 flex h-10 items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950/85 px-3 text-xs font-black uppercase tracking-wide text-neutral-300 shadow-lg shadow-black/40 backdrop-blur transition-colors hover:bg-neutral-900 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-50 lg:h-9"
        type="button"
        onClick={onSwitchCourtSides}
      >
        <Shuffle size={16} />
        <span className="hidden sm:inline">Switch Courts</span>
      </button>
      {pendingShot && pendingTeam && pendingTeamId && (
        <div
          className={cn(
            "absolute top-16 z-20 flex max-h-[calc(100%-5rem)] w-[270px] max-w-[calc(100%-1.5rem)] flex-col overflow-y-auto scrollbar-slim rounded-xl border border-neutral-700 bg-neutral-950/95 p-3 shadow-2xl shadow-black/50 backdrop-blur",
            popupSideClass,
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-wide text-neutral-500">
                {pendingMade === undefined ? "Choose result" : "Pick number"}
              </div>
              <div className="mt-0.5 truncate text-base font-black text-neutral-50">
                {pendingShot.value}PT {pendingShot.zone}
              </div>
            </div>
            <div
              className="rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide"
              style={{
                borderColor: `var(--c-${pendingTeamId}-ring)`,
                backgroundColor: `var(--c-${pendingTeamId}-tint)`,
                color: `var(--c-${pendingTeamId}-soft)`,
              }}
            >
              {pendingTeam.name}
            </div>
          </div>

          {pendingMade === undefined ? (
            /* Step 1 — choose the event (made or missed) before picking the player. */
            <div className="mt-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="flex h-14 flex-col items-center justify-center gap-1 rounded-lg border border-lime-500/50 bg-lime-500/15 text-xs font-black uppercase text-lime-200 transition-colors hover:bg-lime-500/25 focus:outline-none focus:ring-2 focus:ring-lime-500/50 lg:h-12"
                  type="button"
                  onClick={() => chooseResult(true)}
                >
                  <Target size={18} />
                  Made
                </button>
                <button
                  className="flex h-14 flex-col items-center justify-center gap-1 rounded-lg border border-red-500/50 bg-red-500/15 text-xs font-black uppercase text-red-200 transition-colors hover:bg-red-500/25 focus:outline-none focus:ring-2 focus:ring-red-500/50 lg:h-12"
                  type="button"
                  onClick={() => chooseResult(false)}
                >
                  <CircleX size={18} />
                  Missed
                </button>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500">
                <span className="truncate">Basket: {pendingTeam.name}</span>
                {foulOnShot && <span className="text-amber-400">+ Foul</span>}
              </div>
              <button
                className="mt-2.5 h-9 w-full rounded-lg border border-neutral-800 bg-neutral-900 text-[11px] font-black uppercase tracking-wide text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-7"
                type="button"
                onClick={cancelPendingShot}
              >
                Cancel
              </button>
            </div>
          ) : (
            /* Step 2 — choose the player; tapping a number records the shot. */
            <div className="mt-3">
              <div
                className={cn(
                  "mb-2 flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-black uppercase tracking-wide",
                  pendingMade
                    ? "border-lime-500/40 bg-lime-500/10 text-lime-200"
                    : "border-red-500/40 bg-red-500/10 text-red-200",
                )}
              >
                <span className="flex items-center gap-1.5">
                  {pendingMade ? <Target size={13} /> : <CircleX size={13} />}
                  {pendingMade ? "Made" : "Missed"} · {pendingShot.value}PT
                </span>
                {foulOnShot && <span className="text-amber-400">+ Foul</span>}
              </div>
              {/* Only players currently on court can be assigned a field goal. */}
              <CourtShooterGrid
                accent={pendingTeamId}
                emptyLabel="No players on court."
                label="On court"
                players={pendingTeam.players}
                onPick={pickShooter}
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  className="h-9 rounded-lg border border-neutral-800 bg-neutral-900 text-[11px] font-black uppercase tracking-wide text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-7"
                  type="button"
                  onClick={() => setPendingMade(undefined)}
                >
                  Back
                </button>
                <button
                  className="h-9 rounded-lg border border-neutral-800 bg-neutral-900 text-[11px] font-black uppercase tracking-wide text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-7"
                  type="button"
                  onClick={cancelPendingShot}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <CourtSvg
        aria-label="Tap a side of the court to assign a shot to that team's player"
        className="block h-[320px] w-full cursor-crosshair touch-manipulation select-none md:h-[420px] lg:h-full lg:min-h-0"
        onPointerDown={handlePointerDown}
      >
        {renderCourtSideLabel("left")}
        {renderCourtSideLabel("right")}
        {pendingShot && (
          <g>
            <circle
              cx={pendingShot.x}
              cy={pendingShot.y}
              fill="#fbbf24"
              r="10"
              stroke="#fafafa"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <text
              fill="#050505"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
              fontSize="9"
              fontWeight="900"
              textAnchor="middle"
              x={pendingShot.x}
              y={pendingShot.y + 3}
            >
              ?
            </text>
          </g>
        )}
        {markers.map((event, index) => {
          const marker = event.shotLocation!;
          return (
            <g key={event.id} opacity={index === 0 ? 1 : 0.42}>
              <circle
                cx={marker.x}
                cy={marker.y}
                fill={event.icon === "made" ? "#84cc16" : "#ef4444"}
                r={index === 0 ? 8 : 6}
                stroke="#fafafa"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              <text
                fill="#050505"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                fontSize="9"
                fontWeight="900"
                textAnchor="middle"
                x={marker.x}
                y={marker.y + 3}
              >
                {marker.value}
              </text>
            </g>
          );
        })}
      </CourtSvg>
    </section>
  );
}

function CourtShooterGrid({
  accent,
  className,
  emptyLabel,
  label,
  players,
  onPick,
}: {
  accent: TeamId;
  className?: string;
  emptyLabel?: string;
  label: string;
  players: Player[];
  onPick: (player: Player) => void;
}) {
  const accentStyle: CSSProperties = {
    borderColor: `var(--c-${accent}-ring)`,
    color: `var(--c-${accent}-soft)`,
  };

  return (
    <div className={className}>
      <div className="text-[10px] font-black uppercase tracking-wide text-neutral-500">{label}</div>
      {players.length === 0 ? (
        <div className="mt-1 rounded-lg border border-dashed border-neutral-800 px-2 py-2 text-center text-[11px] font-semibold text-neutral-500">
          {emptyLabel ?? "None."}
        </div>
      ) : (
        <div className="mt-1 grid grid-cols-5 gap-1.5">
          {players.map((player) => (
            <button
              className="flex h-11 items-center justify-center rounded-lg border bg-neutral-900 font-mono text-lg font-black tabular-nums transition-colors hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-9"
              style={accentStyle}
              key={getPlayerKey(player)}
              title={`Assign to #${player.number}`}
              type="button"
              onClick={() => onPick(player)}
            >
              {player.number}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RosterPanel({
  side,
  team,
  selectedPlayerKey,
  selectedTeam,
  onSelectPlayer,
  onSelectTeam,
}: {
  side: TeamId;
  team: Team;
  selectedPlayerKey?: string;
  selectedTeam: boolean;
  onSelectPlayer: (team: TeamId, player: Player) => void;
  onSelectTeam: () => void;
}) {
  const isAway = side === "away";
  const cBase = `var(--c-${side})`;
  const cSoft = `var(--c-${side}-soft)`;
  const starterCount = team.players.length;
  const [benchCollapsed, setBenchCollapsed] = useState(true);

  return (
    <aside
      className={cn(
        "order-3 flex min-h-0 flex-col self-stretch overflow-hidden bg-neutral-950 lg:row-start-2",
        isAway ? "lg:col-start-1" : "order-4 lg:col-start-3",
      )}
    >
      <button
        className={cn(
          "relative flex h-14 items-center gap-3 border-b border-neutral-800 px-3 pl-4 text-left transition-colors hover:bg-neutral-900/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neutral-500 2xl:h-12",
          selectedTeam && "bg-neutral-900",
        )}
        type="button"
        onClick={onSelectTeam}
      >
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1" style={{ backgroundColor: cBase }} />
        <ClubLogo compact side={side} team={team} />
        <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: cSoft }}>{team.label}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-neutral-200">{team.name}</span>
          <span className="block truncate text-[10px] font-semibold text-neutral-500">
            {team.coach ? `Coach · ${team.coach}` : "Coach not set"}
          </span>
        </span>
        <span className="shrink-0 rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[11px] font-black tabular-nums text-neutral-400">
          {starterCount}/5
        </span>
      </button>
      {/* On Court: pinned (all 5 visible) when the bench is collapsed; yields/scrolls only when the bench is open. */}
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900/60 px-4 py-1 text-[10px] font-black uppercase tracking-wide text-neutral-500">
        <span>On Court</span>
        <span className="font-mono tabular-nums text-neutral-400">{starterCount}/5</span>
      </div>
      <div className={cn("overflow-y-auto scrollbar-slim", benchCollapsed ? "shrink-0" : "min-h-0 shrink")}>
        {team.players.length > 0 ? (
          team.players.map((player) => (
            <PlayerRow
              side={side}
              compact
              key={getPlayerKey(player)}
              player={player}
              selected={selectedTeam && selectedPlayerKey === getPlayerKey(player)}
              onClick={() => onSelectPlayer(side, player)}
            />
          ))
        ) : (
          <div className="px-4 py-4 text-center text-[11px] font-semibold text-neutral-500">
            No starters selected.
          </div>
        )}
      </div>
      {/* Bench: tap the header to collapse/expand; expanded it takes the remaining space and scrolls. */}
      <button
        aria-expanded={!benchCollapsed}
        className="flex shrink-0 items-center justify-between gap-2 border-y border-neutral-800 bg-neutral-900/95 px-4 py-1 text-[11px] font-black uppercase tracking-wide text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neutral-500"
        type="button"
        onClick={() => setBenchCollapsed((current) => !current)}
      >
        <span className="flex items-center gap-1.5">
          {benchCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          Bench
        </span>
        <span className="font-mono tabular-nums text-neutral-400">{team.bench.length}</span>
      </button>
      {!benchCollapsed && (
        <div className="min-h-[140px] flex-1 overflow-y-auto scrollbar-slim">
          {team.bench.length > 0 ? (
            team.bench.map((player) => (
              <PlayerRow
                side={side}
                compact
                key={getPlayerKey(player)}
                player={player}
                selected={selectedTeam && selectedPlayerKey === getPlayerKey(player)}
                onClick={() => onSelectPlayer(side, player)}
              />
            ))
          ) : (
            <div className="px-4 py-4 text-center text-[11px] font-semibold text-neutral-500">
              No bench players.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function PlayerRow({
  player,
  selected,
  compact = false,
  side,
  onClick,
}: {
  player: Player;
  selected: boolean;
  compact?: boolean;
  side: TeamId;
  onClick: () => void;
}) {
  const cBase = `var(--c-${side})`;
  return (
    <div
      className="w-full border-b border-neutral-800 bg-neutral-950 text-neutral-100 transition-colors"
      style={{
        ...(player.active ? { borderLeftWidth: "4px", borderLeftColor: cBase } : null),
        ...(selected ? { backgroundColor: `var(--c-${side}-tint)`, boxShadow: `inset 0 0 0 1px var(--c-${side}-ring)` } : null),
      }}
    >
      <button
        className={cn(
          "grid w-full min-w-0 grid-cols-[44px_1fr_24px] items-center bg-transparent pr-2 text-left transition-colors hover:bg-neutral-900/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neutral-500",
          compact ? "h-12 2xl:h-10" : "h-16 2xl:h-12",
        )}
        title={player.name}
        type="button"
        onClick={onClick}
      >
        <div className={cn("pl-2.5 font-mono text-2xl font-black tabular-nums 2xl:text-xl", player.active ? "text-neutral-50" : "text-neutral-400")}>
          {player.number}
        </div>
        <div className="min-w-0">
          {/* Fouls first (fouling out matters most during play), then points. Numbers only. */}
          <div className="flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-neutral-500 tabular-nums">
            <span className={cn(player.fouls >= 5 ? "text-red-400" : player.fouls >= 4 ? "text-amber-400" : "text-neutral-300")}>{player.fouls}</span>
            <span>F</span>
            <span className="text-neutral-700">·</span>
            <span className="text-neutral-300">{player.points}</span>
            <span>PTS</span>
          </div>
        </div>
        <div className="flex items-center justify-center">
          {selected ? (
            <span className="flex size-5 items-center justify-center rounded-full" style={{ backgroundColor: cBase }}>
              <Check className="text-white" size={13} />
            </span>
          ) : (
            <span className={cn("size-2.5 rounded-full", player.active ? "" : "bg-neutral-700")} style={player.active ? { backgroundColor: cBase } : undefined} />
          )}
        </div>
      </button>
    </div>
  );
}

function SubstitutionDialog({
  period,
  side,
  team,
  onApply,
  onClose,
}: {
  period: number;
  side: TeamId;
  team: Team;
  onApply: (nextKeys: string[], reason?: string) => void;
  onClose: () => void;
}) {
  const cBase = `var(--c-${side})`;
  const cSoft = `var(--c-${side}-soft)`;
  const roster = useMemo(() => getRoster(team), [team]);
  const onCourtKeys = useMemo(() => team.players.map(getPlayerKey), [team]);
  const onCourtSet = useMemo(() => new Set(onCourtKeys), [onCourtKeys]);
  // Eligible = present players, plus anyone already on the floor (so they can still be taken
  // out even if flagged absent). Jersey numbers only — names live in the attendance dialog.
  const eligible = useMemo(
    () => roster.filter((player) => player.present !== false || onCourtSet.has(getPlayerKey(player))),
    [roster, onCourtSet],
  );
  const numberByKey = useMemo(
    () => new Map(roster.map((player) => [getPlayerKey(player), player.number])),
    [roster],
  );
  const targetCount = Math.min(5, eligible.length);
  // Start with the floor EMPTY — the coach picks the five from scratch each time, and the
  // "On" badges still show who is currently out there for reference.
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [reason, setReason] = useState("");

  const selectedSet = new Set(selectedKeys);
  const atCapacity = selectedKeys.length >= targetCount;
  const incoming = selectedKeys.filter((key) => !onCourtSet.has(key));
  const outgoing = onCourtKeys.filter((key) => !selectedSet.has(key));
  const changed = incoming.length > 0 || outgoing.length > 0;
  // A sub during the 1st quarter must record a reason; later quarters keep it optional.
  const reasonRequired = period === 1;
  const reasonOk = !reasonRequired || reason.trim().length > 0;
  const lineupReady = selectedKeys.length === targetCount && changed && incoming.length === outgoing.length;
  const canApply = lineupReady && reasonOk;
  const dirty = selectedKeys.length > 0 || reason.trim().length > 0;

  function toggle(key: string) {
    setSelectedKeys((current) => {
      if (current.includes(key)) {
        return current.filter((value) => value !== key);
      }
      if (current.length >= targetCount) {
        return current;
      }
      return [...current, key];
    });
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: cBase }} />
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: cSoft }}>
                Substitution · {team.label}
              </div>
              <h2 className="truncate text-lg font-black text-neutral-50">{team.name}</h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 font-mono text-sm font-black tabular-nums",
                selectedKeys.length === targetCount
                  ? "border-lime-500/50 bg-lime-500/10 text-lime-200"
                  : "border-neutral-700 bg-neutral-950 text-neutral-300",
              )}
            >
              {selectedKeys.length}/{targetCount}
            </span>
            <button
              aria-label="Close substitution"
              className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
              type="button"
              onClick={onClose}
            >
              <CircleX size={18} />
            </button>
          </div>
        </div>

        <div className="border-b border-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-400">
          Tap to pick the five on the floor — we work out who comes in and who goes out.
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim p-3">
          {eligible.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm font-semibold text-neutral-500">
              No present players. Mark attendance in the pre-game dialog first.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {eligible.map((player) => {
                const key = getPlayerKey(player);
                const selected = selectedSet.has(key);
                const wasOnCourt = onCourtSet.has(key);
                const lockedOut = !selected && atCapacity;
                return (
                  <button
                    aria-pressed={selected}
                    className={cn(
                      "relative flex flex-col items-center justify-center gap-0.5 rounded-xl border bg-neutral-950 px-2 py-3 transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500",
                      selected
                        ? "border-lime-500/60 bg-lime-500/10"
                        : "border-neutral-800 hover:bg-neutral-800",
                      lockedOut && "cursor-not-allowed opacity-40 hover:bg-neutral-950",
                    )}
                    disabled={lockedOut}
                    key={key}
                    title={lockedOut ? "Deselect one player first" : undefined}
                    type="button"
                    onClick={() => toggle(key)}
                  >
                    {wasOnCourt && (
                      <span
                        className="absolute left-1.5 top-1.5 rounded px-1 py-0.5 text-[8px] font-black uppercase leading-none tracking-wide"
                        style={{ backgroundColor: `var(--c-${side}-tint)`, color: cSoft }}
                      >
                        On
                      </span>
                    )}
                    <span
                      className={cn(
                        "absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full transition-opacity",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                      style={{ backgroundColor: "#84cc16" }}
                    >
                      <Check className="text-neutral-950" size={11} />
                    </span>
                    <span className="font-mono text-2xl font-black tabular-nums text-neutral-50">{player.number}</span>
                    <span className="text-[10px] font-black uppercase tracking-wide text-neutral-500 tabular-nums">
                      <span className="text-neutral-300">{player.points}</span> pt ·{" "}
                      <span className={cn(player.fouls >= 4 ? "text-amber-400" : "text-neutral-300")}>{player.fouls}</span> f
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid gap-px border-t border-neutral-800 bg-neutral-800 sm:grid-cols-2">
          <LineupDiffStrip
            accent="lime"
            label="Coming in"
            numbers={incoming.map((key) => numberByKey.get(key) ?? "?")}
          />
          <LineupDiffStrip
            accent="red"
            label="Going out"
            numbers={outgoing.map((key) => numberByKey.get(key) ?? "?")}
          />
        </div>

        <div className="border-t border-neutral-800 px-4 py-3">
          <label className="mb-1.5 flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-neutral-400" htmlFor="sub-reason">
            Reason / note
            {reasonRequired ? (
              <span className="text-amber-400">· required in Q1</span>
            ) : (
              <span className="text-neutral-600">· optional</span>
            )}
          </label>
          <input
            className={cn(
              "h-10 w-full rounded-lg border bg-neutral-950 px-3 text-sm font-semibold text-neutral-100 outline-none transition-colors focus:ring-2",
              reasonRequired && !reasonOk
                ? "border-amber-500/60 focus:ring-amber-500/50"
                : "border-neutral-800 focus:ring-neutral-500",
            )}
            id="sub-reason"
            placeholder={reasonRequired ? "Why the change? (required this quarter)" : "Optional note — e.g. foul trouble, rest, tactical"}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SUB_REASON_PRESETS.map((preset) => (
              <button
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500",
                  reason === preset
                    ? "border-lime-500/50 bg-lime-500/10 text-lime-200"
                    : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100",
                )}
                key={preset}
                type="button"
                onClick={() => setReason(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3">
          <button
            className="text-xs font-black uppercase tracking-wide text-neutral-500 transition-colors hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!dirty}
            type="button"
            onClick={() => {
              setSelectedKeys([]);
              setReason("");
            }}
          >
            Clear
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 px-4 text-xs font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="flex h-10 items-center gap-2 rounded-lg border border-lime-500/40 bg-lime-500/15 px-4 text-xs font-black uppercase tracking-wide text-lime-200 transition-colors hover:bg-lime-500/25 focus:outline-none focus:ring-2 focus:ring-lime-500/50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canApply}
              title={lineupReady && !reasonOk ? "Add a reason — required in the 1st quarter" : undefined}
              type="button"
              onClick={() => onApply(selectedKeys, reason)}
            >
              <Shuffle size={16} />
              {incoming.length > 1 ? `Apply (${incoming.length})` : "Apply Lineup"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LineupDiffStrip({
  accent,
  label,
  numbers,
}: {
  accent: "lime" | "red";
  label: string;
  numbers: string[];
}) {
  const chipClass =
    accent === "lime"
      ? "border-lime-500/50 bg-lime-500/10 text-lime-200"
      : "border-red-500/50 bg-red-500/10 text-red-200";
  const dotClass = accent === "lime" ? "text-lime-400" : "text-red-400";

  return (
    <div className="flex items-center gap-2 bg-neutral-900 px-4 py-2.5">
      <span className={cn("text-[10px] font-black uppercase tracking-wide", dotClass)}>{label}</span>
      <div className="flex min-h-[26px] flex-1 flex-wrap items-center gap-1.5">
        {numbers.length === 0 ? (
          <span className="text-xs font-semibold text-neutral-600">—</span>
        ) : (
          numbers.map((number, index) => (
            <span
              className={cn("rounded-md border px-2 py-0.5 font-mono text-sm font-black tabular-nums", chipClass)}
              key={`${number}-${index}`}
            >
              #{number}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

const WARNING_TARGET_LABEL: Record<WarningTarget, string> = {
  team: "Equipo",
  player: "Jugador",
  coach: "Coach",
  public: "Público",
};

const WARNING_TARGET_CLASS: Record<WarningTarget, string> = {
  team: "border-neutral-700 text-neutral-300",
  player: "border-sky-500/50 text-sky-300",
  coach: "border-amber-500/50 text-amber-300",
  public: "border-violet-500/50 text-violet-300",
};

function WarningDialog({
  side,
  team,
  onSelect,
  onClose,
}: {
  side: TeamId;
  team: Team;
  onSelect: (type: WarningType) => void;
  onClose: () => void;
}) {
  const cBase = `var(--c-${side})`;
  const cSoft = `var(--c-${side}-soft)`;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <TriangleAlert className="shrink-0 text-amber-300" size={20} />
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: cSoft }}>
                Referee Warning · {team.label}
              </div>
              <h2 className="truncate text-lg font-black text-neutral-50">{team.name}</h2>
            </div>
          </div>
          <button
            aria-label="Close warnings"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            <CircleX size={18} />
          </button>
        </div>

        <div className="border-b border-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-400">
          Pick the warning type — logged against {team.name} as a referee warning. No foul, no score change.
        </div>

        <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto scrollbar-slim p-3 sm:grid-cols-2">
          {WARNING_TYPES.map((type) => (
            <button
              className="flex flex-col items-start gap-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-left transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              key={type.key}
              type="button"
              onClick={() => onSelect(type)}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-black text-neutral-100">{type.label}</span>
                <span
                  className={cn(
                    "shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide",
                    WARNING_TARGET_CLASS[type.target],
                  )}
                >
                  {WARNING_TARGET_LABEL[type.target]}
                </span>
              </span>
              <span className="text-[11px] font-semibold text-neutral-500">{type.hint}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3">
          <span aria-hidden className="h-1.5 w-10 rounded-full" style={{ backgroundColor: cBase }} />
          <button
            className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 px-4 text-xs font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function GameResolutionDialog({
  away,
  home,
  awayScore,
  homeScore,
  initialNote,
  initialStatus,
  isOnline,
  onFinish,
  onClose,
}: {
  away: GameResolutionTeam;
  home: GameResolutionTeam;
  awayScore: number;
  homeScore: number;
  initialNote?: string;
  initialStatus?: string;
  isOnline: boolean;
  onFinish: (result: GameResolutionInput) => void;
  onClose: () => void;
}) {
  const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [status, setStatus] = useState<GameResolutionStatus>(
    initialStatus === "Suspended" || initialStatus === "Cancelled" ? initialStatus : "Final",
  );
  const [awayValue, setAwayValue] = useState(String(awayScore));
  const [homeValue, setHomeValue] = useState(String(homeScore));
  const [note, setNote] = useState(initialNote ?? "");
  const parsedAwayScore = parseResolutionScore(awayValue);
  const parsedHomeScore = parseResolutionScore(homeValue);
  const noteText = note.trim();
  const awayError = parsedAwayScore === undefined ? "Enter a score from 0 to 999." : undefined;
  const homeError = parsedHomeScore === undefined ? "Enter a score from 0 to 999." : undefined;
  const noteError = status !== "Final" && noteText.length === 0
    ? `Explain why the game is ${status.toLowerCase()}.`
    : undefined;
  const canSubmit = !awayError && !homeError && !noteError;
  const winner =
    parsedHomeScore === undefined || parsedAwayScore === undefined
      ? "Enter the official score"
      : parsedHomeScore === parsedAwayScore
      ? "Tie game"
      : parsedHomeScore > parsedAwayScore
        ? `${home.name} win`
        : `${away.name} win`;

  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/75" />
        <AlertDialog.Content
          onCloseAutoFocus={event => { event.preventDefault(); if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true }); }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 text-neutral-100 shadow-2xl [font-family:Inter,ui-sans-serif,system-ui,sans-serif]"
          style={teamColorVars(away, home)}
        >
          <div className="flex items-start justify-between gap-3 border-b border-neutral-800 px-4 py-3">
            <div className="min-w-0">
              <AlertDialog.Title className="text-base font-semibold text-balance text-neutral-50">
                Record game result
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-0.5 text-sm text-pretty text-neutral-500">
                Enter the score, or suspend or cancel the game with a reason.
              </AlertDialog.Description>
            </div>
            <AlertDialog.Cancel asChild>
              <button
                aria-label="Close game result"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
                type="button"
              >
                <CircleX size={18} />
              </button>
            </AlertDialog.Cancel>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-slim">
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-1" role="group" aria-label="Game result status">
              <button
                aria-pressed={status === "Final"}
                className={cn(
                  "flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400/60",
                  status === "Final"
                    ? "bg-amber-300 text-neutral-950"
                    : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100",
                )}
                type="button"
                onClick={() => setStatus("Final")}
              >
                <Trophy size={16} />
                Final result
              </button>
              <button
                aria-pressed={status === "Suspended"}
                className={cn(
                  "flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400/60",
                  status === "Suspended"
                    ? "bg-amber-300 text-neutral-950"
                    : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100",
                )}
                type="button"
                onClick={() => setStatus("Suspended")}
              >
                <Pause size={16} />
                Suspended
              </button>
              <button
                aria-pressed={status === "Cancelled"}
                className={cn("flex h-11 items-center justify-center rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400/60", status === "Cancelled" ? "bg-amber-300 text-neutral-950" : "text-neutral-400 hover:bg-neutral-800")}
                type="button"
                onClick={() => setStatus("Cancelled")}
              >Cancelled</button>
            </div>

            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] items-start gap-2">
              <ResolutionScoreField
                error={awayError}
                label="Visitor"
                side="away"
                team={away}
                value={awayValue}
                onChange={setAwayValue}
              />
              <div className="pt-16 text-center text-xl font-semibold text-neutral-600">–</div>
              <ResolutionScoreField
                error={homeError}
                label="Home"
                side="home"
                team={home}
                value={homeValue}
                onChange={setHomeValue}
              />
            </div>
            <div className="mt-2 text-center text-sm font-semibold text-neutral-300">{status === "Final" ? winner : "No winner recorded"}</div>

            {status !== "Final" && (
              <div className="mt-4 border-t border-neutral-800 pt-4">
                <label className="flex items-center justify-between gap-2 text-sm font-semibold text-neutral-200" htmlFor="game-resolution-note">
                  <span>Why was it {status.toLowerCase()}?</span>
                  <span className="text-xs font-normal text-neutral-500">Required</span>
                </label>
                <textarea
                  aria-describedby={noteError ? "game-resolution-note-error" : "game-resolution-note-help"}
                  aria-invalid={Boolean(noteError)}
                  className={cn(
                    "mt-2 min-h-24 w-full resize-y rounded-lg border bg-neutral-950 px-3 py-2 text-sm text-pretty text-neutral-100 outline-none transition-colors focus:ring-2",
                    noteError
                      ? "border-red-500/60 focus:ring-red-500/40"
                      : "border-neutral-800 focus:ring-amber-400/50",
                  )}
                  id="game-resolution-note"
                  maxLength={500}
                  placeholder="Example: Power outage; game paused with 3:42 remaining."
                  value={note}
                  onChange={(event) => setNote(event.currentTarget.value)}
                />
                <div className="mt-1 flex items-start justify-between gap-3">
                  {noteError ? (
                    <span className="text-xs text-red-300" id="game-resolution-note-error" role="alert">{noteError}</span>
                  ) : (
                    <span className="text-xs text-pretty text-neutral-500" id="game-resolution-note-help">
                      The reason is saved in Odoo and shown in play-by-play.
                    </span>
                  )}
                  <span className="shrink-0 text-xs tabular-nums text-neutral-600">{note.length}/500</span>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Common reasons">
                  {SUSPENSION_REASON_PRESETS.map((preset) => (
                    <button
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400/50",
                        note === preset
                          ? "border-amber-400/60 bg-amber-400/10 text-amber-200"
                          : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100",
                      )}
                      key={preset}
                      type="button"
                      onClick={() => setNote(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-pretty text-neutral-500">
              {isOnline
                ? "The score, status, and reason are saved automatically when connected."
                : "You are offline. This result will stay on this device and sync automatically when connected."}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-neutral-800 px-4 pt-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
            <AlertDialog.Cancel asChild>
              <button
                className="h-11 rounded-lg border border-neutral-700 bg-neutral-950 px-4 text-sm font-semibold text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
                type="button"
              >
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                className={cn(
                  "flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-40",
                  status === "Final"
                    ? "bg-red-500 text-white hover:bg-red-400 focus:ring-red-500/50"
                    : "bg-amber-300 text-neutral-950 hover:bg-amber-200 focus:ring-amber-400/60",
                )}
                disabled={!canSubmit}
                type="button"
                onClick={() => {
                  if (parsedAwayScore === undefined || parsedHomeScore === undefined || !canSubmit) {
                    return;
                  }
                  onFinish({
                    awayScore: parsedAwayScore,
                    homeScore: parsedHomeScore,
                    note: status !== "Final" ? noteText : "",
                    status,
                  });
                }}
              >
                {status === "Final" ? <Trophy size={16} /> : <Pause size={16} />}
                {status === "Final" ? "Save final result" : status === "Cancelled" ? "Cancel game" : "Suspend game"}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function ResolutionScoreField({
  error,
  label,
  side,
  team,
  value,
  onChange,
}: {
  error?: string;
  label: "Visitor" | "Home";
  side: TeamId;
  team: GameResolutionTeam;
  value: string;
  onChange: (value: string) => void;
}) {
  const errorId = `${side}-resolution-score-error`;
  return (
    <label className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-center">
      <span className="flex min-w-0 items-center justify-center gap-2">
        <ClubLogo compact side={side} team={team} />
        <span className="min-w-0 text-left">
          <span className="block text-xs font-medium text-neutral-500">{label}</span>
          <span className="block truncate text-sm font-semibold text-neutral-100">{team.name}</span>
        </span>
      </span>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        aria-label={`${team.name} official score`}
        className={cn(
          "mt-3 h-14 w-full rounded-lg border bg-neutral-900 px-2 text-center font-mono text-2xl font-bold tabular-nums text-neutral-50 outline-none focus:ring-2",
          error ? "border-red-500/60 focus:ring-red-500/40" : "border-neutral-700 focus:ring-amber-400/50",
        )}
        inputMode="numeric"
        max="999"
        min="0"
        pattern="[0-9]*"
        type="number"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value.replace(/[^0-9]/g, "").slice(0, 3))}
      />
      {error && <span className="mt-1 block text-xs text-red-300" id={errorId} role="alert">{error}</span>}
    </label>
  );
}

function parseResolutionScore(value: string) {
  if (!/^\d{1,3}$/.test(value.trim())) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 999 ? parsed : undefined;
}

function FoulDialog({
  committer,
  committerSide,
  opponent,
  opponentSide,
  onConfirm,
  onClose,
}: {
  committer: Player;
  committerSide: TeamId;
  opponent: Team;
  opponentSide: TeamId;
  onConfirm: (result: { fouledPlayer?: Player; freeThrowsAttempted: number; freeThrowsMade: number }) => void;
  onClose: () => void;
}) {
  const cBase = `var(--c-${committerSide})`;
  const cSoft = `var(--c-${committerSide}-soft)`;
  // Only players currently on court can draw a foul that ends in free throws.
  const roster = opponent.players;
  const [fouledKey, setFouledKey] = useState<string | undefined>(undefined);
  const [ftCount, setFtCount] = useState(0);
  const [ftMade, setFtMade] = useState<boolean[]>([true, true, true]);

  const fouledPlayer = roster.find((player) => getPlayerKey(player) === fouledKey);
  const madeCount = ftMade.slice(0, ftCount).filter(Boolean).length;
  const needsFouled = ftCount > 0;
  const canConfirm = !needsFouled || Boolean(fouledPlayer);

  function toggleFt(index: number, made: boolean) {
    setFtMade((current) => current.map((value, i) => (i === index ? made : value)));
  }

  function confirm() {
    if (!canConfirm) {
      return;
    }
    onConfirm({
      fouledPlayer,
      freeThrowsAttempted: ftCount,
      freeThrowsMade: madeCount,
    });
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: cBase }} />
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: cSoft }}>
                Falta personal
              </div>
              <h2 className="truncate text-lg font-black text-neutral-50">
                Cometida por <span style={{ color: cSoft }}>#{committer.number}</span>
              </h2>
            </div>
          </div>
          <button
            aria-label="Close foul"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            <CircleX size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim p-3">
          {/* Who drew the foul (opponent). Required only when there are free throws. */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-black uppercase tracking-wide text-neutral-400">
              Falta recibida por
            </span>
            <span className="truncate text-[11px] font-bold" style={{ color: `var(--c-${opponentSide}-soft)` }}>
              {opponent.name}
            </span>
          </div>
          {roster.length === 0 ? (
            <div className="mt-2 rounded-lg border border-dashed border-neutral-800 px-2 py-4 text-center text-[11px] font-semibold text-neutral-500">
              No opponent players available.
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {roster.map((player) => {
                const key = getPlayerKey(player);
                const selected = key === fouledKey;
                return (
                  <button
                    aria-pressed={selected}
                    className={cn(
                      "flex h-11 items-center justify-center rounded-lg border font-mono text-lg font-black tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-10",
                      selected
                        ? "border-amber-500/70 bg-amber-500/15 text-amber-100"
                        : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800",
                      player.active ? "" : "opacity-70",
                    )}
                    key={key}
                    title={player.active ? "On court" : "Bench"}
                    type="button"
                    onClick={() => setFouledKey(selected ? undefined : key)}
                  >
                    {player.number}
                  </button>
                );
              })}
            </div>
          )}

          {/* Free throws */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="text-[11px] font-black uppercase tracking-wide text-neutral-400">Tiros libres</span>
            {needsFouled && !fouledPlayer && (
              <span className="text-[10px] font-black uppercase tracking-wide text-amber-400">Elige quién recibió</span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {[0, 1, 2, 3].map((count) => (
              <button
                className={cn(
                  "h-11 rounded-lg border text-sm font-black uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-10",
                  ftCount === count
                    ? "border-lime-500/60 bg-lime-500/15 text-lime-200"
                    : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800",
                )}
                key={count}
                type="button"
                onClick={() => setFtCount(count)}
              >
                {count === 0 ? "Sin TL" : count}
              </button>
            ))}
          </div>

          {ftCount > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-neutral-500">
                <span>{fouledPlayer ? `Tirador #${fouledPlayer.number}` : "Tirador —"}</span>
                <span className="text-neutral-300">{madeCount}/{ftCount} anotados</span>
              </div>
              {Array.from({ length: ftCount }, (_, index) => (
                <div
                  className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5"
                  key={index}
                >
                  <span className="w-12 shrink-0 text-[11px] font-black uppercase tracking-wide text-neutral-500">
                    TL {index + 1}
                  </span>
                  <div className="grid flex-1 grid-cols-2 gap-1.5">
                    <button
                      className={cn(
                        "flex h-9 items-center justify-center gap-1.5 rounded-md border text-[11px] font-black uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-lime-500/50",
                        ftMade[index]
                          ? "border-lime-500/60 bg-lime-500/15 text-lime-200"
                          : "border-neutral-800 bg-neutral-900 text-neutral-400 hover:bg-neutral-800",
                      )}
                      type="button"
                      onClick={() => toggleFt(index, true)}
                    >
                      <Target size={13} />
                      Anotado
                    </button>
                    <button
                      className={cn(
                        "flex h-9 items-center justify-center gap-1.5 rounded-md border text-[11px] font-black uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50",
                        !ftMade[index]
                          ? "border-red-500/60 bg-red-500/15 text-red-200"
                          : "border-neutral-800 bg-neutral-900 text-neutral-400 hover:bg-neutral-800",
                      )}
                      type="button"
                      onClick={() => toggleFt(index, false)}
                    >
                      <CircleX size={13} />
                      Fallado
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3">
          <div className="min-w-0 truncate text-xs font-semibold text-neutral-400">
            {fouledPlayer
              ? `Falta a #${fouledPlayer.number}${ftCount > 0 ? ` · ${madeCount}/${ftCount} TL` : ""}`
              : "Falta sin tiros (o elige quién la recibió)"}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 px-4 text-xs font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="flex h-10 items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/15 px-4 text-xs font-black uppercase tracking-wide text-amber-200 transition-colors hover:bg-amber-500/25 focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canConfirm}
              type="button"
              onClick={confirm}
            >
              <OctagonAlert size={16} />
              Registrar falta
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FreeThrowDialog({
  made,
  teams,
  onClose,
  onPick,
}: {
  made: boolean;
  teams: Record<TeamId, Team>;
  onClose: () => void;
  onPick: (team: TeamId, player: Player) => void;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {made ? <Plus className="shrink-0 text-lime-400" size={20} /> : <CircleX className="shrink-0 text-red-400" size={20} />}
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Tiro libre</div>
              <h2 className={cn("truncate text-lg font-black", made ? "text-lime-200" : "text-red-200")}>
                {made ? "Anotado" : "Fallado"}
              </h2>
            </div>
          </div>
          <button
            aria-label="Close free throw"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            <CircleX size={18} />
          </button>
        </div>

        <div className="border-b border-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-400">
          Elige el tirador — solo jugadores en cancha.
        </div>

        <div className="grid min-h-0 flex-1 gap-px overflow-y-auto scrollbar-slim bg-neutral-800 sm:grid-cols-2">
          {(["away", "home"] as TeamId[]).map((side) => {
            const team = teams[side];
            return (
              <div className="bg-neutral-900 p-3" key={side}>
                <div className="mb-2 flex items-center gap-2">
                  <span aria-hidden className="h-4 w-1 rounded-full" style={{ backgroundColor: `var(--c-${side})` }} />
                  <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: `var(--c-${side}-soft)` }}>
                    {team.label}
                  </span>
                  <span className="min-w-0 truncate text-[11px] font-bold text-neutral-400">{team.name}</span>
                </div>
                <CourtShooterGrid
                  accent={side}
                  emptyLabel="Nadie en cancha."
                  label="En cancha"
                  players={team.players}
                  onPick={(player) => onPick(side, player)}
                />
              </div>
            );
          })}
        </div>

        <div className="flex justify-end border-t border-neutral-800 px-4 py-3">
          <button
            className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 px-4 text-xs font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function TechDialog({
  teams,
  onClose,
  onPlayerTech,
  onAdminTech,
}: {
  teams: Record<TeamId, Team>;
  onClose: () => void;
  onPlayerTech: (team: TeamId, player: Player) => void;
  onAdminTech: (team: TeamId) => void;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Trophy className="shrink-0 text-amber-400" size={20} />
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-400">Falta técnica</div>
              <h2 className="truncate text-lg font-black text-neutral-50">Technical</h2>
            </div>
          </div>
          <button
            aria-label="Close technical"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            <CircleX size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim">
          {/* Player technical — counts as a foul. Pick the on-court player. */}
          <div className="px-4 pb-1 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-wide text-neutral-300">Al jugador</span>
              <span className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-300">
                Cuenta como falta
              </span>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-neutral-500">Técnica a un jugador en cancha — suma falta personal y de equipo.</p>
          </div>
          <div className="grid gap-px bg-neutral-800 sm:grid-cols-2">
            {(["away", "home"] as TeamId[]).map((side) => {
              const team = teams[side];
              return (
                <div className="bg-neutral-900 p-3" key={side}>
                  <div className="mb-2 flex items-center gap-2">
                    <span aria-hidden className="h-4 w-1 rounded-full" style={{ backgroundColor: `var(--c-${side})` }} />
                    <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: `var(--c-${side}-soft)` }}>
                      {team.label}
                    </span>
                    <span className="min-w-0 truncate text-[11px] font-bold text-neutral-400">{team.name}</span>
                  </div>
                  <CourtShooterGrid
                    accent={side}
                    emptyLabel="Nadie en cancha."
                    label="En cancha"
                    players={team.players}
                    onPick={(player) => onPlayerTech(side, player)}
                  />
                </div>
              );
            })}
          </div>

          {/* Administrative technical = toward the coach / bench. Does NOT add a personal foul. */}
          <div className="border-t border-neutral-800 px-4 pb-3 pt-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-wide text-neutral-300">Administrativa · coach y banca</span>
              <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-neutral-400">
                No es falta personal
              </span>
            </div>
            <p className="mb-2 text-[11px] font-semibold text-neutral-500">Técnica al coach o a la banca del equipo.</p>
            <div className="grid grid-cols-2 gap-2">
              {(["away", "home"] as TeamId[]).map((side) => (
                <button
                  className="flex h-11 items-center justify-center gap-2 rounded-lg border bg-neutral-950 text-xs font-black uppercase tracking-wide transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500"
                  key={side}
                  style={{ borderColor: `var(--c-${side}-ring)`, color: `var(--c-${side}-soft)` }}
                  type="button"
                  onClick={() => onAdminTech(side)}
                >
                  {teams[side].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-neutral-800 px-4 py-3">
          <button
            className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 px-4 text-xs font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function EndOfPeriodDialog({
  endedPeriod,
  match,
  periodCount,
  summary,
  onClose,
  onContinue,
}: {
  endedPeriod: number;
  match: LiveMatch;
  periodCount: number;
  summary: Array<{ label: string; value: string }>;
  onClose: () => void;
  onContinue: () => void;
}) {
  const periodKey = getPlayerPeriodKey(endedPeriod);
  const periodPts = (team: Team) =>
    getRoster(team).reduce((total, player) => total + player[periodKey], 0);
  const topScorer = (team: Team) => {
    let best: Player | undefined;
    for (const player of getRoster(team)) {
      if (player[periodKey] > 0 && (!best || player[periodKey] > best[periodKey])) {
        best = player;
      }
    }
    return best;
  };

  const awayPts = periodPts(match.away);
  const homePts = periodPts(match.home);
  const awayTop = topScorer(match.away);
  const homeTop = topScorer(match.home);
  const label = getPeriodLabel(endedPeriod, periodCount);
  const awayLed = awayPts > homePts;
  const homeLed = homePts > awayPts;

  const teamRows: Array<{ side: TeamId; team: Team; pts: number; total: number; top?: Player; led: boolean }> = [
    { side: "away", team: match.away, pts: awayPts, total: match.awayScore, top: awayTop, led: awayLed },
    { side: "home", team: match.home, pts: homePts, total: match.homeScore, top: homeTop, led: homeLed },
  ];

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Clock3 className="shrink-0 text-amber-400" size={20} />
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-400">Fin del periodo</div>
              <h2 className="truncate text-lg font-black text-neutral-50">End of {label}</h2>
            </div>
          </div>
          <button
            aria-label="Close period summary"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            <CircleX size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim p-4">
          {/* Period score — the headline visual feedback. */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-center text-[10px] font-black uppercase tracking-widest text-neutral-500">Puntos del periodo</div>
            <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div className="text-center">
                <div className="truncate text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--c-away-soft)" }}>{match.away.name}</div>
                <div className="font-mono text-5xl font-black tabular-nums" style={{ color: awayLed ? "var(--c-away-soft)" : undefined }}>{awayPts}</div>
              </div>
              <div className="text-2xl font-black text-neutral-600">–</div>
              <div className="text-center">
                <div className="truncate text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--c-home-soft)" }}>{match.home.name}</div>
                <div className="font-mono text-5xl font-black tabular-nums" style={{ color: homeLed ? "var(--c-home-soft)" : undefined }}>{homePts}</div>
              </div>
            </div>
            <div className="mt-2 text-center text-xs font-bold text-neutral-400">
              Total: <span className="font-mono tabular-nums text-neutral-100">{match.awayScore}–{match.homeScore}</span>
            </div>
          </div>

          {/* Per-team breakdown. */}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {teamRows.map((row) => (
              <div
                className="rounded-xl border border-neutral-800 bg-neutral-950 p-3"
                key={row.side}
                style={row.led ? { boxShadow: `inset 0 0 0 1px var(--c-${row.side}-ring)` } : undefined}
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden className="h-4 w-1 rounded-full" style={{ backgroundColor: `var(--c-${row.side})` }} />
                  <span className="min-w-0 truncate text-xs font-black uppercase tracking-wide" style={{ color: `var(--c-${row.side}-soft)` }}>
                    {row.team.name}
                  </span>
                  {row.led && <Crown className="ml-auto text-amber-400" size={14} />}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5 text-center">
                  <EndPeriodStat label="Periodo" value={String(row.pts)} />
                  <EndPeriodStat label="Total" value={String(row.total)} />
                  <EndPeriodStat label="Faltas" value={String(row.team.fouls)} warn={row.team.fouls >= 7} />
                  <EndPeriodStat label="Tiempos" value={String(row.team.timeouts)} />
                </div>
                <div className="mt-2 flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1.5">
                  <span className="text-[10px] font-black uppercase tracking-wide text-neutral-500">Mejor anotador</span>
                  {row.top ? (
                    <span className="font-mono text-sm font-black tabular-nums text-neutral-100">
                      #{row.top.number} · {row.top[periodKey]}
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-neutral-600">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Game summary (same items as the bottom Game Summary panel). */}
          <div className="mt-3 space-y-1.5">
            {summary.map((item) => (
              <div
                className="flex items-center justify-between gap-4 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm"
                key={item.label}
              >
                <span className="text-[11px] font-black uppercase tracking-wide text-neutral-500">{item.label}</span>
                <span className="truncate font-bold text-neutral-100">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-neutral-800 px-4 py-3">
          <button
            className="text-xs font-black uppercase tracking-wide text-neutral-500 transition-colors hover:text-neutral-200"
            type="button"
            onClick={onClose}
          >
            Saltar
          </button>
          <button
            className="flex h-11 items-center gap-2 rounded-lg border border-lime-500/50 bg-lime-500/15 px-5 text-sm font-black uppercase tracking-wide text-lime-100 transition-colors hover:bg-lime-500/25 focus:outline-none focus:ring-2 focus:ring-lime-500/50"
            type="button"
            onClick={onContinue}
          >
            Elegir titulares
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

function EndPeriodStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5">
      <div className={cn("font-mono text-lg font-black tabular-nums", warn ? "text-amber-400" : "text-neutral-100")}>{value}</div>
      <div className="text-[9px] font-black uppercase tracking-wide text-neutral-500">{label}</div>
    </div>
  );
}

// Present players plus anyone already on court (eligible to be on the floor).
function eligiblePlayers(team: Team): Player[] {
  const onCourt = new Set(team.players.map(getPlayerKey));
  return getRoster(team).filter(
    (player) => player.present !== false || onCourt.has(getPlayerKey(player)),
  );
}

function FoulOutDialog({
  player,
  side,
  team,
  onReplace,
  onClose,
}: {
  player: Player;
  side: TeamId;
  team: Team;
  onReplace: (replacement: Player) => void;
  onClose: () => void;
}) {
  const bench = team.bench.filter((candidate) => candidate.present !== false);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-red-700/60 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <OctagonAlert className="shrink-0 text-red-400" size={20} />
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest text-red-400">5 faltas · {team.label}</div>
              <h2 className="truncate text-lg font-black text-neutral-50">
                <span style={{ color: `var(--c-${side}-soft)` }}>#{player.number}</span> debe salir
              </h2>
            </div>
          </div>
          <button
            aria-label="Close foul out"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            <CircleX size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim p-3">
          <div className="mb-2 text-xs font-semibold text-neutral-400">Elige el reemplazo (banca).</div>
          {bench.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-800 px-2 py-6 text-center text-[11px] font-semibold text-neutral-500">
              Sin jugadores en banca.
            </div>
          ) : (
            <CourtShooterGrid
              accent={side}
              label="Banca"
              players={bench}
              onPick={onReplace}
            />
          )}
        </div>

        <div className="flex justify-end border-t border-neutral-800 px-4 py-3">
          <button
            className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 px-4 text-xs font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            Sin cambio
          </button>
        </div>
      </div>
    </div>
  );
}

function PeriodStartersDialog({
  periodLabel,
  teams,
  onApply,
  onClose,
}: {
  periodLabel: string;
  teams: Record<TeamId, Team>;
  onApply: (awayKeys: string[], homeKeys: string[]) => void;
  onClose: () => void;
}) {
  const awayTarget = Math.min(5, eligiblePlayers(teams.away).length);
  const homeTarget = Math.min(5, eligiblePlayers(teams.home).length);
  const [awayKeys, setAwayKeys] = useState<string[]>(() => teams.away.players.map(getPlayerKey));
  const [homeKeys, setHomeKeys] = useState<string[]>(() => teams.home.players.map(getPlayerKey));

  const canApply = awayKeys.length === awayTarget && homeKeys.length === homeTarget;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Users className="shrink-0 text-amber-300" size={20} />
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-300">Titulares · {periodLabel}</div>
              <h2 className="truncate text-lg font-black text-neutral-50">Quién empieza el periodo</h2>
            </div>
          </div>
          <button
            aria-label="Close period starters"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            <CircleX size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-px overflow-y-auto scrollbar-slim bg-neutral-800 sm:grid-cols-2">
          <PeriodStartersColumn side="away" team={teams.away} selectedKeys={awayKeys} target={awayTarget} onChange={setAwayKeys} />
          <PeriodStartersColumn side="home" team={teams.home} selectedKeys={homeKeys} target={homeTarget} onChange={setHomeKeys} />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3">
          <div className="min-w-0 truncate text-xs font-semibold text-neutral-400">
            {canApply ? "Cambios vs. el periodo anterior se registran." : "Elige los titulares de cada equipo."}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 px-4 text-xs font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="flex h-10 items-center gap-2 rounded-lg border border-lime-500/40 bg-lime-500/15 px-4 text-xs font-black uppercase tracking-wide text-lime-200 transition-colors hover:bg-lime-500/25 focus:outline-none focus:ring-2 focus:ring-lime-500/50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canApply}
              type="button"
              onClick={() => onApply(awayKeys, homeKeys)}
            >
              <Check size={16} />
              Confirmar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PeriodStartersColumn({
  side,
  team,
  selectedKeys,
  target,
  onChange,
}: {
  side: TeamId;
  team: Team;
  selectedKeys: string[];
  target: number;
  onChange: (keys: string[]) => void;
}) {
  const cSoft = `var(--c-${side}-soft)`;
  const eligible = eligiblePlayers(team);
  const onCourtSet = new Set(team.players.map(getPlayerKey));
  const selectedSet = new Set(selectedKeys);
  const atCapacity = selectedKeys.length >= target;

  function toggle(key: string) {
    if (selectedSet.has(key)) {
      onChange(selectedKeys.filter((value) => value !== key));
    } else if (selectedKeys.length < target) {
      onChange([...selectedKeys, key]);
    }
  }

  return (
    <div className="bg-neutral-900 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden className="h-4 w-1 rounded-full" style={{ backgroundColor: `var(--c-${side})` }} />
        <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: cSoft }}>{team.label}</span>
        <span className="min-w-0 truncate text-[11px] font-bold text-neutral-400">{team.name}</span>
        <span
          className={cn(
            "ml-auto rounded-full border px-2 py-0.5 font-mono text-[11px] font-black tabular-nums",
            selectedKeys.length === target
              ? "border-lime-500/50 bg-lime-500/10 text-lime-200"
              : "border-neutral-700 bg-neutral-950 text-neutral-300",
          )}
        >
          {selectedKeys.length}/{target}
        </span>
      </div>
      {eligible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-800 px-2 py-6 text-center text-[11px] font-semibold text-neutral-500">
          Nadie disponible.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {eligible.map((player) => {
            const key = getPlayerKey(player);
            const selected = selectedSet.has(key);
            const wasOnCourt = onCourtSet.has(key);
            const lockedOut = !selected && atCapacity;
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-0.5 rounded-xl border bg-neutral-950 px-2 py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500",
                  selected ? "border-lime-500/60 bg-lime-500/10" : "border-neutral-800 hover:bg-neutral-800",
                  lockedOut && "cursor-not-allowed opacity-40 hover:bg-neutral-950",
                )}
                disabled={lockedOut}
                key={key}
                title={lockedOut ? "Quita uno primero" : undefined}
                type="button"
                onClick={() => toggle(key)}
              >
                {wasOnCourt && (
                  <span
                    className="absolute left-1 top-1 rounded px-1 py-0.5 text-[8px] font-black uppercase leading-none tracking-wide"
                    style={{ backgroundColor: `var(--c-${side}-tint)`, color: cSoft }}
                  >
                    On
                  </span>
                )}
                {selected && (
                  <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full" style={{ backgroundColor: "#84cc16" }}>
                    <Check className="text-neutral-950" size={11} />
                  </span>
                )}
                <span className="font-mono text-xl font-black tabular-nums text-neutral-50">{player.number}</span>
                <span className="text-[9px] font-black uppercase tracking-wide text-neutral-500 tabular-nums">
                  <span className={cn(player.fouls >= 4 ? "text-amber-400" : "text-neutral-300")}>{player.fouls}</span> f
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type BoxRow = {
  player: Player;
  key: string;
  onCourt: boolean;
  fgMade: number;
  fgAtt: number;
  reb: number;
  eff: number;
};

type BoxTotals = {
  pts: number;
  fgMade: number;
  fgAtt: number;
  tpMade: number;
  tpAtt: number;
  ftMade: number;
  ftAtt: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  to: number;
  pf: number;
  tf: number;
  eff: number;
};

type BoxColumn = {
  key: string;
  label: string;
  title: string;
  value: (row: BoxRow) => number;
  cell: (row: BoxRow) => ReactNode;
  total: (totals: BoxTotals) => ReactNode;
  emphasize?: boolean;
};

function buildBoxRow(player: Player, onCourt: boolean): BoxRow {
  const fgMade = player.twoPointersMade + player.threePointersMade;
  const fgAtt = player.twoPointersAttempted + player.threePointersAttempted;
  const reb = player.offensiveRebounds + player.defensiveRebounds;
  // Standard NBA-style efficiency: positive contributions minus missed shots and turnovers.
  const eff =
    player.points +
    reb +
    player.assists +
    player.steals +
    player.blocks -
    ((fgAtt - fgMade) + (player.freeThrowsAttempted - player.freeThrowsMade) + player.turnovers);

  return { player, key: getPlayerKey(player), onCourt, fgMade, fgAtt, reb, eff };
}

function buildBoxRows(team: Team): BoxRow[] {
  const onCourt = new Set(team.players.map(getPlayerKey));
  return getRoster(team).map((player) => buildBoxRow(player, onCourt.has(getPlayerKey(player))));
}

function sumBoxTotals(rows: BoxRow[]): BoxTotals {
  return rows.reduce<BoxTotals>(
    (totals, row) => {
      const p = row.player;
      totals.pts += p.points;
      totals.fgMade += row.fgMade;
      totals.fgAtt += row.fgAtt;
      totals.tpMade += p.threePointersMade;
      totals.tpAtt += p.threePointersAttempted;
      totals.ftMade += p.freeThrowsMade;
      totals.ftAtt += p.freeThrowsAttempted;
      totals.oreb += p.offensiveRebounds;
      totals.dreb += p.defensiveRebounds;
      totals.reb += row.reb;
      totals.ast += p.assists;
      totals.stl += p.steals;
      totals.blk += p.blocks;
      totals.to += p.turnovers;
      totals.pf += p.fouls;
      totals.tf += p.techFouls;
      totals.eff += row.eff;
      return totals;
    },
    {
      pts: 0, fgMade: 0, fgAtt: 0, tpMade: 0, tpAtt: 0, ftMade: 0, ftAtt: 0,
      oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0, tf: 0, eff: 0,
    },
  );
}

function formatMadeAttempt(made: number, attempted: number) {
  return `${made}/${attempted}`;
}

function formatPct(made: number, attempted: number) {
  return attempted > 0 ? `${Math.round((made / attempted) * 100)}%` : "—";
}

function jerseyNumber(player: Player) {
  const parsed = Number(player.number);
  return Number.isFinite(parsed) ? parsed : 0;
}

function BoxScoreDialog({
  initialTeam,
  match,
  mode,
  periodCount,
  onClose,
}: {
  initialTeam: TeamId;
  match: LiveMatch;
  mode: StatsMode;
  periodCount: number;
  onClose: () => void;
}) {
  const [viewTeam, setViewTeam] = useState<TeamId>(initialTeam);
  const [layout, setLayout] = useState<"overview" | "quarters">(
    mode === "youth" ? "quarters" : "overview",
  );
  const [sortKey, setSortKey] = useState<string>("lineup");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const awayRows = useMemo(() => buildBoxRows(match.away), [match.away]);
  const homeRows = useMemo(() => buildBoxRows(match.home), [match.home]);
  const awayTotals = useMemo(() => sumBoxTotals(awayRows), [awayRows]);
  const homeTotals = useMemo(() => sumBoxTotals(homeRows), [homeRows]);
  const showOt = useMemo(
    () => [...awayRows, ...homeRows].some((row) => row.player.ot > 0) || periodCount > 4,
    [awayRows, homeRows, periodCount],
  );

  const rows = viewTeam === "away" ? awayRows : homeRows;
  const totals = viewTeam === "away" ? awayTotals : homeTotals;
  const team = match[viewTeam];

  const columns = useMemo(
    () => (layout === "quarters" || mode === "youth"
      ? buildQuarterColumns(showOt, mode)
      : buildOverviewColumns()),
    [layout, mode, showOt],
  );

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    if (sortKey === "lineup") {
      copy.sort(
        (a, b) => Number(b.onCourt) - Number(a.onCourt) || jerseyNumber(a.player) - jerseyNumber(b.player),
      );
      return copy;
    }
    const column = columns.find((entry) => entry.key === sortKey);
    if (!column) {
      return copy;
    }
    copy.sort((a, b) => {
      const delta = column.value(a) - column.value(b);
      const directed = sortDir === "asc" ? delta : -delta;
      return directed || Number(b.onCourt) - Number(a.onCourt) || jerseyNumber(a.player) - jerseyNumber(b.player);
    });
    return copy;
  }, [rows, columns, sortKey, sortDir]);

  const leaderKey = useMemo(() => {
    let best: BoxRow | undefined;
    for (const row of rows) {
      if (row.player.points > 0 && (!best || row.player.points > best.player.points)) {
        best = row;
      }
    }
    return best?.key;
  }, [rows]);

  function handleSort(key: string) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("desc");
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <BarChart3 className="shrink-0 text-sky-400" size={20} />
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest text-sky-400">Box Score · Live</div>
              <h2 className="truncate text-lg font-black text-neutral-50">{match.matchName}</h2>
            </div>
          </div>
          <button
            aria-label="Close box score"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            <CircleX size={18} />
          </button>
        </div>

        <BoxScoreCompare
          away={match.away}
          home={match.home}
          awayScore={match.awayScore}
          homeScore={match.homeScore}
          awayTotals={awayTotals}
          homeTotals={homeTotals}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
          <div className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-950 p-0.5">
            {(["away", "home"] as TeamId[]).map((sideKey) => (
              <button
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-black uppercase tracking-wide transition-colors focus:outline-none",
                  viewTeam === sideKey ? "text-neutral-950" : "text-neutral-400 hover:text-neutral-100",
                )}
                key={sideKey}
                style={viewTeam === sideKey ? { backgroundColor: `var(--c-${sideKey})` } : undefined}
                type="button"
                onClick={() => setViewTeam(sideKey)}
              >
                {match[sideKey].name}
              </button>
            ))}
          </div>

          {mode === "professional" && (
            <div className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-950 p-0.5">
              {(["overview", "quarters"] as const).map((value) => (
                <button
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-black uppercase tracking-wide transition-colors focus:outline-none",
                    layout === value ? "bg-neutral-200 text-neutral-950" : "text-neutral-400 hover:text-neutral-100",
                  )}
                  key={value}
                  type="button"
                  onClick={() => setLayout(value)}
                >
                  {value === "overview" ? "Overview" : "By Quarter"}
                </button>
              ))}
            </div>
          )}
        </div>

        <BoxScoreLeaders rows={rows} accent={viewTeam} />

        <div className="min-h-0 flex-1 overflow-auto scrollbar-slim">
          <table
            className="w-full border-collapse text-right text-sm tabular-nums"
            style={{ minWidth: `${(columns.length + 1) * 54}px` }}
          >
            <thead className="sticky top-0 z-20">
              <tr className="bg-neutral-950 text-[10px] font-black uppercase tracking-wide text-neutral-500">
                <th
                  className="sticky left-0 z-30 cursor-pointer bg-neutral-950 px-3 py-2 text-left transition-colors hover:text-neutral-200"
                  scope="col"
                  onClick={() => handleSort("lineup")}
                >
                  <span className="inline-flex items-center gap-1">
                    #
                    {sortKey === "lineup" && <ChevronDown size={12} />}
                  </span>
                </th>
                {columns.map((column) => {
                  const active = sortKey === column.key;
                  return (
                    <th
                      className={cn(
                        "cursor-pointer whitespace-nowrap px-2.5 py-2 transition-colors hover:text-neutral-200",
                        active && "text-sky-300",
                      )}
                      key={column.key}
                      scope="col"
                      title={column.title}
                      onClick={() => handleSort(column.key)}
                    >
                      <span className="inline-flex items-center gap-0.5">
                        {column.label}
                        {active && (
                          <ChevronDown
                            className={cn("transition-transform", sortDir === "asc" && "rotate-180")}
                            size={12}
                          />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-sm font-semibold text-neutral-500" colSpan={columns.length + 1}>
                    No players on this roster.
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => {
                  const isLeader = row.key === leaderKey;
                  return (
                    <tr
                      className={cn(
                        "border-b border-neutral-800/70 transition-colors hover:bg-neutral-800/40",
                        row.onCourt ? "bg-neutral-900/50" : "bg-neutral-950/40",
                      )}
                      key={row.key}
                    >
                      <th
                        className="sticky left-0 z-10 bg-inherit px-3 py-1.5 text-left font-mono font-black"
                        scope="row"
                        style={row.onCourt ? { boxShadow: `inset 3px 0 0 0 var(--c-${viewTeam})` } : undefined}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className={cn("text-base", row.onCourt ? "text-neutral-50" : "text-neutral-400")}>
                            {row.player.number}
                          </span>
                          {row.onCourt && (
                            <span
                              className="rounded px-1 py-0.5 text-[8px] font-black uppercase leading-none tracking-wide"
                              style={{ backgroundColor: `var(--c-${viewTeam}-tint)`, color: `var(--c-${viewTeam}-soft)` }}
                            >
                              On
                            </span>
                          )}
                          {isLeader && <Crown className="text-amber-400" size={12} />}
                        </span>
                      </th>
                      {columns.map((column) => (
                        <td
                          className={cn(
                            "whitespace-nowrap px-2.5 py-1.5",
                            column.emphasize ? "font-black text-neutral-50" : "text-neutral-300",
                            sortKey === column.key && "text-sky-200",
                          )}
                          key={column.key}
                        >
                          {column.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot className="sticky bottom-0 z-20">
              <tr className="bg-neutral-950 text-xs font-black text-neutral-200">
                <th className="sticky left-0 z-30 bg-neutral-950 px-3 py-2 text-left uppercase tracking-wide text-neutral-400" scope="row">
                  Team
                </th>
                {columns.map((column) => (
                  <td className="whitespace-nowrap px-2.5 py-2" key={column.key}>
                    {column.total(totals)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-800 px-4 py-2 text-[10px] font-semibold text-neutral-500">
          <span className="inline-flex items-center gap-1">
            <span className="rounded bg-neutral-800 px-1 py-0.5 text-[8px] font-black uppercase text-neutral-300">On</span>
            on court
          </span>
          <span className="inline-flex items-center gap-1">
            <Crown className="text-amber-400" size={11} /> team scoring leader
          </span>
          <span>EFF = (PTS+REB+AST+STL+BLK) − (missed FG+FT+TO)</span>
          <span className="text-neutral-600">Tap a column to sort · {team.name}</span>
        </div>
      </div>
    </div>
  );
}

function buildOverviewColumns(): BoxColumn[] {
  return [
    { key: "pts", label: "PTS", title: "Points", emphasize: true, value: (r) => r.player.points, cell: (r) => r.player.points, total: (t) => t.pts },
    { key: "fg", label: "FG", title: "Field goals made/attempted", value: (r) => r.fgMade, cell: (r) => formatMadeAttempt(r.fgMade, r.fgAtt), total: (t) => formatMadeAttempt(t.fgMade, t.fgAtt) },
    { key: "fgpct", label: "FG%", title: "Field goal percentage", value: (r) => (r.fgAtt > 0 ? r.fgMade / r.fgAtt : -1), cell: (r) => formatPct(r.fgMade, r.fgAtt), total: (t) => formatPct(t.fgMade, t.fgAtt) },
    { key: "3pt", label: "3PT", title: "Three-pointers made/attempted", value: (r) => r.player.threePointersMade, cell: (r) => formatMadeAttempt(r.player.threePointersMade, r.player.threePointersAttempted), total: (t) => formatMadeAttempt(t.tpMade, t.tpAtt) },
    { key: "ft", label: "FT", title: "Free throws made/attempted", value: (r) => r.player.freeThrowsMade, cell: (r) => formatMadeAttempt(r.player.freeThrowsMade, r.player.freeThrowsAttempted), total: (t) => formatMadeAttempt(t.ftMade, t.ftAtt) },
    { key: "oreb", label: "OR", title: "Offensive rebounds", value: (r) => r.player.offensiveRebounds, cell: (r) => r.player.offensiveRebounds, total: (t) => t.oreb },
    { key: "dreb", label: "DR", title: "Defensive rebounds", value: (r) => r.player.defensiveRebounds, cell: (r) => r.player.defensiveRebounds, total: (t) => t.dreb },
    { key: "reb", label: "REB", title: "Total rebounds", value: (r) => r.reb, cell: (r) => r.reb, total: (t) => t.reb },
    { key: "ast", label: "AST", title: "Assists", value: (r) => r.player.assists, cell: (r) => r.player.assists, total: (t) => t.ast },
    { key: "stl", label: "STL", title: "Steals", value: (r) => r.player.steals, cell: (r) => r.player.steals, total: (t) => t.stl },
    { key: "blk", label: "BLK", title: "Blocks", value: (r) => r.player.blocks, cell: (r) => r.player.blocks, total: (t) => t.blk },
    { key: "to", label: "TO", title: "Turnovers", value: (r) => r.player.turnovers, cell: (r) => r.player.turnovers, total: (t) => t.to },
    { key: "pf", label: "PF", title: "Personal fouls", value: (r) => r.player.fouls, cell: (r) => <FoulCount value={r.player.fouls} />, total: (t) => t.pf },
    { key: "tf", label: "TF", title: "Technical fouls", value: (r) => r.player.techFouls, cell: (r) => <TechFoulCount value={r.player.techFouls} />, total: (t) => t.tf },
    { key: "eff", label: "EFF", title: "Efficiency rating", emphasize: true, value: (r) => r.eff, cell: (r) => <EffValue value={r.eff} />, total: (t) => t.eff },
  ];
}

function buildQuarterColumns(showOt: boolean, mode: StatsMode): BoxColumn[] {
  const periodColumns: BoxColumn[] = [
    makeQuarterColumn("q1", "Q1", "1st quarter points", (p) => p.q1),
    makeQuarterColumn("q2", "Q2", "2nd quarter points", (p) => p.q2),
    makeQuarterColumn("q3", "Q3", "3rd quarter points", (p) => p.q3),
    makeQuarterColumn("q4", "Q4", "4th quarter points", (p) => p.q4),
  ];
  if (showOt) {
    periodColumns.push(makeQuarterColumn("ot", "OT", "Overtime points", (p) => p.ot));
  }

  const tail: BoxColumn[] = [
    { key: "pts", label: "PTS", title: "Total points", emphasize: true, value: (r) => r.player.points, cell: (r) => r.player.points, total: (t) => t.pts },
  ];

  if (mode === "youth") {
    tail.push(
      { key: "ft", label: "FT", title: "Free throws made/attempted", value: (r) => r.player.freeThrowsMade, cell: (r) => formatMadeAttempt(r.player.freeThrowsMade, r.player.freeThrowsAttempted), total: (t) => formatMadeAttempt(t.ftMade, t.ftAtt) },
      { key: "pf", label: "PF", title: "Personal fouls", value: (r) => r.player.fouls, cell: (r) => <FoulCount value={r.player.fouls} />, total: (t) => t.pf },
      { key: "tf", label: "TF", title: "Technical fouls", value: (r) => r.player.techFouls, cell: (r) => <TechFoulCount value={r.player.techFouls} />, total: (t) => t.tf },
    );
  }

  return [...periodColumns, ...tail];
}

function makeQuarterColumn(
  key: string,
  label: string,
  title: string,
  get: (player: Player) => number,
): BoxColumn {
  return {
    key,
    label,
    title,
    value: (row) => get(row.player),
    cell: (row) => get(row.player) || <span className="text-neutral-600">·</span>,
    total: () => "",
  };
}

function FoulCount({ value }: { value: number }) {
  return (
    <span className={cn(value >= 5 ? "font-black text-red-400" : value >= 4 ? "font-black text-amber-400" : undefined)}>
      {value}
    </span>
  );
}

function TechFoulCount({ value }: { value: number }) {
  return <span className={cn(value > 0 ? "font-black text-amber-400" : "text-neutral-500")}>{value}</span>;
}

function EffValue({ value }: { value: number }) {
  return (
    <span className={cn(value > 0 ? "text-lime-300" : value < 0 ? "text-red-300" : "text-neutral-400")}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

function BoxScoreLeaders({ rows, accent }: { rows: BoxRow[]; accent: TeamId }) {
  const leaders = useMemo(() => {
    const top = (value: (row: BoxRow) => number) => {
      let best: BoxRow | undefined;
      for (const row of rows) {
        if (value(row) > 0 && (!best || value(row) > value(best))) {
          best = row;
        }
      }
      return best;
    };
    return {
      pts: top((row) => row.player.points),
      reb: top((row) => row.reb),
      ast: top((row) => row.player.assists),
    };
  }, [rows]);

  const items: Array<{ icon: ReactNode; label: string; row?: BoxRow; value: number }> = [
    { icon: <Crown className="text-amber-400" size={13} />, label: "PTS", row: leaders.pts, value: leaders.pts?.player.points ?? 0 },
    { icon: <Shield className="text-sky-400" size={13} />, label: "REB", row: leaders.reb, value: leaders.reb?.reb ?? 0 },
    { icon: <Handshake className="text-lime-400" size={13} />, label: "AST", row: leaders.ast, value: leaders.ast?.player.assists ?? 0 },
  ];

  if (!leaders.pts && !leaders.reb && !leaders.ast) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-950/60 px-3 py-2">
      <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: `var(--c-${accent}-soft)` }}>
        Leaders
      </span>
      {items.map((item) => (
        <span
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs font-bold text-neutral-200"
          key={item.label}
        >
          {item.icon}
          <span className="text-[10px] font-black uppercase tracking-wide text-neutral-500">{item.label}</span>
          {item.row ? (
            <>
              <span className="font-mono font-black text-neutral-50">#{item.row.player.number}</span>
              <span className="font-mono tabular-nums text-neutral-300">{item.value}</span>
            </>
          ) : (
            <span className="text-neutral-600">—</span>
          )}
        </span>
      ))}
    </div>
  );
}

function BoxScoreCompare({
  away,
  home,
  awayScore,
  homeScore,
  awayTotals,
  homeTotals,
}: {
  away: Team;
  home: Team;
  awayScore: number;
  homeScore: number;
  awayTotals: BoxTotals;
  homeTotals: BoxTotals;
}) {
  const stats: Array<{ label: string; away: string; home: string; awayN: number; homeN: number; lowerBetter?: boolean }> = [
    { label: "PTS", away: String(awayScore), home: String(homeScore), awayN: awayScore, homeN: homeScore },
    { label: "FG%", away: formatPct(awayTotals.fgMade, awayTotals.fgAtt), home: formatPct(homeTotals.fgMade, homeTotals.fgAtt), awayN: awayTotals.fgAtt ? awayTotals.fgMade / awayTotals.fgAtt : -1, homeN: homeTotals.fgAtt ? homeTotals.fgMade / homeTotals.fgAtt : -1 },
    { label: "3PT%", away: formatPct(awayTotals.tpMade, awayTotals.tpAtt), home: formatPct(homeTotals.tpMade, homeTotals.tpAtt), awayN: awayTotals.tpAtt ? awayTotals.tpMade / awayTotals.tpAtt : -1, homeN: homeTotals.tpAtt ? homeTotals.tpMade / homeTotals.tpAtt : -1 },
    { label: "REB", away: String(awayTotals.reb), home: String(homeTotals.reb), awayN: awayTotals.reb, homeN: homeTotals.reb },
    { label: "AST", away: String(awayTotals.ast), home: String(homeTotals.ast), awayN: awayTotals.ast, homeN: homeTotals.ast },
    { label: "TO", away: String(awayTotals.to), home: String(homeTotals.to), awayN: awayTotals.to, homeN: homeTotals.to, lowerBetter: true },
  ];

  return (
    <div className="border-b border-neutral-800 bg-neutral-950/40 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-black uppercase tracking-wide">
        <span className="truncate" style={{ color: "var(--c-away-soft)" }}>{away.name}</span>
        <span className="shrink-0 text-neutral-600">vs</span>
        <span className="truncate text-right" style={{ color: "var(--c-home-soft)" }}>{home.name}</span>
      </div>
      <div className="grid grid-cols-3 gap-x-2 gap-y-1 sm:grid-cols-6">
        {stats.map((stat) => {
          const awayWins = stat.lowerBetter ? stat.awayN < stat.homeN : stat.awayN > stat.homeN;
          const homeWins = stat.lowerBetter ? stat.homeN < stat.awayN : stat.homeN > stat.awayN;
          return (
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-center" key={stat.label}>
              <div className="flex items-center justify-between gap-1 font-mono text-sm font-black tabular-nums">
                <span className={cn(awayWins ? "" : "text-neutral-500")} style={awayWins ? { color: "var(--c-away-soft)" } : undefined}>
                  {stat.away}
                </span>
                <span className={cn(homeWins ? "" : "text-neutral-500")} style={homeWins ? { color: "var(--c-home-soft)" } : undefined}>
                  {stat.home}
                </span>
              </div>
              <div className="text-[9px] font-black uppercase tracking-wide text-neutral-500">{stat.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JumpBallDialog({
  arrowTeam,
  teams,
  onClose,
  onChoose,
}: {
  arrowTeam: TeamId;
  teams: Record<TeamId, Team>;
  onClose: () => void;
  onChoose: (team: TeamId) => void;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-amber-400">Jump Ball</div>
            <h2 className="truncate text-lg font-black text-neutral-50">Who took possession?</h2>
          </div>
          <button
            aria-label="Close jump ball"
            className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            <CircleX size={18} />
          </button>
        </div>

        <div className="px-4 py-2 text-[11px] font-semibold text-neutral-400">
          Arrow points to <span className="font-black text-neutral-200">{teams[arrowTeam].name}</span>.
          Recording who takes the ball flips the arrow to the other team.
        </div>

        <div className="grid gap-px bg-neutral-800 sm:grid-cols-2">
          {(["away", "home"] as TeamId[]).map((id) => (
            <button
              className="flex flex-col items-center justify-center gap-1.5 bg-neutral-900 px-4 py-6 transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neutral-500/60"
              key={id}
              type="button"
              onClick={() => onChoose(id)}
            >
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: `var(--c-${id}-soft)` }}>
                {teams[id].label}
              </span>
              <span className="max-w-full truncate text-base font-black text-neutral-50">{teams[id].name}</span>
              {id === arrowTeam && (
                <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-300">
                  Arrow
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="border-t border-neutral-800 px-4 py-3 text-right">
          <button
            className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 px-4 text-xs font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function PreGameDialog({
  isOnline,
  isSaving,
  match,
  onAddPlayer,
  onChangeCoach,
  onChangeOfficial,
  onClose,
  onRemovePlayer,
  onSave,
  onTogglePresent,
  onToggleStarter,
  onUpdatePlayer,
}: {
  isOnline: boolean;
  isSaving: boolean;
  match: LiveMatch;
  onAddPlayer: (team: TeamId) => void;
  onChangeCoach: (team: TeamId, value: string) => void;
  onChangeOfficial: (field: OfficialKey, value: string) => void;
  onClose: () => void;
  onRemovePlayer: (team: TeamId, player: Player) => void;
  onSave: () => void;
  onTogglePresent: (team: TeamId, player: Player) => void;
  onToggleStarter: (team: TeamId, player: Player) => void;
  onUpdatePlayer: (team: TeamId, player: Player, values: Pick<Player, "name" | "number">) => void;
}) {
  const awayPresent = match.away.presentCount;
  const homePresent = match.home.presentCount;
  const diff = Math.abs(awayPresent - homePresent);
  const shortTeam = diff === 0 ? undefined : awayPresent < homePresent ? match.away : match.home;
  const eqPoints = diff * 2;
  const validationErrors = validateGameDayRoster(match);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-amber-400">Pre-Game Setup</div>
            <h2 className="truncate text-lg font-black text-neutral-50">{match.matchName}</h2>
          </div>
          <span className={cn(
            "ml-auto hidden shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase sm:inline-flex",
            isOnline
              ? "border-lime-500/40 bg-lime-500/10 text-lime-300"
              : "border-amber-500/40 bg-amber-500/10 text-amber-300",
          )}>
            {isOnline ? "Online sync" : "Offline · saved here"}
          </span>
          <button
            aria-label="Close pre-game"
            className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            <CircleX size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim">
          <div className="border-b border-neutral-800 px-4 py-3">
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-neutral-500">Referees</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <OfficialField
                label="Referee 1"
                value={match.referee ?? ""}
                onChange={(value) => onChangeOfficial("referee", value)}
              />
              <OfficialField
                label="Referee 2"
                value={match.refereeAssistant ?? ""}
                onChange={(value) => onChangeOfficial("refereeAssistant", value)}
              />
              <OfficialField
                label="Referee 3"
                value={match.referee3 ?? ""}
                onChange={(value) => onChangeOfficial("referee3", value)}
              />
            </div>
            <div className="mb-1.5 mt-3 text-[10px] font-black uppercase tracking-widest text-neutral-500">Scorer's Table</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <OfficialField
                label="Scorekeeper 1"
                value={match.scorekeeper ?? ""}
                onChange={(value) => onChangeOfficial("scorekeeper", value)}
              />
              <OfficialField
                label="Scorekeeper 2"
                value={match.scorekeeper2 ?? ""}
                onChange={(value) => onChangeOfficial("scorekeeper2", value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-950/60 px-4 py-2.5">
            <div className="text-[11px] font-black uppercase tracking-wide text-neutral-500 tabular-nums">
              Attendance · {match.away.label} {awayPresent} vs {match.home.label} {homePresent}
            </div>
            <div className="text-xs font-bold">
              {shortTeam ? (
                <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-amber-300">
                  {shortTeam.name} +{eqPoints} at Q3 · equiparación
                </span>
              ) : (
                <span className="text-neutral-500">Even rosters — no equalization</span>
              )}
            </div>
          </div>

          <div className="grid gap-px bg-neutral-800 sm:grid-cols-2">
            <PreGameTeamColumn
              side="away"
              team={match.away}
              onAddPlayer={onAddPlayer}
              onChangeCoach={onChangeCoach}
              onRemovePlayer={onRemovePlayer}
              onTogglePresent={onTogglePresent}
              onToggleStarter={onToggleStarter}
              onUpdatePlayer={onUpdatePlayer}
            />
            <PreGameTeamColumn
              side="home"
              team={match.home}
              onAddPlayer={onAddPlayer}
              onChangeCoach={onChangeCoach}
              onRemovePlayer={onRemovePlayer}
              onTogglePresent={onTogglePresent}
              onToggleStarter={onToggleStarter}
              onUpdatePlayer={onUpdatePlayer}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3">
          <div className={cn(
            "min-w-0 truncate text-xs font-semibold tabular-nums",
            validationErrors.length > 0 ? "text-red-300" : "text-neutral-400",
          )} title={validationErrors.join(" ")}>
            {validationErrors[0] ?? `${match.away.players.length}/5 · ${match.home.players.length}/5 starters set`}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 px-4 text-xs font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
              disabled={isSaving}
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="flex h-10 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 text-xs font-black uppercase tracking-wide text-amber-200 transition-colors hover:bg-amber-500/25 focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={isSaving || validationErrors.length > 0}
              type="button"
              onClick={onSave}
            >
              {isSaving ? <RefreshCw size={16} /> : <ClipboardList size={16} />}
              {isSaving ? "Saving" : isOnline ? "Save & sync" : "Save offline"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OfficialField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-neutral-500">{label}</span>
      <input
        className="h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm font-semibold text-neutral-100 outline-none placeholder:text-neutral-600 focus:ring-2 focus:ring-neutral-500"
        placeholder={label}
        type="text"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function PreGameTeamColumn({
  side,
  team,
  onAddPlayer,
  onChangeCoach,
  onRemovePlayer,
  onTogglePresent,
  onToggleStarter,
  onUpdatePlayer,
}: {
  side: TeamId;
  team: Team;
  onAddPlayer: (team: TeamId) => void;
  onChangeCoach: (team: TeamId, value: string) => void;
  onRemovePlayer: (team: TeamId, player: Player) => void;
  onTogglePresent: (team: TeamId, player: Player) => void;
  onToggleStarter: (team: TeamId, player: Player) => void;
  onUpdatePlayer: (team: TeamId, player: Player, values: Pick<Player, "name" | "number">) => void;
}) {
  const roster = [...team.players, ...team.bench];
  const starterKeys = new Set(team.players.map(getPlayerKey));
  const starterFull = team.players.length >= 5;
  const [pendingRemoval, setPendingRemoval] = useState<Player | undefined>(undefined);
  return (
    <div className="bg-neutral-900">
      <div className="border-b border-neutral-800 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[11px] font-black uppercase tracking-wide" style={{ color: `var(--c-${side}-soft)` }}>
            {team.label} · {team.name}
          </span>
          <span className="shrink-0 text-[11px] font-black uppercase text-neutral-500 tabular-nums">
            {roster.length} rostered · {team.presentCount} here · {team.players.length}/5 starting
          </span>
        </div>
        <label className="mt-2 block">
          <span className="mb-1 block text-[10px] font-black uppercase text-neutral-500">Coach name</span>
          <input
            aria-label={`${team.label} coach name`}
            className="h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm font-semibold text-neutral-100 outline-none placeholder:text-neutral-600 focus:ring-2 focus:ring-neutral-500"
            placeholder="Enter coach name"
            value={team.coach ?? ""}
            onChange={(event) => onChangeCoach(side, event.currentTarget.value)}
          />
        </label>
      </div>
      <div className="grid grid-cols-[58px_minmax(0,1fr)_auto] gap-2 px-3 pb-1 pt-2 text-[9px] font-black uppercase text-neutral-600">
        <span>Jersey</span>
        <span>Player name</span>
        <span className="pr-2">Here · Start</span>
      </div>
      <div className="max-h-[42vh] overflow-y-auto scrollbar-slim px-2 pb-2">
        {roster.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-800 px-2 py-6 text-center">
            <Users className="mx-auto text-neutral-600" size={20} />
            <div className="mt-2 text-xs font-semibold text-neutral-400">No players yet</div>
            <button
              className="mt-3 h-9 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-[11px] font-black uppercase text-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-500"
              type="button"
              onClick={() => onAddPlayer(side)}
            >
              Add first player
            </button>
          </div>
        ) : (
          roster.map((player) => {
            const key = getPlayerKey(player);
            const isStarter = starterKeys.has(key);
            const present = player.present ?? true;
            const playerError = getGameDayPlayerError(team, player);
            const canRemove = !player.id || player.id < 0;
            return (
              <div className="mb-1" key={key}>
                <div
                  className={cn(
                    "grid grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border bg-neutral-950 p-2",
                    playerError ? "border-red-500/50" : "border-neutral-800",
                    !present && "opacity-60",
                  )}
                >
                  <input
                    aria-label={`${team.label} jersey number`}
                    className="h-9 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 text-center font-mono text-base font-black tabular-nums text-neutral-100 outline-none focus:ring-2 focus:ring-neutral-500"
                    inputMode="numeric"
                    placeholder="#"
                    value={player.number}
                    onChange={(event) => onUpdatePlayer(side, player, {
                      name: player.name,
                      number: event.currentTarget.value.replace(/[^0-9]/g, "").slice(0, 3),
                    })}
                  />
                  <input
                    aria-label={`${team.label} player name`}
                    className="h-9 min-w-0 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm font-semibold text-neutral-100 outline-none placeholder:text-neutral-600 focus:ring-2 focus:ring-neutral-500"
                    placeholder="Full name"
                    value={player.name}
                    onChange={(event) => onUpdatePlayer(side, player, {
                      name: event.currentTarget.value,
                      number: player.number,
                    })}
                  />
                  <span className="flex items-center gap-1">
                    <button
                      aria-label={present ? "Mark absent" : "Mark present"}
                      className={cn(
                        "flex size-9 items-center justify-center rounded-md border transition-colors focus:outline-none focus:ring-2",
                        present
                          ? "border-lime-500/40 bg-lime-500/10 text-lime-300 focus:ring-lime-500/50"
                          : "border-neutral-700 bg-neutral-900 text-neutral-500 focus:ring-neutral-500",
                      )}
                      title={present ? "Present" : "Absent"}
                      type="button"
                      onClick={() => onTogglePresent(side, player)}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      aria-label={isStarter ? "Remove starter" : "Add starter"}
                      className={cn(
                        "flex size-9 items-center justify-center rounded-md border transition-colors focus:outline-none focus:ring-2",
                        isStarter
                          ? "border-amber-500/50 bg-amber-500/15 text-amber-300 focus:ring-amber-500/50"
                          : "border-neutral-700 bg-neutral-900 text-neutral-500 focus:ring-neutral-500",
                        (!present || (!isStarter && starterFull)) && "cursor-not-allowed opacity-40",
                      )}
                      disabled={!present || (!isStarter && starterFull)}
                      title={isStarter ? "Starter" : "Add to starting five"}
                      type="button"
                      onClick={() => onToggleStarter(side, player)}
                    >
                      <Star className={isStarter ? "fill-amber-300" : ""} size={15} />
                    </button>
                    {canRemove && (
                      <button
                        aria-label={`Remove ${player.name || "new player"}`}
                        className="flex size-9 items-center justify-center rounded-md border border-neutral-700 bg-neutral-900 text-neutral-500 transition-colors hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                        type="button"
                        onClick={() => setPendingRemoval(player)}
                      >
                        <CircleX size={15} />
                      </button>
                    )}
                  </span>
                </div>
                {playerError && <div className="px-2 pt-1 text-[10px] font-semibold text-red-300">{playerError}</div>}
              </div>
            );
          })
        )}
        {roster.length > 0 && roster.length < 30 && (
          <button
            className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-700 bg-neutral-950 text-[11px] font-black uppercase text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={() => onAddPlayer(side)}
          >
            <Plus size={14} />
            Add player
          </button>
        )}
        <p className="mt-2 px-1 text-[10px] text-pretty text-neutral-600">
          Existing team players stay in Odoo; mark them out for this game. New game-day players can be removed before sync.
        </p>
      </div>
      {pendingRemoval && (
        <ConfirmPlayerRemovalDialog
          player={pendingRemoval}
          onCancel={() => setPendingRemoval(undefined)}
          onConfirm={() => {
            onRemovePlayer(side, pendingRemoval);
            setPendingRemoval(undefined);
          }}
        />
      )}
    </div>
  );
}

function ConfirmPlayerRemovalDialog({
  player,
  onCancel,
  onConfirm,
}: {
  player: Player;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="alertdialog">
      <div className="w-full max-w-sm rounded-xl border border-red-500/50 bg-neutral-900 p-4 shadow-xl">
        <h3 className="text-base font-black text-balance text-neutral-50">Remove this new player?</h3>
        <p className="mt-1 text-sm text-pretty text-neutral-400">
          #{player.number || "—"} {player.name || "Unnamed player"} has not synced yet and will be removed from this game-day roster.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button autoFocus className="h-10 rounded-lg border border-neutral-700 bg-neutral-950 px-4 text-xs font-bold text-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-500" type="button" onClick={onCancel}>Cancel</button>
          <button className="h-10 rounded-lg border border-red-500/50 bg-red-500/15 px-4 text-xs font-bold text-red-200 focus:outline-none focus:ring-2 focus:ring-red-500/50" type="button" onClick={onConfirm}>Remove player</button>
        </div>
      </div>
    </div>
  );
}

function BottomPanel({
  events,
  summary,
  teams,
  onEditEvent,
  onUndoEvent,
}: {
  events: GameEvent[];
  summary: Array<{ label: string; value: string }>;
  teams: Record<TeamId, Team>;
  onEditEvent: (eventId: number) => void;
  onUndoEvent: (eventId: number) => void;
}) {
  return (
    <section className="order-6 grid gap-px overflow-hidden bg-neutral-800 md:col-span-2 md:grid-cols-2 lg:col-span-3 lg:col-start-1 lg:row-start-4 lg:grid-cols-[minmax(300px,1.6fr)_minmax(220px,1fr)] 2xl:row-start-3 2xl:min-h-0">
      <div className="min-h-0 overflow-hidden bg-neutral-950 p-3 md:col-span-2 lg:col-span-1 2xl:p-2">
        <PanelTitle>{`Event Feed (${events.length})`}</PanelTitle>
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-neutral-800 md:max-h-56 2xl:mt-1 2xl:max-h-[132px] 2xl:rounded-md">
          {events.map((event) => (
            <div
              className="grid min-h-11 grid-cols-[26px_48px_minmax(72px,1fr)_minmax(0,1.3fr)_56px_32px_32px] items-center gap-1 border-b border-neutral-800/70 bg-neutral-900/40 px-2 last:border-b-0 2xl:min-h-8"
              key={event.id}
            >
              <ClipboardList className={eventIconClass[event.icon]} size={16} />
              <span className="font-mono text-xs text-neutral-400 tabular-nums">{event.time}</span>
              <span
                className="truncate font-mono text-xs font-bold tabular-nums"
                style={{ color: `var(--c-${event.team}-soft)` }}
              >
                {getEventPlayerNumber(event, teams)}
              </span>
              <span className="truncate text-xs text-neutral-400">{event.label}</span>
              <span
                className="text-right font-mono text-sm font-black tabular-nums"
                style={{ color: `var(--c-${event.team}-soft)` }}
              >
                {event.score ?? ""}
              </span>
              <button
                aria-label={`Edit ${event.label}`}
                className="flex size-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:size-6"
                type="button"
                onClick={() => onEditEvent(event.id)}
              >
                <Pencil size={13} />
              </button>
              <button
                aria-label={`Undo ${event.label}`}
                className="flex size-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:size-6"
                type="button"
                onClick={() => onUndoEvent(event.id)}
              >
                <Undo2 size={14} />
              </button>
            </div>
          ))}
          {events.length === 0 && (
            <div className="px-3 py-6 text-center text-sm font-semibold text-neutral-500">
              No events yet.
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 overflow-hidden bg-neutral-950 p-3 2xl:overflow-y-auto 2xl:p-2 2xl:scrollbar-slim">
        <PanelTitle>Game Summary</PanelTitle>
        <div className="mt-2 space-y-1.5 2xl:mt-1.5 2xl:space-y-1">
          {summary.map((item) => (
            <div
              className="flex items-center justify-between gap-4 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm 2xl:py-1"
              key={item.label}
            >
              <span className="text-[11px] font-black uppercase tracking-wide text-neutral-500">{item.label}</span>
              <span className="truncate font-bold text-neutral-100">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ActionPanel({
  canRecordShot,
  clock,
  connectionStatus,
  foulOnShot,
  isClockRunning,
  isOnline,
  isRefreshing,
  pendingCount,
  mode,
  period,
  periodOptions,
  periodSettings,
  shotClock,
  syncLog,
  syncMessage,
  teams,
  timeoutClockSeconds,
  timeoutDurationSeconds,
  timeoutTeam,
  onAdjustShotClock,
  onAdjustTimeout,
  onAdjustTimeoutDuration,
  onAction,
  onAdjustClock,
  onEndGame,
  onFreeThrow,
  isActionAllowed,
  onJumpBall,
  onOpenBoxScore,
  onOpenFoul,
  onOpenPreGame,
  onOpenSubstitution,
  onOpenTech,
  onOpenWarning,
  onPeriodChange,
  onPeriodSettingsChange,
  onRefresh,
  onResetMatchState,
  onResetGameClock,
  onResetShotClock,
  onSetGameClock,
  onSetFoulOnShot,
  onStopTimeoutClock,
  onToggleClock,
}: {
  canRecordShot: boolean;
  clock: string;
  connectionStatus: ConnectionStatus;
  foulOnShot: boolean;
  isClockRunning: boolean;
  isOnline: boolean;
  isRefreshing: boolean;
  pendingCount: number;
  mode: StatsMode;
  period: LiveMatch["period"];
  periodOptions: number[];
  periodSettings: PeriodSettings;
  shotClock: number;
  syncLog: SyncLogEntry[];
  syncMessage: string;
  teams: Record<TeamId, Team>;
  timeoutClockSeconds: number;
  timeoutDurationSeconds: number;
  timeoutTeam?: TeamId;
  onAdjustShotClock: (seconds: number) => void;
  onAdjustTimeout: (team: TeamId, delta: number) => void;
  onAdjustTimeoutDuration: (seconds: number) => void;
  onAction: (action: ActionKey) => void;
  onAdjustClock: (seconds: number) => void;
  onEndGame: () => void;
  onFreeThrow: (made: boolean) => void;
  isActionAllowed: (action: ActionKey) => boolean;
  onJumpBall: () => void;
  onOpenBoxScore: () => void;
  onOpenFoul: () => void;
  onOpenPreGame: () => void;
  onOpenSubstitution: () => void;
  onOpenTech: () => void;
  onOpenWarning: () => void;
  onPeriodChange: (period: LiveMatch["period"]) => void;
  onPeriodSettingsChange: (settings: Partial<PeriodSettings>) => void;
  onRefresh: () => void;
  onResetMatchState: () => void;
  onResetGameClock: () => void;
  onResetShotClock: (seconds: number) => void;
  onSetGameClock: (seconds: number) => void;
  onSetFoulOnShot: (enabled: boolean) => void;
  onStopTimeoutClock: () => void;
  onToggleClock: () => void;
}) {
  const visibleActions =
    mode === "youth"
      ? statActions.filter(
          (action) =>
            action.key === "personal foul" ||
            action.key === "tech foul" ||
            action.key === "warning",
        )
      : statActions;

  const [editingClock, setEditingClock] = useState(false);
  const [clockDraft, setClockDraft] = useState(clock);

  function startClockEdit() {
    setClockDraft(clock);
    setEditingClock(true);
  }

  function commitClockEdit() {
    const seconds = parseClockInput(clockDraft);
    if (seconds !== undefined) {
      onSetGameClock(seconds);
    }
    setEditingClock(false);
  }

  return (
    <aside className="order-5 flex min-h-0 flex-col bg-neutral-950 p-3 md:col-span-2 lg:col-span-3 lg:col-start-1 lg:row-start-3 2xl:col-span-1 2xl:col-start-4 2xl:row-span-3 2xl:row-start-1 2xl:h-full 2xl:overflow-y-auto 2xl:p-1.5">
      <div className="mb-3 flex items-center justify-between gap-3 2xl:mb-1.5">
        <div className="min-w-0">
          <h2 className="text-base font-black uppercase tracking-wide text-neutral-100 text-balance 2xl:text-sm">Scorer Console</h2>
          <p className="mt-0.5 truncate text-xs font-semibold text-neutral-500 text-pretty 2xl:hidden">
            {mode === "professional" ? "Professional stat tracking" : "Youth: points, fouls, free throws"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            aria-label="Open live box score"
            className="flex size-10 items-center justify-center rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-300 transition-colors hover:bg-sky-500/20 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 2xl:size-8 2xl:rounded-md"
            title="Box score: live per-player performance for coaches"
            type="button"
            onClick={onOpenBoxScore}
          >
            <BarChart3 size={17} />
          </button>
          <button
            aria-label="Open pre-game roster, attendance and officials"
            className="flex size-10 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 transition-colors hover:bg-amber-500/20 hover:text-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 2xl:size-8 2xl:rounded-md"
            title="Pre-game: attendance, starters, referee/scorekeeper, equalization"
            type="button"
            onClick={onOpenPreGame}
          >
            <ClipboardList size={17} />
          </button>
          <button
            aria-label="Reset local match controls"
            className="flex size-10 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:size-8 2xl:rounded-md"
            type="button"
            onClick={onResetMatchState}
          >
            <RotateCcw size={17} />
          </button>
          <button
            aria-label="Refresh live data"
            className="flex size-10 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-60 2xl:size-8 2xl:rounded-md"
            disabled={isRefreshing}
            type="button"
            onClick={onRefresh}
          >
            <RefreshCw className={isRefreshing ? "animate-spin text-neutral-500" : ""} size={17} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-1 2xl:gap-1.5">
        <div className="flex flex-col gap-3 2xl:gap-1.5">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 shadow-sm shadow-black/20 2xl:rounded-md 2xl:p-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Game Clock</span>
              {editingClock ? (
                <input
                  aria-label="Edit remaining time — type mmss (e.g. 1000 = 10:00) or mm:ss"
                  autoFocus
                  className="w-28 rounded-md border border-lime-500/50 bg-neutral-950 px-2 text-right font-mono text-3xl font-black leading-none tabular-nums text-lime-300 outline-none focus:ring-2 focus:ring-lime-500/50 2xl:w-20 2xl:text-xl"
                  inputMode="numeric"
                  placeholder="mmss"
                  value={clockDraft}
                  onBlur={commitClockEdit}
                  onChange={(event) => setClockDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitClockEdit();
                    } else if (event.key === "Escape") {
                      setEditingClock(false);
                    }
                  }}
                />
              ) : (
                <button
                  aria-label="Edit remaining time"
                  className={cn(
                    "rounded-md font-mono text-3xl font-black leading-none tabular-nums transition-colors hover:text-lime-300 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:text-xl",
                    isClockRunning ? "text-lime-400" : "text-neutral-100",
                  )}
                  title="Click to set the remaining time (mm:ss)"
                  type="button"
                  onClick={startClockEdit}
                >
                  {clock}
                </button>
              )}
            </div>
            <div className="mt-3 grid grid-cols-5 gap-1.5 2xl:mt-1 2xl:gap-1">
              <TimerButton label="-10" onClick={() => onAdjustClock(-10)}>
                <Minus size={13} />
                10
              </TimerButton>
              <TimerButton label="-1" onClick={() => onAdjustClock(-1)}>
                <Minus size={13} />
                1
              </TimerButton>
              <button
                aria-label={isClockRunning ? "Pause clock" : "Start clock"}
                className={cn(
                  "flex h-11 items-center justify-center rounded-lg border text-xs font-black uppercase transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:h-7 2xl:rounded-md",
                  isClockRunning
                    ? "border-lime-400 bg-lime-400 text-neutral-950 hover:bg-lime-300"
                    : "border-neutral-700 bg-neutral-100 text-neutral-950 hover:bg-white",
                )}
                type="button"
                onClick={onToggleClock}
              >
                {isClockRunning ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <TimerButton label="+1" onClick={() => onAdjustClock(1)}>
                <Plus size={13} />
                1
              </TimerButton>
              <TimerButton label="+10" onClick={() => onAdjustClock(10)}>
                <Plus size={13} />
                10
              </TimerButton>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 2xl:mt-1 2xl:gap-1">
              <button
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:h-7 2xl:rounded-md"
                type="button"
                onClick={onResetGameClock}
              >
                Reset Q
              </button>
              <button
                className="flex h-10 items-center justify-center gap-1 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:h-7 2xl:rounded-md"
                type="button"
                onClick={startClockEdit}
              >
                <Pencil size={12} />
                Edit Time
              </button>
            </div>
            {/* Youth games do not use a shot clock. */}
            {mode !== "youth" && (
              <>
            <div className="mt-3 flex items-center justify-between 2xl:mt-1">
              <span className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Shot Clock</span>
              <span className="font-mono text-lg font-black tabular-nums text-neutral-100 2xl:text-base">{shotClock}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5 2xl:mt-1 2xl:gap-1">
              <button
                aria-label="Decrease shot clock by one second"
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:h-7 2xl:rounded-md"
                type="button"
                onClick={() => onAdjustShotClock(-1)}
              >
                -1
              </button>
              <button
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:h-7 2xl:rounded-md"
                type="button"
                onClick={() => onResetShotClock(FULL_SHOT_CLOCK)}
              >
                24
              </button>
              <button
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:h-7 2xl:rounded-md"
                type="button"
                onClick={() => onResetShotClock(SHORT_SHOT_CLOCK)}
              >
                14
              </button>
              <button
                aria-label="Increase shot clock by one second"
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:h-7 2xl:rounded-md"
                type="button"
                onClick={() => onAdjustShotClock(1)}
              >
                +1
              </button>
            </div>
              </>
            )}
          </div>

          {/* Period length/count is set on the dashboard; hide it only in the fixed desktop console to save height. */}
          <div className="2xl:hidden">
            <PeriodSettingsControls settings={periodSettings} onChange={onPeriodSettingsChange} />
          </div>
        </div>

        <div className="flex flex-col gap-3 2xl:gap-1.5">
          {mode === "professional" && (
            <label className="flex h-12 items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 2xl:h-8 2xl:rounded-md 2xl:px-3">
              <span className="text-xs font-black uppercase tracking-wide text-neutral-200">Foul on shot</span>
              <input
                checked={foulOnShot}
                className="size-5 accent-amber-400 2xl:size-4"
                disabled={!canRecordShot}
                type="checkbox"
                onChange={(event) => onSetFoulOnShot(event.currentTarget.checked)}
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-lime-500/30 bg-lime-500/10 text-xs font-black uppercase text-lime-200 transition-colors hover:bg-lime-500/20 focus:outline-none focus:ring-2 focus:ring-lime-500/50 2xl:h-8 2xl:rounded-md"
              type="button"
              onClick={() => onFreeThrow(true)}
            >
              <Plus size={17} />
              FT Made
            </button>
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 text-xs font-black uppercase text-red-200 transition-colors hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-500/50 2xl:h-8 2xl:rounded-md"
              type="button"
              onClick={() => onFreeThrow(false)}
            >
              <CircleX size={17} />
              FT Miss
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 lg:gap-1.5">
            {visibleActions.map((action) => {
              const Icon = action.icon;
              // "Warning" opens the 6-type picker; "P. Foul" opens the foul popup (who was
              // fouled + free throws); "Tech" opens the tech popup (player tech = foul, or
              // administrative). Every other action records directly.
              const isWarning = action.key === "warning";
              const isFoul = action.key === "personal foul";
              const isTech = action.key === "tech foul";
              const allowed = isWarning || isFoul || isTech || isActionAllowed(action.key);
              const handleClick = isWarning
                ? onOpenWarning
                : isFoul
                  ? onOpenFoul
                  : isTech
                    ? onOpenTech
                    : () => onAction(action.key);
              return (
                <button
                  className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl border border-neutral-800 bg-neutral-900 text-center transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-35 2xl:h-8 2xl:gap-0 2xl:rounded-md"
                  disabled={!allowed}
                  key={action.key}
                  type="button"
                  onClick={handleClick}
                >
                  <Icon className={cn(action.color, "2xl:size-[18px]")} size={20} />
                  <span className="text-[11px] font-black uppercase text-neutral-100">{action.label}</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 text-xs font-black uppercase text-neutral-100 transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:h-8 2xl:rounded-md"
              type="button"
              onClick={onOpenSubstitution}
            >
              <Shuffle size={18} />
              Sub
            </button>
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs font-black uppercase tracking-wide text-amber-200 transition-colors hover:bg-amber-500/20 focus:outline-none focus:ring-2 focus:ring-amber-500/50 2xl:h-8 2xl:rounded-md"
              type="button"
              onClick={onJumpBall}
            >
              <ArrowUpDown size={18} />
              Jump Ball
            </button>
          </div>

          <button
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 text-xs font-black uppercase tracking-wide text-red-200 transition-colors hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-500/50 2xl:h-8 2xl:rounded-md"
            type="button"
            onClick={onEndGame}
          >
            <Trophy size={18} />
            End Game
          </button>
        </div>

        <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-1 2xl:gap-1.5">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-neutral-500">Current Period</span>
            <select
              aria-label="Select period"
              className="h-12 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm font-bold text-neutral-100 outline-none focus:ring-2 focus:ring-neutral-500 2xl:h-8 2xl:rounded-md 2xl:px-2"
              value={period}
              onChange={(event) => onPeriodChange(Number(event.currentTarget.value) as LiveMatch["period"])}
            >
              {periodOptions.map((value) => (
                <option key={value} value={value}>
                  {getPeriodLabel(value, periodSettings.periodCount)}
                </option>
              ))}
            </select>
          </label>

          <TimeoutPanel
            durationSeconds={timeoutDurationSeconds}
            remainingSeconds={timeoutClockSeconds}
            teams={teams}
            timeoutTeam={timeoutTeam}
            onAdjustDuration={onAdjustTimeoutDuration}
            onAdjustTimeout={onAdjustTimeout}
            onStopClock={onStopTimeoutClock}
          />

          <DevLogPanel
            connectionStatus={connectionStatus}
            isOnline={isOnline}
            isRefreshing={isRefreshing}
            pendingCount={pendingCount}
            syncLog={syncLog}
            syncMessage={syncMessage}
          />
        </div>
      </div>
    </aside>
  );
}

function TimerButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={`Adjust clock ${label} seconds`}
      className="flex h-11 items-center justify-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black text-neutral-200 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:h-7 2xl:rounded-md"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TimeoutPanel({
  durationSeconds,
  remainingSeconds,
  teams,
  timeoutTeam,
  onAdjustDuration,
  onAdjustTimeout,
  onStopClock,
}: {
  durationSeconds: number;
  remainingSeconds: number;
  teams: Record<TeamId, Team>;
  timeoutTeam?: TeamId;
  onAdjustDuration: (seconds: number) => void;
  onAdjustTimeout: (team: TeamId, delta: number) => void;
  onStopClock: () => void;
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 2xl:rounded-md 2xl:p-1.5">
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 2xl:mb-1 2xl:gap-1">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Timeout Clock</div>
          <div className="truncate text-[11px] font-bold text-neutral-400">
            {timeoutTeam ? `${teams[timeoutTeam].label} running` : "Ready"}
          </div>
        </div>
        <span className="font-mono text-base font-black tabular-nums text-neutral-100 2xl:text-sm">
          {secondsToClock(remainingSeconds || durationSeconds)}
        </span>
        <button
          aria-label="Decrease timeout clock by fifteen seconds"
          className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:size-6 2xl:rounded-sm"
          type="button"
          onClick={() => onAdjustDuration(-15)}
        >
          <Minus size={13} />
        </button>
        <button
          aria-label={remainingSeconds > 0 ? "Stop timeout clock" : "Increase timeout clock by fifteen seconds"}
          className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:size-6 2xl:rounded-sm"
          type="button"
          onClick={remainingSeconds > 0 ? onStopClock : () => onAdjustDuration(15)}
        >
          {remainingSeconds > 0 ? <Pause size={13} /> : <Plus size={13} />}
        </button>
      </div>
      <div className="grid gap-1.5 2xl:gap-1">
        {(["away", "home"] as TeamId[]).map((teamId) => (
          <div
            className="grid grid-cols-[44px_minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 2xl:gap-1 2xl:rounded-none 2xl:border-0 2xl:bg-transparent 2xl:p-0"
            key={teamId}
          >
            <span className="text-[10px] font-black uppercase" style={{ color: `var(--c-${teamId}-soft)` }}>
              {teams[teamId].label}
            </span>
            <span className="truncate text-[11px] font-bold text-neutral-400">
              {teams[teamId].name}
            </span>
            <span className="w-7 text-center font-mono text-sm font-black tabular-nums text-neutral-100">
              {teams[teamId].timeouts}
            </span>
            <button
              aria-label={`Remove ${teams[teamId].label} timeout`}
              className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:size-6 2xl:rounded-sm 2xl:bg-neutral-950"
              type="button"
              onClick={() => onAdjustTimeout(teamId, -1)}
            >
              <Minus size={13} />
            </button>
            <button
              aria-label={`Register ${teams[teamId].label} timeout`}
              className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 2xl:size-6 2xl:rounded-sm 2xl:bg-neutral-950"
              type="button"
              onClick={() => onAdjustTimeout(teamId, 1)}
            >
              <Plus size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DevLogPanel({
  connectionStatus,
  isOnline,
  isRefreshing,
  pendingCount,
  syncLog,
  syncMessage,
}: {
  connectionStatus: ConnectionStatus;
  isOnline: boolean;
  isRefreshing: boolean;
  pendingCount: number;
  syncLog: SyncLogEntry[];
  syncMessage: string;
}) {
  const connected = connectionStatus === "connected" && isOnline;
  const statusLabel = !isOnline
    ? "Offline"
    : connectionStatus === "syncing"
      ? "Syncing"
      : connectionStatus === "error"
        ? "Sync Issue"
        : connectionStatus === "connected"
          ? "Live Data"
          : "Local Data";

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 p-3 2xl:rounded-md 2xl:p-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "inline-flex size-2.5 shrink-0 rounded-full",
              !isOnline
                ? "bg-neutral-500"
                : pendingCount > 0
                  ? "bg-amber-400"
                  : connectionStatus === "connected"
                    ? "bg-lime-400 shadow-[0_0_8px] shadow-lime-400/60"
                    : connectionStatus === "syncing"
                      ? "bg-amber-400"
                      : connectionStatus === "error"
                        ? "bg-red-400"
                        : "bg-neutral-500",
            )}
          />
          <div className="min-w-0">
            <h2 className="text-[11px] font-black uppercase tracking-wide text-neutral-300">Sync Status</h2>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500">
              {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
              <span className="truncate">{isRefreshing ? "Refreshing" : statusLabel}</span>
              {pendingCount > 0 && (
                <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                  {pendingCount} queued
                </span>
              )}
            </div>
          </div>
        </div>
        <Gauge className="shrink-0 text-neutral-600" size={16} />
      </div>
      {/* The status row above already conveys connection state; hide the detail line in the fixed tablet layout. */}
      <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-[11px] text-neutral-400 lg:hidden">
        {syncMessage}
      </div>
      {/* The detailed sync history is diagnostic; hide it in the fixed tablet layout to save height. */}
      <div className="mt-2 max-h-24 space-y-1 overflow-y-auto lg:hidden">
        {syncLog.slice(0, VISIBLE_SYNC_LOG_LIMIT).map((entry) => (
          <div className="grid grid-cols-[48px_1fr] gap-2 text-[11px]" key={entry.id}>
            <span className="font-mono text-neutral-600 tabular-nums">{entry.time}</span>
            <div className="min-w-0">
              <div className={cn("truncate font-bold", logLevelClass[entry.level])}>
                {entry.message}
              </div>
              {entry.detail && <div className="truncate text-neutral-500">{entry.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelTitle({ children }: { children: string }) {
  return <h2 className="text-[11px] font-black uppercase tracking-wider text-neutral-400 text-balance">{children}</h2>;
}

function readStoredText(key: string) {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function readStoredNumber(key: string) {
  const value = readStoredText(key);
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readStoredPositiveNumber(key: string) {
  const value = readStoredNumber(key);
  return value && value > 0 ? value : undefined;
}

function readStoredIntegerInRange(key: string, min: number, max: number) {
  const value = readStoredNumber(key);
  if (!value || !Number.isInteger(value)) {
    return undefined;
  }

  return value >= min && value <= max ? value : undefined;
}

function readStoredBoolean(key: string, fallback: boolean) {
  const value = readStoredText(key);

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

function readStoredTeam(key: string, fallback: TeamId): TeamId {
  const value = readStoredText(key);

  return value === "away" || value === "home" ? value : fallback;
}

function readStoredCourtSides(fallback: CourtSides): CourtSides {
  const value = readStoredJson<CourtSides>(STORAGE_KEYS.courtSides);

  if (
    value &&
    (value.left === "away" || value.left === "home") &&
    (value.right === "away" || value.right === "home") &&
    value.left !== value.right
  ) {
    return value;
  }

  return fallback;
}

function readStoredStatsMode(fallback: StatsMode): StatsMode {
  const value = readStoredText(STORAGE_KEYS.mode);

  return value === "professional" || value === "youth" ? value : fallback;
}

function readStoredJson<TValue>(key: string) {
  const value = readStoredText(key);
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as TValue;
  } catch {
    return undefined;
  }
}

type StoredLiveMatch = { gameId: number; savedAt: number; match: LiveMatch };

// Restores the persisted Odoo-backed match only when it belongs to the requested game,
// so one game's data never shows under another game's id.
function readStoredLiveMatch(gameId: number | undefined): LiveMatch | undefined {
  if (!gameId) {
    return undefined;
  }

  const storedMatches = readStoredJson<Record<string, StoredLiveMatch>>(STORAGE_KEYS.liveMatches);
  const storedForGame = storedMatches?.[String(gameId)];
  if (storedForGame?.match) {
    return storedForGame.match;
  }

  // Backward compatibility with the original single-game offline snapshot.
  const legacy = readStoredJson<StoredLiveMatch>(STORAGE_KEYS.liveMatch);
  return legacy && legacy.gameId === gameId && legacy.match ? legacy.match : undefined;
}

function persistStoredLiveMatch(match: LiveMatch) {
  if (!match.gameId) {
    return;
  }

  const snapshot = {
    gameId: match.gameId,
    savedAt: Date.now(),
    match,
  } satisfies StoredLiveMatch;
  writeStoredJson(STORAGE_KEYS.liveMatch, snapshot);
  const storedMatches = readStoredJson<Record<string, StoredLiveMatch>>(STORAGE_KEYS.liveMatches) ?? {};
  const nextMatches = { ...storedMatches, [String(match.gameId)]: snapshot };
  const newest = Object.fromEntries(
    Object.entries(nextMatches)
      .sort(([, first], [, second]) => second.savedAt - first.savedAt)
      .slice(0, 12),
  );
  writeStoredJson(STORAGE_KEYS.liveMatches, newest);
}

function readStoredSyncLog(apiEnabled: boolean) {
  const storedLog = readStoredJson<SyncLogEntry[]>(STORAGE_KEYS.syncLog);
  if (Array.isArray(storedLog) && storedLog.length > 0) {
    return storedLog.slice(0, SYNC_LOG_LIMIT);
  }

  return [
    createLog(
      "info",
      "App ready",
      apiEnabled ? "Live connection configured." : "Using local data until configured.",
    ),
  ];
}

function writeStoredText(key: string, value: string | undefined) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (value === undefined) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in restricted browser contexts.
  }
}

function writeStoredNumber(key: string, value: number | undefined) {
  writeStoredText(key, typeof value === "number" && Number.isFinite(value) ? String(value) : undefined);
}

function writeStoredBoolean(key: string, value: boolean) {
  writeStoredText(key, value ? "true" : undefined);
}

function writeStoredJson(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (value === undefined) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local storage can be unavailable in restricted browser contexts.
  }
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

// Accepts "M:SS" / "MM:SS", or digits-only entered scoreboard-style where the last two
// digits are the seconds ("1000" -> 10:00, "230" -> 2:30, "45" -> 0:45). Returns total
// seconds or undefined. Digits-only is NOT read as a raw seconds count — on a numeric
// tablet keypad the colon is awkward to type, and reading "1000" as 1000s (16:40) was the
// source of the "I typed a number and got a different time" confusion.
function parseClockInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.includes(":")) {
    const [rawMinutes, rawSeconds = "0"] = trimmed.split(":");
    const minutes = Number(rawMinutes);
    const seconds = Number(rawSeconds);
    if (
      !Number.isFinite(minutes) ||
      !Number.isFinite(seconds) ||
      minutes < 0 ||
      seconds < 0 ||
      seconds >= 60
    ) {
      return undefined;
    }
    return clampWholeNumber(minutes * 60 + seconds, 0, 99 * 60 + 59);
  }

  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  // Digits-only: last two digits are seconds, the rest are minutes (MMSS).
  const asNumber = Number(trimmed);
  const minutes = Math.floor(asNumber / 100);
  const seconds = asNumber % 100;
  if (seconds >= 60) {
    return undefined;
  }
  return clampWholeNumber(minutes * 60 + seconds, 0, 99 * 60 + 59);
}

function secondsToMinutes(seconds: number) {
  return Math.round((seconds / 60) * 10) / 10;
}

function minutesToSeconds(minutes: number) {
  return clampWholeNumber(Math.round(minutes * 60), 60, 20 * 60);
}

function clampWholeNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function createPeriodOptions(periodCount: number) {
  return Array.from({ length: periodCount + 1 }, (_, index) => index + 1);
}

function getDefaultClockSeconds(period: LiveMatch["period"], settings: PeriodSettings) {
  return period > settings.periodCount ? settings.overtimeSeconds : settings.periodSeconds;
}

let localPlayerCounter = 0;

function makeLocalPlayerId(team: TeamId | "away" | "home") {
  localPlayerCounter += 1;
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${localPlayerCounter.toString(36)}`;
  return `${team}:${random}`;
}

function buildScheduledMatchShell(option: MatchOption, settings: PeriodSettings): LiveMatch {
  const makeTeam = (
    side: TeamId,
    label: "Visitor" | "Home",
    name: string,
    id?: number,
  ): Team => ({
    accentColor: side === "away" ? option.awayAccentColor : option.homeAccentColor,
    bench: [],
    color: side === "away" ? option.awayColor : option.homeColor,
    fouls: 0,
    id,
    label,
    logoUrl: side === "away" ? option.awayLogoUrl : option.homeLogoUrl,
    name,
    players: [],
    presentCount: 0,
    textColor: side === "away" ? option.awayTextColor : option.homeTextColor,
    timeouts: 0,
  });

  return {
    away: makeTeam("away", "Visitor", option.awayName, option.awayTeamId),
    awayScore: option.awayScore,
    clock: secondsToClock(settings.periodSeconds),
    events: [],
    gameId: option.id,
    home: makeTeam("home", "Home", option.homeName, option.homeTeamId),
    homeScore: option.homeScore,
    matchName: option.name,
    period: 1,
    periodLabel: getPeriodLabel(1, settings.periodCount),
    possession: "home",
    shotClock: FULL_SHOT_CLOCK,
    status: option.status,
    statusNote: option.statusNote,
    syncMessage: "Offline schedule copy — changes are saved on this device.",
  };
}

function validateGameDayRoster(match: LiveMatch): string[] {
  const errors: string[] = [];
  for (const side of ["away", "home"] as TeamId[]) {
    const team = match[side];
    const roster = getRoster(team);
    if (roster.length === 0) {
      errors.push(`${team.name}: add at least one player.`);
      continue;
    }
    for (const player of roster) {
      const error = getGameDayPlayerError(team, player);
      if (error) {
        errors.push(`${team.name}: ${error}`);
      }
    }
  }
  return [...new Set(errors)];
}

function getGameDayPlayerError(team: Team, player: Player): string | undefined {
  const number = player.number.trim();
  if (!number) {
    return "Jersey number is required.";
  }
  if (!/^\d{1,3}$/.test(number)) {
    return "Use a jersey number from 0 to 999.";
  }
  if (!player.name.trim()) {
    return `Player #${number} needs a name.`;
  }
  const duplicateCount = getRoster(team).filter(
    (candidate) =>
      (player.present ?? true) &&
      (candidate.present ?? true) &&
      /^\d{1,3}$/.test(candidate.number.trim()) &&
      Number(candidate.number) === Number(number),
  ).length;
  if (duplicateCount > 1) {
    return `Jersey #${number} is already used on this team.`;
  }
  return undefined;
}

function getRoster(team: Team) {
  return [...team.players, ...team.bench];
}

function findPlayerByKey(team: Team, playerKey: string) {
  return getRoster(team).find((player) => getPlayerKey(player) === playerKey);
}

function findEventPlayer(match: LiveMatch, event: GameEvent) {
  const roster = getRoster(match[event.team]);
  return (
    roster.find((player) => event.playerId && player.id === event.playerId) ??
    roster.find((player) => formatPlayer(player) === event.player) ??
    roster.find((player) => event.player.includes(player.name) && event.player.includes(`#${player.number}`))
  );
}

function normalizeEventPeriod(period: number | undefined, fallback: LiveMatch["period"]): LiveMatch["period"] {
  return period && period >= 1 && period <= 12 ? period : fallback;
}

function createUndoItemFromEvent(match: LiveMatch, event: GameEvent): UndoItem | undefined {
  const player = findEventPlayer(match, event);
  if (!event.action || !player) {
    return undefined;
  }

  const opponentTeam = oppositeTeam(event.team);
  const opponentTurnoverPlayer =
    event.action === "steal"
      ? getRoster(match[opponentTeam]).find((candidate) =>
          event.label.includes(formatPlayer(candidate)) || event.label.includes(candidate.name),
        )
      : undefined;
  const shotValue =
    event.shotLocation?.value ??
    (event.shotType === "3pt" ? 3 : event.shotType === "2pt" ? 2 : event.shotType === "free throw" ? 1 : undefined);
  const detail: ActionDetail = {
    action: event.action,
    label: event.label,
    opponentTurnoverPlayer,
    opponentTurnoverTeam: opponentTurnoverPlayer ? opponentTeam : undefined,
    points: event.points ?? 0,
    shotLocation: event.shotLocation,
    shotMade: event.shotType ? event.icon === "made" : undefined,
    shotType: event.shotType,
    shotValue,
  };

  if (event.shotType === "free throw") {
    detail.freeThrowsAttempted = 1;
    detail.freeThrowsMade = event.points && event.points > 0 ? 1 : 0;
  }

  return {
    detail,
    event,
    eventId: event.id,
    period: normalizeEventPeriod(event.period, match.period),
    playerKey: getPlayerKey(player),
    previousPossession: match.possession,
    previousShotClock: match.shotClock,
    selectedTeam: event.team,
    serverEventId: event.serverEventId,
  };
}

function mergeEventHistory(currentEvents: GameEvent[], loadedEvents: GameEvent[]) {
  const loadedServerIds = new Set(
    loadedEvents
      .map((event) => event.serverEventId ?? event.id)
      .filter((id): id is number => Boolean(id)),
  );
  const loadedLocalIds = new Set(loadedEvents.map((event) => event.id));
  const localOnlyEvents = currentEvents.filter((event) => {
    if (event.serverEventId && loadedServerIds.has(event.serverEventId)) {
      return false;
    }

    return !loadedLocalIds.has(event.id);
  });

  return [...localOnlyEvents, ...loadedEvents];
}

function resolveSelectedPlayer(roster: Player[], selectedKey?: string) {
  return roster.find((player) => getPlayerKey(player) === selectedKey) ?? roster.find((player) => player.active) ?? roster[0];
}

function getPlayerKey(player: Player) {
  return player.localId ? `local:${player.localId}` : player.id ? `id:${player.id}` : `local:${player.number}:${player.name}`;
}

function formatPlayer(player: Player) {
  // The live scoring view is jersey-number only; full names live in the attendance dialog.
  return `#${player.number}`;
}

function getEventPlayerNumber(event: GameEvent, teams: Record<TeamId, Team>): string {
  if (event.foulBall) {
    return "—";
  }

  const roster = getRoster(teams[event.team]);
  const byId = event.playerId ? roster.find((player) => player.id === event.playerId) : undefined;
  if (byId) {
    return `#${byId.number}`;
  }

  // Local events already store "#<number>"; server events store the player's name, so fall
  // back to matching it against the roster to recover the jersey number.
  const lead = event.player.split(/\s+/)[0];
  if (lead.startsWith("#")) {
    return lead;
  }

  const byName = roster.find((player) => player.name === event.player);
  return byName ? `#${byName.number}` : "—";
}

function writeStoredGameDayRoster(match: LiveMatch) {
  if (!match.gameId) {
    return;
  }
  const store = readStoredJson<GameDayRosterStore>(STORAGE_KEYS.gameDayRosters) ?? {};
  const teams = Object.fromEntries(
    (["away", "home"] as TeamId[]).map((side) => [
      side,
      {
        coach: match[side].coach,
        players: getRoster(match[side]),
        starterKeys: match[side].players.map(getPlayerKey),
      },
    ]),
  ) as StoredGameDayRoster["teams"];
  writeStoredJson(STORAGE_KEYS.gameDayRosters, {
    ...store,
    [String(match.gameId)]: { savedAt: Date.now(), teams },
  } satisfies GameDayRosterStore);
}

function applyStoredGameDayRoster(match: LiveMatch): LiveMatch {
  if (!match.gameId) {
    return match;
  }
  const store = readStoredJson<GameDayRosterStore>(STORAGE_KEYS.gameDayRosters);
  const stored = store?.[String(match.gameId)];
  if (!stored) {
    return match;
  }

  return (["away", "home"] as TeamId[]).reduce((nextMatch, side) => {
    const team = nextMatch[side];
    const storedTeam = stored.teams[side];
    if (!storedTeam) {
      return nextMatch;
    }
    const loadedRoster = getRoster(team);
    const resolvedRoster = storedTeam.players.map((storedPlayer) => {
      const loaded = loadedRoster.find((player) =>
        (storedPlayer.id && storedPlayer.id > 0 && player.id === storedPlayer.id) ||
        (storedPlayer.localId && player.localId === storedPlayer.localId) ||
        (player.number === storedPlayer.number && player.name === storedPlayer.name),
      );
      return loaded
        ? {
            ...storedPlayer,
            ...loaded,
            localId: storedPlayer.localId ?? loaded.localId,
            name: storedPlayer.name,
            number: storedPlayer.number,
            present: storedPlayer.present,
          }
        : storedPlayer;
    });
    const starterSet = new Set(storedTeam.starterKeys);
    const players = resolvedRoster
      .filter((player) => starterSet.has(getPlayerKey(player)))
      .slice(0, 5)
      .map((player) => ({ ...player, active: true }));
    const activeSet = new Set(players.map(getPlayerKey));
    const bench = resolvedRoster
      .filter((player) => !activeSet.has(getPlayerKey(player)))
      .map((player) => ({ ...player, active: false }));
    const presentCount = resolvedRoster.filter((player) => player.present ?? true).length;
    return {
      ...nextMatch,
      [side]: {
        ...team,
        bench,
        coach: storedTeam.coach,
        players,
        presentCount,
      },
    };
  }, match);
}

function mergeResolvedRosterIds(current: LiveMatch, resolved: LiveMatch): LiveMatch {
  if (current.gameId !== resolved.gameId) {
    return current;
  }
  const next = (["away", "home"] as TeamId[]).reduce((nextMatch, side) => {
    const resolvedRoster = getRoster(resolved[side]);
    const update = (player: Player): Player => {
      const synced = resolvedRoster.find((candidate) =>
        (player.localId && candidate.localId === player.localId) ||
        (player.id && player.id > 0 && candidate.id === player.id) ||
        (candidate.number === player.number && candidate.name === player.name),
      );
      return synced?.id ? { ...player, id: synced.id, localId: player.localId ?? synced.localId } : player;
    };
    return {
      ...nextMatch,
      [side]: {
        ...nextMatch[side],
        bench: nextMatch[side].bench.map(update),
        id: resolved[side].id ?? nextMatch[side].id,
        players: nextMatch[side].players.map(update),
      },
    };
  }, current);

  return {
    ...next,
    events: next.events.map((event) => {
      if (event.playerId && event.playerId > 0) {
        return event;
      }
      const jersey = event.player.match(/^#(\d+)/)?.[1];
      const player = jersey
        ? getRoster(next[event.team]).find((candidate) => candidate.number === jersey)
        : undefined;
      return player?.id ? { ...event, playerId: player.id } : event;
    }),
  };
}

function rewriteOutboxRoster(op: OutboxOp, resolved: LiveMatch): OutboxOp {
  const replacePlayer = (player: Player | undefined, side: TeamId): Player | undefined => {
    if (!player) {
      return undefined;
    }
    const synced = getRoster(resolved[side]).find((candidate) =>
      (player.localId && candidate.localId === player.localId) ||
      (player.id && player.id > 0 && candidate.id === player.id) ||
      (candidate.number === player.number && candidate.name === player.name),
    );
    return synced?.id ? { ...player, id: synced.id, localId: player.localId ?? synced.localId } : player;
  };

  if (op.kind === "action") {
    const input = op.input;
    return {
      ...op,
      input: {
        ...input,
        match: mergeResolvedRosterIds(input.match, resolved),
        opponentTurnoverPlayer: input.opponentTurnoverTeam
          ? replacePlayer(input.opponentTurnoverPlayer, input.opponentTurnoverTeam)
          : input.opponentTurnoverPlayer,
        player: replacePlayer(input.player, input.selectedTeam) ?? input.player,
      },
    };
  }

  return { ...op, match: mergeResolvedRosterIds(op.match, resolved) };
}

function applyStoredStarters(match: LiveMatch): LiveMatch {
  const store = readStoredJson<StarterSelectionStore>(STORAGE_KEYS.starters) ?? {};
  const selection = store[getStarterStorageId(match)];

  if (!selection) {
    return match;
  }

  return (["away", "home"] as TeamId[]).reduce((nextMatch, team) => {
    const starterKeys = selection[team];
    return starterKeys?.length ? withStarterKeys(nextMatch, team, starterKeys) : nextMatch;
  }, match);
}

function writeStoredStarterKeys(match: LiveMatch, team: TeamId) {
  const store = readStoredJson<StarterSelectionStore>(STORAGE_KEYS.starters) ?? {};
  const matchKey = getStarterStorageId(match);

  writeStoredJson(STORAGE_KEYS.starters, {
    ...store,
    [matchKey]: {
      ...store[matchKey],
      [team]: match[team].players.map(getPlayerKey),
    },
  });
}

function getStarterStorageId(match: LiveMatch) {
  return match.gameId ? `game:${match.gameId}` : `match:${match.matchName}`;
}

function applyStoredAttendance(match: LiveMatch): LiveMatch {
  const store = readStoredJson<AttendanceSelectionStore>(STORAGE_KEYS.attendance) ?? {};
  const selection = store[getStarterStorageId(match)];

  if (!selection) {
    return match;
  }

  return (["away", "home"] as TeamId[]).reduce((nextMatch, team) => {
    const presentByKey = selection[team];
    return presentByKey ? withTeamAttendance(nextMatch, team, presentByKey) : nextMatch;
  }, match);
}

function withTeamAttendance(
  match: LiveMatch,
  team: TeamId,
  presentByKey: Record<string, boolean>,
): LiveMatch {
  const side = match[team];
  const apply = (player: Player): Player => {
    const stored = presentByKey[getPlayerKey(player)];
    return stored === undefined ? player : { ...player, present: stored };
  };
  const players = side.players.map(apply);
  const bench = side.bench.map(apply);
  const presentCount = [...players, ...bench].filter((player) => player.present ?? true).length;

  return {
    ...match,
    [team]: { ...side, bench, players, presentCount },
  };
}

function writeStoredAttendance(match: LiveMatch, team: TeamId) {
  const store = readStoredJson<AttendanceSelectionStore>(STORAGE_KEYS.attendance) ?? {};
  const matchKey = getStarterStorageId(match);
  const presentByKey = getRoster(match[team]).reduce<Record<string, boolean>>((map, player) => {
    map[getPlayerKey(player)] = player.present ?? true;
    return map;
  }, {});

  writeStoredJson(STORAGE_KEYS.attendance, {
    ...store,
    [matchKey]: {
      ...store[matchKey],
      [team]: presentByKey,
    },
  });
}

const OFFICIAL_KEYS: OfficialKey[] = [
  "referee",
  "refereeAssistant",
  "referee3",
  "scorekeeper",
  "scorekeeper2",
];

function applyStoredOfficials(match: LiveMatch): LiveMatch {
  const store = readStoredJson<OfficialsSelectionStore>(STORAGE_KEYS.officials) ?? {};
  const selection = store[getStarterStorageId(match)];

  if (!selection) {
    return match;
  }

  return OFFICIAL_KEYS.reduce<LiveMatch>((nextMatch, key) => {
    const stored = selection[key];
    return stored === undefined ? nextMatch : { ...nextMatch, [key]: stored };
  }, match);
}

function writeStoredOfficials(match: LiveMatch) {
  const store = readStoredJson<OfficialsSelectionStore>(STORAGE_KEYS.officials) ?? {};
  const matchKey = getStarterStorageId(match);
  const officials = OFFICIAL_KEYS.reduce<OfficialsSelection>((map, key) => {
    map[key] = match[key] ?? "";
    return map;
  }, {});

  writeStoredJson(STORAGE_KEYS.officials, {
    ...store,
    [matchKey]: officials,
  });
}

function withStarterToggled(match: LiveMatch, team: TeamId, playerKey: string): LiveMatch {
  const side = match[team];
  const isStarter = side.players.some((player) => getPlayerKey(player) === playerKey);
  const starterKeys = isStarter
    ? side.players.map(getPlayerKey).filter((key) => key !== playerKey)
    : [...side.players.map(getPlayerKey), playerKey];

  return withStarterKeys(match, team, starterKeys);
}

function withStarterKeys(match: LiveMatch, team: TeamId, starterKeys: string[]): LiveMatch {
  const side = match[team];
  const roster = getRoster(side);
  const playersByKey = new Map(roster.map((player) => [getPlayerKey(player), player]));
  const uniqueStarterKeys = [...new Set(starterKeys)].slice(0, 5);
  const starterSet = new Set(uniqueStarterKeys);
  const starters = uniqueStarterKeys
    .map((key) => playersByKey.get(key))
    .filter((player): player is Player => Boolean(player))
    .map((player) => ({ ...player, active: true }));
  const bench = roster
    .filter((player) => !starterSet.has(getPlayerKey(player)))
    .map((player) => ({ ...player, active: false }));

  return {
    ...match,
    [team]: {
      ...side,
      bench,
      players: starters,
    },
  };
}

function withSubstitution(
  match: LiveMatch,
  team: TeamId,
  outKey: string,
  inKey: string,
): LiveMatch {
  const side = match[team];
  const incoming = side.bench.find((player) => getPlayerKey(player) === inKey);
  const outgoing = side.players.find((player) => getPlayerKey(player) === outKey);

  if (!incoming || !outgoing) {
    return match;
  }

  return {
    ...match,
    [team]: {
      ...side,
      bench: side.bench.map((player) =>
        getPlayerKey(player) === inKey ? { ...outgoing, active: false } : player,
      ),
      players: side.players.map((player) =>
        getPlayerKey(player) === outKey ? { ...incoming, active: true } : player,
      ),
    },
  };
}

function withPlayerStatId(match: LiveMatch, team: TeamId, playerKey: string, statId: number): LiveMatch {
  const side = match[team];
  const updatePlayer = (player: Player): Player =>
    getPlayerKey(player) === playerKey ? { ...player, statId } : player;

  return {
    ...match,
    [team]: {
      ...side,
      bench: side.bench.map(updatePlayer),
      players: side.players.map(updatePlayer),
    },
  };
}

function computeEqualization(match: LiveMatch): { points: number; team: TeamId } | undefined {
  const awayPresent = match.away.presentCount;
  const homePresent = match.home.presentCount;
  const diff = Math.abs(awayPresent - homePresent);
  if (diff === 0) {
    return undefined;
  }

  // The short-handed team (fewer present players) receives 2 points per missing player.
  return { points: diff * 2, team: awayPresent < homePresent ? "away" : "home" };
}

function applyEqualization(
  match: LiveMatch,
  equalization: { points: number; team: TeamId },
): LiveMatch {
  const event = buildEqualizationEvent(
    equalization.team,
    equalization.points,
    match.period,
    match.clock,
    match[equalization.team].name,
  );

  return {
    ...match,
    awayScore: match.awayScore + (equalization.team === "away" ? equalization.points : 0),
    homeScore: match.homeScore + (equalization.team === "home" ? equalization.points : 0),
    equalizationApplied: true,
    equalizationPoints: equalization.points,
    equalizationTeam: equalization.team,
    events: [event, ...match.events],
  };
}

function removeEqualization(match: LiveMatch): LiveMatch {
  const points = match.equalizationPoints ?? 0;
  const team = match.equalizationTeam;

  return {
    ...match,
    awayScore: match.awayScore - (team === "away" ? points : 0),
    homeScore: match.homeScore - (team === "home" ? points : 0),
    equalizationApplied: false,
    equalizationPoints: 0,
    equalizationTeam: undefined,
    events: match.events.filter((event) => !event.equalization),
  };
}

function updateMatchAfterAction(
  match: LiveMatch,
  selectedTeam: TeamId,
  currentPlayer: Player,
  detail: ActionDetail,
  event: GameEvent,
  nextAwayScore: number,
  nextHomeScore: number,
): LiveMatch {
  const periodKey = getPlayerPeriodKey(match.period);
  const foulValue = detail.action === "personal foul" || detail.action === "tech foul" ? 1 : 0;
  const side = match[selectedTeam];
  const updatePlayer = (player: Player): Player => {
    if (!isSamePlayer(player, currentPlayer)) {
      if (
        detail.opponentTurnoverPlayer &&
        detail.opponentTurnoverTeam === selectedTeam &&
        isSamePlayer(player, detail.opponentTurnoverPlayer)
      ) {
        return {
          ...player,
          turnovers: player.turnovers + 1,
        };
      }

      return player;
    }

    return {
      ...player,
      assists: player.assists + (detail.action === "assist" ? 1 : 0),
      blocks: player.blocks + (detail.action === "block" ? 1 : 0),
      defensiveRebounds:
        player.defensiveRebounds + (detail.action === "defensive rebound" ? 1 : 0),
      fouls: player.fouls + foulValue,
      techFouls: player.techFouls + (detail.action === "tech foul" ? 1 : 0),
      freeThrowsAttempted: player.freeThrowsAttempted + (detail.freeThrowsAttempted ?? 0),
      freeThrowsMade: player.freeThrowsMade + (detail.freeThrowsMade ?? 0),
      offensiveRebounds:
        player.offensiveRebounds + (detail.action === "offensive rebound" ? 1 : 0),
      points: player.points + detail.points,
      [periodKey]: player[periodKey] + detail.points,
      steals: player.steals + (detail.action === "steal" ? 1 : 0),
      threePointersAttempted:
        player.threePointersAttempted + (detail.shotType === "3pt" ? 1 : 0),
      threePointersMade:
        player.threePointersMade + (detail.shotType === "3pt" && detail.shotMade ? 1 : 0),
      turnovers: player.turnovers + (detail.action === "turnover" ? 1 : 0),
      twoPointersAttempted:
        player.twoPointersAttempted + (detail.shotType === "2pt" ? 1 : 0),
      twoPointersMade:
        player.twoPointersMade + (detail.shotType === "2pt" && detail.shotMade ? 1 : 0),
    };
  };
  const nextPossession = getPossessionAfterAction(match.possession, selectedTeam, detail);
  const possessionChanged = nextPossession !== match.possession;

  return {
    ...match,
    awayScore: nextAwayScore,
    events: [event, ...match.events],
    homeScore: nextHomeScore,
    possession: nextPossession,
    shotClock:
      possessionChanged || detail.shotType === "2pt" || detail.shotType === "3pt"
        ? FULL_SHOT_CLOCK
        : match.shotClock,
    [selectedTeam]: {
      ...side,
      bench: side.bench.map(updatePlayer),
      fouls: side.fouls + foulValue,
      players: side.players.map(updatePlayer),
    },
    ...(detail.opponentTurnoverTeam && detail.opponentTurnoverTeam !== selectedTeam
      ? {
          [detail.opponentTurnoverTeam]: {
            ...match[detail.opponentTurnoverTeam],
            bench: match[detail.opponentTurnoverTeam].bench.map((player) =>
              detail.opponentTurnoverPlayer && isSamePlayer(player, detail.opponentTurnoverPlayer)
                ? { ...player, turnovers: player.turnovers + 1 }
                : player,
            ),
            players: match[detail.opponentTurnoverTeam].players.map((player) =>
              detail.opponentTurnoverPlayer && isSamePlayer(player, detail.opponentTurnoverPlayer)
                ? { ...player, turnovers: player.turnovers + 1 }
                : player,
            ),
          },
        }
      : {}),
  };
}

function revertMatchAfterAction(match: LiveMatch, undoItem: UndoItem): LiveMatch {
  const { detail, event, period, playerKey, previousPossession, previousShotClock, selectedTeam } = undoItem;

  if (detail.action === "substitution" && detail.subTeam && detail.subInKey && detail.subOutKey) {
    const reverted = withSubstitution(match, detail.subTeam, detail.subInKey, detail.subOutKey);
    return {
      ...reverted,
      events: reverted.events.filter((candidate) => candidate.id !== event.id),
    };
  }

  const periodKey = getPlayerPeriodKey(period);
  const foulValue = detail.action === "personal foul" || detail.action === "tech foul" ? 1 : 0;
  const side = match[selectedTeam];
  const isLatestEvent = match.events[0]?.id === event.id;
  const updatePlayer = (player: Player): Player => {
    if (getPlayerKey(player) !== playerKey) {
      if (
        detail.opponentTurnoverPlayer &&
        detail.opponentTurnoverTeam === selectedTeam &&
        isSamePlayer(player, detail.opponentTurnoverPlayer)
      ) {
        return {
          ...player,
          turnovers: subtractStat(player.turnovers, 1),
        };
      }

      return player;
    }

    return {
      ...player,
      assists: subtractStat(player.assists, detail.action === "assist" ? 1 : 0),
      blocks: subtractStat(player.blocks, detail.action === "block" ? 1 : 0),
      defensiveRebounds: subtractStat(
        player.defensiveRebounds,
        detail.action === "defensive rebound" ? 1 : 0,
      ),
      fouls: subtractStat(player.fouls, foulValue),
      techFouls: subtractStat(player.techFouls, detail.action === "tech foul" ? 1 : 0),
      freeThrowsAttempted: subtractStat(player.freeThrowsAttempted, detail.freeThrowsAttempted ?? 0),
      freeThrowsMade: subtractStat(player.freeThrowsMade, detail.freeThrowsMade ?? 0),
      offensiveRebounds: subtractStat(
        player.offensiveRebounds,
        detail.action === "offensive rebound" ? 1 : 0,
      ),
      points: subtractStat(player.points, detail.points),
      [periodKey]: subtractStat(player[periodKey], detail.points),
      steals: subtractStat(player.steals, detail.action === "steal" ? 1 : 0),
      threePointersAttempted: subtractStat(
        player.threePointersAttempted,
        detail.shotType === "3pt" ? 1 : 0,
      ),
      threePointersMade: subtractStat(
        player.threePointersMade,
        detail.shotType === "3pt" && detail.shotMade ? 1 : 0,
      ),
      turnovers: subtractStat(player.turnovers, detail.action === "turnover" ? 1 : 0),
      twoPointersAttempted: subtractStat(
        player.twoPointersAttempted,
        detail.shotType === "2pt" ? 1 : 0,
      ),
      twoPointersMade: subtractStat(
        player.twoPointersMade,
        detail.shotType === "2pt" && detail.shotMade ? 1 : 0,
      ),
    };
  };

  return {
    ...match,
    awayScore: selectedTeam === "away" ? subtractStat(match.awayScore, detail.points) : match.awayScore,
    events: match.events.filter((candidate) => candidate.id !== event.id),
    homeScore: selectedTeam === "home" ? subtractStat(match.homeScore, detail.points) : match.homeScore,
    possession: isLatestEvent ? previousPossession : match.possession,
    shotClock: isLatestEvent ? previousShotClock : match.shotClock,
    [selectedTeam]: {
      ...side,
      bench: side.bench.map(updatePlayer),
      fouls: subtractStat(side.fouls, foulValue),
      players: side.players.map(updatePlayer),
    },
    ...(detail.opponentTurnoverTeam && detail.opponentTurnoverTeam !== selectedTeam
      ? {
          [detail.opponentTurnoverTeam]: {
            ...match[detail.opponentTurnoverTeam],
            bench: match[detail.opponentTurnoverTeam].bench.map((player) =>
              detail.opponentTurnoverPlayer && isSamePlayer(player, detail.opponentTurnoverPlayer)
                ? { ...player, turnovers: subtractStat(player.turnovers, 1) }
                : player,
            ),
            players: match[detail.opponentTurnoverTeam].players.map((player) =>
              detail.opponentTurnoverPlayer && isSamePlayer(player, detail.opponentTurnoverPlayer)
                ? { ...player, turnovers: subtractStat(player.turnovers, 1) }
                : player,
            ),
          },
        }
      : {}),
  };
}

function subtractStat(value: number, delta: number) {
  return Math.max(0, value - delta);
}

function getPossessionAfterAction(
  currentPossession: TeamId,
  selectedTeam: TeamId,
  detail: ActionDetail,
): TeamId {
  if (
    detail.action === "steal" ||
    detail.action === "defensive rebound" ||
    detail.action === "offensive rebound"
  ) {
    return selectedTeam;
  }

  if (detail.action === "turnover") {
    return oppositeTeam(selectedTeam);
  }

  if ((detail.shotType === "2pt" || detail.shotType === "3pt") && detail.shotMade) {
    return oppositeTeam(selectedTeam);
  }

  return currentPossession;
}

function isActionAllowedForMode(action: ActionKey, mode: StatsMode) {
  if (mode === "youth") {
    return (
      action === "free throw made" ||
      action === "free throw missed" ||
      action === "made 2pt" ||
      action === "made 3pt" ||
      action === "missed 2pt" ||
      action === "missed 3pt" ||
      action === "personal foul" ||
      action === "tech foul" ||
      action === "warning" ||
      action === "substitution"
    );
  }

  if (action === "substitution") {
    return true;
  }

  return true;
}

function isSamePlayer(player: Player, currentPlayer: Player) {
  if (player.localId && currentPlayer.localId) {
    return player.localId === currentPlayer.localId;
  }
  if (player.id && currentPlayer.id) {
    return player.id === currentPlayer.id;
  }

  return player.number === currentPlayer.number && player.name === currentPlayer.name;
}

function oppositeTeam(team: TeamId): TeamId {
  return team === "away" ? "home" : "away";
}

function getPlayerPeriodKey(period: LiveMatch["period"]): "q1" | "q2" | "q3" | "q4" | "ot" {
  if (period === 1) {
    return "q1";
  }
  if (period === 2) {
    return "q2";
  }
  if (period === 3) {
    return "q3";
  }
  if (period === 4) {
    return "q4";
  }
  return "ot";
}

function getEventIcon(action: ActionKey, points: number): GameEvent["icon"] {
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

function getShotLabel(location: ShotLocation, made: boolean, foul: boolean) {
  const shot = `${made ? "Made" : "Missed"} ${location.value}PT ${location.zone}`;
  if (!foul) {
    return shot;
  }

  return `${shot} + Foul`;
}

function svgPointToShotLocation(event: PointerEvent<SVGSVGElement>) {
  const svg = event.currentTarget;
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  const renderedWidth = viewBox.width * scale;
  const renderedHeight = viewBox.height * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  const x = ((event.clientX - rect.left - offsetX) / renderedWidth) * viewBox.width;
  const y = ((event.clientY - rect.top - offsetY) / renderedHeight) * viewBox.height;

  if (x < 42 || x > 718 || y < 42 || y > 398) {
    return undefined;
  }

  return classifyShotLocation(clamp(x, 42, 718), clamp(y, 42, 398));
}

function classifyShotLocation(x: number, y: number): ShotLocation {
  const side = x < 380 ? "left" : "right";
  const courtX = side === "left" ? x : 760 - x;
  const threePointBoundaryX = getThreePointBoundaryX(y);
  const cornerThree = courtX <= 144 && (y <= 79 || y >= 361);
  const value: 2 | 3 = courtX >= threePointBoundaryX ? 3 : 2;
  const inPaint = courtX <= 194 && y >= 154 && y <= 286;
  const sideLabel = side === "left" ? "Left" : "Right";
  const zone =
    value === 3
      ? cornerThree
        ? `${sideLabel} Corner`
        : `${sideLabel} Arc`
      : inPaint
        ? "Paint"
        : "Midrange";

  return {
    side,
    value,
    x: Math.round(x),
    y: Math.round(y),
    zone,
  };
}

const threePointLine = {
  topCorner: { x: 42, y: 75 },
  arcStart: { x: 144, y: 79 },
  controlA: { x: 328, y: 82 },
  controlB: { x: 328, y: 358 },
  arcEnd: { x: 144, y: 361 },
  bottomCorner: { x: 42, y: 365 },
};

function getThreePointBoundaryX(y: number) {
  if (y <= threePointLine.arcStart.y) {
    return getLineXAtY(y, threePointLine.topCorner, threePointLine.arcStart);
  }

  if (y >= threePointLine.arcEnd.y) {
    return getLineXAtY(y, threePointLine.arcEnd, threePointLine.bottomCorner);
  }

  let low = 0;
  let high = 1;

  for (let index = 0; index < 24; index += 1) {
    const middle = (low + high) / 2;
    const middleY = cubicBezierValue(
      middle,
      threePointLine.arcStart.y,
      threePointLine.controlA.y,
      threePointLine.controlB.y,
      threePointLine.arcEnd.y,
    );

    if (middleY < y) {
      low = middle;
    } else {
      high = middle;
    }
  }

  const t = (low + high) / 2;
  return cubicBezierValue(
    t,
    threePointLine.arcStart.x,
    threePointLine.controlA.x,
    threePointLine.controlB.x,
    threePointLine.arcEnd.x,
  );
}

function getLineXAtY(y: number, start: { x: number; y: number }, end: { x: number; y: number }) {
  const progress = clamp((y - start.y) / (end.y - start.y), 0, 1);
  return start.x + (end.x - start.x) * progress;
}

function cubicBezierValue(t: number, start: number, controlA: number, controlB: number, end: number) {
  const inverse = 1 - t;
  return (
    inverse ** 3 * start +
    3 * inverse ** 2 * t * controlA +
    3 * inverse * t ** 2 * controlB +
    t ** 3 * end
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}



function isRateLimitLog(entry: SyncLogEntry) {
  return entry.message.includes("429") || Boolean(entry.detail?.includes("429"));
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown connection error";
}

function titleCase(value: string) {
  return value
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default App;
