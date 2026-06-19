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
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import {
  buildEqualizationEvent,
  createLog,
  fallbackMatch,
  getPeriodLabel,
  loadLiveMatch,
  loadMatchOptions,
  saveGameAttendance,
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
  type ShotLocation,
  type ShotType,
  type SyncLogEntry,
  type Team,
  type TeamId,
} from "./api/liveMatch";
import { OdooClient, getOdooConfig } from "./api/odooClient";
import { CourtSvg } from "./components/CourtSvg";
import { cn } from "./lib/cn";

type ConnectionStatus = "connected" | "error" | "local" | "syncing";
type CourtSide = ShotLocation["side"];
type CourtSides = Record<CourtSide, TeamId>;
type PlayerSelection = Partial<Record<TeamId, string>>;
type ScreenMode = "dashboard" | "live";
type StarterSelection = Partial<Record<TeamId, string[]>>;
type StarterSelectionStore = Record<string, StarterSelection>;
type AttendanceSelection = Partial<Record<TeamId, Record<string, boolean>>>;
type AttendanceSelectionStore = Record<string, AttendanceSelection>;
type OfficialKey = "referee" | "refereeAssistant" | "referee3" | "scorekeeper" | "scorekeeper2";
type OfficialsSelection = Partial<Record<OfficialKey, string>>;
type OfficialsSelectionStore = Record<string, OfficialsSelection>;
type StatsMode = "professional" | "youth";

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
  awayName: string;
  homeName: string;
  awayPlayers: CustomPlayerInput[];
  homePlayers: CustomPlayerInput[];
};

function buildCustomTeam(
  label: "Visitor" | "Home",
  name: string,
  inputs: CustomPlayerInput[],
  idBase: number,
): Team {
  const players = inputs
    .filter((input) => input.number.trim().length > 0)
    .map((input, index): Player => ({
      ...WARNING_PLACEHOLDER_PLAYER,
      id: idBase - index, // synthetic negative ids keep player keys unique and off Odoo's range
      name: input.name.trim() || `#${input.number.trim()}`,
      number: input.number.trim(),
      present: true,
    }));

  return {
    bench: players.slice(5).map((player) => ({ ...player, active: false })),
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
  const away = buildCustomTeam("Visitor", setup.awayName, setup.awayPlayers, -1000);
  const home = buildCustomTeam("Home", setup.homeName, setup.homePlayers, -2000);
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
  mode: "pbo:mode",
  customMatch: "pbo:customMatch",
  customMode: "pbo:customMode",
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
  // Custom (local) match mode: a roster typed into the app with no Odoo behind it, for
  // testing. When on, the stored match is restored on load and Odoo polling is paused.
  const initialCustomMode = useMemo(() => readStoredBoolean(STORAGE_KEYS.customMode, false), []);
  const initialCustomMatch = useMemo(
    () => (initialCustomMode ? readStoredJson<LiveMatch>(STORAGE_KEYS.customMatch) : undefined),
    [initialCustomMode],
  );
  const [customMode, setCustomMode] = useState(() => initialCustomMode && Boolean(initialCustomMatch));
  const [customMatchOpen, setCustomMatchOpen] = useState(false);
  const [match, setMatch] = useState<LiveMatch>(() =>
    initialCustomMode && initialCustomMatch ? initialCustomMatch : fallbackMatch,
  );
  const [matchOptions, setMatchOptions] = useState<MatchOption[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<number | undefined>(initialSelectedGameId);
  const [screenMode, setScreenMode] = useState<ScreenMode>(
    initialCustomMode && initialCustomMatch ? "live" : "dashboard",
  );
  const [statsMode, setStatsMode] = useState<StatsMode>(() => readStoredStatsMode("professional"));
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
  const [preGameOpen, setPreGameOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    apiConfig.enabled ? "syncing" : "local",
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>(() =>
    readStoredSyncLog(apiConfig.enabled),
  );
  const arrowChangedThisPeriodRef = useRef(false);
  const canceledEventIdsRef = useRef(new Set<number>());
  const clockRunningRef = useRef(false);
  const inFlightRefreshRef = useRef(false);
  const loadedGameIdRef = useRef<number | undefined>(undefined);
  const matchRef = useRef<LiveMatch>(
    initialCustomMode && initialCustomMatch ? initialCustomMatch : fallbackMatch,
  );
  const customModeRef = useRef(customMode);
  const matchOptionsLoadedRef = useRef(false);
  const preGameOpenRef = useRef(false);
  const pendingRefreshRef = useRef<{ gameId?: number; options: RefreshOptions } | null>(null);
  const previousPossessionRef = useRef<{ playerKey?: string; team: TeamId } | null>(null);
  const rateLimitUntilRef = useRef(0);
  const selectedGameIdRef = useRef<number | undefined>(initialSelectedGameId);
  const selectedPlayersRef = useRef<PlayerSelection>({});

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
    writeStoredBoolean(STORAGE_KEYS.customMode, customMode);
  }, [customMode]);

  // While a custom (local) match is active, persist the whole match so a reload resumes it.
  useEffect(() => {
    if (customMode) {
      writeStoredJson(STORAGE_KEYS.customMatch, match);
    }
  }, [customMode, match]);

  const refreshMatch = useCallback(
    async (gameId?: number, options: RefreshOptions = {}) => {
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

      inFlightRefreshRef.current = true;
      setIsRefreshing(true);
      setConnectionStatus("syncing");

      try {
        const shouldLoadOptions = options.loadOptions || !matchOptionsLoadedRef.current;
        const result = await loadLiveMatch(apiClient, requestedGameId);
        const rateLimited = isRateLimitLog(result.log);
        const optionsResult = shouldLoadOptions && !rateLimited
          ? await loadMatchOptions(apiClient).catch(() => [] as MatchOption[])
          : ([] as MatchOption[]);

        if (rateLimited) {
          rateLimitUntilRef.current = Date.now() + 30000;
        }

        setMatch((current) => {
          if (result.source === "api") {
            loadedGameIdRef.current = result.match.gameId;
          }

          if (apiConfig.enabled && result.source === "local" && current.gameId) {
            return {
              ...current,
              syncMessage: rateLimited
                ? "Rate limited. Holding current live data and retrying shortly."
                : result.log.detail ?? result.log.message,
            };
          }

          const loadedMatch = applyStoredOfficials(applyStoredAttendance(applyStoredStarters(result.match)));

          return {
            ...loadedMatch,
            events: result.source === "api"
              ? mergeEventHistory(
                  current.gameId === loadedMatch.gameId ? current.events : [],
                  loadedMatch.events,
                )
              : current.events,
          };
        });

        if (shouldLoadOptions && !rateLimited) {
          matchOptionsLoadedRef.current = true;
          setMatchOptions(optionsResult);
        }

        const nextGameId = result.source === "api"
          ? result.match.gameId
          : (loadedGameIdRef.current ?? requestedGameId);
        selectedGameIdRef.current = nextGameId;
        setSelectedGameId(nextGameId);
        appendLog(result.log);
        setConnectionStatus(
          result.log.level === "error" ? "error" : result.source === "api" ? "connected" : "local",
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
      void saveMatchFlowState(apiClient, nextMatch).then((result) => {
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

  useEffect(() => {
    // A custom (local) match owns the state; don't load or poll Odoo over it.
    if (customModeRef.current) {
      return undefined;
    }

    void refreshMatch(undefined, { loadOptions: true });

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
    void refreshMatch(gameId, { force: true });
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
    matchRef.current = built;
    setMatch(built);
    writeStoredJson(STORAGE_KEYS.customMatch, built);
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
    void refreshMatch(undefined, { force: true, loadOptions: true });
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
  }

  function setOfficial(field: OfficialKey, value: string) {
    const nextMatch = { ...matchRef.current, [field]: value };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    // Remember officials locally so they survive polls/reloads (and offline).
    writeStoredOfficials(nextMatch);
  }

  function savePreGame() {
    // Keep starters in localStorage too, so they survive an offline reload.
    writeStoredStarterKeys(matchRef.current, "away");
    writeStoredStarterKeys(matchRef.current, "home");
    appendLog(createLog("info", "Saving roster", "Attendance, starters and officials."));

    void saveGameAttendance(apiClient, matchRef.current).then((result) => {
      appendLog(result.log);
      setConnectionStatus(result.log.level === "error" ? "error" : result.saved ? "connected" : "local");
    });

    preGameOpenRef.current = false;
    setPreGameOpen(false);
  }

  function switchCourtSides() {
    setCourtSides((current) => ({
      left: current.right,
      right: current.left,
    }));
    appendLog(createLog("info", "Court sides switched", "Left and right basket assignments were flipped."));
  }

  function setPeriod(period: LiveMatch["period"]) {
    setIsClockRunning(false);
    const periodChanged = period !== matchRef.current.period;

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

    void saveMatchAction(apiClient, {
      ...committedDetail,
      match: nextMatch,
      nextAwayScore,
      nextHomeScore,
      player: actingPlayer,
      selectedTeam: actingTeam,
    }).then((result) => {
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

    void saveMatchAction(apiClient, {
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
    }).then((result) => {
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
      void saveMatchAction(apiClient, {
        action: "substitution",
        label: event.label,
        match: nextMatch,
        nextAwayScore: nextMatch.awayScore,
        nextHomeScore: nextMatch.homeScore,
        note: index === 0 ? reasonText : undefined,
        player: pair.inPlayer,
        points: 0,
        selectedTeam: team,
      }).then((result) => {
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

    void saveMatchAction(apiClient, {
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
    }).then((result) => {
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
  function finishGame(status: "Final" | "Suspended", reason?: string) {
    const current = matchRef.current;
    const reasonText = reason?.trim();
    const winner =
      current.homeScore === current.awayScore
        ? "Tie game"
        : current.homeScore > current.awayScore
          ? `${current.home.name} win`
          : `${current.away.name} win`;

    setIsClockRunning(false);
    setEndGameOpen(false);

    const suspensionEvent: GameEvent | undefined =
      status === "Suspended" && reasonText
        ? {
            action: "suspension",
            icon: getEventIcon("suspension", 0),
            id: Date.now(),
            issuedByRef: true,
            label: `Suspended · ${reasonText}`,
            period: current.period,
            player: "—",
            points: 0,
            team: current.possession,
            time: current.clock,
          }
        : undefined;

    const nextMatch = {
      ...current,
      status,
      events: suspensionEvent ? [suspensionEvent, ...current.events] : current.events,
    };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    appendLog(
      status === "Final"
        ? createLog("success", "Game ended", `${winner} (${current.awayScore}-${current.homeScore})`)
        : createLog(
            "warning",
            "Game suspended",
            `${reasonText ? `${reasonText} · ` : "Resumable · "}${current.awayScore}-${current.homeScore}`,
          ),
    );

    void saveMatchStatus(
      apiClient,
      nextMatch,
      status,
      status === "Suspended" ? reasonText : undefined,
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
      <>
        <GameDashboard
          apiEnabled={apiConfig.enabled}
          connectionStatus={connectionStatus}
          currentMatch={match}
          customMatchActive={customMode}
          isRefreshing={isRefreshing}
          matchOptions={matchOptions}
          periodSettings={periodSettings}
          selectedGameId={selectedGameId}
          statsMode={statsMode}
          syncMessage={match.syncMessage}
          onActivate={activateLiveView}
          onExitCustomMatch={exitCustomMatch}
          onGameSelect={handleGameSelect}
          onOpenCustomMatch={() => setCustomMatchOpen(true)}
          onPeriodSettingsChange={updatePeriodSettings}
          onRefresh={() => refreshMatch(undefined, { force: true, loadOptions: true })}
          onResumeCustomMatch={() => setScreenMode("live")}
          onStatsModeChange={setStatsMode}
        />
        {customMatchOpen && (
          <CustomMatchDialog onClose={() => setCustomMatchOpen(false)} onStart={startCustomMatch} />
        )}
      </>
    );
  }

  return (
    <main
      className="min-h-dvh bg-neutral-950 p-2 text-neutral-100 [font-family:Inter,ui-sans-serif,system-ui,sans-serif] sm:p-3 lg:h-dvh lg:overflow-hidden"
      style={teamColorVars(match.away, match.home)}
    >
      <section className="mx-auto max-w-[1640px] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-800 shadow-2xl shadow-black/50 ring-1 ring-white/5 lg:h-full">
        <div className="grid gap-px bg-neutral-800 md:grid-cols-2 lg:h-full lg:min-h-0 lg:grid-cols-[148px_minmax(0,1fr)_148px_280px] lg:grid-rows-[auto_minmax(0,1fr)_150px] xl:grid-cols-[170px_minmax(0,1fr)_170px_320px] xl:grid-rows-[auto_minmax(0,1fr)_166px] 2xl:grid-cols-[200px_minmax(0,1fr)_200px_350px] 2xl:grid-rows-[auto_minmax(0,1fr)_182px]">
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
            matchOptions={matchOptions}
            periodLabel={getPeriodLabel(match.period, periodSettings.periodCount)}
            selectedGameId={selectedGameId}
            selectedTeam={selectedTeam}
            shotClock={match.shotClock}
            statsMode={statsMode}
            status={match.status}
            onBackToDashboard={() => setScreenMode("dashboard")}
            onGameSelect={handleGameSelect}
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
            onToggleStarter={toggleStarter}
          />

          <RosterPanel
            side="home"
            team={match.home}
            selectedPlayerKey={selectedPlayers.home}
            selectedTeam={selectedTeam === "home"}
            onSelectPlayer={selectPlayer}
            onSelectTeam={() => setSelectedTeam("home")}
            onToggleStarter={toggleStarter}
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
            isRefreshing={isRefreshing}
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
        <EndGameDialog
          away={match.away}
          home={match.home}
          awayScore={match.awayScore}
          homeScore={match.homeScore}
          onClose={closeEndGame}
          onFinish={finishGame}
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
          match={match}
          onChangeOfficial={setOfficial}
          onClose={closePreGame}
          onSave={savePreGame}
          onTogglePresent={togglePresent}
          onToggleStarter={toggleStarter}
        />
      )}
    </main>
  );
}

type GameLocationGroup = {
  games: MatchOption[];
  hasLocation: boolean;
  key: string;
  location: string;
};

type GameDateGroup = {
  dateKey: string;
  dateLabel: string;
  hasDate: boolean;
  locations: GameLocationGroup[];
  total: number;
};

function gameDateKey(datetime?: string): string {
  const trimmed = datetime?.trim() ?? "";
  // Odoo datetimes arrive as "YYYY-MM-DD HH:MM:SS" — the leading 10 chars are the date.
  const datePart = trimmed.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : "";
}

function formatGameDateHeading(dateKey: string): string {
  if (!dateKey) {
    return "Date pending";
  }
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatGameTime(datetime?: string): string {
  const match = datetime?.trim().match(/\b(\d{2}):(\d{2})\b/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function groupGamesByDateAndLocation(options: MatchOption[]): GameDateGroup[] {
  const byDate = new Map<string, MatchOption[]>();
  for (const option of options) {
    const key = gameDateKey(option.datetime);
    const bucket = byDate.get(key);
    if (bucket) {
      bucket.push(option);
    } else {
      byDate.set(key, [option]);
    }
  }

  const groups: GameDateGroup[] = [];
  for (const [dateKey, games] of byDate) {
    const byLocation = new Map<string, MatchOption[]>();
    for (const game of games) {
      const locationKey = (game.location ?? "").trim();
      const bucket = byLocation.get(locationKey);
      if (bucket) {
        bucket.push(game);
      } else {
        byLocation.set(locationKey, [game]);
      }
    }

    const locations: GameLocationGroup[] = [];
    for (const [locationKey, locationGames] of byLocation) {
      locations.push({
        games: locationGames,
        hasLocation: Boolean(locationKey),
        key: locationKey || "__pending__",
        location: locationKey || "Location pending",
      });
    }
    // Named courts first (alphabetical), then any games without a location.
    locations.sort((a, b) => {
      if (a.hasLocation !== b.hasLocation) {
        return a.hasLocation ? -1 : 1;
      }
      return a.location.localeCompare(b.location);
    });

    groups.push({
      dateKey,
      dateLabel: formatGameDateHeading(dateKey),
      hasDate: Boolean(dateKey),
      locations,
      total: games.length,
    });
  }

  // Most recent date first, with undated games last.
  groups.sort((a, b) => {
    if (a.hasDate !== b.hasDate) {
      return a.hasDate ? -1 : 1;
    }
    return b.dateKey.localeCompare(a.dateKey);
  });

  return groups;
}

function GameDashboard({
  apiEnabled,
  connectionStatus,
  currentMatch,
  customMatchActive,
  isRefreshing,
  matchOptions,
  periodSettings,
  selectedGameId,
  statsMode,
  syncMessage,
  onActivate,
  onExitCustomMatch,
  onGameSelect,
  onOpenCustomMatch,
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
  matchOptions: MatchOption[];
  periodSettings: PeriodSettings;
  selectedGameId?: number;
  statsMode: StatsMode;
  syncMessage: string;
  onActivate: (mode: StatsMode, gameId?: number) => void;
  onExitCustomMatch: () => void;
  onGameSelect: (gameId: number | undefined) => void;
  onOpenCustomMatch: () => void;
  onPeriodSettingsChange: (settings: Partial<PeriodSettings>) => void;
  onRefresh: () => void;
  onResumeCustomMatch: () => void;
  onStatsModeChange: (mode: StatsMode) => void;
}) {
  const selectedOption = matchOptions.find((option) => option.id === selectedGameId);
  const dateGroups = useMemo(() => groupGamesByDateAndLocation(matchOptions), [matchOptions]);
  const statusText =
    connectionStatus === "connected"
      ? "Live"
      : connectionStatus === "syncing"
        ? "Syncing"
        : apiEnabled
          ? "Needs attention"
          : "Local";

  return (
    <main className="min-h-dvh bg-neutral-950 p-3 text-neutral-100 [font-family:Inter,ui-sans-serif,system-ui,sans-serif] sm:p-4">
      <section className="mx-auto grid max-w-[1640px] gap-3 sm:gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-900/60 p-4 shadow-xl shadow-black/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-widest text-amber-400">Basketball PBO</div>
              <h1 className="mt-1 text-2xl font-black text-neutral-50 text-balance">Game Dashboard</h1>
            </div>
            <button
              aria-label="Refresh games"
              className="flex size-10 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isRefreshing}
              type="button"
              onClick={onRefresh}
            >
              <RefreshCw className={isRefreshing ? "animate-spin" : ""} size={16} />
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Connection</span>
              <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-neutral-300">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    connectionStatus === "connected"
                      ? "bg-lime-400"
                      : connectionStatus === "syncing"
                        ? "bg-amber-400"
                        : connectionStatus === "error"
                          ? "bg-red-400"
                          : "bg-neutral-500",
                  )}
                />
                {statusText}
              </span>
            </div>
            <div className="mt-2 truncate text-xs text-neutral-500">{syncMessage}</div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <ModeButton
              active={statsMode === "professional"}
              icon={<Target size={17} />}
              label="Professional"
              onClick={() => onStatsModeChange("professional")}
            />
            <ModeButton
              active={statsMode === "youth"}
              icon={<OctagonAlert size={17} />}
              label="Youth"
              onClick={() => onStatsModeChange("youth")}
            />
          </div>

          <div className="mt-3">
            <PeriodSettingsControls
              settings={periodSettings}
              onChange={onPeriodSettingsChange}
            />
          </div>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-neutral-500">Selected Game</span>
            <select
              aria-label="Selected game"
              className="h-12 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm font-bold text-neutral-100 outline-none focus:ring-2 focus:ring-neutral-500"
              value={selectedGameId ?? ""}
              onChange={(event) => onGameSelect(readSelectNumber(event.currentTarget.value))}
            >
              {selectedGameId ? null : <option value="">Choose game</option>}
              {matchOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-neutral-100 text-sm font-black uppercase tracking-wide text-neutral-950 transition-colors hover:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-400"
            type="button"
            onClick={() => onActivate(statsMode, selectedGameId)}
          >
            Activate {statsMode}
            <ChevronRight size={18} />
          </button>

          {/* Custom local match — test with a roster typed in, no Odoo. */}
          {customMatchActive ? (
            <div className="mt-3 rounded-xl border border-violet-500/40 bg-violet-500/10 p-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-violet-300">Custom match active</div>
              <div className="mt-0.5 truncate text-sm font-bold text-neutral-100">{currentMatch.matchName}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-violet-400/50 bg-violet-500/20 text-xs font-black uppercase tracking-wide text-violet-100 transition-colors hover:bg-violet-500/30 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                  type="button"
                  onClick={onResumeCustomMatch}
                >
                  <Play size={14} />
                  Resume
                </button>
                <button
                  className="h-10 rounded-lg border border-neutral-700 bg-neutral-950 text-xs font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
                  type="button"
                  onClick={onExitCustomMatch}
                >
                  Exit
                </button>
              </div>
            </div>
          ) : (
            <button
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 text-sm font-black uppercase tracking-wide text-violet-200 transition-colors hover:bg-violet-500/20 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              type="button"
              onClick={onOpenCustomMatch}
            >
              <Users size={17} />
              Custom Match
            </button>
          )}
        </aside>

        <section className="rounded-2xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-900/60 p-4 shadow-xl shadow-black/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-neutral-50 text-balance">All Games</h2>
              <div className="mt-1 text-xs font-semibold text-neutral-500 tabular-nums">
                {matchOptions.length} loaded
              </div>
            </div>
            {selectedOption && (
              <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-right">
                <div className="text-[10px] font-black uppercase tracking-wide text-neutral-500">Active Selection</div>
                <div className="max-w-[260px] truncate text-sm font-bold">{selectedOption.name}</div>
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-6">
            {dateGroups.map((group) => (
              <div key={group.dateKey || "__pending__"} className="grid gap-3">
                <div className="flex items-center gap-2 border-b border-neutral-800 pb-2">
                  <CalendarDays className="text-amber-400" size={16} />
                  <h3 className="text-sm font-black uppercase tracking-wide text-neutral-100">
                    {group.dateLabel}
                  </h3>
                  <span className="ml-auto text-[11px] font-bold text-neutral-500 tabular-nums">
                    {group.total} {group.total === 1 ? "game" : "games"}
                  </span>
                </div>
                {group.locations.map((locationGroup) => (
                  <div key={locationGroup.key} className="grid gap-2.5">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="text-neutral-500" size={13} />
                      <span
                        className={cn(
                          "text-[11px] font-black uppercase tracking-wide",
                          locationGroup.hasLocation ? "text-neutral-300" : "text-neutral-600",
                        )}
                      >
                        {locationGroup.location}
                      </span>
                      <span className="text-[11px] font-semibold text-neutral-600 tabular-nums">
                        · {locationGroup.games.length}
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {locationGroup.games.map((option) => (
                        <GameCard
                          key={option.id}
                          option={option}
                          selected={option.id === selectedGameId}
                          onActivate={onActivate}
                          onSelect={() => onGameSelect(option.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {matchOptions.length === 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-neutral-700 bg-neutral-950 p-8 text-center">
              <div className="text-sm font-bold text-neutral-300">{currentMatch.matchName}</div>
              <div className="mt-1 text-xs text-neutral-500">No game list loaded.</div>
              <button
                className="mt-4 h-11 rounded-lg border border-neutral-700 bg-neutral-900 px-4 text-xs font-black uppercase tracking-wide text-neutral-200 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
                type="button"
                onClick={onRefresh}
              >
                Refresh Games
              </button>
            </div>
          )}
        </section>
      </section>
    </main>
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
      className={cn(
        "flex h-12 items-center justify-center gap-2 rounded-xl border text-xs font-black uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500",
        active
          ? "border-neutral-100 bg-neutral-100 text-neutral-950 shadow-lg shadow-black/20"
          : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100",
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
  const [awayPlayers, setAwayPlayers] = useState<CustomPlayerInput[]>(emptyCustomRoster);
  const [homePlayers, setHomePlayers] = useState<CustomPlayerInput[]>(emptyCustomRoster);

  const awayValid = awayPlayers.filter((player) => player.number.trim().length > 0).length;
  const homeValid = homePlayers.filter((player) => player.number.trim().length > 0).length;
  const canStart = awayValid >= 1 && homeValid >= 1;

  function start() {
    if (canStart) {
      onStart({ awayName, homeName, awayPlayers, homePlayers });
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
            label="Visitor"
            name={awayName}
            players={awayPlayers}
            validCount={awayValid}
            onNameChange={setAwayName}
            onPlayersChange={setAwayPlayers}
          />
          <CustomTeamColumn
            accent={HOME_FALLBACK.base}
            label="Home"
            name={homeName}
            players={homePlayers}
            validCount={homeValid}
            onNameChange={setHomeName}
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
  label,
  name,
  players,
  validCount,
  onNameChange,
  onPlayersChange,
}: {
  accent: string;
  label: "Visitor" | "Home";
  name: string;
  players: CustomPlayerInput[];
  validCount: number;
  onNameChange: (name: string) => void;
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
  option,
  selected,
  onActivate,
  onSelect,
}: {
  option: MatchOption;
  selected: boolean;
  onActivate: (mode: StatsMode, gameId?: number) => void;
  onSelect: () => void;
}) {
  return (
    <article
      className={cn(
        "rounded-xl border bg-neutral-950 p-4 transition-colors",
        selected ? "border-neutral-200 ring-1 ring-inset ring-neutral-500/40" : "border-neutral-800 hover:border-neutral-700",
      )}
    >
      <button className="block w-full text-left focus:outline-none" type="button" onClick={onSelect}>
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-neutral-400">
            {option.status}
          </span>
          <span className="font-mono text-xs text-neutral-500 tabular-nums">{option.week || `#${option.id}`}</span>
        </div>
        <h3 className="mt-2.5 truncate text-base font-black text-neutral-50">{option.name}</h3>
        <div className="mt-3 grid gap-1.5">
          <GameTeamLine label="Visitor" name={option.awayName} score={option.awayScore} team="away" />
          <GameTeamLine label="Home" name={option.homeName} score={option.homeScore} team="home" />
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
          <Clock3 size={12} />
          <span className="truncate">
            {formatGameTime(option.datetime)
              ? `Tip-off ${formatGameTime(option.datetime)}`
              : option.datetime || "Time pending"}
          </span>
        </div>
      </button>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          className="h-11 rounded-lg border border-neutral-700 bg-neutral-900 text-[11px] font-black uppercase tracking-wide text-neutral-100 transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500"
          type="button"
          onClick={() => onActivate("professional", option.id)}
        >
          Professional
        </button>
        <button
          className="h-11 rounded-lg border border-neutral-700 bg-neutral-900 text-[11px] font-black uppercase tracking-wide text-neutral-100 transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500"
          type="button"
          onClick={() => onActivate("youth", option.id)}
        >
          Youth
        </button>
      </div>
    </article>
  );
}

function GameTeamLine({
  label,
  name,
  score,
  team,
}: {
  label: string;
  name: string;
  score: number;
  team: TeamId;
}) {
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)_36px] items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: `var(--c-${team}-soft)` }}>
        {label}
      </span>
      <span className="truncate text-sm font-bold text-neutral-200">{name}</span>
      <span className="text-right font-mono text-lg font-black tabular-nums text-neutral-50">{score}</span>
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
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 lg:rounded-md lg:p-2">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-neutral-400">
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
      <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-neutral-500">{label}</span>
      <input
        className="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2 text-center text-base font-bold text-neutral-100 outline-none tabular-nums focus:ring-2 focus:ring-neutral-500 lg:h-8 lg:rounded-md lg:text-sm"
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

function teamPalette(color: string | undefined, fallback: { base: string; soft: string }) {
  const base = color ?? fallback.base;
  const soft = color ? lightenHex(color, 0.42) : fallback.soft;
  return { base, soft, tint: hexToRgba(base, 0.1), ring: hexToRgba(base, 0.36) };
}

// Exposes each side's identity color as CSS variables so descendants (score header,
// court labels, rosters, event feed) can reference var(--c-away) / var(--c-home) instead
// of hard-coded red/blue. Falls back to the original palette when no club color is set.
function teamColorVars(away: Team, home: Team): CSSProperties {
  const a = teamPalette(away.color, AWAY_FALLBACK);
  const h = teamPalette(home.color, HOME_FALLBACK);
  return {
    "--c-away": a.base,
    "--c-away-soft": a.soft,
    "--c-away-tint": a.tint,
    "--c-away-ring": a.ring,
    "--c-home": h.base,
    "--c-home-soft": h.soft,
    "--c-home-tint": h.tint,
    "--c-home-ring": h.ring,
  } as CSSProperties;
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
  matchOptions,
  periodLabel,
  selectedGameId,
  selectedTeam,
  shotClock,
  statsMode,
  status,
  onBackToDashboard,
  onGameSelect,
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
  matchOptions: MatchOption[];
  periodLabel: string;
  selectedGameId?: number;
  selectedTeam: TeamId;
  shotClock: number;
  statsMode: StatsMode;
  status: string;
  onBackToDashboard: () => void;
  onGameSelect: (gameId: number | undefined) => void;
  onSelectTeam: (team: TeamId) => void;
  onToggleFoulBall: () => void;
}) {
  return (
    <header className="order-1 grid items-stretch bg-gradient-to-b from-neutral-900/70 to-neutral-950 md:col-span-2 md:grid-cols-[minmax(0,1fr)_minmax(224px,260px)_minmax(0,1fr)] lg:col-span-3 lg:col-start-1 lg:row-start-1 lg:items-center 2xl:grid-cols-[minmax(0,1fr)_290px_minmax(0,1fr)]">
      <TeamHeaderBlock
        align="right"
        color="red"
        fouls={away.fouls}
        label={away.label}
        name={away.name}
        record={away.record}
        score={awayScore}
        selected={selectedTeam === "away"}
        timeouts={away.timeouts}
        onClick={() => onSelectTeam("away")}
      />

      <div className="flex flex-col items-center justify-center gap-2 border-y border-neutral-800 px-3 py-3 text-center md:border-x md:border-y-0 lg:gap-0.5 lg:py-1">
        <div className="flex w-full items-center justify-between gap-2">
          <button
            aria-label="Back to dashboard"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:size-7 lg:rounded-md"
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
              "flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1 lg:rounded-md",
              statsMode === "youth" && "invisible",
            )}
          >
            <span className="text-[9px] font-black uppercase tracking-wide text-neutral-500">SC</span>
            <span className="font-mono text-sm font-black tabular-nums text-neutral-100">{shotClock}</span>
          </div>
        </div>
        <button
          aria-label="Possession arrow"
          className="flex h-9 w-full min-w-0 items-center justify-center gap-2 rounded-lg border bg-neutral-900 px-2 text-[11px] font-black uppercase tracking-wide transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-amber-500/50 lg:h-7 lg:rounded-md"
          style={{ borderColor: `var(--c-${foulBallTeam}-ring)`, color: `var(--c-${foulBallTeam}-soft)` }}
          title="Possession arrow (alternating possession). Tap to flip it — every flip is logged in the event feed."
          type="button"
          onClick={onToggleFoulBall}
        >
          <span className="text-neutral-300">Possession</span>
          <PossessionArrow possession={foulBallTeam} />
          <span>{foulBallTeam === "away" ? "Visitor" : "Home"}</span>
        </button>
        <label className="w-full">
          <span className="sr-only">Select match</span>
          <select
            aria-label="Select match"
            className="h-9 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 text-xs font-bold text-neutral-100 outline-none focus:ring-2 focus:ring-neutral-500 lg:h-8 lg:rounded-md"
            value={selectedGameId ?? ""}
            onChange={(event) => onGameSelect(readSelectNumber(event.currentTarget.value))}
          >
            {selectedGameId ? null : <option value="">{matchName}</option>}
            {matchOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} - {option.awayName} at {option.homeName}
              </option>
            ))}
          </select>
        </label>
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
        color="blue"
        fouls={home.fouls}
        label={home.label}
        name={home.name}
        record={home.record}
        score={homeScore}
        selected={selectedTeam === "home"}
        timeouts={home.timeouts}
        onClick={() => onSelectTeam("home")}
      />
    </header>
  );
}

function TeamHeaderBlock({
  align,
  color,
  fouls,
  label,
  name,
  record,
  score,
  selected,
  timeouts,
  onClick,
}: {
  align: "left" | "right";
  color: "red" | "blue";
  fouls: number;
  label: string;
  name: string;
  record?: string;
  score: number;
  selected: boolean;
  timeouts: number;
  onClick: () => void;
}) {
  const side: TeamId = color === "red" ? "away" : "home";
  const cBase = `var(--c-${side})`;
  const cSoft = `var(--c-${side}-soft)`;
  const cTint = `var(--c-${side}-tint)`;
  const cRing = `var(--c-${side}-ring)`;

  return (
    <button
      className={cn(
        "relative flex items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-neutral-900/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neutral-500 sm:px-4 sm:gap-4 lg:py-1.5",
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
      <div className={cn("min-w-0 max-w-52", align === "right" && "sm:flex sm:flex-col sm:items-end")}>
        <div className="text-[11px] font-black uppercase tracking-wide" style={{ color: cSoft }}>{label}</div>
        <div className="mt-0.5 truncate text-xl font-bold text-neutral-50 sm:text-2xl lg:text-xl">{name}</div>
        {record && <div className="mt-0.5 text-xs font-semibold text-neutral-500 tabular-nums lg:hidden">{record}</div>}
        {/* Fouls and time-outs are kept as two clearly-labelled, separated groups so the numbers
            can't be mis-read as a single "3 to 2". The 7th team foul triggers the bonus (6 balls). */}
        <div className={cn("mt-2 flex flex-col gap-1 lg:mt-1", align === "right" && "sm:items-end")}>
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-wide text-neutral-500">Fouls</span>
            <span className="flex gap-0.5">
              {[0, 1, 2, 3, 4, 5].map((dot) => (
                <span
                  className={cn("size-1.5 rounded-full transition-colors", dot < fouls ? "" : "bg-neutral-700")}
                  style={dot < fouls ? { backgroundColor: cBase } : undefined}
                  key={dot}
                />
              ))}
            </span>
            <span className="font-mono text-sm font-black tabular-nums text-neutral-100 lg:text-base">{fouls}</span>
            {fouls >= 7 && (
              <span className="rounded-full border border-amber-500/60 bg-amber-500/15 px-1.5 py-px text-[9px] font-black uppercase tracking-wide text-amber-300">
                Bonus
              </span>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-wide text-neutral-500">Timeouts</span>
            <span className="font-mono text-sm font-black tabular-nums text-neutral-100 lg:text-base">{timeouts}</span>
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
    const textColor = teams[teamId].textColor ?? (teamColor ? lightenHex(teamColor, 0.42) : fallback.soft);

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
  onToggleStarter,
}: {
  side: TeamId;
  team: Team;
  selectedPlayerKey?: string;
  selectedTeam: boolean;
  onSelectPlayer: (team: TeamId, player: Player) => void;
  onSelectTeam: () => void;
  onToggleStarter: (team: TeamId, player: Player) => void;
}) {
  const isAway = side === "away";
  const cBase = `var(--c-${side})`;
  const cSoft = `var(--c-${side}-soft)`;
  const starterCount = team.players.length;
  const [benchCollapsed, setBenchCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "order-3 flex min-h-0 flex-col self-stretch overflow-hidden bg-neutral-950 lg:row-start-2",
        isAway ? "lg:col-start-1" : "order-4 lg:col-start-3",
      )}
    >
      <button
        className={cn(
          "relative flex h-12 items-center gap-3 border-b border-neutral-800 px-3 pl-4 text-left transition-colors hover:bg-neutral-900/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neutral-500 lg:h-10",
          selectedTeam && "bg-neutral-900",
        )}
        type="button"
        onClick={onSelectTeam}
      >
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1" style={{ backgroundColor: cBase }} />
        <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: cSoft }}>{team.label}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-neutral-200">{team.name}</span>
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
              starterDisabled={false}
              onClick={() => onSelectPlayer(side, player)}
              onToggleStarter={() => onToggleStarter(side, player)}
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
                starterDisabled={starterCount >= 5}
                onClick={() => onSelectPlayer(side, player)}
                onToggleStarter={() => onToggleStarter(side, player)}
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
  starterDisabled,
  onClick,
  onToggleStarter,
}: {
  player: Player;
  selected: boolean;
  compact?: boolean;
  side: TeamId;
  starterDisabled: boolean;
  onClick: () => void;
  onToggleStarter: () => void;
}) {
  const cBase = `var(--c-${side})`;
  return (
    <div
      className="grid w-full grid-cols-[minmax(0,1fr)_44px] items-stretch border-b border-neutral-800 bg-neutral-950 text-neutral-100 transition-colors lg:grid-cols-[minmax(0,1fr)_36px]"
      style={{
        ...(player.active ? { borderLeftWidth: "4px", borderLeftColor: cBase } : null),
        ...(selected ? { backgroundColor: `var(--c-${side}-tint)`, boxShadow: `inset 0 0 0 1px var(--c-${side}-ring)` } : null),
      }}
    >
      <button
        className={cn(
          "grid min-w-0 grid-cols-[44px_1fr_20px] items-center bg-transparent text-left transition-colors hover:bg-neutral-900/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neutral-500",
          compact ? "h-12 lg:h-10" : "h-16 lg:h-12",
        )}
        title={player.name}
        type="button"
        onClick={onClick}
      >
        <div className={cn("pl-2.5 font-mono text-2xl font-black tabular-nums lg:text-xl", player.active ? "text-neutral-50" : "text-neutral-400")}>
          {player.number}
        </div>
        <div className="min-w-0">
          {/* Scoring view shows jersey numbers only — full names live in the pre-game/attendance dialog. */}
          <div className="flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-neutral-500 tabular-nums">
            <span className="text-neutral-300">{player.points}</span>
            <span>PTS</span>
            <span className="text-neutral-700">·</span>
            <span className={cn(player.fouls >= 4 ? "text-amber-400" : "text-neutral-300")}>{player.fouls}</span>
            <span>F</span>
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
      <button
        aria-label={player.active ? `Remove ${player.name} from starters` : `Make ${player.name} a starter`}
        className={cn(
          "flex items-center justify-center border-l border-neutral-800 bg-neutral-950 text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-35",
          player.active && "text-amber-400",
        )}
        disabled={starterDisabled}
        title={player.active ? "Remove starter" : starterDisabled ? "Remove one starter first" : "Make starter"}
        type="button"
        onClick={onToggleStarter}
      >
        <Star fill={player.active ? "currentColor" : "none"} size={16} />
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

function EndGameDialog({
  away,
  home,
  awayScore,
  homeScore,
  onFinish,
  onClose,
}: {
  away: Team;
  home: Team;
  awayScore: number;
  homeScore: number;
  onFinish: (status: "Final" | "Suspended", reason?: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const reasonText = reason.trim();
  // A suspension must record why — the reason is logged, dropped into the play-by-play, and
  // saved so it is visible when the game is resumed.
  const canSuspend = reasonText.length > 0;
  const winner =
    homeScore === awayScore
      ? "Tie game"
      : homeScore > awayScore
        ? `${home.name} win`
        : `${away.name} win`;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-amber-400">End of game</div>
          <button
            aria-label="Close"
            className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            <CircleX size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim">
          <div className="px-4 py-4 text-center">
            <div className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Current score</div>
            <div className="mt-1 flex items-center justify-center gap-3 font-mono text-3xl font-black tabular-nums">
              <span style={{ color: "var(--c-away-soft)" }}>{awayScore}</span>
              <span className="text-neutral-600">–</span>
              <span style={{ color: "var(--c-home-soft)" }}>{homeScore}</span>
            </div>
            <div className="mt-1 text-sm font-bold text-neutral-300">{winner}</div>
          </div>

          <div className="border-t border-neutral-800 px-4 py-3">
            <label className="mb-1.5 flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-neutral-400" htmlFor="suspend-reason">
              Suspension reason
              <span className="text-amber-400">· required to suspend</span>
            </label>
            <input
              className={cn(
                "h-10 w-full rounded-lg border bg-neutral-950 px-3 text-sm font-semibold text-neutral-100 outline-none transition-colors focus:ring-2",
                reasonText.length === 0
                  ? "border-amber-500/50 focus:ring-amber-500/40"
                  : "border-neutral-800 focus:ring-neutral-500",
              )}
              id="suspend-reason"
              placeholder="Why is the game being suspended?"
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUSPENSION_REASON_PRESETS.map((preset) => (
                <button
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500",
                    reason === preset
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
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

          <div className="grid gap-2 px-3 pt-1">
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 text-sm font-black uppercase tracking-wide text-amber-200 transition-colors hover:bg-amber-500/20 focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canSuspend}
              title={canSuspend ? undefined : "Enter a suspension reason first"}
              type="button"
              onClick={() => onFinish("Suspended", reasonText)}
            >
              <Pause size={18} />
              Suspend — resume later
            </button>
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 text-sm font-black uppercase tracking-wide text-red-200 transition-colors hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-500/50"
              type="button"
              onClick={() => onFinish("Final")}
            >
              <Trophy size={18} />
              End game (Final)
            </button>
          </div>

          <div className="px-4 pb-2 pt-3 text-center text-[11px] font-semibold text-neutral-500">
            A suspended game keeps its score, stats &amp; reason and can be reopened from the dashboard to continue.
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
      totals.eff += row.eff;
      return totals;
    },
    {
      pts: 0, fgMade: 0, fgAtt: 0, tpMade: 0, tpAtt: 0, ftMade: 0, ftAtt: 0,
      oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0, eff: 0,
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
  match,
  onChangeOfficial,
  onClose,
  onSave,
  onTogglePresent,
  onToggleStarter,
}: {
  match: LiveMatch;
  onChangeOfficial: (field: OfficialKey, value: string) => void;
  onClose: () => void;
  onSave: () => void;
  onTogglePresent: (team: TeamId, player: Player) => void;
  onToggleStarter: (team: TeamId, player: Player) => void;
}) {
  const awayPresent = match.away.presentCount;
  const homePresent = match.home.presentCount;
  const diff = Math.abs(awayPresent - homePresent);
  const shortTeam = diff === 0 ? undefined : awayPresent < homePresent ? match.away : match.home;
  const eqPoints = diff * 2;

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
              onTogglePresent={onTogglePresent}
              onToggleStarter={onToggleStarter}
            />
            <PreGameTeamColumn
              side="home"
              team={match.home}
              onTogglePresent={onTogglePresent}
              onToggleStarter={onToggleStarter}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3">
          <div className="min-w-0 truncate text-xs font-semibold text-neutral-400 tabular-nums">
            {match.away.players.length}/5 · {match.home.players.length}/5 starters set
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
              className="flex h-10 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 text-xs font-black uppercase tracking-wide text-amber-200 transition-colors hover:bg-amber-500/25 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              type="button"
              onClick={onSave}
            >
              <ClipboardList size={16} />
              Save Roster
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
  onTogglePresent,
  onToggleStarter,
}: {
  side: TeamId;
  team: Team;
  onTogglePresent: (team: TeamId, player: Player) => void;
  onToggleStarter: (team: TeamId, player: Player) => void;
}) {
  const roster = [...team.players, ...team.bench].sort(
    (a, b) => (Number(a.number) || 0) - (Number(b.number) || 0),
  );
  const starterKeys = new Set(team.players.map(getPlayerKey));
  const starterFull = team.players.length >= 5;
  return (
    <div className="bg-neutral-900">
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <span className="min-w-0 truncate text-[11px] font-black uppercase tracking-wide" style={{ color: `var(--c-${side}-soft)` }}>
          {team.label} · {team.name}
        </span>
        <span className="shrink-0 text-[11px] font-black uppercase tracking-wide text-neutral-500 tabular-nums">
          {team.players.length}/5 · {team.presentCount} present
        </span>
      </div>
      <div className="max-h-[46vh] overflow-y-auto scrollbar-slim px-2 pb-2">
        {roster.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs font-semibold text-neutral-500">
            No roster loaded for this team.
          </div>
        ) : (
          roster.map((player) => {
            const key = getPlayerKey(player);
            const isStarter = starterKeys.has(key);
            const present = player.present ?? true;
            return (
              <div
                className={cn(
                  "mb-1 grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2",
                  !present && "opacity-50",
                )}
                key={key}
              >
                <span className="font-mono text-lg font-black tabular-nums text-neutral-100">{player.number}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-neutral-100">{player.name}</span>
                  <span className="block text-[10px] font-black uppercase tracking-wide text-neutral-500">
                    {present ? "Present" : "Absent"}
                    {isStarter ? " · Starter" : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <button
                    aria-label={present ? "Mark absent" : "Mark present"}
                    className={cn(
                      "flex h-8 items-center gap-1 rounded-md border px-2 text-[10px] font-black uppercase tracking-wide transition-colors focus:outline-none focus:ring-2",
                      present
                        ? "border-lime-500/40 bg-lime-500/10 text-lime-300 hover:bg-lime-500/20 focus:ring-lime-500/50"
                        : "border-neutral-700 bg-neutral-900 text-neutral-500 hover:bg-neutral-800 focus:ring-neutral-500",
                    )}
                    type="button"
                    onClick={() => onTogglePresent(side, player)}
                  >
                    <Check size={13} />
                    {present ? "Here" : "Out"}
                  </button>
                  <button
                    aria-label={isStarter ? "Remove starter" : "Add starter"}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-md border transition-colors focus:outline-none focus:ring-2",
                      isStarter
                        ? "border-amber-500/50 bg-amber-500/15 text-amber-300 focus:ring-amber-500/50"
                        : "border-neutral-700 bg-neutral-900 text-neutral-500 hover:bg-neutral-800 focus:ring-neutral-500",
                      !isStarter && starterFull && "cursor-not-allowed opacity-40",
                    )}
                    disabled={!isStarter && starterFull}
                    type="button"
                    onClick={() => onToggleStarter(side, player)}
                  >
                    <Star className={isStarter ? "fill-amber-300" : ""} size={15} />
                  </button>
                </span>
              </div>
            );
          })
        )}
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
    <section className="order-6 grid gap-px overflow-hidden bg-neutral-800 md:col-span-2 md:grid-cols-2 lg:col-span-3 lg:col-start-1 lg:row-start-3 lg:min-h-0 lg:grid-cols-[minmax(300px,1.6fr)_minmax(220px,1fr)]">
      <div className="min-h-0 overflow-hidden bg-neutral-950 p-3 md:col-span-2 lg:col-span-1 lg:p-2">
        <PanelTitle>{`Event Feed (${events.length})`}</PanelTitle>
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-neutral-800 md:max-h-56 lg:mt-1 lg:max-h-[116px] lg:rounded-md 2xl:max-h-[132px]">
          {events.map((event) => (
            <div
              className="grid min-h-11 grid-cols-[26px_48px_minmax(72px,1fr)_minmax(0,1.3fr)_56px_32px_32px] items-center gap-1 border-b border-neutral-800/70 bg-neutral-900/40 px-2 last:border-b-0 lg:min-h-8"
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
                className="flex size-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:size-6"
                type="button"
                onClick={() => onEditEvent(event.id)}
              >
                <Pencil size={13} />
              </button>
              <button
                aria-label={`Undo ${event.label}`}
                className="flex size-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:size-6"
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

      <div className="min-h-0 overflow-hidden bg-neutral-950 p-3 lg:p-2 lg:overflow-y-auto lg:scrollbar-slim">
        <PanelTitle>Game Summary</PanelTitle>
        <div className="mt-2 space-y-1.5 lg:mt-1.5 lg:space-y-1">
          {summary.map((item) => (
            <div
              className="flex items-center justify-between gap-4 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm lg:py-1"
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
  isRefreshing,
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
  isRefreshing: boolean;
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
    <aside className="order-5 flex min-h-0 flex-col bg-neutral-950 p-3 md:col-span-2 lg:col-span-1 lg:col-start-4 lg:row-span-3 lg:row-start-1 lg:h-full lg:overflow-y-auto lg:p-1.5">
      <div className="mb-3 flex items-center justify-between gap-3 lg:mb-1.5">
        <div className="min-w-0">
          <h2 className="text-base font-black uppercase tracking-wide text-neutral-100 text-balance lg:text-sm">Scorer Console</h2>
          <p className="mt-0.5 truncate text-xs font-semibold text-neutral-500 text-pretty lg:hidden">
            {mode === "professional" ? "Professional stat tracking" : "Youth: points, fouls, free throws"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            aria-label="Open live box score"
            className="flex size-10 items-center justify-center rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-300 transition-colors hover:bg-sky-500/20 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 lg:size-8 lg:rounded-md"
            title="Box score: live per-player performance for coaches"
            type="button"
            onClick={onOpenBoxScore}
          >
            <BarChart3 size={17} />
          </button>
          <button
            aria-label="Open pre-game roster, attendance and officials"
            className="flex size-10 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 transition-colors hover:bg-amber-500/20 hover:text-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 lg:size-8 lg:rounded-md"
            title="Pre-game: attendance, starters, referee/scorekeeper, equalization"
            type="button"
            onClick={onOpenPreGame}
          >
            <ClipboardList size={17} />
          </button>
          <button
            aria-label="Reset local match controls"
            className="flex size-10 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:size-8 lg:rounded-md"
            type="button"
            onClick={onResetMatchState}
          >
            <RotateCcw size={17} />
          </button>
          <button
            aria-label="Refresh live data"
            className="flex size-10 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-60 lg:size-8 lg:rounded-md"
            disabled={isRefreshing}
            type="button"
            onClick={onRefresh}
          >
            <RefreshCw className={isRefreshing ? "animate-spin text-neutral-500" : ""} size={17} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 lg:gap-1.5">
        <div className="flex flex-col gap-3 lg:gap-1.5">
          <div className="rounded-xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-900/40 p-3 shadow-sm shadow-black/20 lg:rounded-md lg:p-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Game Clock</span>
              {editingClock ? (
                <input
                  aria-label="Edit remaining time — type mmss (e.g. 1000 = 10:00) or mm:ss"
                  autoFocus
                  className="w-28 rounded-md border border-lime-500/50 bg-neutral-950 px-2 text-right font-mono text-3xl font-black leading-none tabular-nums text-lime-300 outline-none focus:ring-2 focus:ring-lime-500/50 lg:w-20 lg:text-xl"
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
                    "rounded-md font-mono text-3xl font-black leading-none tabular-nums transition-colors hover:text-lime-300 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:text-xl",
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
            <div className="mt-3 grid grid-cols-5 gap-1.5 lg:mt-1 lg:gap-1">
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
                  "flex h-11 items-center justify-center rounded-lg border text-xs font-black uppercase transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-7 lg:rounded-md",
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
            <div className="mt-2 grid grid-cols-2 gap-1.5 lg:mt-1 lg:gap-1">
              <button
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-7 lg:rounded-md"
                type="button"
                onClick={onResetGameClock}
              >
                Reset Q
              </button>
              <button
                className="flex h-10 items-center justify-center gap-1 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-7 lg:rounded-md"
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
            <div className="mt-3 flex items-center justify-between lg:mt-1">
              <span className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Shot Clock</span>
              <span className="font-mono text-lg font-black tabular-nums text-neutral-100 lg:text-base">{shotClock}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5 lg:mt-1 lg:gap-1">
              <button
                aria-label="Decrease shot clock by one second"
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-7 lg:rounded-md"
                type="button"
                onClick={() => onAdjustShotClock(-1)}
              >
                -1
              </button>
              <button
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-7 lg:rounded-md"
                type="button"
                onClick={() => onResetShotClock(FULL_SHOT_CLOCK)}
              >
                24
              </button>
              <button
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-7 lg:rounded-md"
                type="button"
                onClick={() => onResetShotClock(SHORT_SHOT_CLOCK)}
              >
                14
              </button>
              <button
                aria-label="Increase shot clock by one second"
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-7 lg:rounded-md"
                type="button"
                onClick={() => onAdjustShotClock(1)}
              >
                +1
              </button>
            </div>
              </>
            )}
          </div>

          {/* Period length/count is set on the dashboard; hide here in the fixed tablet layout to save height. */}
          <div className="lg:hidden">
            <PeriodSettingsControls settings={periodSettings} onChange={onPeriodSettingsChange} />
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:gap-1.5">
          {mode === "professional" && (
            <label className="flex h-12 items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 lg:h-8 lg:rounded-md lg:px-3">
              <span className="text-xs font-black uppercase tracking-wide text-neutral-200">Foul on shot</span>
              <input
                checked={foulOnShot}
                className="size-5 accent-amber-400 lg:size-4"
                disabled={!canRecordShot}
                type="checkbox"
                onChange={(event) => onSetFoulOnShot(event.currentTarget.checked)}
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-lime-500/30 bg-lime-500/10 text-xs font-black uppercase text-lime-200 transition-colors hover:bg-lime-500/20 focus:outline-none focus:ring-2 focus:ring-lime-500/50 lg:h-8 lg:rounded-md"
              type="button"
              onClick={() => onFreeThrow(true)}
            >
              <Plus size={17} />
              FT Made
            </button>
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 text-xs font-black uppercase text-red-200 transition-colors hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-500/50 lg:h-8 lg:rounded-md"
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
                  className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl border border-neutral-800 bg-neutral-900 text-center transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-35 lg:h-8 lg:gap-0 lg:rounded-md"
                  disabled={!allowed}
                  key={action.key}
                  type="button"
                  onClick={handleClick}
                >
                  <Icon className={cn(action.color, "lg:size-[18px]")} size={20} />
                  <span className="text-[11px] font-black uppercase text-neutral-100">{action.label}</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 text-xs font-black uppercase text-neutral-100 transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-8 lg:rounded-md"
              type="button"
              onClick={onOpenSubstitution}
            >
              <Shuffle size={18} />
              Sub
            </button>
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs font-black uppercase tracking-wide text-amber-200 transition-colors hover:bg-amber-500/20 focus:outline-none focus:ring-2 focus:ring-amber-500/50 lg:h-8 lg:rounded-md"
              type="button"
              onClick={onJumpBall}
            >
              <ArrowUpDown size={18} />
              Jump Ball
            </button>
          </div>

          <button
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 text-xs font-black uppercase tracking-wide text-red-200 transition-colors hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-500/50 lg:h-8 lg:rounded-md"
            type="button"
            onClick={onEndGame}
          >
            <Trophy size={18} />
            End Game
          </button>
        </div>

        <div className="flex flex-col gap-3 lg:gap-1.5">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-neutral-500">Current Period</span>
            <select
              aria-label="Select period"
              className="h-12 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm font-bold text-neutral-100 outline-none focus:ring-2 focus:ring-neutral-500 lg:h-8 lg:rounded-md lg:px-2"
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
            isRefreshing={isRefreshing}
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
      className="flex h-11 items-center justify-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black text-neutral-200 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:h-7 lg:rounded-md"
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
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 lg:rounded-md lg:p-1.5">
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 lg:mb-1 lg:gap-1">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Timeout Clock</div>
          <div className="truncate text-[11px] font-bold text-neutral-400">
            {timeoutTeam ? `${teams[timeoutTeam].label} running` : "Ready"}
          </div>
        </div>
        <span className="font-mono text-base font-black tabular-nums text-neutral-100 lg:text-sm">
          {secondsToClock(remainingSeconds || durationSeconds)}
        </span>
        <button
          aria-label="Decrease timeout clock by fifteen seconds"
          className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:size-6 lg:rounded-sm"
          type="button"
          onClick={() => onAdjustDuration(-15)}
        >
          <Minus size={13} />
        </button>
        <button
          aria-label={remainingSeconds > 0 ? "Stop timeout clock" : "Increase timeout clock by fifteen seconds"}
          className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:size-6 lg:rounded-sm"
          type="button"
          onClick={remainingSeconds > 0 ? onStopClock : () => onAdjustDuration(15)}
        >
          {remainingSeconds > 0 ? <Pause size={13} /> : <Plus size={13} />}
        </button>
      </div>
      <div className="grid gap-1.5 lg:gap-1">
        {(["away", "home"] as TeamId[]).map((teamId) => (
          <div
            className="grid grid-cols-[44px_minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 lg:gap-1 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0"
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
              className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:size-6 lg:rounded-sm lg:bg-neutral-950"
              type="button"
              onClick={() => onAdjustTimeout(teamId, -1)}
            >
              <Minus size={13} />
            </button>
            <button
              aria-label={`Register ${teams[teamId].label} timeout`}
              className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 lg:size-6 lg:rounded-sm lg:bg-neutral-950"
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
  isRefreshing,
  syncLog,
  syncMessage,
}: {
  connectionStatus: ConnectionStatus;
  isRefreshing: boolean;
  syncLog: SyncLogEntry[];
  syncMessage: string;
}) {
  const connected = connectionStatus === "connected";
  const statusLabel =
    connectionStatus === "syncing"
      ? "Syncing"
      : connectionStatus === "error"
        ? "Sync Issue"
        : connected
          ? "Live Data"
          : "Local Data";

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 p-3 lg:rounded-md lg:p-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "inline-flex size-2.5 shrink-0 rounded-full",
              connectionStatus === "connected"
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
  return player.id ? `id:${player.id}` : `local:${player.number}:${player.name}`;
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

function readSelectNumber(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isRateLimitLog(entry: SyncLogEntry) {
  return entry.message.includes("429") || Boolean(entry.detail?.includes("429"));
}

function titleCase(value: string) {
  return value
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default App;
