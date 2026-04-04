import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import { useLOB } from "../lib/lobContext";
import { TrendingUp, Clock, Users, Settings2, ChevronRight, ChevronDown, Save, Plus, Loader2, Calendar, Info, ShieldAlert, LayoutDashboard, Trash2, RotateCcw, CircleHelp, LineChart as LineChartIcon, Pencil, X } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Switch } from "../components/ui/switch";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { toast } from "sonner";
import { calculateYoY, calculateMovingAverage, calculateLinearRegression, calculateHoltWinters, calculateDecomposition, calculateARIMA } from "./forecasting-logic";
import { buildDemandHelpPrintHtml, demandForecastHelpSections } from "./LongTermForecasting_Demand.help";

type ShrinkageFrequency = "per_day" | "per_week" | "per_month" | "per_year";
interface ShrinkageItem {
  id: string;
  label: string;
  enabled: boolean;
  durationMinutes: number;
  occurrences: number;
  frequency: ShrinkageFrequency;
}
interface Assumptions {
  startDate: string;
  aht: number;
  emailAht: number;
  chatAht: number;
  chatConcurrency: number;
  shrinkage: number;
  shrinkageSource: "manual" | "planner_excl" | "planner_incl";
  voiceSlaTarget: number;
  voiceSlaAnswerSeconds: number;
  voiceAsaTargetSeconds: number;
  emailSlaTarget: number;
  emailSlaAnswerSeconds: number;
  emailAsaTargetSeconds: number;
  chatSlaTarget: number;
  chatSlaAnswerSeconds: number;
  chatAsaTargetSeconds: number;
  occupancy: number;
  growthRate: number;
  safetyMargin: number;
  currency: string;
  annualSalary: number;
  onboardingCost: number;
  fteMonthlyHours: number;
  operatingHoursPerDay: number;
  operatingDaysPerWeek: number;
  useManualVolume: boolean;
  manualHistoricalData: number[];
  useShrinkageModeler?: boolean;
  shrinkageItems?: ShrinkageItem[];
}
interface DemandForecastData { month: string; year: string; isFuture: boolean; volume: number; workloadHours: number; aht: number; occupancy: number; shrinkage: number; requiredFTE: number; actualVolume: number | null; forecastVolume: number | null; historicalVolume: number; }
interface PlannerSnapshot {
  assumptions: Assumptions;
  forecastMethod: string;
  hwParams: { alpha: number; beta: number; gamma: number; seasonLength: number };
  arimaParams: { p: number; d: number; q: number };
  decompParams: { trendStrength: number; seasonalityStrength: number };
  historicalOverrides: Record<number, string>;
  channelHistoricalOverrides: Record<ChannelKey, Record<number, string>>;
  channelHistoricalApiData: Record<ChannelKey, number[]>;
  activeBlendPreset?: BlendPresetId;
  selectedChannels: Record<ChannelKey, boolean>;
  poolingMode: PoolingMode;
  isHistoricalSourceOpen: boolean;
  isBlendedStaffingOpen: boolean;
  selectedHistoricalChannel: ChannelKey;
}
interface Scenario { id: string; name: string; assumptions: Assumptions; snapshot: PlannerSnapshot; }
interface HistoricalSourceRow { index: number; monthLabel: string; apiVolume: number; overrideVolume: string; finalVolume: number; variancePct: number | null; isOverridden: boolean; canEdit: boolean; stateLabel: "API" | "Editing" | "Manual"; }
interface DemandPlannerScenarioRecord { scenario_id: string; scenario_name: string; planner_snapshot: Partial<PlannerSnapshot>; }
interface LongTermActualRecord { year_index: number; month_index: number; volume: number; }
type ChannelKey = "voice" | "email" | "chat";
type PoolingMode = "dedicated" | "blended";
type BlendPresetId = "voice-only" | "voice-email" | "voice-chat" | "email-chat" | "all-blended" | "dedicated";
interface BlendPreset { id: BlendPresetId; label: string; description: string; pools: ChannelKey[][]; }
interface BlendConfiguration { label: string; description: string; pools: ChannelKey[][]; includedChannels: ChannelKey[]; poolingMode: PoolingMode; }
interface PoolSummary { poolName: string; channels: ChannelKey[]; workloadHours: number; fte: number; isShared: boolean; }
interface ChannelStaffingMetrics {
  channel: ChannelKey;
  model: string;
  volume: number;
  workloadHours: number;
  intensity: number;
  rawAgents: number;
  requiredOccupancy: number;
  requiredFTE: number;
  achievedServiceLevel: number;
}
interface ChannelMixEntry {
  channel: ChannelKey;
  volume: number;
  workloadHours: number;
  ahtSeconds: number;
}
interface ErlangCStaffingInputs {
  volume: number;
  ahtSeconds: number;
  targetServiceLevelPct: number;
  targetAnswerTimeSeconds: number;
  intervalHours: number;
}
interface ErlangCStaffingResult {
  intensity: number;
  agents: number;
  occupancyPct: number;
  serviceLevelPct: number;
  waitProbability: number;
}
interface BlendedFteInputs {
  voiceVolume: number;
  voiceAhtSeconds: number;
  voiceTargetServiceLevelPct: number;
  voiceTargetAnswerTimeSeconds: number;
  chatVolume: number;
  chatAhtSeconds: number;
  chatConcurrency: number;
  emailVolume: number;
  emailAhtSeconds: number;
  intervalHours: number;
  shrinkagePct: number;
  safetyMarginPct?: number;
}
interface BlendedFteResult {
  voiceErlang: ErlangCStaffingResult;
  baseVoiceStaff: number;
  voiceWorkloadHours: number;
  voiceAvailableHours: number;
  voiceIdleHours: number;
  rawChatWorkloadHours: number;
  concurrentChatWorkloadHours: number;
  netChatWorkloadHours: number;
  remainingIdleHours: number;
  emailWorkloadHours: number;
  netEmailWorkloadHours: number;
  chatEquivalentStaff: number;
  emailEquivalentStaff: number;
  totalBaseStaff: number;
  totalFteAfterShrinkage: number;
  totalFteWithSafetyMargin: number;
}
interface VolumeTrendSeriesMeta {
  key: string;
  label: string;
  stroke: string;
  isForecast: boolean;
}
interface FutureStaffingRow extends DemandForecastData {
  activeBlendPreset: string;
  sharedPoolWorkload: number;
  sharedPoolFTE: number;
  standalonePoolFTE: number;
  totalRequiredFTE: number;
  pools: PoolSummary[];
  channelMetrics: Record<ChannelKey, ChannelStaffingMetrics>;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_SHRINKAGE_ITEMS: ShrinkageItem[] = [
  { id: "breaks", label: "Breaks", enabled: true, durationMinutes: 15, occurrences: 2, frequency: "per_day" },
  { id: "lunch", label: "Lunch", enabled: true, durationMinutes: 30, occurrences: 1, frequency: "per_day" },
  { id: "training", label: "Training", enabled: true, durationMinutes: 120, occurrences: 1, frequency: "per_month" },
  { id: "coaching", label: "Coaching / 1:1", enabled: true, durationMinutes: 30, occurrences: 1, frequency: "per_month" },
  { id: "meetings", label: "Meetings", enabled: true, durationMinutes: 60, occurrences: 1, frequency: "per_week" },
  { id: "annual_leave", label: "Annual Leave", enabled: true, durationMinutes: 480, occurrences: 15, frequency: "per_year" },
  { id: "sick_leave", label: "Sick Leave", enabled: true, durationMinutes: 480, occurrences: 5, frequency: "per_year" },
];
const SHRINKAGE_FREQUENCY_OPTIONS: { value: ShrinkageFrequency; label: string }[] = [
  { value: "per_day", label: "/ Day" },
  { value: "per_week", label: "/ Week" },
  { value: "per_month", label: "/ Month" },
  { value: "per_year", label: "/ Year" },
];
const computeShrinkageFromItems = (items: ShrinkageItem[], operatingHoursPerDay: number, operatingDaysPerWeek: number): number => {
  const daysPerYear = operatingDaysPerWeek * 52;
  const minutesPerYear = operatingHoursPerDay * 60 * daysPerYear;
  if (minutesPerYear <= 0) return 0;
  const totalLostMinutes = items.filter((item) => item.enabled).reduce((sum, item) => {
    const annualOccurrences = item.frequency === "per_day" ? item.occurrences * daysPerYear
      : item.frequency === "per_week" ? item.occurrences * 52
      : item.frequency === "per_month" ? item.occurrences * 12
      : item.occurrences;
    return sum + annualOccurrences * item.durationMinutes;
  }, 0);
  return Math.min(99, Number(((totalLostMinutes / minutesPerYear) * 100).toFixed(1)));
};
const FORECAST_METHODS = [{ key: "holtwinters", label: "Holt-Winters (Triple Exponential Smoothing)" }, { key: "arima", label: "ARIMA (simplified version)" }, { key: "decomposition", label: "Decomposition (Trend + Seasonality)" }, { key: "ma", label: "Moving Average (baseline fallback)" }, { key: "genesys", label: "Direct Genesys Sync" }, { key: "yoy", label: "Year-over-Year Growth" }, { key: "regression", label: "Linear Regression" }];
const DEFAULT_ASSUMPTIONS: Assumptions = {
  startDate: "2026-01-01",
  aht: 300,
  emailAht: 600,
  chatAht: 450,
  chatConcurrency: 2,
  shrinkage: 25,
  shrinkageSource: "manual",
  voiceSlaTarget: 80,
  voiceSlaAnswerSeconds: 20,
  voiceAsaTargetSeconds: 15,
  emailSlaTarget: 90,
  emailSlaAnswerSeconds: 14400,
  emailAsaTargetSeconds: 3600,
  chatSlaTarget: 80,
  chatSlaAnswerSeconds: 30,
  chatAsaTargetSeconds: 20,
  occupancy: 85,
  growthRate: 5,
  safetyMargin: 5,
  currency: "USD",
  annualSalary: 45000,
  onboardingCost: 5000,
  fteMonthlyHours: 166.67,
  operatingHoursPerDay: 8,
  operatingDaysPerWeek: 5,
  useManualVolume: false,
  manualHistoricalData: new Array(12).fill(10000),
  useShrinkageModeler: false,
  shrinkageItems: DEFAULT_SHRINKAGE_ITEMS,
};
const EMPTY_CHANNEL_DATA: Record<ChannelKey, number[]> = { voice: [], email: [], chat: [] };
const EMPTY_CHANNEL_OVERRIDES: Record<ChannelKey, Record<number, string>> = { voice: {}, email: {}, chat: {} };
const DEFAULT_SELECTED_CHANNELS: Record<ChannelKey, boolean> = { voice: true, email: true, chat: true };
const DEFAULT_HISTORY_MONTHS = 12;
const DEFAULT_SCENARIOS: Record<string, Scenario> = {
  base: createScenario("base", "Base Case (Steady)", buildPlannerSnapshot({ ...DEFAULT_ASSUMPTIONS }, "holtwinters", { alpha: 0.3, beta: 0.1, gamma: 0.3, seasonLength: 12 }, { p: 1, d: 1, q: 1 }, { trendStrength: 1, seasonalityStrength: 1 }, EMPTY_CHANNEL_DATA, EMPTY_CHANNEL_OVERRIDES, DEFAULT_SELECTED_CHANNELS, "blended", false, "voice")),
  "scenario-a": createScenario("scenario-a", "Scenario A (High Growth)", buildPlannerSnapshot({ ...DEFAULT_ASSUMPTIONS, growthRate: 15 }, "holtwinters", { alpha: 0.3, beta: 0.1, gamma: 0.3, seasonLength: 12 }, { p: 1, d: 1, q: 1 }, { trendStrength: 1, seasonalityStrength: 1 }, EMPTY_CHANNEL_DATA, EMPTY_CHANNEL_OVERRIDES, DEFAULT_SELECTED_CHANNELS, "blended", false, "voice")),
  "scenario-b": createScenario("scenario-b", "Scenario B (Efficiency)", buildPlannerSnapshot({ ...DEFAULT_ASSUMPTIONS, occupancy: 90, safetyMargin: 3 }, "holtwinters", { alpha: 0.3, beta: 0.1, gamma: 0.3, seasonLength: 12 }, { p: 1, d: 1, q: 1 }, { trendStrength: 1, seasonalityStrength: 1 }, EMPTY_CHANNEL_DATA, EMPTY_CHANNEL_OVERRIDES, DEFAULT_SELECTED_CHANNELS, "blended", false, "voice")),
};
const BLEND_PRESETS: BlendPreset[] = [
  { id: "voice-only", label: "Voice only", description: "Only voice is included in the staffed pool", pools: [["voice"]] },
  { id: "voice-email", label: "Voice + Email", description: "Blend voice and email; exclude chat", pools: [["voice", "email"]] },
  { id: "voice-chat", label: "Voice + Chat", description: "Blend voice and chat; exclude email", pools: [["voice", "chat"]] },
  { id: "email-chat", label: "Email + Chat", description: "Blend email and chat; exclude voice", pools: [["email", "chat"]] },
  { id: "all-blended", label: "Voice + Email + Chat", description: "All selected channels share one agent pool", pools: [["voice", "email", "chat"]] },
  { id: "dedicated", label: "Dedicated per channel", description: "No channel blending across staffing pools", pools: [["voice"], ["email"], ["chat"]] },
];
const CHANNEL_VOLUME_FACTORS: Record<ChannelKey, number> = { voice: 1, email: 0.2, chat: 0.3 };
const EMAIL_AHT_SECONDS = 600;
const CHAT_AHT_SECONDS = 450;
const CHAT_CONCURRENCY = 2;
const WEEKS_PER_MONTH = 52.143 / 12;
const VOLUME_TREND_ACTUAL_COLORS = ["#6b9f97", "#9b8ac9", "#d3a37f", "#7ba2d6", "#cf8d8d", "#7cb2bf"];
const VOLUME_TREND_FORECAST_COLORS = ["#1d4ed8", "#4f46e5", "#0f766e"];
const CHANNEL_ASSUMPTION_META: Record<ChannelKey, { label: string; colorClass: string; bgClass: string }> = {
  voice: { label: "Voice", colorClass: "text-sky-700 dark:text-sky-300", bgClass: "bg-sky-50 dark:bg-sky-950/30" },
  email: { label: "Email", colorClass: "text-emerald-700 dark:text-emerald-300", bgClass: "bg-emerald-50 dark:bg-emerald-950/30" },
  chat: { label: "Chat", colorClass: "text-amber-700 dark:text-amber-300", bgClass: "bg-amber-50 dark:bg-amber-950/30" },
};
const USER_INPUTS_STORAGE_KEY = "lt_forecast_demand_user_inputs";
const SCENARIOS_STORAGE_KEY = "lt_forecast_demand_scenarios";

const validateInput = (value: number, min = 0, max = Infinity) => Math.max(min, Math.min(max, value));
const formatInteger = (value: number) => value.toLocaleString();
const getOpenHoursPerMonth = (assumptions: Assumptions) => assumptions.operatingHoursPerDay * assumptions.operatingDaysPerWeek * WEEKS_PER_MONTH;
const getOpenSecondsPerMonth = (assumptions: Assumptions) => getOpenHoursPerMonth(assumptions) * 3600;
const getOpenSecondsPerDay = (assumptions: Assumptions) => assumptions.operatingHoursPerDay * 3600;
const getBusinessDaysPerMonth = (assumptions: Assumptions) => assumptions.operatingDaysPerWeek * WEEKS_PER_MONTH;
const getChannelModelLabel = (channel: ChannelKey, chatConcurrency = CHAT_CONCURRENCY) => {
  if (channel === "chat") return `Modified Erlang C (${chatConcurrency} concurrent chats)`;
  if (channel === "email") return "Deferred backlog model";
  return "Erlang C";
};
const roundTo = (value: number, digits: number) => Number(value.toFixed(digits));
function normalizeSelectedChannels(value?: Partial<Record<ChannelKey, boolean>> | null): Record<ChannelKey, boolean> {
  const normalized = {
    voice: Boolean(value?.voice),
    email: Boolean(value?.email),
    chat: Boolean(value?.chat),
  };
  if (!normalized.voice && !normalized.email && !normalized.chat) return { voice: true, email: false, chat: false };
  return normalized;
}
function getIncludedChannelsFromSelection(selectedChannels: Record<ChannelKey, boolean>): ChannelKey[] {
  return (["voice", "email", "chat"] as ChannelKey[]).filter((channel) => selectedChannels[channel]);
}
function getLegacyBlendPresetId(selectedChannels: Record<ChannelKey, boolean>, poolingMode: PoolingMode): BlendPresetId | undefined {
  const normalized = normalizeSelectedChannels(selectedChannels);
  const included = getIncludedChannelsFromSelection(normalized);
  if (poolingMode === "dedicated" && normalized.voice && normalized.email && normalized.chat) return "dedicated";
  if (included.length === 1 && included[0] === "voice") return "voice-only";
  if (poolingMode === "blended" && included.length === 2 && included.includes("voice") && included.includes("email")) return "voice-email";
  if (poolingMode === "blended" && included.length === 2 && included.includes("voice") && included.includes("chat")) return "voice-chat";
  if (poolingMode === "blended" && included.length === 2 && included.includes("email") && included.includes("chat")) return "email-chat";
  if (poolingMode === "blended" && included.length === 3) return "all-blended";
  return undefined;
}
function getBlendStateFromLegacyPreset(presetId?: BlendPresetId): { selectedChannels: Record<ChannelKey, boolean>; poolingMode: PoolingMode } {
  switch (presetId) {
    case "voice-only":
      return { selectedChannels: { voice: true, email: false, chat: false }, poolingMode: "blended" };
    case "voice-email":
      return { selectedChannels: { voice: true, email: true, chat: false }, poolingMode: "blended" };
    case "voice-chat":
      return { selectedChannels: { voice: true, email: false, chat: true }, poolingMode: "blended" };
    case "email-chat":
      return { selectedChannels: { voice: false, email: true, chat: true }, poolingMode: "blended" };
    case "dedicated":
      return { selectedChannels: { voice: true, email: true, chat: true }, poolingMode: "dedicated" };
    case "all-blended":
    default:
      return { selectedChannels: { voice: true, email: true, chat: true }, poolingMode: "blended" };
  }
}
function buildBlendConfiguration(selectedChannels: Record<ChannelKey, boolean>, poolingMode: PoolingMode): BlendConfiguration {
  const normalizedChannels = normalizeSelectedChannels(selectedChannels);
  const includedChannels = getIncludedChannelsFromSelection(normalizedChannels);
  const channelLabel = includedChannels.map((channel) => channel.charAt(0).toUpperCase() + channel.slice(1)).join(" + ");
  if (includedChannels.length === 1) {
    return {
      label: `${channelLabel} only`,
      description: `Only ${includedChannels[0]} is included in the staffed view`,
      pools: [includedChannels],
      includedChannels,
      poolingMode,
    };
  }
  if (poolingMode === "dedicated") {
    return {
      label: includedChannels.length === 3 ? "Dedicated per channel" : `${channelLabel} dedicated`,
      description: "Selected channels stay in separate staffing pools",
      pools: includedChannels.map((channel) => [channel]),
      includedChannels,
      poolingMode,
    };
  }
  return {
    label: `${channelLabel} blended`,
    description: "Selected channels share one agent pool",
    pools: [includedChannels],
    includedChannels,
    poolingMode,
  };
}
const factorial = (value: number): number => {
  if (!Number.isInteger(value) || value < 0) return NaN;
  let result = 1;
  for (let i = 2; i <= value; i++) {
    result *= i;
    if (!Number.isFinite(result)) return Infinity;
  }
  return result;
};
const poissonTerm = (intensity: number, agents: number): number => {
  if (!Number.isFinite(intensity) || intensity < 0 || !Number.isInteger(agents) || agents < 0) return 0;
  if (agents === 0) return 1;
  const powerTerm = intensity ** agents;
  const factorialTerm = factorial(agents);
  if (Number.isFinite(powerTerm) && Number.isFinite(factorialTerm) && factorialTerm > 0) {
    return powerTerm / factorialTerm;
  }
  let iterativeTerm = 1;
  for (let i = 1; i <= agents; i++) {
    iterativeTerm *= intensity / i;
  }
  return iterativeTerm;
};
const occupancyFromIntensity = (intensity: number, agents: number): number => (
  agents > 0 ? intensity / agents : 0
);
const getChannelServiceTargets = (assumptions: Assumptions, channel: ChannelKey) => {
  if (channel === "email") {
    return {
      slaTarget: assumptions.emailSlaTarget,
      slaAnswerSeconds: assumptions.emailSlaAnswerSeconds,
      asaTargetSeconds: assumptions.emailAsaTargetSeconds,
    };
  }
  if (channel === "chat") {
    return {
      slaTarget: assumptions.chatSlaTarget,
      slaAnswerSeconds: assumptions.chatSlaAnswerSeconds,
      asaTargetSeconds: assumptions.chatAsaTargetSeconds,
    };
  }
  return {
    slaTarget: assumptions.voiceSlaTarget,
    slaAnswerSeconds: assumptions.voiceSlaAnswerSeconds,
    asaTargetSeconds: assumptions.voiceAsaTargetSeconds,
  };
};
const getChannelAhtSeconds = (assumptions: Assumptions, channel: ChannelKey) => {
  if (channel === "email") return assumptions.emailAht;
  if (channel === "chat") return assumptions.chatAht;
  return assumptions.aht;
};
const getChannelEffectiveAhtSeconds = (assumptions: Assumptions, channel: ChannelKey) => (
  channel === "chat" ? assumptions.chatAht / Math.max(1, assumptions.chatConcurrency) : getChannelAhtSeconds(assumptions, channel)
);
const getChannelWorkloadHours = (channel: ChannelKey, volume: number, assumptions: Assumptions) => (
  volume <= 0 ? 0 : roundTo((volume * getChannelEffectiveAhtSeconds(assumptions, channel)) / 3600, 1)
);
function erlangC(intensity: number, agents: number): number {
  const agentCount = Math.max(0, Math.floor(agents));
  if (agentCount <= 0 || intensity <= 0) return 0;
  const occupancy = occupancyFromIntensity(intensity, agentCount);
  if (occupancy >= 1) return 1;
  let denominator = 0;
  for (let i = 0; i < agentCount; i++) {
    denominator += poissonTerm(intensity, i);
  }
  const delayedTerm = poissonTerm(intensity, agentCount) * (1 / (1 - occupancy));
  if (denominator + delayedTerm <= 0) return 1;
  return Math.min(1, Math.max(0, delayedTerm / (denominator + delayedTerm)));
}
function computeServiceLevel(intensity: number, agents: number, ahtSeconds: number, answerSeconds: number): number {
  if (agents <= intensity) return 0;
  return 1 - erlangC(intensity, agents) * Math.exp(-((agents - intensity) * answerSeconds) / ahtSeconds);
}
function minAgentsForServiceLevel(intensity: number, ahtSeconds: number, answerSeconds: number, targetServiceLevel: number): number {
  let agents = Math.max(1, Math.floor(intensity) + 1);
  for (let i = 0; i < 500; i++) {
    if (computeServiceLevel(intensity, agents, ahtSeconds, answerSeconds) >= targetServiceLevel) return agents;
    agents += 1;
  }
  return agents;
}
export const calculateErlangCStaffing = ({
  volume,
  ahtSeconds,
  targetServiceLevelPct,
  targetAnswerTimeSeconds,
  intervalHours,
}: ErlangCStaffingInputs): ErlangCStaffingResult => {
  const safeIntervalHours = Math.max(intervalHours, 0);
  const safeAhtSeconds = Math.max(ahtSeconds, 0);
  if (volume <= 0 || safeAhtSeconds <= 0 || safeIntervalHours <= 0) {
    return { intensity: 0, agents: 0, occupancyPct: 0, serviceLevelPct: 0, waitProbability: 0 };
  }
  const intervalSeconds = safeIntervalHours * 3600;
  const intensity = (volume * safeAhtSeconds) / intervalSeconds;
  if (intensity <= 0) {
    return { intensity: 0, agents: 0, occupancyPct: 0, serviceLevelPct: 0, waitProbability: 0 };
  }
  const agents = minAgentsForServiceLevel(
    intensity,
    safeAhtSeconds,
    Math.max(targetAnswerTimeSeconds, 1),
    validateInput(targetServiceLevelPct, 0, 100) / 100,
  );
  const waitProbability = erlangC(intensity, agents);
  const serviceLevelPct = computeServiceLevel(intensity, agents, safeAhtSeconds, Math.max(targetAnswerTimeSeconds, 1)) * 100;
  return {
    intensity: roundTo(intensity, 3),
    agents,
    occupancyPct: roundTo(occupancyFromIntensity(intensity, agents) * 100, 1),
    serviceLevelPct: roundTo(serviceLevelPct, 1),
    waitProbability: roundTo(waitProbability * 100, 1),
  };
};
export const calculateBlendedTriChannelRequirement = ({
  voiceVolume,
  voiceAhtSeconds,
  voiceTargetServiceLevelPct,
  voiceTargetAnswerTimeSeconds,
  chatVolume,
  chatAhtSeconds,
  chatConcurrency,
  emailVolume,
  emailAhtSeconds,
  intervalHours,
  shrinkagePct,
  safetyMarginPct = 0,
}: BlendedFteInputs): BlendedFteResult => {
  const safeIntervalHours = Math.max(intervalHours, 0);
  const safeShrinkageFactor = 1 - shrinkagePct / 100;
  const safeChatConcurrency = chatConcurrency > 0 ? chatConcurrency : 1;
  const voiceErlang = calculateErlangCStaffing({
    volume: voiceVolume,
    ahtSeconds: voiceAhtSeconds,
    targetServiceLevelPct: voiceTargetServiceLevelPct,
    targetAnswerTimeSeconds: voiceTargetAnswerTimeSeconds,
    intervalHours: safeIntervalHours,
  });
  const baseVoiceStaff = voiceErlang.agents;
  const voiceWorkloadHours = Math.max(0, (voiceVolume * Math.max(voiceAhtSeconds, 0)) / 3600);
  const voiceAvailableHours = baseVoiceStaff * safeIntervalHours;
  const voiceIdleHours = Math.max(0, voiceAvailableHours - voiceWorkloadHours);
  const rawChatWorkloadHours = Math.max(0, (chatVolume * Math.max(chatAhtSeconds, 0)) / 3600);
  const concurrentChatWorkloadHours = rawChatWorkloadHours / safeChatConcurrency;
  const netChatWorkloadHours = Math.max(0, concurrentChatWorkloadHours - voiceIdleHours);
  const remainingIdleHours = Math.max(0, voiceIdleHours - concurrentChatWorkloadHours);
  const emailWorkloadHours = Math.max(0, (emailVolume * Math.max(emailAhtSeconds, 0)) / 3600);
  const netEmailWorkloadHours = Math.max(0, emailWorkloadHours - remainingIdleHours);
  const chatEquivalentStaff = safeIntervalHours > 0 ? netChatWorkloadHours / safeIntervalHours : 0;
  const emailEquivalentStaff = safeIntervalHours > 0 ? netEmailWorkloadHours / safeIntervalHours : 0;
  const totalBaseStaff = baseVoiceStaff + chatEquivalentStaff + emailEquivalentStaff;
  const totalFteAfterShrinkage = safeShrinkageFactor > 0 ? totalBaseStaff / safeShrinkageFactor : 9999.9;
  const totalFteWithSafetyMargin = Number.isFinite(totalFteAfterShrinkage)
    ? totalFteAfterShrinkage * (1 + Math.max(safetyMarginPct, 0) / 100)
    : 9999.9;
  return {
    voiceErlang,
    baseVoiceStaff,
    voiceWorkloadHours: roundTo(voiceWorkloadHours, 3),
    voiceAvailableHours: roundTo(voiceAvailableHours, 3),
    voiceIdleHours: roundTo(voiceIdleHours, 3),
    rawChatWorkloadHours: roundTo(rawChatWorkloadHours, 3),
    concurrentChatWorkloadHours: roundTo(concurrentChatWorkloadHours, 3),
    netChatWorkloadHours: roundTo(netChatWorkloadHours, 3),
    remainingIdleHours: roundTo(remainingIdleHours, 3),
    emailWorkloadHours: roundTo(emailWorkloadHours, 3),
    netEmailWorkloadHours: roundTo(netEmailWorkloadHours, 3),
    chatEquivalentStaff: roundTo(chatEquivalentStaff, 3),
    emailEquivalentStaff: roundTo(emailEquivalentStaff, 3),
    totalBaseStaff: roundTo(totalBaseStaff, 3),
    totalFteAfterShrinkage: roundTo(totalFteAfterShrinkage, 3),
    totalFteWithSafetyMargin: roundTo(totalFteWithSafetyMargin, 3),
  };
};
// Example with 3.0 concurrent chats:
// calculateBlendedTriChannelRequirement({
//   voiceVolume: 9600,
//   voiceAhtSeconds: 300,
//   voiceTargetServiceLevelPct: 80,
//   voiceTargetAnswerTimeSeconds: 20,
//   chatVolume: 7200,
//   chatAhtSeconds: 420,
//   chatConcurrency: 3,
//   emailVolume: 5400,
//   emailAhtSeconds: 480,
//   intervalHours: 160,
//   shrinkagePct: 25,
// });
const getGrossRequiredFTE = (rawAgents: number, assumptions: Assumptions) => {
  const shrinkageFactor = 1 - assumptions.shrinkage / 100;
  const staffedHoursPerSeat = getOpenHoursPerMonth(assumptions);
  const productiveHoursPerFte = assumptions.fteMonthlyHours * shrinkageFactor;
  if (rawAgents <= 0 || staffedHoursPerSeat <= 0 || productiveHoursPerFte <= 0) return 9999.9;
  return roundTo(((rawAgents * staffedHoursPerSeat) / productiveHoursPerFte) * (1 + assumptions.safetyMargin / 100), 1);
};
const getZeroChannelStaffingMetrics = (channel: ChannelKey, volume = 0, workloadHours = 0, chatConcurrency = CHAT_CONCURRENCY): ChannelStaffingMetrics => ({
  channel,
  model: getChannelModelLabel(channel, chatConcurrency),
  volume,
  workloadHours,
  intensity: 0,
  rawAgents: 0,
  requiredOccupancy: 0,
  requiredFTE: 0,
  achievedServiceLevel: 0,
});
const getChannelStaffingMetrics = (
  channel: ChannelKey,
  volume: number,
  assumptions: Assumptions,
): ChannelStaffingMetrics => {
  const chatConcurrency = Math.max(1, assumptions.chatConcurrency);
  const workloadHours = getChannelWorkloadHours(channel, volume, assumptions);
  if (workloadHours <= 0 || volume <= 0) return getZeroChannelStaffingMetrics(channel, volume, workloadHours, chatConcurrency);
  const openSecondsPerMonth = getOpenSecondsPerMonth(assumptions);
  if (openSecondsPerMonth <= 0 || assumptions.fteMonthlyHours <= 0) {
    return {
      ...getZeroChannelStaffingMetrics(channel, volume, workloadHours, chatConcurrency),
      rawAgents: 9999.9,
      requiredFTE: 9999.9,
    };
  }
  const serviceTargets = getChannelServiceTargets(assumptions, channel);
  if (channel === "email") {
    const intensity = (volume * assumptions.emailAht) / openSecondsPerMonth;
    const businessDaysPerMonth = Math.max(getBusinessDaysPerMonth(assumptions), 1);
    const dailyVolume = volume / businessDaysPerMonth;
    const dailyWorkloadSeconds = dailyVolume * assumptions.emailAht;
    const responseWindowSeconds = Math.max(Math.min(serviceTargets.slaAnswerSeconds, openSecondsPerMonth), assumptions.emailAht);
    const sameDayWindowSeconds = Math.max(Math.min(responseWindowSeconds, getOpenSecondsPerDay(assumptions)), assumptions.emailAht);
    const clearanceAgents = Math.max(1, Math.ceil(intensity));
    const backlogAgents = Math.max(1, Math.ceil((dailyWorkloadSeconds * (serviceTargets.slaTarget / 100)) / responseWindowSeconds));
    const rawAgents = Math.max(clearanceAgents, backlogAgents);
    const requiredOccupancy = rawAgents > 0 ? (intensity / rawAgents) * 100 : 0;
    const achievableServiceLevel = dailyWorkloadSeconds <= 0 ? 0 : Math.min(100, ((rawAgents * sameDayWindowSeconds) / dailyWorkloadSeconds) * 100);
    return {
      channel,
      model: getChannelModelLabel(channel, chatConcurrency),
      volume,
      workloadHours,
      intensity: roundTo(intensity, 2),
      rawAgents,
      requiredOccupancy: roundTo(requiredOccupancy, 1),
      requiredFTE: getGrossRequiredFTE(rawAgents, assumptions),
      achievedServiceLevel: roundTo(achievableServiceLevel, 1),
    };
  }
  const effectiveAhtSeconds = getChannelEffectiveAhtSeconds(assumptions, channel);
  const erlangStaffing = calculateErlangCStaffing({
    volume,
    ahtSeconds: effectiveAhtSeconds,
    targetServiceLevelPct: serviceTargets.slaTarget,
    targetAnswerTimeSeconds: serviceTargets.slaAnswerSeconds,
    intervalHours: getOpenHoursPerMonth(assumptions),
  });
  return {
    channel,
    model: getChannelModelLabel(channel, chatConcurrency),
    volume,
    workloadHours,
    intensity: roundTo(erlangStaffing.intensity, 2),
    rawAgents: erlangStaffing.agents,
    requiredOccupancy: erlangStaffing.occupancyPct,
    requiredFTE: getGrossRequiredFTE(erlangStaffing.agents, assumptions),
    achievedServiceLevel: erlangStaffing.serviceLevelPct,
  };
};
function normalizeHistoricalOverrides(value: unknown): Record<number, string> {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<number, string>>((acc, [key, raw]) => {
    const numericKey = Number(key);
    if (Number.isInteger(numericKey) && typeof raw === "string") acc[numericKey] = raw;
    return acc;
  }, {});
}
function normalizeBlendPreset(value: unknown): BlendPresetId { return BLEND_PRESETS.some((preset) => preset.id === value) ? value as BlendPresetId : "all-blended"; }
function cloneAssumptions(assumptions: Assumptions): Assumptions {
  return {
    ...assumptions,
    manualHistoricalData: [...assumptions.manualHistoricalData],
    shrinkageItems: (assumptions.shrinkageItems ?? DEFAULT_SHRINKAGE_ITEMS).map((item) => ({ ...item })),
  };
}
function getChannelHistoryLength(apiData: number[], overrides: Record<number, string>): number {
  const overrideIndexes = Object.keys(overrides).map((key) => Number(key)).filter(Number.isInteger);
  const highestOverrideIndex = overrideIndexes.length > 0 ? Math.max(...overrideIndexes) + 1 : 0;
  return Math.max(DEFAULT_HISTORY_MONTHS, apiData.length, highestOverrideIndex);
}
function buildChannelHistoricalData(apiData: number[], overrides: Record<number, string>): number[] {
  const historyLength = getChannelHistoryLength(apiData, overrides);
  return Array.from({ length: historyLength }, (_, index) => {
    const apiVolume = apiData[index] ?? 0;
    const overrideValue = overrides[index];
    if (overrideValue === undefined || overrideValue === "") return apiVolume;
    const parsedValue = Number.parseInt(overrideValue, 10);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : apiVolume;
  });
}
function buildPlannerSnapshot(
  assumptions: Assumptions,
  forecastMethod: string,
  hwParams: { alpha: number; beta: number; gamma: number; seasonLength: number },
  arimaParams: { p: number; d: number; q: number },
  decompParams: { trendStrength: number; seasonalityStrength: number },
  channelHistoricalApiData: Record<ChannelKey, number[]>,
  channelHistoricalOverrides: Record<ChannelKey, Record<number, string>>,
  selectedChannels: Record<ChannelKey, boolean>,
  poolingMode: PoolingMode,
  isHistoricalSourceOpen: boolean,
  isBlendedStaffingOpen: boolean,
  selectedHistoricalChannel: ChannelKey,
): PlannerSnapshot {
  const normalizedChannels = normalizeSelectedChannels(selectedChannels);
  return {
    assumptions: cloneAssumptions(assumptions),
    forecastMethod,
    hwParams: { ...hwParams },
    arimaParams: { ...arimaParams },
    decompParams: { ...decompParams },
    historicalOverrides: { ...channelHistoricalOverrides.voice },
    channelHistoricalOverrides: {
      voice: { ...channelHistoricalOverrides.voice },
      email: { ...channelHistoricalOverrides.email },
      chat: { ...channelHistoricalOverrides.chat },
    },
    channelHistoricalApiData: {
      voice: [...channelHistoricalApiData.voice],
      email: [...channelHistoricalApiData.email],
      chat: [...channelHistoricalApiData.chat],
    },
    activeBlendPreset: getLegacyBlendPresetId(normalizedChannels, poolingMode),
    selectedChannels: normalizedChannels,
    poolingMode,
    isHistoricalSourceOpen,
    isBlendedStaffingOpen,
    selectedHistoricalChannel,
  };
}
function createScenario(id: string, name: string, snapshot: PlannerSnapshot): Scenario { return ({
  id,
  name,
  assumptions: cloneAssumptions(snapshot.assumptions),
  snapshot: {
    ...snapshot,
    assumptions: cloneAssumptions(snapshot.assumptions),
    hwParams: { ...snapshot.hwParams },
    arimaParams: { ...snapshot.arimaParams },
    decompParams: { ...snapshot.decompParams },
    historicalOverrides: { ...snapshot.historicalOverrides },
    channelHistoricalOverrides: {
      voice: { ...snapshot.channelHistoricalOverrides.voice },
      email: { ...snapshot.channelHistoricalOverrides.email },
      chat: { ...snapshot.channelHistoricalOverrides.chat },
    },
    channelHistoricalApiData: {
      voice: [...(snapshot.channelHistoricalApiData?.voice || [])],
      email: [...(snapshot.channelHistoricalApiData?.email || [])],
      chat: [...(snapshot.channelHistoricalApiData?.chat || [])],
    },
    selectedChannels: { ...snapshot.selectedChannels },
    poolingMode: snapshot.poolingMode,
    isBlendedStaffingOpen: snapshot.isBlendedStaffingOpen,
    selectedHistoricalChannel: snapshot.selectedHistoricalChannel,
  },
}); }
function normalizeScenario(value: unknown, fallbackId: string): Scenario | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Scenario> & { snapshot?: Partial<PlannerSnapshot> };
  const baseAssumptions = raw.assumptions ? { ...DEFAULT_ASSUMPTIONS, ...raw.assumptions, manualHistoricalData: Array.isArray(raw.assumptions.manualHistoricalData) ? [...raw.assumptions.manualHistoricalData] : [...DEFAULT_ASSUMPTIONS.manualHistoricalData], shrinkageItems: Array.isArray(raw.assumptions.shrinkageItems) ? raw.assumptions.shrinkageItems.map((item: ShrinkageItem) => ({ ...item })) : DEFAULT_SHRINKAGE_ITEMS.map((item) => ({ ...item })) } : cloneAssumptions(DEFAULT_ASSUMPTIONS);
  const snapshot = raw.snapshot;
  const legacyBlendState = getBlendStateFromLegacyPreset(normalizeBlendPreset(snapshot?.activeBlendPreset));
  const selectedChannels = normalizeSelectedChannels(snapshot?.selectedChannels || legacyBlendState.selectedChannels);
  const poolingMode = snapshot?.poolingMode === "dedicated" ? "dedicated" : legacyBlendState.poolingMode;
  return createScenario(raw.id || fallbackId, raw.name || "Scenario", {
    assumptions: snapshot?.assumptions ? { ...baseAssumptions, ...snapshot.assumptions, manualHistoricalData: Array.isArray(snapshot.assumptions.manualHistoricalData) ? [...snapshot.assumptions.manualHistoricalData] : [...baseAssumptions.manualHistoricalData], shrinkageItems: Array.isArray(snapshot.assumptions.shrinkageItems) ? snapshot.assumptions.shrinkageItems.map((item: ShrinkageItem) => ({ ...item })) : baseAssumptions.shrinkageItems.map((item) => ({ ...item })) } : baseAssumptions,
    forecastMethod: typeof snapshot?.forecastMethod === "string" ? snapshot.forecastMethod : "holtwinters",
    hwParams: { alpha: 0.3, beta: 0.1, gamma: 0.3, seasonLength: 12, ...(snapshot?.hwParams || {}) },
    arimaParams: { p: 1, d: 1, q: 1, ...(snapshot?.arimaParams || {}) },
    decompParams: { trendStrength: 1, seasonalityStrength: 1, ...(snapshot?.decompParams || {}) },
    historicalOverrides: normalizeHistoricalOverrides(snapshot?.historicalOverrides),
    channelHistoricalOverrides: {
      voice: Object.keys(normalizeHistoricalOverrides(snapshot?.channelHistoricalOverrides?.voice)).length > 0 ? normalizeHistoricalOverrides(snapshot?.channelHistoricalOverrides?.voice) : normalizeHistoricalOverrides(snapshot?.historicalOverrides),
      email: normalizeHistoricalOverrides(snapshot?.channelHistoricalOverrides?.email),
      chat: normalizeHistoricalOverrides(snapshot?.channelHistoricalOverrides?.chat),
    },
    channelHistoricalApiData: {
      voice: Array.isArray(snapshot?.channelHistoricalApiData?.voice) ? [...snapshot.channelHistoricalApiData.voice] : [],
      email: Array.isArray(snapshot?.channelHistoricalApiData?.email) ? [...snapshot.channelHistoricalApiData.email] : [],
      chat: Array.isArray(snapshot?.channelHistoricalApiData?.chat) ? [...snapshot.channelHistoricalApiData.chat] : [],
    },
    activeBlendPreset: getLegacyBlendPresetId(selectedChannels, poolingMode),
    selectedChannels,
    poolingMode,
    isHistoricalSourceOpen: typeof snapshot?.isHistoricalSourceOpen === "boolean" ? snapshot.isHistoricalSourceOpen : false,
    isBlendedStaffingOpen: typeof snapshot?.isBlendedStaffingOpen === "boolean" ? snapshot.isBlendedStaffingOpen : true,
    selectedHistoricalChannel: snapshot?.selectedHistoricalChannel === "email" || snapshot?.selectedHistoricalChannel === "chat" ? snapshot.selectedHistoricalChannel : "voice",
  });
}
const getTimeline = (startDateStr: string, monthsPast = 0, monthsFuture = 12) => {
  const start = new Date(startDateStr);
  const timeline: { month: string; year: string; isFuture: boolean }[] = [];
  for (let i = monthsPast; i > 0; i--) {
    const d = new Date(start.getFullYear(), start.getMonth() - i, 1);
    timeline.push({ month: MONTH_NAMES[d.getMonth()], year: d.getFullYear().toString(), isFuture: false });
  }
  for (let i = 0; i < monthsFuture; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    timeline.push({ month: MONTH_NAMES[d.getMonth()], year: d.getFullYear().toString(), isFuture: true });
  }
  return timeline;
};
const getHistoricalTimeline = (startDateStr: string, historyLength: number) => {
  const start = new Date(startDateStr);
  return Array.from({ length: historyLength }, (_, index) => {
    const d = new Date(start.getFullYear(), start.getMonth() - historyLength + index, 1);
    return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  });
};
const calculateFTE = (volume: number, assumptions: Assumptions, channel: ChannelKey = "voice") => {
  return getChannelStaffingMetrics(channel, volume, assumptions).requiredFTE;
};
const calculatePooledFTE = (
  workloadHours: number,
  referenceVolume: number,
  assumptions: Assumptions,
  channelMix?: ChannelMixEntry[]
) => {
  if (workloadHours === 0) return 0;
  if (channelMix && channelMix.length > 0) {
    // Single-channel dedicated pool: use the proper per-channel staffing model
    // (Erlang C for voice/chat, backlog model for email) so FTE matches standalone metrics.
    // The blended tri-channel function would collapse to pure workload/intensity for
    // chat and email when the other volumes are zero, under-counting vs. SLA-based models.
    if (channelMix.length === 1) {
      const { channel, volume } = channelMix[0];
      return getChannelStaffingMetrics(channel, volume, assumptions).requiredFTE;
    }
    const voiceEntry = channelMix.find((entry) => entry.channel === "voice");
    const chatEntry = channelMix.find((entry) => entry.channel === "chat");
    const emailEntry = channelMix.find((entry) => entry.channel === "email");
    const blendedRequirement = calculateBlendedTriChannelRequirement({
      voiceVolume: voiceEntry?.volume ?? 0,
      voiceAhtSeconds: assumptions.aht,
      voiceTargetServiceLevelPct: assumptions.voiceSlaTarget,
      voiceTargetAnswerTimeSeconds: assumptions.voiceSlaAnswerSeconds,
      chatVolume: chatEntry?.volume ?? 0,
      chatAhtSeconds: assumptions.chatAht,
      chatConcurrency: Math.max(1, assumptions.chatConcurrency),
      emailVolume: emailEntry?.volume ?? 0,
      emailAhtSeconds: assumptions.emailAht,
      intervalHours: getOpenHoursPerMonth(assumptions),
      shrinkagePct: assumptions.shrinkage,
      safetyMarginPct: assumptions.safetyMargin,
    });
    return getGrossRequiredFTE(blendedRequirement.totalBaseStaff, assumptions);
  }
  return getChannelStaffingMetrics("voice", referenceVolume, assumptions).requiredFTE;
};
const getCalculatedVolumes = (data: number[], forecastMethod: string, assumptions: Assumptions, hwParams: { alpha: number; beta: number; gamma: number; seasonLength: number }, arimaParams: { p: number; d: number; q: number }, decompParams: { trendStrength: number; seasonalityStrength: number }) => {
  if (data.length === 0) return Array(12).fill(0);
  // YoY already bakes growthRate in. All other methods get a post-multiplier so planners
  // can overlay a growth/decline assumption on top of any statistical model.
  const applyGrowth = (volumes: number[]) => {
    if (assumptions.growthRate === 0) return volumes;
    const multiplier = 1 + assumptions.growthRate / 100;
    return volumes.map((v) => Math.round(v * multiplier));
  };
  switch (forecastMethod) {
    case "yoy": return calculateYoY(data.slice(-12), assumptions.growthRate);
    case "ma": return applyGrowth(calculateMovingAverage(data, 3));
    case "regression": return applyGrowth(calculateLinearRegression(data));
    case "holtwinters": return applyGrowth(calculateHoltWinters(data, hwParams.alpha, hwParams.beta, hwParams.gamma, hwParams.seasonLength));
    case "decomposition": return applyGrowth(calculateDecomposition(data, decompParams.trendStrength, decompParams.seasonalityStrength));
    case "arima": return applyGrowth(calculateARIMA(data, arimaParams.p, arimaParams.d, arimaParams.q));
    case "genesys":
    default: return applyGrowth(data.slice(-12));
  }
};
const buildDemandForecastData = (data: number[], assumptions: Assumptions, forecastMethod: string, hwParams: { alpha: number; beta: number; gamma: number; seasonLength: number }, arimaParams: { p: number; d: number; q: number }, decompParams: { trendStrength: number; seasonalityStrength: number }): DemandForecastData[] => {
  const historyLength = data.length;
  const calculatedVolumes = getCalculatedVolumes(data, forecastMethod, assumptions, hwParams, arimaParams, decompParams);
  const timeline = getTimeline(assumptions.startDate, historyLength, 12);
  return timeline.map((time, idx) => {
    const isFuture = time.isFuture;
    const historicalVolume = !isFuture ? data[idx] ?? 0 : null;
    const forecastVolume = isFuture ? calculatedVolumes[idx - historyLength] ?? 0 : null;
    const volume = isFuture ? forecastVolume ?? 0 : historicalVolume ?? 0;
    return {
      month: time.month,
      year: time.year,
      isFuture,
      volume,
      workloadHours: getChannelWorkloadHours("voice", volume, assumptions),
      aht: assumptions.aht,
      occupancy: getChannelStaffingMetrics("voice", volume, assumptions).requiredOccupancy,
      shrinkage: assumptions.shrinkage,
      requiredFTE: calculateFTE(volume, assumptions, "voice"),
      actualVolume: historicalVolume,
      forecastVolume,
      historicalVolume: historicalVolume ?? 0,
    };
  });
};

export default function LongTermForecastingDemand() {
  const { activeLob } = useLOB();
  const [isAssumptionsOpen, setIsAssumptionsOpen] = useState(true);
  const [isHistoricalSourceOpen, setIsHistoricalSourceOpen] = useState(false);
  const [isBlendedStaffingOpen, setIsBlendedStaffingOpen] = useState(true);
  const [selectedChannels, setSelectedChannels] = useState<Record<ChannelKey, boolean>>(DEFAULT_SELECTED_CHANNELS);
  const [poolingMode, setPoolingMode] = useState<PoolingMode>("blended");
  const [selectedScenarioId, setSelectedScenarioId] = useState("base");
  const [loading, setLoading] = useState(true);
  const [forecastMethod, setForecastMethod] = useState("holtwinters");
  const [hwParams, setHwParams] = useState({ alpha: 0.3, beta: 0.1, gamma: 0.3, seasonLength: 12 });
  const [arimaParams, setArimaParams] = useState({ p: 1, d: 1, q: 1 });
  const [decompParams, setDecompParams] = useState({ trendStrength: 1, seasonalityStrength: 1 });
  const [scenarios, setScenarios] = useState<Record<string, Scenario>>(DEFAULT_SCENARIOS);
  const [assumptions, setAssumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [historicalChannelView, setHistoricalChannelView] = useState<ChannelKey>("voice");
  const [historicalApiDataByChannel, setHistoricalApiDataByChannel] = useState<Record<ChannelKey, number[]>>(EMPTY_CHANNEL_DATA);
  const [syncedHistoricalApiDataByChannel, setSyncedHistoricalApiDataByChannel] = useState<Record<ChannelKey, number[]>>(EMPTY_CHANNEL_DATA);
  const [historicalOverridesByChannel, setHistoricalOverridesByChannel] = useState<Record<ChannelKey, Record<number, string>>>(EMPTY_CHANNEL_OVERRIDES);
  const hasHydratedRef = useRef(false);
  const activeScenario = scenarios[selectedScenarioId];
  const historicalApiData = historicalApiDataByChannel.voice;
  const historicalOverrides = historicalOverridesByChannel.voice;
  const visibleHistoricalApiData = historicalApiDataByChannel[historicalChannelView];
  const visibleHistoricalOverrides = historicalOverridesByChannel[historicalChannelView];
  const getCurrentPlannerSnapshot = () => buildPlannerSnapshot(assumptions, forecastMethod, hwParams, arimaParams, decompParams, historicalApiDataByChannel, historicalOverridesByChannel, selectedChannels, poolingMode, isHistoricalSourceOpen, isBlendedStaffingOpen, historicalChannelView);
  const normalizePersistedScenarios = (records: DemandPlannerScenarioRecord[]) => records.reduce<Record<string, Scenario>>((acc, record) => {
    const nextScenario = normalizeScenario({
      id: record.scenario_id,
      name: record.scenario_name,
      assumptions: DEFAULT_ASSUMPTIONS,
      snapshot: record.planner_snapshot,
    }, record.scenario_id);
    if (nextScenario) acc[nextScenario.id] = nextScenario;
    return acc;
  }, {});
  const applyPlannerSnapshot = (snapshot: PlannerSnapshot) => {
    setAssumptions(cloneAssumptions(snapshot.assumptions));
    setForecastMethod(snapshot.forecastMethod);
    setHwParams({ ...snapshot.hwParams });
    setArimaParams({ ...snapshot.arimaParams });
    setDecompParams({ ...snapshot.decompParams });
    setHistoricalApiDataByChannel({
      voice: [...(snapshot.channelHistoricalApiData?.voice || [])],
      email: [...(snapshot.channelHistoricalApiData?.email || [])],
      chat: [...(snapshot.channelHistoricalApiData?.chat || [])],
    });
    setHistoricalOverridesByChannel({
      voice: { ...(snapshot.channelHistoricalOverrides?.voice || snapshot.historicalOverrides || {}) },
      email: { ...(snapshot.channelHistoricalOverrides?.email || {}) },
      chat: { ...(snapshot.channelHistoricalOverrides?.chat || {}) },
    });
    setSelectedChannels(normalizeSelectedChannels(snapshot.selectedChannels));
    setPoolingMode(snapshot.poolingMode === "dedicated" ? "dedicated" : "blended");
    setIsHistoricalSourceOpen(snapshot.isHistoricalSourceOpen);
    setIsBlendedStaffingOpen(snapshot.isBlendedStaffingOpen);
    setHistoricalChannelView(snapshot.selectedHistoricalChannel || "voice");
  };

  const persistActiveStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistActiveState = (state: { selectedScenarioId: string; plannerSnapshot: PlannerSnapshot }) => {
    localStorage.setItem(USER_INPUTS_STORAGE_KEY, JSON.stringify(state));
    if (persistActiveStateTimerRef.current) clearTimeout(persistActiveStateTimerRef.current);
    persistActiveStateTimerRef.current = setTimeout(() => {
      fetch(apiUrl("/api/demand-planner-active-state"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state_value: state, lob_id: activeLob?.id }),
      }).catch(() => { /* non-critical */ });
    }, 2000);
  };

  useEffect(() => {
    if (!activeLob) { setLoading(false); return; }
    hasHydratedRef.current = false;
    const hydratePlanner = async () => {
      let nextScenarios = DEFAULT_SCENARIOS;
      try {
        const response = await fetch(apiUrl(`/api/demand-planner-scenarios?lob_id=${activeLob.id}`));
        if (response.ok) {
          const records = await response.json() as DemandPlannerScenarioRecord[];
          const normalized = Array.isArray(records) ? normalizePersistedScenarios(records) : {};
          if (Object.keys(normalized).length > 0) nextScenarios = normalized;
        }
      } catch (error) {
        console.error("Failed to load persisted demand scenarios", error);
      }
      if (nextScenarios === DEFAULT_SCENARIOS) {
        try {
          const savedScenarios = localStorage.getItem(SCENARIOS_STORAGE_KEY);
          if (savedScenarios) {
            const parsed = JSON.parse(savedScenarios) as Record<string, unknown>;
            const normalized = Object.entries(parsed).reduce<Record<string, Scenario>>((acc, [id, scenario]) => {
              const nextScenario = normalizeScenario(scenario, id);
              if (nextScenario) acc[nextScenario.id] = nextScenario;
              return acc;
            }, {});
            if (Object.keys(normalized).length > 0) nextScenarios = normalized;
          }
        } catch (error) {
          console.error("Failed to parse demand scenarios", error);
        }
      }
      setScenarios(nextScenarios);
      try {
        // localStorage first (dev environment is source of truth), then DB active state (for syncing to other devices)
        let savedInputs: { selectedScenarioId?: string; plannerSnapshot?: Partial<PlannerSnapshot> } | null = null;
        const localRaw = localStorage.getItem(USER_INPUTS_STORAGE_KEY);
        if (localRaw) {
          savedInputs = JSON.parse(localRaw) as { selectedScenarioId?: string; plannerSnapshot?: Partial<PlannerSnapshot> };
        }
        if (!savedInputs) {
          try {
            const activeStateResponse = await fetch(apiUrl(`/api/demand-planner-active-state?lob_id=${activeLob.id}`));
            if (activeStateResponse.ok) {
              const dbState = await activeStateResponse.json() as { selectedScenarioId?: string; plannerSnapshot?: Partial<PlannerSnapshot> } | null;
              if (dbState && typeof dbState === "object") savedInputs = dbState;
            }
          } catch {
            // fall through to scenario snapshot
          }
        }
        if (savedInputs) {
          const nextSelectedScenarioId = savedInputs.selectedScenarioId && nextScenarios[savedInputs.selectedScenarioId] ? savedInputs.selectedScenarioId : Object.keys(nextScenarios)[0] || "base";
          setSelectedScenarioId(nextSelectedScenarioId);
          const fallbackSnapshot = nextScenarios[nextSelectedScenarioId]?.snapshot;
          if (savedInputs.plannerSnapshot) {
            applyPlannerSnapshot(normalizeScenario({ id: nextSelectedScenarioId, name: nextScenarios[nextSelectedScenarioId]?.name || "Scenario", assumptions: fallbackSnapshot?.assumptions || DEFAULT_ASSUMPTIONS, snapshot: savedInputs.plannerSnapshot }, nextSelectedScenarioId)?.snapshot || fallbackSnapshot || getCurrentPlannerSnapshot());
          } else if (fallbackSnapshot) {
            applyPlannerSnapshot(fallbackSnapshot);
          }
        } else {
          const initialScenarioId = Object.keys(nextScenarios)[0] || "base";
          setSelectedScenarioId(initialScenarioId);
          if (nextScenarios[initialScenarioId]?.snapshot) applyPlannerSnapshot(nextScenarios[initialScenarioId].snapshot);
        }
      } catch (error) {
        console.error("Failed to load demand user inputs", error);
      } finally {
        hasHydratedRef.current = true;
      }
    };

    hydratePlanner();
  }, [activeLob?.id]);
  useEffect(() => {
    if (!hasHydratedRef.current) return;
    persistActiveState({
      selectedScenarioId,
      plannerSnapshot: getCurrentPlannerSnapshot(),
    });
  }, [assumptions, forecastMethod, hwParams, arimaParams, decompParams, historicalApiDataByChannel, historicalOverridesByChannel, selectedChannels, poolingMode, isHistoricalSourceOpen, isBlendedStaffingOpen, historicalChannelView, selectedScenarioId]);

  // Sync shrinkage from Shrinkage Planner when planner source is selected
  useEffect(() => {
    const source = assumptions.shrinkageSource;
    if (source === "planner_excl" || source === "planner_incl") {
      try {
        const stored = localStorage.getItem("wfm_shrinkage_totals");
        if (stored) {
          const parsed = JSON.parse(stored) as { totalExcl?: number; totalIncl?: number; lastUpdated?: string };
          const value = source === "planner_excl" ? parsed.totalExcl : parsed.totalIncl;
          if (typeof value === "number" && value >= 0 && value < 100) {
            setAssumptions((prev) => ({ ...prev, shrinkage: value }));
          }
        }
      } catch {
        // ignore malformed localStorage
      }
    }
  }, [assumptions.shrinkageSource]);

  useEffect(() => {
    if (!activeLob) { setLoading(false); return; }
    const fetchHistoricalData = async () => {
      setLoading(true);
      try {
        const channels: ChannelKey[] = ["voice", "email", "chat"];
        const results = await Promise.all(channels.map(async (channel) => {
          try {
            const actualsResponse = await fetch(apiUrl(`/api/long-term-actuals?channel=${channel}&lob_id=${activeLob.id}`));
            if (actualsResponse.ok) {
              const actuals = await actualsResponse.json() as LongTermActualRecord[];
              if (Array.isArray(actuals) && actuals.length > 0) {
                return { channel, data: actuals.map((row) => Number(row.volume) || 0) };
              }
            }
          } catch (error) {
            console.error(`Error fetching ${channel} long term actuals`, error);
          }

          const response = await fetch(apiUrl("/api/genesys/sync"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queueId: "mock-queue-id", channel, interval: `${assumptions.startDate}/2030-12-31` }) });
          const result = await response.json();
          return { channel, data: result.success && Array.isArray(result.data) ? result.data : [] };
        }));
        const nextApiData = results.reduce<Record<ChannelKey, number[]>>((acc, { channel, data }) => {
          acc[channel] = data;
          return acc;
        }, { voice: [], email: [], chat: [] });
        setHistoricalApiDataByChannel((current) => ({
          voice: current.voice.length > 0 ? current.voice : nextApiData.voice,
          email: current.email.length > 0 ? current.email : nextApiData.email,
          chat: current.chat.length > 0 ? current.chat : nextApiData.chat,
        }));
        setSyncedHistoricalApiDataByChannel(nextApiData);
        setHistoricalOverridesByChannel((current) => ({
          voice: Object.fromEntries(Object.entries(current.voice).filter(([key]) => Number(key) < nextApiData.voice.length)),
          email: Object.fromEntries(Object.entries(current.email).filter(([key]) => Number(key) < nextApiData.email.length)),
          chat: Object.fromEntries(Object.entries(current.chat).filter(([key]) => Number(key) < nextApiData.chat.length)),
        }));
      } catch (error) { console.error("Error fetching mock data:", error); }
      finally { setLoading(false); }
    };
    fetchHistoricalData();
  }, [assumptions.startDate, activeLob?.id]);

  const saveScenariosToStorage = (updated: Record<string, Scenario>) => localStorage.setItem(SCENARIOS_STORAGE_KEY, JSON.stringify(updated));
  const handleSelectedChannelChange = (channel: ChannelKey, checked: boolean | "indeterminate") => {
    const isChecked = checked === true;
    if (!isChecked && includedChannels.length === 1 && selectedChannels[channel]) {
      toast.info("At least one channel must remain selected");
      return;
    }
    setSelectedChannels((current) => normalizeSelectedChannels({ ...current, [channel]: isChecked }));
  };
  const persistScenario = async (scenario: Scenario) => {
    const response = await fetch(apiUrl(`/api/demand-planner-scenarios/${scenario.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario_name: scenario.name,
        planner_snapshot: scenario.snapshot,
        lob_id: activeLob?.id,
      }),
    });
    if (!response.ok) throw new Error("Failed to persist scenario");
  };
  const handleScenarioChange = (nextScenarioId: string) => {
    const scenario = scenarios[nextScenarioId];
    if (!scenario) return;
    setSelectedScenarioId(nextScenarioId);
    applyPlannerSnapshot(scenario.snapshot);
  };
  const handleSaveScenario = async () => {
    const id = activeScenario?.id || "base";
    const existing = scenarios[id];
    const snapshot = getCurrentPlannerSnapshot();
    const updatedScenario = createScenario(id, existing?.name || activeScenario?.name || "Scenario", snapshot);
    const updated = { ...scenarios, [id]: updatedScenario };
    setScenarios(updated);
    saveScenariosToStorage(updated);
    setSelectedScenarioId(id);
    try {
      await persistScenario(updatedScenario);
      toast.success("Scenario saved successfully");
    } catch (error) {
      console.error("Failed to persist demand scenario", error);
      toast.error("Scenario saved locally, but cloud save failed");
    }
  };
  const handleDeleteScenario = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this scenario?")) return;
    const updated = { ...scenarios };
    delete updated[id];
    if (Object.keys(updated).length === 0) updated.base = DEFAULT_SCENARIOS.base;
    const nextScenarioId = id === selectedScenarioId || !updated[selectedScenarioId] ? Object.keys(updated)[0] : selectedScenarioId;
    setScenarios(updated);
    saveScenariosToStorage(updated);
    setSelectedScenarioId(nextScenarioId);
    if (updated[nextScenarioId]?.snapshot) applyPlannerSnapshot(updated[nextScenarioId].snapshot);
    try {
      await fetch(apiUrl(`/api/demand-planner-scenarios/${id}`), { method: "DELETE" });
      toast.success("Scenario deleted");
    } catch (error) {
      console.error("Failed to delete persisted demand scenario", error);
      toast.error("Scenario deleted locally, but cloud delete failed");
    }
  };
  const handleNewScenario = async () => {
    const id = `scenario-${Date.now()}`;
    const snapshot = getCurrentPlannerSnapshot();
    const newScenario = createScenario(id, `New Scenario ${Object.keys(scenarios).length + 1}`, snapshot);
    const updated = { ...scenarios, [id]: newScenario };
    setScenarios(updated);
    saveScenariosToStorage(updated);
    setSelectedScenarioId(id);
    try {
      await persistScenario(newScenario);
      toast.success("New scenario created");
    } catch (error) {
      console.error("Failed to persist new scenario", error);
      toast.success("New scenario created locally");
    }
  };
  const handleRenameScenario = async () => {
    if (!activeScenario) return;
    const nextName = window.prompt("Rename scenario:", activeScenario.name);
    if (!nextName || nextName.trim() === "" || nextName.trim() === activeScenario.name) return;
    const renamedScenario = createScenario(activeScenario.id, nextName.trim(), activeScenario.snapshot);
    const updated = { ...scenarios, [activeScenario.id]: renamedScenario };
    setScenarios(updated);
    saveScenariosToStorage(updated);
    try {
      await persistScenario(renamedScenario);
      toast.success("Scenario renamed");
    } catch (error) {
      console.error("Failed to persist renamed demand scenario", error);
      toast.error("Scenario renamed locally, but cloud save failed");
    }
  };
  const handleOverrideToggle = (index: number, checked: boolean) => {
    setHistoricalOverridesByChannel((current) => {
      const nextChannelOverrides = { ...current[historicalChannelView] };
      if (!checked) {
        delete nextChannelOverrides[index];
      } else {
        nextChannelOverrides[index] = nextChannelOverrides[index] && nextChannelOverrides[index] !== "" ? nextChannelOverrides[index] : String(visibleHistoricalApiData[index] ?? "");
      }
      return { ...current, [historicalChannelView]: nextChannelOverrides };
    });
  };
  const handleOverrideChange = (index: number, nextValue: string) => {
    if (!/^\d*$/.test(nextValue)) return;
    setHistoricalOverridesByChannel((current) => ({ ...current, [historicalChannelView]: { ...current[historicalChannelView], [index]: nextValue } }));
  };
  const handleOverrideBlur = (index: number) => {
    setHistoricalOverridesByChannel((current) => {
      const nextChannelOverrides = { ...current[historicalChannelView] };
      const existing = nextChannelOverrides[index];
      if (existing === undefined) return current;
      if (existing === "") {
        delete nextChannelOverrides[index];
        return { ...current, [historicalChannelView]: nextChannelOverrides };
      }
      const parsedValue = Number.parseInt(existing, 10);
      if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        delete nextChannelOverrides[index];
        return { ...current, [historicalChannelView]: nextChannelOverrides };
      }
      nextChannelOverrides[index] = String(parsedValue);
      return { ...current, [historicalChannelView]: nextChannelOverrides };
    });
  };
  const handleResetMonthOverride = (index: number) => {
    setHistoricalOverridesByChannel((current) => {
      const nextChannelOverrides = { ...current[historicalChannelView] };
      delete nextChannelOverrides[index];
      return { ...current, [historicalChannelView]: nextChannelOverrides };
    });
  };
  const handleShrinkageItemChange = (id: string, changes: Partial<ShrinkageItem>) => {
    const nextItems = (assumptions.shrinkageItems ?? DEFAULT_SHRINKAGE_ITEMS).map((item) => item.id === id ? { ...item, ...changes } : item);
    const computed = computeShrinkageFromItems(nextItems, assumptions.operatingHoursPerDay, assumptions.operatingDaysPerWeek);
    setAssumptions((prev) => ({ ...prev, shrinkageItems: nextItems, shrinkage: computed }));
  };
  const handleShrinkageModelerToggle = (enabled: boolean) => {
    if (enabled) {
      // Scale leave-type items to match the actual shift length so shrinkage
      // reflects a full day off (operatingHoursPerDay × 60 min) rather than
      // a hardcoded 8-hour assumption.
      const shiftMinutes = Math.round(assumptions.operatingHoursPerDay * 60);
      const LEAVE_IDS = new Set(["annual_leave", "sick_leave"]);
      const scaledItems = (assumptions.shrinkageItems ?? DEFAULT_SHRINKAGE_ITEMS).map((item) =>
        LEAVE_IDS.has(item.id) ? { ...item, durationMinutes: shiftMinutes } : item,
      );
      const computed = computeShrinkageFromItems(scaledItems, assumptions.operatingHoursPerDay, assumptions.operatingDaysPerWeek);
      setAssumptions((prev) => ({ ...prev, useShrinkageModeler: true, shrinkageItems: scaledItems, shrinkage: computed }));
    } else {
      setAssumptions((prev) => ({ ...prev, useShrinkageModeler: false }));
    }
  };
  const handleResetAllOverrides = () => {
    setHistoricalOverridesByChannel((current) => ({ ...current, [historicalChannelView]: {} }));
    toast.success(`All ${CHANNEL_ASSUMPTION_META[historicalChannelView].label.toLowerCase()} historical overrides reset`);
  };
  const handleClearApiData = () => {
    const historyLength = getChannelHistoryLength(visibleHistoricalApiData, visibleHistoricalOverrides);
    setHistoricalApiDataByChannel((current) => ({
      ...current,
      [historicalChannelView]: Array.from({ length: historyLength }, () => 0),
    }));
    toast.success(`${CHANNEL_ASSUMPTION_META[historicalChannelView].label} API history cleared`);
  };
  const handleRestoreApiData = () => {
    const restoredData = syncedHistoricalApiDataByChannel[historicalChannelView] ?? [];
    setHistoricalApiDataByChannel((current) => ({
      ...current,
      [historicalChannelView]: [...restoredData],
    }));
    toast.success(`${CHANNEL_ASSUMPTION_META[historicalChannelView].label} API history restored`);
  };
  const handlePrintQuickGuide = () => {
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=900,height=1000");
    if (!printWindow) {
      toast.error("Unable to open print window");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(buildDemandHelpPrintHtml());
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const finalHistoricalData = useMemo(() => buildChannelHistoricalData(historicalApiData, historicalOverrides), [historicalApiData, historicalOverrides]);
  // Per-channel final historical data (applies each channel's own overrides)
  const finalHistoricalDataByChannel = useMemo<Record<ChannelKey, number[]>>(() => {
    const applyOverrides = (channel: ChannelKey) => buildChannelHistoricalData(historicalApiDataByChannel[channel], historicalOverridesByChannel[channel]);
    return { voice: finalHistoricalData, email: applyOverrides("email"), chat: applyOverrides("chat") };
  }, [finalHistoricalData, historicalApiDataByChannel, historicalOverridesByChannel]);
  const hasExplicitHistoryByChannel = useMemo<Record<ChannelKey, boolean>>(() => ({
    voice: historicalApiDataByChannel.voice.length > 0 || Object.keys(historicalOverridesByChannel.voice).length > 0,
    email: historicalApiDataByChannel.email.length > 0 || Object.keys(historicalOverridesByChannel.email).length > 0,
    chat: historicalApiDataByChannel.chat.length > 0 || Object.keys(historicalOverridesByChannel.chat).length > 0,
  }), [historicalApiDataByChannel, historicalOverridesByChannel]);
  // Per-channel 12-month forecast volumes — uses each channel's own history when available
  const forecastVolumesByChannel = useMemo<Record<ChannelKey, number[]>>(() => {
    const voiceForecast = getCalculatedVolumes(finalHistoricalDataByChannel.voice, forecastMethod, assumptions, hwParams, arimaParams, decompParams);
    const emailHistory = finalHistoricalDataByChannel.email;
    const chatHistory = finalHistoricalDataByChannel.chat;
    const emailForecast = hasExplicitHistoryByChannel.email
      ? getCalculatedVolumes(emailHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
      : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.email));
    const chatForecast = hasExplicitHistoryByChannel.chat
      ? getCalculatedVolumes(chatHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
      : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.chat));
    return { voice: voiceForecast, email: emailForecast, chat: chatForecast };
  }, [finalHistoricalDataByChannel, hasExplicitHistoryByChannel, forecastMethod, assumptions, hwParams, arimaParams, decompParams]);
  const visibleFinalHistoricalData = useMemo(() => buildChannelHistoricalData(visibleHistoricalApiData, visibleHistoricalOverrides), [visibleHistoricalApiData, visibleHistoricalOverrides]);
  const canRestoreApiData = useMemo(() => {
    const currentData = historicalApiDataByChannel[historicalChannelView] ?? [];
    const syncedData = syncedHistoricalApiDataByChannel[historicalChannelView] ?? [];
    if (currentData.length !== syncedData.length) return true;
    return currentData.some((value, index) => value !== syncedData[index]);
  }, [historicalApiDataByChannel, historicalChannelView, syncedHistoricalApiDataByChannel]);
  const historicalSourceRows = useMemo<HistoricalSourceRow[]>(() => {
    const historyLength = getChannelHistoryLength(visibleHistoricalApiData, visibleHistoricalOverrides);
    const labels = getHistoricalTimeline(assumptions.startDate, historyLength);
    return Array.from({ length: historyLength }, (_, index) => {
      const apiVolume = visibleHistoricalApiData[index] ?? 0;
      const overrideVolume = visibleHistoricalOverrides[index] ?? "";
      const hasOverride = overrideVolume !== "" && Number.parseInt(overrideVolume, 10) > 0;
      const isManualRow = apiVolume === 0;
      const finalVolume = visibleFinalHistoricalData[index] ?? apiVolume;
      const variancePct = hasOverride && apiVolume > 0 ? Number((((finalVolume - apiVolume) / apiVolume) * 100).toFixed(1)) : null;
      return {
        index,
        monthLabel: labels[index] ?? `Month ${index + 1}`,
        apiVolume,
        overrideVolume,
        finalVolume,
        variancePct,
        isOverridden: hasOverride,
        canEdit: hasOverride || isManualRow,
        stateLabel: hasOverride ? "Editing" : isManualRow ? "Manual" : "API",
      };
    });
  }, [assumptions.startDate, visibleHistoricalApiData, visibleHistoricalOverrides, visibleFinalHistoricalData]);
  const overrideCount = useMemo(() => historicalSourceRows.filter((row) => row.isOverridden).length, [historicalSourceRows]);
  const forecastData = useMemo(() => buildDemandForecastData(finalHistoricalData, assumptions, forecastMethod, hwParams, arimaParams, decompParams), [finalHistoricalData, assumptions, forecastMethod, hwParams, arimaParams, decompParams]);
  const selectedBlendConfig = useMemo(() => buildBlendConfiguration(selectedChannels, poolingMode), [selectedChannels, poolingMode]);
  const includedChannels = useMemo(() => selectedBlendConfig.includedChannels, [selectedBlendConfig]);
  const volumeTrendComparison = useMemo(() => {
    const historyLength = includedChannels.reduce((max, channel) => Math.max(max, finalHistoricalDataByChannel[channel].length), 0);
    const actualByYear = new Map<string, Array<number | null>>();
    const forecastByYear = new Map<string, Array<number | null>>();
    const actualTimeline = getTimeline(assumptions.startDate, historyLength, 0);
    actualTimeline.forEach((time, idx) => {
      const monthIndex = MONTH_NAMES.indexOf(time.month);
      if (monthIndex < 0) return;
      const yearSeries = actualByYear.get(time.year) ?? new Array<number | null>(12).fill(null);
      yearSeries[monthIndex] = includedChannels.reduce((sum, channel) => sum + (finalHistoricalDataByChannel[channel][idx] ?? 0), 0);
      actualByYear.set(time.year, yearSeries);
    });
    const forecastTimeline = getTimeline(assumptions.startDate, 0, 12);
    forecastTimeline.forEach((time, idx) => {
      const monthIndex = MONTH_NAMES.indexOf(time.month);
      if (monthIndex < 0) return;
      const yearSeries = forecastByYear.get(time.year) ?? new Array<number | null>(12).fill(null);
      yearSeries[monthIndex] = includedChannels.reduce((sum, channel) => sum + (forecastVolumesByChannel[channel][idx] ?? 0), 0);
      forecastByYear.set(time.year, yearSeries);
    });
    const actualYears = Array.from(actualByYear.keys()).sort((left, right) => Number(left) - Number(right));
    const forecastYears = Array.from(forecastByYear.keys()).sort((left, right) => Number(left) - Number(right));
    const series: VolumeTrendSeriesMeta[] = [
      ...actualYears.map((year, index) => ({
        key: `actual_${year}`,
        label: `Actual ${year}`,
        stroke: VOLUME_TREND_ACTUAL_COLORS[index % VOLUME_TREND_ACTUAL_COLORS.length],
        isForecast: false,
      })),
      ...forecastYears.map((year, index) => ({
        key: `forecast_${year}`,
        label: `Forecast ${year}`,
        stroke: VOLUME_TREND_FORECAST_COLORS[index % VOLUME_TREND_FORECAST_COLORS.length],
        isForecast: true,
      })),
    ];
    const chartData = MONTH_NAMES.map((month, monthIndex) => {
      const point: Record<string, string | number | null> = { month };
      actualYears.forEach((year) => {
        point[`actual_${year}`] = actualByYear.get(year)?.[monthIndex] ?? null;
      });
      forecastYears.forEach((year) => {
        point[`forecast_${year}`] = forecastByYear.get(year)?.[monthIndex] ?? null;
      });
      return point;
    });
    return { chartData, series };
  }, [assumptions.startDate, includedChannels, finalHistoricalDataByChannel, forecastVolumesByChannel]);
  const futureData = useMemo<FutureStaffingRow[]>(() => forecastData.filter((row) => row.isFuture).map((row, futureIdx) => {
    const emailForecastVol = forecastVolumesByChannel.email[futureIdx] ?? Math.round(row.volume * CHANNEL_VOLUME_FACTORS.email);
    const chatForecastVol = forecastVolumesByChannel.chat[futureIdx] ?? Math.round(row.volume * CHANNEL_VOLUME_FACTORS.chat);
    const channelMetrics: Record<ChannelKey, ChannelStaffingMetrics> = {
      voice: getChannelStaffingMetrics("voice", row.volume, assumptions),
      email: getChannelStaffingMetrics("email", emailForecastVol, assumptions),
      chat: getChannelStaffingMetrics("chat", chatForecastVol, assumptions),
    };
    const pools = selectedBlendConfig.pools.map((channels, index) => {
      const workloadHours = Number(channels.reduce((sum, channel) => sum + channelMetrics[channel].workloadHours, 0).toFixed(1));
      const referenceVolume = channels.reduce((sum, channel) => sum + channelMetrics[channel].volume, 0);
      const channelMix = channels.map((channel) => ({
        channel,
        volume: channelMetrics[channel].volume,
        workloadHours: channelMetrics[channel].workloadHours,
        ahtSeconds: getChannelEffectiveAhtSeconds(assumptions, channel),
      }));
      return { poolName: `Pool ${String.fromCharCode(65 + index)}`, channels, workloadHours, fte: calculatePooledFTE(workloadHours, referenceVolume, assumptions, channelMix), isShared: channels.length > 1 };
    });
    const sharedPools = pools.filter((pool) => pool.isShared);
    const standalonePools = pools.filter((pool) => !pool.isShared);
    const includedVolume = includedChannels.reduce((sum, channel) => sum + channelMetrics[channel].volume, 0);
    const includedWorkloadHours = Number(includedChannels.reduce((sum, channel) => sum + channelMetrics[channel].workloadHours, 0).toFixed(1));
    const totalIntensity = includedChannels.reduce((sum, channel) => sum + channelMetrics[channel].intensity, 0);
    const totalRawAgents = includedChannels.reduce((sum, channel) => sum + channelMetrics[channel].rawAgents, 0);
    const weightedAht = includedVolume > 0
      ? roundTo(includedChannels.reduce((sum, channel) => sum + (channelMetrics[channel].volume * getChannelAhtSeconds(assumptions, channel)), 0) / includedVolume, 1)
      : 0;
    return {
      ...row,
      volume: includedVolume,
      workloadHours: includedWorkloadHours,
      aht: weightedAht,
      occupancy: totalRawAgents > 0 ? roundTo((totalIntensity / totalRawAgents) * 100, 1) : 0,
      activeBlendPreset: selectedBlendConfig.label,
      sharedPoolWorkload: Number(sharedPools.reduce((sum, pool) => sum + pool.workloadHours, 0).toFixed(1)),
      sharedPoolFTE: Number(sharedPools.reduce((sum, pool) => sum + pool.fte, 0).toFixed(1)),
      standalonePoolFTE: Number(standalonePools.reduce((sum, pool) => sum + pool.fte, 0).toFixed(1)),
      totalRequiredFTE: Number(pools.reduce((sum, pool) => sum + pool.fte, 0).toFixed(1)),
      pools,
      channelMetrics,
    };
  }), [forecastData, forecastVolumesByChannel, selectedBlendConfig, assumptions]);
  const kpis = useMemo(() => futureData.length === 0 ? { avgVolume: 0, avgWorkloadHours: 0, avgRequiredFTE: 0 } : ({
    avgVolume: Math.round(futureData.reduce((sum, row) => sum + row.volume, 0) / futureData.length),
    avgWorkloadHours: Number((futureData.reduce((sum, row) => sum + row.pools.reduce((poolSum, pool) => poolSum + pool.workloadHours, 0), 0) / futureData.length).toFixed(1)),
    avgRequiredFTE: Number((futureData.reduce((sum, row) => sum + row.totalRequiredFTE, 0) / futureData.length).toFixed(2)),
  }), [futureData]);
  const requiredStaffingTrendData = useMemo(() => futureData.map((row) => ({
    label: `${row.month} '${row.year.slice(2)}`,
    totalRequiredFTE: row.totalRequiredFTE,
    sharedPoolFTE: row.sharedPoolFTE,
    standalonePoolFTE: row.standalonePoolFTE,
  })), [futureData]);
  const pooledWorkloadChartData = useMemo(() => futureData.map((row) => {
    const point: Record<string, string | number> = {
      label: `${row.month} '${row.year.slice(2)}`,
      totalWorkloadHours: Number(row.pools.reduce((sum, pool) => sum + pool.workloadHours, 0).toFixed(1)),
    };
    row.pools.forEach((pool, index) => {
      point[`pool${index + 1}`] = pool.workloadHours;
    });
    return point;
  }), [futureData]);
  const seasonalityTrend = useMemo(() => {
    // row.volume is already the sum of all included channel volumes (set as includedVolume in futureData).
    // The previous per-channel reduce was adding email/chat on top of a row.volume that already
    // contained them, causing a 2× overcount for every non-voice included channel.
    const includedForecastSeries = futureData.map((row) => row.volume);
    if (includedForecastSeries.length === 0) return [];
    const average = includedForecastSeries.reduce((sum, value) => sum + value, 0) / includedForecastSeries.length;
    return futureData.map((row, index) => ({
      label: `${row.month} '${row.year.slice(2)}`,
      seasonalityIndex: average === 0 ? 0 : Number((((includedForecastSeries[index] ?? 0) / average) * 100).toFixed(1)),
    }));
  }, [futureData]);
  const scenarioComparisonData = useMemo(() => {
    const scenarioEntries = Object.values(scenarios);
    if (scenarioEntries.length === 0 || finalHistoricalData.length === 0) return [];
    const scenarioForecasts = scenarioEntries.map((scenario) => {
      const snap = scenario.snapshot;
      const activeAssumptions = scenario.id === selectedScenarioId ? assumptions : scenario.assumptions;
      const activeForecastMethod = scenario.id === selectedScenarioId ? forecastMethod : snap.forecastMethod;
      const activeHwParams = scenario.id === selectedScenarioId ? hwParams : snap.hwParams;
      const activeArimaParams = scenario.id === selectedScenarioId ? arimaParams : snap.arimaParams;
      const activeDecompParams = scenario.id === selectedScenarioId ? decompParams : snap.decompParams;
      const snapLegacyBlendState = getBlendStateFromLegacyPreset(normalizeBlendPreset(snap.activeBlendPreset));
      const activeSelectedChannels = scenario.id === selectedScenarioId ? selectedChannels : normalizeSelectedChannels(snap.selectedChannels || snapLegacyBlendState.selectedChannels);
      const activePoolingMode = scenario.id === selectedScenarioId ? poolingMode : (snap.poolingMode === "dedicated" ? "dedicated" : snapLegacyBlendState.poolingMode);
      const activeOverrides = scenario.id === selectedScenarioId ? historicalOverridesByChannel : snap.channelHistoricalOverrides;
      // Apply each scenario's own overrides to the current API data per channel
      const buildSnapHistory = (channel: ChannelKey) =>
        historicalApiDataByChannel[channel].map((v, i) => {
          const ov = activeOverrides?.[channel]?.[i];
          if (ov === undefined || ov === "") return v;
          const parsed = parseInt(ov, 10);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : v;
        });
      const snapVoiceHistory = buildSnapHistory("voice").length > 0 ? buildSnapHistory("voice") : finalHistoricalData;
      const snapEmailHistory = buildSnapHistory("email");
      const snapChatHistory = buildSnapHistory("chat");
      const voiceForecast = getCalculatedVolumes(snapVoiceHistory, activeForecastMethod, activeAssumptions, activeHwParams, activeArimaParams, activeDecompParams);
      const emailForecast = snapEmailHistory.length > 0
        ? getCalculatedVolumes(snapEmailHistory, activeForecastMethod, activeAssumptions, activeHwParams, activeArimaParams, activeDecompParams)
        : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.email));
      const chatForecast = snapChatHistory.length > 0
        ? getCalculatedVolumes(snapChatHistory, activeForecastMethod, activeAssumptions, activeHwParams, activeArimaParams, activeDecompParams)
        : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.chat));
      const snapBlendConfig = buildBlendConfiguration(activeSelectedChannels, activePoolingMode);
      const snapEmailAht = activeAssumptions.emailAht ?? EMAIL_AHT_SECONDS;
      const snapChatAht = activeAssumptions.chatAht ?? CHAT_AHT_SECONDS;
      const forecast = buildDemandForecastData(snapVoiceHistory, activeAssumptions, activeForecastMethod, activeHwParams, activeArimaParams, activeDecompParams)
        .filter((row) => row.isFuture)
        .map((row, fi) => {
          const emailVol = emailForecast[fi] ?? Math.round(row.volume * CHANNEL_VOLUME_FACTORS.email);
          const chatVol = chatForecast[fi] ?? Math.round(row.volume * CHANNEL_VOLUME_FACTORS.chat);
          const channelMetrics: Record<ChannelKey, ChannelStaffingMetrics> = {
            voice: getChannelStaffingMetrics("voice", row.volume, activeAssumptions),
            email: getChannelStaffingMetrics("email", emailVol, activeAssumptions),
            chat: getChannelStaffingMetrics("chat", chatVol, activeAssumptions),
          };
          const totalRequiredFTE = snapBlendConfig.pools.reduce((sum, channels) => {
            const workloadHours = channels.reduce((poolSum, ch) => poolSum + channelMetrics[ch].workloadHours, 0);
            const referenceVolume = channels.reduce((poolSum, ch) => poolSum + channelMetrics[ch].volume, 0);
            const channelMix = channels.map((ch) => ({
              channel: ch,
              volume: channelMetrics[ch].volume,
              workloadHours: channelMetrics[ch].workloadHours,
              ahtSeconds: getChannelEffectiveAhtSeconds(activeAssumptions, ch),
            }));
            return sum + calculatePooledFTE(workloadHours, referenceVolume, activeAssumptions, channelMix);
          }, 0);
          return { ...row, totalRequiredFTE: Number(totalRequiredFTE.toFixed(1)) };
        });
      return { scenario, forecast };
    });
    return Array.from({ length: 12 }, (_, index) => {
      const point: Record<string, string | number> = { month: scenarioForecasts[0]?.forecast[index] ? `${scenarioForecasts[0].forecast[index].month} '${scenarioForecasts[0].forecast[index].year.slice(2)}` : `M${index + 1}` };
      scenarioForecasts.forEach(({ scenario, forecast }) => { point[scenario.id] = forecast[index]?.totalRequiredFTE ?? 0; });
      return point;
    });
  }, [scenarios, selectedScenarioId, assumptions, forecastMethod, hwParams, arimaParams, decompParams, selectedChannels, poolingMode, historicalOverridesByChannel, historicalApiDataByChannel, finalHistoricalData]);
  const scenarioColors = ["#2563eb", "#f59e0b", "#10b981", "#7c3aed", "#ef4444", "#0f766e"];
  const poolExplainability = useMemo(() => selectedBlendConfig.pools.map((channels, index) => ({
    poolName: `Pool ${String.fromCharCode(65 + index)}`,
    channels,
    averageWorkload: futureData.length > 0 ? Number((futureData.reduce((sum, row) => sum + (row.pools[index]?.workloadHours ?? 0), 0) / futureData.length).toFixed(1)) : 0,
    averageFTE: futureData.length > 0 ? Number((futureData.reduce((sum, row) => sum + (row.pools[index]?.fte ?? 0), 0) / futureData.length).toFixed(1)) : 0,
    isShared: channels.length > 1,
  })), [futureData, selectedBlendConfig]);
  const averageChannelMetrics = useMemo<Record<ChannelKey, { model: string; averageFTE: number; averageOccupancy: number }>>(() => ({
    voice: {
      model: getChannelModelLabel("voice"),
      averageFTE: futureData.length > 0 ? roundTo(futureData.reduce((sum, row) => sum + row.channelMetrics.voice.requiredFTE, 0) / futureData.length, 1) : 0,
      averageOccupancy: futureData.length > 0 ? roundTo(futureData.reduce((sum, row) => sum + row.channelMetrics.voice.requiredOccupancy, 0) / futureData.length, 1) : 0,
    },
    email: {
      model: getChannelModelLabel("email"),
      averageFTE: futureData.length > 0 ? roundTo(futureData.reduce((sum, row) => sum + row.channelMetrics.email.requiredFTE, 0) / futureData.length, 1) : 0,
      averageOccupancy: futureData.length > 0 ? roundTo(futureData.reduce((sum, row) => sum + row.channelMetrics.email.requiredOccupancy, 0) / futureData.length, 1) : 0,
    },
    chat: {
      model: getChannelModelLabel("chat"),
      averageFTE: futureData.length > 0 ? roundTo(futureData.reduce((sum, row) => sum + row.channelMetrics.chat.requiredFTE, 0) / futureData.length, 1) : 0,
      averageOccupancy: futureData.length > 0 ? roundTo(futureData.reduce((sum, row) => sum + row.channelMetrics.chat.requiredOccupancy, 0) / futureData.length, 1) : 0,
    },
  }), [futureData]);
  const isChannelIncludedInBlend = (channel: ChannelKey) => includedChannels.includes(channel);
  const channelAssumptionSummary = useMemo(() => [
    {
      key: "voice" as const,
      label: CHANNEL_ASSUMPTION_META.voice.label,
      isIncluded: isChannelIncludedInBlend("voice"),
      modelRule: averageChannelMetrics.voice.model,
      volumeRule: "Uses the voice historical series and active forecast method.",
      ahtRule: `${assumptions.aht}s AHT`,
      serviceRule: `Staffing uses SLA ${assumptions.voiceSlaTarget}% in ${assumptions.voiceSlaAnswerSeconds}s. ASA ${assumptions.voiceAsaTargetSeconds}s is stored on the page but not applied in this calculation.`,
      workloadRule: "Volume x AHT / 3600",
      staffingRule: isChannelIncludedInBlend("voice")
        ? "Voice sets the base staffed seats. In shared pools, any idle voice capacity can absorb chat first and then email."
        : "Erlang C finds the minimum staffed seats that satisfy the voice SLA target.",
      occupancyRule: isChannelIncludedInBlend("voice")
        ? `${averageChannelMetrics.voice.averageOccupancy}% required occupancy in the active plan`
        : `${averageChannelMetrics.voice.averageOccupancy}% standalone required occupancy`,
      fteRule: isChannelIncludedInBlend("voice")
        ? `${averageChannelMetrics.voice.averageFTE} average FTE contribution in the active plan`
        : `${averageChannelMetrics.voice.averageFTE} average standalone FTE`,
    },
    {
      key: "email" as const,
      label: CHANNEL_ASSUMPTION_META.email.label,
      isIncluded: isChannelIncludedInBlend("email"),
      modelRule: averageChannelMetrics.email.model,
      volumeRule: hasExplicitHistoryByChannel.email ? "Uses channel historical series and forecast method" : "20% of voice forecast volume fallback",
      ahtRule: `${assumptions.emailAht}s AHT`,
      serviceRule: `Staffing uses a backlog window of ${assumptions.emailSlaTarget}% within ${assumptions.emailSlaAnswerSeconds}s. ASA ${assumptions.emailAsaTargetSeconds}s is stored on the page but not applied in this calculation.`,
      workloadRule: "Base load = Volume x AHT / open hours; backlog load = daily workload x SLA% / response window",
      staffingRule: isChannelIncludedInBlend("email")
        ? "In shared pools, email only adds staff after remaining voice idle time and chat absorption are exhausted."
        : "Agents = max(base workload seats, SLA backlog seats) before shrinkage and safety margin.",
      occupancyRule: isChannelIncludedInBlend("email")
        ? `${averageChannelMetrics.email.averageOccupancy}% required occupancy when email workload needs dedicated coverage`
        : `${averageChannelMetrics.email.averageOccupancy}% standalone required occupancy`,
      fteRule: isChannelIncludedInBlend("email")
        ? `${averageChannelMetrics.email.averageFTE} average FTE equivalent before shared-pool offsets`
        : `${averageChannelMetrics.email.averageFTE} average standalone FTE`,
    },
    {
      key: "chat" as const,
      label: CHANNEL_ASSUMPTION_META.chat.label,
      isIncluded: isChannelIncludedInBlend("chat"),
      modelRule: averageChannelMetrics.chat.model,
      volumeRule: hasExplicitHistoryByChannel.chat ? "Uses channel historical series and forecast method" : "30% of voice forecast volume fallback",
      ahtRule: `${assumptions.chatAht}s AHT`,
      serviceRule: `Staffing uses SLA ${assumptions.chatSlaTarget}% in ${assumptions.chatSlaAnswerSeconds}s with ${assumptions.chatConcurrency} concurrent chats. ASA ${assumptions.chatAsaTargetSeconds}s is stored on the page but not applied in this calculation.`,
      workloadRule: `Volume x AHT / 3600 / ${assumptions.chatConcurrency} concurrency`,
      staffingRule: isChannelIncludedInBlend("chat")
        ? "In shared pools, chat workload is reduced by concurrency and then offset by available voice idle capacity before extra staff is added."
        : `Modified Erlang C uses effective AHT = AHT / ${assumptions.chatConcurrency} concurrent chats.`,
      occupancyRule: isChannelIncludedInBlend("chat")
        ? `${averageChannelMetrics.chat.averageOccupancy}% required occupancy when chat still needs staffed coverage`
        : `${averageChannelMetrics.chat.averageOccupancy}% standalone required occupancy`,
      fteRule: isChannelIncludedInBlend("chat")
        ? `${averageChannelMetrics.chat.averageFTE} average FTE equivalent before shared-pool offsets`
        : `${averageChannelMetrics.chat.averageFTE} average standalone FTE`,
    },
  ], [assumptions.aht, assumptions.emailAht, assumptions.chatAht, assumptions.voiceSlaTarget, assumptions.voiceSlaAnswerSeconds, assumptions.voiceAsaTargetSeconds, assumptions.emailSlaTarget, assumptions.emailSlaAnswerSeconds, assumptions.emailAsaTargetSeconds, assumptions.chatSlaTarget, assumptions.chatSlaAnswerSeconds, assumptions.chatAsaTargetSeconds, hasExplicitHistoryByChannel, averageChannelMetrics, includedChannels]);
  const openHoursPerMonth = useMemo(() => Number(getOpenHoursPerMonth(assumptions).toFixed(1)), [assumptions]);

  // Helper component: display shrinkage sourced from Shrinkage Planner
  const ShrinkagePlannerLink: React.FC<{
    source: "planner_excl" | "planner_incl";
    shrinkage: number;
  }> = ({ source, shrinkage }) => {
    const stored = (() => {
      try {
        const raw = localStorage.getItem("wfm_shrinkage_totals");
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    })();

    const hasValue =
      stored &&
      typeof (source === "planner_excl" ? stored.totalExcl : stored.totalIncl) ===
        "number";
    const lastUpdated = stored?.lastUpdated
      ? new Date(stored.lastUpdated).toLocaleString()
      : null;

    return (
      <div className="rounded-lg border border-rose-200/60 dark:border-rose-700/40 bg-rose-50/40 dark:bg-rose-950/20 p-3 space-y-2">
        {hasValue ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {source === "planner_excl" ? "Excl. holidays" : "Incl. holidays"}
              </span>
              <span className="text-sm font-black text-rose-600">{shrinkage}%</span>
            </div>
            {lastUpdated && (
              <p className="text-[10px] text-muted-foreground">
                Updated: {lastUpdated}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            No Shrinkage Planner data found. Visit the Shrinkage Planning page
            first.
          </p>
        )}
        <Link
          to="/wfm/shrinkage"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          Open Shrinkage Planning <ChevronRight className="size-3" />
        </Link>
      </div>
    );
  };

  if (loading) return <PageLayout title="Long Term Forecasting  Demand"><div className="h-[60vh] flex flex-col items-center justify-center gap-4"><Loader2 className="size-12 text-primary animate-spin" /><p className="text-muted-foreground font-medium">Loading demand forecast data...</p></div></PageLayout>;

  return (
    <TooltipProvider>
      <PageLayout title="Long Term Forecasting  Demand">
        <div className="flex flex-col gap-8 pb-12">
          <section className="rounded-3xl bg-gradient-to-br from-slate-400 to-slate-300 px-6 py-8 shadow-lg">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-700">Long Term Forecasting Demand</p>
            <h1 className="mt-3 font-heading text-3xl md:text-4xl text-slate-900">Multi-Channel Demand & Capacity Planning</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-800">
              Forecast demand across voice, chat, and email channels. Configure dedicated or blended staffing pools, calculate required FTE based on volume forecasts and operational constraints, and optimize resource allocation.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <Card className="bg-white/20 border border-slate-300/40 shadow-lg shadow-slate-900/20">
                <CardContent className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-700">Forecasted Monthly Volume</p>
                  <h3 className="mt-2 text-3xl font-black text-slate-900">{kpis.avgVolume.toLocaleString()}</h3>
                  <p className="text-xs text-slate-600">Average across the active horizon</p>
                </CardContent>
              </Card>
              <Card className="bg-white/20 border border-slate-300/40 shadow-lg shadow-slate-900/20">
                <CardContent className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-700">Workload Hours</p>
                  <h3 className="mt-2 text-3xl font-black text-slate-900">{kpis.avgWorkloadHours.toLocaleString()}</h3>
                  <p className="text-xs text-slate-600">Converted from channel AHTs &amp; open hours</p>
                </CardContent>
              </Card>
              <Card className="bg-white/20 border border-slate-300/40 shadow-lg shadow-slate-900/20">
                <CardContent className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-700">Required Agents / FTE</p>
                  <h3 className="mt-2 text-3xl font-black text-slate-900">{kpis.avgRequiredFTE}</h3>
                  <p className="text-xs text-slate-600">Average total FTE for {selectedBlendConfig.label}</p>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* ── Scenario Manager ── */}
          <Card className="border border-border/50 shadow-sm">
            <CardContent className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground shrink-0">Scenarios</span>
                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                  {Object.values(scenarios).map((scenario) => (
                    <button
                      key={scenario.id}
                      type="button"
                      onClick={() => handleScenarioChange(scenario.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
                        scenario.id === selectedScenarioId
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-accent"
                      }`}
                    >
                      <span className="max-w-[160px] truncate">{scenario.name}</span>
                      <X
                        className="size-3 shrink-0 opacity-50 hover:opacity-100"
                        onClick={(e) => handleDeleteScenario(e, scenario.id)}
                      />
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleNewScenario}>
                    <Plus className="size-3.5" />
                    New
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleRenameScenario}>
                    <Pencil className="size-3.5" />
                    Rename
                  </Button>
                  <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={handleSaveScenario}>
                    <Save className="size-3.5" />
                    Save
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-primary/15 shadow-md overflow-hidden">
            <CardHeader className="bg-slate-50/60 border-b border-border/50">
              <button type="button" className="w-full flex items-start justify-between gap-4 text-left" onClick={() => setIsHistoricalSourceOpen((current) => !current)}>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <CardTitle className="text-base font-black uppercase tracking-widest">Historical Data Source</CardTitle>
                    <Badge variant="outline" className="border-primary/20 text-primary">{historicalSourceRows.length} Months</Badge>
                    {overrideCount > 0 && <Badge className="bg-amber-500 hover:bg-amber-500 text-black">{overrideCount} Overrides</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">Review and adjust the baseline monthly historical volumes used for forecast generation</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-3.5 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">Manual overrides allow planners to incorporate business judgment beyond system-fed data.</p>
                      </TooltipContent>
                    </UITooltip>
                    <span>Section A: Forecast input layer</span>
                  </div>
                </div>
                <div className="shrink-0 mt-1 rounded-full border border-border bg-background p-2">
                  {isHistoricalSourceOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </div>
              </button>
            </CardHeader>
            <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isHistoricalSourceOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <div className="overflow-hidden">
                <CardContent className={`space-y-4 pt-6 transition-opacity duration-200 ${isHistoricalSourceOpen ? "opacity-100" : "opacity-0"}`}>
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="space-y-3">
                      <div className="text-sm text-muted-foreground">
                        Final Historical Volume Used feeds trend, growth, seasonality, forecast volume, and required staffing outputs. If API data is unavailable for a channel, clear the baseline and enter manual monthly volumes.
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="w-full sm:w-[220px]">
                          <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Channel View</Label>
                          <Select value={historicalChannelView} onValueChange={(value) => setHistoricalChannelView(value as ChannelKey)}>
                            <SelectTrigger className="mt-2 h-10 font-semibold">
                              <SelectValue placeholder="Select channel" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="voice">Voice</SelectItem>
                              <SelectItem value="email">Email</SelectItem>
                              <SelectItem value="chat">Chat</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="w-full sm:w-[120px]">
                          <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Data Year</Label>
                          <Input
                            type="number"
                            min={2000}
                            max={2100}
                            className="mt-2 h-10 font-bold"
                            value={new Date(assumptions.startDate).getFullYear() - 1}
                            onChange={(e) => {
                              const yr = Math.max(2000, Math.min(2100, Number(e.target.value)));
                              if (Number.isFinite(yr)) {
                                setAssumptions((prev) => ({ ...prev, startDate: `${yr + 1}-01-01` }));
                              }
                            }}
                          />
                        </div>
                        <div className="text-sm font-semibold text-foreground">
                          Currently Viewing: <span className={CHANNEL_ASSUMPTION_META[historicalChannelView].colorClass}>{CHANNEL_ASSUMPTION_META[historicalChannelView].label}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="gap-2" onClick={handleClearApiData}>
                        <Trash2 className="size-4" />
                        Clear API Data
                      </Button>
                      <Button variant="outline" size="sm" className="gap-2" onClick={handleRestoreApiData} disabled={!canRestoreApiData}>
                        <RotateCcw className="size-4" />
                        Restore API Data
                      </Button>
                      <Button variant="outline" size="sm" className="gap-2" onClick={handleResetAllOverrides} disabled={overrideCount === 0}>
                        <RotateCcw className="size-4" />
                        Reset All Overrides
                      </Button>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-border/60">
                    <Table>
                      <TableHeader className="bg-slate-50/80 dark:bg-slate-900/80">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="pl-6 text-xs font-black uppercase tracking-widest">Month</TableHead>
                          <TableHead className="text-right text-xs font-black uppercase tracking-widest">API Volume</TableHead>
                          <TableHead className="text-right text-xs font-black uppercase tracking-widest">Override Volume</TableHead>
                          <TableHead className="text-right text-xs font-black uppercase tracking-widest">Final Volume Used</TableHead>
                          <TableHead className="text-right text-xs font-black uppercase tracking-widest">Variance %</TableHead>
                          <TableHead className="pr-6 text-right text-xs font-black uppercase tracking-widest">Override Toggle / Edit State</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {historicalSourceRows.map((row) => (
                          <TableRow key={row.index} className={row.canEdit ? "bg-amber-50/60 dark:bg-amber-950/10" : ""}>
                            <TableCell className="pl-6">
                              <div className="flex flex-col">
                                <span className="font-bold text-sm">{row.monthLabel}</span>
                                {row.canEdit && <span className="text-[11px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">{row.stateLabel}</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">{formatInteger(row.apiVolume)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end">
                                <Input
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={row.overrideVolume}
                                  onChange={(event) => handleOverrideChange(row.index, event.target.value)}
                                  onBlur={() => handleOverrideBlur(row.index)}
                                  placeholder={String(row.apiVolume)}
                                  disabled={!row.canEdit}
                                  className="h-9 w-32 text-right font-mono"
                                />
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-bold text-primary">{formatInteger(row.finalVolume)}</TableCell>
                            <TableCell className={`text-right font-mono text-sm ${row.variancePct === null ? "text-muted-foreground" : row.variancePct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                              {row.variancePct === null ? "0.0%" : `${row.variancePct > 0 ? "+" : ""}${row.variancePct.toFixed(1)}%`}
                            </TableCell>
                            <TableCell className="pr-6">
                              <div className="flex items-center justify-end gap-3">
                                <div className="flex items-center gap-2">
                                  <Switch checked={row.canEdit} onCheckedChange={(checked) => handleOverrideToggle(row.index, checked)} disabled={row.stateLabel === "Manual"} />
                                  <Badge variant={row.canEdit ? "default" : "outline"} className={row.canEdit ? "bg-amber-500 hover:bg-amber-500 text-black" : ""}>{row.stateLabel}</Badge>
                                </div>
                                <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => handleResetMonthOverride(row.index)} disabled={!row.canEdit}>
                                  Reset
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </div>
            </div>
          </Card>
          <div className="space-y-1">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">Section B</p>
            <p className="text-sm font-semibold text-foreground">Forecasted Demand Output</p>
          </div>
          <Card className="border border-border/60 shadow-sm overflow-hidden">
            <CardHeader className="border-b border-border/50 bg-slate-50/50">
              <button type="button" className="w-full flex items-start justify-between gap-4 text-left" onClick={() => setIsBlendedStaffingOpen((current) => !current)}>
                <div className="space-y-2">
                  <CardTitle className="text-base font-black uppercase tracking-widest">Channel Staffing Setup</CardTitle>
                  <p className="text-sm text-muted-foreground">Choose which channels are included and whether they share one agent pool or stay dedicated.</p>
                </div>
                <div className="shrink-0 mt-1 rounded-full border border-border bg-background p-2">
                  {isBlendedStaffingOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </div>
              </button>
            </CardHeader>
            <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isBlendedStaffingOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <div className="overflow-hidden">
                <CardContent className={`pt-6 space-y-6 transition-opacity duration-200 ${isBlendedStaffingOpen ? "opacity-100" : "opacity-0"}`}>
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-4">
                <Card className="border border-border/60 shadow-none rounded-3xl bg-white/90 dark:bg-slate-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-black uppercase tracking-widest">Channel Selection</CardTitle>
                  <p className="text-sm text-muted-foreground">Tick the channels you want included in the staffing view. You can also isolate email-only or chat-only scenarios.</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(["voice", "email", "chat"] as ChannelKey[]).map((channel) => (
                      <label key={channel} className={`flex items-start gap-3 rounded-xl border border-border/60 p-4 cursor-pointer ${CHANNEL_ASSUMPTION_META[channel].bgClass}`}>
                        <Checkbox
                          checked={selectedChannels[channel]}
                          onCheckedChange={(checked) => handleSelectedChannelChange(channel, checked)}
                          className="mt-0.5"
                        />
                        <div className="space-y-1">
                      <p className={`text-sm font-black uppercase tracking-widest ${CHANNEL_ASSUMPTION_META[channel].colorClass}`}>{CHANNEL_ASSUMPTION_META[channel].label}</p>
                          <p className="text-sm text-muted-foreground">
                            {channel === "voice" ? "Priority queue and base staffing channel." : channel === "chat" ? `Concurrent channel with ${assumptions.chatConcurrency} chats per staffed seat.` : "Deferred workload channel."}
                          </p>
                        </div>
                      </label>
                    ))}
                  </CardContent>
                </Card>
                <Card className="border border-border/60 shadow-none rounded-3xl bg-white/90 dark:bg-slate-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-black uppercase tracking-widest">Pooling Mode</CardTitle>
                    <p className="text-sm text-muted-foreground">Choose whether selected channels share one pool or remain dedicated.</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <RadioGroup value={poolingMode} onValueChange={(value) => setPoolingMode(value as PoolingMode)} className="gap-3">
                      <label className="flex items-start gap-3 rounded-xl border border-border/60 p-4 cursor-pointer">
                        <RadioGroupItem value="blended" className="mt-0.5" />
                        <div className="space-y-1">
                          <p className="text-sm font-black uppercase tracking-widest">Blend Selected Channels</p>
                          <p className="text-sm text-muted-foreground">All selected channels share a single staffed pool.</p>
                        </div>
                      </label>
                      <label className="flex items-start gap-3 rounded-xl border border-border/60 p-4 cursor-pointer">
                        <RadioGroupItem value="dedicated" className="mt-0.5" />
                        <div className="space-y-1">
                          <p className="text-sm font-black uppercase tracking-widest">Dedicated</p>
                          <p className="text-sm text-muted-foreground">Each selected channel remains in its own pool.</p>
                        </div>
                      </label>
                    </RadioGroup>
                    <div className="rounded-lg border border-border/60 bg-slate-50/70 p-3 text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">Active setup:</span> {selectedBlendConfig.label}. {selectedBlendConfig.description}.
                    </div>
                  </CardContent>
                </Card>
              </div>
              <Card className="border border-border/60 shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-black uppercase tracking-widest">Blended Staffing Pools</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {poolExplainability.map((pool) => (
                    <div key={pool.poolName} className="rounded-lg border border-border/50 p-4 bg-slate-50/40">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{pool.poolName}</p>
                          <p className="text-sm font-semibold">{pool.channels.map((channel) => channel.charAt(0).toUpperCase() + channel.slice(1)).join(" + ")}</p>
                        </div>
                        <Badge variant={pool.isShared ? "default" : "outline"} className={pool.isShared ? "bg-emerald-600" : ""}>{pool.isShared ? "Shared Pool" : "Standalone Pool"}</Badge>
                      </div>
                      <div className="mt-3 flex gap-6 text-sm text-muted-foreground flex-wrap">
                        <span>Avg workload: <strong className="text-foreground">{pool.averageWorkload}</strong> hrs</span>
                        <span>Avg FTE: <strong className="text-foreground">{pool.averageFTE}</strong></span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
                <Card className="border border-border/60 shadow-none rounded-3xl bg-white/95 dark:bg-slate-900/70">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-black uppercase tracking-widest">Channel Workload Assumptions</CardTitle>
                  <p className="text-sm text-muted-foreground">These notes now reflect the live calculation logic for each channel and the current channel-selection setup.</p>
                </CardHeader>
                <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  {channelAssumptionSummary.map((channel) => (
                    <div key={channel.key} className={`rounded-lg border border-border/50 p-4 ${CHANNEL_ASSUMPTION_META[channel.key].bgClass}`}>
                      <div className="flex items-center justify-between gap-3">
                        <p className={`text-sm font-black uppercase tracking-widest ${CHANNEL_ASSUMPTION_META[channel.key].colorClass}`}>{channel.label}</p>
                        <Badge variant="outline">{channel.isIncluded ? "Included" : "Excluded"}</Badge>
                      </div>
                      <div className="mt-3 space-y-2 text-sm">
                        <p><span className="font-semibold text-muted-foreground">Model:</span> {channel.modelRule}</p>
                        <p><span className="font-semibold">Volume:</span> {channel.volumeRule}</p>
                        <p><span className="font-semibold">AHT:</span> {channel.ahtRule}</p>
                        <p><span className="font-semibold">SLA / ASA:</span> {channel.serviceRule}</p>
                        <p><span className="font-semibold">Workload:</span> {channel.workloadRule}</p>
                        <p><span className="font-semibold">Staffing:</span> {channel.staffingRule}</p>
                        <p><span className="font-semibold">Occupancy:</span> {channel.occupancyRule}</p>
                        <p><span className="font-semibold">FTE:</span> {channel.fteRule}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
                </CardContent>
              </div>
            </div>
          </Card>
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
            <div className="space-y-6">
              <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
                <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-slate-50/30"><CardTitle className="text-base font-black uppercase tracking-widest">Monthly Volume Trend</CardTitle><p className="text-sm text-muted-foreground">Month-by-month year-over-year view so planners can compare seasonal patterns across actual years and the forecast year.</p></CardHeader><CardContent className="p-6 h-[340px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={volumeTrendComparison.chartData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="month" tickLine={false} axisLine={false} interval={0} /><YAxis tickLine={false} axisLine={false} /><Tooltip formatter={(value, name) => [value == null ? "-" : Number(value).toLocaleString(), name]} /><Legend />{volumeTrendComparison.series.map((series) => <Line key={series.key} type="linear" dataKey={series.key} name={series.label} stroke={series.stroke} strokeOpacity={series.isForecast ? 0.98 : 0.72} strokeWidth={series.isForecast ? 3.5 : 2.25} strokeDasharray={series.isForecast ? "8 5" : undefined} dot={series.isForecast ? false : { r: 1.75, fill: series.stroke, fillOpacity: 0.75, stroke: "#ffffff", strokeWidth: 1 }} activeDot={{ r: 5, fill: series.stroke, stroke: "#ffffff", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></CardContent></Card>
                <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-slate-50/30"><CardTitle className="text-base font-black uppercase tracking-widest">Workload Trend</CardTitle><p className="text-sm text-muted-foreground">Pool workloads update with the current channel selection and pooling mode.</p></CardHeader><CardContent className="p-6 h-[340px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={pooledWorkloadChartData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Legend />{selectedBlendConfig.pools.map((_, index) => <Line key={`pool${index + 1}`} type="monotone" dataKey={`pool${index + 1}`} name={`Pool ${String.fromCharCode(65 + index)} Workload`} stroke={["#4f46e5", "#0f766e", "#dc2626"][index % 3]} strokeWidth={3} />)}<Line type="monotone" dataKey="totalWorkloadHours" name="Total Workload" stroke="#94a3b8" strokeDasharray="6 4" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></CardContent></Card>
                <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-slate-50/30"><CardTitle className="text-base font-black uppercase tracking-widest">Required Staffing Trend</CardTitle><p className="text-sm text-muted-foreground">Shared pools recalculate FTE from pooled workload, weighted service targets, and the current staffing setup.</p></CardHeader><CardContent className="p-6 h-[340px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={requiredStaffingTrendData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Legend /><Line type="monotone" dataKey="sharedPoolFTE" name="Shared Pool FTE" stroke="#0f766e" strokeWidth={3} /><Line type="monotone" dataKey="standalonePoolFTE" name="Standalone Pool FTE" stroke="#2563eb" strokeWidth={3} /><Line type="monotone" dataKey="totalRequiredFTE" name="Total Required FTE" stroke="#f59e0b" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></CardContent></Card>
                <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-slate-50/30"><CardTitle className="text-base font-black uppercase tracking-widest">Seasonality Trend</CardTitle></CardHeader><CardContent className="p-6 h-[340px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={seasonalityTrend}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Legend /><Bar dataKey="seasonalityIndex" name="Seasonality Index" fill="#0f766e" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></CardContent></Card>
              </div>
              <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-slate-50/30"><CardTitle className="text-base font-black uppercase tracking-widest">Scenario Comparison For Required FTE</CardTitle></CardHeader><CardContent className="p-6 h-[360px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={scenarioComparisonData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="month" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Legend />{Object.values(scenarios).map((scenario, index) => <Line key={scenario.id} type="monotone" dataKey={scenario.id} name={scenario.name} stroke={scenarioColors[index % scenarioColors.length]} strokeWidth={scenario.id === selectedScenarioId ? 3.5 : 2} dot={false} />)}</LineChart></ResponsiveContainer></CardContent></Card>
              <Card className="border border-border/50 shadow-lg bg-white/70 dark:bg-slate-900/70">
                <CardHeader className="border-b border-border/50 bg-slate-50/70">
                  <CardTitle className="text-base font-black uppercase tracking-widest">Demand Forecast Detail</CardTitle>
                  <p className="text-xs text-muted-foreground">Details are tied to the ${selectedBlendConfig.label} setup.</p>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-50/80 dark:bg-slate-900/80">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-6 text-sm font-black uppercase tracking-widest">Month</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest">Forecast Volume</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest">Forecast Workload Hours</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest">AHT</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest">Occupancy</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest">Shrinkage</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest">Active Setup</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest">Shared Pool Workload</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest">Shared Pool FTE</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest">Standalone Pool FTE</TableHead>
                        <TableHead className="pr-6 text-right text-sm font-black uppercase tracking-widest">Total Required FTE</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {futureData.map((row) => (
                        <TableRow key={`${row.year}-${row.month}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50">
                          <TableCell className="pl-6 font-bold text-sm">{row.month} {row.year}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-bold text-primary">{row.volume.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-indigo-600">{row.workloadHours.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{row.aht}s</TableCell>
                          <TableCell className="text-right font-mono text-sm">{row.occupancy}%</TableCell>
                          <TableCell className="text-right font-mono text-sm">{row.shrinkage}%</TableCell>
                          <TableCell className="text-right text-sm">{row.activeBlendPreset}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{row.sharedPoolWorkload > 0 ? row.sharedPoolWorkload.toLocaleString() : "-"}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{row.sharedPoolFTE > 0 ? row.sharedPoolFTE.toLocaleString() : "-"}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{row.standalonePoolFTE > 0 ? row.standalonePoolFTE.toLocaleString() : "-"}</TableCell>
                          <TableCell className="pr-6 text-right font-mono text-sm font-bold text-amber-600">{row.totalRequiredFTE}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
            <div className="xl:sticky xl:top-[180px]">
              <Card className="border border-border/80 shadow-xl overflow-hidden">
                <CardHeader className="border-b border-border/50 bg-slate-900 text-white py-4"><div className="flex items-center justify-between"><CardTitle className="text-sm font-black flex items-center gap-2 uppercase tracking-[0.2em]"><Settings2 className="size-4 text-blue-400" />Demand Assumptions</CardTitle><Button variant="ghost" size="icon" className="size-6 text-white hover:bg-white/10" onClick={() => setIsAssumptionsOpen(!isAssumptionsOpen)}>{isAssumptionsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Button></div></CardHeader>
                {isAssumptionsOpen && <CardContent className="pt-6 space-y-6 bg-white dark:bg-slate-950">
                  <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="startDate" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Planning Start Date</Label><Calendar className="size-3.5 text-primary" /></div><Input id="startDate" type="date" value={assumptions.startDate} onChange={(event) => setAssumptions({ ...assumptions, startDate: event.target.value })} className="h-10 font-bold" /></div>
                  <div className="space-y-3 border-t border-border pt-4"><Select value={forecastMethod} onValueChange={setForecastMethod}><SelectTrigger className="h-10 font-bold"><SelectValue placeholder="Choose forecast method..." /></SelectTrigger><SelectContent>{FORECAST_METHODS.map((method) => <SelectItem key={method.key} value={method.key}>{method.label}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="aht" className="text-xs font-black uppercase tracking-widest text-muted-foreground">AHT Assumption</Label><span className="text-xs font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-primary">{assumptions.aht}s</span></div><Input id="aht" type="number" value={assumptions.aht} onChange={(event) => setAssumptions({ ...assumptions, aht: validateInput(Number(event.target.value)) })} className="h-10 font-bold" /></div>
                  <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="emailAht" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Email AHT</Label><span className="text-xs font-black bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded text-emerald-700 dark:text-emerald-300">{assumptions.emailAht}s</span></div><Input id="emailAht" type="number" value={assumptions.emailAht} onChange={(event) => setAssumptions({ ...assumptions, emailAht: validateInput(Number(event.target.value)) })} className="h-10 font-bold" /></div>
                  <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="chatAht" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Chat AHT</Label><span className="text-xs font-black bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded text-amber-700 dark:text-amber-300">{assumptions.chatAht}s</span></div><Input id="chatAht" type="number" value={assumptions.chatAht} onChange={(event) => setAssumptions({ ...assumptions, chatAht: validateInput(Number(event.target.value)) })} className="h-10 font-bold" /></div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Label htmlFor="chatConcurrency" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Chat Concurrency</Label>
                        <UITooltip>
                          <TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                          <TooltipContent><p className="text-xs">Simultaneous chats handled per agent. Reduces effective AHT (AHT ÷ concurrency) for Erlang C and workload calculations. Higher concurrency lowers FTE but raises agent cognitive load.</p></TooltipContent>
                        </UITooltip>
                      </div>
                      <span className="text-xs font-black bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded text-amber-700 dark:text-amber-300">{assumptions.chatConcurrency}×</span>
                    </div>
                    <Input id="chatConcurrency" type="number" min="1" max="10" step="1" value={assumptions.chatConcurrency} onChange={(event) => setAssumptions({ ...assumptions, chatConcurrency: validateInput(Math.round(Number(event.target.value)), 1, 10) })} className="h-10 font-bold" />
                    <p className="text-[11px] text-muted-foreground">Effective Chat AHT = {assumptions.chatAht}s ÷ {assumptions.chatConcurrency} = <span className="font-bold text-foreground">{Math.round(assumptions.chatAht / Math.max(1, assumptions.chatConcurrency))}s</span></p>
                  </div>
                  {/* ── Shrinkage ── */}
                  <div className="space-y-3 border-t border-border pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Shrinkage</Label>
                        <UITooltip>
                          <TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                          <TooltipContent><p className="text-xs">FTE gross-up. Use Manual for a flat %, or pull from the Shrinkage Planner.</p></TooltipContent>
                        </UITooltip>
                      </div>
                      <span className="text-xs font-black bg-rose-50 dark:bg-rose-900/20 px-2 py-1 rounded text-rose-600">
                        {assumptions.shrinkage}%
                      </span>
                    </div>

                    <Select
                      value={assumptions.shrinkageSource ?? "manual"}
                      onValueChange={(val) =>
                        setAssumptions((prev) => ({ ...prev, shrinkageSource: val as Assumptions["shrinkageSource"] }))
                      }>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual" className="text-xs">Manual entry</SelectItem>
                        <SelectItem value="planner_excl" className="text-xs">Shrinkage Planner (excl. holidays)</SelectItem>
                        <SelectItem value="planner_incl" className="text-xs">Shrinkage Planner (incl. holidays)</SelectItem>
                      </SelectContent>
                    </Select>

                    {(assumptions.shrinkageSource ?? "manual") === "manual" && (
                      <Input
                        id="shrinkage"
                        type="number"
                        value={assumptions.shrinkage}
                        onChange={(e) =>
                          setAssumptions({ ...assumptions, shrinkage: validateInput(Number(e.target.value), 0, 99) })
                        }
                        className="h-10 font-bold"
                      />
                    )}

                    {((assumptions.shrinkageSource ?? "manual") === "planner_excl" ||
                      (assumptions.shrinkageSource ?? "manual") === "planner_incl") && (
                      <ShrinkagePlannerLink source={assumptions.shrinkageSource!} shrinkage={assumptions.shrinkage} />
                    )}
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Occupancy</Label>
                      <Badge variant="outline" className="font-black text-xs border-indigo-200 text-indigo-700">Derived From SLA</Badge>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {(["voice", "email", "chat"] as ChannelKey[]).map((channelKey) => (
                        <div key={channelKey} className={`rounded-xl border border-border/60 p-3 ${CHANNEL_ASSUMPTION_META[channelKey].bgClass}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className={`text-xs font-black uppercase tracking-widest ${CHANNEL_ASSUMPTION_META[channelKey].colorClass}`}>{CHANNEL_ASSUMPTION_META[channelKey].label}</p>
                              <p className="text-[11px] text-muted-foreground">{averageChannelMetrics[channelKey].model}</p>
                            </div>
                            <Badge variant="outline" className="font-black">{averageChannelMetrics[channelKey].averageFTE} FTE</Badge>
                          </div>
                          <div className="mt-3 flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Required Occupancy</span>
                            <span className="font-black text-foreground">{averageChannelMetrics[channelKey].averageOccupancy}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-4 rounded-xl border border-border/60 p-4">
                    <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Voice SLA / ASA</p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2"><Label htmlFor="voiceSlaTarget" className="text-xs font-medium text-muted-foreground">SLA %</Label><Input id="voiceSlaTarget" type="number" value={assumptions.voiceSlaTarget} onChange={(event) => setAssumptions({ ...assumptions, voiceSlaTarget: validateInput(Number(event.target.value), 1, 100) })} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label htmlFor="voiceSlaAnswerSeconds" className="text-xs font-medium text-muted-foreground">Within Sec</Label><Input id="voiceSlaAnswerSeconds" type="number" value={assumptions.voiceSlaAnswerSeconds} onChange={(event) => setAssumptions({ ...assumptions, voiceSlaAnswerSeconds: validateInput(Number(event.target.value), 1, 3600) })} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label htmlFor="voiceAsaTargetSeconds" className="text-xs font-medium text-muted-foreground">ASA Sec</Label><Input id="voiceAsaTargetSeconds" type="number" value={assumptions.voiceAsaTargetSeconds} onChange={(event) => setAssumptions({ ...assumptions, voiceAsaTargetSeconds: validateInput(Number(event.target.value), 1, 3600) })} className="h-10 font-bold" /></div>
                    </div>
                  </div>
                  <div className="space-y-4 rounded-xl border border-border/60 p-4">
                    <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Email SLA / ASA</p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2"><Label htmlFor="emailSlaTarget" className="text-xs font-medium text-muted-foreground">SLA %</Label><Input id="emailSlaTarget" type="number" value={assumptions.emailSlaTarget} onChange={(event) => setAssumptions({ ...assumptions, emailSlaTarget: validateInput(Number(event.target.value), 1, 100) })} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label htmlFor="emailSlaAnswerSeconds" className="text-xs font-medium text-muted-foreground">Within Sec</Label><Input id="emailSlaAnswerSeconds" type="number" value={assumptions.emailSlaAnswerSeconds} onChange={(event) => setAssumptions({ ...assumptions, emailSlaAnswerSeconds: validateInput(Number(event.target.value), 1, 86400) })} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label htmlFor="emailAsaTargetSeconds" className="text-xs font-medium text-muted-foreground">ASA Sec</Label><Input id="emailAsaTargetSeconds" type="number" value={assumptions.emailAsaTargetSeconds} onChange={(event) => setAssumptions({ ...assumptions, emailAsaTargetSeconds: validateInput(Number(event.target.value), 1, 86400) })} className="h-10 font-bold" /></div>
                    </div>
                  </div>
                  <div className="space-y-4 rounded-xl border border-border/60 p-4">
                    <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Chat SLA / ASA</p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2"><Label htmlFor="chatSlaTarget" className="text-xs font-medium text-muted-foreground">SLA %</Label><Input id="chatSlaTarget" type="number" value={assumptions.chatSlaTarget} onChange={(event) => setAssumptions({ ...assumptions, chatSlaTarget: validateInput(Number(event.target.value), 1, 100) })} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label htmlFor="chatSlaAnswerSeconds" className="text-xs font-medium text-muted-foreground">Within Sec</Label><Input id="chatSlaAnswerSeconds" type="number" value={assumptions.chatSlaAnswerSeconds} onChange={(event) => setAssumptions({ ...assumptions, chatSlaAnswerSeconds: validateInput(Number(event.target.value), 1, 3600) })} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label htmlFor="chatAsaTargetSeconds" className="text-xs font-medium text-muted-foreground">ASA Sec</Label><Input id="chatAsaTargetSeconds" type="number" value={assumptions.chatAsaTargetSeconds} onChange={(event) => setAssumptions({ ...assumptions, chatAsaTargetSeconds: validateInput(Number(event.target.value), 1, 3600) })} className="h-10 font-bold" /></div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label htmlFor="operatingHoursPerDay" className="text-xs font-medium text-muted-foreground">Hours Per Day</Label><Input id="operatingHoursPerDay" type="number" step="0.5" value={assumptions.operatingHoursPerDay} onChange={(event) => { const nextHours = validateInput(Number(event.target.value), 0.5, 24); const next: Assumptions = { ...assumptions, operatingHoursPerDay: nextHours }; if (assumptions.useShrinkageModeler) { const LEAVE_IDS = new Set(["annual_leave", "sick_leave"]); const shiftMin = Math.round(nextHours * 60); const scaledItems = (assumptions.shrinkageItems ?? DEFAULT_SHRINKAGE_ITEMS).map((item) => LEAVE_IDS.has(item.id) ? { ...item, durationMinutes: shiftMin } : item); next.shrinkageItems = scaledItems; next.shrinkage = computeShrinkageFromItems(scaledItems, nextHours, assumptions.operatingDaysPerWeek); } setAssumptions(next); }} className="h-10 font-bold" /></div>
                    <div className="space-y-2"><Label htmlFor="operatingDaysPerWeek" className="text-xs font-medium text-muted-foreground">Days Per Week</Label><Input id="operatingDaysPerWeek" type="number" step="0.5" value={assumptions.operatingDaysPerWeek} onChange={(event) => { const nextDays = validateInput(Number(event.target.value), 0.5, 7); const next: Assumptions = { ...assumptions, operatingDaysPerWeek: nextDays }; if (assumptions.useShrinkageModeler) next.shrinkage = computeShrinkageFromItems(assumptions.shrinkageItems ?? DEFAULT_SHRINKAGE_ITEMS, assumptions.operatingHoursPerDay, nextDays); setAssumptions(next); }} className="h-10 font-bold" /></div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-slate-50/70 px-3 py-2 text-xs text-muted-foreground">
                    Operating window: <span className="font-bold text-foreground">{assumptions.operatingHoursPerDay}h/day x {assumptions.operatingDaysPerWeek}d/week</span> = <span className="font-bold text-foreground">{openHoursPerMonth}</span> open hours/month
                  </div>
                  <div className="space-y-2"><div className="flex items-center gap-1"><Label htmlFor="safetyMargin" className="text-xs font-medium text-muted-foreground">Safety Margin</Label><UITooltip><TooltipTrigger asChild><ShieldAlert className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-xs">Demand staffing buffer for forecast variance</p></TooltipContent></UITooltip></div><Input id="safetyMargin" type="number" value={assumptions.safetyMargin} onChange={(event) => setAssumptions({ ...assumptions, safetyMargin: validateInput(Number(event.target.value), 0, 20) })} className="h-10 font-bold" /></div>
                  <div className="space-y-2"><Label htmlFor="fteMonthlyHours" className="text-xs font-medium text-muted-foreground">FTE Monthly Hours</Label><Input id="fteMonthlyHours" type="number" step="0.01" value={assumptions.fteMonthlyHours} onChange={(event) => setAssumptions({ ...assumptions, fteMonthlyHours: validateInput(Number(event.target.value), 1) })} className="h-10 font-bold" /></div>
                  <div className="space-y-3 border-t border-border pt-6 mt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Label htmlFor="growthRate" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Growth Rate</Label>
                        <UITooltip>
                          <TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                          <TooltipContent><p className="text-xs">Applied as a volume multiplier on top of the forecast. Negative values model volume decline. YoY method uses this rate directly; all other methods apply it as a post-forecast adjustment.</p></TooltipContent>
                        </UITooltip>
                      </div>
                      <Badge className={assumptions.growthRate >= 0 ? "bg-emerald-500 font-black tracking-tight" : "bg-rose-500 font-black tracking-tight"}>
                        {assumptions.growthRate >= 0 ? "+" : ""}{assumptions.growthRate}%
                      </Badge>
                    </div>
                    <Input id="growthRate" type="number" value={assumptions.growthRate} onChange={(event) => setAssumptions({ ...assumptions, growthRate: validateInput(Number(event.target.value), -100, 500) })} className={`h-10 font-bold ${assumptions.growthRate >= 0 ? "border-emerald-200" : "border-rose-200"}`} />
                    {forecastMethod !== "yoy" && assumptions.growthRate !== 0 && (
                      <p className="text-[11px] text-muted-foreground">Applied as a ×{(1 + assumptions.growthRate / 100).toFixed(3)} multiplier after {FORECAST_METHODS.find((m) => m.key === forecastMethod)?.label ?? forecastMethod}.</p>
                    )}
                  </div>
                  {forecastMethod === "holtwinters" && <div className="space-y-4 border-t border-border pt-6 mt-6"><div className="flex items-center justify-between"><Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">HW Smoothing</Label><Badge className="bg-amber-500 font-black tracking-tight">Triple Exp</Badge></div><div className="grid grid-cols-2 gap-4"><div className="space-y-1"><Label className="text-xs font-bold">Alpha (Level)</Label><Input type="number" step="0.1" min="0" max="1" value={hwParams.alpha} onChange={(event) => setHwParams({ ...hwParams, alpha: Number(event.target.value) })} className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs font-bold">Beta (Trend)</Label><Input type="number" step="0.1" min="0" max="1" value={hwParams.beta} onChange={(event) => setHwParams({ ...hwParams, beta: Number(event.target.value) })} className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs font-bold">Gamma (Season)</Label><Input type="number" step="0.1" min="0" max="1" value={hwParams.gamma} onChange={(event) => setHwParams({ ...hwParams, gamma: Number(event.target.value) })} className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs font-bold">Season (Len)</Label><Input type="number" min="1" max="24" value={hwParams.seasonLength} onChange={(event) => setHwParams({ ...hwParams, seasonLength: Number(event.target.value) })} className="h-8 text-xs" /></div></div></div>}
                  {forecastMethod === "arima" && <div className="space-y-4 border-t border-border pt-6 mt-6"><div className="flex items-center justify-between"><Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">ARIMA (Simplified)</Label><Badge className="bg-emerald-500 font-black tracking-tight">p d q</Badge></div><div className="grid grid-cols-3 gap-2"><div className="space-y-1"><Label className="text-xs font-bold">p (AR)</Label><Input type="number" min="0" max="12" value={arimaParams.p} onChange={(event) => setArimaParams({ ...arimaParams, p: Number(event.target.value) })} className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs font-bold">d (Diff)</Label><Input type="number" min="0" max="2" value={arimaParams.d} onChange={(event) => setArimaParams({ ...arimaParams, d: Number(event.target.value) })} className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs font-bold">q (MA)</Label><Input type="number" min="1" max="10" value={arimaParams.q} onChange={(event) => setArimaParams({ ...arimaParams, q: Number(event.target.value) })} className="h-8 text-xs" /></div></div></div>}
                  {forecastMethod === "decomposition" && <div className="space-y-4 border-t border-border pt-6 mt-6"><div className="flex items-center justify-between"><Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Decomposition</Label><Badge className="bg-blue-500 font-black tracking-tight">Strengths</Badge></div><div className="space-y-3"><div className="space-y-1"><div className="flex justify-between"><Label className="text-xs font-bold">Trend Strength</Label><span className="text-xs font-bold">{decompParams.trendStrength}x</span></div><Input type="number" step="0.1" min="0" max="3" value={decompParams.trendStrength} onChange={(event) => setDecompParams({ ...decompParams, trendStrength: Number(event.target.value) })} className="h-8 text-xs" /></div><div className="space-y-1"><div className="flex justify-between"><Label className="text-xs font-bold">Seasonality Strength</Label><span className="text-xs font-bold">{decompParams.seasonalityStrength}x</span></div><Input type="number" step="0.1" min="0" max="3" value={decompParams.seasonalityStrength} onChange={(event) => setDecompParams({ ...decompParams, seasonalityStrength: Number(event.target.value) })} className="h-8 text-xs" /></div></div></div>}
                  {forecastMethod === "ma" && <div className="space-y-3 border-t border-border pt-6 mt-6"><div className="flex items-center justify-between"><Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">MA Periods</Label><Badge className="bg-indigo-500 font-black tracking-tight">Last 3 Months</Badge></div><p className="text-xs text-muted-foreground italic">Moving average uses the most recent historical periods to project a baseline.</p></div>}
                  <Button className="w-full h-11 font-black uppercase tracking-widest text-xs mt-4 shadow-lg shadow-primary/20" onClick={() => toast.info("Demand forecast recalculated", { duration: 1500 })}><LayoutDashboard className="size-4 mr-2" />Recalculate</Button>
                </CardContent>}
              </Card>
              <Card className="bg-gradient-to-br from-slate-900 to-slate-800 text-white border-none shadow-2xl mt-6"><CardHeader className="pb-2"><CardTitle className="text-[10px] font-black flex items-center gap-2 uppercase tracking-[0.2em] text-blue-400"><LineChartIcon className="size-4" />Demand Notes</CardTitle></CardHeader><CardContent className="space-y-4 pt-2"><div className="space-y-2"><p className="text-[9px] text-slate-400 uppercase font-black tracking-[0.15em]">Staffing Logic</p><p className="text-xs font-medium leading-relaxed">Voice uses Erlang C, chat uses modified Erlang C with concurrency, and email uses a backlog-clearing workload model. Occupancy is derived from the minimum staffed seats needed to hit each channel SLA.</p></div><div className="space-y-2"><p className="text-[9px] text-slate-400 uppercase font-black tracking-[0.15em]">Blended Pools</p><p className="text-xs font-medium leading-relaxed">Voice establishes the staffed base. Any remaining idle voice hours are consumed by chat first and then email before extra blended staffing is added.</p></div><div className="space-y-2"><p className="text-[9px] text-slate-400 uppercase font-black tracking-[0.15em]">Open-Hours Effect</p><p className="text-xs font-medium leading-relaxed">Monthly open hours determine both concurrent load intensity and how many staffed-seat hours must be converted into gross FTE after shrinkage.</p></div><div className="space-y-2"><p className="text-[9px] text-slate-400 uppercase font-black tracking-[0.15em]">Seasonality View</p><p className="text-xs font-medium leading-relaxed">The seasonality chart indexes each forecast month against the average monthly forecast volume.</p></div></CardContent></Card>
            </div>
          </div>
        </div>
      </PageLayout>
    </TooltipProvider>
  );
}
