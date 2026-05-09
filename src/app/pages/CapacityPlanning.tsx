import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../lib/api";
import { useLOB } from "../lib/lobContext";
import { getCalculatedVolumes, Assumptions } from "./forecasting-logic";
import { computeIntervalFTE, computeAchievedSLFromFTE } from "./intraday-distribution-logic";
import { distributeMonthlyToWeekViaDailyDOW, getWeeksInMonth } from "./intraday-distribution-logic";
import { buildIntradayPrefsPageKey, normalizeIntradayStaffingMode } from "./intraday-scope";
import { useWFMPageData } from "../lib/WFMPageDataContext";
import { PageLayout } from "../components/PageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { toast } from "sonner";
import {
  ChevronDown, ChevronRight, RotateCcw, Settings2, TrendingDown, AlertTriangle, CheckCircle2, Loader2,
  Users, UserPlus, Target, Download, Plus, Pencil, Save, X,
} from "lucide-react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

type ChannelKey = "voice" | "chat" | "email" | "cases";
type DemandSourceType = "committed" | "active" | "fallback";
type AttritionModel = "monthly_rate" | "fixed_count";

interface PlanConfig {
  planStartDate: string;
  horizonWeeks: number;
  attritionRateMonthly: number;
  attritionModel: AttritionModel;
  attritionFixedCount: number;
  attritionFixedEveryMonths: number;
  rampTrainingWeeks: number;
  rampNestingWeeks: number;
  rampNestingPct: number;
  trainingGradRate: number;
  startingHc: number;
  billableFte: number;
}

interface WeekInput {
  plannedHires?: number;
  knownExits?: number;
  transfersOut?: number;
  transfersOutNote?: string;
  promotionsOut?: number;
  promotionsOutNote?: string;
  actualHc?: number | null;
  actualAttrition?: number | null;
  volVoice?: number | null;
  volChat?: number | null;
  volEmail?: number | null;
  volCases?: number | null;
  ahtVoice?: number | null;
  ahtChat?: number | null;
  ahtEmail?: number | null;
  ahtCases?: number | null;
}

type WeekInputMap = Record<number, WeekInput>;

interface WeekMeta { weekOffset: number; label: string; dateLabel: string; }

interface WeekCalc extends WeekMeta {
  autoVolVoice: number; autoVolChat: number; autoVolEmail: number; autoVolCases: number;
  effVolVoice: number; effVolChat: number; effVolEmail: number; effVolCases: number; effVolTotal: number;
  autoAhtVoice: number; autoAhtChat: number; autoAhtEmail: number; autoAhtCases: number;
  effAhtVoice: number; effAhtChat: number; effAhtEmail: number; effAhtCases: number;
  projOccupancyPct: number; projShrinkagePct: number;
  requiredFTE: number;
  plannedHires: number; effectiveNewHc: number; attritionDecay: number;
  knownExits: number; transfersOut: number; promotionsOut: number; projectedHc: number;
  actualHc: number | null; actualAttrition: number | null;
  gapSurplus: number; actualGapSurplus: number | null;
  billableGapSurplus: number | null; // Proj. HC − Billable FTE; null when billableFte = 0
  achievedSLAProj: number | null;   // Erlang C SLA% at projected HC; null for email
  achievedSLAActual: number | null; // Erlang C SLA% at actual HC; null if no actual HC or email
  reqRawAgents: number | null;      // per-interval physical agents before shrinkage/coverage
  reqAfterShrinkFte: number | null; // per-interval schedulable FTE after shrinkage
  reqCoverageRatio: number | null;  // opHoursPerDay / fteHoursPerDay
  flatRequiredFTE: number;
  distributionSource: DistributionSource;
  weeklyVolumeSource: WeeklyVolumeSource;
  requiredStaffedHours: number;
}

interface DaySchedule { enabled: boolean; open: string; close: string; }

interface LobSettings {
  lob_id: number; lob_name: string;
  channels_enabled: Record<string, boolean>;
  pooling_mode: string;
  voice_aht?: number; voice_sla_target?: number; voice_sla_seconds?: number;
  chat_aht?: number; chat_sla_target?: number; chat_sla_seconds?: number; chat_concurrency?: number;
  email_aht?: number; email_sla_target?: number; email_sla_seconds?: number; email_occupancy?: number;
  task_switch_multiplier?: number;
  hours_of_operation?: Record<string, Record<string, DaySchedule>>;
}

interface DemandAssumptions {
  voiceVolume?: number; chatVolume?: number; emailVolume?: number; casesVolume?: number;
  aht?: number; chatAht?: number; emailAht?: number;
  shrinkage?: number; occupancy?: number;
  operatingDaysPerWeek?: number; operatingHoursPerDay?: number;
  growthRate?: number;
}

interface CapacityPlannerSnapshot {
  assumptions: Assumptions;
  forecastMethod: string;
  hwParams: { alpha: number; beta: number; gamma: number; seasonLength: number };
  arimaParams: { p: number; d: number; q: number };
  decompParams: { trendStrength: number; seasonalityStrength: number };
  channelHistoricalApiData?: Partial<Record<string, number[]>>;
  channelHistoricalOverrides?: Partial<Record<string, Record<number, string>>>;
  recutVolumesByChannel?: Partial<Record<string, number[]>> | null;
}

interface CapacityWhatIf {
  id: string;
  name: string;
  is_committed?: boolean;
  configSnapshot: PlanConfig;
  fteModelSnapshot?: FteModelSnapshot;
}

interface FteModelSnapshot {
  operatingHoursPerDay: number;
  daysPerWeek: number;
  fteHoursPerDay: number;
  shrinkagePct: number;
  voiceAht: number;
  chatAht: number;
  emailAht: number;
  casesAht: number;
  voiceSlaTarget: number;
  voiceSlaSec: number;
  chatSlaTarget: number;
  chatSlaSec: number;
  emailSlaTarget: number;
  emailSlaSec: number;
  emailOccupancy: number;
  chatConcurrency: number;
  taskSwitchMultiplier: number;
}

interface RequiredFteChannelSummary {
  channel: ChannelKey;
  currentFte: number;
  peakFte: number;
  currentVolume: number;
  aht: number;
  slaTarget: number;
  slaSec: number;
  occupancy: number;
  daysPerWeek: number;
  operatingHoursPerDay: number;
  fteHoursPerDay: number;
  fteWorkdaysPerWeek: number;
  shrinkagePct: number;
  distributionSource: DistributionSource;
  currentFlatFte: number;
  currentStaffedHours: number;
}

interface DistributionProfile {
  id: number;
  channel: string;
  profile_name: string;
  interval_weights: number[][];
  day_weights: number[];
}

interface IntradayPrefsSnapshot {
  dataSource?: "api" | "manual";
  manualWeeklyVolumes?: number[];
}

interface InteractionArrivalRecord {
  interval_date: string;
  interval_index: number;
  volume: number;
  aht?: number;
  channel: string;
}

type DistributionSource = "intraday-based" | "saved-profile-fallback" | "default-fallback-distribution" | "configuration-needed";
type WeeklyVolumeSource = "intraday-allocation" | "default-weekly-distribution" | "flat-fallback";

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DEFAULT_CONFIG: PlanConfig = {
  planStartDate: new Date().toISOString().split("T")[0],
  horizonWeeks: 26,
  attritionRateMonthly: 2,
  attritionModel: "monthly_rate",
  attritionFixedCount: 1,
  attritionFixedEveryMonths: 1,
  rampTrainingWeeks: 4,
  rampNestingWeeks: 2,
  rampNestingPct: 50,
  trainingGradRate: 100,
  startingHc: 0,
  billableFte: 0,
};

const CHANNEL_LABELS: Record<ChannelKey, string> = { voice: "Voice", chat: "Chat", email: "Email", cases: "Cases" };
const CHANNELS: ChannelKey[] = ["voice", "chat", "email", "cases"];
const DOW_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const CAPACITY_INTERVAL_MINUTES = 30;
const CAPACITY_INTERVALS_PER_DAY = 48;
const DEFAULT_DOW_WEIGHTS = [1, 1, 1, 1, 0.9, 0.55, 0.45];
const FIELD_MAP: Record<string, string> = {
  volVoice: "vol_override_voice", volChat: "vol_override_chat", volEmail: "vol_override_email", volCases: "vol_override_cases",
  ahtVoice: "aht_override_voice", ahtChat: "aht_override_chat", ahtEmail: "aht_override_email", ahtCases: "aht_override_cases",
  plannedHires: "planned_hires", knownExits: "known_exits",
  transfersOut: "transfers_out", transfersOutNote: "transfers_out_note",
  promotionsOut: "promotions_out", promotionsOutNote: "promotions_out_note",
  actualHc: "actual_hc", actualAttrition: "actual_attrition",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: Date): string { return `${MONTHS[d.getMonth()]} ${d.getDate()}`; }
function fmtISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getWeekStartDate(planStartDate: string, weekOffset: number): Date {
  const monday = getMondayOf(new Date(planStartDate + "T00:00:00"));
  return addDays(monday, weekOffset * 7);
}

function emptyIntervalGrid(): number[][] {
  return Array.from({ length: 7 }, () => new Array(CAPACITY_INTERVALS_PER_DAY).fill(0));
}

function parseTimeMinutes(t: string | undefined): number {
  const [h, m] = String(t || "00:00").split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function isIntervalOpen(schedule: Record<string, DaySchedule> | undefined, dayIndex: number, intervalIndex: number): boolean {
  const day = schedule?.[DOW_KEYS[dayIndex]];
  if (!day?.enabled) return false;
  const open = parseTimeMinutes(day.open);
  const close = parseTimeMinutes(day.close);
  const start = intervalIndex * CAPACITY_INTERVAL_MINUTES;
  if (open === close) return true;
  if (close > open) return start >= open && start < close;
  return start >= open || start < close;
}

function buildOperatingMask(schedule: Record<string, DaySchedule> | undefined): boolean[][] {
  return Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: CAPACITY_INTERVALS_PER_DAY }, (_, i) => isIntervalOpen(schedule, d, i))
  );
}

function maskWeightGrid(weights: number[][], schedule: Record<string, DaySchedule> | undefined): number[][] {
  const mask = buildOperatingMask(schedule);
  return mask.map((dayMask, d) => dayMask.map((open, i) => open ? Number(weights[d]?.[i] ?? 0) : 0));
}

function normalizeVolumeGrid(weeklyVolume: number, weights: number[][]): number[][] {
  const total = weights.reduce((sum, row) => sum + row.reduce((s, v) => s + Math.max(0, Number(v) || 0), 0), 0);
  const grid = emptyIntervalGrid();
  if (weeklyVolume <= 0 || total <= 0) return grid;

  let largest = { d: 0, i: 0, value: -1 };
  let distributed = 0;
  for (let d = 0; d < 7; d++) {
    for (let i = 0; i < CAPACITY_INTERVALS_PER_DAY; i++) {
      const weight = Math.max(0, Number(weights[d]?.[i] ?? 0) || 0);
      const value = weeklyVolume * weight / total;
      grid[d][i] = value;
      distributed += value;
      if (value > largest.value) largest = { d, i, value };
    }
  }
  grid[largest.d][largest.i] += weeklyVolume - distributed;
  return grid;
}

function recordsToWeightGrid(records: InteractionArrivalRecord[], weekStart: Date, schedule: Record<string, DaySchedule> | undefined): number[][] | null {
  const dateToDay = new Map<string, number>();
  for (let d = 0; d < 7; d++) dateToDay.set(fmtISODate(addDays(weekStart, d)), d);
  const weights = emptyIntervalGrid();
  for (const r of records) {
    const dateStr = String(r.interval_date || "").split("T")[0];
    const dayIndex = dateToDay.get(dateStr);
    if (dayIndex == null) continue;
    const rawIndex = Number(r.interval_index);
    if (!Number.isFinite(rawIndex) || rawIndex < 0) continue;
    const intervalIndex = rawIndex >= CAPACITY_INTERVALS_PER_DAY ? Math.floor(rawIndex / 2) : Math.floor(rawIndex);
    if (intervalIndex < 0 || intervalIndex >= CAPACITY_INTERVALS_PER_DAY) continue;
    weights[dayIndex][intervalIndex] += Math.max(0, Number(r.volume) || 0);
  }
  const masked = maskWeightGrid(weights, schedule);
  const total = masked.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0);
  return total > 0 ? masked : null;
}

function profileToWeightGrid(profile: DistributionProfile | undefined, schedule: Record<string, DaySchedule> | undefined): number[][] | null {
  if (!profile?.day_weights?.length || !profile.interval_weights?.length) return null;
  const weights = emptyIntervalGrid();
  for (let d = 0; d < 7; d++) {
    const dayWeight = Math.max(0, Number(profile.day_weights[d] ?? 0) || 0);
    const intervals = profile.interval_weights[d] ?? [];
    for (let i = 0; i < CAPACITY_INTERVALS_PER_DAY; i++) {
      if (intervals.length >= 96) {
        weights[d][i] = dayWeight * (Math.max(0, Number(intervals[i * 2] ?? 0) || 0) + Math.max(0, Number(intervals[i * 2 + 1] ?? 0) || 0));
      } else {
        weights[d][i] = dayWeight * Math.max(0, Number(intervals[i] ?? 0) || 0);
      }
    }
  }
  const masked = maskWeightGrid(weights, schedule);
  const total = masked.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0);
  return total > 0 ? masked : null;
}

function defaultFallbackWeightGrid(schedule: Record<string, DaySchedule> | undefined): number[][] {
  const mask = buildOperatingMask(schedule);
  const weights = emptyIntervalGrid();
  for (let d = 0; d < 7; d++) {
    const openSlots = mask[d].map((open, i) => open ? i : -1).filter(i => i >= 0);
    if (!openSlots.length) continue;
    const center = openSlots.reduce((sum, i) => sum + i, 0) / openSlots.length;
    const sigma = Math.max(1.5, openSlots.length / 4);
    for (const i of openSlots) {
      const z = (i - center) / sigma;
      weights[d][i] = DEFAULT_DOW_WEIGHTS[d] * Math.exp(-0.5 * z * z);
    }
  }
  return weights;
}

function uniformOperatingWeightGrid(schedule: Record<string, DaySchedule> | undefined): number[][] {
  const mask = buildOperatingMask(schedule);
  return mask.map(day => day.map(open => open ? 1 : 0));
}

function buildAverageSchedule(daysPerWeek: number, hoursPerDay: number): Record<string, DaySchedule> {
  const days = Math.max(0, Math.min(7, Math.round(daysPerWeek)));
  const hours = Math.max(0.5, Math.min(24, hoursPerDay));
  const open = 8 * 60;
  const close = hours >= 24 ? open : (open + Math.round(hours * 60)) % (24 * 60);
  const closeText = hours >= 24
    ? "08:00"
    : `${String(Math.floor(close / 60)).padStart(2, "0")}:${String(close % 60).padStart(2, "0")}`;
  return Object.fromEntries(DOW_KEYS.map((day, i) => [
    day,
    { enabled: i < days, open: "08:00", close: closeText },
  ])) as Record<string, DaySchedule>;
}

function buildDistributedVolumeGrid(
  weeklyVolume: number,
  weekStart: Date,
  schedule: Record<string, DaySchedule> | undefined,
  records: InteractionArrivalRecord[] | undefined,
  profile: DistributionProfile | undefined,
): { grid: number[][]; source: DistributionSource } {
  const intradayWeights = recordsToWeightGrid(records ?? [], weekStart, schedule);
  if (intradayWeights) return { grid: normalizeVolumeGrid(weeklyVolume, intradayWeights), source: "intraday-based" };

  const profileWeights = profileToWeightGrid(profile, schedule);
  if (profileWeights) return { grid: normalizeVolumeGrid(weeklyVolume, profileWeights), source: "saved-profile-fallback" };

  const fallbackWeights = defaultFallbackWeightGrid(schedule);
  const fallbackTotal = fallbackWeights.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0);
  if (fallbackTotal > 0 || weeklyVolume <= 0) {
    return { grid: normalizeVolumeGrid(weeklyVolume, fallbackWeights), source: "default-fallback-distribution" };
  }

  const uniformWeights = uniformOperatingWeightGrid(schedule);
  const uniformTotal = uniformWeights.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0);
  if (uniformTotal > 0) {
    return { grid: normalizeVolumeGrid(weeklyVolume, uniformWeights), source: "default-fallback-distribution" };
  }

  return { grid: emptyIntervalGrid(), source: "configuration-needed" };
}

function bestDistributionSource(sources: DistributionSource[]): DistributionSource {
  if (sources.includes("intraday-based")) return "intraday-based";
  if (sources.includes("saved-profile-fallback")) return "saved-profile-fallback";
  if (sources.includes("configuration-needed")) return "configuration-needed";
  return "default-fallback-distribution";
}

// Derive operating days/hours from a channel's hours-of-operation schedule.
// Returns null when no schedule is configured so callers can fall back.
function hoursFromSchedule(
  schedule: Record<string, DaySchedule> | undefined,
): { daysPerWeek: number; hoursPerDay: number } | null {
  if (!schedule) return null;
  const enabled = Object.values(schedule).filter(d => d.enabled);
  if (!enabled.length) return null;
  const toMins = (t: string) => {
    const [h, m] = String(t || "00:00").split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const spanHours = (open: string, close: string) => {
    const openMins = toMins(open);
    const closeMins = toMins(close);
    // Equal open/close on an enabled day is treated as 24h coverage.
    if (openMins === closeMins) return 24;
    const diff = closeMins - openMins;
    const minutes = diff > 0 ? diff : diff + 24 * 60; // overnight wrap support
    return Math.max(0, minutes / 60);
  };
  const totalHrs = enabled.reduce((sum, d) => {
    return sum + spanHours(d.open, d.close);
  }, 0);
  return {
    daysPerWeek: enabled.length,
    hoursPerDay: Math.round((totalHrs / enabled.length) * 10) / 10,
  };
}

function mergeChannelSchedules(
  hoo: Record<string, Record<string, DaySchedule>> | undefined,
  channels: ChannelKey[],
): Record<string, DaySchedule> | null {
  if (!hoo || channels.length === 0) return null;
  const dayKeys = new Set<string>();
  for (const ch of channels) {
    const sched = hoo[ch];
    if (!sched) continue;
    Object.keys(sched).forEach(d => dayKeys.add(d));
  }
  if (dayKeys.size === 0) return null;

  const toMins = (t: string) => {
    const [h, m] = String(t || "00:00").split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const toTime = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

  const out: Record<string, DaySchedule> = {};
  for (const day of dayKeys) {
    let minOpen = Number.POSITIVE_INFINITY;
    let maxClose = Number.NEGATIVE_INFINITY;
    let anyEnabled = false;
    for (const ch of channels) {
      const ds = hoo[ch]?.[day];
      if (!ds?.enabled) continue;
      anyEnabled = true;
      minOpen = Math.min(minOpen, toMins(ds.open));
      maxClose = Math.max(maxClose, toMins(ds.close));
    }
    out[day] = anyEnabled
      ? { enabled: true, open: toTime(minOpen), close: toTime(maxClose) }
      : { enabled: false, open: "00:00", close: "00:00" };
  }
  return out;
}
function roundTo(n: number, dp = 1) { return Math.round(n * 10 ** dp) / 10 ** dp; }
function ceilTo(n: number, dp = 0) {
  const factor = 10 ** dp;
  return Math.ceil((n - Number.EPSILON) * factor) / factor;
}

// Mirrors the computeShrinkage function in ShrinkagePlanning.tsx.
// Items are absence_items or activity_items from the shrinkage_plans DB row.
function computeShrinkageFromItems(
  items: Array<{ enabled: boolean; durationMinutes: number; occurrences: number; frequency: string; isHoliday?: boolean }>,
  hoursPerDay: number,
  daysPerWeek: number,
): number {
  const daysPerYear = daysPerWeek * 52;
  const minutesPerYear = hoursPerDay * 60 * daysPerYear;
  if (minutesPerYear <= 0) return 0;
  const lost = items.filter(i => i.enabled).reduce((sum, item) => {
    const annual = item.frequency === "per_day" ? item.occurrences * daysPerYear
      : item.frequency === "per_week"  ? item.occurrences * 52
      : item.frequency === "per_month" ? item.occurrences * 12
      : item.occurrences;
    return sum + annual * item.durationMinutes;
  }, 0);
  return Math.min(99, Number(((lost / minutesPerYear) * 100).toFixed(1)));
}
function fmtSeconds(s: number): string {
  if (s >= 3600) return `${roundTo(s / 3600, 1)}h`;
  if (s >= 60) return `${Math.round(s / 60)}m`;
  return `${s}s`;
}

function distributionSourceLabel(source: DistributionSource): string {
  if (source === "intraday-based") return "Intraday arrival pattern";
  if (source === "saved-profile-fallback") return "Saved profile fallback";
  if (source === "configuration-needed") return "Operating hours need configuration";
  return "Default fallback distribution";
}

function weeklyVolumeSourceLabel(source: WeeklyVolumeSource): string {
  if (source === "intraday-allocation") return "Intraday allocation";
  if (source === "default-weekly-distribution") return "Default weekly distribution";
  return "Flat fallback";
}

function getMonthOffset(startDate: string, date: Date): number {
  const start = new Date(startDate + "T12:00:00");
  return (date.getFullYear() - start.getFullYear()) * 12 + (date.getMonth() - start.getMonth());
}

function getWeekMonthSegments(weekStart: Date, forecastStart: string, maxMonths: number): Array<{ monthOffset: number; year: number; month: number; overlapDays: number }> {
  const segments = new Map<number, { monthOffset: number; year: number; month: number; overlapDays: number }>();
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const monthOffset = getMonthOffset(forecastStart, day);
    if (monthOffset < 0 || monthOffset >= maxMonths) continue;
    const current = segments.get(monthOffset);
    if (current) {
      current.overlapDays += 1;
    } else {
      segments.set(monthOffset, {
        monthOffset,
        year: day.getFullYear(),
        month: day.getMonth(),
        overlapDays: 1,
      });
    }
  }
  return Array.from(segments.values()).sort((left, right) => left.monthOffset - right.monthOffset);
}

function getManualPatternContribution(
  monthlyVolume: number,
  year: number,
  month: number,
  weekStart: Date,
  overlapDays: number,
  manualWeeklyVolumes: number[],
): number {
  const allVolumes = manualWeeklyVolumes.filter((value) => Number.isFinite(value) && value > 0);
  if (monthlyVolume <= 0 || allVolumes.length < 4) return 0;

  const monthWeeks = getWeeksInMonth(year, month);
  if (monthWeeks.length === 0) return 0;
  const weekIndex = monthWeeks.findIndex((week) => week.start === fmtISODate(weekStart));
  if (weekIndex < 0) return 0;

  const cycleLength = monthWeeks.length;
  const cycleAverages = Array.from({ length: cycleLength }, (_, position) => {
    const values: number[] = [];
    for (let cycle = 0; cycle * cycleLength + position < allVolumes.length; cycle++) {
      values.push(allVolumes[cycle * cycleLength + position]);
    }
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  });
  const totalAverage = cycleAverages.reduce((sum, value) => sum + value, 0);
  if (totalAverage <= 0) return 0;

  return monthlyVolume * (cycleAverages[weekIndex] / totalAverage) * (overlapDays / 7);
}

function normalizeAttritionModel(value: unknown): AttritionModel {
  return value === "fixed_count" ? "fixed_count" : "monthly_rate";
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizePlanConfig(raw: Partial<PlanConfig> | null | undefined): PlanConfig {
  const source = raw as (Partial<PlanConfig> & Record<string, unknown>) | null | undefined;
  return {
    ...DEFAULT_CONFIG,
    ...(raw ?? {}),
    planStartDate: raw?.planStartDate ?? DEFAULT_CONFIG.planStartDate,
    horizonWeeks: Number(raw?.horizonWeeks ?? DEFAULT_CONFIG.horizonWeeks),
    attritionRateMonthly: Number(raw?.attritionRateMonthly ?? DEFAULT_CONFIG.attritionRateMonthly),
    attritionModel: normalizeAttritionModel(source?.attritionModel ?? source?.attrition_model),
    attritionFixedCount: normalizeNonNegativeNumber(source?.attritionFixedCount ?? source?.attrition_fixed_count, DEFAULT_CONFIG.attritionFixedCount),
    attritionFixedEveryMonths: normalizePositiveNumber(source?.attritionFixedEveryMonths ?? source?.attrition_fixed_every_months, DEFAULT_CONFIG.attritionFixedEveryMonths),
    rampTrainingWeeks: Number(raw?.rampTrainingWeeks ?? DEFAULT_CONFIG.rampTrainingWeeks),
    rampNestingWeeks: Number(raw?.rampNestingWeeks ?? DEFAULT_CONFIG.rampNestingWeeks),
    rampNestingPct: Number(raw?.rampNestingPct ?? DEFAULT_CONFIG.rampNestingPct),
    trainingGradRate: Number(raw?.trainingGradRate ?? DEFAULT_CONFIG.trainingGradRate),
    startingHc: Number(raw?.startingHc ?? DEFAULT_CONFIG.startingHc),
    billableFte: Number(raw?.billableFte ?? DEFAULT_CONFIG.billableFte),
  };
}

function getMonthlyFixedAttritionCount(config: PlanConfig): number {
  return config.attritionFixedCount / Math.max(config.attritionFixedEveryMonths, 0.0001);
}

function getWeeklyAttritionDecay(projectedHc: number, weekIndex: number, config: PlanConfig): number {
  if (weekIndex <= 0) return 0;
  if (config.attritionModel === "fixed_count") {
    return getMonthlyFixedAttritionCount(config) * 12 / 52;
  }
  const weeklyAttritionRate = 1 - Math.pow(1 - config.attritionRateMonthly / 100, 12 / 52);
  return roundTo(projectedHc * weeklyAttritionRate, 2);
}

function normalizeFteModelSnapshot(raw: Partial<FteModelSnapshot> | null | undefined): FteModelSnapshot | undefined {
  if (!raw) return undefined;
  return {
    operatingHoursPerDay: Number(raw.operatingHoursPerDay ?? 8),
    daysPerWeek: Number(raw.daysPerWeek ?? 5),
    fteHoursPerDay: Number(raw.fteHoursPerDay ?? 7.5),
    shrinkagePct: Number(raw.shrinkagePct ?? 20),
    voiceAht: Number(raw.voiceAht ?? 300),
    chatAht: Number(raw.chatAht ?? 450),
    emailAht: Number(raw.emailAht ?? 600),
    casesAht: Number(raw.casesAht ?? raw.emailAht ?? 600),
    voiceSlaTarget: Number(raw.voiceSlaTarget ?? 80),
    voiceSlaSec: Number(raw.voiceSlaSec ?? 20),
    chatSlaTarget: Number(raw.chatSlaTarget ?? 80),
    chatSlaSec: Number(raw.chatSlaSec ?? 30),
    emailSlaTarget: Number(raw.emailSlaTarget ?? 90),
    emailSlaSec: Number(raw.emailSlaSec ?? 14400),
    emailOccupancy: Number(raw.emailOccupancy ?? 85),
    chatConcurrency: Math.max(1, Number(raw.chatConcurrency ?? 2)),
    taskSwitchMultiplier: Number(raw.taskSwitchMultiplier ?? 1.05),
  };
}

function parseWeekInputsRows(rows: Array<Record<string, any>>): WeekInputMap {
  const map: WeekInputMap = {};
  for (const row of rows) {
    map[row.week_offset] = {
      plannedHires: row.planned_hires != null ? parseFloat(row.planned_hires) : undefined,
      knownExits: row.known_exits != null ? parseFloat(row.known_exits) : undefined,
      transfersOut: row.transfers_out != null ? parseFloat(row.transfers_out) : undefined,
      transfersOutNote: row.transfers_out_note ?? undefined,
      promotionsOut: row.promotions_out != null ? parseFloat(row.promotions_out) : undefined,
      promotionsOutNote: row.promotions_out_note ?? undefined,
      actualHc: row.actual_hc != null ? parseFloat(row.actual_hc) : null,
      actualAttrition: row.actual_attrition != null ? parseFloat(row.actual_attrition) : null,
      volVoice: row.vol_override_voice != null ? parseFloat(row.vol_override_voice) : null,
      volChat: row.vol_override_chat != null ? parseFloat(row.vol_override_chat) : null,
      volEmail: row.vol_override_email != null ? parseFloat(row.vol_override_email) : null,
      volCases: row.vol_override_cases != null ? parseFloat(row.vol_override_cases) : null,
      ahtVoice: row.aht_override_voice != null ? parseFloat(row.aht_override_voice) : null,
      ahtChat: row.aht_override_chat != null ? parseFloat(row.aht_override_chat) : null,
      ahtEmail: row.aht_override_email != null ? parseFloat(row.aht_override_email) : null,
      ahtCases: row.aht_override_cases != null ? parseFloat(row.aht_override_cases) : null,
    };
  }
  return map;
}

function getMondayOf(date: Date): Date {
  const d = new Date(date); d.setHours(0,0,0,0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function getISOWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // shift to nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

function buildWeeks(planStartDate: string, horizonWeeks: number): WeekMeta[] {
  const monday = getMondayOf(new Date(planStartDate + "T00:00:00"));
  const { year: startYear } = getISOWeek(monday);
  return Array.from({ length: horizonWeeks }, (_, i) => {
    const start = new Date(monday); start.setDate(start.getDate() + i * 7);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const { week, year } = getISOWeek(start);
    const yearSuffix = year !== startYear ? `'${String(year).slice(2)}` : "";
    return { weekOffset: i, label: `W${String(week).padStart(2, "0")}${yearSuffix}`, dateLabel: `${fmtDate(start)}–${fmtDate(end)}` };
  });
}

function monthlyToWeekly(monthlyVol: number, growthPct: number, weekOffset: number): number {
  const weekly = monthlyVol * (12 / 52);
  const growth = Math.pow(1 + growthPct / 100, weekOffset / 52);
  return Math.round(weekly * growth);
}

// Returns required FTE using Erlang C — occupancy is an OUTPUT, not an input.
// Converts weekly volume to an average calls-per-30min-interval rate, runs Erlang C
// to find the minimum agents that satisfy the SLA, then converts to daily FTE using
// the ratio of operating hours to scheduled-shift hours (FTE hours per day).
function calcWeeklyErlangFTE(
  weeklyVolume: number,
  ahtSeconds: number,
  daysPerWeek: number,
  operatingHoursPerDay: number,
  fteHoursPerDay: number,
  slaTarget: number,          // 0–100, e.g. 80
  slaAnswerSeconds: number,   // threshold, e.g. 20
  shrinkagePct: number,
  channel: "voice" | "chat" | "email",
  concurrency = 1,
  emailOccupancyPct = 85,
): { fte: number; occupancy: number; rawAgents: number; afterShrinkFte: number; coverageRatio: number } {
  if (weeklyVolume <= 0 || ahtSeconds <= 0 || daysPerWeek <= 0 || operatingHoursPerDay <= 0) {
    return { fte: 0, occupancy: 0, rawAgents: 0, afterShrinkFte: 0, coverageRatio: 1 };
  }
  const dailyCalls = weeklyVolume / daysPerWeek;
  const intervalsPerDay = operatingHoursPerDay * 2; // 30-min intervals
  const callsPerInterval = dailyCalls / intervalsPerDay;
  const result = computeIntervalFTE(
    callsPerInterval, 30, ahtSeconds,
    slaTarget, slaAnswerSeconds, emailOccupancyPct,
    shrinkagePct, channel, concurrency, 0,
  );
  // Capacity Planning commits to whole schedulable FTE. Use the exact raw-agent
  // requirement here instead of the display-rounded interval FTE from Intraday.
  const shrinkFactor = Math.max(0.01, 1 - shrinkagePct / 100);
  const afterShrinkFte = result.rawAgents / shrinkFactor;
  // Scale to daily FTE: one FTE works fteHoursPerDay but the floor needs
  // coverage for operatingHoursPerDay, so multiply by the coverage ratio.
  const coverageRatio = fteHoursPerDay > 0 ? operatingHoursPerDay / fteHoursPerDay : 1;
  return {
    fte: ceilTo(afterShrinkFte * coverageRatio),
    occupancy: result.occupancy,
    rawAgents: result.rawAgents,
    afterShrinkFte,
    coverageRatio,
  };
}

// Blended staffing using the Idle Time Utilization Method (instructions.txt):
//   Voice Erlang C establishes the base; usable idle = N × (ρmax − ρv) absorbs email/cases.
//   Chat is an independent Erlang C additive block — it does NOT absorb voice idle time
//   because live chat has its own SLA clock and would miss SL during voice spikes.
//   Email/cases AHT is inflated by taskSwitchMultiplier to account for context-switching latency.
//   Surplus email/cases beyond usable idle is staffed at ρmax occupancy (not 100%).
function calcWeeklyBlendedFTE(
  voiceVol: number, voiceAht: number,
  chatVol: number, chatAht: number,
  emailVol: number, emailAht: number, // email + cases combined
  daysPerWeek: number,
  operatingHoursPerDay: number,
  fteHoursPerDay: number,
  slaVoiceTarget: number,
  slaVoiceSec: number,
  slaChatTarget: number,
  slaChatSec: number,
  emailOccupancyPct: number,   // ρmax — max blended occupancy ceiling (also used for email-only pools)
  shrinkagePct: number,
  chatConcurrency: number,
  taskSwitchMultiplier = 1.05, // AHT inflation for async work in blended queues
): { fte: number; occupancy: number; rawAgents: number; afterShrinkFte: number; coverageRatio: number; voiceRawAgents: number; chatRawAgents: number } {
  const empty = { fte: 0, occupancy: 0, rawAgents: 0, afterShrinkFte: 0, coverageRatio: 1, voiceRawAgents: 0, chatRawAgents: 0 };
  if (daysPerWeek <= 0 || operatingHoursPerDay <= 0) return empty;

  const intervalsPerDay = operatingHoursPerDay * 2; // 30-min intervals
  const intervalHours = 0.5;
  const shrinkFactor = Math.max(0.01, 1 - shrinkagePct / 100);
  const safeConcurrency = Math.max(1, chatConcurrency);
  const coverageRatio = fteHoursPerDay > 0 ? operatingHoursPerDay / fteHoursPerDay : 1;
  const rhoMax = Math.max(0.01, Math.min(1, emailOccupancyPct / 100));

  const voiceCPI = voiceVol > 0 ? (voiceVol / daysPerWeek) / intervalsPerDay : 0;
  const chatCPI = chatVol > 0 ? (chatVol / daysPerWeek) / intervalsPerDay : 0;
  const emailCPI = emailVol > 0 ? (emailVol / daysPerWeek) / intervalsPerDay : 0;
  const effectiveEmailAht = emailAht * taskSwitchMultiplier;

  if (voiceCPI > 0 && voiceAht > 0) {
    // ── Voice-anchored blended pool ───────────────────────────────────────────
    // Step 1-2: Voice Erlang C base
    const vr = computeIntervalFTE(voiceCPI, 30, voiceAht, slaVoiceTarget, slaVoiceSec, 85, 0, "voice", 1, 0);
    const voiceRawAgents = vr.rawAgents;
    const voiceWorkloadHours = voiceCPI * voiceAht / 3600;
    const voiceOccupancy = voiceRawAgents > 0 ? voiceWorkloadHours / (voiceRawAgents * intervalHours) : 0;

    // Step 4: Usable idle = capacity headroom below ρmax ceiling (not raw idle × absorption factor)
    const voiceUsableIdleHours = Math.max(0, voiceRawAgents * intervalHours * (rhoMax - voiceOccupancy));

    // Chat: Erlang C additive block — independent of voice idle absorption
    let chatExtraAgents = 0;
    if (chatCPI > 0 && chatAht > 0) {
      const cr = computeIntervalFTE(chatCPI, 30, chatAht, slaChatTarget, slaChatSec, 85, 0, "chat", safeConcurrency, 0);
      chatExtraAgents = cr.rawAgents;
    }

    // Step 3-5: Email/cases — absorb voice idle, surplus staffed at ρmax
    const emailWorkloadHours = emailCPI * effectiveEmailAht / 3600;
    const netEmailWorkload = Math.max(0, emailWorkloadHours - voiceUsableIdleHours);
    const emailExtraAgents = rhoMax > 0 ? netEmailWorkload / (rhoMax * intervalHours) : 0;

    const totalBaseAgents = voiceRawAgents + chatExtraAgents + emailExtraAgents;
    const afterShrinkFte = totalBaseAgents / shrinkFactor;
    return {
      fte: ceilTo(afterShrinkFte * coverageRatio),
      occupancy: vr.occupancy,
      rawAgents: totalBaseAgents,
      afterShrinkFte,
      coverageRatio,
      voiceRawAgents,
      chatRawAgents: chatExtraAgents,
    };
  }

  if (chatCPI > 0 && chatAht > 0) {
    // ── Chat-anchored blended pool (voice absent) ─────────────────────────────
    // Full Erlang C for chat; email absorbs chat idle using same ρmax formula.
    const cr = computeIntervalFTE(chatCPI, 30, chatAht, slaChatTarget, slaChatSec, 85, 0, "chat", safeConcurrency, 0);
    const chatRawAgents = cr.rawAgents;
    const chatPhysicalWorkloadHours = chatCPI * chatAht / (3600 * safeConcurrency);
    const chatOccupancy = chatRawAgents > 0 ? chatPhysicalWorkloadHours / (chatRawAgents * intervalHours) : 0;
    const chatUsableIdleHours = Math.max(0, chatRawAgents * intervalHours * (rhoMax - chatOccupancy));

    const emailWorkloadHours = emailCPI * effectiveEmailAht / 3600;
    const netEmailWorkload = Math.max(0, emailWorkloadHours - chatUsableIdleHours);
    const emailExtraAgents = rhoMax > 0 ? netEmailWorkload / (rhoMax * intervalHours) : 0;
    const totalBaseAgents = chatRawAgents + emailExtraAgents;

    const afterShrinkFte = totalBaseAgents / shrinkFactor;
    return {
      fte: ceilTo(afterShrinkFte * coverageRatio),
      occupancy: cr.occupancy,
      rawAgents: totalBaseAgents,
      afterShrinkFte,
      coverageRatio,
      voiceRawAgents: 0,
      chatRawAgents,
    };
  }

  // ── Email/cases only ──────────────────────────────────────────────────────────
  // Async backlog model: emailOccupancyPct is the utilisation target (no SLA queue).
  // No task-switch penalty here — agents work email exclusively, no context switching.
  if (emailCPI > 0 && emailAht > 0) {
    const er = computeIntervalFTE(emailCPI, 30, emailAht, 0, 0, emailOccupancyPct, 0, "email");
    const afterShrinkFte = er.rawAgents / shrinkFactor;
    return {
      fte: ceilTo(afterShrinkFte * coverageRatio),
      occupancy: er.occupancy,
      rawAgents: er.rawAgents,
      afterShrinkFte,
      coverageRatio,
      voiceRawAgents: 0,
      chatRawAgents: 0,
    };
  }

  return empty;
}

function convertStaffedHoursToFte(staffedHours: number, fteHoursPerDay: number, fteWorkdaysPerWeek: number, shrinkagePct: number): number {
  const weeklyProductiveHours = Math.max(0.01, fteHoursPerDay * fteWorkdaysPerWeek);
  const shrinkFactor = Math.max(0.01, 1 - shrinkagePct / 100);
  return staffedHours / weeklyProductiveHours / shrinkFactor;
}

function calcIntervalizedDedicatedFTE(
  volumeGrid: number[][],
  ahtSeconds: number,
  fteHoursPerDay: number,
  fteWorkdaysPerWeek: number,
  shrinkagePct: number,
  channel: "voice" | "chat" | "email",
  slaTarget: number,
  slaAnswerSeconds: number,
  concurrency = 1,
  emailOccupancyPct = 85,
): { fte: number; fteRaw: number; staffedHours: number; occupancy: number; rawAgentsAvg: number } {
  let staffedHours = 0;
  let weightedOccupancy = 0;
  let totalVolume = 0;
  let rawAgentSum = 0;
  let intervalCount = 0;
  for (const day of volumeGrid) {
    for (const calls of day) {
      if (calls <= 0 || ahtSeconds <= 0) continue;
      const result = computeIntervalFTE(
        calls, CAPACITY_INTERVAL_MINUTES, ahtSeconds,
        slaTarget, slaAnswerSeconds, emailOccupancyPct,
        0, channel, concurrency, 0,
      );
      staffedHours += result.rawAgents * (CAPACITY_INTERVAL_MINUTES / 60);
      rawAgentSum += result.rawAgents;
      intervalCount += 1;
      weightedOccupancy += result.occupancy * calls;
      totalVolume += calls;
    }
  }
  const fteRaw = convertStaffedHoursToFte(staffedHours, fteHoursPerDay, fteWorkdaysPerWeek, shrinkagePct);
  return {
    fte: ceilTo(fteRaw),
    fteRaw,
    staffedHours,
    occupancy: totalVolume > 0 ? weightedOccupancy / totalVolume : 0,
    rawAgentsAvg: intervalCount > 0 ? rawAgentSum / intervalCount : 0,
  };
}

function calcBlendedIntervalRawAgents(
  voiceCPI: number, voiceAht: number,
  chatCPI: number, chatAht: number,
  emailCPI: number, emailAht: number,
  slaVoiceTarget: number,
  slaVoiceSec: number,
  slaChatTarget: number,
  slaChatSec: number,
  emailOccupancyPct: number,
  chatConcurrency: number,
  taskSwitchMultiplier = 1.05,
): { rawAgents: number; occupancy: number; voiceRawAgents: number; chatRawAgents: number } {
  const safeConcurrency = Math.max(1, chatConcurrency);
  const rhoMax = Math.max(0.01, Math.min(1, emailOccupancyPct / 100));
  const intervalHours = CAPACITY_INTERVAL_MINUTES / 60;
  const effectiveEmailAht = emailAht * taskSwitchMultiplier;

  if (voiceCPI > 0 && voiceAht > 0) {
    const vr = computeIntervalFTE(voiceCPI, CAPACITY_INTERVAL_MINUTES, voiceAht, slaVoiceTarget, slaVoiceSec, 85, 0, "voice", 1, 0);
    const voiceRawAgents = vr.rawAgents;
    const voiceWorkloadHours = voiceCPI * voiceAht / 3600;
    const voiceOccupancy = voiceRawAgents > 0 ? voiceWorkloadHours / (voiceRawAgents * intervalHours) : 0;
    const voiceUsableIdleHours = Math.max(0, voiceRawAgents * intervalHours * (rhoMax - voiceOccupancy));

    let chatExtraAgents = 0;
    if (chatCPI > 0 && chatAht > 0) {
      const cr = computeIntervalFTE(chatCPI, CAPACITY_INTERVAL_MINUTES, chatAht, slaChatTarget, slaChatSec, 85, 0, "chat", safeConcurrency, 0);
      chatExtraAgents = cr.rawAgents;
    }

    const emailWorkloadHours = emailCPI * effectiveEmailAht / 3600;
    const netEmailWorkload = Math.max(0, emailWorkloadHours - voiceUsableIdleHours);
    const emailExtraAgents = rhoMax > 0 ? netEmailWorkload / (rhoMax * intervalHours) : 0;
    return {
      rawAgents: voiceRawAgents + chatExtraAgents + emailExtraAgents,
      occupancy: vr.occupancy,
      voiceRawAgents,
      chatRawAgents: chatExtraAgents,
    };
  }

  if (chatCPI > 0 && chatAht > 0) {
    const cr = computeIntervalFTE(chatCPI, CAPACITY_INTERVAL_MINUTES, chatAht, slaChatTarget, slaChatSec, 85, 0, "chat", safeConcurrency, 0);
    const chatRawAgents = cr.rawAgents;
    const chatPhysicalWorkloadHours = chatCPI * chatAht / (3600 * safeConcurrency);
    const chatOccupancy = chatRawAgents > 0 ? chatPhysicalWorkloadHours / (chatRawAgents * intervalHours) : 0;
    const chatUsableIdleHours = Math.max(0, chatRawAgents * intervalHours * (rhoMax - chatOccupancy));
    const emailWorkloadHours = emailCPI * effectiveEmailAht / 3600;
    const netEmailWorkload = Math.max(0, emailWorkloadHours - chatUsableIdleHours);
    const emailExtraAgents = rhoMax > 0 ? netEmailWorkload / (rhoMax * intervalHours) : 0;
    return {
      rawAgents: chatRawAgents + emailExtraAgents,
      occupancy: cr.occupancy,
      voiceRawAgents: 0,
      chatRawAgents,
    };
  }

  if (emailCPI > 0 && emailAht > 0) {
    const er = computeIntervalFTE(emailCPI, CAPACITY_INTERVAL_MINUTES, emailAht, 0, 0, emailOccupancyPct, 0, "email");
    return { rawAgents: er.rawAgents, occupancy: er.occupancy, voiceRawAgents: 0, chatRawAgents: 0 };
  }

  return { rawAgents: 0, occupancy: 0, voiceRawAgents: 0, chatRawAgents: 0 };
}

function calcIntervalizedBlendedFTE(
  voiceGrid: number[][], voiceAht: number,
  chatGrid: number[][], chatAht: number,
  emailGrid: number[][], emailAht: number,
  fteHoursPerDay: number,
  fteWorkdaysPerWeek: number,
  shrinkagePct: number,
  slaVoiceTarget: number,
  slaVoiceSec: number,
  slaChatTarget: number,
  slaChatSec: number,
  emailOccupancyPct: number,
  chatConcurrency: number,
  taskSwitchMultiplier = 1.05,
): { fte: number; fteRaw: number; staffedHours: number; occupancy: number; rawAgentsAvg: number } {
  let staffedHours = 0;
  let rawAgentSum = 0;
  let intervalCount = 0;
  let weightedOccupancy = 0;
  let liveVolume = 0;
  for (let d = 0; d < 7; d++) {
    for (let i = 0; i < CAPACITY_INTERVALS_PER_DAY; i++) {
      const voiceCPI = voiceGrid[d]?.[i] ?? 0;
      const chatCPI = chatGrid[d]?.[i] ?? 0;
      const emailCPI = emailGrid[d]?.[i] ?? 0;
      if (voiceCPI <= 0 && chatCPI <= 0 && emailCPI <= 0) continue;
      const result = calcBlendedIntervalRawAgents(
        voiceCPI, voiceAht,
        chatCPI, chatAht,
        emailCPI, emailAht,
        slaVoiceTarget, slaVoiceSec, slaChatTarget, slaChatSec,
        emailOccupancyPct, chatConcurrency, taskSwitchMultiplier,
      );
      staffedHours += result.rawAgents * (CAPACITY_INTERVAL_MINUTES / 60);
      rawAgentSum += result.rawAgents;
      intervalCount += 1;
      const realTimeVolume = voiceCPI + chatCPI;
      weightedOccupancy += result.occupancy * realTimeVolume;
      liveVolume += realTimeVolume;
    }
  }
  const fteRaw = convertStaffedHoursToFte(staffedHours, fteHoursPerDay, fteWorkdaysPerWeek, shrinkagePct);
  return {
    fte: ceilTo(fteRaw),
    fteRaw,
    staffedHours,
    occupancy: liveVolume > 0 ? weightedOccupancy / liveVolume : 0,
    rawAgentsAvg: intervalCount > 0 ? rawAgentSum / intervalCount : 0,
  };
}

function calcRampPct(ageWeeks: number, trainWks: number, nestWks: number, nestPct: number): number {
  if (ageWeeks < trainWks) return 0;
  if (ageWeeks < trainWks + nestWks) return nestPct / 100;
  return 1;
}

function fmt1(n: number | null | undefined, fallback = "—"): string {
  if (n == null) return fallback;
  const num = Number(n);
  if (isNaN(num)) return fallback;
  return num % 1 === 0 ? num.toLocaleString() : num.toFixed(1);
}

function fmtPct(n: number | string | null | undefined, dp = 1): string {
  const num = Number(n);
  if (isNaN(num)) return "—";
  return `${num.toFixed(dp)}%`;
}

function clampNumericInput(value: number, min?: number, max?: number): number {
  let next = value;
  if (min != null) next = Math.max(min, next);
  if (max != null) next = Math.min(max, next);
  return next;
}

// Heatmap tint for the Gap/Surplus row. inset box-shadow overlays a translucent
// colour over the cell's own opaque background — required because the cell is
// sticky-bottom and must fully hide scrolled rows beneath it.
function gapCellStyle(v: number, maxAbs: number): React.CSSProperties {
  if (maxAbs <= 0) return {};
  const intensity = Math.min(1, Math.abs(v) / maxAbs);
  const color = v >= 0
    ? `rgba(34, 197, 94, ${intensity * 0.35})`
    : `rgba(239, 68, 68, ${intensity * 0.40})`;
  return { boxShadow: `inset 0 0 0 9999px ${color}` };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface EditableCellProps {
  value: number | null;
  autoValue?: number | null;
  isOverridden?: boolean;
  onSave: (val: number | null) => void;
  onReset?: () => void;
  className?: string;
  format?: (v: number) => string;
  nullable?: boolean;
}

function EditableCell({ value, autoValue, isOverridden, onSave, onReset, className = "", format = fmt1, nullable = false }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(value != null ? String(value) : "");
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === "" && nullable) { onSave(null); setEditing(false); return; }
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed)) onSave(parsed);
    else if (trimmed === "" && autoValue != null) onReset?.();
    setEditing(false);
  }

  const displayVal = value != null ? format(value) : (autoValue != null ? format(autoValue) : "—");

  if (editing) {
    return (
      <td className={`px-1 py-0.5 min-w-[72px] ${className}`}>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          className="w-full text-right text-xs bg-blue-50 dark:bg-blue-950 border border-blue-400 rounded px-1 py-0.5 outline-none"
        />
      </td>
    );
  }

  return (
    <td
      className={`px-2 py-1 text-right text-xs cursor-pointer select-none whitespace-nowrap group relative
        ${isOverridden ? "bg-slate-200 dark:bg-slate-700/40 text-black dark:text-black" : ""}
        hover:bg-muted/50 transition-colors ${className}`}
      onClick={startEdit}
      title={isOverridden && autoValue != null ? `Auto: ${format(autoValue)} — click to edit, use ↺ to reset` : "Click to edit"}
    >
      <span>{displayVal}</span>
      {isOverridden && onReset && (
        <button
          onClick={e => { e.stopPropagation(); onReset(); }}
          className="ml-1 text-black hover:text-black opacity-70 hover:opacity-100"
          title="Reset to auto value"
        >
          <RotateCcw className="inline size-2.5" />
        </button>
      )}
    </td>
  );
}

function ReadOnlyCell({ value, className = "", bold = false }: { value: string; className?: string; bold?: boolean }) {
  return (
    <td className={`px-2 py-1 text-right text-xs whitespace-nowrap ${bold ? "font-semibold" : ""} ${className}`}>
      {value}
    </td>
  );
}

function InputCell({ value, onChange, onReset, placeholder = "", note, onNoteChange }: {
  value: number | undefined; onChange: (v: number | null) => void; onReset?: () => void;
  placeholder?: string; color?: "blue" | "orange" | "green" | "default";
  note?: string; onNoteChange?: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string>("");
  const [focused, setFocused] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [noteOpen, setNoteOpen] = useState(false);

  const hasManualValue = focused ? draft.trim() !== "" : value != null;
  const editableCellClass = hasManualValue
    ? "bg-yellow-100 border-blue-500 text-black"
    : "bg-white border-blue-500 text-black";

  function commit(raw: string) {
    const t = raw.trim();
    if (t === "") { onChange(null); return; }
    const n = parseFloat(t);
    if (!isNaN(n)) onChange(n);
  }

  function openNote() {
    setNoteDraft(note ?? "");
    setNoteOpen(true);
  }

  function commitNote() {
    onNoteChange?.(noteDraft);
    setNoteOpen(false);
  }

  const displayVal = focused ? draft : (value != null ? String(value) : "");
  const hasNote = !!note;

  return (
    <td className="px-1 py-0.5 min-w-[72px] relative">
      {/* Note indicator dot — amber when note exists, faint on hover when empty */}
      {onNoteChange && (
        <Popover open={noteOpen} onOpenChange={open => { if (open) openNote(); else setNoteOpen(false); }}>
          <PopoverTrigger asChild>
            <button
              className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-sm cursor-pointer focus:outline-none transition-colors ${hasNote ? "bg-amber-400" : "bg-transparent hover:bg-amber-200"}`}
              title={hasNote ? note : "Add note"}
            />
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" side="top" align="end">
            <p className="text-xs font-medium text-muted-foreground mb-1">Note</p>
            <textarea
              autoFocus
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitNote(); } if (e.key === "Escape") setNoteOpen(false); }}
              className="w-full text-xs border border-border rounded p-1.5 resize-none outline-none focus:ring-1 focus:ring-blue-400 bg-background"
              rows={3}
              placeholder="Reason for this change…"
            />
            <div className="flex justify-end gap-1 mt-1.5">
              <button onClick={() => setNoteOpen(false)} className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted">Cancel</button>
              <button onClick={commitNote} className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700">Save</button>
            </div>
          </PopoverContent>
        </Popover>
      )}
      <input
        value={displayVal}
        placeholder={placeholder}
        onFocus={() => { setDraft(value != null ? String(value) : ""); setFocused(true); }}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { commit(draft); setFocused(false); }}
        onKeyDown={e => { if (e.key === "Enter") { commit(draft); setFocused(false); (e.target as HTMLInputElement).blur(); } }}
        className={`w-full text-right text-xs border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-blue-400 ${editableCellClass}`}
      />
    </td>
  );
}

function CommitNumberInput({
  value,
  onCommit,
  min,
  max,
  step,
  integer = false,
  emptyValue,
  placeholder,
  className = "h-8 text-xs",
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  emptyValue?: number;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === "" && emptyValue != null) {
      onCommit(emptyValue);
      setDraft(String(emptyValue));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const normalized = integer ? Math.round(parsed) : parsed;
    const clamped = clampNumericInput(normalized, min, max);
    onCommit(clamped);
    setDraft(String(clamped));
  }

  return (
    <Input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") {
          commit();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={className}
    />
  );
}

interface SectionHeaderRowProps {
  label: string; colSpan: number; collapsed: boolean;
  onToggle: () => void; onReset?: () => void;
  bg?: string;
}

function SectionHeaderRow({ label, colSpan, collapsed, onToggle, onReset, bg = "bg-muted/60 dark:bg-muted/30" }: SectionHeaderRowProps) {
  return (
    <tr className={bg}>
      <td colSpan={colSpan} className="px-3 py-1.5 text-left">
        <div className="flex items-center justify-between">
          <button onClick={onToggle} className="flex items-center gap-1.5 text-xs font-semibold text-black hover:text-black transition-colors">
            {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {label}
          </button>
          {onReset && (
            <button onClick={onReset} className="flex items-center gap-1 text-xs text-black hover:text-black transition-colors">
              <RotateCcw className="size-3" /> Reset all
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function RowLabel({ label, indent = false, bold = false, sub = false }: { label: string; indent?: boolean; bold?: boolean; sub?: boolean }) {
  return (
    <td className={`sticky left-0 z-10 bg-card border-r border-border px-3 py-1 text-xs whitespace-nowrap
      ${indent ? "pl-6" : ""} ${bold ? "font-semibold" : ""} ${sub ? "text-black" : "text-black"}`}>
      {label}
    </td>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function CapacityPlanning() {
  const { lobs, activeLob, setActiveLob } = useLOB();

  // ── Local state
  const [config, setConfig] = useState<PlanConfig>(DEFAULT_CONFIG);
  const [weeklyInputs, setWeeklyInputs] = useState<WeekInputMap>({});
  const [dedicatedInputsByChannel, setDedicatedInputsByChannel] = useState<Partial<Record<ChannelKey, WeekInputMap>>>({});
  const [demandAssumptions, setDemandAssumptions] = useState<DemandAssumptions | null>(null);
  const [plannerSnapshot, setPlannerSnapshot] = useState<CapacityPlannerSnapshot | null>(null);
  const [lobSettings, setLobSettings] = useState<LobSettings | null>(null);
  const [hoursPerDay, setHoursPerDay] = useState(7.5);
  const [fteWorkdaysPerWeek, setFteWorkdaysPerWeek] = useState(5);
  const [computedShrinkagePct, setComputedShrinkagePct] = useState<number | null>(null);
  const [intradayRecordsByChannel, setIntradayRecordsByChannel] = useState<Partial<Record<ChannelKey, InteractionArrivalRecord[]>>>({});
  const [profilesByChannel, setProfilesByChannel] = useState<Partial<Record<ChannelKey, DistributionProfile>>>({});
  const [intradayPrefsByChannel, setIntradayPrefsByChannel] = useState<Partial<Record<ChannelKey, IntradayPrefsSnapshot>>>({});
  const [activeChannel, setActiveChannel] = useState<ChannelKey>("voice");
  const [assumptionsOpen, setAssumptionsOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState({ demand: false, staffing: false, hcPlan: false });
  const [whatIfs, setWhatIfs] = useState<Record<string, CapacityWhatIf>>({});
  const [selectedWhatIfId, setSelectedWhatIfId] = useState<string>("base");
  const [fteModelOverride, setFteModelOverride] = useState<FteModelSnapshot | null>(null);
  const [demandSourceName, setDemandSourceName] = useState<string | null>(null);
  const [demandSourceType, setDemandSourceType] = useState<DemandSourceType>("fallback");
  const [demandSourceWarning, setDemandSourceWarning] = useState<string | null>(null);
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const configTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataLoadedFor = useRef<string | null>(null);

  // ── Derived
  const isDedicated = lobSettings?.pooling_mode === "dedicated";
  const enabledChannels = useMemo<ChannelKey[]>(() => {
    if (!lobSettings?.channels_enabled) return ["voice"];
    return CHANNELS.filter(c => lobSettings.channels_enabled[c]);
  }, [lobSettings]);
  const apiChannel = isDedicated ? activeChannel : "blended";

  useEffect(() => {
    if (!isDedicated || enabledChannels.length === 0 || enabledChannels.includes(activeChannel)) return;
    dataLoadedFor.current = null;
    setActiveChannel(enabledChannels[0]);
  }, [isDedicated, enabledChannels, activeChannel]);

  // ── Load data when LOB or channel changes
  useEffect(() => {
    if (!activeLob) return;
    const key = `${activeLob.id}:${apiChannel}`;
    if (dataLoadedFor.current === key) return;
    dataLoadedFor.current = key;
    loadAllData(activeLob.id, apiChannel);
  }, [activeLob?.id, apiChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeLob || !isDedicated || enabledChannels.length === 0) {
      setDedicatedInputsByChannel({});
      return;
    }

    let cancelled = false;
    Promise.all(enabledChannels.map(async channel => {
      const res = await fetch(apiUrl(`/api/capacity-plan-inputs?lob_id=${activeLob.id}&channel=${channel}`));
      const rows = await res.json();
      return [channel, Array.isArray(rows) ? parseWeekInputsRows(rows) : {}] as const;
    }))
      .then(entries => {
        if (cancelled) return;
        setDedicatedInputsByChannel(Object.fromEntries(entries) as Partial<Record<ChannelKey, WeekInputMap>>);
      })
      .catch(() => {
        if (!cancelled) setDedicatedInputsByChannel({});
      });

    return () => { cancelled = true; };
  }, [activeLob?.id, isDedicated, enabledChannels]);

  async function loadAllData(lobId: number, channel: string) {
    setLoading(true);
    try {
      const [configRes, inputsRes, committedRes, activeStateRes, lobSettingsRes, shrinkageRes, wifRes] = await Promise.all([
        fetch(apiUrl(`/api/capacity-plan-config?lob_id=${lobId}&channel=${channel}`)),
        fetch(apiUrl(`/api/capacity-plan-inputs?lob_id=${lobId}&channel=${channel}`)),
        fetch(apiUrl(`/api/demand-planner-scenarios/committed?lob_id=${lobId}`)),
        fetch(apiUrl(`/api/demand-planner-active-state?lob_id=${lobId}`)),
        fetch(apiUrl(`/api/lob-settings?lob_id=${lobId}`)),
        fetch(apiUrl(`/api/shrinkage-plan?lob_id=${lobId}`)),
        fetch(apiUrl(`/api/capacity-planner-whatifs?lob_id=${lobId}&channel=${channel}`)),
      ]);

      const [cfgData, inputsData, committedData, activeStateData, lsData, shrData, wifData] = await Promise.all([
        configRes.json(), inputsRes.json(), committedRes.json(), activeStateRes.json(),
        lobSettingsRes.json(), shrinkageRes.json(), wifRes.json(),
      ]);

      // Parse PlanConfig from DB row
      const loadedConfig: PlanConfig = cfgData ? {
        planStartDate: cfgData.plan_start_date?.split("T")[0] ?? DEFAULT_CONFIG.planStartDate,
        horizonWeeks: cfgData.horizon_weeks ?? DEFAULT_CONFIG.horizonWeeks,
        attritionRateMonthly: parseFloat(cfgData.attrition_rate_monthly) ?? DEFAULT_CONFIG.attritionRateMonthly,
        attritionModel: normalizeAttritionModel(cfgData.attrition_model),
        attritionFixedCount: normalizeNonNegativeNumber(cfgData.attrition_fixed_count, DEFAULT_CONFIG.attritionFixedCount),
        attritionFixedEveryMonths: normalizePositiveNumber(cfgData.attrition_fixed_every_months, DEFAULT_CONFIG.attritionFixedEveryMonths),
        rampTrainingWeeks: cfgData.ramp_training_weeks ?? DEFAULT_CONFIG.rampTrainingWeeks,
        rampNestingWeeks: cfgData.ramp_nesting_weeks ?? DEFAULT_CONFIG.rampNestingWeeks,
        rampNestingPct: parseFloat(cfgData.ramp_nesting_pct) ?? DEFAULT_CONFIG.rampNestingPct,
        trainingGradRate: cfgData.training_grad_rate != null ? parseFloat(cfgData.training_grad_rate) : DEFAULT_CONFIG.trainingGradRate,
        startingHc: parseFloat(cfgData.starting_hc) ?? DEFAULT_CONFIG.startingHc,
        billableFte: parseFloat(cfgData.billable_fte) || DEFAULT_CONFIG.billableFte,
      } : DEFAULT_CONFIG;

      // Load capacity what-ifs; seed a "Base" what-if if none exist
      if (Array.isArray(wifData) && wifData.length > 0) {
        const wifMap: Record<string, CapacityWhatIf> = {};
        for (const r of wifData) {
          const snapshot = r.config_snapshot ?? {};
          wifMap[r.whatif_id] = {
            id: r.whatif_id, name: r.whatif_name,
            is_committed: r.is_committed,
            configSnapshot: r.whatif_id === "base" ? loadedConfig : normalizePlanConfig(snapshot),
            fteModelSnapshot: normalizeFteModelSnapshot(snapshot.fteModelSnapshot),
          };
        }
        setWhatIfs(wifMap);
        const savedId = localStorage.getItem(`capWhatIfId_${lobId}_${channel}`);
        const validId = savedId && wifMap[savedId] ? savedId : Object.keys(wifMap)[0];
        setSelectedWhatIfId(validId);
        setConfig(validId === "base" ? loadedConfig : wifMap[validId].configSnapshot);
        setFteModelOverride(wifMap[validId].fteModelSnapshot ?? null);
      } else {
        const base: CapacityWhatIf = { id: "base", name: "Base", is_committed: false, configSnapshot: loadedConfig };
        setWhatIfs({ base });
        setSelectedWhatIfId("base");
        setConfig(loadedConfig);
        setFteModelOverride(null);
      }

      if (Array.isArray(inputsData)) {
        setWeeklyInputs(parseWeekInputsRows(inputsData));
      }

      // Volume source: committed demand what-if takes priority over active state
      const committedSnap = committedData?.planner_snapshot ?? null;
      const activeSnap = activeStateData?.plannerSnapshot ?? null;
      const demandData = committedSnap ? { plannerSnapshot: committedSnap } : activeStateData;
      setDemandSourceName(committedSnap ? (committedData?.scenario_name ?? null) : activeSnap ? "Active Demand Forecast" : null);
      setDemandSourceType(committedSnap ? "committed" : activeSnap ? "active" : "fallback");
      const committedHorizon = Number(committedSnap?.assumptions?.forecastHorizon);
      const activeHorizon = Number(activeSnap?.assumptions?.forecastHorizon);
      setDemandSourceWarning(
        committedSnap && committedHorizon !== 2 && activeHorizon === 2
          ? "Capacity is using the committed Demand Forecast scenario. A newer 2-year active Demand Forecast may exist. Commit or refresh the Demand scenario to use Year 2 volume."
          : null
      );

      const snap = demandData?.plannerSnapshot ?? null;
      if (snap?.assumptions) {
        setDemandAssumptions(snap.assumptions as DemandAssumptions);
        setPlannerSnapshot(snap as CapacityPlannerSnapshot);
      } else {
        setDemandAssumptions(null);
        setPlannerSnapshot(null);
        setDemandSourceWarning(null);
      }

      if (lsData) setLobSettings(lsData as LobSettings);

      if (shrData?.hours_per_day) setHoursPerDay(parseFloat(shrData.hours_per_day));
      else setHoursPerDay(7.5);
      if (shrData?.days_per_week) setFteWorkdaysPerWeek(parseFloat(shrData.days_per_week));
      else setFteWorkdaysPerWeek(5);

      // Compute shrinkage % from the itemized shrinkage plan — same formula as
      // ShrinkagePlanning.tsx. Uses totalExcl (holidays excluded) to match what
      // LongTermForecasting_Demand reads from localStorage.
      if (shrData?.absence_items || shrData?.activity_items) {
        const hpd = shrData.hours_per_day ? parseFloat(shrData.hours_per_day) : 7.5;
        const dpw = shrData.days_per_week ? parseFloat(shrData.days_per_week) : 5;
        const absenceItems = Array.isArray(shrData.absence_items) ? shrData.absence_items : [];
        const activityItems = Array.isArray(shrData.activity_items) ? shrData.activity_items : [];
        const absenceExcl = computeShrinkageFromItems(absenceItems.filter((i: { isHoliday?: boolean }) => !i.isHoliday), hpd, dpw);
        const activityPct = computeShrinkageFromItems(activityItems, hpd, dpw);
        setComputedShrinkagePct(Number((absenceExcl + activityPct).toFixed(1)));
      } else {
        setComputedShrinkagePct(null);
      }

    } catch (err) {
      toast.error("Failed to load capacity plan data.");
    } finally {
      setLoading(false);
    }
  }

  // ── Save config (debounced 1.5s)
  const saveConfig = useCallback((next: PlanConfig) => {
    if (!activeLob) return;
    if (configTimer.current) clearTimeout(configTimer.current);
    configTimer.current = setTimeout(async () => {
      try {
        await fetch(apiUrl(`/api/capacity-plan-config?lob_id=${activeLob.id}&channel=${apiChannel}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_start_date: next.planStartDate,
            horizon_weeks: next.horizonWeeks,
            attrition_rate_monthly: next.attritionRateMonthly,
            attrition_model: next.attritionModel,
            attrition_fixed_count: next.attritionFixedCount,
            attrition_fixed_every_months: next.attritionFixedEveryMonths,
            ramp_training_weeks: next.rampTrainingWeeks,
            ramp_nesting_weeks: next.rampNestingWeeks,
            ramp_nesting_pct: next.rampNestingPct,
            training_grad_rate: next.trainingGradRate,
            starting_hc: next.startingHc,
            billable_fte: next.billableFte,
          }),
        });
      } catch { toast.error("Failed to save plan config."); }
    }, 1500);
  }, [activeLob, apiChannel]);

  function updateConfig(patch: Partial<PlanConfig>) {
    const next = { ...config, ...patch };
    setConfig(next);
    setWhatIfs(prev => {
      const active = selectedWhatIfId ? prev[selectedWhatIfId] : undefined;
      if (!active) return prev;
      return { ...prev, [active.id]: { ...active, configSnapshot: next } };
    });
    saveConfig(next);
  }

  // ── Save individual cell input
  function saveCell(weekOffset: number, field: keyof WeekInput, value: number | null) {
    if (!activeLob) return;
    const dbField = FIELD_MAP[field];
    if (!dbField) return;
    const timerKey = `${weekOffset}:${field}`;
    const existing = saveTimers.current.get(timerKey);
    if (existing) clearTimeout(existing);
    const t = setTimeout(async () => {
      try {
        await fetch(apiUrl(`/api/capacity-plan-inputs?lob_id=${activeLob.id}&channel=${apiChannel}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ week_offset: weekOffset, field: dbField, value }),
        });
      } catch { toast.error("Failed to save."); }
      saveTimers.current.delete(timerKey);
    }, 400);
    saveTimers.current.set(timerKey, t);
  }

  function setCellInput(weekOffset: number, field: keyof WeekInput, value: number | null) {
    setWeeklyInputs(prev => ({
      ...prev,
      [weekOffset]: { ...(prev[weekOffset] ?? {}), [field]: value },
    }));
    saveCell(weekOffset, field, value);
  }

  function saveCellNote(weekOffset: number, field: keyof WeekInput, value: string) {
    if (!activeLob) return;
    const dbField = FIELD_MAP[field];
    if (!dbField) return;
    const timerKey = `${weekOffset}:${field}`;
    const existing = saveTimers.current.get(timerKey);
    if (existing) clearTimeout(existing);
    const t = setTimeout(async () => {
      try {
        await fetch(apiUrl(`/api/capacity-plan-inputs?lob_id=${activeLob.id}&channel=${apiChannel}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ week_offset: weekOffset, field: dbField, value: value || null }),
        });
      } catch { toast.error("Failed to save note."); }
      saveTimers.current.delete(timerKey);
    }, 600);
    saveTimers.current.set(timerKey, t);
  }

  function setCellNote(weekOffset: number, field: keyof WeekInput, value: string) {
    setWeeklyInputs(prev => ({
      ...prev,
      [weekOffset]: { ...(prev[weekOffset] ?? {}), [field]: value },
    }));
    saveCellNote(weekOffset, field, value);
  }

  function resetOverride(weekOffset: number, field: keyof WeekInput) {
    setCellInput(weekOffset, field, null);
  }

  function resetDemandRow(volField: keyof WeekInput, ahtField: keyof WeekInput) {
    const allWeeks = Object.keys(weeklyInputs).map(Number);
    const updated = { ...weeklyInputs };
    for (const w of allWeeks) {
      if (updated[w]) {
        updated[w] = { ...updated[w], [volField]: null, [ahtField]: null };
        saveCell(w, volField, null);
        saveCell(w, ahtField, null);
      }
    }
    setWeeklyInputs(updated);
  }

  function resetAllDemandOverrides() {
    const allWeeks = Object.keys(weeklyInputs).map(Number);
    const updated = { ...weeklyInputs };
    for (const w of allWeeks) {
      if (updated[w]) {
        const clean = { ...updated[w] };
        for (const f of ["volVoice","volChat","volEmail","volCases","ahtVoice","ahtChat","ahtEmail","ahtCases"] as (keyof WeekInput)[]) {
          clean[f] = null as never;
          saveCell(w, f, null);
        }
        updated[w] = clean;
      }
    }
    setWeeklyInputs(updated);
  }

  function resetVolumeOverridesForCurrentHorizon() {
    const volumeFields = ["volVoice","volChat","volEmail","volCases"] as (keyof WeekInput)[];
    const updated = { ...weeklyInputs };
    for (const wk of weeks) {
      const existing = updated[wk.weekOffset];
      if (!existing) continue;
      const clean = { ...existing };
      for (const field of volumeFields) {
        if (clean[field] != null) {
          clean[field] = null as never;
          saveCell(wk.weekOffset, field, null);
        }
      }
      updated[wk.weekOffset] = clean;
    }
    setWeeklyInputs(updated);
    toast.success("Volume overrides reset for the current horizon");
  }

  // ── What-if handlers ──────────────────────────────────────────────────────────

  function handleWhatIfChange(id: string) {
    const wif = whatIfs[id];
    if (!wif) return;
    setSelectedWhatIfId(id);
    localStorage.setItem(`capWhatIfId_${activeLob?.id}_${apiChannel}`, id);
    setConfig(wif.configSnapshot);
    setFteModelOverride(wif.fteModelSnapshot ?? null);
    saveConfig(wif.configSnapshot);
  }

  async function handleSaveWhatIf(silent = false) {
    const id = selectedWhatIfId || "base";
    const existing = whatIfs[id];
    const fteModelSnapshot = normalizeFteModelSnapshot(fteModel) ?? defaultFteModel;
    const configSnapshot = { ...config, fteModelSnapshot };
    const updated: CapacityWhatIf = {
      id, name: existing?.name ?? "Base",
      is_committed: existing?.is_committed ?? false,
      configSnapshot: config,
      fteModelSnapshot,
    };
    setWhatIfs(prev => ({ ...prev, [id]: updated }));
    try {
      await fetch(apiUrl(`/api/capacity-planner-whatifs/${id}`), {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatif_name: updated.name, config_snapshot: configSnapshot,
          is_committed: updated.is_committed, lob_id: activeLob?.id, channel: apiChannel }),
      });
      if (!silent) toast.success("What-if saved");
    } catch { if (!silent) toast.error("What-if saved locally, cloud sync failed"); }
  }

  async function handleNewWhatIf() {
    const id = `cap-${Date.now()}`;
    const name = `What-if ${Object.keys(whatIfs).length + 1}`;
    const fteModelSnapshot = normalizeFteModelSnapshot(fteModel) ?? defaultFteModel;
    const newWif: CapacityWhatIf = { id, name, is_committed: false, configSnapshot: config, fteModelSnapshot };
    setWhatIfs(prev => ({ ...prev, [id]: newWif }));
    setSelectedWhatIfId(id);
    setFteModelOverride(fteModelSnapshot);
    localStorage.setItem(`capWhatIfId_${activeLob?.id}_${apiChannel}`, id);
    try {
      await fetch(apiUrl(`/api/capacity-planner-whatifs/${id}`), {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatif_name: name, config_snapshot: { ...config, fteModelSnapshot },
          is_committed: false, lob_id: activeLob?.id, channel: apiChannel }),
      });
      toast.success("New what-if created");
    } catch { toast.success("New what-if created locally"); }
  }

  async function handleDeleteWhatIf(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!window.confirm("Delete this what-if?")) return;
    const updated = { ...whatIfs }; delete updated[id];
    const nextId = id === selectedWhatIfId ? (Object.keys(updated)[0] ?? "") : selectedWhatIfId;
    setWhatIfs(updated);
    setSelectedWhatIfId(nextId);
    // NOTE: do NOT call setConfig here — live working state belongs to the user
    try {
      await fetch(apiUrl(`/api/capacity-planner-whatifs/${id}`), { method: "DELETE" });
      toast.success("What-if deleted");
    } catch { toast.error("What-if deleted locally, cloud sync failed"); }
  }

  async function handleRenameWhatIf() {
    const active = whatIfs[selectedWhatIfId];
    if (!active) return;
    const next = window.prompt("Rename what-if:", active.name);
    if (!next || next.trim() === "" || next.trim() === active.name) return;
    const renamed: CapacityWhatIf = { ...active, name: next.trim() };
    setWhatIfs(prev => ({ ...prev, [active.id]: renamed }));
    try {
      await fetch(apiUrl(`/api/capacity-planner-whatifs/${active.id}`), {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatif_name: renamed.name, config_snapshot: { ...renamed.configSnapshot, fteModelSnapshot: renamed.fteModelSnapshot },
          is_committed: renamed.is_committed, lob_id: activeLob?.id, channel: apiChannel }),
      });
      toast.success("What-if renamed");
    } catch { toast.error("What-if renamed locally, cloud sync failed"); }
  }

  async function handleCommitWhatIf() {
    await handleSaveWhatIf(true);
    const fteModelSnapshot = normalizeFteModelSnapshot(fteModel) ?? defaultFteModel;
    const committed = Object.fromEntries(
      Object.entries(whatIfs).map(([k, v]) => [k, {
        ...v,
        configSnapshot: k === selectedWhatIfId ? config : v.configSnapshot,
        fteModelSnapshot: k === selectedWhatIfId ? fteModelSnapshot : v.fteModelSnapshot,
        is_committed: k === selectedWhatIfId,
      }])
    ) as Record<string, CapacityWhatIf>;
    setWhatIfs(committed);
    const name = whatIfs[selectedWhatIfId]?.name ?? "";
    try {
      await fetch(apiUrl(`/api/capacity-planner-whatifs/${selectedWhatIfId}/commit`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lob_id: activeLob?.id, channel: apiChannel }),
      });
      toast.success(`"${name}" committed as the official capacity plan`);
    } catch { toast.error("Committed locally, cloud sync failed"); }
  }

  // ── Computed weeks
  const weeks = useMemo(() => buildWeeks(config.planStartDate, config.horizonWeeks), [config.planStartDate, config.horizonWeeks]);

  useEffect(() => {
    if (!activeLob || weeks.length === 0 || enabledChannels.length === 0) {
      setIntradayRecordsByChannel({});
      setProfilesByChannel({});
      setIntradayPrefsByChannel({});
      return;
    }

    let cancelled = false;
    const start = getWeekStartDate(config.planStartDate, 0);
    const end = addDays(getWeekStartDate(config.planStartDate, Math.max(0, config.horizonWeeks - 1)), 6);
    const startDate = fmtISODate(start);
    const endDate = fmtISODate(end);
    const staffingMode = normalizeIntradayStaffingMode(isDedicated ? "dedicated" : "blended");

    Promise.all(enabledChannels.map(async channel => {
      const intradayPrefsPageKey = buildIntradayPrefsPageKey(channel, staffingMode);
      const [arrivalRes, profileRes, prefsRes] = await Promise.all([
        fetch(apiUrl(`/api/interaction-arrival?startDate=${startDate}&endDate=${endDate}&channel=${channel}&lob_id=${activeLob.id}`))
          .then(r => r.ok ? r.json() : [])
          .catch(() => []),
        fetch(apiUrl(`/api/distribution-profiles?lob_id=${activeLob.id}&channel=${channel}&staffing_mode=${staffingMode}&allow_legacy_fallback=true`))
          .then(r => r.ok ? r.json() : [])
          .catch(() => []),
        fetch(apiUrl(`/api/user-preferences?page_key=${encodeURIComponent(intradayPrefsPageKey)}&lob_id=${activeLob.id}`))
          .then(r => r.ok ? r.json() : {})
          .catch(() => ({})),
      ]);
      return {
        channel,
        records: Array.isArray(arrivalRes) ? arrivalRes as InteractionArrivalRecord[] : [],
        profile: Array.isArray(profileRes) && profileRes.length > 0 ? profileRes[0] as DistributionProfile : undefined,
        prefs: prefsRes && typeof prefsRes === "object" ? prefsRes as IntradayPrefsSnapshot : undefined,
      };
    })).then(entries => {
      if (cancelled) return;
      setIntradayRecordsByChannel(Object.fromEntries(entries.map(e => [e.channel, e.records])) as Partial<Record<ChannelKey, InteractionArrivalRecord[]>>);
      setProfilesByChannel(Object.fromEntries(entries.filter(e => e.profile).map(e => [e.channel, e.profile])) as Partial<Record<ChannelKey, DistributionProfile>>);
      setIntradayPrefsByChannel(Object.fromEntries(entries.filter(e => e.prefs).map(e => [e.channel, e.prefs])) as Partial<Record<ChannelKey, IntradayPrefsSnapshot>>);
    }).catch(() => {
      if (!cancelled) {
        setIntradayRecordsByChannel({});
        setProfilesByChannel({});
        setIntradayPrefsByChannel({});
      }
    });

    return () => { cancelled = true; };
  }, [activeLob?.id, weeks.length, enabledChannels, config.planStartDate, config.horizonWeeks, isDedicated]);

  // ── Monthly forecast arrays from demand planner snapshot (captures seasonality)
  const forecastedMonthlyVols = useMemo<{ voice: number[]; chat: number[]; email: number[]; cases: number[] } | null>(() => {
    if (!plannerSnapshot) return null;
    const sel = plannerSnapshot.selectedChannels ?? {};
    const chatEnabled = !!sel.chat;
    const emailEnabled = !!sel.email;
    const casesEnabled = !!sel.cases;

    const { forecastMethod, hwParams, arimaParams, decompParams, assumptions } = plannerSnapshot;
    const isTwoYearForecast = Number(assumptions.forecastHorizon) === 2;
    const planningMonths = isTwoYearForecast ? 24 : (assumptions.planningMonths ?? 12);
    const year1Months = isTwoYearForecast ? 12 : planningMonths;
    const apiData = plannerSnapshot.channelHistoricalApiData ?? {};
    const overrides = plannerSnapshot.channelHistoricalOverrides ?? {};
    function applyOv(data: number[], ov: Record<number, string>): number[] {
      const len = Math.max(data.length, ...Object.keys(ov).map(Number).map(k => k + 1), 0);
      return Array.from({ length: len }, (_, i) => {
        const base = data[i] ?? 0;
        const o = ov[i];
        if (!o) return base;
        const p = parseInt(o, 10);
        return Number.isFinite(p) && p > 0 ? p : base;
      });
    }
    const voiceH = applyOv(apiData.voice ?? [], overrides.voice ?? {});
    const chatH = applyOv(apiData.chat ?? [], overrides.chat ?? {});
    const emailH = applyOv(apiData.email ?? [], overrides.email ?? {});
    const casesH = applyOv(apiData.cases ?? [], overrides.cases ?? {});
    const voiceYear1 = getCalculatedVolumes(voiceH, forecastMethod, assumptions, hwParams, arimaParams, decompParams, year1Months);
    const zerosYear1 = voiceYear1.map(() => 0);
    const chatYear1 = !chatEnabled ? zerosYear1
      : chatH.length > 0
        ? getCalculatedVolumes(chatH, forecastMethod, assumptions, hwParams, arimaParams, decompParams, year1Months)
        : voiceYear1.map(v => Math.round(v * 0.3));
    const emailYear1 = !emailEnabled ? zerosYear1
      : emailH.length > 0
        ? getCalculatedVolumes(emailH, forecastMethod, assumptions, hwParams, arimaParams, decompParams, year1Months)
        : voiceYear1.map(v => Math.round(v * 0.2));
    const casesYear1 = !casesEnabled ? zerosYear1
      : casesH.length > 0
        ? getCalculatedVolumes(casesH, forecastMethod, assumptions, hwParams, arimaParams, decompParams, year1Months)
        : voiceYear1.map(v => Math.round(v * 0.2));

    // Apply recut overrides where they exist; fall back to statistical forecast for
    // channels that have no recut — never zero them out silently.
    const recut = plannerSnapshot.recutVolumesByChannel;
    const applyRecutByIndex = (channel: ChannelKey, base: number[]): number[] => {
      const recutValues = recut?.[channel];
      return base.map((value, index) => {
        const recutValue = Array.isArray(recutValues) ? Number(recutValues[index]) : NaN;
        return Number.isFinite(recutValue) && recutValue >= 0 ? Math.round(recutValue) : value;
      });
    };

    const year1Effective = {
      voice: applyRecutByIndex("voice", voiceYear1),
      chat: applyRecutByIndex("chat", chatYear1),
      email: applyRecutByIndex("email", emailYear1),
      cases: applyRecutByIndex("cases", casesYear1),
    };

    if (!isTwoYearForecast) {
      return year1Effective;
    }

    const voiceYear2 = getCalculatedVolumes([...voiceH, ...year1Effective.voice], forecastMethod, assumptions, hwParams, arimaParams, decompParams, 12);
    const chatYear2 = !chatEnabled ? Array(12).fill(0)
      : getCalculatedVolumes([...chatH, ...year1Effective.chat], forecastMethod, assumptions, hwParams, arimaParams, decompParams, 12);
    const emailYear2 = !emailEnabled ? Array(12).fill(0)
      : getCalculatedVolumes([...emailH, ...year1Effective.email], forecastMethod, assumptions, hwParams, arimaParams, decompParams, 12);
    const casesYear2 = !casesEnabled ? Array(12).fill(0)
      : getCalculatedVolumes([...casesH, ...year1Effective.cases], forecastMethod, assumptions, hwParams, arimaParams, decompParams, 12);

    const combinedForecast = {
      voice: [...voiceYear1, ...voiceYear2],
      chat: [...chatYear1, ...chatYear2],
      email: [...emailYear1, ...emailYear2],
      cases: [...casesYear1, ...casesYear2],
    };

    return {
      voice: applyRecutByIndex("voice", combinedForecast.voice).slice(0, planningMonths),
      chat: applyRecutByIndex("chat", combinedForecast.chat).slice(0, planningMonths),
      email: applyRecutByIndex("email", combinedForecast.email).slice(0, planningMonths),
      cases: applyRecutByIndex("cases", combinedForecast.cases).slice(0, planningMonths),
    };
  }, [plannerSnapshot]);

  // ── Auto volumes from demand snapshot
  const autoBaseVolumePlan = useMemo(() => {
    const forecastStart = plannerSnapshot?.assumptions?.startDate;
    const growthPct = demandAssumptions?.growthRate ?? 0;
    const monday = getMondayOf(new Date(config.planStartDate + "T00:00:00"));
    const blendedScopeChannel = enabledChannels.includes(activeChannel) ? activeChannel : (enabledChannels[0] ?? "voice");

    const getChannelWeeklyVolume = (
      channel: ChannelKey,
      weekStart: Date,
      weekOffset: number,
      series: number[],
    ): { value: number; source: WeeklyVolumeSource } => {
      if (!forecastStart || series.length === 0) {
        const a = demandAssumptions;
        const fallbackValue = channel === "voice"
          ? monthlyToWeekly(a?.voiceVolume ?? 0, growthPct, weekOffset)
          : channel === "chat"
            ? monthlyToWeekly(a?.chatVolume ?? 0, growthPct, weekOffset)
            : channel === "email"
              ? monthlyToWeekly(a?.emailVolume ?? 0, growthPct, weekOffset)
              : monthlyToWeekly(a?.casesVolume ?? 0, growthPct, weekOffset);
        return { value: fallbackValue, source: "flat-fallback" };
      }

      const prefsChannel = isDedicated ? channel : blendedScopeChannel;
      const prefs = intradayPrefsByChannel[prefsChannel];
      const profile = profilesByChannel[prefsChannel];
      const manualWeeklyVolumes = prefs?.dataSource === "manual" ? (prefs.manualWeeklyVolumes ?? []) : [];
      const hasManualPattern = manualWeeklyVolumes.filter((value) => Number.isFinite(value) && value > 0).length >= 4;
      const hasProfileWeights = Array.isArray(profile?.day_weights) && profile.day_weights.some((value) => Number(value) > 0);
      const segments = getWeekMonthSegments(weekStart, forecastStart, series.length);
      if (segments.length === 0) return { value: 0, source: hasManualPattern || hasProfileWeights ? "intraday-allocation" : "default-weekly-distribution" };

      if (hasManualPattern || hasProfileWeights) {
        let intradayValue = 0;
        for (const segment of segments) {
          const monthlyVolume = series[segment.monthOffset] ?? 0;
          if (monthlyVolume <= 0) continue;
          intradayValue += hasProfileWeights
            ? distributeMonthlyToWeekViaDailyDOW(monthlyVolume, segment.year, segment.month, fmtISODate(weekStart), profile?.day_weights ?? [])
            : getManualPatternContribution(monthlyVolume, segment.year, segment.month, weekStart, segment.overlapDays, manualWeeklyVolumes);
        }
        return { value: Math.round(intradayValue), source: "intraday-allocation" };
      }

      let defaultValue = 0;
      for (const segment of segments) {
        const monthlyVolume = series[segment.monthOffset] ?? 0;
        if (monthlyVolume <= 0) continue;
        const daysInMonth = new Date(segment.year, segment.month + 1, 0).getDate();
        defaultValue += monthlyVolume * (segment.overlapDays / daysInMonth);
      }
      return { value: Math.round(defaultValue), source: "default-weekly-distribution" };
    };

    return weeks.map((week) => {
      const weekStart = new Date(monday);
      weekStart.setDate(weekStart.getDate() + week.weekOffset * 7);

      const voice = getChannelWeeklyVolume("voice", weekStart, week.weekOffset, forecastedMonthlyVols?.voice ?? []);
      const chat = getChannelWeeklyVolume("chat", weekStart, week.weekOffset, forecastedMonthlyVols?.chat ?? []);
      const email = getChannelWeeklyVolume("email", weekStart, week.weekOffset, forecastedMonthlyVols?.email ?? []);
      const cases = getChannelWeeklyVolume("cases", weekStart, week.weekOffset, forecastedMonthlyVols?.cases ?? []);

      const source = isDedicated
        ? (activeChannel === "voice" ? voice.source : activeChannel === "chat" ? chat.source : activeChannel === "email" ? email.source : cases.source)
        : (voice.source === "flat-fallback" || chat.source === "flat-fallback" || email.source === "flat-fallback" || cases.source === "flat-fallback")
          ? "flat-fallback"
          : (voice.source === "intraday-allocation" || chat.source === "intraday-allocation" || email.source === "intraday-allocation" || cases.source === "intraday-allocation")
            ? "intraday-allocation"
            : "default-weekly-distribution";

      return {
        volumes: {
          voice: voice.value,
          chat: chat.value,
          email: email.value,
          cases: cases.value,
        },
        source,
      };
    });
  }, [activeChannel, config.planStartDate, demandAssumptions, enabledChannels, forecastedMonthlyVols, intradayPrefsByChannel, isDedicated, plannerSnapshot?.assumptions?.startDate, profilesByChannel, weeks]);

  const autoBaseVolumes = useMemo(() => autoBaseVolumePlan.map((entry) => entry.volumes), [autoBaseVolumePlan]);

  // ── Auto AHTs (from lob_settings, fall back to demand assumptions)
  const defaultAhts = useMemo(() => ({
    voice: Number(lobSettings?.voice_aht ?? demandAssumptions?.aht ?? 300),
    chat: Number(lobSettings?.chat_aht ?? demandAssumptions?.chatAht ?? 450),
    email: Number(lobSettings?.email_aht ?? demandAssumptions?.emailAht ?? 600),
    cases: Number(lobSettings?.email_aht ?? demandAssumptions?.emailAht ?? 600),
  }), [lobSettings, demandAssumptions]);

  // ── Staffing params
  // Priority: Shrinkage Planning page computed % → Demand Assumptions manual entry → 20% default.
  // computedShrinkagePct is derived from absence_items + activity_items in the shrinkage_plans table,
  // matching the totalExcl (holidays excluded) value displayed on the Shrinkage Planning page.
  const defaultShrinkagePct = computedShrinkagePct ?? (demandAssumptions?.shrinkage != null ? Number(demandAssumptions.shrinkage) : 20);

  // Operating hours: LOB settings (hours_of_operation) is the source of truth.
  // Dedicated: active channel schedule. Blended: merged schedule across enabled channels.
  // Falls back to demand assumptions, then hard defaults.
  const lobOpHours = useMemo(() => {
    const hoo = lobSettings?.hours_of_operation;
    if (!hoo) return null;
    if (isDedicated) return hoursFromSchedule(hoo[activeChannel]);
    const merged = mergeChannelSchedules(hoo, enabledChannels);
    return merged ? hoursFromSchedule(merged) : null;
  }, [lobSettings, isDedicated, activeChannel, enabledChannels]);

  const defaultDaysPerWeek = lobOpHours?.daysPerWeek ?? demandAssumptions?.operatingDaysPerWeek ?? 5;
  const defaultOperatingHoursPerDay = lobOpHours?.hoursPerDay ?? demandAssumptions?.operatingHoursPerDay ?? 8;
  // SLA params — LOB settings are authoritative; fall back to demand planner snapshot values
  const snap = plannerSnapshot?.assumptions;
  const defaultFteModel = useMemo<FteModelSnapshot>(() => ({
    operatingHoursPerDay: defaultOperatingHoursPerDay,
    daysPerWeek: fteWorkdaysPerWeek,
    fteHoursPerDay: hoursPerDay,
    shrinkagePct: defaultShrinkagePct,
    voiceAht: defaultAhts.voice,
    chatAht: defaultAhts.chat,
    emailAht: defaultAhts.email,
    casesAht: defaultAhts.cases,
    voiceSlaTarget: Number(lobSettings?.voice_sla_target ?? snap?.voiceSlaTarget ?? 80),
    voiceSlaSec: Number(lobSettings?.voice_sla_seconds ?? snap?.voiceSlaAnswerSeconds ?? 20),
    chatSlaTarget: Number(lobSettings?.chat_sla_target ?? snap?.chatSlaTarget ?? 80),
    chatSlaSec: Number(lobSettings?.chat_sla_seconds ?? snap?.chatSlaAnswerSeconds ?? 30),
    emailSlaTarget: Number(lobSettings?.email_sla_target ?? snap?.emailSlaTarget ?? 90),
    emailSlaSec: Number(lobSettings?.email_sla_seconds ?? snap?.emailSlaAnswerSeconds ?? 14400),
    emailOccupancy: Number(lobSettings?.email_occupancy ?? snap?.occupancy ?? 85) || 85,
    chatConcurrency: Math.max(1, Number(lobSettings?.chat_concurrency ?? snap?.chatConcurrency ?? 2)),
    taskSwitchMultiplier: Number(lobSettings?.task_switch_multiplier ?? snap?.taskSwitchMultiplier ?? 1.05) || 1.05,
  }), [defaultOperatingHoursPerDay, fteWorkdaysPerWeek, hoursPerDay, defaultShrinkagePct, defaultAhts, lobSettings, snap]);

  const fteModel = fteModelOverride ?? defaultFteModel;
  const autoAhts = useMemo(() => ({
    voice: fteModel.voiceAht,
    chat: fteModel.chatAht,
    email: fteModel.emailAht,
    cases: fteModel.casesAht,
  }), [fteModel]);
  const shrinkagePct = fteModel.shrinkagePct;
  const daysPerWeek = defaultDaysPerWeek;
  const effectiveFteWorkdaysPerWeek = fteModel.daysPerWeek;
  const operatingHoursPerDay = fteModel.operatingHoursPerDay;
  const effectiveFteHoursPerDay = fteModel.fteHoursPerDay;
  const slaVoiceTarget = fteModel.voiceSlaTarget;
  const slaVoiceSec = fteModel.voiceSlaSec;
  const slaChatTarget = fteModel.chatSlaTarget;
  const slaChatSec = fteModel.chatSlaSec;
  const slaEmailTarget = fteModel.emailSlaTarget;
  const slaEmailSec = fteModel.emailSlaSec;
  const emailOccupancy = fteModel.emailOccupancy || 85;
  const chatConcurrency = Math.max(1, fteModel.chatConcurrency);
  const taskSwitchMultiplier = fteModel.taskSwitchMultiplier || 1.05;
  // ── Full computed calculations per week
  const weekCalcs = useMemo<WeekCalc[]>(() => {
    let projHC = config.startingHc;
    const { rampTrainingWeeks, rampNestingWeeks, rampNestingPct, trainingGradRate } = config;

    return weeks.map((wk, w) => {
      const inp = weeklyInputs[w] ?? {};
      const auto = autoBaseVolumes[w] ?? { voice: 0, chat: 0, email: 0, cases: 0 };

      // Effective volumes (override or auto)
      const effVolVoice = inp.volVoice != null ? inp.volVoice : auto.voice;
      const effVolChat = inp.volChat != null ? inp.volChat : auto.chat;
      const effVolEmail = inp.volEmail != null ? inp.volEmail : auto.email;
      const effVolCases = inp.volCases != null ? inp.volCases : auto.cases;

      // Effective AHTs
      const effAhtVoice = inp.ahtVoice != null ? inp.ahtVoice : autoAhts.voice;
      const effAhtChat = inp.ahtChat != null ? inp.ahtChat : autoAhts.chat;
      const effAhtEmail = inp.ahtEmail != null ? inp.ahtEmail : autoAhts.email;
      const effAhtCases = inp.ahtCases != null ? inp.ahtCases : autoAhts.cases;

      const weekStart = getWeekStartDate(config.planStartDate, w);
      const fallbackSchedule = buildAverageSchedule(daysPerWeek, operatingHoursPerDay);
      const channelSchedule = (channel: ChannelKey) => lobSettings?.hours_of_operation?.[channel] ?? fallbackSchedule;
      const distributed = {
        voice: buildDistributedVolumeGrid(effVolVoice, weekStart, channelSchedule("voice"), intradayRecordsByChannel.voice, profilesByChannel.voice),
        chat: buildDistributedVolumeGrid(effVolChat, weekStart, channelSchedule("chat"), intradayRecordsByChannel.chat, profilesByChannel.chat),
        email: buildDistributedVolumeGrid(effVolEmail, weekStart, channelSchedule("email"), intradayRecordsByChannel.email, profilesByChannel.email),
        cases: buildDistributedVolumeGrid(effVolCases, weekStart, channelSchedule("cases"), intradayRecordsByChannel.cases, profilesByChannel.cases),
      };

      // Required FTE via Erlang C — occupancy is an OUTPUT, SLA drives the agent count.
      let requiredFTE = 0;
      let flatRequiredFTE = 0;
      let erlangOccupancy = 0;
      let reqRawAgents: number | null = null;
      let reqAfterShrinkFte: number | null = null;
      let reqCoverageRatio: number | null = null;
      let distributionSource: DistributionSource = "default-fallback-distribution";
      let requiredStaffedHours = 0;
      if (isDedicated) {
        const vol = activeChannel === "voice" ? effVolVoice : activeChannel === "chat" ? effVolChat : activeChannel === "cases" ? effVolCases : effVolEmail;
        const aht = activeChannel === "voice" ? effAhtVoice : activeChannel === "chat" ? effAhtChat : activeChannel === "cases" ? effAhtCases : effAhtEmail;
        const target = activeChannel === "voice" ? slaVoiceTarget : activeChannel === "chat" ? slaChatTarget : slaEmailTarget;
        const sec    = activeChannel === "voice" ? slaVoiceSec    : activeChannel === "chat" ? slaChatSec    : slaEmailSec;
        const conc   = activeChannel === "chat" ? chatConcurrency : 1;
        // cases uses the email (backlog/deferred) model
        const modelChannel: "voice" | "chat" | "email" = activeChannel === "voice" ? "voice" : activeChannel === "chat" ? "chat" : "email";
        const r = calcWeeklyErlangFTE(vol, aht, daysPerWeek, operatingHoursPerDay, effectiveFteHoursPerDay, target, sec, shrinkagePct, modelChannel, conc, emailOccupancy);
        const intervalized = calcIntervalizedDedicatedFTE(
          distributed[activeChannel].grid, aht, effectiveFteHoursPerDay, effectiveFteWorkdaysPerWeek,
          shrinkagePct, modelChannel, target, sec, conc, emailOccupancy,
        );
        flatRequiredFTE = r.fte;
        requiredFTE = intervalized.fte;
        if (distributed[activeChannel].source === "configuration-needed" && vol > 0) requiredFTE = r.fte;
        erlangOccupancy = intervalized.occupancy || r.occupancy;
        reqRawAgents = intervalized.rawAgentsAvg;
        reqAfterShrinkFte = intervalized.fteRaw;
        reqCoverageRatio = r.coverageRatio;
        distributionSource = distributed[activeChannel].source;
        requiredStaffedHours = intervalized.staffedHours;
      } else {
        // Blended: dominant real-time channel sets the Erlang C base; idle capacity
        // absorbs the next channel, then email/cases async.
        const blendedEmailVoiceVol = enabledChannels.includes("email") ? effVolEmail : 0;
        const blendedEmailCasesVol = enabledChannels.includes("cases") ? effVolCases : 0;
        const blendedEmailVol = blendedEmailVoiceVol + blendedEmailCasesVol;
        // Weight-average AHT across email+cases so a cases AHT override is respected
        const blendedEmailAht = blendedEmailVol > 0
          ? (blendedEmailVoiceVol * effAhtEmail + blendedEmailCasesVol * effAhtCases) / blendedEmailVol
          : effAhtEmail;
        const r = calcWeeklyBlendedFTE(
          enabledChannels.includes("voice") ? effVolVoice : 0, effAhtVoice,
          enabledChannels.includes("chat") ? effVolChat : 0, effAhtChat,
          blendedEmailVol, blendedEmailAht,
          daysPerWeek, operatingHoursPerDay, effectiveFteHoursPerDay,
          slaVoiceTarget, slaVoiceSec, slaChatTarget, slaChatSec, emailOccupancy, shrinkagePct, chatConcurrency, taskSwitchMultiplier,
        );
        const blendedEmailGrid = emptyIntervalGrid();
        for (let d = 0; d < 7; d++) {
          for (let i = 0; i < CAPACITY_INTERVALS_PER_DAY; i++) {
            blendedEmailGrid[d][i] =
              (enabledChannels.includes("email") ? distributed.email.grid[d]?.[i] ?? 0 : 0) +
              (enabledChannels.includes("cases") ? distributed.cases.grid[d]?.[i] ?? 0 : 0);
          }
        }
        const intervalized = calcIntervalizedBlendedFTE(
          enabledChannels.includes("voice") ? distributed.voice.grid : emptyIntervalGrid(), effAhtVoice,
          enabledChannels.includes("chat") ? distributed.chat.grid : emptyIntervalGrid(), effAhtChat,
          blendedEmailGrid, blendedEmailAht,
          effectiveFteHoursPerDay, effectiveFteWorkdaysPerWeek, shrinkagePct,
          slaVoiceTarget, slaVoiceSec, slaChatTarget, slaChatSec,
          emailOccupancy, chatConcurrency, taskSwitchMultiplier,
        );
        flatRequiredFTE = r.fte;
        requiredFTE = intervalized.fte;
        if (bestDistributionSource(enabledChannels.map(ch => distributed[ch].source)) === "configuration-needed" && blendedEmailVol + (enabledChannels.includes("voice") ? effVolVoice : 0) + (enabledChannels.includes("chat") ? effVolChat : 0) > 0) requiredFTE = r.fte;
        erlangOccupancy = intervalized.occupancy || r.occupancy;
        reqRawAgents = intervalized.rawAgentsAvg;
        reqAfterShrinkFte = intervalized.fteRaw;
        reqCoverageRatio = r.coverageRatio;
        distributionSource = bestDistributionSource(enabledChannels.map(ch => distributed[ch].source));
        requiredStaffedHours = intervalized.staffedHours;
      }

      // Attrition decay
      const attritionDecay = getWeeklyAttritionDecay(projHC, w, config);

      // Effective new HC delta from ramp (all cohorts)
      let effectiveNewHc = 0;
      for (let h = 0; h <= w; h++) {
        const cohort = (weeklyInputs[h]?.plannedHires ?? 0) * (trainingGradRate / 100);
        if (cohort <= 0) continue;
        const ageThis = w - h;
        const agePrev = w - 1 - h;
        const pctThis = calcRampPct(ageThis, rampTrainingWeeks, rampNestingWeeks, rampNestingPct);
        const pctPrev = agePrev >= 0 ? calcRampPct(agePrev, rampTrainingWeeks, rampNestingWeeks, rampNestingPct) : 0;
        effectiveNewHc += cohort * (pctThis - pctPrev);
      }
      effectiveNewHc = roundTo(effectiveNewHc, 1);

      const plannedHires = inp.plannedHires ?? 0;
      const knownExits = inp.knownExits ?? 0;
      const transfersOut = inp.transfersOut ?? 0;
      const promotionsOut = inp.promotionsOut ?? 0;
      const actualHc = inp.actualHc ?? null;
      const actualAttrition = inp.actualAttrition ?? null;

      const modelProjHC = Math.max(0, roundTo(projHC + effectiveNewHc - attritionDecay - knownExits - transfersOut - promotionsOut, 1));
      projHC = modelProjHC;

      // Re-anchor for the NEXT week only — only when actual is a meaningful positive value.
      if (actualHc != null && actualHc > 0) projHC = actualHc;

      const gapSurplus = roundTo(modelProjHC - requiredFTE, 1);
      const actualGapSurplus = actualHc != null ? roundTo(actualHc - requiredFTE, 1) : null;
      const billableGapSurplus = config.billableFte > 0 ? roundTo(modelProjHC - config.billableFte, 1) : null;

      // Helper: compute achieved SLA% from a given FTE headcount (Erlang C)
      function achievedSLFor(hc: number): number | null {
        if (isDedicated) {
          if (activeChannel === "email" || activeChannel === "cases") return null;
          const vol = activeChannel === "voice" ? effVolVoice : effVolChat;
          const aht = activeChannel === "voice" ? effAhtVoice : effAhtChat;
          const sec = activeChannel === "voice" ? slaVoiceSec : slaChatSec;
          const conc = activeChannel === "chat" ? chatConcurrency : 1;
          return computeAchievedSLFromFTE(vol, aht, hc, daysPerWeek, operatingHoursPerDay, effectiveFteHoursPerDay, sec, shrinkagePct, activeChannel, conc, 0);
        } else {
          // Blended: reserve enough real-time capacity for the other live channel
          // before measuring each channel's SLA. This avoids the invalid shortcut
          // of giving both voice and chat the full blended pool simultaneously.
          const shrinkFactor = Math.max(0.01, 1 - shrinkagePct / 100);
          const coverageRatio = effectiveFteHoursPerDay > 0 ? operatingHoursPerDay / effectiveFteHoursPerDay : 1;
          const floorAgents = (hc / coverageRatio) * shrinkFactor;
          const intervalCount = operatingHoursPerDay * 2;
          const voiceCPI = intervalCount > 0 ? (effVolVoice / daysPerWeek) / intervalCount : 0;
          const chatCPI = intervalCount > 0 ? (effVolChat / daysPerWeek) / intervalCount : 0;
          const voiceRaw = enabledChannels.includes("voice") && voiceCPI > 0 && effAhtVoice > 0
            ? computeIntervalFTE(voiceCPI, 30, effAhtVoice, slaVoiceTarget, slaVoiceSec, 85, 0, "voice", 1, 0).rawAgents
            : 0;
          const chatRaw = enabledChannels.includes("chat") && chatCPI > 0 && effAhtChat > 0
            ? computeIntervalFTE(chatCPI, 30, effAhtChat, slaChatTarget, slaChatSec, 85, 0, "chat", chatConcurrency, 0).rawAgents
            : 0;

          let weightedSL = 0, totalVol = 0;
          if (enabledChannels.includes("voice") && effVolVoice > 0) {
            const voiceAvailableAgents = Math.max(0, floorAgents - chatRaw);
            const voiceEquivalentFTE = (voiceAvailableAgents / shrinkFactor) * coverageRatio;
            const sl = computeAchievedSLFromFTE(effVolVoice, effAhtVoice, voiceEquivalentFTE, daysPerWeek, operatingHoursPerDay, effectiveFteHoursPerDay, slaVoiceSec, shrinkagePct, "voice", 1, 0);
            if (sl != null) { weightedSL += sl * effVolVoice; totalVol += effVolVoice; }
          }
          if (enabledChannels.includes("chat") && effVolChat > 0) {
            const chatAvailableAgents = Math.max(0, floorAgents - voiceRaw);
            const chatEquivalentFTE = (chatAvailableAgents / shrinkFactor) * coverageRatio;
            const sl = computeAchievedSLFromFTE(effVolChat, effAhtChat, chatEquivalentFTE, daysPerWeek, operatingHoursPerDay, effectiveFteHoursPerDay, slaChatSec, shrinkagePct, "chat", chatConcurrency, 0);
            if (sl != null) { weightedSL += sl * effVolChat; totalVol += effVolChat; }
          }
          return totalVol > 0 ? +(weightedSL / totalVol).toFixed(1) : null;
        }
      }

      // Projected SLA — always computed from model projected HC
      const achievedSLAProj = modelProjHC > 0 ? achievedSLFor(modelProjHC) : null;

      // Achieved SLA at actual HC — only when actual HC is entered
      const achievedSLAActual = actualHc != null ? achievedSLFor(actualHc) : null;

      return {
        ...wk,
        autoVolVoice: auto.voice, autoVolChat: auto.chat, autoVolEmail: auto.email, autoVolCases: auto.cases,
        effVolVoice, effVolChat, effVolEmail, effVolCases, effVolTotal: effVolVoice + effVolChat + effVolEmail + effVolCases,
        autoAhtVoice: autoAhts.voice, autoAhtChat: autoAhts.chat, autoAhtEmail: autoAhts.email, autoAhtCases: autoAhts.cases,
        effAhtVoice, effAhtChat, effAhtEmail, effAhtCases,
        projOccupancyPct: erlangOccupancy, projShrinkagePct: shrinkagePct,
        reqRawAgents, reqAfterShrinkFte, reqCoverageRatio, flatRequiredFTE, distributionSource, weeklyVolumeSource: autoBaseVolumePlan[w]?.source ?? "flat-fallback", requiredStaffedHours,
        requiredFTE, plannedHires, effectiveNewHc, attritionDecay,
        knownExits, transfersOut, promotionsOut, projectedHc: modelProjHC, actualHc, actualAttrition,
        gapSurplus, actualGapSurplus, billableGapSurplus, achievedSLAProj, achievedSLAActual,
      };
    });
  }, [weeks, weeklyInputs, autoBaseVolumes, autoBaseVolumePlan, autoAhts, config, isDedicated, activeChannel, effectiveFteHoursPerDay,
      effectiveFteWorkdaysPerWeek, shrinkagePct, daysPerWeek, operatingHoursPerDay, enabledChannels,
      slaVoiceTarget, slaVoiceSec, slaChatTarget, slaChatSec, slaEmailTarget, slaEmailSec,
      emailOccupancy, chatConcurrency, taskSwitchMultiplier, lobSettings, intradayRecordsByChannel, profilesByChannel]);

  const volumeOverrideMasking = useMemo(() => {
    const fieldByChannel: Record<ChannelKey, keyof WeekInput> = {
      voice: "volVoice",
      chat: "volChat",
      email: "volEmail",
      cases: "volCases",
    };
    const autoByChannel: Record<ChannelKey, "voice" | "chat" | "email" | "cases"> = {
      voice: "voice",
      chat: "chat",
      email: "email",
      cases: "cases",
    };
    const channels = isDedicated ? [activeChannel] : enabledChannels;
    let overrideCount = 0;
    let zeroMaskCount = 0;
    for (const wk of weeks) {
      const input = weeklyInputs[wk.weekOffset];
      const auto = autoBaseVolumes[wk.weekOffset];
      if (!input || !auto) continue;
      for (const channel of channels) {
        const field = fieldByChannel[channel];
        const value = input[field];
        const autoValue = auto[autoByChannel[channel]];
        if (value == null || autoValue <= 0 || value === autoValue) continue;
        overrideCount += 1;
        if (value === 0) zeroMaskCount += 1;
      }
    }
    return { overrideCount, zeroMaskCount };
  }, [weeklyInputs, autoBaseVolumes, weeks, isDedicated, activeChannel, enabledChannels]);

  // ── What-if comparison — re-project HC for each what-if using its configSnapshot
  const dedicatedRequiredFteSummary = useMemo<RequiredFteChannelSummary[]>(() => {
    if (!isDedicated) return [];

    return enabledChannels.map(channel => {
      const channelWeeks = weeks.map((_, w) => {
        const auto = autoBaseVolumes[w] ?? { voice: 0, chat: 0, email: 0, cases: 0 };
        const channelInputs = channel === activeChannel
          ? weeklyInputs
          : (dedicatedInputsByChannel[channel] ?? {});
        const inp = channelInputs[w] ?? {};

        const volume = channel === "voice" ? (inp.volVoice ?? auto.voice)
          : channel === "chat" ? (inp.volChat ?? auto.chat)
          : channel === "cases" ? (inp.volCases ?? auto.cases)
          : (inp.volEmail ?? auto.email);
        const aht = channel === "voice" ? (inp.ahtVoice ?? autoAhts.voice)
          : channel === "chat" ? (inp.ahtChat ?? autoAhts.chat)
          : channel === "cases" ? (inp.ahtCases ?? autoAhts.cases)
          : (inp.ahtEmail ?? autoAhts.email);
        const target = channel === "voice" ? slaVoiceTarget : channel === "chat" ? slaChatTarget : slaEmailTarget;
        const sec = channel === "voice" ? slaVoiceSec : channel === "chat" ? slaChatSec : slaEmailSec;
        const conc = channel === "chat" ? chatConcurrency : 1;
        const modelChannel: "voice" | "chat" | "email" = channel === "voice" ? "voice" : channel === "chat" ? "chat" : "email";
        const channelHours = fteModelOverride ? null : hoursFromSchedule(lobSettings?.hours_of_operation?.[channel]);
        const channelDaysPerWeek = channelHours?.daysPerWeek ?? daysPerWeek;
        const channelOperatingHours = channelHours?.hoursPerDay ?? operatingHoursPerDay;
        const flatRequired = calcWeeklyErlangFTE(
          volume, aht, channelDaysPerWeek, channelOperatingHours, effectiveFteHoursPerDay,
          target, sec, shrinkagePct, modelChannel, conc, emailOccupancy,
        );
        const weekStart = getWeekStartDate(config.planStartDate, w);
        const schedule = lobSettings?.hours_of_operation?.[channel] ?? buildAverageSchedule(channelDaysPerWeek, channelOperatingHours);
        const distributed = buildDistributedVolumeGrid(volume, weekStart, schedule, intradayRecordsByChannel[channel], profilesByChannel[channel]);
        const required = calcIntervalizedDedicatedFTE(
          distributed.grid, aht, effectiveFteHoursPerDay, effectiveFteWorkdaysPerWeek,
          shrinkagePct, modelChannel, target, sec, conc, emailOccupancy,
        );
        const fte = distributed.source === "configuration-needed" && volume > 0 ? flatRequired.fte : required.fte;

        return {
          fte,
          volume,
          aht,
          occupancy: required.occupancy || flatRequired.occupancy,
          daysPerWeek: channelDaysPerWeek,
          operatingHoursPerDay: channelOperatingHours,
          distributionSource: distributed.source,
          flatFte: flatRequired.fte,
          staffedHours: required.staffedHours,
        };
      });

      const current = channelWeeks[0] ?? { fte: 0, volume: 0, aht: autoAhts[channel], occupancy: 0, daysPerWeek, operatingHoursPerDay, distributionSource: "default-fallback-distribution" as DistributionSource, flatFte: 0, staffedHours: 0 };
      return {
        channel,
        currentFte: current.fte,
        peakFte: Math.max(0, ...channelWeeks.map(w => w.fte)),
        currentVolume: current.volume,
        aht: current.aht,
        slaTarget: channel === "voice" ? slaVoiceTarget : channel === "chat" ? slaChatTarget : slaEmailTarget,
        slaSec: channel === "voice" ? slaVoiceSec : channel === "chat" ? slaChatSec : slaEmailSec,
        occupancy: current.occupancy,
        daysPerWeek: current.daysPerWeek,
        operatingHoursPerDay: current.operatingHoursPerDay,
        fteHoursPerDay: effectiveFteHoursPerDay,
        fteWorkdaysPerWeek: effectiveFteWorkdaysPerWeek,
        shrinkagePct,
        distributionSource: current.distributionSource,
        currentFlatFte: current.flatFte,
        currentStaffedHours: current.staffedHours,
      };
    });
  }, [isDedicated, enabledChannels, weeks, autoBaseVolumes, activeChannel, weeklyInputs, dedicatedInputsByChannel, autoAhts,
      slaVoiceTarget, slaVoiceSec, slaChatTarget, slaChatSec, slaEmailTarget, slaEmailSec,
      chatConcurrency, fteModelOverride, lobSettings, daysPerWeek, operatingHoursPerDay,
      effectiveFteHoursPerDay, effectiveFteWorkdaysPerWeek, shrinkagePct, emailOccupancy, config.planStartDate,
      intradayRecordsByChannel, profilesByChannel]);

  const dedicatedRequiredFteTotal = useMemo(() => ({
    current: roundTo(dedicatedRequiredFteSummary.reduce((sum, item) => sum + item.currentFte, 0), 1),
    peak: roundTo(dedicatedRequiredFteSummary.reduce((sum, item) => sum + item.peakFte, 0), 1),
  }), [dedicatedRequiredFteSummary]);

  const whatIfComparisons = useMemo(() => {
    if (Object.keys(whatIfs).length < 2) return null;
    return Object.values(whatIfs).map(wif => {
      const c = normalizePlanConfig(wif.configSnapshot);
      let hc = c.startingHc;
      const weeklyHC = weeks.map((_, w) => {
        const inp = weeklyInputs[w] ?? {};
        const attrDecay = getWeeklyAttritionDecay(hc, w, c);
        let effNew = 0;
        for (let h = 0; h <= w; h++) {
          const cohort = (weeklyInputs[h]?.plannedHires ?? 0) * (c.trainingGradRate / 100);
          if (cohort <= 0) continue;
          const pT = calcRampPct(w - h, c.rampTrainingWeeks, c.rampNestingWeeks, c.rampNestingPct);
          const pP = w - 1 - h >= 0
            ? calcRampPct(w - 1 - h, c.rampTrainingWeeks, c.rampNestingWeeks, c.rampNestingPct)
            : 0;
          effNew += cohort * (pT - pP);
        }
        hc = Math.max(0, hc - attrDecay + roundTo(effNew, 1)
          - (inp.knownExits ?? 0) - (inp.transfersOut ?? 0) - (inp.promotionsOut ?? 0));
        return roundTo(hc, 1);
      });
      return { id: wif.id, name: wif.name, is_committed: wif.is_committed ?? false, weeklyHC };
    });
  }, [whatIfs, weeks, weeklyInputs]);

  // ── Attrition summary
  const attritionSummary = useMemo(() => {
    const totalExits = weekCalcs.reduce((s, w) => s + w.attritionDecay + w.knownExits + w.transfersOut + w.promotionsOut, 0);
    const annualizedPct = config.attritionRateMonthly * 12;
    const annualizedProjectedAttritions = getMonthlyFixedAttritionCount(config) * 12;
    const totalActualAttrition = weekCalcs.reduce((s, w) => s + (w.actualAttrition ?? 0), 0);
    return { totalExits: roundTo(totalExits), annualizedPct, annualizedProjectedAttritions, totalActualAttrition };
  }, [weekCalcs, config]);

  // ── Hiring action summary
  // Focuses on the *next* actionable hiring decision rather than a cumulative horizon total.
  // hiresNeeded  = magnitude of the first upcoming deficit (residual after planned hires).
  // deficitWeek  = the first week projected HC falls short.
  // hireByWeek   = deficitWeek − training+nesting lead time — latest safe start date for recruiting.
  // hireByPassed = lead time has already expired; recruiting should have started already.
  const hiringNeed = useMemo(() => {
    const empty = {
      peakRequired: 0,
      // Required FTE action
      reqHiresNeeded: 0, reqDeficitWeek: null as WeekCalc | null,
      reqHireByWeek: null as WeekCalc | null, reqHireByPassed: false,
      // Billable FTE action
      billHiresNeeded: 0, billDeficitWeek: null as WeekCalc | null,
      billHireByWeek: null as WeekCalc | null, billHireByPassed: false,
    };
    if (weekCalcs.length === 0) return empty;
    const leadTime = config.rampTrainingWeeks + config.rampNestingWeeks;
    const peakRequired = Math.ceil(Math.max(...weekCalcs.map(w => w.requiredFTE)));

    // Required FTE: first deficit week
    const reqDeficitIdx = weekCalcs.findIndex(w => w.gapSurplus < 0);
    const reqDeficitWeek = reqDeficitIdx >= 0 ? weekCalcs[reqDeficitIdx] : null;
    const reqHiresNeeded = reqDeficitWeek ? Math.ceil(Math.abs(reqDeficitWeek.gapSurplus)) : 0;
    const reqHireByPassed = reqDeficitIdx >= 0 && reqDeficitIdx - leadTime <= 0;
    const reqHireByWeek = reqDeficitIdx >= 0
      ? weekCalcs[Math.max(0, reqDeficitIdx - leadTime)] ?? null
      : null;

    // Billable FTE: first deficit week
    const billDeficitIdx = config.billableFte > 0
      ? weekCalcs.findIndex(w => (w.billableGapSurplus ?? 0) < 0)
      : -1;
    const billDeficitWeek = billDeficitIdx >= 0 ? weekCalcs[billDeficitIdx] : null;
    const billHiresNeeded = billDeficitWeek ? Math.ceil(Math.abs(billDeficitWeek.billableGapSurplus ?? 0)) : 0;
    const billHireByPassed = billDeficitIdx >= 0 && billDeficitIdx - leadTime <= 0;
    const billHireByWeek = billDeficitIdx >= 0
      ? weekCalcs[Math.max(0, billDeficitIdx - leadTime)] ?? null
      : null;

    return { peakRequired, reqHiresNeeded, reqDeficitWeek, reqHireByWeek, reqHireByPassed, billHiresNeeded, billDeficitWeek, billHireByWeek, billHireByPassed };
  }, [weekCalcs, config.billableFte, config.rampTrainingWeeks, config.rampNestingWeeks]);

  // ── Bottom-line summary metrics for the hero strip
  const currentGap = weekCalcs[0]?.gapSurplus ?? 0;
  const currentBillableGap = weekCalcs[0]?.billableGapSurplus ?? null;
  const maxAbsGap = useMemo(
    () => Math.max(1, ...weekCalcs.map(w => Math.abs(w.gapSurplus))),
    [weekCalcs],
  );
  const maxAbsBillableGap = useMemo(
    () => Math.max(1, ...weekCalcs.map(w => Math.abs(w.billableGapSurplus ?? 0))),
    [weekCalcs],
  );

  // ── Chart data: Required FTE vs Projected HC vs Actual HC
  const chartData = useMemo(() => weekCalcs.map(wk => ({
    label: wk.label,
    required: Math.ceil(wk.requiredFTE),
    projected: roundTo(wk.projectedHc, 1),
    actual: wk.actualHc,
    billable: config.billableFte > 0 ? config.billableFte : undefined,
  })), [weekCalcs, config.billableFte]);

  // ── LOB switch resets channel tab
  function handleLobSwitch(lobId: number) {
    const lob = lobs.find(l => l.id === lobId);
    if (!lob) return;
    dataLoadedFor.current = null;
    setActiveLob(lob);
    setActiveChannel("voice");
  }

  function handleChannelSwitch(ch: ChannelKey) {
    dataLoadedFor.current = null;
    setActiveChannel(ch);
  }

  const colSpan = weeks.length + 1;

  // ── CSV export
  function exportToCSV() {
    const lobLabel = isDedicated ? `${activeLob?.lob_name} — ${CHANNEL_LABELS[activeChannel]}` : activeLob?.lob_name ?? "Capacity Plan";
    const weekHeaders = weekCalcs.map(wk => `${wk.label} (${wk.dateLabel})`);
    const header = ["Metric", ...weekHeaders];

    function row(label: string, values: (string | number | null | undefined)[]): string[] {
      return [label, ...values.map(v => (v == null ? "" : String(v)))];
    }

    const rows: string[][] = [header];

    // ── Demand
    rows.push(["--- DEMAND ---", ...weekCalcs.map(() => "")]);
    if (!isDedicated ? enabledChannels.includes("voice") : activeChannel === "voice")
      rows.push(row("Proj. Volume — Voice", weekCalcs.map(wk => Math.round(wk.effVolVoice))));
    if (!isDedicated ? enabledChannels.includes("chat") : activeChannel === "chat")
      rows.push(row("Proj. Volume — Chat", weekCalcs.map(wk => Math.round(wk.effVolChat))));
    if (!isDedicated ? enabledChannels.includes("email") : activeChannel === "email")
      rows.push(row("Proj. Volume — Email", weekCalcs.map(wk => Math.round(wk.effVolEmail))));
    if (!isDedicated ? enabledChannels.includes("cases") : activeChannel === "cases")
      rows.push(row("Proj. Volume — Cases", weekCalcs.map(wk => Math.round(wk.effVolCases))));
    if (!isDedicated ? enabledChannels.includes("voice") : activeChannel === "voice")
      rows.push(row("AHT — Voice (s)", weekCalcs.map(wk => wk.effAhtVoice)));
    if (!isDedicated ? enabledChannels.includes("chat") : activeChannel === "chat")
      rows.push(row("AHT — Chat (s)", weekCalcs.map(wk => wk.effAhtChat)));
    if (!isDedicated ? enabledChannels.includes("email") : activeChannel === "email")
      rows.push(row("AHT — Email (s)", weekCalcs.map(wk => wk.effAhtEmail)));
    if (!isDedicated ? enabledChannels.includes("cases") : activeChannel === "cases")
      rows.push(row("AHT — Cases (s)", weekCalcs.map(wk => wk.effAhtCases)));

    // ── Staffing Requirements
    rows.push(["--- STAFFING REQUIREMENTS ---", ...weekCalcs.map(() => "")]);
    rows.push(row("Weekly Required FTE Estimate", weekCalcs.map(wk => roundTo(wk.requiredFTE, 1))));
    rows.push(row("Previous Flat Estimate Comparison", weekCalcs.map(wk => roundTo(wk.flatRequiredFTE, 1))));
    rows.push(row("Weekly Volume Source", weekCalcs.map(wk => weeklyVolumeSourceLabel(wk.weeklyVolumeSource))));
    rows.push(row("Distribution Source", weekCalcs.map(wk => distributionSourceLabel(wk.distributionSource))));
    rows.push(row("Required Staffed Hours", weekCalcs.map(wk => roundTo(wk.requiredStaffedHours, 1))));
    rows.push(row("Proj. Occupancy %", weekCalcs.map(wk => roundTo(wk.projOccupancyPct, 1))));
    rows.push(row("Proj. Shrinkage %", weekCalcs.map(wk => roundTo(wk.projShrinkagePct, 1))));

    // ── Headcount Plan
    rows.push(["--- HEADCOUNT PLAN ---", ...weekCalcs.map(() => "")]);
    rows.push(row("Attrition Model", weekCalcs.map(() => config.attritionModel === "fixed_count" ? "Fixed attrition count" : "Monthly rate %")));
    if (config.attritionModel === "fixed_count") {
      rows.push(row("Equivalent Attritions / Month", weekCalcs.map(() => roundTo(getMonthlyFixedAttritionCount(config), 2))));
    } else {
      rows.push(row("Attrition Rate % / Month", weekCalcs.map(() => config.attritionRateMonthly)));
    }
    rows.push(row("Planned Hires", weekCalcs.map(wk => wk.plannedHires)));
    rows.push(row("Effective New HC", weekCalcs.map(wk => roundTo(wk.effectiveNewHc, 1))));
    rows.push(row("Attrition Decay", weekCalcs.map(wk => roundTo(wk.attritionDecay, 2))));
    rows.push(row("Known Exits", weekCalcs.map(wk => wk.knownExits)));
    rows.push(row("Projected HC", weekCalcs.map(wk => roundTo(wk.projectedHc, 1))));
    if (billableActive)
      rows.push(row("Billable FTE", weekCalcs.map(() => config.billableFte)));
    rows.push(row("Actual HC", weekCalcs.map(wk => wk.actualHc)));
    rows.push(row("Actual Attrition", weekCalcs.map(wk => wk.actualAttrition)));

    // ── Performance Insights
    rows.push(["--- PERFORMANCE INSIGHTS ---", ...weekCalcs.map(() => "")]);
    rows.push(row("Proj. Gap / Surplus (vs Required)", weekCalcs.map(wk => roundTo(wk.gapSurplus, 1))));
    if (billableActive)
      rows.push(row("Proj. Gap / Surplus (vs Billable)", weekCalcs.map(wk => wk.billableGapSurplus != null ? roundTo(wk.billableGapSurplus, 1) : "")));
    rows.push(row("Actual Gap / Surplus", weekCalcs.map(wk => wk.actualGapSurplus != null ? roundTo(wk.actualGapSurplus, 1) : "")));
    rows.push(row("Projected SLA % (Proj. HC)", weekCalcs.map(wk => wk.achievedSLAProj != null ? roundTo(wk.achievedSLAProj, 1) : "")));
    rows.push(row("Achieved SLA % (Actual HC)", weekCalcs.map(wk => wk.achievedSLAActual != null ? roundTo(wk.achievedSLAActual, 1) : "")));

    const csv = rows.map(r => r.map(cell => {
      const s = String(cell);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `capacity-plan_${lobLabel.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Pixel offsets for frozen thead rows — each row is ~33px tall, week-date header ~40px.
  const billableActive = config.billableFte > 0;

  const { setPageData } = useWFMPageData();
  useEffect(() => {
    setPageData({
      channel: activeChannel,
      planStartDate: config.planStartDate,
      horizonWeeks: config.horizonWeeks,
      shrinkagePct,
      hoursPerDay: effectiveFteHoursPerDay,
      fteWorkdaysPerWeek: effectiveFteWorkdaysPerWeek,
      assumptions: demandAssumptions ? {
        aht: demandAssumptions.aht,
        chatAht: demandAssumptions.chatAht,
        emailAht: demandAssumptions.emailAht,
        chatConcurrency: demandAssumptions.chatConcurrency,
        voiceSlaTarget: demandAssumptions.voiceSlaTarget,
        voiceSlaAnswerSeconds: demandAssumptions.voiceSlaAnswerSeconds,
        chatSlaTarget: demandAssumptions.chatSlaTarget,
        emailSlaTarget: demandAssumptions.emailSlaTarget,
        occupancy: demandAssumptions.occupancy,
        operatingHoursPerDay: demandAssumptions.operatingHoursPerDay,
        operatingDaysPerWeek: demandAssumptions.operatingDaysPerWeek,
      } : null,
      hiringNeed,
      attritionSummary,
      weekSummary: weekCalcs.slice(0, 12).map((w) => ({
        label: w.label,
        requiredFTE: w.requiredFTE,
        projectedHC: w.projectedHc,
        gap: w.gapSurplus,
      })),
    });
    return () => setPageData(null);
  }, [activeChannel, config, shrinkagePct, effectiveFteHoursPerDay, effectiveFteWorkdaysPerWeek, demandAssumptions, hiringNeed, attritionSummary, weekCalcs, setPageData]);

  const TOP_WEEK_HDR  = 0;
  const TOP_REQ_FTE   = 40;
  const TOP_BILLABLE  = 73;
  const TOP_GAP_REQ   = billableActive ? 106 : 73;
  const TOP_GAP_BILL  = 139;

  function updateFteModelField(field: keyof FteModelSnapshot, value: number) {
    if (!Number.isFinite(value)) return;
    const next = { ...fteModel, [field]: value };
    setFteModelOverride(next);
  }

  function resetFteModelDefaults() {
    setFteModelOverride(null);
  }

  function fteModelMin(field: keyof FteModelSnapshot): number {
    if (field === "shrinkagePct") return 0;
    if (field.endsWith("SlaTarget")) return 0;
    if (field === "emailOccupancy") return 1;
    if (field === "taskSwitchMultiplier") return 1;
    if (field === "operatingHoursPerDay" || field === "fteHoursPerDay") return 0.25;
    return 1;
  }

  function fteModelMax(field: keyof FteModelSnapshot): number | undefined {
    if (field === "operatingHoursPerDay" || field === "fteHoursPerDay") return 24;
    if (field === "daysPerWeek") return 7;
    if (field === "shrinkagePct") return 99;
    if (field.endsWith("SlaTarget") || field === "emailOccupancy") return 100;
    if (field === "taskSwitchMultiplier") return 5;
    return undefined;
  }

  function fteModelInteger(field: keyof FteModelSnapshot): boolean {
    return field === "daysPerWeek" || field.endsWith("Aht") || field.endsWith("SlaSec") || field === "chatConcurrency";
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageLayout title="Capacity Planning">
      {/* LOB Tabs */}
      <div className="flex items-center gap-1 mb-4 flex-wrap">
        {lobs.map(lob => (
          <button
            key={lob.id}
            onClick={() => handleLobSwitch(lob.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
              activeLob?.id === lob.id
                ? "bg-slate-200 text-black border-slate-300"
                : "border-border text-black hover:border-primary/50 hover:text-black"
            }`}
          >
            {lob.lob_name}
          </button>
        ))}
      </div>

      {/* Channel sub-tabs (dedicated LOBs only) */}
      {isDedicated && enabledChannels.length > 1 && (
        <div className="flex items-center gap-1 mb-4">
          {enabledChannels.map(ch => (
            <button
              key={ch}
              onClick={() => handleChannelSwitch(ch)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors border ${
                activeChannel === ch
                  ? "bg-slate-200 text-black border-slate-300"
                  : "border-border text-black hover:border-blue-400 hover:text-black"
              }`}
            >
              {CHANNEL_LABELS[ch]}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-black mb-4">
          <Loader2 className="size-4 animate-spin" /> Loading plan…
        </div>
      )}

      {/* ── Assumptions Panel */}
      <Card className="mb-4">
        <CardHeader className="py-3 px-4 cursor-pointer" onClick={() => setAssumptionsOpen(v => !v)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <Settings2 className="size-4 text-black" />
              <CardTitle className="text-sm font-semibold">Plan Assumptions</CardTitle>
              <Badge className="bg-emerald-50 text-emerald-800 border border-emerald-200 gap-1 text-[10px] font-normal">
                <CheckCircle2 className="size-3" />
                {demandSourceType === "committed"
                  ? `Demand source: committed scenario${demandSourceName ? ` "${demandSourceName}"` : ""}`
                  : demandSourceType === "active"
                    ? "Demand source: active Demand Forecast state"
                    : "Demand source: fallback assumptions"}
              </Badge>
            </div>
            {assumptionsOpen ? <ChevronDown className="size-4 text-black" /> : <ChevronRight className="size-4 text-black" />}
          </div>
        </CardHeader>
        {assumptionsOpen && (
          <CardContent className="pb-4 pt-0">
            {(demandSourceWarning || volumeOverrideMasking.overrideCount > 0) && (
              <div className="mb-4 space-y-2">
                {demandSourceWarning && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>{demandSourceWarning}</span>
                  </div>
                )}
                {volumeOverrideMasking.overrideCount > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <span>
                        Saved weekly volume overrides are active and may be hiding updated forecast volume.
                        {volumeOverrideMasking.zeroMaskCount > 0 ? ` ${volumeOverrideMasking.zeroMaskCount} override${volumeOverrideMasking.zeroMaskCount === 1 ? "" : "s"} set volume to 0 while auto forecast volume is available.` : ""}
                      </span>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 shrink-0 text-[11px]" onClick={resetVolumeOverridesForCurrentHorizon}>
                      Reset volume overrides
                    </Button>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-black">Plan Start Date</Label>
                <Input type="date" value={config.planStartDate} onChange={e => updateConfig({ planStartDate: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-black">Horizon (weeks)</Label>
                <CommitNumberInput value={config.horizonWeeks} min={4} max={104} step={1} integer onCommit={horizonWeeks => updateConfig({ horizonWeeks })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-black">Starting HC</Label>
                <CommitNumberInput value={config.startingHc} min={0} step={1} onCommit={startingHc => updateConfig({ startingHc })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-black">Attrition model</Label>
                <select
                  value={config.attritionModel}
                  onChange={e => updateConfig({ attritionModel: normalizeAttritionModel(e.target.value) })}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-black outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="monthly_rate">Monthly rate %</option>
                  <option value="fixed_count">Fixed attrition count</option>
                </select>
              </div>
              {config.attritionModel === "monthly_rate" ? (
                <div className="space-y-1">
                  <Label className="text-xs text-black">Attrition Rate (%/mo)</Label>
                  <CommitNumberInput value={config.attritionRateMonthly} min={0} max={50} step={0.1} onCommit={attritionRateMonthly => updateConfig({ attritionRateMonthly })} />
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs text-black">Attrition count</Label>
                    <CommitNumberInput value={config.attritionFixedCount} min={0} step={0.1} onCommit={attritionFixedCount => updateConfig({ attritionFixedCount })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-black">Every month(s)</Label>
                    <CommitNumberInput value={config.attritionFixedEveryMonths} min={0.1} step={0.1} onCommit={attritionFixedEveryMonths => updateConfig({ attritionFixedEveryMonths })} />
                  </div>
                </>
              )}
              {config.attritionModel === "fixed_count" && (
                <div className="col-span-2 sm:col-span-4 lg:col-span-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] leading-snug text-black">
                  <div>Projected attrition will use expected attrition count instead of monthly percentage.</div>
                  <div className="font-semibold">Equivalent: {fmt1(getMonthlyFixedAttritionCount(config))} attritions/month</div>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs text-black">Training Weeks (0%)</Label>
                <CommitNumberInput value={config.rampTrainingWeeks} min={0} max={26} step={1} integer onCommit={rampTrainingWeeks => updateConfig({ rampTrainingWeeks })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-black">Nesting Weeks</Label>
                <CommitNumberInput value={config.rampNestingWeeks} min={0} max={26} step={1} integer onCommit={rampNestingWeeks => updateConfig({ rampNestingWeeks })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-black">Nesting Productivity (%)</Label>
                <CommitNumberInput value={config.rampNestingPct} min={0} max={100} step={1} onCommit={rampNestingPct => updateConfig({ rampNestingPct })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-black">Training Graduation (%)</Label>
                <CommitNumberInput value={config.trainingGradRate} min={1} max={100} step={1} onCommit={trainingGradRate => updateConfig({ trainingGradRate })} />
              </div>
            </div>
            <p className="text-xs text-black mt-3">
              Ramp: {config.rampTrainingWeeks}wk training (0%) → {config.rampNestingWeeks}wk nesting ({config.rampNestingPct}%) → full production (100%) · {config.trainingGradRate < 100 ? `${config.trainingGradRate}% of hires graduate` : "100% graduation assumed"}
            </p>

            {/* ── Billing Parameters */}
            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-xs font-semibold text-black mb-2">Billing Parameters</p>
              <div className="flex items-end gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-black">Billable FTE (Contract Max)</Label>
                  <CommitNumberInput
                    min={0}
                    step={1}
                    emptyValue={0}
                    value={config.billableFte}
                    placeholder="0 — not set"
                    onCommit={billableFte => updateConfig({ billableFte })}
                    className="h-8 text-xs w-44"
                  />
                </div>
                {config.billableFte > 0 && (
                  <p className="text-xs text-black pb-1">
                    Client is billed for up to <span className="font-semibold">{fmt1(config.billableFte)}</span> FTE. The table will show a second gap row against this ceiling.
                  </p>
                )}
              </div>
            </div>

            {/* ── Staffing Parameters (read-only, sourced from LOB Settings & Shrinkage) */}
            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-xs font-semibold text-black mb-2">
                FTE Model Parameters
                <span className="font-normal text-black"> - editable for this what-if only</span>
              </p>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <p className="text-xs text-black">
                  Scenario-only overrides. Defaults still come from LOB Settings and Shrinkage Planning.
                </p>
                <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" onClick={resetFteModelDefaults}>
                  <RotateCcw className="size-3.5" />Reset defaults
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3 md:grid-cols-4 xl:grid-cols-8 mb-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
                {([
                  ["Op. Hrs/Day", "operatingHoursPerDay", 0.5],
                  ["FTE Workdays/Wk", "daysPerWeek", 1],
                  ["FTE Hrs/Day", "fteHoursPerDay", 0.25],
                  ["Shrinkage %", "shrinkagePct", 0.1],
                  ["Voice AHT", "voiceAht", 1],
                  ["Chat AHT", "chatAht", 1],
                  ["Email AHT", "emailAht", 1],
                  ["Cases AHT", "casesAht", 1],
                ] as const).map(([label, field, step]) => (
                  <div key={field} className="space-y-1.5">
                    <Label className="block text-[11px] font-medium leading-none text-black">{label}</Label>
                    <CommitNumberInput
                      value={fteModel[field]}
                      min={fteModelMin(field)}
                      max={fteModelMax(field)}
                      step={step}
                      integer={fteModelInteger(field)}
                      onCommit={value => updateFteModelField(field, value)}
                    />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3 md:grid-cols-4 xl:grid-cols-8 mb-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
                {([
                  ["Voice SLA %", "voiceSlaTarget", 1],
                  ["Voice SLA Sec", "voiceSlaSec", 1],
                  ["Chat SLA %", "chatSlaTarget", 1],
                  ["Chat SLA Sec", "chatSlaSec", 1],
                  ["Email SLA %", "emailSlaTarget", 1],
                  ["Email SLA Sec", "emailSlaSec", 60],
                  ["Email Occ. %", "emailOccupancy", 1],
                  ["Chat Conc.", "chatConcurrency", 1],
                  ["Switch Penalty", "taskSwitchMultiplier", 0.01],
                ] as const).map(([label, field, step]) => (
                  <div key={field} className="space-y-1.5">
                    <Label className="block text-[11px] font-medium leading-none text-black">{label}</Label>
                    <CommitNumberInput
                      value={fteModel[field]}
                      min={fteModelMin(field)}
                      max={fteModelMax(field)}
                      step={step}
                      integer={fteModelInteger(field)}
                      onCommit={value => updateFteModelField(field, value)}
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 mb-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2">
                {[
                  { label: "Op. Hrs/Day", value: `${operatingHoursPerDay}h` },
                  { label: "Days/Week", value: `${daysPerWeek}d` },
                  { label: "FTE Hrs/Day", value: `${effectiveFteHoursPerDay}h` },
                  { label: "Shrinkage", value: `${shrinkagePct}%` },
                ].map(p => (
                  <div key={p.label} className="flex items-center gap-1 text-xs">
                    <span className="text-black">{p.label}:</span>
                    <span className="font-medium text-black">{p.value}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {(isDedicated ? [activeChannel] : enabledChannels).map(ch => {
                  const slaTarget = ch === "voice" ? slaVoiceTarget : ch === "chat" ? slaChatTarget : slaEmailTarget;
                  const slaSec   = ch === "voice" ? slaVoiceSec    : ch === "chat" ? slaChatSec    : slaEmailSec;
                  return (
                    <div key={ch} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs">
                      <span className="font-semibold text-black">{CHANNEL_LABELS[ch]}</span>
                      <span className="text-black">SLA {slaTarget}% in {fmtSeconds(slaSec)}</span>
                      {ch === "chat" && (
                        <span className="text-black">· {chatConcurrency}× concurrency</span>
                      )}
                      {ch === "email" && (
                        <span className="text-black">· {emailOccupancy}% max async occ.</span>
                      )}
                      {ch === "email" && !isDedicated && taskSwitchMultiplier !== 1 && (
                        <span className="text-black">· {taskSwitchMultiplier}× AHT switch penalty</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Required FTE summary */}
      <Card className="mb-4 border border-border/70">
        <CardHeader className="py-3 px-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-semibold">Weekly Required FTE Coverage Estimate</CardTitle>
              <p className="mt-1 text-xs text-black">
                This is an intervalized weekly planning estimate based on configured demand, AHT, operating windows, productive hours, FTE workdays, and shrinkage. It is not final schedule validation.
              </p>
            </div>
            <Badge variant="outline" className="border-slate-300 text-black">
              {isDedicated ? "Dedicated staffing" : "Blended staffing"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-black">
              Pooling: <span className="font-semibold">{isDedicated ? "Dedicated per enabled channel" : "Pooled across enabled channels"}</span>
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-black">
              Operating days/week: <span className="font-semibold">{fmt1(daysPerWeek)}</span>
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-black">
              FTE workdays/week: <span className="font-semibold">{fmt1(effectiveFteWorkdaysPerWeek)}</span>
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-black">
              Op. hours/day: <span className="font-semibold">{fmt1(operatingHoursPerDay)}h</span>
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-black">
              FTE productive/day: <span className="font-semibold">{fmt1(effectiveFteHoursPerDay)}h</span>
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-black">
              Shrinkage: <span className="font-semibold">{fmtPct(shrinkagePct)}</span>
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-black">
              Enabled: <span className="font-semibold">{enabledChannels.map(ch => CHANNEL_LABELS[ch]).join(", ") || "None"}</span>
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-black">
              Weekly volume source: <span className="font-semibold">{weeklyVolumeSourceLabel(weekCalcs[0]?.weeklyVolumeSource ?? "flat-fallback")}</span>
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-black">
              Distribution: <span className="font-semibold">{distributionSourceLabel(weekCalcs[0]?.distributionSource ?? "default-fallback-distribution")}</span>
            </span>
          </div>
          {weekCalcs[0]?.distributionSource === "configuration-needed" && (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Operating days or hours are not configured for this demand pattern. The page is showing the previous flat estimate until valid operating intervals are available.
            </div>
          )}

          {isDedicated ? (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {dedicatedRequiredFteSummary.map(item => (
                  <div key={item.channel} className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-black">{CHANNEL_LABELS[item.channel]}</div>
                      <Badge variant="outline" className="h-5 border-slate-300 px-1.5 text-[10px] text-black">
                        {item.channel === activeChannel ? "selected" : "enabled"}
                      </Badge>
                    </div>
                    <div className="mt-2 text-2xl font-bold leading-none text-black">{fmt1(item.currentFte)}</div>
                    <div className="mt-1 text-[11px] text-black">
                      Weekly estimate for {weekCalcs[0] ? weekCalcs[0].label : "current week"} - peak {fmt1(item.peakFte)}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      Previous flat estimate comparison: {fmt1(item.currentFlatFte)}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-black">
                      <span>Volume</span><span className="text-right font-medium">{Math.round(item.currentVolume).toLocaleString()}</span>
                      <span>AHT</span><span className="text-right font-medium">{fmt1(item.aht)}s</span>
                      <span>Service</span><span className="text-right font-medium">{item.slaTarget}% in {fmtSeconds(item.slaSec)}</span>
                      <span>Occupancy</span><span className="text-right font-medium">{fmtPct(item.occupancy)}</span>
                      <span>Ops</span><span className="text-right font-medium">{item.daysPerWeek}d - {fmt1(item.operatingHoursPerDay)}h</span>
                      <span>Source</span><span className="text-right font-medium">{distributionSourceLabel(item.distributionSource)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-black">Total Dedicated Weekly Required FTE Estimate</div>
                    <div className="text-[11px] text-black">Sum of enabled channel requirements. Disabled channels are excluded.</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold leading-none text-black">{fmt1(dedicatedRequiredFteTotal.current)}</div>
                    <div className="text-[11px] text-black">peak {fmt1(dedicatedRequiredFteTotal.peak)}</div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-black">Pooled Blended Weekly Required FTE Estimate</div>
                  <p className="mt-1 text-xs text-black">
                    One shared pool across enabled channels only. Disabled channels do not contribute to the pooled requirement.
                  </p>
                  <p className="mt-1 text-[11px] text-black">
                    Source: {distributionSourceLabel(weekCalcs[0]?.distributionSource ?? "default-fallback-distribution")}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Weekly volume source: {weeklyVolumeSourceLabel(weekCalcs[0]?.weeklyVolumeSource ?? "flat-fallback")}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Previous flat estimate comparison: {weekCalcs[0] ? fmt1(weekCalcs[0].flatRequiredFTE) : "-"} FTE
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold leading-none text-black">{weekCalcs[0] ? fmt1(weekCalcs[0].requiredFTE) : "-"}</div>
                  <div className="text-[11px] text-black">peak {fmt1(hiringNeed.peakRequired)}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-black">
                {enabledChannels.map(ch => {
                  const aht = ch === "voice" ? autoAhts.voice : ch === "chat" ? autoAhts.chat : ch === "cases" ? autoAhts.cases : autoAhts.email;
                  const target = ch === "voice" ? slaVoiceTarget : ch === "chat" ? slaChatTarget : slaEmailTarget;
                  const sec = ch === "voice" ? slaVoiceSec : ch === "chat" ? slaChatSec : slaEmailSec;
                  return (
                    <span key={ch} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                      {CHANNEL_LABELS[ch]} - {fmt1(aht)}s AHT - {target}% in {fmtSeconds(sec)}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hero Strip */}
      <div className={`grid gap-2.5 mb-4 ${billableActive ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 lg:grid-cols-3"}`}>
        {/* Peak Weekly FTE Estimate */}
        <div className="bg-card border border-border rounded-md px-3 py-2.5 shadow-sm border-l-4 border-l-blue-500">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-black uppercase tracking-wide">
            <Users className="size-3" /> Peak Weekly FTE Estimate
          </div>
          <div className="text-2xl font-bold mt-1 text-black dark:text-black leading-none">
            {hiringNeed.peakRequired > 0 ? hiringNeed.peakRequired : "—"}
          </div>
          <div className="text-[10px] text-black mt-1">
            roster ceiling over {config.horizonWeeks} wks
          </div>
        </div>

        {/* Current Gap - Weekly Estimate */}
        <div className={`bg-card border border-border rounded-md px-3 py-2.5 shadow-sm border-l-4 ${
          currentGap >= 0 ? "border-l-green-500" : "border-l-red-500"
        }`}>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-black uppercase tracking-wide">
            <Target className="size-3" /> Current Gap - Estimate
          </div>
          <div className="text-2xl font-bold mt-1 leading-none text-black dark:text-black">
            {currentGap >= 0 ? `+${fmt1(currentGap)}` : fmt1(currentGap)}
          </div>
          <div className="text-[10px] text-black mt-1">
            {weekCalcs[0] ? `${weekCalcs[0].label} · ${weekCalcs[0].dateLabel}` : "W1"}&ensp;·&ensp;{currentGap >= 0 ? "surplus" : "understaffed"}
          </div>
        </div>

        {/* Current Gap — Billable FTE (only when billable is configured) */}
        {billableActive && (
          <div className={`bg-card border border-border rounded-md px-3 py-2.5 shadow-sm border-l-4 ${
            (currentBillableGap ?? 0) >= 0 ? "border-l-amber-400" : "border-l-orange-500"
          }`}>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-black uppercase tracking-wide">
              <Target className="size-3" /> Current Gap — Billable
            </div>
            <div className="text-2xl font-bold mt-1 leading-none text-black dark:text-black">
              {currentBillableGap != null
                ? currentBillableGap >= 0 ? `+${fmt1(currentBillableGap)}` : fmt1(currentBillableGap)
                : "—"}
            </div>
            <div className="text-[10px] text-black mt-1">
              {weekCalcs[0] ? `${weekCalcs[0].label} · ${weekCalcs[0].dateLabel}` : "W1"}&ensp;·&ensp;vs {fmt1(config.billableFte)} billable
            </div>
          </div>
        )}

        {/* Next Hiring Action - Weekly Estimate */}
        {(() => {
          const { reqHiresNeeded, reqDeficitWeek, reqHireByWeek, reqHireByPassed } = hiringNeed;
          const hasDeficit = reqDeficitWeek != null;
          const accent = !hasDeficit ? "border-l-green-500" : reqHireByPassed ? "border-l-red-500" : "border-l-violet-500";
          return (
            <div className={`bg-card border border-border rounded-md px-3 py-2.5 shadow-sm border-l-4 ${accent}`}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-black uppercase tracking-wide">
                <UserPlus className="size-3" /> Next Hiring Action - Estimate
              </div>
              {!hasDeficit ? (
                <>
                  <div className="text-lg font-bold mt-1 text-black dark:text-black leading-none">Fully staffed</div>
                  <div className="text-[10px] text-black mt-1">No deficit in {config.horizonWeeks}-wk horizon</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold mt-1 text-black dark:text-black leading-none">
                    {reqHiresNeeded} {reqHiresNeeded === 1 ? "hire" : "hires"}
                  </div>
                  <div className="text-[10px] text-black mt-1 leading-snug">
                    {reqHireByPassed
                      ? <span className="text-red-600 font-semibold">Recruit now</span>
                      : <>Hire by <span className="font-semibold">{reqHireByWeek?.label}</span> · {reqHireByWeek?.dateLabel}</>
                    }
                    <br />
                    deficit of {reqHiresNeeded} at {reqDeficitWeek.label} · {reqDeficitWeek.dateLabel}
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* Next Hiring Action — Billable FTE (only when billable is configured) */}
        {billableActive && (() => {
          const { billHiresNeeded, billDeficitWeek, billHireByWeek, billHireByPassed } = hiringNeed;
          const hasDeficit = billDeficitWeek != null;
          const accent = !hasDeficit ? "border-l-green-500" : billHireByPassed ? "border-l-red-500" : "border-l-amber-500";
          return (
            <div className={`bg-card border border-border rounded-md px-3 py-2.5 shadow-sm border-l-4 ${accent}`}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-black uppercase tracking-wide">
                <UserPlus className="size-3" /> Next Hiring Action — Billable
              </div>
              {!hasDeficit ? (
                <>
                  <div className="text-lg font-bold mt-1 text-black dark:text-black leading-none">Fully staffed</div>
                  <div className="text-[10px] text-black mt-1">No billable deficit in horizon</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold mt-1 text-black dark:text-black leading-none">
                    {billHiresNeeded} {billHiresNeeded === 1 ? "hire" : "hires"}
                  </div>
                  <div className="text-[10px] text-black mt-1 leading-snug">
                    {billHireByPassed
                      ? <span className="text-red-600 font-semibold">Recruit now</span>
                      : <>Hire by <span className="font-semibold">{billHireByWeek?.label}</span> · {billHireByWeek?.dateLabel}</>
                    }
                    <br />
                    deficit of {billHiresNeeded} at {billDeficitWeek.label} · {billDeficitWeek.dateLabel}
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Secondary metrics strip */}
      <div className="flex items-center gap-3 mb-4 flex-wrap text-xs">
        <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-3 py-1.5">
          <TrendingDown className="size-3.5 text-black" />
          <span className="text-black">{config.attritionModel === "fixed_count" ? "Annualized Projected Attritions:" : "Annualized Attrition:"}</span>
          <span className="font-semibold">
            {config.attritionModel === "fixed_count" ? fmt1(attritionSummary.annualizedProjectedAttritions) : fmtPct(attritionSummary.annualizedPct)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-3 py-1.5">
          <AlertTriangle className="size-3.5 text-black" />
          <span className="text-black">Projected Exits:</span>
          <span className="font-semibold">{fmt1(attritionSummary.totalExits)}</span>
        </div>
        <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-3 py-1.5">
          <CheckCircle2 className="size-3.5 text-black" />
          <span className="text-black">Actual Attrition:</span>
          <span className="font-semibold">{fmt1(attritionSummary.totalActualAttrition)}</span>
        </div>
        {demandAssumptions == null && (
          <Badge variant="outline" className="text-black border-slate-400 text-xs">
            No demand data — set up Demand Forecasting first
          </Badge>
        )}
        <button
          onClick={exportToCSV}
          disabled={weekCalcs.length === 0}
          className="ml-auto flex items-center gap-1.5 bg-card border border-border rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Download as CSV (opens in Excel or Google Sheets)"
        >
          <Download className="size-3.5" />
          Export CSV
        </button>
      </div>

      {/* ── Headcount Trajectory Chart — Required FTE vs Projected HC vs Actual HC */}
      {weekCalcs.length > 0 && (
        <Card className="mb-4">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-black">
                Headcount Trajectory — {isDedicated ? CHANNEL_LABELS[activeChannel] : "All Channels"}
              </div>
              <div className="text-[10px] text-black">
                Weekly estimate vs. plan - gap is where the red line sits above the dashed blue
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} width={40} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 6 }}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="line" />
                <ReferenceLine y={config.startingHc} stroke="#9ca3af" strokeDasharray="2 2" label={{ value: "Start HC", fontSize: 9, position: "insideTopRight", fill: "#9ca3af" }} />
                <Line type="monotone" dataKey="required" name="Weekly FTE Estimate" stroke="#dc2626" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="projected" name="Projected HC" stroke="#2563eb" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                {config.billableFte > 0 && (
                  <Line type="monotone" dataKey="billable" name="Billable FTE" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── What-if Manager ── */}
      <Card className="border border-border/50 shadow-sm mb-4">
        <CardContent className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-black uppercase tracking-widest text-foreground/60 shrink-0">What-ifs</span>
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
              {Object.values(whatIfs).map(wif => (
                <button key={wif.id} type="button" onClick={() => handleWhatIfChange(wif.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
                    wif.id === selectedWhatIfId
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-accent"
                  }`}>
                  {wif.is_committed && <CheckCircle2 className="size-3 shrink-0 text-emerald-400" />}
                  <span className="max-w-[160px] truncate">{wif.name}</span>
                  <X className="size-3 shrink-0 opacity-50 hover:opacity-100"
                    onClick={e => handleDeleteWhatIf(e, wif.id)} />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleNewWhatIf}>
                <Plus className="size-3.5" />New
              </Button>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleRenameWhatIf}>
                <Pencil className="size-3.5" />Rename
              </Button>
              <Button variant="outline" size="sm"
                className="h-8 gap-1.5 text-xs border-emerald-500/40 text-emerald-700 hover:bg-emerald-50"
                onClick={handleCommitWhatIf}
                disabled={whatIfs[selectedWhatIfId]?.is_committed === true}>
                <CheckCircle2 className="size-3.5" />Commit
              </Button>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => handleSaveWhatIf()}>
                <Save className="size-3.5" />Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── What-if Comparison Chart ── */}
      {whatIfComparisons && (
        <Card className="mb-4">
          <CardContent className="py-3 px-4">
            <div className="text-xs font-semibold text-black mb-2">What-if Comparison — Projected HC</div>
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={weeks.map((wk, i) => ({
                label: wk.label,
                requiredFTE: roundTo(weekCalcs[i]?.requiredFTE ?? 0, 1),
                ...Object.fromEntries(whatIfComparisons.map(w => [w.id, w.weeklyHC[i] ?? 0])),
              }))} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} width={40} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} labelStyle={{ fontWeight: 600 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="line" />
                <Line type="monotone" dataKey="requiredFTE" name="Weekly FTE Estimate" stroke="#dc2626" strokeWidth={2} strokeDasharray="4 2" dot={false} />
                {whatIfComparisons.map((w, i) => (
                  <Line key={w.id} type="monotone" dataKey={w.id} name={w.name}
                    stroke={["#2563eb","#16a34a","#d97706","#7c3aed"][i % 4]}
                    strokeWidth={w.is_committed ? 3 : 1.5}
                    strokeDasharray={w.is_committed ? undefined : "5 3"}
                    dot={false} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Main Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
          <table className="border-collapse text-xs" style={{ minWidth: `${180 + weeks.length * 80}px` }}>

            {/* ── Frozen header rows */}
            <thead>
              {/* Row 1 — Week dates */}
              <tr className="bg-card border-b border-border">
                <th
                  className="bg-card border-r border-border px-3 py-2 text-left text-xs font-semibold text-black w-44 min-w-44"
                  style={{ position: "sticky", left: 0, top: TOP_WEEK_HDR, zIndex: 30 }}
                >
                  {isDedicated ? `${activeLob?.lob_name} — ${CHANNEL_LABELS[activeChannel]}` : activeLob?.lob_name}
                </th>
                {weeks.map(w => (
                  <th
                    key={w.weekOffset}
                    className="bg-card border-b border-border px-2 py-1 text-right text-xs font-semibold min-w-[80px]"
                    style={{ position: "sticky", top: TOP_WEEK_HDR, zIndex: 20 }}
                  >
                    <div className="font-semibold">{w.label}</div>
                    <div className="text-[10px] text-black font-normal">{w.dateLabel}</div>
                  </th>
                ))}
              </tr>

              {/* Row 2 - Weekly Required FTE Estimate */}
              <tr className="border-b border-border">
                <td
                  className="bg-card border-r border-border border-t-2 border-t-primary px-3 py-2 text-xs font-bold whitespace-nowrap text-black"
                  style={{ position: "sticky", left: 0, top: TOP_REQ_FTE, zIndex: 30 }}
                >
                  Weekly Required FTE Estimate
                </td>
                {weekCalcs.map(wk => (
                  <td
                    key={wk.weekOffset}
                    className="bg-card border-t-2 border-t-primary px-2 py-2 text-right text-xs font-bold whitespace-nowrap text-black"
                    style={{ position: "sticky", top: TOP_REQ_FTE, zIndex: 20 }}
                  >
                    {fmt1(wk.requiredFTE)}
                  </td>
                ))}
              </tr>

              {/* Row 3 — Billable FTE (conditional) */}
              {billableActive && (
                <tr className="border-b border-border">
                  <td
                    className="border-r border-border bg-white px-3 py-2 text-xs font-bold whitespace-nowrap text-black"
                    style={{ position: "sticky", left: 0, top: TOP_BILLABLE, zIndex: 30 }}
                  >
                    Billable FTE
                  </td>
                  {weekCalcs.map(wk => (
                    <td
                      key={wk.weekOffset}
                      className="bg-white px-2 py-2 text-right text-xs font-bold whitespace-nowrap text-black"
                      style={{ position: "sticky", top: TOP_BILLABLE, zIndex: 20 }}
                    >
                      {fmt1(config.billableFte)}
                    </td>
                  ))}
                </tr>
              )}

              {/* Row 4 — Proj. Gap / Surplus (vs Required) */}
              <tr className="border-b border-border">
                <td
                  className="bg-card border-r border-border px-3 py-2 text-xs font-bold whitespace-nowrap text-black"
                  style={{ position: "sticky", left: 0, top: TOP_GAP_REQ, zIndex: 30 }}
                >
                  Proj. Gap / Surplus{billableActive ? " (vs Required)" : ""}
                </td>
                {weekCalcs.map(wk => {
                  const v = wk.gapSurplus;
                  return (
                    <td
                      key={wk.weekOffset}
                      className="bg-card px-2 py-2 text-right text-xs font-bold whitespace-nowrap text-black"
                      style={{ position: "sticky", top: TOP_GAP_REQ, zIndex: 20, ...gapCellStyle(v, maxAbsGap) }}
                    >
                      {v >= 0 ? `+${fmt1(v)}` : fmt1(v)}
                    </td>
                  );
                })}
              </tr>

              {/* Row 5 — Proj. Gap / Surplus (vs Billable, conditional) */}
              {billableActive && (
                <tr className="border-b-2 border-border">
                  <td
                    className="bg-card border-r border-border px-3 py-2 text-xs font-bold whitespace-nowrap text-black"
                    style={{ position: "sticky", left: 0, top: TOP_GAP_BILL, zIndex: 30 }}
                  >
                    Proj. Gap / Surplus (vs Billable)
                  </td>
                  {weekCalcs.map(wk => {
                    const v = wk.billableGapSurplus ?? 0;
                    return (
                      <td
                        key={wk.weekOffset}
                        className="bg-card px-2 py-2 text-right text-xs font-bold whitespace-nowrap text-black"
                        style={{ position: "sticky", top: TOP_GAP_BILL, zIndex: 20, ...gapCellStyle(v, maxAbsBillableGap) }}
                      >
                        {v >= 0 ? `+${fmt1(v)}` : fmt1(v)}
                      </td>
                    );
                  })}
                </tr>
              )}
            </thead>

            <tbody>
              {/* ── DEMAND SECTION */}
              <SectionHeaderRow
                label={`▼ DEMAND${!isDedicated ? " (All Channels)" : ` — ${CHANNEL_LABELS[activeChannel]}`}`}
                colSpan={colSpan} collapsed={collapsed.demand}
                onToggle={() => setCollapsed(s => ({ ...s, demand: !s.demand }))}
                onReset={resetAllDemandOverrides}
                bg="bg-blue-50/60 dark:bg-blue-950/20"
              />

              {!collapsed.demand && (
                <>
                  {/* Projected Volumes */}
                  {(!isDedicated ? enabledChannels.includes("voice") : activeChannel === "voice") && (
                    <tr className="border-b border-border/40 hover:bg-muted/20">
                      <RowLabel label="Proj. Volume — Voice" indent />
                      {weekCalcs.map(wk => (
                        <EditableCell key={wk.weekOffset}
                          value={weeklyInputs[wk.weekOffset]?.volVoice ?? null}
                          autoValue={wk.autoVolVoice}
                          isOverridden={weeklyInputs[wk.weekOffset]?.volVoice != null}
                          onSave={v => setCellInput(wk.weekOffset, "volVoice", v)}
                          onReset={() => resetOverride(wk.weekOffset, "volVoice")}
                          format={n => Math.round(n).toLocaleString()}
                        />
                      ))}
                    </tr>
                  )}
                  {(!isDedicated ? enabledChannels.includes("chat") : activeChannel === "chat") && (
                    <tr className="border-b border-border/40 hover:bg-muted/20">
                      <RowLabel label="Proj. Volume — Chat" indent />
                      {weekCalcs.map(wk => (
                        <EditableCell key={wk.weekOffset}
                          value={weeklyInputs[wk.weekOffset]?.volChat ?? null}
                          autoValue={wk.autoVolChat}
                          isOverridden={weeklyInputs[wk.weekOffset]?.volChat != null}
                          onSave={v => setCellInput(wk.weekOffset, "volChat", v)}
                          onReset={() => resetOverride(wk.weekOffset, "volChat")}
                          format={n => Math.round(n).toLocaleString()}
                        />
                      ))}
                    </tr>
                  )}
                  {(!isDedicated ? enabledChannels.includes("email") : activeChannel === "email") && (
                    <tr className="border-b border-border/40 hover:bg-muted/20">
                      <RowLabel label="Proj. Volume — Email" indent />
                      {weekCalcs.map(wk => (
                        <EditableCell key={wk.weekOffset}
                          value={weeklyInputs[wk.weekOffset]?.volEmail ?? null}
                          autoValue={wk.autoVolEmail}
                          isOverridden={weeklyInputs[wk.weekOffset]?.volEmail != null}
                          onSave={v => setCellInput(wk.weekOffset, "volEmail", v)}
                          onReset={() => resetOverride(wk.weekOffset, "volEmail")}
                          format={n => Math.round(n).toLocaleString()}
                        />
                      ))}
                    </tr>
                  )}
                  {(!isDedicated ? enabledChannels.includes("cases") : activeChannel === "cases") && (
                    <tr className="border-b border-border/40 hover:bg-muted/20">
                      <RowLabel label="Proj. Volume — Cases" indent />
                      {weekCalcs.map(wk => (
                        <EditableCell key={wk.weekOffset}
                          value={weeklyInputs[wk.weekOffset]?.volCases ?? null}
                          autoValue={wk.autoVolCases}
                          isOverridden={weeklyInputs[wk.weekOffset]?.volCases != null}
                          onSave={v => setCellInput(wk.weekOffset, "volCases", v)}
                          onReset={() => resetOverride(wk.weekOffset, "volCases")}
                          format={n => Math.round(n).toLocaleString()}
                        />
                      ))}
                    </tr>
                  )}
                  {!isDedicated && (
                    <tr className="border-b border-border/40 bg-muted/10">
                      <RowLabel label="Proj. Volume — Total" indent bold />
                      {weekCalcs.map(wk => <ReadOnlyCell key={wk.weekOffset} value={Math.round(wk.effVolTotal).toLocaleString()} bold />)}
                    </tr>
                  )}

                  {/* Projected AHTs */}
                  {(!isDedicated ? enabledChannels.includes("voice") : activeChannel === "voice") && (
                    <tr className="border-b border-border/40 hover:bg-muted/20">
                      <RowLabel label="Proj. AHT (s) — Voice" indent sub />
                      {weekCalcs.map(wk => (
                        <EditableCell key={wk.weekOffset}
                          value={weeklyInputs[wk.weekOffset]?.ahtVoice ?? null}
                          autoValue={wk.autoAhtVoice}
                          isOverridden={weeklyInputs[wk.weekOffset]?.ahtVoice != null}
                          onSave={v => setCellInput(wk.weekOffset, "ahtVoice", v)}
                          onReset={() => resetOverride(wk.weekOffset, "ahtVoice")}
                          format={n => Math.round(n).toLocaleString()}
                        />
                      ))}
                    </tr>
                  )}
                  {(!isDedicated ? enabledChannels.includes("chat") : activeChannel === "chat") && (
                    <tr className="border-b border-border/40 hover:bg-muted/20">
                      <RowLabel label="Proj. AHT (s) — Chat" indent sub />
                      {weekCalcs.map(wk => (
                        <EditableCell key={wk.weekOffset}
                          value={weeklyInputs[wk.weekOffset]?.ahtChat ?? null}
                          autoValue={wk.autoAhtChat}
                          isOverridden={weeklyInputs[wk.weekOffset]?.ahtChat != null}
                          onSave={v => setCellInput(wk.weekOffset, "ahtChat", v)}
                          onReset={() => resetOverride(wk.weekOffset, "ahtChat")}
                          format={n => Math.round(n).toLocaleString()}
                        />
                      ))}
                    </tr>
                  )}
                  {(!isDedicated ? enabledChannels.includes("email") : activeChannel === "email") && (
                    <tr className="border-b border-border/40 hover:bg-muted/20">
                      <RowLabel label="Proj. AHT (s) — Email" indent sub />
                      {weekCalcs.map(wk => (
                        <EditableCell key={wk.weekOffset}
                          value={weeklyInputs[wk.weekOffset]?.ahtEmail ?? null}
                          autoValue={wk.autoAhtEmail}
                          isOverridden={weeklyInputs[wk.weekOffset]?.ahtEmail != null}
                          onSave={v => setCellInput(wk.weekOffset, "ahtEmail", v)}
                          onReset={() => resetOverride(wk.weekOffset, "ahtEmail")}
                          format={n => Math.round(n).toLocaleString()}
                        />
                      ))}
                    </tr>
                  )}
                  {(!isDedicated ? enabledChannels.includes("cases") : activeChannel === "cases") && (
                    <tr className="border-b border-border/40 hover:bg-muted/20">
                      <RowLabel label="Proj. AHT (s) — Cases" indent sub />
                      {weekCalcs.map(wk => (
                        <EditableCell key={wk.weekOffset}
                          value={weeklyInputs[wk.weekOffset]?.ahtCases ?? null}
                          autoValue={wk.autoAhtCases}
                          isOverridden={weeklyInputs[wk.weekOffset]?.ahtCases != null}
                          onSave={v => setCellInput(wk.weekOffset, "ahtCases", v)}
                          onReset={() => resetOverride(wk.weekOffset, "ahtCases")}
                          format={n => Math.round(n).toLocaleString()}
                        />
                      ))}
                    </tr>
                  )}

                  {/* Actual volumes — roster integration coming; read-only for now */}
                  {(!isDedicated ? enabledChannels.includes("voice") : activeChannel === "voice") && (
                    <tr className="border-b border-border/40 border-t-2 border-t-border/60">
                      <RowLabel label="Actual Volume — Voice" indent sub />
                      {weeks.map(w => <ReadOnlyCell key={w.weekOffset} value="—" className="text-black italic" />)}
                    </tr>
                  )}
                  {(!isDedicated ? enabledChannels.includes("chat") : activeChannel === "chat") && (
                    <tr className="border-b border-border/40">
                      <RowLabel label="Actual Volume — Chat" indent sub />
                      {weeks.map(w => <ReadOnlyCell key={w.weekOffset} value="—" className="text-black italic" />)}
                    </tr>
                  )}
                  {(!isDedicated ? enabledChannels.includes("email") : activeChannel === "email") && (
                    <tr className="border-b border-border/40">
                      <RowLabel label="Actual Volume — Email" indent sub />
                      {weeks.map(w => <ReadOnlyCell key={w.weekOffset} value="—" className="text-black italic" />)}
                    </tr>
                  )}
                  {(!isDedicated ? enabledChannels.includes("cases") : activeChannel === "cases") && (
                    <tr className="border-b border-border/40">
                      <RowLabel label="Actual Volume — Cases" indent sub />
                      {weeks.map(w => <ReadOnlyCell key={w.weekOffset} value="—" className="text-black italic" />)}
                    </tr>
                  )}
                </>
              )}

              {/* ── STAFFING REQUIREMENTS SECTION */}
              <SectionHeaderRow
                label="▼ STAFFING REQUIREMENTS"
                colSpan={colSpan} collapsed={collapsed.staffing}
                onToggle={() => setCollapsed(s => ({ ...s, staffing: !s.staffing }))}
                bg="bg-purple-50/60 dark:bg-purple-950/20"
              />
              {!collapsed.staffing && (
                <>
                  <tr className="border-b border-border/40 hover:bg-muted/20">
                    <RowLabel label="Proj. Occupancy %" indent sub />
                    {weekCalcs.map(wk => <ReadOnlyCell key={wk.weekOffset} value={fmtPct(wk.projOccupancyPct)} className="text-black" />)}
                  </tr>
                  <tr className="border-b border-border/40 hover:bg-muted/20">
                    <RowLabel label="Proj. Shrinkage %" indent sub />
                    {weekCalcs.map(wk => <ReadOnlyCell key={wk.weekOffset} value={fmtPct(wk.projShrinkagePct)} className="text-black" />)}
                  </tr>
                  {/* Required FTE lives in the sticky footer so it's always visible */}
                </>
              )}

              {/* ── HEADCOUNT PLAN SECTION */}
              <SectionHeaderRow
                label="▼ HEADCOUNT PLAN"
                colSpan={colSpan} collapsed={collapsed.hcPlan}
                onToggle={() => setCollapsed(s => ({ ...s, hcPlan: !s.hcPlan }))}
                bg="bg-green-50/60 dark:bg-green-950/20"
              />
              {!collapsed.hcPlan && (
                <>
                  <tr className="border-b border-border/40 hover:bg-muted/20">
                    <RowLabel label="Planned Hires" indent />
                    {weekCalcs.map(wk => (
                      <InputCell key={wk.weekOffset}
                        value={weeklyInputs[wk.weekOffset]?.plannedHires}
                        onChange={v => setCellInput(wk.weekOffset, "plannedHires", v)}
                        placeholder="0" color="blue"
                      />
                    ))}
                  </tr>
                  <tr className="border-b border-border/40 hover:bg-muted/20">
                    <RowLabel label="Effective New HC" indent sub />
                    {weekCalcs.map(wk => (
                      <ReadOnlyCell key={wk.weekOffset}
                        value={wk.effectiveNewHc > 0 ? `+${fmt1(wk.effectiveNewHc)}` : fmt1(wk.effectiveNewHc)}
                        className={wk.effectiveNewHc > 0 ? "text-black dark:text-black" : "text-black"}
                      />
                    ))}
                  </tr>
                  <tr className="border-b border-border/40 hover:bg-muted/20">
                    <RowLabel label="Attrition Decay" indent sub />
                    {weekCalcs.map(wk => (
                      <ReadOnlyCell key={wk.weekOffset}
                        value={wk.attritionDecay > 0 ? `-${fmt1(wk.attritionDecay)}` : "—"}
                        className="text-black"
                      />
                    ))}
                  </tr>
                  <tr className="border-b border-border/40 hover:bg-muted/20">
                    <RowLabel label="Known Exits" indent />
                    {weekCalcs.map(wk => (
                      <InputCell key={wk.weekOffset}
                        value={weeklyInputs[wk.weekOffset]?.knownExits}
                        onChange={v => setCellInput(wk.weekOffset, "knownExits", v)}
                        placeholder="0" color="orange"
                      />
                    ))}
                  </tr>
                  <tr className="border-b border-border/40 hover:bg-muted/20">
                    <RowLabel label="Transfers Out" indent />
                    {weekCalcs.map(wk => (
                      <InputCell key={wk.weekOffset}
                        value={weeklyInputs[wk.weekOffset]?.transfersOut}
                        onChange={v => setCellInput(wk.weekOffset, "transfersOut", v)}
                        placeholder="0" color="orange"
                        note={weeklyInputs[wk.weekOffset]?.transfersOutNote}
                        onNoteChange={v => setCellNote(wk.weekOffset, "transfersOutNote", v)}
                      />
                    ))}
                  </tr>
                  <tr className="border-b border-border/40 hover:bg-muted/20">
                    <RowLabel label="Promotions Out" indent />
                    {weekCalcs.map(wk => (
                      <InputCell key={wk.weekOffset}
                        value={weeklyInputs[wk.weekOffset]?.promotionsOut}
                        onChange={v => setCellInput(wk.weekOffset, "promotionsOut", v)}
                        placeholder="0" color="orange"
                        note={weeklyInputs[wk.weekOffset]?.promotionsOutNote}
                        onNoteChange={v => setCellNote(wk.weekOffset, "promotionsOutNote", v)}
                      />
                    ))}
                  </tr>
                  <tr className="border-b border-border bg-muted/10">
                    <RowLabel label="Projected HC" bold />
                    {weekCalcs.map(wk => <ReadOnlyCell key={wk.weekOffset} value={fmt1(wk.projectedHc)} bold />)}
                  </tr>
                  <tr className="border-b border-border/40 hover:bg-muted/20 border-t-2 border-t-border/60">
                    <RowLabel label="Actual HC" indent />
                    {weekCalcs.map(wk => (
                      <InputCell key={wk.weekOffset}
                        value={weeklyInputs[wk.weekOffset]?.actualHc ?? undefined}
                        onChange={v => setCellInput(wk.weekOffset, "actualHc", v)}
                        placeholder="—" color="green"
                      />
                    ))}
                  </tr>
                  <tr className="border-b border-border/40 hover:bg-muted/20">
                    <RowLabel label="Actual Attrition" indent sub />
                    {weekCalcs.map(wk => (
                      <InputCell key={wk.weekOffset}
                        value={weeklyInputs[wk.weekOffset]?.actualAttrition ?? undefined}
                        onChange={v => setCellInput(wk.weekOffset, "actualAttrition", v)}
                        placeholder="0" color="default"
                      />
                    ))}
                  </tr>
                </>
              )}

              {/* ── PERFORMANCE INSIGHTS — Actual Gap & SLA context (not sticky) */}
              <tr className="border-t-2 border-border bg-muted/20">
                <td colSpan={colSpan} className="px-3 py-1 text-xs font-semibold text-black sticky left-0 bg-muted/20 dark:bg-muted/30">
                  PERFORMANCE INSIGHTS
                </td>
              </tr>
              <tr className="border-b border-border/40">
                <RowLabel label="Actual Gap / Surplus" indent sub />
                {weekCalcs.map(wk => {
                  const v = wk.actualGapSurplus;
                  if (v == null) return <ReadOnlyCell key={wk.weekOffset} value="—" className="text-black" />;
                  const color = v >= 0 ? "text-black dark:text-black" : "text-black dark:text-black";
                  return (
                    <td key={wk.weekOffset} className={`px-2 py-1 text-right text-xs font-semibold whitespace-nowrap ${color}`}>
                      {v >= 0 ? `+${fmt1(v)}` : fmt1(v)}
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-border/40">
                <RowLabel label="Projected SLA (Proj. HC)" indent sub />
                {weekCalcs.map(wk => {
                  const sl = wk.achievedSLAProj;
                  if (isDedicated && (activeChannel === "email" || activeChannel === "cases")) {
                    return <ReadOnlyCell key={wk.weekOffset} value="N/A" className="text-black italic" />;
                  }
                  if (sl == null) return <ReadOnlyCell key={wk.weekOffset} value="—" className="text-black" />;
                  const slaTarget = isDedicated
                    ? (activeChannel === "voice" ? slaVoiceTarget : slaChatTarget)
                    : slaVoiceTarget;
                  const color = sl >= slaTarget ? "text-black dark:text-black" : "text-black dark:text-black";
                  return (
                    <td key={wk.weekOffset} className={`px-2 py-1 text-right text-xs font-semibold whitespace-nowrap ${color}`}>
                      {fmtPct(sl)}
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-border/40">
                <RowLabel label="Achieved SLA (Actual HC)" indent sub />
                {weekCalcs.map(wk => {
                  const sl = wk.achievedSLAActual;
                  if (sl == null && isDedicated && (activeChannel === "email" || activeChannel === "cases")) {
                    return <ReadOnlyCell key={wk.weekOffset} value="N/A" className="text-black italic" />;
                  }
                  if (sl == null) return <ReadOnlyCell key={wk.weekOffset} value="—" className="text-black" />;
                  const slaTarget = isDedicated
                    ? (activeChannel === "voice" ? slaVoiceTarget : slaChatTarget)
                    : slaVoiceTarget;
                  const color = sl >= slaTarget ? "text-black dark:text-black" : "text-black dark:text-black";
                  return (
                    <td key={wk.weekOffset} className={`px-2 py-1 text-right text-xs font-semibold whitespace-nowrap ${color}`}>
                      {fmtPct(sl)}
                    </td>
                  );
                })}
              </tr>

            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 flex-wrap text-[11px] text-black">
        <span className="flex items-center gap-1"><span className="inline-block size-3 rounded bg-amber-100 dark:bg-amber-950/40 border border-amber-300" /> Manually overridden (click ↺ to restore auto)</span>
        <span className="flex items-center gap-1"><span className="inline-block size-3 rounded bg-blue-100 dark:bg-blue-950/40 border border-blue-300" /> Planned Hires</span>
        <span className="flex items-center gap-1"><span className="inline-block size-3 rounded bg-orange-100 dark:bg-orange-950/40 border border-orange-300" /> Known Exits</span>
        <span className="flex items-center gap-1"><span className="inline-block size-3 rounded bg-green-100 dark:bg-green-950/40 border border-green-300" /> Actual HC</span>
      </div>
    </PageLayout>
  );
}

