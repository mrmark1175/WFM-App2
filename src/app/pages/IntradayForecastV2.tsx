import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, Layers3, Loader2, RefreshCw, Save, Send, Table2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { PageLayout } from "../components/PageLayout";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { CHANNEL_OPTIONS, type ChannelKey, useLOB } from "../lib/lobContext";
import { apiUrl } from "../lib/api";
import { getCalculatedVolumes, type Assumptions } from "./forecasting-logic";

type StaffingMode = "dedicated" | "blended";
type DayKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

interface DaySchedule {
  enabled?: boolean;
  open?: string;
  close?: string;
}

interface LobSettings {
  channels_enabled?: Partial<Record<ChannelKey, boolean>>;
  pooling_mode?: StaffingMode | string;
  hours_of_operation?: Partial<Record<ChannelKey, Partial<Record<DayKey, DaySchedule>>>>;
}

interface PlannerSnapshot {
  assumptions?: Assumptions;
  forecastMethod?: string;
  hwParams?: { alpha: number; beta: number; gamma: number; seasonLength: number };
  arimaParams?: { p: number; d: number; q: number };
  decompParams?: { trendStrength: number; seasonalityStrength: number };
  channelHistoricalApiData?: Partial<Record<ChannelKey, number[]>>;
  channelHistoricalOverrides?: Partial<Record<ChannelKey, Record<number, string>>>;
  recutVolumesByChannel?: Partial<Record<ChannelKey, number[]>> | null;
  selectedChannels?: Partial<Record<ChannelKey, boolean>>;
  poolingMode?: StaffingMode | string;
}

interface DemandPlannerActiveState {
  plannerSnapshot?: PlannerSnapshot;
}

interface DemandPlannerCommittedScenario {
  planner_snapshot?: PlannerSnapshot;
}

interface IntradayV2MonthPlan {
  id: number;
  demand_forecast_volume: number | string | null;
  demand_source: string | null;
  manual_monthly_volume: number | string | null;
  effective_monthly_volume: number | string | null;
  status: string;
  updated_at?: string;
}

interface DemandVolumeResolution {
  volume: number;
  hasForecast: boolean;
  source: "demand_forecasting" | "recut" | "missing";
}

interface IntradayV2WeekAllocation {
  id?: number;
  week_start: string;
  week_index: number;
  weight: number | string;
  volume: number | string;
  is_locked?: boolean;
  updated_at?: string;
}

interface IntradayV2DayAllocation {
  id?: number;
  calendar_date: string;
  day_of_week: number;
  week_start: string;
  weight: number | string;
  volume: number | string;
  is_locked?: boolean;
  updated_at?: string;
}

interface IntradayV2IntervalAllocation {
  id?: number;
  calendar_date: string;
  interval_index: number;
  interval_start: string;
  interval_minutes: number | string;
  weight: number | string;
  volume: number | string;
  aht_seconds?: number | string | null;
  updated_at?: string;
}

interface MonthWeek {
  weekStart: string;
  weekEnd: string;
  weekIndex: number;
  label: string;
  dateRange: string;
  daysInMonth: number;
  defaultWeight: number;
}

interface WeekAllocationPreviewRow {
  week: MonthWeek;
  inputValue: string;
  rawWeight: number;
  normalizedWeight: number;
  allocatedVolume: number;
  invalid: boolean;
}

interface WeekAllocationPreview {
  rows: WeekAllocationPreviewRow[];
  totalRawWeight: number;
  totalAllocatedVolume: number;
  hasInvalidWeight: boolean;
  usingDefaultPreviewWeights: boolean;
}

interface DayAllocationDay {
  weekStart: string;
  weekLabel: string;
  calendarDate: string;
  dateLabel: string;
  dayKey: DayKey;
  dayOfWeek: number;
  dayLabel: string;
  insideMonth: boolean;
  weekVolume: number;
}

interface DayAllocationPreviewRow extends DayAllocationDay {
  inputValue: string;
  rawWeight: number;
  normalizedWeight: number;
  allocatedVolume: number;
  invalid: boolean;
}

interface DayAllocationWeekSummary {
  weekStart: string;
  weekLabel: string;
  weekVolume: number;
  totalRawWeight: number;
  totalAllocatedVolume: number;
  hasInvalidWeight: boolean;
  hasZeroWeight: boolean;
  totalIs100: boolean;
  sumsToWeek: boolean;
}

interface DayAllocationPreview {
  rows: DayAllocationPreviewRow[];
  weekSummaries: DayAllocationWeekSummary[];
  totalAllocatedVolume: number;
  hasInvalidWeight: boolean;
  hasZeroWeightWeek: boolean;
  allWeeksSumToSource: boolean;
}

interface IntervalAllocationInterval {
  key: string;
  calendarDate: string;
  dateLabel: string;
  dayKey: DayKey;
  dayLabel: string;
  intervalIndex: number;
  intervalStart: string;
  intervalLabel: string;
  intervalMinutes: number;
  dayVolume: number;
}

interface IntervalAllocationPreviewRow extends IntervalAllocationInterval {
  inputValue: string;
  rawWeight: number;
  normalizedWeight: number;
  allocatedVolume: number;
  invalid: boolean;
}

interface IntervalAllocationDaySummary {
  calendarDate: string;
  dateLabel: string;
  dayLabel: string;
  dayVolume: number;
  totalRawWeight: number;
  totalAllocatedVolume: number;
  hasInvalidWeight: boolean;
  hasZeroWeight: boolean;
  missingIntervals: boolean;
  totalIs100: boolean;
  sumsToDay: boolean;
}

interface IntervalAllocationPreview {
  rows: IntervalAllocationPreviewRow[];
  daySummaries: IntervalAllocationDaySummary[];
  totalAllocatedVolume: number;
  hasInvalidWeight: boolean;
  hasZeroWeightDay: boolean;
  hasMissingIntervals: boolean;
  allDaysSumToSource: boolean;
}

const DEFAULT_ENABLED_CHANNELS: Record<ChannelKey, boolean> = {
  voice: true,
  email: false,
  chat: false,
  cases: false,
};

const CHANNEL_SELECT_OPTIONS = [
  { value: "voice", label: "Voice" },
  { value: "email", label: "Email" },
  { value: "chat", label: "Chat" },
  { value: "cases", label: "Cases" },
] as const satisfies ReadonlyArray<{ value: ChannelKey; label: string }>;

const PLACEHOLDER_SECTIONS = [
  {
    title: "Output Preview",
    description: "Future scoped weekly and interval output preview before publishing.",
    icon: Layers3,
  },
  {
    title: "Publish / Commit",
    description: "Future publish step for approved downstream outputs.",
    icon: Send,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MINUTES = 15;
const WEIGHT_TOTAL_TOLERANCE = 0.05;
const DAY_KEYS: DayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS: Record<DayKey, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeStaffingMode(value?: string): StaffingMode {
  return value === "blended" ? "blended" : "dedicated";
}

function normalizeEnabledChannels(settings?: LobSettings | null): Record<ChannelKey, boolean> {
  return {
    voice: settings?.channels_enabled?.voice ?? DEFAULT_ENABLED_CHANNELS.voice,
    email: settings?.channels_enabled?.email ?? DEFAULT_ENABLED_CHANNELS.email,
    chat: settings?.channels_enabled?.chat ?? DEFAULT_ENABLED_CHANNELS.chat,
    cases: settings?.channels_enabled?.cases ?? DEFAULT_ENABLED_CHANNELS.cases,
  };
}

function parseOptionalNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumberInput(value: number | string | null | undefined): string {
  const parsed = parseOptionalNumber(value);
  return parsed === null ? "" : String(Math.round(parsed));
}

function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return Math.round(value).toLocaleString();
}

function formatChannelLabel(channel: ChannelKey): string {
  return CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? "Voice";
}

function parseMonthParts(monthKey: string): { year: number; month: number } | null {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return null;
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

function isoFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateFromIso(isoDate: string): Date {
  return new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`);
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function startOfUtcWeekMonday(date: Date): Date {
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addUtcDays(date, -mondayOffset);
}

function formatShortDate(isoDate: string, includeYear = false): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(dateFromIso(isoDate));
}

function formatDateRange(startIso: string, endIso: string): string {
  const sameYear = startIso.slice(0, 4) === endIso.slice(0, 4);
  return sameYear
    ? `${formatShortDate(startIso)} - ${formatShortDate(endIso, true)}`
    : `${formatShortDate(startIso, true)} - ${formatShortDate(endIso, true)}`;
}

function formatWeightInput(weight: number | string | null | undefined): string {
  const parsed = parseOptionalNumber(weight);
  if (parsed === null) return "0";
  return (Math.round(parsed * 10000) / 10000).toFixed(4).replace(/\.?0+$/, "");
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${(Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

function normalizeDateKey(value: string | Date): string {
  if (value instanceof Date) return isoFromDate(value);
  return String(value).slice(0, 10);
}

function parseWeightInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildMonthWeeks(monthKey: string): MonthWeek[] {
  const parts = parseMonthParts(monthKey);
  if (!parts) return [];

  const monthStart = new Date(Date.UTC(parts.year, parts.month - 1, 1));
  const monthEnd = new Date(Date.UTC(parts.year, parts.month, 0));
  const daysInMonth = monthEnd.getUTCDate();
  const weeks: MonthWeek[] = [];
  let weekStart = startOfUtcWeekMonday(monthStart);

  while (weekStart.getTime() <= monthEnd.getTime()) {
    const weekEnd = addUtcDays(weekStart, 6);
    const overlapStart = Math.max(weekStart.getTime(), monthStart.getTime());
    const overlapEnd = Math.min(weekEnd.getTime(), monthEnd.getTime());
    const daysInSelectedMonth = Math.max(0, Math.floor((overlapEnd - overlapStart) / DAY_MS) + 1);

    if (daysInSelectedMonth > 0) {
      const weekStartIso = isoFromDate(weekStart);
      const weekEndIso = isoFromDate(weekEnd);
      weeks.push({
        weekStart: weekStartIso,
        weekEnd: weekEndIso,
        weekIndex: weeks.length + 1,
        label: `Week ${weeks.length + 1}`,
        dateRange: formatDateRange(weekStartIso, weekEndIso),
        daysInMonth: daysInSelectedMonth,
        defaultWeight: daysInMonth > 0 ? (daysInSelectedMonth / daysInMonth) * 100 : 0,
      });
    }

    weekStart = addUtcDays(weekStart, 7);
  }

  return weeks;
}

function buildDefaultWeekWeightInputs(weeks: MonthWeek[]): Record<string, string> {
  return Object.fromEntries(weeks.map((week) => [week.weekStart, formatWeightInput(week.defaultWeight)]));
}

function buildSavedWeekWeightInputs(weeks: MonthWeek[], allocations: IntradayV2WeekAllocation[]): Record<string, string> {
  const savedWeightsByWeek = new Map(
    allocations.map((allocation) => [normalizeDateKey(allocation.week_start), formatWeightInput(allocation.weight)])
  );
  return Object.fromEntries(
    weeks.map((week) => [week.weekStart, savedWeightsByWeek.get(week.weekStart) ?? formatWeightInput(week.defaultWeight)])
  );
}

function allocateIntegerVolume(totalVolume: number, weights: number[]): number[] {
  const total = Math.max(0, Math.round(totalVolume));
  if (total === 0 || weights.length === 0) return weights.map(() => 0);

  const weightTotal = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (weightTotal <= 0) return weights.map(() => 0);

  const exactVolumes = weights.map((weight) => (total * Math.max(0, weight)) / weightTotal);
  const allocated = exactVolumes.map(Math.floor);
  let remainder = total - allocated.reduce((sum, value) => sum + value, 0);
  const remainderOrder = exactVolumes
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (let i = 0; i < remainder; i += 1) {
    allocated[remainderOrder[i % remainderOrder.length].index] += 1;
  }

  return allocated;
}

function buildWeekAllocationPreview(
  weeks: MonthWeek[],
  weightInputs: Record<string, string>,
  effectiveMonthlyVolume: number
): WeekAllocationPreview {
  const parsedRows = weeks.map((week) => {
    const inputValue = weightInputs[week.weekStart] ?? formatWeightInput(week.defaultWeight);
    const parsed = parseWeightInput(inputValue);
    const invalid = parsed === null || parsed < 0;
    return {
      week,
      inputValue,
      rawWeight: invalid ? 0 : parsed,
      invalid,
    };
  });
  const hasInvalidWeight = parsedRows.some((row) => row.invalid);
  const rawWeights = parsedRows.map((row) => row.rawWeight);
  const totalRawWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);
  const usingDefaultPreviewWeights = hasInvalidWeight || totalRawWeight <= 0;
  const previewWeights = usingDefaultPreviewWeights ? weeks.map((week) => week.defaultWeight) : rawWeights;
  const previewWeightTotal = previewWeights.reduce((sum, weight) => sum + weight, 0);
  const normalizedWeights = previewWeights.map((weight) => (previewWeightTotal > 0 ? (weight / previewWeightTotal) * 100 : 0));
  const allocatedVolumes = allocateIntegerVolume(effectiveMonthlyVolume, previewWeights);
  const rows = parsedRows.map((row, index) => ({
    ...row,
    normalizedWeight: normalizedWeights[index] ?? 0,
    allocatedVolume: allocatedVolumes[index] ?? 0,
  }));

  return {
    rows,
    totalRawWeight,
    totalAllocatedVolume: allocatedVolumes.reduce((sum, value) => sum + value, 0),
    hasInvalidWeight,
    usingDefaultPreviewWeights,
  };
}

function getDayKeyFromIso(isoDate: string): DayKey {
  return DAY_KEYS[(dateFromIso(isoDate).getUTCDay() + 6) % 7];
}

function getMondayBasedDayOfWeek(isoDate: string): number {
  return (dateFromIso(isoDate).getUTCDay() + 6) % 7;
}

function getOperatingDaySet(settings: LobSettings | null, channel: ChannelKey): Set<DayKey> | null {
  const schedule = settings?.hours_of_operation?.[channel];
  if (!schedule) return null;
  const configuredDays = DAY_KEYS.filter((day) => typeof schedule[day]?.enabled === "boolean");
  if (configuredDays.length === 0) return null;
  return new Set(configuredDays.filter((day) => schedule[day]?.enabled));
}

function buildDayAllocationDays(
  weeks: MonthWeek[],
  weekVolumesByStart: Record<string, number>,
  monthKey: string
): DayAllocationDay[] {
  return weeks.flatMap((week) => {
    const weekStartDate = dateFromIso(week.weekStart);
    return Array.from({ length: 7 }, (_, offset) => {
      const calendarDate = isoFromDate(addUtcDays(weekStartDate, offset));
      const dayKey = getDayKeyFromIso(calendarDate);
      return {
        weekStart: week.weekStart,
        weekLabel: week.label,
        calendarDate,
        dateLabel: formatShortDate(calendarDate, calendarDate.slice(0, 4) !== monthKey.slice(0, 4)),
        dayKey,
        dayOfWeek: getMondayBasedDayOfWeek(calendarDate),
        dayLabel: DAY_LABELS[dayKey],
        insideMonth: calendarDate.startsWith(monthKey),
        weekVolume: weekVolumesByStart[week.weekStart] ?? 0,
      };
    });
  });
}

function groupDayRowsByWeek<T extends { weekStart: string }>(rows: T[]): T[][] {
  const groups = new Map<string, T[]>();
  rows.forEach((row) => {
    groups.set(row.weekStart, [...(groups.get(row.weekStart) ?? []), row]);
  });
  return Array.from(groups.values());
}

function buildDefaultDayWeightInputs(
  rows: DayAllocationDay[],
  operatingDaySet: Set<DayKey> | null
): Record<string, string> {
  const entries: Array<[string, string]> = [];

  groupDayRowsByWeek(rows).forEach((weekRows) => {
    const insideRows = weekRows.filter((row) => row.insideMonth);
    const operatingRows = operatingDaySet
      ? insideRows.filter((row) => operatingDaySet.has(row.dayKey))
      : [];
    const weightedRows = operatingDaySet && operatingRows.length > 0 ? operatingRows : insideRows;
    const weight = weightedRows.length > 0 ? 100 / weightedRows.length : 0;
    const weightedDates = new Set(weightedRows.map((row) => row.calendarDate));

    weekRows.forEach((row) => {
      entries.push([row.calendarDate, row.insideMonth && weightedDates.has(row.calendarDate) ? formatWeightInput(weight) : "0"]);
    });
  });

  return Object.fromEntries(entries);
}

function buildSavedDayWeightInputs(
  rows: DayAllocationDay[],
  allocations: IntradayV2DayAllocation[],
  defaultInputs: Record<string, string>
): Record<string, string> {
  const savedWeightsByDate = new Map(
    allocations.map((allocation) => [normalizeDateKey(allocation.calendar_date), formatWeightInput(allocation.weight)])
  );
  return Object.fromEntries(
    rows.map((row) => [
      row.calendarDate,
      row.insideMonth ? savedWeightsByDate.get(row.calendarDate) ?? defaultInputs[row.calendarDate] ?? "0" : "0",
    ])
  );
}

function buildDayAllocationPreview(
  dayRows: DayAllocationDay[],
  weightInputs: Record<string, string>
): DayAllocationPreview {
  const previewRows: DayAllocationPreviewRow[] = [];
  const weekSummaries: DayAllocationWeekSummary[] = [];

  groupDayRowsByWeek(dayRows).forEach((weekRows) => {
    const parsedRows = weekRows.map((row) => {
      const inputValue = row.insideMonth ? weightInputs[row.calendarDate] ?? "0" : "0";
      const parsed = parseWeightInput(inputValue);
      const invalid = row.insideMonth && (parsed === null || parsed < 0);
      const rawWeight = row.insideMonth && parsed !== null && parsed >= 0 ? parsed : 0;
      return {
        ...row,
        inputValue,
        rawWeight,
        normalizedWeight: 0,
        allocatedVolume: 0,
        invalid,
      };
    });
    const weekVolume = parsedRows[0]?.weekVolume ?? 0;
    const hasInvalidWeight = parsedRows.some((row) => row.invalid);
    const rawWeights = parsedRows.map((row) => row.rawWeight);
    const totalRawWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);
    const hasZeroWeight = weekVolume > 0 && totalRawWeight <= 0;
    const canAllocate = !hasInvalidWeight && totalRawWeight > 0;
    const normalizedWeights = canAllocate ? rawWeights.map((weight) => (weight / totalRawWeight) * 100) : rawWeights.map(() => 0);
    const allocatedVolumes = canAllocate ? allocateIntegerVolume(weekVolume, rawWeights) : rawWeights.map(() => 0);

    parsedRows.forEach((row, index) => {
      previewRows.push({
        ...row,
        normalizedWeight: normalizedWeights[index] ?? 0,
        allocatedVolume: allocatedVolumes[index] ?? 0,
      });
    });

    const totalAllocatedVolume = allocatedVolumes.reduce((sum, value) => sum + value, 0);
    weekSummaries.push({
      weekStart: parsedRows[0]?.weekStart ?? "",
      weekLabel: parsedRows[0]?.weekLabel ?? "Week",
      weekVolume,
      totalRawWeight,
      totalAllocatedVolume,
      hasInvalidWeight,
      hasZeroWeight,
      totalIs100: Math.abs(totalRawWeight - 100) <= WEIGHT_TOTAL_TOLERANCE,
      sumsToWeek: Math.abs(totalAllocatedVolume - weekVolume) <= 1,
    });
  });

  return {
    rows: previewRows,
    weekSummaries,
    totalAllocatedVolume: previewRows.reduce((sum, row) => sum + row.allocatedVolume, 0),
    hasInvalidWeight: weekSummaries.some((summary) => summary.hasInvalidWeight),
    hasZeroWeightWeek: weekSummaries.some((summary) => summary.hasZeroWeight),
    allWeeksSumToSource: weekSummaries.every((summary) => summary.sumsToWeek),
  };
}

function intervalInputKey(calendarDate: string, intervalIndex: number): string {
  return `${calendarDate}:${intervalIndex}`;
}

function normalizeTimeKey(value: string | null | undefined): string {
  const match = String(value ?? "").trim().match(/^([01][0-9]|2[0-3]):([0-5][0-9])/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function parseTimeToMinutes(value: string | null | undefined): number | null {
  const normalized = normalizeTimeKey(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatIntervalStart(minutes: number): string {
  const bounded = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(bounded / 60);
  const mins = bounded % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function formatClockLabel(minutes: number): string {
  const bounded = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(bounded / 60);
  const mins = bounded % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(mins).padStart(2, "0")} ${suffix}`;
}

function formatIntervalRangeLabel(intervalStart: string, intervalMinutes: number): string {
  const startMinutes = parseTimeToMinutes(intervalStart) ?? 0;
  return `${formatClockLabel(startMinutes)} - ${formatClockLabel(startMinutes + intervalMinutes)}`;
}

function buildIntervalAllocationRows(
  dayRows: Array<DayAllocationDay & { allocatedVolume?: number }>,
  settings: LobSettings | null,
  channel: ChannelKey
): IntervalAllocationInterval[] {
  const schedule = settings?.hours_of_operation?.[channel];
  if (!schedule) return [];

  return dayRows.flatMap((day) => {
    if (!day.insideMonth) return [];
    const daySchedule = schedule[day.dayKey];
    if (!daySchedule?.enabled) return [];

    const openMinutes = parseTimeToMinutes(daySchedule.open ?? "08:00");
    const closeRaw = parseTimeToMinutes(daySchedule.close ?? "17:00");
    if (openMinutes === null || closeRaw === null) return [];

    const closeMinutes = closeRaw === 23 * 60 + 59 ? 24 * 60 : closeRaw;
    if (closeMinutes <= openMinutes) return [];

    const firstStart = Math.ceil(openMinutes / INTERVAL_MINUTES) * INTERVAL_MINUTES;
    const intervals: IntervalAllocationInterval[] = [];
    for (let start = firstStart; start + INTERVAL_MINUTES <= closeMinutes && start < 24 * 60; start += INTERVAL_MINUTES) {
      const intervalIndex = Math.floor(start / INTERVAL_MINUTES);
      const intervalStart = formatIntervalStart(start);
      intervals.push({
        key: intervalInputKey(day.calendarDate, intervalIndex),
        calendarDate: day.calendarDate,
        dateLabel: day.dateLabel,
        dayKey: day.dayKey,
        dayLabel: day.dayLabel,
        intervalIndex,
        intervalStart,
        intervalLabel: formatIntervalRangeLabel(intervalStart, INTERVAL_MINUTES),
        intervalMinutes: INTERVAL_MINUTES,
        dayVolume: Math.max(0, Math.round(day.allocatedVolume ?? 0)),
      });
    }
    return intervals;
  });
}

function groupIntervalRowsByDay<T extends { calendarDate: string }>(rows: T[]): T[][] {
  const groups = new Map<string, T[]>();
  rows.forEach((row) => {
    groups.set(row.calendarDate, [...(groups.get(row.calendarDate) ?? []), row]);
  });
  return Array.from(groups.values());
}

function buildDefaultIntervalWeightInputs(rows: IntervalAllocationInterval[]): Record<string, string> {
  const entries: Array<[string, string]> = [];
  groupIntervalRowsByDay(rows).forEach((dayRows) => {
    const weight = dayRows.length > 0 ? 100 / dayRows.length : 0;
    dayRows.forEach((row) => entries.push([row.key, formatWeightInput(weight)]));
  });
  return Object.fromEntries(entries);
}

function buildSavedIntervalWeightInputs(
  rows: IntervalAllocationInterval[],
  allocations: IntradayV2IntervalAllocation[],
  defaultInputs: Record<string, string>
): Record<string, string> {
  const savedWeightsByInterval = new Map(
    allocations.map((allocation) => [
      intervalInputKey(normalizeDateKey(allocation.calendar_date), Number(allocation.interval_index)),
      formatWeightInput(allocation.weight),
    ])
  );
  return Object.fromEntries(
    rows.map((row) => [row.key, savedWeightsByInterval.get(row.key) ?? defaultInputs[row.key] ?? "0"])
  );
}

function buildIntervalAllocationPreview(
  intervalRows: IntervalAllocationInterval[],
  sourceDayRows: DayAllocationPreviewRow[],
  weightInputs: Record<string, string>
): IntervalAllocationPreview {
  const intervalRowsByDay = new Map<string, IntervalAllocationInterval[]>();
  intervalRows.forEach((row) => {
    intervalRowsByDay.set(row.calendarDate, [...(intervalRowsByDay.get(row.calendarDate) ?? []), row]);
  });

  const previewRows: IntervalAllocationPreviewRow[] = [];
  const daySummaries: IntervalAllocationDaySummary[] = [];

  sourceDayRows
    .filter((day) => day.insideMonth)
    .forEach((day) => {
      const rowsForDay = intervalRowsByDay.get(day.calendarDate) ?? [];
      const dayVolume = Math.max(0, Math.round(day.allocatedVolume));

      if (rowsForDay.length === 0) {
        if (dayVolume > 0) {
          daySummaries.push({
            calendarDate: day.calendarDate,
            dateLabel: day.dateLabel,
            dayLabel: day.dayLabel,
            dayVolume,
            totalRawWeight: 0,
            totalAllocatedVolume: 0,
            hasInvalidWeight: false,
            hasZeroWeight: false,
            missingIntervals: true,
            totalIs100: false,
            sumsToDay: false,
          });
        }
        return;
      }

      const parsedRows = rowsForDay.map((row) => {
        const inputValue = weightInputs[row.key] ?? "0";
        const parsed = parseWeightInput(inputValue);
        const invalid = parsed === null || parsed < 0;
        const rawWeight = parsed !== null && parsed >= 0 ? parsed : 0;
        return {
          ...row,
          dayVolume,
          inputValue,
          rawWeight,
          normalizedWeight: 0,
          allocatedVolume: 0,
          invalid,
        };
      });
      const hasInvalidWeight = parsedRows.some((row) => row.invalid);
      const rawWeights = parsedRows.map((row) => row.rawWeight);
      const totalRawWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);
      const hasZeroWeight = dayVolume > 0 && totalRawWeight <= 0;
      const canAllocate = !hasInvalidWeight && totalRawWeight > 0;
      const normalizedWeights = canAllocate ? rawWeights.map((weight) => (weight / totalRawWeight) * 100) : rawWeights.map(() => 0);
      const allocatedVolumes = canAllocate ? allocateIntegerVolume(dayVolume, rawWeights) : rawWeights.map(() => 0);

      parsedRows.forEach((row, index) => {
        previewRows.push({
          ...row,
          normalizedWeight: normalizedWeights[index] ?? 0,
          allocatedVolume: allocatedVolumes[index] ?? 0,
        });
      });

      const totalAllocatedVolume = allocatedVolumes.reduce((sum, value) => sum + value, 0);
      daySummaries.push({
        calendarDate: day.calendarDate,
        dateLabel: day.dateLabel,
        dayLabel: day.dayLabel,
        dayVolume,
        totalRawWeight,
        totalAllocatedVolume,
        hasInvalidWeight,
        hasZeroWeight,
        missingIntervals: false,
        totalIs100: Math.abs(totalRawWeight - 100) <= WEIGHT_TOTAL_TOLERANCE,
        sumsToDay: Math.abs(totalAllocatedVolume - dayVolume) <= 1,
      });
    });

  return {
    rows: previewRows,
    daySummaries,
    totalAllocatedVolume: previewRows.reduce((sum, row) => sum + row.allocatedVolume, 0),
    hasInvalidWeight: daySummaries.some((summary) => summary.hasInvalidWeight),
    hasZeroWeightDay: daySummaries.some((summary) => summary.hasZeroWeight),
    hasMissingIntervals: daySummaries.some((summary) => summary.missingIntervals),
    allDaysSumToSource: daySummaries.every((summary) => summary.sumsToDay),
  };
}

function applyHistoricalOverrides(apiData: number[], overrides: Record<number, string> = {}): number[] {
  const overrideIndexes = Object.keys(overrides).map(Number).filter(Number.isFinite);
  const len = Math.max(apiData.length, ...overrideIndexes.map((index) => index + 1), 0);
  return Array.from({ length: len }, (_, index) => {
    const api = apiData[index] ?? 0;
    const override = overrides[index];
    if (override === undefined || override === "") return api;
    const parsed = Math.round(Number(override));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : api;
  });
}

function arraysEqual(left: number[] | undefined, right: number[] | undefined): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function hasChannelSpecificHistory(snapshot: PlannerSnapshot | null, channel: ChannelKey): boolean {
  if (!snapshot) return false;
  const apiData = snapshot.channelHistoricalApiData?.[channel] ?? [];
  const overrides = snapshot.channelHistoricalOverrides?.[channel] ?? {};
  return apiData.length > 0 || Object.keys(overrides).length > 0;
}

function hasPooledLookingRecut(snapshot: PlannerSnapshot | null, channel: ChannelKey): boolean {
  if (!snapshot?.recutVolumesByChannel || snapshot.poolingMode !== "blended") return false;
  const selectedChannels = (["voice", "email", "chat", "cases"] as ChannelKey[])
    .filter((candidate) => snapshot.selectedChannels?.[candidate]);
  if (selectedChannels.length <= 1) return false;
  const target = snapshot.recutVolumesByChannel[channel];
  if (!Array.isArray(target) || target.length === 0) return false;
  return selectedChannels
    .filter((candidate) => candidate !== channel)
    .some((candidate) => arraysEqual(target, snapshot.recutVolumesByChannel?.[candidate]));
}

function hasChannelSpecificPlannerVolume(snapshot: PlannerSnapshot | null, channel: ChannelKey): boolean {
  if (!snapshot) return false;
  if (channel === "voice") return true;
  if (hasChannelSpecificHistory(snapshot, channel)) return true;
  const recut = snapshot.recutVolumesByChannel?.[channel];
  return Array.isArray(recut) && recut.length > 0 && !hasPooledLookingRecut(snapshot, channel);
}

function getMonthOffset(startDate: string | undefined, monthKey: string): number | null {
  if (!startDate || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;
  const [targetYear, targetMonth] = monthKey.split("-").map(Number);
  return (targetYear - start.getFullYear()) * 12 + (targetMonth - 1 - start.getMonth());
}

function getForecastPeriods(snapshot: PlannerSnapshot | null, targetOffset: number | null): number {
  const planningMonths = Number(snapshot?.assumptions?.planningMonths);
  const horizon = snapshot?.assumptions?.forecastHorizon === 2 ? 24 : 12;
  return Math.max(
    12,
    Number.isFinite(planningMonths) ? planningMonths : horizon,
    targetOffset !== null && targetOffset >= 0 ? targetOffset + 1 : 0
  );
}

function buildForecastVolumesByChannel(snapshot: PlannerSnapshot | null, forecastPeriods: number): Record<ChannelKey, number[]> {
  const empty = { voice: [] as number[], email: [] as number[], chat: [] as number[], cases: [] as number[] };
  if (!snapshot?.assumptions) return empty;

  const recut = snapshot.recutVolumesByChannel ?? null;
  const hasRecut = (channel: ChannelKey) => Array.isArray(recut?.[channel]) && (recut?.[channel]?.length ?? 0) > 0;
  const forecastMethod = snapshot.forecastMethod ?? "holtwinters";
  const hwParams = snapshot.hwParams ?? { alpha: 0.3, beta: 0.1, gamma: 0.3, seasonLength: 12 };
  const arimaParams = snapshot.arimaParams ?? { p: 1, d: 1, q: 1 };
  const decompParams = snapshot.decompParams ?? { trendStrength: 1, seasonalityStrength: 1 };
  const getHistory = (channel: ChannelKey) => applyHistoricalOverrides(
    snapshot.channelHistoricalApiData?.[channel] ?? [],
    snapshot.channelHistoricalOverrides?.[channel] ?? {}
  );

  const buildChannelForecast = (channel: ChannelKey) => {
    if (hasRecut(channel)) return recut![channel] ?? [];
    const history = getHistory(channel);
    if (channel !== "voice" && history.length === 0) return [];
    return getCalculatedVolumes(history, forecastMethod, snapshot.assumptions!, hwParams, arimaParams, decompParams, forecastPeriods);
  };

  return {
    voice: buildChannelForecast("voice"),
    email: buildChannelForecast("email"),
    chat: buildChannelForecast("chat"),
    cases: buildChannelForecast("cases"),
  };
}

function resolveDemandForecastVolume(snapshot: PlannerSnapshot | null, channel: ChannelKey, monthKey: string): DemandVolumeResolution {
  const offset = getMonthOffset(snapshot?.assumptions?.startDate, monthKey);
  if (!snapshot || offset === null || offset < 0 || !hasChannelSpecificPlannerVolume(snapshot, channel)) {
    return { volume: 0, hasForecast: false, source: "missing" };
  }

  const volumes = buildForecastVolumesByChannel(snapshot, getForecastPeriods(snapshot, offset));
  const volume = Math.max(0, Math.round(volumes[channel]?.[offset] ?? 0));
  const recut = snapshot.recutVolumesByChannel?.[channel];
  return {
    volume,
    hasForecast: true,
    source: Array.isArray(recut) && recut.length > 0 && !hasPooledLookingRecut(snapshot, channel)
      ? "recut"
      : "demand_forecasting",
  };
}

function resolveBlendedReferenceVolume(snapshot: PlannerSnapshot | null, monthKey: string): number | null {
  const offset = getMonthOffset(snapshot?.assumptions?.startDate, monthKey);
  if (!snapshot || offset === null || offset < 0) return null;
  const forecastPeriods = getForecastPeriods(snapshot, offset);
  const volumes = buildForecastVolumesByChannel(snapshot, forecastPeriods);
  const selectedChannels = (["voice", "email", "chat", "cases"] as ChannelKey[])
    .filter((channel) => snapshot.selectedChannels?.[channel] ?? true)
    .filter((channel) => hasChannelSpecificPlannerVolume(snapshot, channel));

  if (selectedChannels.length === 0) return null;
  return selectedChannels.reduce((sum, channel) => sum + Math.max(0, Math.round(volumes[channel]?.[offset] ?? 0)), 0);
}

function buildPlanQuery(lobId: number, channel: ChannelKey, staffingMode: StaffingMode, monthKey: string): string {
  return new URLSearchParams({
    lob_id: String(lobId),
    channel,
    staffing_mode: staffingMode,
    month_key: monthKey,
  }).toString();
}

export function IntradayForecastV2() {
  const { lobs, activeLob, setActiveLob, activeChannel } = useLOB();
  const [selectedLobId, setSelectedLobId] = useState<number | null>(activeLob?.id ?? null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelKey>(activeChannel);
  const [staffingMode, setStaffingMode] = useState<StaffingMode>("dedicated");
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  const [lobSettings, setLobSettings] = useState<LobSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [demandSnapshot, setDemandSnapshot] = useState<PlannerSnapshot | null>(null);
  const [demandSnapshotLabel, setDemandSnapshotLabel] = useState("Not loaded");
  const [demandLoading, setDemandLoading] = useState(false);
  const [demandError, setDemandError] = useState<string | null>(null);
  const [monthPlan, setMonthPlan] = useState<IntradayV2MonthPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [manualOverrideInput, setManualOverrideInput] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);
  const [weekWeightInputs, setWeekWeightInputs] = useState<Record<string, string>>({});
  const [savedWeekAllocations, setSavedWeekAllocations] = useState<IntradayV2WeekAllocation[]>([]);
  const [weekAllocationScopeKey, setWeekAllocationScopeKey] = useState("");
  const [weekAllocationLoading, setWeekAllocationLoading] = useState(false);
  const [weekAllocationError, setWeekAllocationError] = useState<string | null>(null);
  const [savingWeekAllocation, setSavingWeekAllocation] = useState(false);
  const [dayWeightInputs, setDayWeightInputs] = useState<Record<string, string>>({});
  const [savedDayAllocations, setSavedDayAllocations] = useState<IntradayV2DayAllocation[]>([]);
  const [dayAllocationScopeKey, setDayAllocationScopeKey] = useState("");
  const [dayAllocationLoading, setDayAllocationLoading] = useState(false);
  const [dayAllocationError, setDayAllocationError] = useState<string | null>(null);
  const [savingDayAllocation, setSavingDayAllocation] = useState(false);
  const [intervalWeightInputs, setIntervalWeightInputs] = useState<Record<string, string>>({});
  const [savedIntervalAllocations, setSavedIntervalAllocations] = useState<IntradayV2IntervalAllocation[]>([]);
  const [intervalAllocationScopeKey, setIntervalAllocationScopeKey] = useState("");
  const [intervalAllocationLoading, setIntervalAllocationLoading] = useState(false);
  const [intervalAllocationError, setIntervalAllocationError] = useState<string | null>(null);
  const [savingIntervalAllocation, setSavingIntervalAllocation] = useState(false);
  const activeScopeKeyRef = useRef("");

  useEffect(() => {
    if (activeLob?.id && !selectedLobId) setSelectedLobId(activeLob.id);
  }, [activeLob?.id, selectedLobId]);

  useEffect(() => {
    if (!selectedLobId) {
      setLobSettings(null);
      return;
    }

    let cancelled = false;
    setSettingsLoading(true);
    fetch(apiUrl(`/api/lob-settings?lob_id=${selectedLobId}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((settings: LobSettings | null) => {
        if (cancelled) return;
        setLobSettings(settings);
        setStaffingMode(normalizeStaffingMode(settings?.pooling_mode));
      })
      .catch(() => {
        if (!cancelled) setLobSettings(null);
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedLobId]);

  useEffect(() => {
    if (!selectedLobId) {
      setDemandSnapshot(null);
      setDemandSnapshotLabel("No LOB selected");
      setDemandError(null);
      return;
    }

    const controller = new AbortController();
    setDemandSnapshot(null);
    setDemandSnapshotLabel("Loading");
    setDemandError(null);
    setDemandLoading(true);

    Promise.all([
      fetch(apiUrl(`/api/demand-planner-active-state?lob_id=${selectedLobId}`), { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .catch((error) => {
          if (error?.name === "AbortError") throw error;
          return null;
        }),
      fetch(apiUrl(`/api/demand-planner-scenarios/committed?lob_id=${selectedLobId}`), { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .catch((error) => {
          if (error?.name === "AbortError") throw error;
          return null;
        }),
    ])
      .then(([activeState, committedScenario]: [DemandPlannerActiveState | null, DemandPlannerCommittedScenario | null]) => {
        const activeSnapshot = activeState?.plannerSnapshot ?? null;
        const committedSnapshot = committedScenario?.planner_snapshot ?? null;
        const snapshot = activeSnapshot ?? committedSnapshot;
        setDemandSnapshot(snapshot);
        setDemandSnapshotLabel(activeSnapshot ? "Demand Forecasting active state" : committedSnapshot ? "Committed Demand Forecasting scenario" : "Missing / Not Available");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setDemandSnapshot(null);
        setDemandSnapshotLabel("Missing / Not Available");
        setDemandError("Unable to load Demand Forecasting source for this LOB.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDemandLoading(false);
      });

    return () => controller.abort();
  }, [selectedLobId]);

  const enabledChannels = useMemo(() => normalizeEnabledChannels(lobSettings), [lobSettings]);
  const channelOptions = useMemo(
    () => CHANNEL_SELECT_OPTIONS.filter((option) => enabledChannels[option.value]),
    [enabledChannels]
  );

  useEffect(() => {
    if (channelOptions.length === 0) return;
    if (!channelOptions.some((option) => option.value === selectedChannel)) {
      setSelectedChannel(channelOptions[0].value);
    }
  }, [channelOptions, selectedChannel]);

  const selectedLob = useMemo(
    () => lobs.find((lob) => lob.id === selectedLobId) ?? activeLob ?? null,
    [activeLob, lobs, selectedLobId]
  );
  const monthWeeks = useMemo(() => buildMonthWeeks(monthKey), [monthKey]);
  const defaultWeekWeightInputs = useMemo(() => buildDefaultWeekWeightInputs(monthWeeks), [monthWeeks]);

  const activeChannelLabel = formatChannelLabel(selectedChannel);
  const scopeLabel = `${selectedLob?.lob_name ?? "No LOB"} / ${activeChannelLabel} / ${staffingMode} / ${monthKey}`;
  const scopeKey = `${selectedLobId ?? "none"}:${selectedChannel}:${staffingMode}:${monthKey}`;

  useEffect(() => {
    activeScopeKeyRef.current = scopeKey;
  }, [scopeKey]);

  useEffect(() => {
    setMonthPlan(null);
    setManualOverrideInput("");
    setPlanError(null);

    if (!selectedLobId || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
      setPlanLoading(false);
      return;
    }

    const requestScopeKey = scopeKey;
    const controller = new AbortController();
    setPlanLoading(true);

    fetch(apiUrl(`/api/intraday-v2/plans?${buildPlanQuery(selectedLobId, selectedChannel, staffingMode, monthKey)}`), {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Unable to load scoped month plan.");
        }
        return response.json() as Promise<IntradayV2MonthPlan | null>;
      })
      .then((plan) => {
        if (activeScopeKeyRef.current !== requestScopeKey) return;
        setMonthPlan(plan);
        setManualOverrideInput(formatNumberInput(plan?.manual_monthly_volume));
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        if (activeScopeKeyRef.current !== requestScopeKey) return;
        setMonthPlan(null);
        setManualOverrideInput("");
        setPlanError(error?.message || "Unable to load scoped month plan.");
      })
      .finally(() => {
        if (!controller.signal.aborted && activeScopeKeyRef.current === requestScopeKey) setPlanLoading(false);
      });

    return () => controller.abort();
  }, [monthKey, scopeKey, selectedChannel, selectedLobId, staffingMode]);

  useEffect(() => {
    setWeekAllocationScopeKey(scopeKey);
    setSavedWeekAllocations([]);
    setWeekWeightInputs(defaultWeekWeightInputs);
    setWeekAllocationError(null);

    if (!selectedLobId || monthWeeks.length === 0) {
      setWeekAllocationLoading(false);
      return;
    }

    const requestScopeKey = scopeKey;
    const controller = new AbortController();
    setWeekAllocationLoading(true);

    fetch(apiUrl(`/api/intraday-v2/week-allocations?${buildPlanQuery(selectedLobId, selectedChannel, staffingMode, monthKey)}`), {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Unable to load scoped week allocation.");
        }
        return response.json() as Promise<IntradayV2WeekAllocation[]>;
      })
      .then((allocations) => {
        if (activeScopeKeyRef.current !== requestScopeKey) return;
        const scopedAllocations = Array.isArray(allocations) ? allocations : [];
        setWeekAllocationScopeKey(requestScopeKey);
        setSavedWeekAllocations(scopedAllocations);
        setWeekWeightInputs(
          scopedAllocations.length > 0
            ? buildSavedWeekWeightInputs(monthWeeks, scopedAllocations)
            : defaultWeekWeightInputs
        );
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        if (activeScopeKeyRef.current !== requestScopeKey) return;
        setWeekAllocationScopeKey(requestScopeKey);
        setSavedWeekAllocations([]);
        setWeekWeightInputs(defaultWeekWeightInputs);
        setWeekAllocationError(error?.message || "Unable to load scoped week allocation.");
      })
      .finally(() => {
        if (!controller.signal.aborted && activeScopeKeyRef.current === requestScopeKey) setWeekAllocationLoading(false);
      });

    return () => controller.abort();
  }, [defaultWeekWeightInputs, monthKey, monthWeeks, scopeKey, selectedChannel, selectedLobId, staffingMode]);

  const demandVolume = useMemo(
    () => resolveDemandForecastVolume(demandSnapshot, selectedChannel, monthKey),
    [demandSnapshot, monthKey, selectedChannel]
  );
  const blendedReferenceVolume = useMemo(
    () => resolveBlendedReferenceVolume(demandSnapshot, monthKey),
    [demandSnapshot, monthKey]
  );
  const savedManualOverride = parseOptionalNumber(monthPlan?.manual_monthly_volume);
  const draftManualOverride = parseOptionalNumber(manualOverrideInput);
  const manualInputHasValue = manualOverrideInput.trim() !== "";
  const manualInputValid = !manualInputHasValue || draftManualOverride !== null && draftManualOverride >= 0;
  const effectiveManualOverride = manualInputHasValue ? draftManualOverride : savedManualOverride;
  const hasEffectiveManualOverride = effectiveManualOverride !== null && effectiveManualOverride >= 0;
  const effectiveMonthlyVolume = hasEffectiveManualOverride ? Math.round(effectiveManualOverride) : demandVolume.volume;
  const sourceLabel = hasEffectiveManualOverride
    ? "Manual Override"
    : demandVolume.hasForecast
      ? "Demand Forecasting"
      : "Missing / Not Available";
  const sourceBadgeClass = hasEffectiveManualOverride
    ? "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-50"
    : demandVolume.hasForecast
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
      : "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-100";

  const persistManualOverride = async (manualValue: number | null) => {
    if (!selectedLobId) return;
    const requestScopeKey = scopeKey;
    const effectiveValue = manualValue ?? demandVolume.volume;

    setSavingPlan(true);
    setPlanError(null);
    try {
      const response = await fetch(apiUrl("/api/intraday-v2/plans"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lob_id: selectedLobId,
          channel: selectedChannel,
          staffing_mode: staffingMode,
          month_key: monthKey,
          demand_forecast_volume: demandVolume.hasForecast ? demandVolume.volume : null,
          demand_source: demandVolume.hasForecast ? demandVolume.source : null,
          manual_monthly_volume: manualValue,
          effective_monthly_volume: effectiveValue,
          status: "draft",
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Unable to save manual override.");
      }
      const plan = await response.json() as IntradayV2MonthPlan;
      if (activeScopeKeyRef.current !== requestScopeKey) return;
      setMonthPlan(plan);
      setManualOverrideInput(formatNumberInput(plan.manual_monthly_volume));
      toast.success(manualValue === null ? "Monthly override cleared" : "Monthly override saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save manual override.";
      if (activeScopeKeyRef.current === requestScopeKey) setPlanError(message);
      toast.error(message);
    } finally {
      setSavingPlan(false);
    }
  };

  const saveManualOverride = async () => {
    if (!manualInputValid) return;
    const manualValue = manualInputHasValue && draftManualOverride !== null
      ? Math.max(0, Math.round(draftManualOverride))
      : null;
    await persistManualOverride(manualValue);
  };

  const clearManualOverride = async () => {
    setManualOverrideInput("");
    await persistManualOverride(null);
  };

  const weekInputsForScope = weekAllocationScopeKey === scopeKey ? weekWeightInputs : defaultWeekWeightInputs;
  const hasSavedWeekAllocation = weekAllocationScopeKey === scopeKey && savedWeekAllocations.length > 0;
  const baselineWeekInputs = hasSavedWeekAllocation
    ? buildSavedWeekWeightInputs(monthWeeks, savedWeekAllocations)
    : defaultWeekWeightInputs;
  const hasUnsavedWeekChanges = monthWeeks.some(
    (week) => (weekInputsForScope[week.weekStart] ?? "") !== (baselineWeekInputs[week.weekStart] ?? "")
  );
  const weekAllocationPreview = useMemo(
    () => buildWeekAllocationPreview(monthWeeks, weekInputsForScope, effectiveMonthlyVolume),
    [effectiveMonthlyVolume, monthWeeks, weekInputsForScope]
  );
  const weekWeightsTotalIs100 = Math.abs(weekAllocationPreview.totalRawWeight - 100) <= WEIGHT_TOTAL_TOLERANCE;
  const weekAllocationWarning = weekAllocationPreview.hasInvalidWeight
    ? "Weights must be non-negative numbers. Default month-day allocation is shown for the preview."
    : weekAllocationPreview.totalRawWeight <= 0
      ? "Enter at least one positive week weight. Default month-day allocation is shown for the preview."
      : !weekWeightsTotalIs100
        ? `Weights total ${formatPercent(weekAllocationPreview.totalRawWeight)}. Volumes are normalized to 100% before allocation.`
        : null;
  const weekAllocationSourceLabel = hasSavedWeekAllocation ? "Saved manual week allocation" : "Default month-day allocation";
  const weekAllocationBadgeClass = hasSavedWeekAllocation
    ? "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-50"
    : "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-50";
  const weekAllocationSumsToMonthly = Math.abs(weekAllocationPreview.totalAllocatedVolume - effectiveMonthlyVolume) <= 1;
  const weekSaveDisabled =
    !selectedLobId ||
    monthWeeks.length === 0 ||
    planLoading ||
    demandLoading ||
    weekAllocationLoading ||
    savingWeekAllocation ||
    weekAllocationPreview.hasInvalidWeight ||
    weekAllocationPreview.totalRawWeight <= 0;

  const operatingDaySet = useMemo(() => getOperatingDaySet(lobSettings, selectedChannel), [lobSettings, selectedChannel]);
  const weekVolumesByStart = useMemo(
    () => Object.fromEntries(weekAllocationPreview.rows.map((row) => [row.week.weekStart, row.allocatedVolume])),
    [weekAllocationPreview.rows]
  );
  const dayAllocationRows = useMemo(
    () => buildDayAllocationDays(monthWeeks, weekVolumesByStart, monthKey),
    [monthKey, monthWeeks, weekVolumesByStart]
  );
  const dayAllocationInputRows = useMemo(
    () => buildDayAllocationDays(monthWeeks, {}, monthKey),
    [monthKey, monthWeeks]
  );
  const defaultDayWeightInputs = useMemo(
    () => buildDefaultDayWeightInputs(dayAllocationInputRows, operatingDaySet),
    [dayAllocationInputRows, operatingDaySet]
  );

  useEffect(() => {
    setDayAllocationScopeKey(scopeKey);
    setSavedDayAllocations([]);
    setDayWeightInputs(defaultDayWeightInputs);
    setDayAllocationError(null);

    if (!selectedLobId || dayAllocationInputRows.length === 0) {
      setDayAllocationLoading(false);
      return;
    }

    const requestScopeKey = scopeKey;
    const controller = new AbortController();
    setDayAllocationLoading(true);

    fetch(apiUrl(`/api/intraday-v2/day-allocations?${buildPlanQuery(selectedLobId, selectedChannel, staffingMode, monthKey)}`), {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Unable to load scoped day allocation.");
        }
        return response.json() as Promise<IntradayV2DayAllocation[]>;
      })
      .then((allocations) => {
        if (activeScopeKeyRef.current !== requestScopeKey) return;
        const scopedAllocations = Array.isArray(allocations) ? allocations : [];
        setDayAllocationScopeKey(requestScopeKey);
        setSavedDayAllocations(scopedAllocations);
        setDayWeightInputs(
          scopedAllocations.length > 0
            ? buildSavedDayWeightInputs(dayAllocationInputRows, scopedAllocations, defaultDayWeightInputs)
            : defaultDayWeightInputs
        );
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        if (activeScopeKeyRef.current !== requestScopeKey) return;
        setDayAllocationScopeKey(requestScopeKey);
        setSavedDayAllocations([]);
        setDayWeightInputs(defaultDayWeightInputs);
        setDayAllocationError(error?.message || "Unable to load scoped day allocation.");
      })
      .finally(() => {
        if (!controller.signal.aborted && activeScopeKeyRef.current === requestScopeKey) setDayAllocationLoading(false);
      });

    return () => controller.abort();
  }, [dayAllocationInputRows, defaultDayWeightInputs, monthKey, scopeKey, selectedChannel, selectedLobId, staffingMode]);

  const dayInputsForScope = dayAllocationScopeKey === scopeKey ? dayWeightInputs : defaultDayWeightInputs;
  const hasSavedDayAllocation = dayAllocationScopeKey === scopeKey && savedDayAllocations.length > 0;
  const baselineDayInputs = hasSavedDayAllocation
    ? buildSavedDayWeightInputs(dayAllocationInputRows, savedDayAllocations, defaultDayWeightInputs)
    : defaultDayWeightInputs;
  const hasUnsavedDayChanges = dayAllocationInputRows.some(
    (row) => (dayInputsForScope[row.calendarDate] ?? "") !== (baselineDayInputs[row.calendarDate] ?? "")
  );
  const dayAllocationPreview = useMemo(
    () => buildDayAllocationPreview(dayAllocationRows, dayInputsForScope),
    [dayAllocationRows, dayInputsForScope]
  );
  const dayAllocationSourceLabel = hasSavedDayAllocation
    ? "Saved manual day allocation"
    : operatingDaySet
      ? "Default operating-day allocation"
      : "Default equal-day allocation";
  const dayAllocationBadgeClass = hasSavedDayAllocation
    ? "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-50"
    : operatingDaySet
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
      : "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-50";
  const dayAllocationWarning = dayAllocationError
    || (dayAllocationPreview.hasInvalidWeight ? "Day weights must be non-negative numbers." : null)
    || (dayAllocationPreview.hasZeroWeightWeek ? "At least one week has all day weights set to 0; that week allocates 0 until corrected." : null)
    || (dayAllocationPreview.weekSummaries.some((summary) => !summary.totalIs100 && summary.totalRawWeight > 0)
      ? "One or more week day-weight totals are not 100%. Volumes are normalized within each week before allocation."
      : null)
    || (!dayAllocationPreview.allWeeksSumToSource ? "One or more day totals do not match their week allocation." : null);
  const daySaveDisabled =
    !selectedLobId ||
    dayAllocationInputRows.length === 0 ||
    weekAllocationLoading ||
    dayAllocationLoading ||
    savingDayAllocation ||
    dayAllocationPreview.hasInvalidWeight ||
    dayAllocationPreview.hasZeroWeightWeek;

  const intervalAllocationRows = useMemo(
    () => buildIntervalAllocationRows(dayAllocationPreview.rows, lobSettings, selectedChannel),
    [dayAllocationPreview.rows, lobSettings, selectedChannel]
  );
  const intervalAllocationInputRows = useMemo(
    () => buildIntervalAllocationRows(dayAllocationInputRows, lobSettings, selectedChannel),
    [dayAllocationInputRows, lobSettings, selectedChannel]
  );
  const defaultIntervalWeightInputs = useMemo(
    () => buildDefaultIntervalWeightInputs(intervalAllocationInputRows),
    [intervalAllocationInputRows]
  );

  useEffect(() => {
    setIntervalAllocationScopeKey(scopeKey);
    setSavedIntervalAllocations([]);
    setIntervalWeightInputs(defaultIntervalWeightInputs);
    setIntervalAllocationError(null);

    if (!selectedLobId || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
      setIntervalAllocationLoading(false);
      return;
    }

    const requestScopeKey = scopeKey;
    const controller = new AbortController();
    setIntervalAllocationLoading(true);

    fetch(apiUrl(`/api/intraday-v2/interval-allocations?${buildPlanQuery(selectedLobId, selectedChannel, staffingMode, monthKey)}`), {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Unable to load scoped interval allocation.");
        }
        return response.json() as Promise<IntradayV2IntervalAllocation[]>;
      })
      .then((allocations) => {
        if (activeScopeKeyRef.current !== requestScopeKey) return;
        const scopedAllocations = Array.isArray(allocations) ? allocations : [];
        setIntervalAllocationScopeKey(requestScopeKey);
        setSavedIntervalAllocations(scopedAllocations);
        setIntervalWeightInputs(
          scopedAllocations.length > 0
            ? buildSavedIntervalWeightInputs(intervalAllocationInputRows, scopedAllocations, defaultIntervalWeightInputs)
            : defaultIntervalWeightInputs
        );
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        if (activeScopeKeyRef.current !== requestScopeKey) return;
        setIntervalAllocationScopeKey(requestScopeKey);
        setSavedIntervalAllocations([]);
        setIntervalWeightInputs(defaultIntervalWeightInputs);
        setIntervalAllocationError(error?.message || "Unable to load scoped interval allocation.");
      })
      .finally(() => {
        if (!controller.signal.aborted && activeScopeKeyRef.current === requestScopeKey) setIntervalAllocationLoading(false);
      });

    return () => controller.abort();
  }, [
    defaultIntervalWeightInputs,
    intervalAllocationInputRows,
    monthKey,
    scopeKey,
    selectedChannel,
    selectedLobId,
    staffingMode,
  ]);

  const intervalInputsForScope = intervalAllocationScopeKey === scopeKey ? intervalWeightInputs : defaultIntervalWeightInputs;
  const hasSavedIntervalAllocation = intervalAllocationScopeKey === scopeKey && savedIntervalAllocations.length > 0;
  const baselineIntervalInputs = hasSavedIntervalAllocation
    ? buildSavedIntervalWeightInputs(intervalAllocationInputRows, savedIntervalAllocations, defaultIntervalWeightInputs)
    : defaultIntervalWeightInputs;
  const hasUnsavedIntervalChanges = intervalAllocationInputRows.some(
    (row) => (intervalInputsForScope[row.key] ?? "") !== (baselineIntervalInputs[row.key] ?? "")
  );
  const intervalAllocationPreview = useMemo(
    () => buildIntervalAllocationPreview(intervalAllocationRows, dayAllocationPreview.rows, intervalInputsForScope),
    [dayAllocationPreview.rows, intervalAllocationRows, intervalInputsForScope]
  );
  const intervalAllocationSourceLabel = hasSavedIntervalAllocation
    ? "Saved manual interval allocation"
    : "Default operating-interval allocation";
  const intervalAllocationBadgeClass = hasSavedIntervalAllocation
    ? "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-50"
    : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50";
  const intervalAllocationWarning = intervalAllocationError
    || (intervalAllocationPreview.hasMissingIntervals ? "One or more days have allocated volume but no operating intervals in LOB settings." : null)
    || (intervalAllocationPreview.hasInvalidWeight ? "Interval weights must be non-negative numbers." : null)
    || (intervalAllocationPreview.hasZeroWeightDay ? "At least one day has all interval weights set to 0; that day allocates 0 until corrected." : null)
    || (intervalAllocationPreview.daySummaries.some((summary) => summary.dayVolume > 0 && !summary.totalIs100 && summary.totalRawWeight > 0)
      ? "One or more day interval-weight totals are not 100%. Volumes are normalized within each day before allocation."
      : null)
    || (!intervalAllocationPreview.allDaysSumToSource ? "One or more interval totals do not match their day allocation." : null);
  const intervalSaveDisabled =
    !selectedLobId ||
    intervalAllocationInputRows.length === 0 ||
    dayAllocationLoading ||
    intervalAllocationLoading ||
    savingIntervalAllocation ||
    intervalAllocationPreview.hasInvalidWeight ||
    intervalAllocationPreview.hasZeroWeightDay ||
    intervalAllocationPreview.hasMissingIntervals ||
    !intervalAllocationPreview.allDaysSumToSource;

  const updateWeekWeightInput = (weekStart: string, value: string) => {
    setWeekAllocationScopeKey(scopeKey);
    setWeekWeightInputs((previous) => ({
      ...(weekAllocationScopeKey === scopeKey ? previous : defaultWeekWeightInputs),
      [weekStart]: value,
    }));
  };

  const resetWeekWeightsToDefault = () => {
    setWeekAllocationScopeKey(scopeKey);
    setWeekWeightInputs(defaultWeekWeightInputs);
  };

  const saveWeekAllocation = async () => {
    if (!selectedLobId || weekSaveDisabled) return;
    const requestScopeKey = scopeKey;
    const allocations = weekAllocationPreview.rows.map((row) => ({
      week_start: row.week.weekStart,
      week_index: row.week.weekIndex,
      weight: Number(row.normalizedWeight.toFixed(6)),
      volume: row.allocatedVolume,
      is_locked: false,
    }));

    setSavingWeekAllocation(true);
    setWeekAllocationError(null);
    try {
      const response = await fetch(apiUrl("/api/intraday-v2/week-allocations"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lob_id: selectedLobId,
          channel: selectedChannel,
          staffing_mode: staffingMode,
          month_key: monthKey,
          allocations,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Unable to save week allocation.");
      }
      const result = await response.json() as { rows?: IntradayV2WeekAllocation[] };
      if (activeScopeKeyRef.current !== requestScopeKey) return;
      const savedRows = Array.isArray(result.rows) ? result.rows : allocations;
      setWeekAllocationScopeKey(requestScopeKey);
      setSavedWeekAllocations(savedRows);
      setWeekWeightInputs(buildSavedWeekWeightInputs(monthWeeks, savedRows));
      toast.success("Week allocation saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save week allocation.";
      if (activeScopeKeyRef.current === requestScopeKey) setWeekAllocationError(message);
      toast.error(message);
    } finally {
      setSavingWeekAllocation(false);
    }
  };

  const updateDayWeightInput = (calendarDate: string, value: string) => {
    setDayAllocationScopeKey(scopeKey);
    setDayWeightInputs((previous) => ({
      ...(dayAllocationScopeKey === scopeKey ? previous : defaultDayWeightInputs),
      [calendarDate]: value,
    }));
  };

  const resetDayWeightsToDefault = () => {
    setDayAllocationScopeKey(scopeKey);
    setDayWeightInputs(defaultDayWeightInputs);
  };

  const saveDayAllocation = async () => {
    if (!selectedLobId || daySaveDisabled) return;
    const requestScopeKey = scopeKey;
    const allocations = dayAllocationPreview.rows.map((row) => ({
      calendar_date: row.calendarDate,
      day_of_week: row.dayOfWeek,
      week_start: row.weekStart,
      weight: Number(row.normalizedWeight.toFixed(6)),
      volume: row.allocatedVolume,
      is_locked: false,
    }));

    setSavingDayAllocation(true);
    setDayAllocationError(null);
    try {
      const response = await fetch(apiUrl("/api/intraday-v2/day-allocations"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lob_id: selectedLobId,
          channel: selectedChannel,
          staffing_mode: staffingMode,
          month_key: monthKey,
          allocations,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Unable to save day allocation.");
      }
      const result = await response.json() as { rows?: IntradayV2DayAllocation[] };
      if (activeScopeKeyRef.current !== requestScopeKey) return;
      const savedRows = Array.isArray(result.rows) ? result.rows : allocations;
      setDayAllocationScopeKey(requestScopeKey);
      setSavedDayAllocations(savedRows);
      setDayWeightInputs(buildSavedDayWeightInputs(dayAllocationInputRows, savedRows, defaultDayWeightInputs));
      toast.success("Day allocation saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save day allocation.";
      if (activeScopeKeyRef.current === requestScopeKey) setDayAllocationError(message);
      toast.error(message);
    } finally {
      setSavingDayAllocation(false);
    }
  };

  const updateIntervalWeightInput = (key: string, value: string) => {
    setIntervalAllocationScopeKey(scopeKey);
    setIntervalWeightInputs((previous) => ({
      ...(intervalAllocationScopeKey === scopeKey ? previous : defaultIntervalWeightInputs),
      [key]: value,
    }));
  };

  const resetIntervalWeightsToDefault = () => {
    setIntervalAllocationScopeKey(scopeKey);
    setIntervalWeightInputs(defaultIntervalWeightInputs);
  };

  const saveIntervalAllocation = async () => {
    if (!selectedLobId || intervalSaveDisabled) return;
    const requestScopeKey = scopeKey;
    const allocations = intervalAllocationPreview.rows.map((row) => ({
      calendar_date: row.calendarDate,
      interval_index: row.intervalIndex,
      interval_start: row.intervalStart,
      interval_minutes: row.intervalMinutes,
      weight: Number(row.normalizedWeight.toFixed(6)),
      volume: row.allocatedVolume,
      aht_seconds: null,
    }));

    setSavingIntervalAllocation(true);
    setIntervalAllocationError(null);
    try {
      const response = await fetch(apiUrl("/api/intraday-v2/interval-allocations"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lob_id: selectedLobId,
          channel: selectedChannel,
          staffing_mode: staffingMode,
          month_key: monthKey,
          allocations,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Unable to save interval allocation.");
      }
      const result = await response.json() as { rows?: IntradayV2IntervalAllocation[] };
      if (activeScopeKeyRef.current !== requestScopeKey) return;
      const savedRows: IntradayV2IntervalAllocation[] = Array.isArray(result.rows) ? result.rows : allocations;
      setIntervalAllocationScopeKey(requestScopeKey);
      setSavedIntervalAllocations(savedRows);
      setIntervalWeightInputs(buildSavedIntervalWeightInputs(intervalAllocationInputRows, savedRows, defaultIntervalWeightInputs));
      toast.success("Interval allocation saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save interval allocation.";
      if (activeScopeKeyRef.current === requestScopeKey) setIntervalAllocationError(message);
      toast.error(message);
    } finally {
      setSavingIntervalAllocation(false);
    }
  };

  return (
    <PageLayout>
      <div className="py-6 space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 py-7 text-white shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Badge className="mb-3 border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/10">
                Parallel build
              </Badge>
              <h1 className="text-3xl font-semibold tracking-tight">Intraday Forecast v2</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-cyan-50/80">
                Shape monthly demand into week, day, and interval patterns with strict LOB, channel,
                staffing mode, and month scoping.
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-xs text-cyan-50/85 backdrop-blur">
              <div className="font-mono uppercase tracking-[0.18em] text-cyan-200/80">Active shell scope</div>
              <div className="mt-1 font-medium text-white">{scopeLabel}</div>
            </div>
          </div>
        </section>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 pb-5">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-4 text-cyan-600" />
              Scope Bar
            </CardTitle>
            <CardDescription>
              These controls define the exact planning scope for monthly source and week allocation data.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 pt-5 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">LOB</span>
              <Select
                value={selectedLobId ? String(selectedLobId) : ""}
                onValueChange={(value) => {
                  const nextLob = lobs.find((lob) => lob.id === Number(value));
                  if (!nextLob) return;
                  setSelectedLobId(nextLob.id);
                  setActiveLob(nextLob);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select LOB" />
                </SelectTrigger>
                <SelectContent>
                  {lobs.map((lob) => (
                    <SelectItem key={lob.id} value={String(lob.id)}>
                      {lob.lob_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Month</span>
              <Input type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value || currentMonthKey())} />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Channel</span>
              <Select value={selectedChannel} onValueChange={(value) => setSelectedChannel(value as ChannelKey)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  {channelOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500">
                {settingsLoading ? "Loading enabled channels..." : "Options reflect enabled LOB channels when available."}
              </p>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Staffing Mode</span>
              <Select value={staffingMode} onValueChange={(value) => setStaffingMode(value as StaffingMode)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select staffing mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dedicated">Dedicated</SelectItem>
                  <SelectItem value="blended">Blended</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500">Defaults from LOB settings when available.</p>
            </label>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="rounded-lg bg-cyan-50 p-2 text-cyan-700">
                    <TrendingUp className="size-4" />
                  </span>
                  Monthly Volume Source
                </CardTitle>
                <CardDescription className="mt-2">
                  Selected-channel monthly demand for {activeChannelLabel} only. Manual override is scoped to this
                  LOB, channel, staffing mode, and month.
                </CardDescription>
              </div>
              <Badge variant="outline" className={sourceBadgeClass}>
                {sourceLabel}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            {(demandError || planError) && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{demandError || planError}</span>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Demand Forecast Monthly Volume</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {demandLoading ? <Loader2 className="size-5 animate-spin text-slate-500" /> : formatVolume(demandVolume.volume)}
                </p>
                <p className="mt-1 text-xs text-slate-500">{demandSnapshotLabel}</p>
              </div>

              <label className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual Override</span>
                <Input
                  className="mt-2"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  placeholder={planLoading ? "Loading scoped override..." : "Optional override"}
                  disabled={!selectedLobId || planLoading || savingPlan}
                  value={manualOverrideInput}
                  onChange={(event) => setManualOverrideInput(event.target.value)}
                />
                <p className={`mt-1 text-xs ${manualInputValid ? "text-slate-500" : "text-rose-600"}`}>
                  {manualInputValid ? "Saved with the active scope only." : "Enter a non-negative number."}
                </p>
              </label>

              <div className="rounded-xl border border-slate-200 bg-cyan-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Effective Monthly Volume</p>
                <p className="mt-2 text-2xl font-semibold text-cyan-950">
                  {planLoading ? <Loader2 className="size-5 animate-spin text-cyan-700" /> : formatVolume(effectiveMonthlyVolume)}
                </p>
                <p className="mt-1 text-xs text-cyan-800">Used by future week/day/interval distribution phases.</p>
              </div>
            </div>

            {staffingMode === "blended" && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Blended total reference only:{" "}
                <span className="font-semibold text-slate-900">{formatVolume(blendedReferenceVolume)}</span>.
                This does not populate {activeChannelLabel}'s monthly volume.
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                Scope: <span className="font-medium text-slate-700">{scopeLabel}</span>
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedLobId || planLoading || savingPlan || savedManualOverride === null && !manualInputHasValue}
                  onClick={clearManualOverride}
                >
                  {savingPlan ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
                  Clear override
                </Button>
                <Button
                  type="button"
                  disabled={!selectedLobId || planLoading || savingPlan || !manualInputValid}
                  onClick={saveManualOverride}
                >
                  {savingPlan ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                  Save override
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="rounded-lg bg-cyan-50 p-2 text-cyan-700">
                    <CalendarDays className="size-4" />
                  </span>
                  Week Allocation
                </CardTitle>
                <CardDescription className="mt-2">
                  Split the effective monthly volume into the weeks overlapping {monthKey}. The default uses actual
                  days inside the selected month.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {weekAllocationLoading && <Loader2 className="size-4 animate-spin text-slate-500" />}
                <Badge variant="outline" className={weekAllocationBadgeClass}>
                  {weekAllocationSourceLabel}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            {(weekAllocationError || weekAllocationWarning || !weekAllocationSumsToMonthly) && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {weekAllocationError ||
                    weekAllocationWarning ||
                    "Allocated weekly volume does not match the effective monthly volume."}
                </span>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Effective Monthly Volume</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{formatVolume(effectiveMonthlyVolume)}</p>
                <p className="mt-1 text-xs text-slate-500">{sourceLabel}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Weight</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{formatPercent(weekAllocationPreview.totalRawWeight)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {weekWeightsTotalIs100 ? "Ready for allocation." : "Normalized before volume calculation."}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-cyan-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Allocated Volume</p>
                <p className="mt-2 text-2xl font-semibold text-cyan-950">
                  {formatVolume(weekAllocationPreview.totalAllocatedVolume)}
                </p>
                <p className="mt-1 text-xs text-cyan-800">
                  {weekAllocationSumsToMonthly ? "Sums back to monthly volume." : "Review rounding or weights."}
                </p>
              </div>
            </div>

            <Table containerClassName="rounded-lg border border-slate-200">
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead>Week label</TableHead>
                  <TableHead>Date range</TableHead>
                  <TableHead className="text-right">Days in selected month</TableHead>
                  <TableHead className="min-w-[190px] text-right">Weight %</TableHead>
                  <TableHead className="text-right">Allocated volume</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weekAllocationPreview.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-sm text-slate-500">
                      Select a valid month to generate week allocation rows.
                    </TableCell>
                  </TableRow>
                ) : (
                  weekAllocationPreview.rows.map((row) => (
                    <TableRow key={row.week.weekStart}>
                      <TableCell className="font-medium text-slate-900">{row.week.label}</TableCell>
                      <TableCell className="text-slate-600">{row.week.dateRange}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.week.daysInMonth}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          className={`ml-auto h-8 w-28 text-right tabular-nums ${row.invalid ? "border-rose-300 text-rose-700 focus-visible:ring-rose-300" : ""}`}
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          disabled={!selectedLobId || weekAllocationLoading || savingWeekAllocation}
                          value={row.inputValue}
                          onChange={(event) => updateWeekWeightInput(row.week.weekStart, event.target.value)}
                        />
                        <p className="mt-1 text-[11px] text-slate-500">
                          Normalized {formatPercent(row.normalizedWeight)}
                        </p>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-slate-900">
                        {formatVolume(row.allocatedVolume)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Totals</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(weekAllocationPreview.totalRawWeight)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVolume(weekAllocationPreview.totalAllocatedVolume)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                Scope: <span className="font-medium text-slate-700">{scopeLabel}</span>
                {hasUnsavedWeekChanges ? <span className="ml-2 text-amber-700">Unsaved week edits</span> : null}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedLobId || weekAllocationLoading || savingWeekAllocation}
                  onClick={resetWeekWeightsToDefault}
                >
                  <RefreshCw className="mr-2 size-4" />
                  Reset default
                </Button>
                <Button type="button" disabled={weekSaveDisabled} onClick={saveWeekAllocation}>
                  {savingWeekAllocation ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                  Save week allocation
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="rounded-lg bg-cyan-50 p-2 text-cyan-700">
                    <Table2 className="size-4" />
                  </span>
                  Day Allocation
                </CardTitle>
                <CardDescription className="mt-2">
                  Split each week allocation into calendar days. Days outside {monthKey} stay at 0 weight and 0 volume.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {dayAllocationLoading && <Loader2 className="size-4 animate-spin text-slate-500" />}
                {hasUnsavedWeekChanges && (
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50">
                    Based on current week allocation
                  </Badge>
                )}
                <Badge variant="outline" className={dayAllocationBadgeClass}>
                  {dayAllocationSourceLabel}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            {dayAllocationWarning && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{dayAllocationWarning}</span>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Week Allocation Basis</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatVolume(weekAllocationPreview.totalAllocatedVolume)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {hasUnsavedWeekChanges ? "Current on-screen week allocation." : weekAllocationSourceLabel}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weeks Balanced</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {dayAllocationPreview.weekSummaries.filter((summary) => summary.sumsToWeek).length}/{dayAllocationPreview.weekSummaries.length}
                </p>
                <p className="mt-1 text-xs text-slate-500">Each week should sum to its week volume.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-cyan-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Allocated Day Volume</p>
                <p className="mt-2 text-2xl font-semibold text-cyan-950">
                  {formatVolume(dayAllocationPreview.totalAllocatedVolume)}
                </p>
                <p className="mt-1 text-xs text-cyan-800">
                  {dayAllocationPreview.allWeeksSumToSource ? "Sums back to week allocation." : "Review day weights."}
                </p>
              </div>
            </div>

            <Table containerClassName="rounded-lg border border-slate-200">
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead>Week label</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Day of week</TableHead>
                  <TableHead className="min-w-[190px] text-right">Weight %</TableHead>
                  <TableHead className="text-right">Allocated volume</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dayAllocationPreview.weekSummaries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-sm text-slate-500">
                      Select a valid month to generate day allocation rows.
                    </TableCell>
                  </TableRow>
                ) : (
                  dayAllocationPreview.weekSummaries.map((summary) => (
                    <React.Fragment key={summary.weekStart}>
                      {dayAllocationPreview.rows
                        .filter((row) => row.weekStart === summary.weekStart)
                        .map((row) => (
                          <TableRow key={row.calendarDate} className={!row.insideMonth ? "bg-slate-50/70 text-slate-400" : ""}>
                            <TableCell className="font-medium text-slate-900">{row.weekLabel}</TableCell>
                            <TableCell className="text-slate-600">{row.dateLabel}</TableCell>
                            <TableCell className="text-slate-600">{row.dayLabel}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                className={`ml-auto h-8 w-28 text-right tabular-nums ${row.invalid ? "border-rose-300 text-rose-700 focus-visible:ring-rose-300" : ""}`}
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                disabled={!selectedLobId || !row.insideMonth || dayAllocationLoading || savingDayAllocation}
                                value={row.inputValue}
                                onChange={(event) => updateDayWeightInput(row.calendarDate, event.target.value)}
                              />
                              <p className="mt-1 text-[11px] text-slate-500">
                                Normalized {formatPercent(row.normalizedWeight)}
                              </p>
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums text-slate-900">
                              {formatVolume(row.allocatedVolume)}
                            </TableCell>
                          </TableRow>
                        ))}
                      <TableRow className="bg-slate-50 hover:bg-slate-50">
                        <TableCell colSpan={3} className="font-semibold text-slate-700">
                          {summary.weekLabel} total
                          {!summary.totalIs100 && summary.totalRawWeight > 0 ? (
                            <span className="ml-2 text-xs font-normal text-amber-700">Normalized for allocation</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatPercent(summary.totalRawWeight)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatVolume(summary.totalAllocatedVolume)} / {formatVolume(summary.weekVolume)}
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  ))
                )}
              </TableBody>
            </Table>

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                Scope: <span className="font-medium text-slate-700">{scopeLabel}</span>
                {hasUnsavedDayChanges ? <span className="ml-2 text-amber-700">Unsaved day edits</span> : null}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedLobId || dayAllocationLoading || savingDayAllocation}
                  onClick={resetDayWeightsToDefault}
                >
                  <RefreshCw className="mr-2 size-4" />
                  Reset default
                </Button>
                <Button type="button" disabled={daySaveDisabled} onClick={saveDayAllocation}>
                  {savingDayAllocation ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                  Save day allocation
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="rounded-lg bg-cyan-50 p-2 text-cyan-700">
                    <Clock3 className="size-4" />
                  </span>
                  Interval Allocation
                </CardTitle>
                <CardDescription className="mt-2">
                  Split each day allocation into 15-minute operating intervals. Intervals outside LOB operating hours are not shown.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {intervalAllocationLoading && <Loader2 className="size-4 animate-spin text-slate-500" />}
                {hasUnsavedDayChanges && (
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50">
                    Based on current day allocation
                  </Badge>
                )}
                <Badge variant="outline" className={intervalAllocationBadgeClass}>
                  {intervalAllocationSourceLabel}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            {intervalAllocationWarning && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{intervalAllocationWarning}</span>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Day Allocation Basis</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatVolume(dayAllocationPreview.totalAllocatedVolume)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {hasUnsavedDayChanges ? "Current on-screen day allocation." : dayAllocationSourceLabel}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Days Balanced</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {intervalAllocationPreview.daySummaries.filter((summary) => summary.sumsToDay).length}/{intervalAllocationPreview.daySummaries.length}
                </p>
                <p className="mt-1 text-xs text-slate-500">Each day should sum to its day volume.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-cyan-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Allocated Interval Volume</p>
                <p className="mt-2 text-2xl font-semibold text-cyan-950">
                  {formatVolume(intervalAllocationPreview.totalAllocatedVolume)}
                </p>
                <p className="mt-1 text-xs text-cyan-800">
                  {intervalAllocationPreview.allDaysSumToSource ? "Sums back to day allocation." : "Review interval weights."}
                </p>
              </div>
            </div>

            <Table containerClassName="max-h-[620px] overflow-auto rounded-lg border border-slate-200">
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead>Date</TableHead>
                  <TableHead>Day of week</TableHead>
                  <TableHead>Interval time</TableHead>
                  <TableHead className="min-w-[190px] text-right">Weight %</TableHead>
                  <TableHead className="text-right">Allocated volume</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {intervalAllocationPreview.daySummaries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-sm text-slate-500">
                      No operating interval rows are available for the selected scope.
                    </TableCell>
                  </TableRow>
                ) : (
                  intervalAllocationPreview.daySummaries.map((summary) => {
                    const rowsForDay = intervalAllocationPreview.rows.filter((row) => row.calendarDate === summary.calendarDate);
                    return (
                      <React.Fragment key={summary.calendarDate}>
                        {rowsForDay.length === 0 ? (
                          <TableRow className="bg-slate-50/70">
                            <TableCell className="font-medium text-slate-900">{summary.dateLabel}</TableCell>
                            <TableCell className="text-slate-600">{summary.dayLabel}</TableCell>
                            <TableCell className="text-amber-700">No operating intervals</TableCell>
                            <TableCell className="text-right tabular-nums">0%</TableCell>
                            <TableCell className="text-right font-medium tabular-nums text-slate-900">0</TableCell>
                          </TableRow>
                        ) : (
                          rowsForDay.map((row) => (
                            <TableRow key={row.key}>
                              <TableCell className="font-medium text-slate-900">{row.dateLabel}</TableCell>
                              <TableCell className="text-slate-600">{row.dayLabel}</TableCell>
                              <TableCell className="text-slate-600">{row.intervalLabel}</TableCell>
                              <TableCell className="text-right">
                                <Input
                                  className={`ml-auto h-8 w-28 text-right tabular-nums ${row.invalid ? "border-rose-300 text-rose-700 focus-visible:ring-rose-300" : ""}`}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  inputMode="decimal"
                                  disabled={!selectedLobId || intervalAllocationLoading || savingIntervalAllocation}
                                  value={row.inputValue}
                                  onChange={(event) => updateIntervalWeightInput(row.key, event.target.value)}
                                />
                                <p className="mt-1 text-[11px] text-slate-500">
                                  Normalized {formatPercent(row.normalizedWeight)}
                                </p>
                              </TableCell>
                              <TableCell className="text-right font-medium tabular-nums text-slate-900">
                                {formatVolume(row.allocatedVolume)}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                        <TableRow className="bg-slate-50 hover:bg-slate-50">
                          <TableCell colSpan={3} className="font-semibold text-slate-700">
                            {summary.dateLabel} total
                            {!summary.totalIs100 && summary.totalRawWeight > 0 ? (
                              <span className="ml-2 text-xs font-normal text-amber-700">Normalized for allocation</span>
                            ) : null}
                            {summary.missingIntervals ? (
                              <span className="ml-2 text-xs font-normal text-amber-700">Operating hours required</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatPercent(summary.totalRawWeight)}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatVolume(summary.totalAllocatedVolume)} / {formatVolume(summary.dayVolume)}
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                Scope: <span className="font-medium text-slate-700">{scopeLabel}</span>
                {hasUnsavedIntervalChanges ? <span className="ml-2 text-amber-700">Unsaved interval edits</span> : null}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedLobId || intervalAllocationLoading || savingIntervalAllocation}
                  onClick={resetIntervalWeightsToDefault}
                >
                  <RefreshCw className="mr-2 size-4" />
                  Reset default
                </Button>
                <Button type="button" disabled={intervalSaveDisabled} onClick={saveIntervalAllocation}>
                  {savingIntervalAllocation ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                  Save interval allocation
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {PLACEHOLDER_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <Card key={section.title} className="border-dashed border-slate-300 bg-white/80 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="rounded-lg bg-cyan-50 p-2 text-cyan-700">
                      <Icon className="size-4" />
                    </span>
                    {section.title}
                  </CardTitle>
                  <CardDescription>{section.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                    Later phase placeholder - not wired yet.
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </PageLayout>
  );
}
