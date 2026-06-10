import {
  Activity,
  ArrowLeft,
  BarChart3,
  Blocks,
  Check,
  ChevronRight,
  CircleX,
  Clock3,
  ClipboardList,
  Gauge,
  Hand,
  Handshake,
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
  Trophy,
  Undo2,
  UserRoundX,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  createLog,
  fallbackMatch,
  getPeriodLabel,
  loadLiveMatch,
  loadMatchOptions,
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
];

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
  foulOnShot: "pbo:foulOnShot",
  mode: "pbo:mode",
  courtSides: "pbo:courtSides",
  openingJumpWinner: "pbo:openingJumpWinner",
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
  const [match, setMatch] = useState<LiveMatch>(fallbackMatch);
  const [matchOptions, setMatchOptions] = useState<MatchOption[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<number | undefined>(initialSelectedGameId);
  const [screenMode, setScreenMode] = useState<ScreenMode>("dashboard");
  const [statsMode, setStatsMode] = useState<StatsMode>(() => readStoredStatsMode("professional"));
  const [periodSettings, setPeriodSettings] = useState<PeriodSettings>(() => ({
    overtimeSeconds: readStoredPositiveNumber(STORAGE_KEYS.overtimeSeconds) ?? OVERTIME_CLOCK_SECONDS,
    periodCount: readStoredIntegerInRange(STORAGE_KEYS.periodCount, 1, 8) ?? DEFAULT_PERIOD_COUNT,
    periodSeconds: readStoredPositiveNumber(STORAGE_KEYS.periodSeconds) ?? REGULATION_CLOCK_SECONDS,
  }));
  const [selectedTeam, setSelectedTeam] = useState<TeamId>(() =>
    readStoredTeam(STORAGE_KEYS.selectedTeam, "home"),
  );
  const [openingJumpWinner, setOpeningJumpWinner] = useState<TeamId>(() =>
    readStoredTeam(STORAGE_KEYS.openingJumpWinner, "home"),
  );
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
  const [undoStack, setUndoStack] = useState<UndoItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    apiConfig.enabled ? "syncing" : "local",
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>(() =>
    readStoredSyncLog(apiConfig.enabled),
  );
  const canceledEventIdsRef = useRef(new Set<number>());
  const clockRunningRef = useRef(false);
  const inFlightRefreshRef = useRef(false);
  const loadedGameIdRef = useRef<number | undefined>(undefined);
  const matchRef = useRef<LiveMatch>(fallbackMatch);
  const matchOptionsLoadedRef = useRef(false);
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

          const loadedMatch = applyStoredStarters(result.match);

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
    void refreshMatch(undefined, { loadOptions: true });

    if (!apiConfig.enabled) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
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
    writeStoredText(STORAGE_KEYS.openingJumpWinner, openingJumpWinner);
  }, [openingJumpWinner]);

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
  const ballHandler = useMemo(() => {
    const selectedKey = selectedPlayers[match.possession];
    return selectedKey ? findPlayerByKey(match[match.possession], selectedKey) : undefined;
  }, [match, selectedPlayers]);
  const foulBallTeam = useMemo(
    () => getFoulBallTeam(openingJumpWinner, match.period),
    [openingJumpWinner, match.period],
  );
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
      { label: "Away Record", value: match.away.record ?? "Pending" },
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

  function switchCourtSides() {
    setCourtSides((current) => ({
      left: current.right,
      right: current.left,
    }));
    appendLog(createLog("info", "Court sides switched", "Left and right basket assignments were flipped."));
  }

  function setPeriod(period: LiveMatch["period"]) {
    setIsClockRunning(false);
    const nextMatch = {
      ...matchRef.current,
      clock: secondsToClock(getDefaultClockSeconds(period, periodSettings)),
      period,
      periodLabel: getPeriodLabel(period, periodSettings.periodCount),
      shotClock: FULL_SHOT_CLOCK,
    };
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

  function togglePossession() {
    setPossession(oppositeTeam(matchRef.current.possession));
  }

  function toggleOpeningJumpWinner() {
    const nextWinner = oppositeTeam(openingJumpWinner);
    setOpeningJumpWinner(nextWinner);
    appendLog(createLog(
      "info",
      "Opening jump set",
      `${matchRef.current[nextWinner].label} won the opening jump.`,
    ));
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

  function commitAction(detail: ActionDetail) {
    if (!currentPlayer) {
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

    const stealContext = detail.action === "steal" ? getStealTurnoverContext(selectedTeam) : undefined;
    const committedDetail = stealContext
      ? {
          ...detail,
          label: `${detail.label} / TO ${formatPlayer(stealContext.player)}`,
          opponentTurnoverPlayer: stealContext.player,
          opponentTurnoverTeam: stealContext.team,
        }
      : detail;
    const nextAwayScore = match.awayScore + (selectedTeam === "away" ? committedDetail.points : 0);
    const nextHomeScore = match.homeScore + (selectedTeam === "home" ? committedDetail.points : 0);
    const event: GameEvent = {
      action: committedDetail.action,
      icon: getEventIcon(committedDetail.action, committedDetail.points),
      id: Date.now(),
      label: committedDetail.label,
      period: match.period,
      player: formatPlayer(currentPlayer),
      playerId: currentPlayer.id,
      points: committedDetail.points,
      score: committedDetail.points > 0 ? `${nextAwayScore}-${nextHomeScore}` : undefined,
      shotLocation: committedDetail.shotLocation,
      shotType: committedDetail.shotType,
      team: selectedTeam,
      time: match.clock,
    };
    const undoItem: UndoItem = {
      detail: committedDetail,
      event,
      eventId: event.id,
      period: match.period,
      playerKey: getPlayerKey(currentPlayer),
      previousPossession: match.possession,
      previousShotClock: match.shotClock,
      selectedTeam,
    };
    const playerKey = getPlayerKey(currentPlayer);
    const opponentTurnoverKey = committedDetail.opponentTurnoverPlayer
      ? getPlayerKey(committedDetail.opponentTurnoverPlayer)
      : undefined;
    const nextMatch = updateMatchAfterAction(
      match,
      selectedTeam,
      currentPlayer,
      committedDetail,
      event,
      nextAwayScore,
      nextHomeScore,
    );

    matchRef.current = nextMatch;
    setMatch(nextMatch);
    setUndoStack((current) => [undoItem, ...current].slice(0, UNDO_LIMIT));
    previousPossessionRef.current = null;
    appendLog(createLog("info", "Action queued", `${committedDetail.label} - ${currentPlayer.name}`));

    void saveMatchAction(apiClient, {
      ...committedDetail,
      match: nextMatch,
      nextAwayScore,
      nextHomeScore,
      player: currentPlayer,
      selectedTeam,
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
            nextMatch = withPlayerStatId(nextMatch, selectedTeam, playerKey, result.playerStatId);
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
              findPlayerByKey(matchRef.current[selectedTeam], undoItem.playerKey),
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

  function recordCourtShot(location: ShotLocation, made: boolean) {
    const shotPoints = made ? location.value : 0;

    commitAction({
      action: made ? (`made ${location.value}pt` as ActionKey) : (`missed ${location.value}pt` as ActionKey),
      foulOnShot,
      label: getShotLabel(location, made, foulOnShot),
      points: shotPoints,
      shotLocation: location,
      shotMade: made,
      shotType: location.value === 3 ? "3pt" : "2pt",
      shotValue: location.value,
    });
  }

  function recordFreeThrow(made: boolean) {
    commitAction({
      action: made ? "free throw made" : "free throw missed",
      freeThrowsAttempted: 1,
      freeThrowsMade: made ? 1 : 0,
      label: made ? "Free Throw Made" : "Free Throw Missed",
      points: made ? 1 : 0,
      shotMade: made,
      shotType: "free throw",
      shotValue: 1,
    });
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
      label: titleCase(action),
      points: 0,
    });
  }

  function openSubstitution() {
    setSubstitutionTeam(selectedTeam);
  }

  function closeSubstitution() {
    setSubstitutionTeam(undefined);
  }

  function commitSubstitution(team: TeamId, outPlayer: Player, inPlayer: Player) {
    const outKey = getPlayerKey(outPlayer);
    const inKey = getPlayerKey(inPlayer);
    if (outKey === inKey) {
      return;
    }

    const current = matchRef.current;
    const label = `${formatPlayer(inPlayer)} in / ${formatPlayer(outPlayer)} out`;
    const detail: ActionDetail = {
      action: "substitution",
      label,
      points: 0,
      subInKey: inKey,
      subOutKey: outKey,
      subTeam: team,
    };
    const event: GameEvent = {
      action: "substitution",
      icon: getEventIcon("substitution", 0),
      id: Date.now(),
      label,
      period: current.period,
      player: formatPlayer(inPlayer),
      playerId: inPlayer.id,
      points: 0,
      team,
      time: current.clock,
    };
    const undoItem: UndoItem = {
      detail,
      event,
      eventId: event.id,
      period: current.period,
      playerKey: inKey,
      previousPossession: current.possession,
      previousShotClock: current.shotClock,
      selectedTeam: team,
    };
    const swapped = withSubstitution(current, team, outKey, inKey);
    const nextMatch = { ...swapped, events: [event, ...swapped.events] };

    matchRef.current = nextMatch;
    setMatch(nextMatch);
    setUndoStack((stack) => [undoItem, ...stack].slice(0, UNDO_LIMIT));

    if (selectedPlayersRef.current[team] === outKey) {
      const nextSelectedPlayers = { ...selectedPlayersRef.current, [team]: inKey };
      selectedPlayersRef.current = nextSelectedPlayers;
      setSelectedPlayers(nextSelectedPlayers);
    }

    setSubstitutionTeam(undefined);
    appendLog(createLog("info", "Substitution", `${nextMatch[team].name}: ${label}`));

    void saveMatchAction(apiClient, {
      action: "substitution",
      label,
      match: nextMatch,
      nextAwayScore: nextMatch.awayScore,
      nextHomeScore: nextMatch.homeScore,
      player: inPlayer,
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
  }

  function handleSubstitute(outPlayer: Player, inPlayer: Player) {
    if (!substitutionTeam) {
      return;
    }

    commitSubstitution(substitutionTeam, outPlayer, inPlayer);
  }

  function endGame() {
    const current = matchRef.current;
    const winner =
      current.homeScore === current.awayScore
        ? "Tie game"
        : current.homeScore > current.awayScore
          ? `${current.home.name} win`
          : `${current.away.name} win`;
    const confirmed = window.confirm(
      `End the game?\n\nFinal: ${current.away.name} ${current.awayScore} - ${current.homeScore} ${current.home.name}\n${winner}`,
    );
    if (!confirmed) {
      return;
    }

    setIsClockRunning(false);
    const nextMatch = { ...current, status: "Final" };
    matchRef.current = nextMatch;
    setMatch(nextMatch);
    appendLog(createLog("success", "Game ended", `${winner} (${current.awayScore}-${current.homeScore})`));

    void saveMatchStatus(apiClient, nextMatch, "Final").then((result) => {
      appendLog(result.log);
      setConnectionStatus(result.log.level === "error" ? "error" : result.saved ? "connected" : "local");
    });
  }

  function undoEvent(eventId: number) {
    const event = matchRef.current.events.find((candidate) => candidate.id === eventId);
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
      <GameDashboard
        apiEnabled={apiConfig.enabled}
        connectionStatus={connectionStatus}
        currentMatch={match}
        isRefreshing={isRefreshing}
        matchOptions={matchOptions}
        periodSettings={periodSettings}
        selectedGameId={selectedGameId}
        statsMode={statsMode}
        syncMessage={match.syncMessage}
        onActivate={activateLiveView}
        onGameSelect={handleGameSelect}
        onPeriodSettingsChange={updatePeriodSettings}
        onRefresh={() => refreshMatch(undefined, { force: true, loadOptions: true })}
        onStatsModeChange={setStatsMode}
      />
    );
  }

  return (
    <main className="min-h-dvh bg-neutral-950 p-2 text-neutral-100 [font-family:Inter,ui-sans-serif,system-ui,sans-serif] sm:p-3 xl:h-dvh xl:overflow-hidden">
      <section className="mx-auto max-w-[1640px] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-800 shadow-2xl shadow-black/50 ring-1 ring-white/5 xl:h-full">
        <div className="grid gap-px bg-neutral-800 md:grid-cols-2 xl:h-full xl:min-h-0 xl:grid-cols-[230px_minmax(0,1fr)_230px_320px] xl:grid-rows-[auto_minmax(0,1fr)_210px] 2xl:grid-cols-[260px_minmax(0,1fr)_260px_350px] 2xl:grid-rows-[auto_minmax(0,1fr)_224px]">
          <ScoreHeader
            away={match.away}
            awayScore={match.awayScore}
            clock={match.clock}
            home={match.home}
            homeScore={match.homeScore}
            foulBallTeam={foulBallTeam}
            matchName={match.matchName}
            matchOptions={matchOptions}
            openingJumpWinner={openingJumpWinner}
            periodLabel={getPeriodLabel(match.period, periodSettings.periodCount)}
            possession={match.possession}
            selectedGameId={selectedGameId}
            selectedTeam={selectedTeam}
            shotClock={match.shotClock}
            statsMode={statsMode}
            status={match.status}
            onBackToDashboard={() => setScreenMode("dashboard")}
            onGameSelect={handleGameSelect}
            onSelectTeam={setSelectedTeam}
            onToggleOpeningJumpWinner={toggleOpeningJumpWinner}
            onTogglePossession={togglePossession}
          />

          <CourtPanel
            canRecordShot={Boolean(currentPlayer)}
            courtSides={courtSides}
            currentPlayer={currentPlayer}
            events={match.events}
            foulOnShot={foulOnShot}
            selectedTeam={selectedTeam}
            teams={{ away: match.away, home: match.home }}
            onCourtShot={recordCourtShot}
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
            ballHandlerName={ballHandler ? formatPlayer(ballHandler) : "Unassigned"}
            events={match.events}
            foulBallTeam={foulBallTeam}
            possession={match.possession}
            possessionTeam={match[match.possession].name}
            score={`${match.awayScore}-${match.homeScore}`}
            shotClock={match.shotClock}
            summary={summary}
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
            onOpenSubstitution={openSubstitution}
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
          team={match[substitutionTeam]}
          onClose={closeSubstitution}
          onSubstitute={handleSubstitute}
        />
      )}
    </main>
  );
}

function GameDashboard({
  apiEnabled,
  connectionStatus,
  currentMatch,
  isRefreshing,
  matchOptions,
  periodSettings,
  selectedGameId,
  statsMode,
  syncMessage,
  onActivate,
  onGameSelect,
  onPeriodSettingsChange,
  onRefresh,
  onStatsModeChange,
}: {
  apiEnabled: boolean;
  connectionStatus: ConnectionStatus;
  currentMatch: LiveMatch;
  isRefreshing: boolean;
  matchOptions: MatchOption[];
  periodSettings: PeriodSettings;
  selectedGameId?: number;
  statsMode: StatsMode;
  syncMessage: string;
  onActivate: (mode: StatsMode, gameId?: number) => void;
  onGameSelect: (gameId: number | undefined) => void;
  onPeriodSettingsChange: (settings: Partial<PeriodSettings>) => void;
  onRefresh: () => void;
  onStatsModeChange: (mode: StatsMode) => void;
}) {
  const selectedOption = matchOptions.find((option) => option.id === selectedGameId);
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

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {matchOptions.map((option) => (
              <GameCard
                key={option.id}
                option={option}
                selected={option.id === selectedGameId}
                onActivate={onActivate}
                onSelect={() => onGameSelect(option.id)}
              />
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
          <GameTeamLine label="Away" name={option.awayName} score={option.awayScore} team="away" />
          <GameTeamLine label="Home" name={option.homeName} score={option.homeScore} team="home" />
        </div>
        <div className="mt-3 grid gap-1 text-xs text-neutral-500">
          <div className="truncate">{option.datetime || "Date pending"}</div>
          <div className="truncate">{option.location || "Location pending"}</div>
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
      <span className={cn("text-[10px] font-black uppercase tracking-wide", team === "away" ? "text-red-400" : "text-blue-400")}>
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
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 xl:rounded-md xl:p-2">
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
        className="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2 text-center text-base font-bold text-neutral-100 outline-none tabular-nums focus:ring-2 focus:ring-neutral-500 xl:h-8 xl:rounded-md xl:text-sm"
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

function ScoreHeader({
  away,
  awayScore,
  clock,
  foulBallTeam,
  home,
  homeScore,
  matchName,
  matchOptions,
  openingJumpWinner,
  periodLabel,
  possession,
  selectedGameId,
  selectedTeam,
  shotClock,
  statsMode,
  status,
  onBackToDashboard,
  onGameSelect,
  onSelectTeam,
  onToggleOpeningJumpWinner,
  onTogglePossession,
}: {
  away: Team;
  awayScore: number;
  clock: string;
  foulBallTeam: TeamId;
  home: Team;
  homeScore: number;
  matchName: string;
  matchOptions: MatchOption[];
  openingJumpWinner: TeamId;
  periodLabel: string;
  possession: TeamId;
  selectedGameId?: number;
  selectedTeam: TeamId;
  shotClock: number;
  statsMode: StatsMode;
  status: string;
  onBackToDashboard: () => void;
  onGameSelect: (gameId: number | undefined) => void;
  onSelectTeam: (team: TeamId) => void;
  onToggleOpeningJumpWinner: () => void;
  onTogglePossession: () => void;
}) {
  return (
    <header className="order-1 grid items-stretch bg-gradient-to-b from-neutral-900/70 to-neutral-950 md:col-span-2 md:grid-cols-[minmax(0,1fr)_minmax(224px,260px)_minmax(0,1fr)] xl:col-span-3 xl:col-start-1 xl:row-start-1 xl:items-center 2xl:grid-cols-[minmax(0,1fr)_290px_minmax(0,1fr)]">
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

      <div className="flex flex-col items-center justify-center gap-2 border-y border-neutral-800 px-3 py-3 text-center md:border-x md:border-y-0 xl:gap-1 xl:py-1.5">
        <div className="flex w-full items-center justify-between gap-2">
          <button
            aria-label="Back to dashboard"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:size-7 xl:rounded-md"
            type="button"
            onClick={onBackToDashboard}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-neutral-300">
            <span className="block truncate">{statsMode}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1 xl:rounded-md">
            <span className="text-[9px] font-black uppercase tracking-wide text-neutral-500">SC</span>
            <span className="font-mono text-sm font-black tabular-nums text-neutral-100">{shotClock}</span>
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 xl:gap-1.5">
          <button
            aria-label="Switch live possession"
            className="flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 text-[11px] font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:h-7 xl:rounded-md"
            title="Switch live possession"
            type="button"
            onClick={onTogglePossession}
          >
            <span>Poss</span>
            <PossessionArrow possession={possession} />
          </button>
          <button
            aria-label="Switch opening jump winner"
            className="flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 text-[11px] font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:h-7 xl:rounded-md"
            title={`Foul ball alternates by period. Opening jump: ${openingJumpWinner}.`}
            type="button"
            onClick={onToggleOpeningJumpWinner}
          >
            <span>Foul</span>
            <PossessionArrow possession={foulBallTeam} />
          </button>
        </div>
        <label className="w-full">
          <span className="sr-only">Select match</span>
          <select
            aria-label="Select match"
            className="h-9 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 text-xs font-bold text-neutral-100 outline-none focus:ring-2 focus:ring-neutral-500 xl:h-8 xl:rounded-md"
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
        <div className="mt-0.5 font-mono text-5xl font-black leading-none text-neutral-50 tabular-nums xl:text-4xl 2xl:text-5xl">
          {clock}
        </div>
        <div className="rounded-full bg-amber-400/10 px-3 py-0.5 text-[11px] font-black uppercase tracking-wide text-amber-300">
          {periodLabel}
        </div>
        <div className="flex max-w-full items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-neutral-500">
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
  const accent = color === "red" ? "text-red-400" : "text-blue-400";
  const dotAccent = color === "red" ? "bg-red-500" : "bg-blue-400";
  const barAccent = color === "red" ? "bg-red-500/70" : "bg-blue-500/70";
  const selectedTint =
    color === "red"
      ? "bg-red-500/[0.07] ring-1 ring-inset ring-red-500/30"
      : "bg-blue-500/[0.07] ring-1 ring-inset ring-blue-500/30";

  return (
    <button
      className={cn(
        "relative flex items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-neutral-900/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neutral-500 sm:px-4 sm:gap-4 xl:py-1.5",
        align === "right" ? "justify-start sm:justify-end sm:text-right" : "justify-start",
        selected && selectedTint,
      )}
      type="button"
      onClick={onClick}
    >
      <span aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 h-0.5", barAccent)} />
      {align === "right" && (
        <div className="hidden sm:block">
          <ScoreNumber value={score} />
        </div>
      )}
      <div className={cn("min-w-0 max-w-52", align === "right" && "sm:flex sm:flex-col sm:items-end")}>
        <div className={cn("text-[11px] font-black uppercase tracking-wide", accent)}>{label}</div>
        <div className="mt-0.5 truncate text-xl font-bold text-neutral-50 sm:text-2xl xl:text-xl">{name}</div>
        {record && <div className="mt-0.5 text-xs font-semibold text-neutral-500 tabular-nums xl:hidden">{record}</div>}
        <div className={cn("mt-2 flex items-center gap-2 xl:mt-1", align === "right" && "sm:justify-end")}>
          <span className="text-[10px] font-black uppercase tracking-wide text-neutral-500">Fouls</span>
          <span className="font-mono text-lg font-black tabular-nums text-neutral-200">{fouls}</span>
          <span className="ml-1 text-[10px] font-black uppercase tracking-wide text-neutral-500">TO</span>
          <span className="font-mono text-lg font-black tabular-nums text-neutral-200">{timeouts}</span>
          <span className={cn("flex gap-1", align === "right" && "sm:order-first")}>
            {[0, 1, 2, 3, 4].map((dot) => (
              <span
                className={cn("size-2 rounded-full transition-colors", dot < fouls ? dotAccent : "bg-neutral-700")}
                key={dot}
              />
            ))}
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
    <span className="font-mono text-5xl font-black leading-none text-neutral-100 tabular-nums xl:text-5xl">
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
  canRecordShot,
  courtSides,
  currentPlayer,
  events,
  foulOnShot,
  selectedTeam,
  onCourtShot,
  onSwitchCourtSides,
  teams,
}: {
  canRecordShot: boolean;
  courtSides: CourtSides;
  currentPlayer?: Player;
  events: GameEvent[];
  foulOnShot: boolean;
  selectedTeam: TeamId;
  onCourtShot: (location: ShotLocation, made: boolean) => void;
  onSwitchCourtSides: () => void;
  teams: Record<TeamId, Team>;
}) {
  const [pendingShot, setPendingShot] = useState<ShotLocation | undefined>(undefined);
  const currentPlayerKey = currentPlayer ? getPlayerKey(currentPlayer) : "";
  const markers = events.filter((event) => event.shotLocation).slice(0, 8);
  const selectedSide = getCourtSideForTeam(courtSides, selectedTeam);
  const pendingSideTeam = pendingShot ? courtSides[pendingShot.side] : undefined;

  useEffect(() => {
    setPendingShot(undefined);
  }, [currentPlayerKey, selectedTeam]);

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!canRecordShot) {
      return;
    }

    const location = svgPointToShotLocation(event);
    if (location) {
      setPendingShot(location);
    }
  }

  function commitPendingShot(made: boolean) {
    if (!pendingShot) {
      return;
    }

    onCourtShot(pendingShot, made);
    setPendingShot(undefined);
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
    const accentColor = teamId === "away" ? "#ef4444" : "#3b82f6";
    const textColor = teamId === "away" ? "#fca5a5" : "#93c5fd";

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
    <section className="relative order-2 self-stretch overflow-hidden bg-neutral-950 md:col-span-2 xl:col-span-1 xl:col-start-2 xl:row-start-2 xl:min-h-0">
      <div className="absolute left-3 top-3 z-10 rounded-xl border border-neutral-800 bg-neutral-950/85 px-3 py-2 shadow-lg shadow-black/40 backdrop-blur">
        <div className="text-[10px] font-black uppercase tracking-wide text-neutral-500">Selected Shooter</div>
        <div className="mt-0.5 max-w-[200px] truncate text-sm font-bold text-neutral-50">
          {currentPlayer ? formatPlayer(currentPlayer) : "Choose player"}
        </div>
      </div>
      <button
        aria-label="Switch court sides"
        className="absolute right-3 top-3 z-10 flex h-10 items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950/85 px-3 text-xs font-black uppercase tracking-wide text-neutral-300 shadow-lg shadow-black/40 backdrop-blur transition-colors hover:bg-neutral-900 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-50 xl:h-9"
        type="button"
        onClick={onSwitchCourtSides}
      >
        <Shuffle size={16} />
        <span className="hidden sm:inline">Switch Courts</span>
      </button>
      {pendingShot && (
        <div className="absolute right-3 top-16 z-20 w-[260px] rounded-xl border border-neutral-700 bg-neutral-950/90 p-3 shadow-2xl shadow-black/50 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-wide text-neutral-500">Pending Shot</div>
              <div className="mt-0.5 truncate text-base font-black text-neutral-50">
                {pendingShot.value}PT {pendingShot.zone}
              </div>
            </div>
            <div
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide",
                selectedTeam === "away"
                  ? "border-red-500/60 bg-red-500/10 text-red-300"
                  : "border-blue-500/60 bg-blue-500/10 text-blue-300",
              )}
            >
              {teams[selectedTeam].label}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-lg border border-lime-500/50 bg-lime-500/15 text-xs font-black uppercase text-lime-200 transition-colors hover:bg-lime-500/25 focus:outline-none focus:ring-2 focus:ring-lime-500/50 xl:h-10"
              type="button"
              onClick={() => commitPendingShot(true)}
            >
              <Target size={16} />
              Made
            </button>
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-lg border border-red-500/50 bg-red-500/15 text-xs font-black uppercase text-red-200 transition-colors hover:bg-red-500/25 focus:outline-none focus:ring-2 focus:ring-red-500/50 xl:h-10"
              type="button"
              onClick={() => commitPendingShot(false)}
            >
              <CircleX size={16} />
              Missed
            </button>
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500">
            <span className="truncate">Basket: {pendingSideTeam ? teams[pendingSideTeam].name : "--"}</span>
            {foulOnShot && <span className="text-amber-400">+ Foul</span>}
          </div>
          <button
            className="mt-2.5 h-9 w-full rounded-lg border border-neutral-800 bg-neutral-900 text-[11px] font-black uppercase tracking-wide text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:h-7"
            type="button"
            onClick={() => setPendingShot(undefined)}
          >
            Cancel
          </button>
        </div>
      )}
      <CourtSvg
        aria-label={
          canRecordShot
            ? `Tap court to choose shot result for ${selectedTeam} shooting ${selectedSide}`
            : "Choose a player before recording a court shot"
        }
        className={cn(
          "block h-[320px] w-full touch-manipulation select-none md:h-[420px] lg:h-[460px] xl:h-full xl:min-h-0",
          canRecordShot ? "cursor-crosshair" : "cursor-not-allowed opacity-75",
        )}
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
  const accent = isAway ? "bg-red-500" : "bg-blue-500";
  const borderAccent = isAway ? "border-l-red-500" : "border-l-blue-500";
  const starterCount = team.players.length;

  return (
    <aside
      className={cn(
        "order-3 flex min-h-0 flex-col self-stretch overflow-hidden bg-neutral-950 xl:row-start-2",
        isAway ? "xl:col-start-1" : "order-4 xl:col-start-3",
      )}
    >
      <button
        className={cn(
          "relative flex h-12 items-center gap-3 border-b border-neutral-800 px-3 pl-4 text-left transition-colors hover:bg-neutral-900/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neutral-500 xl:h-10",
          selectedTeam && "bg-neutral-900",
        )}
        type="button"
        onClick={onSelectTeam}
      >
        <span aria-hidden className={cn("pointer-events-none absolute inset-y-0 left-0 w-1", isAway ? "bg-red-500/70" : "bg-blue-500/70")} />
        <span className={cn("text-[11px] font-black uppercase tracking-wide", isAway ? "text-red-400" : "text-blue-400")}>{team.label}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-neutral-200">{team.name}</span>
        <span className="shrink-0 rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[11px] font-black tabular-nums text-neutral-400">
          {starterCount}/5
        </span>
      </button>
      {/* Starters: pinned, always visible so the current 5 never scroll out of view. */}
      <div className="shrink-0">
        {team.players.map((player) => (
          <PlayerRow
            accent={accent}
            borderAccent={borderAccent}
            key={getPlayerKey(player)}
            player={player}
            selected={selectedTeam && selectedPlayerKey === getPlayerKey(player)}
            starterDisabled={false}
            onClick={() => onSelectPlayer(side, player)}
            onToggleStarter={() => onToggleStarter(side, player)}
          />
        ))}
      </div>
      {/* Bench: scrolls in whatever space is left below the starters. */}
      {team.bench.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim">
          <div className="sticky top-0 z-10 border-y border-neutral-800 bg-neutral-900/95 px-4 py-1 text-[11px] font-black uppercase tracking-wide text-neutral-500 backdrop-blur">
            Bench
          </div>
          {team.bench.map((player) => (
            <PlayerRow
              accent={accent}
              borderAccent={borderAccent}
              compact
              key={getPlayerKey(player)}
              player={player}
              selected={selectedTeam && selectedPlayerKey === getPlayerKey(player)}
              starterDisabled={starterCount >= 5}
              onClick={() => onSelectPlayer(side, player)}
              onToggleStarter={() => onToggleStarter(side, player)}
            />
          ))}
        </div>
      )}
      {team.bench.length === 0 && <div className="min-h-0 flex-1" />}
      <div className="shrink-0 border-t border-neutral-800 p-2 xl:p-1.5">
        <button
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 text-xs font-black uppercase tracking-wide text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:h-8 xl:rounded-md"
          type="button"
        >
          <BarChart3 size={16} />
          Team Stats
        </button>
      </div>
    </aside>
  );
}

function PlayerRow({
  player,
  selected,
  compact = false,
  accent,
  borderAccent,
  starterDisabled,
  onClick,
  onToggleStarter,
}: {
  player: Player;
  selected: boolean;
  compact?: boolean;
  accent: string;
  borderAccent: string;
  starterDisabled: boolean;
  onClick: () => void;
  onToggleStarter: () => void;
}) {
  const isRed = borderAccent.includes("red");
  return (
    <div
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_44px] items-stretch border-b border-neutral-800 bg-neutral-950 text-neutral-100 transition-colors xl:grid-cols-[minmax(0,1fr)_36px]",
        player.active && cn("border-l-4", borderAccent),
        selected &&
          (isRed
            ? "bg-red-500/[0.06] ring-1 ring-inset ring-red-500/40"
            : "bg-blue-500/[0.06] ring-1 ring-inset ring-blue-500/40"),
      )}
    >
      <button
        className={cn(
          "grid min-w-0 grid-cols-[52px_1fr_28px] items-center bg-transparent text-left transition-colors hover:bg-neutral-900/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neutral-500",
          compact ? "h-12 xl:h-10" : "h-16 xl:h-12",
        )}
        type="button"
        onClick={onClick}
      >
        <div className={cn("pl-3 font-mono text-2xl font-black tabular-nums", player.active ? "text-neutral-50" : "text-neutral-400")}>
          {player.number}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-neutral-100">{player.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-neutral-500 tabular-nums">
            <span className="text-neutral-300">{player.points}</span>
            <span>PTS</span>
            <span className="text-neutral-700">·</span>
            <span className={cn(player.fouls >= 4 ? "text-amber-400" : "text-neutral-300")}>{player.fouls}</span>
            <span>F</span>
            {player.position ? (
              <>
                <span className="text-neutral-700">·</span>
                <span>{player.position}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex items-center justify-center">
          {selected ? (
            <span className={cn("flex size-5 items-center justify-center rounded-full", isRed ? "bg-red-500" : "bg-blue-500")}>
              <Check className="text-white" size={13} />
            </span>
          ) : (
            <span className={cn("size-2.5 rounded-full", player.active ? accent : "bg-neutral-700")} />
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
  team,
  onClose,
  onSubstitute,
}: {
  team: Team;
  onClose: () => void;
  onSubstitute: (outPlayer: Player, inPlayer: Player) => void;
}) {
  const [outKey, setOutKey] = useState<string | undefined>(undefined);
  const [inKey, setInKey] = useState<string | undefined>(undefined);
  const outPlayer = team.players.find((player) => getPlayerKey(player) === outKey);
  const inPlayer = team.bench.find((player) => getPlayerKey(player) === inKey);
  const canConfirm = Boolean(outPlayer && inPlayer);

  function confirm() {
    if (outPlayer && inPlayer) {
      onSubstitute(outPlayer, inPlayer);
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
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-amber-400">Substitution</div>
            <h2 className="truncate text-lg font-black text-neutral-50">{team.name}</h2>
          </div>
          <button
            aria-label="Close substitution"
            className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            type="button"
            onClick={onClose}
          >
            <CircleX size={18} />
          </button>
        </div>

        <div className="grid gap-px bg-neutral-800 sm:grid-cols-2">
          <SubstitutionColumn
            accent="red"
            emptyLabel="No players on court."
            label="Out (on court)"
            players={team.players}
            selectedKey={outKey}
            onSelect={setOutKey}
          />
          <SubstitutionColumn
            accent="lime"
            emptyLabel="No bench players available."
            label="In (bench)"
            players={team.bench}
            selectedKey={inKey}
            onSelect={setInKey}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3">
          <div className="min-w-0 truncate text-xs font-semibold text-neutral-400">
            {canConfirm
              ? `${formatPlayer(inPlayer!)} in for ${formatPlayer(outPlayer!)}`
              : "Pick one player out and one player in."}
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
              disabled={!canConfirm}
              type="button"
              onClick={confirm}
            >
              <Shuffle size={16} />
              Confirm Sub
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubstitutionColumn({
  accent,
  emptyLabel,
  label,
  players,
  selectedKey,
  onSelect,
}: {
  accent: "red" | "lime";
  emptyLabel: string;
  label: string;
  players: Player[];
  selectedKey?: string;
  onSelect: (key: string) => void;
}) {
  const selectedRing =
    accent === "red"
      ? "border-red-500/60 bg-red-500/10 text-red-100"
      : "border-lime-500/60 bg-lime-500/10 text-lime-100";

  return (
    <div className="bg-neutral-900">
      <div className="px-4 py-2 text-[11px] font-black uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="max-h-72 overflow-y-auto scrollbar-slim px-2 pb-2">
        {players.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs font-semibold text-neutral-500">{emptyLabel}</div>
        ) : (
          players.map((player) => {
            const key = getPlayerKey(player);
            const selected = key === selectedKey;
            return (
              <button
                className={cn(
                  "mb-1 grid w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2 text-left transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500",
                  selected && selectedRing,
                )}
                key={key}
                type="button"
                onClick={() => onSelect(key)}
              >
                <span className="font-mono text-xl font-black tabular-nums text-neutral-100">{player.number}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-neutral-100">{player.name}</span>
                  <span className="block text-[11px] font-black uppercase tracking-wide text-neutral-500 tabular-nums">
                    {player.points} PTS · {player.fouls} F
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function BottomPanel({
  ballHandlerName,
  events,
  foulBallTeam,
  possession,
  possessionTeam,
  score,
  shotClock,
  summary,
  onEditEvent,
  onUndoEvent,
}: {
  ballHandlerName: string;
  events: GameEvent[];
  foulBallTeam: TeamId;
  possession: TeamId;
  possessionTeam: string;
  score: string;
  shotClock: number;
  summary: Array<{ label: string; value: string }>;
  onEditEvent: (eventId: number) => void;
  onUndoEvent: (eventId: number) => void;
}) {
  return (
    <section className="order-6 grid gap-px overflow-hidden bg-neutral-800 md:col-span-2 md:grid-cols-2 lg:grid-cols-3 xl:col-span-3 xl:col-start-1 xl:row-start-3 xl:min-h-0 xl:grid-cols-[minmax(360px,1fr)_240px_1fr]">
      <div className="min-h-0 overflow-hidden bg-neutral-950 p-3 md:col-span-2 lg:col-span-1 xl:col-span-1">
        <PanelTitle>{`Event Feed (${events.length})`}</PanelTitle>
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-neutral-800 md:max-h-56 xl:max-h-[120px] xl:rounded-md 2xl:max-h-[132px]">
          {events.map((event) => (
            <div
              className="grid min-h-11 grid-cols-[26px_48px_minmax(72px,1fr)_minmax(0,1.3fr)_56px_32px_32px] items-center gap-1 border-b border-neutral-800/70 bg-neutral-900/40 px-2 last:border-b-0 xl:min-h-8"
              key={event.id}
            >
              <ClipboardList className={eventIconClass[event.icon]} size={16} />
              <span className="font-mono text-xs text-neutral-400 tabular-nums">{event.time}</span>
              <span className="truncate text-xs font-bold">{event.player}</span>
              <span className="truncate text-xs text-neutral-400">{event.label}</span>
              <span
                className={cn(
                  "text-right font-mono text-sm font-black tabular-nums",
                  event.team === "away" ? "text-red-400" : "text-blue-400",
                )}
              >
                {event.score ?? ""}
              </span>
              <button
                aria-label={`Edit ${event.label}`}
                className="flex size-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:size-6"
                type="button"
                onClick={() => onEditEvent(event.id)}
              >
                <Pencil size={13} />
              </button>
              <button
                aria-label={`Undo ${event.label}`}
                className="flex size-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:size-6"
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

      <div className="min-h-0 overflow-hidden bg-neutral-950 p-3 xl:overflow-y-auto xl:scrollbar-slim">
        <PanelTitle>Current Possession</PanelTitle>
        <div className="mt-2 grid gap-2 xl:mt-1.5 xl:gap-1.5">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 xl:py-1.5">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-wide text-neutral-500">Possession</div>
              <div
                className={cn(
                  "truncate text-sm font-black uppercase",
                  possession === "away" ? "text-red-400" : "text-blue-400",
                )}
              >
                {possessionTeam}
              </div>
            </div>
            <PossessionArrow possession={possession} />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 xl:py-1.5">
              <div className="text-[10px] font-black uppercase tracking-wide text-neutral-500">Foul Ball</div>
              <div className="mt-1 flex items-center gap-2">
                <PossessionArrow possession={foulBallTeam} />
                <span className="truncate text-xs font-bold uppercase text-neutral-300">
                  {foulBallTeam === "away" ? "Away" : "Home"}
                </span>
              </div>
            </div>
            <div
              className={cn(
                "flex size-14 items-center justify-center rounded-full border-2 font-mono text-2xl font-black tabular-nums xl:size-11 xl:text-lg",
                possession === "away"
                  ? "border-red-500/80 text-red-400"
                  : "border-blue-400/80 text-blue-400",
              )}
            >
              {shotClock}
            </div>
          </div>

          <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs uppercase text-neutral-500 xl:py-1.5">
            <div className="min-w-0">
              <div className="text-[10px] font-black tracking-wide">Ball Handler</div>
              <div className="mt-0.5 truncate text-sm font-bold normal-case text-neutral-200">{ballHandlerName}</div>
            </div>
            <div className="font-mono text-base font-black tabular-nums text-neutral-300">{score}</div>
          </div>
        </div>
      </div>

      <div className="min-h-0 overflow-hidden bg-neutral-950 p-3 xl:overflow-y-auto xl:scrollbar-slim">
        <PanelTitle>Game Summary</PanelTitle>
        <div className="mt-2 space-y-1.5 xl:mt-1.5 xl:space-y-1">
          {summary.map((item) => (
            <div
              className="flex items-center justify-between gap-4 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm xl:py-1.5"
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
  onOpenSubstitution,
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
  onOpenSubstitution: () => void;
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
      ? statActions.filter((action) => action.key === "personal foul" || action.key === "tech foul")
      : statActions;

  return (
    <aside className="order-5 flex min-h-0 flex-col bg-neutral-950 p-3 md:col-span-2 xl:col-span-1 xl:col-start-4 xl:row-span-3 xl:row-start-1 xl:h-full xl:overflow-y-auto xl:p-2">
      <div className="mb-3 flex items-center justify-between gap-3 xl:mb-2">
        <div className="min-w-0">
          <h2 className="text-base font-black uppercase tracking-wide text-neutral-100 text-balance xl:text-sm">Scorer Console</h2>
          <p className="mt-0.5 truncate text-xs font-semibold text-neutral-500 text-pretty">
            {mode === "professional" ? "Professional stat tracking" : "Youth: points, fouls, free throws"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            aria-label="Reset local match controls"
            className="flex size-10 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:size-8 xl:rounded-md"
            type="button"
            onClick={onResetMatchState}
          >
            <RotateCcw size={17} />
          </button>
          <button
            aria-label="Refresh live data"
            className="flex size-10 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-60 xl:size-8 xl:rounded-md"
            disabled={isRefreshing}
            type="button"
            onClick={onRefresh}
          >
            <RefreshCw className={isRefreshing ? "animate-spin text-neutral-500" : ""} size={17} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1 xl:gap-2">
        <div className="flex flex-col gap-3 xl:gap-2">
          <div className="rounded-xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-900/40 p-3 shadow-sm shadow-black/20 xl:rounded-md xl:p-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Game Clock</span>
              <span className={cn(
                "font-mono text-3xl font-black leading-none tabular-nums xl:text-xl",
                isClockRunning ? "text-lime-400" : "text-neutral-100",
              )}>
                {clock}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-5 gap-1.5 xl:mt-1 xl:gap-1">
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
                  "flex h-11 items-center justify-center rounded-lg border text-xs font-black uppercase transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:h-7 xl:rounded-md",
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
            <div className="mt-2 grid grid-cols-2 gap-1.5 xl:mt-1 xl:gap-1">
              <button
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:h-7 xl:rounded-md"
                type="button"
                onClick={onResetGameClock}
              >
                Reset Q
              </button>
              <button
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:h-7 xl:rounded-md"
                type="button"
                onClick={() => onSetGameClock(getDefaultClockSeconds(period, periodSettings))}
              >
                Set Time
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between xl:mt-2">
              <span className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Shot Clock</span>
              <span className="font-mono text-lg font-black tabular-nums text-neutral-100 xl:text-base">{shotClock}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5 xl:mt-1 xl:gap-1">
              <button
                aria-label="Decrease shot clock by one second"
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:h-7 xl:rounded-md"
                type="button"
                onClick={() => onAdjustShotClock(-1)}
              >
                -1
              </button>
              <button
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:h-7 xl:rounded-md"
                type="button"
                onClick={() => onResetShotClock(FULL_SHOT_CLOCK)}
              >
                24
              </button>
              <button
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:h-7 xl:rounded-md"
                type="button"
                onClick={() => onResetShotClock(SHORT_SHOT_CLOCK)}
              >
                14
              </button>
              <button
                aria-label="Increase shot clock by one second"
                className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black uppercase text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:h-7 xl:rounded-md"
                type="button"
                onClick={() => onAdjustShotClock(1)}
              >
                +1
              </button>
            </div>
          </div>

          <PeriodSettingsControls settings={periodSettings} onChange={onPeriodSettingsChange} />
        </div>

        <div className="flex flex-col gap-3 xl:gap-2">
          {mode === "professional" && (
            <label className="flex h-12 items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 xl:h-9 xl:rounded-md xl:px-3">
              <span className="text-xs font-black uppercase tracking-wide text-neutral-200">Foul on shot</span>
              <input
                checked={foulOnShot}
                className="size-5 accent-amber-400 xl:size-4"
                disabled={!canRecordShot}
                type="checkbox"
                onChange={(event) => onSetFoulOnShot(event.currentTarget.checked)}
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-lime-500/30 bg-lime-500/10 text-xs font-black uppercase text-lime-200 transition-colors hover:bg-lime-500/20 focus:outline-none focus:ring-2 focus:ring-lime-500/50 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-900 disabled:text-neutral-500 disabled:opacity-50 xl:h-9 xl:rounded-md"
              disabled={mode === "professional" && !canRecordShot}
              type="button"
              onClick={() => onFreeThrow(true)}
            >
              <Plus size={17} />
              FT Made
            </button>
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 text-xs font-black uppercase text-red-200 transition-colors hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-900 disabled:text-neutral-500 disabled:opacity-50 xl:h-9 xl:rounded-md"
              disabled={mode === "professional" && !canRecordShot}
              type="button"
              onClick={() => onFreeThrow(false)}
            >
              <CircleX size={17} />
              FT Miss
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
            {visibleActions.map((action) => {
              const Icon = action.icon;
              const allowed = isActionAllowed(action.key);
              return (
                <button
                  className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl border border-neutral-800 bg-neutral-900 text-center transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-35 xl:h-10 xl:gap-0.5 xl:rounded-md"
                  disabled={!allowed}
                  key={action.key}
                  type="button"
                  onClick={() => onAction(action.key)}
                >
                  <Icon className={action.color} size={20} />
                  <span className="text-[11px] font-black uppercase text-neutral-100">{action.label}</span>
                </button>
              );
            })}
          </div>

          <button
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 text-xs font-black uppercase text-neutral-100 transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:h-9 xl:rounded-md"
            type="button"
            onClick={onOpenSubstitution}
          >
            <Shuffle size={18} />
            Substitution
          </button>

          <button
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 text-xs font-black uppercase tracking-wide text-red-200 transition-colors hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-500/50 xl:h-9 xl:rounded-md"
            type="button"
            onClick={onEndGame}
          >
            <Trophy size={18} />
            End Game
          </button>
        </div>

        <div className="flex flex-col gap-3 xl:gap-2">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-neutral-500">Current Period</span>
            <select
              aria-label="Select period"
              className="h-12 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm font-bold text-neutral-100 outline-none focus:ring-2 focus:ring-neutral-500 xl:h-9 xl:rounded-md xl:px-2"
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
      className="flex h-11 items-center justify-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-950 text-[11px] font-black text-neutral-200 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:h-7 xl:rounded-md"
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
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 xl:rounded-md xl:p-2">
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 xl:mb-1 xl:gap-1">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Timeout Clock</div>
          <div className="truncate text-[11px] font-bold text-neutral-400">
            {timeoutTeam ? `${teams[timeoutTeam].label} running` : "Ready"}
          </div>
        </div>
        <span className="font-mono text-base font-black tabular-nums text-neutral-100 xl:text-sm">
          {secondsToClock(remainingSeconds || durationSeconds)}
        </span>
        <button
          aria-label="Decrease timeout clock by fifteen seconds"
          className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:size-6 xl:rounded-sm"
          type="button"
          onClick={() => onAdjustDuration(-15)}
        >
          <Minus size={13} />
        </button>
        <button
          aria-label={remainingSeconds > 0 ? "Stop timeout clock" : "Increase timeout clock by fifteen seconds"}
          className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:size-6 xl:rounded-sm"
          type="button"
          onClick={remainingSeconds > 0 ? onStopClock : () => onAdjustDuration(15)}
        >
          {remainingSeconds > 0 ? <Pause size={13} /> : <Plus size={13} />}
        </button>
      </div>
      <div className="grid gap-1.5 xl:gap-1">
        {(["away", "home"] as TeamId[]).map((teamId) => (
          <div
            className="grid grid-cols-[44px_minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 xl:gap-1 xl:rounded-none xl:border-0 xl:bg-transparent xl:p-0"
            key={teamId}
          >
            <span className={cn("text-[10px] font-black uppercase", teamId === "away" ? "text-red-400" : "text-blue-400")}>
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
              className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:size-6 xl:rounded-sm xl:bg-neutral-950"
              type="button"
              onClick={() => onAdjustTimeout(teamId, -1)}
            >
              <Minus size={13} />
            </button>
            <button
              aria-label={`Register ${teams[teamId].label} timeout`}
              className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500 xl:size-6 xl:rounded-sm xl:bg-neutral-950"
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
    <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 p-3 xl:rounded-md xl:p-2">
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
      <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-[11px] text-neutral-400">
        {syncMessage}
      </div>
      <div className="mt-2 max-h-24 space-y-1 overflow-y-auto xl:max-h-20">
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

function writeStoredJson(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }

  try {
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
  return `#${player.number} ${player.name}`;
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

function getCourtSideForTeam(courtSides: CourtSides, team: TeamId): CourtSide {
  return courtSides.left === team ? "left" : "right";
}

function getFoulBallTeam(openingJumpWinner: TeamId, period: LiveMatch["period"]) {
  return period % 2 === 1 ? oppositeTeam(openingJumpWinner) : openingJumpWinner;
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
