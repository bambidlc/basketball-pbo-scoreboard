import type { MatchOption } from "./api/liveMatch";

export const PBO_TIME_ZONE = "America/Puerto_Rico";

const FINISHED_STATUSES = new Set([
  "cancelado",
  "cancelled",
  "canceled",
  "final",
  "finalizado",
  "played",
  "suspendido",
  "suspended",
]);

export function currentPboDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: PBO_TIME_ZONE,
    year: "numeric",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function matchDateKey(datetime?: string): string {
  const timestamp = matchTimestamp(datetime);
  if (timestamp !== undefined) {
    return currentPboDateKey(new Date(timestamp));
  }

  const datePart = datetime?.trim().slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : "";
}

export function currentOdooDateTimeKey(now = new Date()): string {
  return now.toISOString().slice(0, 19).replace("T", " ");
}

export function formatGameTime(datetime?: string): string {
  const match = datetime?.trim().match(/\b(\d{2}):(\d{2})\b/);
  if (!match) {
    return "";
  }

  const hour = Number(match[1]);
  if (hour < 0 || hour > 23) {
    return "";
  }

  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${match[2]} ${period}`;
}

function normalizedStatus(option: MatchOption): string {
  return option.status.trim().toLocaleLowerCase("es");
}

function statusRank(option: MatchOption): number {
  const status = normalizedStatus(option);
  if (status === "live" || status === "en vivo") {
    return 0;
  }
  if (status === "scheduled" || status === "programado") {
    return 1;
  }
  return 2;
}

function matchTimestamp(datetime?: string): number | undefined {
  const value = datetime?.trim() ?? "";
  if (!value) {
    return undefined;
  }

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function isFinished(option: MatchOption): boolean {
  return FINISHED_STATUSES.has(normalizedStatus(option));
}

function isCurrentLive(option: MatchOption, todayKey: string): boolean {
  const status = normalizedStatus(option);
  return (status === "live" || status === "en vivo") && matchDateKey(option.datetime) === todayKey;
}

function relevanceBucket(
  option: MatchOption,
  todayKey: string,
  nowTimestamp: number,
): number {
  if (isCurrentLive(option, todayKey)) {
    return 0;
  }

  const timestamp = matchTimestamp(option.datetime);
  if (timestamp !== undefined && timestamp >= nowTimestamp && !isFinished(option)) {
    return 1;
  }

  const dateKey = matchDateKey(option.datetime);
  if (dateKey >= todayKey && !isFinished(option)) {
    return 2;
  }
  if (dateKey >= todayKey) {
    return 3;
  }
  if (dateKey) {
    return 4;
  }
  return 5;
}

export function orderGamesByRelevance(
  options: MatchOption[],
  todayKey = currentPboDateKey(),
  nowKey = currentOdooDateTimeKey(),
): MatchOption[] {
  const nowTimestamp = matchTimestamp(nowKey) ?? Date.now();
  return [...options].sort((a, b) => {
    const aBucket = relevanceBucket(a, todayKey, nowTimestamp);
    const bBucket = relevanceBucket(b, todayKey, nowTimestamp);
    if (aBucket !== bBucket) {
      return aBucket - bBucket;
    }

    const aTimestamp = matchTimestamp(a.datetime);
    const bTimestamp = matchTimestamp(b.datetime);
    if (aTimestamp !== bTimestamp) {
      if (aTimestamp === undefined) { return 1; }
      if (bTimestamp === undefined) { return -1; }
      return aBucket === 4 ? bTimestamp - aTimestamp : aTimestamp - bTimestamp;
    }

    const aStatus = statusRank(a);
    const bStatus = statusRank(b);
    if (aStatus !== bStatus) {
      return aStatus - bStatus;
    }

    return a.id - b.id;
  });
}

export function findRelevantGame(
  options: MatchOption[],
  todayKey = currentPboDateKey(),
  nowKey = currentOdooDateTimeKey(),
): MatchOption | undefined {
  const ordered = orderGamesByRelevance(options, todayKey, nowKey);
  const nowTimestamp = matchTimestamp(nowKey) ?? Date.now();
  return ordered.find((option) => isCurrentLive(option, todayKey)) ?? ordered.find((option) => {
    const timestamp = matchTimestamp(option.datetime);
    return timestamp !== undefined && timestamp >= nowTimestamp && !isFinished(option);
  }) ?? ordered.find((option) => {
    return matchDateKey(option.datetime) >= todayKey && !isFinished(option);
  }) ?? ordered[0];
}

export function shouldAdvanceToRelevantGame(
  selected: MatchOption | undefined,
  todayKey = currentPboDateKey(),
  nowKey = currentOdooDateTimeKey(),
): boolean {
  if (!selected) {
    return true;
  }

  if (isCurrentLive(selected, todayKey)) {
    return false;
  }

  if (isFinished(selected)) {
    return true;
  }

  const timestamp = matchTimestamp(selected.datetime);
  const nowTimestamp = matchTimestamp(nowKey) ?? Date.now();
  if (timestamp !== undefined) {
    return timestamp < nowTimestamp;
  }

  const dateKey = matchDateKey(selected.datetime);
  return !dateKey || dateKey < todayKey;
}
