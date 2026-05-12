export const DEFAULT_DEMAND_TIMEZONE = "America/New_York";

export type DemandDayKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export interface DemandTimezoneInterval {
  intervalDate: string;
  intervalTime: string;
  localMinuteOfDay: number;
  intervalOrdinal: number;
  occurrenceIndex: number;
  dstFold: number;
  repeated: boolean;
  intervalStartUtc: string;
  utcOffsetMinutes: number;
}

const DAY_KEYS: DemandDayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MAX_TIMEZONE_OFFSET_MS = 14 * 60 * 60 * 1000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function parseFormatterParts(formatter: Intl.DateTimeFormat, date: Date) {
  const parts = formatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    second: Number(value("second")),
  };
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseIsoDate(isoDate: string): { year: number; month: number; day: number } | null {
  const match = String(isoDate).match(/^([0-9]{4})-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function normalizeDemandTimeZone(value: string | null | undefined): string {
  const candidate = String(value || DEFAULT_DEMAND_TIMEZONE).trim();
  try {
    getFormatter(candidate).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_DEMAND_TIMEZONE;
  }
}

export function getCurrentMonthKeyInTimeZone(timeZone: string, date = new Date()): string {
  const normalized = normalizeDemandTimeZone(timeZone);
  const parts = parseFormatterParts(getFormatter(normalized), date);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}`;
}

export function getDemandDayKeyFromIso(isoDate: string): DemandDayKey {
  const parts = parseIsoDate(isoDate);
  if (!parts) return "monday";
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return DAY_KEYS[(day + 6) % 7];
}

export function getDemandMondayBasedDayOfWeek(isoDate: string): number {
  const parts = parseIsoDate(isoDate);
  if (!parts) return 0;
  return (new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() + 6) % 7;
}

function getTimeZoneOffsetMinutes(timeZone: string, instant: Date): number {
  const parts = parseFormatterParts(getFormatter(timeZone), instant);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((localAsUtc - instant.getTime()) / 60000);
}

export function buildDemandTimezoneDayIntervals(
  intervalDate: string,
  timeZone: string,
  intervalMinutes: number,
  openMinutes: number,
  closeMinutes: number
): DemandTimezoneInterval[] {
  const parts = parseIsoDate(intervalDate);
  const normalized = normalizeDemandTimeZone(timeZone);
  if (!parts || intervalMinutes <= 0 || closeMinutes <= openMinutes) return [];

  const formatter = getFormatter(normalized);
  const stepMs = intervalMinutes * 60000;
  const dayStartUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const searchStart = Math.floor((dayStartUtc - MAX_TIMEZONE_OFFSET_MS) / stepMs) * stepMs;
  const searchEnd = dayStartUtc + 24 * 60 * 60 * 1000 + MAX_TIMEZONE_OFFSET_MS;
  const collected: Array<Omit<DemandTimezoneInterval, "intervalOrdinal" | "occurrenceIndex" | "dstFold" | "repeated">> = [];

  for (let time = searchStart; time <= searchEnd; time += stepMs) {
    const instant = new Date(time);
    const local = parseFormatterParts(formatter, instant);
    if (!Number.isFinite(local.year) || !Number.isFinite(local.month) || !Number.isFinite(local.day)) continue;
    const localDate = formatIsoDate(local.year, local.month, local.day);
    if (localDate !== intervalDate) continue;
    if (local.second !== 0) continue;

    const localMinuteOfDay = local.hour * 60 + local.minute;
    if (localMinuteOfDay % intervalMinutes !== 0) continue;

    collected.push({
      intervalDate: localDate,
      intervalTime: formatTime(local.hour, local.minute),
      localMinuteOfDay,
      intervalStartUtc: instant.toISOString(),
      utcOffsetMinutes: getTimeZoneOffsetMinutes(normalized, instant),
    });
  }

  const allDayIntervals = collected.sort((left, right) => (
    left.intervalStartUtc.localeCompare(right.intervalStartUtc)
    || left.localMinuteOfDay - right.localMinuteOfDay
  ));
  const occurrencesByTime = new Map<string, number>();
  const totalsByTime = new Map<string, number>();
  allDayIntervals.forEach((interval) => {
    totalsByTime.set(interval.intervalTime, (totalsByTime.get(interval.intervalTime) ?? 0) + 1);
  });

  return allDayIntervals
    .map((interval, intervalOrdinal) => {
      const occurrenceIndex = occurrencesByTime.get(interval.intervalTime) ?? 0;
      occurrencesByTime.set(interval.intervalTime, occurrenceIndex + 1);
      return {
        ...interval,
        intervalOrdinal,
        occurrenceIndex,
        dstFold: occurrenceIndex,
        repeated: (totalsByTime.get(interval.intervalTime) ?? 0) > 1,
      };
    })
    .filter((interval) => (
      interval.localMinuteOfDay >= openMinutes
      && interval.localMinuteOfDay + intervalMinutes <= closeMinutes
      && interval.localMinuteOfDay < 24 * 60
    ));
}
