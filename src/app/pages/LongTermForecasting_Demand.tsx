import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import { useLOB } from "../lib/lobContext";
import { TrendingUp, Clock, Users, Settings2, ChevronRight, ChevronDown, ChevronUp, Save, Plus, Loader2, Calendar, Info, ShieldAlert, LayoutDashboard, Trash2, RotateCcw, CircleHelp, LineChart as LineChartIcon, Pencil, X, BrainCircuit, AlertTriangle, ShieldCheck, CheckCircle2, Sparkles } from "lucide-react";
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
import { calculateHoltWinters, calculateDecomposition, calculateARIMA, Assumptions as AssumptionsBase, getCalculatedVolumes as getCalculatedVolumesBase } from "./forecasting-logic";
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
type Assumptions = AssumptionsBase & { shrinkageItems?: ShrinkageItem[] };
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
  recutVolumesByChannel?: Record<ChannelKey, number[]> | null;
}
interface DemandActualRow { year: number; month: number; channel: ChannelKey; actual_volume: number; }
interface Scenario { id: string; name: string; assumptions: Assumptions; snapshot: PlannerSnapshot; }
interface HistoricalSourceRow { index: number; monthLabel: string; apiVolume: number; overrideVolume: string; finalVolume: number; variancePct: number | null; isOverridden: boolean; canEdit: boolean; stateLabel: "API" | "Editing" | "Manual"; }
interface OutlierResult { index: number; monthLabel: string; finalVolume: number; suggestedValue: number; direction: "high" | "low"; severity: "mild" | "extreme"; modZScore: number; reason: string; applied?: boolean; }
interface DemandPlannerScenarioRecord { scenario_id: string; scenario_name: string; planner_snapshot: Partial<PlannerSnapshot>; }
interface LongTermActualRecord { year_index: number; month_index: number; volume: number; }
type ChannelKey = "voice" | "email" | "chat" | "cases";
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
interface LobSettingsDefaults {
  voice_aht: number;
  chat_aht: number;
  email_aht: number;
  chat_concurrency: number;
  voice_sla_target: number;
  voice_sla_seconds: number;
  chat_sla_target: number;
  chat_sla_seconds: number;
  email_sla_target: number;
  email_sla_seconds: number;
  email_occupancy: number;
  channels_enabled: Record<ChannelKey, boolean>;
  pooling_mode: PoolingMode;
  hours_of_operation?: Record<string, Record<string, { enabled: boolean; open: string; close: string }>>;
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
const FORECAST_MODEL_COPY = {
  holtwinters: {
    label: "Cyclical Trend Analysis Model (CTA Model)",
    description: "Maps long-term growth trajectories against established seasonal baselines.",
    badge: "CTA",
  },
  arima: {
    label: "Dynamic Variance Projection Model (DVP Model)",
    description: "An adaptive model designed to respond to short-term market volatility and shifting momentum.",
    badge: "DVP",
  },
  decomposition: {
    label: "Core Baseline Extraction Model (CBE Model)",
    description: "Isolates the underlying volume from non-recurring anomalies and environmental noise.",
    badge: "CBE",
  },
} as const;
const FORECAST_METHODS = [
  { key: "holtwinters", label: FORECAST_MODEL_COPY.holtwinters.label },
  { key: "arima", label: FORECAST_MODEL_COPY.arima.label },
  { key: "decomposition", label: FORECAST_MODEL_COPY.decomposition.label },
];
// ── LOB Settings → Assumptions helpers ───────────────────────────────────────
function deriveOperatingDaysPerWeek(schedule?: Record<string, { enabled: boolean }>): number {
  if (!schedule) return 5;
  return Object.values(schedule).filter((d) => d.enabled).length;
}
function deriveOperatingHoursPerDay(schedule?: Record<string, { enabled: boolean; open: string; close: string }>): number {
  if (!schedule) return 8;
  const enabled = Object.values(schedule).filter((d) => d.enabled);
  if (enabled.length === 0) return 8;
  const total = enabled.reduce((sum, d) => {
    const [oh, om] = d.open.split(":").map(Number);
    const [ch, cm] = d.close.split(":").map(Number);
    return sum + Math.max(0, (ch + cm / 60) - (oh + om / 60));
  }, 0);
  return Math.round((total / enabled.length) * 10) / 10;
}
function lobSettingsToAssumptionDefaults(s: LobSettingsDefaults): Partial<Assumptions> {
  return {
    aht:                    s.voice_aht,
    chatAht:                s.chat_aht,
    emailAht:               s.email_aht,
    chatConcurrency:        s.chat_concurrency,
    voiceSlaTarget:         s.voice_sla_target,
    voiceSlaAnswerSeconds:  s.voice_sla_seconds,
    chatSlaTarget:          s.chat_sla_target,
    chatSlaAnswerSeconds:   s.chat_sla_seconds,
    emailSlaTarget:         s.email_sla_target,
    emailSlaAnswerSeconds:  s.email_sla_seconds,
    occupancy:              s.email_occupancy,
    // shrinkage is owned by Shrinkage Planning, not LOB Settings
    operatingDaysPerWeek:   deriveOperatingDaysPerWeek(s.hours_of_operation?.voice),
    operatingHoursPerDay:   deriveOperatingHoursPerDay(s.hours_of_operation?.voice),
  };
}

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
const EMPTY_CHANNEL_DATA: Record<ChannelKey, number[]> = { voice: [], email: [], chat: [], cases: [] };
const EMPTY_CHANNEL_OVERRIDES: Record<ChannelKey, Record<number, string>> = { voice: {}, email: {}, chat: {}, cases: {} };
const DEFAULT_SELECTED_CHANNELS: Record<ChannelKey, boolean> = { voice: true, email: true, chat: true, cases: false };
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
  { id: "all-blended", label: "Voice + Email + Chat + Cases", description: "All selected channels share one agent pool", pools: [["voice", "email", "chat", "cases"]] },
  { id: "dedicated", label: "Dedicated per channel", description: "No channel blending across staffing pools", pools: [["voice"], ["email"], ["chat"], ["cases"]] },
];
const CHANNEL_VOLUME_FACTORS: Record<ChannelKey, number> = { voice: 1, email: 0.2, chat: 0.3, cases: 0.2 };
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
  cases: { label: "Cases", colorClass: "text-violet-700 dark:text-violet-300", bgClass: "bg-violet-50 dark:bg-violet-950/30" },
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
  if (channel === "email" || channel === "cases") return "Deferred backlog model";
  return "Erlang C";
};
const roundTo = (value: number, digits: number) => Number(value.toFixed(digits));
function normalizeSelectedChannels(value?: Partial<Record<ChannelKey, boolean>> | null): Record<ChannelKey, boolean> {
  const normalized = {
    voice: Boolean(value?.voice),
    email: Boolean(value?.email),
    chat: Boolean(value?.chat),
    cases: Boolean(value?.cases),
  };
  if (!normalized.voice && !normalized.email && !normalized.chat && !normalized.cases) return { voice: true, email: false, chat: false, cases: false };
  return normalized;
}
function getIncludedChannelsFromSelection(selectedChannels: Record<ChannelKey, boolean>): ChannelKey[] {
  return (["voice", "email", "chat", "cases"] as ChannelKey[]).filter((channel) => selectedChannels[channel]);
}
function getLegacyBlendPresetId(selectedChannels: Record<ChannelKey, boolean>, poolingMode: PoolingMode): BlendPresetId | undefined {
  const normalized = normalizeSelectedChannels(selectedChannels);
  const included = getIncludedChannelsFromSelection(normalized);
  if (poolingMode === "dedicated" && normalized.voice && normalized.email && normalized.chat && normalized.cases) return "dedicated";
  if (included.length === 1 && included[0] === "voice") return "voice-only";
  if (poolingMode === "blended" && included.length === 2 && included.includes("voice") && included.includes("email")) return "voice-email";
  if (poolingMode === "blended" && included.length === 2 && included.includes("voice") && included.includes("chat")) return "voice-chat";
  if (poolingMode === "blended" && included.length === 2 && included.includes("email") && included.includes("chat")) return "email-chat";
  if (poolingMode === "blended" && included.length === 4) return "all-blended";
  return undefined;
}
function getBlendStateFromLegacyPreset(presetId?: BlendPresetId): { selectedChannels: Record<ChannelKey, boolean>; poolingMode: PoolingMode } {
  switch (presetId) {
    case "voice-only":
      return { selectedChannels: { voice: true, email: false, chat: false, cases: false }, poolingMode: "blended" };
    case "voice-email":
      return { selectedChannels: { voice: true, email: true, chat: false, cases: false }, poolingMode: "blended" };
    case "voice-chat":
      return { selectedChannels: { voice: true, email: false, chat: true, cases: false }, poolingMode: "blended" };
    case "email-chat":
      return { selectedChannels: { voice: false, email: true, chat: true, cases: false }, poolingMode: "blended" };
    case "dedicated":
      return { selectedChannels: { voice: true, email: true, chat: true, cases: true }, poolingMode: "dedicated" };
    case "all-blended":
    default:
      return { selectedChannels: { voice: true, email: true, chat: true, cases: true }, poolingMode: "blended" };
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
  if (channel === "email" || channel === "cases") {
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
  if (channel === "email" || channel === "cases") return assumptions.emailAht;
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
  recutVolumesByChannel: Record<ChannelKey, number[]> | null = null,
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
      cases: { ...channelHistoricalOverrides.cases },
    },
    channelHistoricalApiData: {
      voice: [...channelHistoricalApiData.voice],
      email: [...channelHistoricalApiData.email],
      chat: [...channelHistoricalApiData.chat],
      cases: [...channelHistoricalApiData.cases],
    },
    activeBlendPreset: getLegacyBlendPresetId(normalizedChannels, poolingMode),
    selectedChannels: normalizedChannels,
    poolingMode,
    isHistoricalSourceOpen,
    isBlendedStaffingOpen,
    selectedHistoricalChannel,
    recutVolumesByChannel,
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
      cases: { ...snapshot.channelHistoricalOverrides.cases },
    },
    channelHistoricalApiData: {
      voice: [...(snapshot.channelHistoricalApiData?.voice || [])],
      email: [...(snapshot.channelHistoricalApiData?.email || [])],
      chat: [...(snapshot.channelHistoricalApiData?.chat || [])],
      cases: [...(snapshot.channelHistoricalApiData?.cases || [])],
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
      cases: normalizeHistoricalOverrides(snapshot?.channelHistoricalOverrides?.cases),
    },
    channelHistoricalApiData: {
      voice: Array.isArray(snapshot?.channelHistoricalApiData?.voice) ? [...snapshot.channelHistoricalApiData.voice] : [],
      email: Array.isArray(snapshot?.channelHistoricalApiData?.email) ? [...snapshot.channelHistoricalApiData.email] : [],
      chat: Array.isArray(snapshot?.channelHistoricalApiData?.chat) ? [...snapshot.channelHistoricalApiData.chat] : [],
      cases: Array.isArray(snapshot?.channelHistoricalApiData?.cases) ? [...snapshot.channelHistoricalApiData.cases] : [],
    },
    activeBlendPreset: getLegacyBlendPresetId(selectedChannels, poolingMode),
    selectedChannels,
    poolingMode,
    isHistoricalSourceOpen: typeof snapshot?.isHistoricalSourceOpen === "boolean" ? snapshot.isHistoricalSourceOpen : false,
    isBlendedStaffingOpen: typeof snapshot?.isBlendedStaffingOpen === "boolean" ? snapshot.isBlendedStaffingOpen : true,
    selectedHistoricalChannel: snapshot?.selectedHistoricalChannel === "email" || snapshot?.selectedHistoricalChannel === "chat" || snapshot?.selectedHistoricalChannel === "cases" ? snapshot.selectedHistoricalChannel : "voice",
    recutVolumesByChannel: (snapshot?.recutVolumesByChannel && typeof snapshot.recutVolumesByChannel === "object")
      ? {
          voice: Array.isArray(snapshot.recutVolumesByChannel.voice) ? [...snapshot.recutVolumesByChannel.voice] : [],
          email: Array.isArray(snapshot.recutVolumesByChannel.email) ? [...snapshot.recutVolumesByChannel.email] : [],
          chat: Array.isArray(snapshot.recutVolumesByChannel.chat) ? [...snapshot.recutVolumesByChannel.chat] : [],
          cases: Array.isArray(snapshot.recutVolumesByChannel.cases) ? [...snapshot.recutVolumesByChannel.cases] : [],
        }
      : null,
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
    const emailLikeEntries = channelMix.filter((entry) => entry.channel === "email" || entry.channel === "cases");
    const blendedRequirement = calculateBlendedTriChannelRequirement({
      voiceVolume: voiceEntry?.volume ?? 0,
      voiceAhtSeconds: assumptions.aht,
      voiceTargetServiceLevelPct: assumptions.voiceSlaTarget,
      voiceTargetAnswerTimeSeconds: assumptions.voiceSlaAnswerSeconds,
      chatVolume: chatEntry?.volume ?? 0,
      chatAhtSeconds: assumptions.chatAht,
      chatConcurrency: Math.max(1, assumptions.chatConcurrency),
      emailVolume: emailLikeEntries.reduce((sum, entry) => sum + entry.volume, 0),
      emailAhtSeconds: assumptions.emailAht,
      intervalHours: getOpenHoursPerMonth(assumptions),
      shrinkagePct: assumptions.shrinkage,
      safetyMarginPct: assumptions.safetyMargin,
    });
    return getGrossRequiredFTE(blendedRequirement.totalBaseStaff, assumptions);
  }
  return getChannelStaffingMetrics("voice", referenceVolume, assumptions).requiredFTE;
};
const getCalculatedVolumes = getCalculatedVolumesBase;
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
  const [isInsightNarrativeOpen, setIsInsightNarrativeOpen] = useState(false);
  const [outlierResults, setOutlierResults] = useState<OutlierResult[] | null>(null);
  const [isOutlierPanelOpen, setIsOutlierPanelOpen] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
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
  const [lobDefaults, setLobDefaults] = useState<LobSettingsDefaults | null>(null);
  const [historicalChannelView, setHistoricalChannelView] = useState<ChannelKey>("voice");
  const [historicalApiDataByChannel, setHistoricalApiDataByChannel] = useState<Record<ChannelKey, number[]>>(EMPTY_CHANNEL_DATA);
  const [syncedHistoricalApiDataByChannel, setSyncedHistoricalApiDataByChannel] = useState<Record<ChannelKey, number[]>>(EMPTY_CHANNEL_DATA);
  const [historicalOverridesByChannel, setHistoricalOverridesByChannel] = useState<Record<ChannelKey, Record<number, string>>>(EMPTY_CHANNEL_OVERRIDES);
  const [recutVolumesByChannel, setRecutVolumesByChannel] = useState<Record<ChannelKey, number[]> | null>(null);
  // Re-cut actuals state
  const [detailChannel, setDetailChannel] = useState<ChannelKey>("voice");
  const [demandActuals, setDemandActuals] = useState<Record<string, number | null>>({});
  const [savingActuals, setSavingActuals] = useState<Set<string>>(new Set());
  const [savedActuals, setSavedActuals] = useState<Set<string>>(new Set());
  const hasHydratedRef = useRef(false);
  const activeScenario = scenarios[selectedScenarioId];
  const forecastYear = Number.isFinite(new Date(assumptions.startDate).getTime())
    ? new Date(assumptions.startDate).getFullYear()
    : new Date().getFullYear();
  const historicalWindowStart = `${forecastYear - 2}-01-01`;
  const historicalWindowEnd = `${forecastYear - 1}-12-31`;
  const historicalApiData = historicalApiDataByChannel.voice;
  const historicalOverrides = historicalOverridesByChannel.voice;
  const visibleHistoricalApiData = historicalApiDataByChannel[historicalChannelView];
  const visibleHistoricalOverrides = historicalOverridesByChannel[historicalChannelView];
  const getCurrentPlannerSnapshot = () => buildPlannerSnapshot(assumptions, forecastMethod, hwParams, arimaParams, decompParams, historicalApiDataByChannel, historicalOverridesByChannel, selectedChannels, poolingMode, isHistoricalSourceOpen, isBlendedStaffingOpen, historicalChannelView, recutVolumesByChannel);
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
      cases: [...(snapshot.channelHistoricalApiData?.cases || [])],
    });
    setHistoricalOverridesByChannel({
      voice: { ...(snapshot.channelHistoricalOverrides?.voice || snapshot.historicalOverrides || {}) },
      email: { ...(snapshot.channelHistoricalOverrides?.email || {}) },
      chat: { ...(snapshot.channelHistoricalOverrides?.chat || {}) },
      cases: { ...(snapshot.channelHistoricalOverrides?.cases || {}) },
    });
    setSelectedChannels(normalizeSelectedChannels(snapshot.selectedChannels));
    setPoolingMode(snapshot.poolingMode === "dedicated" ? "dedicated" : "blended");
    setIsHistoricalSourceOpen(snapshot.isHistoricalSourceOpen);
    setIsBlendedStaffingOpen(snapshot.isBlendedStaffingOpen);
    setHistoricalChannelView(snapshot.selectedHistoricalChannel || "voice");
    setRecutVolumesByChannel(snapshot.recutVolumesByChannel ?? null);
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

  const isOverridingLobDefaults = useMemo(() => {
    if (!lobDefaults) return false;
    const defaults = lobSettingsToAssumptionDefaults(lobDefaults);
    return (Object.entries(defaults) as Array<[keyof Assumptions, unknown]>).some(
      ([key, value]) => (assumptions as Record<string, unknown>)[key] !== value
    );
  }, [assumptions, lobDefaults]);

  const resetToLobDefaults = () => {
    if (!lobDefaults) return;
    setAssumptions((prev) => ({ ...prev, ...lobSettingsToAssumptionDefaults(lobDefaults) }));
    setSelectedChannels(normalizeSelectedChannels(lobDefaults.channels_enabled));
    setPoolingMode(lobDefaults.pooling_mode === "dedicated" ? "dedicated" : "blended");
  };

  useEffect(() => {
    if (!activeLob) { setLoading(false); return; }
    hasHydratedRef.current = false;
    const hydratePlanner = async () => {
      // Fire all three API calls in parallel — was sequential before (3 round trips → 1)
      const isLocalDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const [scenariosData, lobSettingsData, activeStateData] = await Promise.all([
        fetch(apiUrl(`/api/demand-planner-scenarios?lob_id=${activeLob.id}`)).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(apiUrl(`/api/lob-settings?lob_id=${activeLob.id}`)).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(apiUrl(`/api/demand-planner-active-state?lob_id=${activeLob.id}`)).then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);

      // ── Scenarios ────────────────────────────────────────────────────────────
      let nextScenarios = DEFAULT_SCENARIOS;
      if (scenariosData) {
        try {
          const normalized = Array.isArray(scenariosData) ? normalizePersistedScenarios(scenariosData as DemandPlannerScenarioRecord[]) : {};
          if (Object.keys(normalized).length > 0) nextScenarios = normalized;
        } catch (error) {
          console.error("Failed to normalize demand scenarios", error);
        }
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
        // ── LOB defaults ─────────────────────────────────────────────────────
        const fetchedLobDefaults = lobSettingsData as LobSettingsDefaults | null;
        if (fetchedLobDefaults) setLobDefaults(fetchedLobDefaults);

        // ── Active state ─────────────────────────────────────────────────────
        // On localhost: localStorage is the source of truth.
        // On production: DB is the source of truth (syncs across devices).
        let savedInputs: { selectedScenarioId?: string; plannerSnapshot?: Partial<PlannerSnapshot> } | null = null;
        if (isLocalDev) {
          const localRaw = localStorage.getItem(USER_INPUTS_STORAGE_KEY);
          if (localRaw) {
            try { savedInputs = JSON.parse(localRaw) as { selectedScenarioId?: string; plannerSnapshot?: Partial<PlannerSnapshot> }; } catch { /* ignore */ }
          }
        }
        if (!savedInputs) {
          if (activeStateData && typeof activeStateData === "object") savedInputs = activeStateData as { selectedScenarioId?: string; plannerSnapshot?: Partial<PlannerSnapshot> };
        }
        if (!savedInputs && !isLocalDev) {
          // Last resort on production: try localStorage
          const localRaw = localStorage.getItem(USER_INPUTS_STORAGE_KEY);
          if (localRaw) {
            try { savedInputs = JSON.parse(localRaw) as { selectedScenarioId?: string; plannerSnapshot?: Partial<PlannerSnapshot> }; } catch { /* ignore */ }
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
          // No saved session state — apply LOB defaults as the starting assumptions
          if (fetchedLobDefaults) {
            setAssumptions((prev) => ({ ...prev, ...lobSettingsToAssumptionDefaults(fetchedLobDefaults!) }));
          }
        }
        // Always apply LOB Settings channel config — it is the authoritative source
        // for which channels are active and how they are pooled. Saved session state
        // restores forecast parameters but must not override what was configured in
        // LOB Settings, otherwise changes there are silently ignored.
        if (fetchedLobDefaults) {
          setSelectedChannels(normalizeSelectedChannels(fetchedLobDefaults.channels_enabled));
          setPoolingMode(fetchedLobDefaults.pooling_mode === "dedicated" ? "dedicated" : "blended");
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
        const lobKey = activeLob ? `_lob${activeLob.id}` : "";
        const stored = localStorage.getItem(`wfm_shrinkage_totals${lobKey}`);
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
  }, [assumptions.shrinkageSource, activeLob?.id]);

  // Load demand actuals (for re-cut) whenever the LOB or forecast year changes
  useEffect(() => {
    if (!activeLob) return;
    const year = assumptions.startDate ? new Date(assumptions.startDate).getFullYear() : new Date().getFullYear();
    fetch(apiUrl(`/api/demand-actuals?lob_id=${activeLob.id}&year=${year}`))
      .then((r) => r.json())
      .then((rows: DemandActualRow[]) => {
        if (!Array.isArray(rows)) return;
        const map: Record<string, number | null> = {};
        rows.forEach((row) => { map[`${row.year}-${row.month}-${row.channel}`] = row.actual_volume; });
        setDemandActuals(map);
      })
      .catch(() => { /* non-critical */ });
  }, [activeLob?.id, assumptions.startDate]);

  useEffect(() => {
    if (!activeLob) { setLoading(false); return; }
    const fetchHistoricalData = async () => {
      setLoading(true);
      try {
        const channels: ChannelKey[] = ["voice", "email", "chat", "cases"];
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
        }, { voice: [], email: [], chat: [], cases: [] });
        setHistoricalApiDataByChannel((current) => ({
          voice: current.voice.length > 0 ? current.voice : nextApiData.voice,
          email: current.email.length > 0 ? current.email : nextApiData.email,
          chat: current.chat.length > 0 ? current.chat : nextApiData.chat,
          cases: current.cases.length > 0 ? current.cases : nextApiData.cases,
        }));
        setSyncedHistoricalApiDataByChannel(nextApiData);
        setHistoricalOverridesByChannel((current) => ({
          voice: Object.fromEntries(Object.entries(current.voice).filter(([key]) => Number(key) < nextApiData.voice.length)),
          email: Object.fromEntries(Object.entries(current.email).filter(([key]) => Number(key) < nextApiData.email.length)),
          chat: Object.fromEntries(Object.entries(current.chat).filter(([key]) => Number(key) < nextApiData.chat.length)),
          cases: Object.fromEntries(Object.entries(current.cases).filter(([key]) => Number(key) < nextApiData.cases.length)),
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
  const handleRevertToBaseCase = () => {
    const baseScenario = scenarios.base || DEFAULT_SCENARIOS.base;
    if (!baseScenario) return;
    setSelectedScenarioId(baseScenario.id);
    applyPlannerSnapshot(baseScenario.snapshot);
    persistActiveState({
      selectedScenarioId: baseScenario.id,
      plannerSnapshot: baseScenario.snapshot,
    });
    toast.success("Reverted to Base Case");
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
  const runOutlierAnalysis = () => {
    setIsAnalyzing(true);
    setTimeout(() => {
      const rows = historicalSourceRows;
      const volumes = rows.map((r) => r.finalVolume);
      if (volumes.length < 4) {
        setOutlierResults([]);
        setIsOutlierPanelOpen(true);
        setIsAnalyzing(false);
        toast.info("Need at least 4 months of data to run outlier analysis.");
        return;
      }
      const sorted = [...volumes].sort((a, b) => a - b);
      const n = sorted.length;
      const lerp = (p: number) => {
        const idx = (p / 100) * (n - 1);
        const lo = Math.floor(idx);
        const hi = Math.min(lo + 1, n - 1);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
      };
      const q1 = lerp(25);
      const q3 = lerp(75);
      const iqr = q3 - q1;
      const lowerFence = q1 - 1.5 * iqr;
      const upperFence = q3 + 1.5 * iqr;
      const medianVal = n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
      const deviations = volumes.map((v) => Math.abs(v - medianVal));
      const sortedDev = [...deviations].sort((a, b) => a - b);
      const mad = n % 2 === 1 ? sortedDev[Math.floor(n / 2)] : (sortedDev[n / 2 - 1] + sortedDev[n / 2]) / 2;
      const results: OutlierResult[] = [];
      for (const row of rows) {
        const v = row.finalVolume;
        const isHigh = v > upperFence;
        const isLow = lowerFence > 0 && v < lowerFence;
        if (!isHigh && !isLow) continue;
        const modZ = mad > 0 ? Math.abs((0.6745 * (v - medianVal)) / mad) : 0;
        const direction = isHigh ? "high" : "low";
        const suggested = Math.round(isHigh ? upperFence : Math.max(lowerFence, q1));
        const fence = isHigh ? upperFence : lowerFence;
        const pctDiff = fence > 0 ? Math.round(Math.abs((v - fence) / fence) * 100) : 0;
        const reason = isHigh
          ? `Volume of ${v.toLocaleString()} is ${pctDiff}% above the upper statistical fence (${Math.round(upperFence).toLocaleString()}). This spike may skew the forecast upward — possible seasonal anomaly, campaign, or entry error.`
          : `Volume of ${v.toLocaleString()} is ${pctDiff}% below the lower statistical fence (${Math.round(Math.max(lowerFence, 0)).toLocaleString()}). Unusually low — possible data gap, system outage, or unplanned downtime.`;
        results.push({ index: row.index, monthLabel: row.monthLabel, finalVolume: v, suggestedValue: suggested, direction, severity: modZ > 3.5 ? "extreme" : "mild", modZScore: Math.round(modZ * 10) / 10, reason });
      }
      setOutlierResults(results);
      setIsOutlierPanelOpen(true);
      setIsAnalyzing(false);
      if (results.length === 0) toast.success("No outliers detected — the data distribution looks clean.");
      else toast.warning(`${results.length} outlier${results.length > 1 ? "s" : ""} detected. Review the analysis panel below.`);
    }, 600);
  };
  const applyOutlierSuggestion = (index: number, suggestedValue: number) => {
    handleOverrideChange(index, String(suggestedValue));
    setOutlierResults((prev) => prev ? prev.map((r) => r.index === index ? { ...r, applied: true } : r) : null);
    toast.success("Suggested normalization applied as override.");
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

  // ── Actual-volume save handler ────────────────────────────────────────────────
  const handleSaveActual = async (monthOffset: number, channel: ChannelKey, value: number | null) => {
    if (!activeLob || value == null) return;
    const d = new Date(assumptions.startDate);
    d.setMonth(d.getMonth() + monthOffset);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const key = `${year}-${month}-${channel}`;
    setSavingActuals((s) => new Set(s).add(key));
    setSavedActuals((s) => { const n = new Set(s); n.delete(key); return n; });
    try {
      const res = await fetch(apiUrl("/api/demand-actuals"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lob_id: activeLob.id, year, month, channel, actual_volume: value }),
      });
      if (res.ok) {
        setDemandActuals((prev) => ({ ...prev, [key]: value }));
        setSavedActuals((s) => new Set(s).add(key));
        setTimeout(() => setSavedActuals((s) => { const n = new Set(s); n.delete(key); return n; }), 2500);
      } else {
        toast.error("Failed to save actual volume");
      }
    } catch {
      toast.error("Failed to save actual volume");
    } finally {
      setSavingActuals((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  // ── Publish re-cut to Intraday ────────────────────────────────────────────────
  const handlePublishRecut = () => {
    const channels: ChannelKey[] = ["voice", "email", "chat", "cases"];
    const published: Record<ChannelKey, number[]> = { voice: [], email: [], chat: [], cases: [] };
    for (const ch of channels) {
      const vols = forecastVolumesByChannel[ch];
      const factor = recutFactorByChannel[ch];
      published[ch] = vols.map((v, i) => {
        if (completedMonthIndices.includes(i)) {
          // Use actual if available, else original forecast
          const key = getActualKey(i, ch);
          return demandActuals[key] ?? v;
        }
        return factor != null ? Math.round(v * factor) : v;
      });
    }
    setRecutVolumesByChannel(published);
    // Persist immediately via active state
    const snapshot = buildPlannerSnapshot(
      assumptions, forecastMethod, hwParams, arimaParams, decompParams,
      historicalApiDataByChannel, historicalOverridesByChannel, selectedChannels,
      poolingMode, isHistoricalSourceOpen, isBlendedStaffingOpen, historicalChannelView,
      published,
    );
    persistActiveState({ selectedScenarioId, plannerSnapshot: snapshot });
    toast.success("Re-cut volumes published to Intraday Forecast");
  };

  const handleClearRecut = () => {
    setRecutVolumesByChannel(null);
    const snapshot = buildPlannerSnapshot(
      assumptions, forecastMethod, hwParams, arimaParams, decompParams,
      historicalApiDataByChannel, historicalOverridesByChannel, selectedChannels,
      poolingMode, isHistoricalSourceOpen, isBlendedStaffingOpen, historicalChannelView,
      null,
    );
    persistActiveState({ selectedScenarioId, plannerSnapshot: snapshot });
    toast.success("Re-cut cleared — Intraday reverts to original forecast");
  };

  const finalHistoricalData = useMemo(() => buildChannelHistoricalData(historicalApiData, historicalOverrides), [historicalApiData, historicalOverrides]);
  // Per-channel final historical data (applies each channel's own overrides)
  const finalHistoricalDataByChannel = useMemo<Record<ChannelKey, number[]>>(() => {
    const applyOverrides = (channel: ChannelKey) => buildChannelHistoricalData(historicalApiDataByChannel[channel], historicalOverridesByChannel[channel]);
    return { voice: finalHistoricalData, email: applyOverrides("email"), chat: applyOverrides("chat"), cases: applyOverrides("cases") };
  }, [finalHistoricalData, historicalApiDataByChannel, historicalOverridesByChannel]);
  const hasExplicitHistoryByChannel = useMemo<Record<ChannelKey, boolean>>(() => ({
    voice: historicalApiDataByChannel.voice.length > 0 || Object.keys(historicalOverridesByChannel.voice).length > 0,
    email: historicalApiDataByChannel.email.length > 0 || Object.keys(historicalOverridesByChannel.email).length > 0,
    chat: historicalApiDataByChannel.chat.length > 0 || Object.keys(historicalOverridesByChannel.chat).length > 0,
    cases: historicalApiDataByChannel.cases.length > 0 || Object.keys(historicalOverridesByChannel.cases).length > 0,
  }), [historicalApiDataByChannel, historicalOverridesByChannel]);
  // Per-channel 12-month forecast volumes — uses each channel's own history when available
  const forecastVolumesByChannel = useMemo<Record<ChannelKey, number[]>>(() => {
    const voiceForecast = getCalculatedVolumes(finalHistoricalDataByChannel.voice, forecastMethod, assumptions, hwParams, arimaParams, decompParams);
    const emailHistory = finalHistoricalDataByChannel.email;
    const chatHistory = finalHistoricalDataByChannel.chat;
    const casesHistory = finalHistoricalDataByChannel.cases;
    const emailForecast = hasExplicitHistoryByChannel.email
      ? getCalculatedVolumes(emailHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
      : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.email));
    const chatForecast = hasExplicitHistoryByChannel.chat
      ? getCalculatedVolumes(chatHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
      : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.chat));
    const casesForecast = hasExplicitHistoryByChannel.cases
      ? getCalculatedVolumes(casesHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
      : emailForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.cases));
    return { voice: voiceForecast, email: emailForecast, chat: chatForecast, cases: casesForecast };
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
  const historicalRowsByYear = useMemo(() => {
    const groups: { year: string; rows: HistoricalSourceRow[] }[] = [];
    for (const row of historicalSourceRows) {
      const year = row.monthLabel.split(" ")[1] ?? "Unknown";
      const existing = groups.find((g) => g.year === year);
      if (existing) { existing.rows.push(row); } else { groups.push({ year, rows: [row] }); }
    }
    return groups;
  }, [historicalSourceRows]);
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
    const casesForecastVol = forecastVolumesByChannel.cases[futureIdx] ?? Math.round(emailForecastVol * CHANNEL_VOLUME_FACTORS.cases / CHANNEL_VOLUME_FACTORS.email);
    const channelMetrics: Record<ChannelKey, ChannelStaffingMetrics> = {
      voice: getChannelStaffingMetrics("voice", row.volume, assumptions),
      email: getChannelStaffingMetrics("email", emailForecastVol, assumptions),
      chat: getChannelStaffingMetrics("chat", chatForecastVol, assumptions),
      cases: getChannelStaffingMetrics("cases", casesForecastVol, assumptions),
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
  // ── Re-cut helpers ────────────────────────────────────────────────────────────
  // Which forecast month-indices (0-based) are fully in the past?
  const completedMonthIndices = useMemo<number[]>(() => {
    if (!assumptions.startDate) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const indices: number[] = [];
    for (let i = 0; i < 12; i++) {
      const start = new Date(assumptions.startDate);
      start.setMonth(start.getMonth() + i);
      // End of that calendar month
      const endOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      if (endOfMonth < today) indices.push(i);
    }
    return indices;
  }, [assumptions.startDate]);

  // Build an actualKey helper (stable format)
  const getActualKey = (monthOffset: number, channel: ChannelKey): string => {
    if (!assumptions.startDate) return `0-0-${channel}`;
    const d = new Date(assumptions.startDate);
    d.setMonth(d.getMonth() + monthOffset);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${channel}`;
  };

  // Per-channel re-cut factor: Σactuals_completed / Σforecast_completed
  // Returns null if no completed months have actuals for that channel.
  const recutFactorByChannel = useMemo<Record<ChannelKey, number | null>>(() => {
    const compute = (ch: ChannelKey) => {
      const vols = forecastVolumesByChannel[ch];
      let sumActuals = 0, sumForecast = 0, hasAny = false;
      for (const i of completedMonthIndices) {
        const key = getActualKey(i, ch);
        const actual = demandActuals[key];
        if (actual != null) {
          sumActuals += actual;
          sumForecast += vols[i] ?? 0;
          hasAny = true;
        }
      }
      return hasAny && sumForecast > 0 ? sumActuals / sumForecast : null;
    };
    return { voice: compute("voice"), email: compute("email"), chat: compute("chat") };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedMonthIndices, demandActuals, forecastVolumesByChannel, assumptions.startDate]);

  const activeRecutFactor = recutFactorByChannel[detailChannel];

  // All 12 months (past + future) with per-channel volumes for the detail table
  const allForecastMonths = useMemo(() => {
    if (!assumptions.startDate) return [];
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(assumptions.startDate);
      d.setMonth(d.getMonth() + i);
      const year = d.getFullYear();
      const month1 = d.getMonth() + 1; // 1-based
      const monthLabel = MONTH_NAMES[d.getMonth()];
      const isCompleted = completedMonthIndices.includes(i);
      const forecastVol = forecastVolumesByChannel[detailChannel][i] ?? 0;
      const actualKey = `${year}-${month1}-${detailChannel}`;
      const actualVol = demandActuals[actualKey] ?? null;
      const variancePct = actualVol != null && forecastVol > 0
        ? Number((((actualVol - forecastVol) / forecastVol) * 100).toFixed(1))
        : null;
      const factor = recutFactorByChannel[detailChannel];
      const recutVol = !isCompleted && factor != null ? Math.round(forecastVol * factor) : null;
      return { index: i, year, month1, monthLabel, isCompleted, forecastVol, actualVol, variancePct, recutVol, actualKey };
    });
  }, [assumptions.startDate, completedMonthIndices, forecastVolumesByChannel, detailChannel, demandActuals, recutFactorByChannel]);

  const kpis = useMemo(() => futureData.length === 0 ? { avgVolume: 0, avgWorkloadHours: 0, avgRequiredFTE: 0 } : ({
    avgVolume: Math.round(futureData.reduce((sum, row) => sum + row.volume, 0) / futureData.length),
    avgWorkloadHours: Number((futureData.reduce((sum, row) => sum + row.pools.reduce((poolSum, pool) => poolSum + pool.workloadHours, 0), 0) / futureData.length).toFixed(1)),
    avgRequiredFTE: Number((futureData.reduce((sum, row) => sum + row.totalRequiredFTE, 0) / futureData.length).toFixed(2)),
  }), [futureData]);

  const insightNarrative = useMemo(() => {
    if (futureData.length === 0) return null;
    const n = futureData.length;
    // Trend: compare avg FTE of first 3 vs last 3 months
    const first3 = futureData.slice(0, Math.min(3, n));
    const last3 = futureData.slice(Math.max(0, n - 3));
    const first3Avg = first3.reduce((s, r) => s + r.totalRequiredFTE, 0) / first3.length;
    const last3Avg = last3.reduce((s, r) => s + r.totalRequiredFTE, 0) / last3.length;
    const trendPct = first3Avg > 0 ? ((last3Avg - first3Avg) / first3Avg) * 100 : 0;
    const trendDir: "growing" | "stable" | "declining" = Math.abs(trendPct) < 3 ? "stable" : trendPct > 0 ? "growing" : "declining";
    // Peak / trough
    const peakRow = futureData.reduce((a, b) => a.totalRequiredFTE >= b.totalRequiredFTE ? a : b);
    const troughRow = futureData.reduce((a, b) => a.totalRequiredFTE <= b.totalRequiredFTE ? a : b);
    const fteSpread = peakRow.totalRequiredFTE > 0 ? Math.round(((peakRow.totalRequiredFTE - troughRow.totalRequiredFTE) / peakRow.totalRequiredFTE) * 100) : 0;
    // Channel mix
    const activeKeys = (Object.keys(selectedChannels) as ChannelKey[]).filter((k) => selectedChannels[k]);
    const chanVols = activeKeys.map((ch) => ({
      label: ch === "voice" ? "Voice" : ch === "chat" ? "Chat" : "Email",
      avg: futureData.reduce((s, r) => s + r.channelMetrics[ch].volume, 0) / n,
    }));
    const totalVol = chanVols.reduce((s, c) => s + c.avg, 0);
    const channelMix = chanVols.map((c) => ({ ...c, pct: totalVol > 0 ? Math.round((c.avg / totalVol) * 100) : 0 })).sort((a, b) => b.pct - a.pct);
    // Method label
    const methodLabels: Record<string, string> = {
      holtwinters: FORECAST_MODEL_COPY.holtwinters.label,
      arima: FORECAST_MODEL_COPY.arima.label,
      decomposition: FORECAST_MODEL_COPY.decomposition.label,
    };
    const methodLabel = methodLabels[forecastMethod] ?? forecastMethod;
    // Growth
    const growthRate = assumptions.growthRate ?? 0;
    const lastRow = futureData[n - 1];
    const lastPeriod = `${lastRow.month} ${lastRow.year}`;
    const avgFTE = Number((futureData.reduce((s, r) => s + r.totalRequiredFTE, 0) / n).toFixed(1));
    // Build sentences
    const headline =
      trendDir === "growing" ? "Demand is Rising — Plan for Sustained Headcount Growth" :
      trendDir === "declining" ? "Demand is Easing — Opportunity to Optimize Staffing Levels" :
      "Stable Demand Outlook — A Predictable Staffing Horizon Ahead";
    const trendSentence = trendDir === "stable"
      ? `The ${methodLabel} model projects a stable staffing trend across the planning horizon, with required FTE holding near ${avgFTE} agents on average.`
      : `The ${methodLabel} model projects a ${trendDir} trend — required FTE is ${trendDir === "growing" ? "increasing" : "declining"} ${Math.abs(trendPct).toFixed(1)}% from the opening months to close of the planning period.`;
    const peakSentence = `Staffing pressure is highest in ${peakRow.month} ${peakRow.year} at ${peakRow.totalRequiredFTE.toFixed(1)} FTE, and lowest in ${troughRow.month} ${troughRow.year} at ${troughRow.totalRequiredFTE.toFixed(1)} FTE — a ${fteSpread}% headcount swing across the horizon.`;
    const channelSentence = channelMix.length === 0 ? "" : channelMix.length === 1
      ? `All demand routes through ${channelMix[0].label}, carrying 100% of the blended workload.`
      : `Channel mix: ${channelMix.map((c) => `${c.label} ${c.pct}%`).join(" · ")}. Align training pipelines and scheduling capacity to reflect this distribution.`;
    const growthSentence = growthRate !== 0
      ? `At the current ${Math.abs(growthRate).toFixed(1)}% ${growthRate > 0 ? "growth" : "decline"} rate applied to the model output, projected FTE by ${lastPeriod} is ${lastRow.totalRequiredFTE.toFixed(1)}. ${growthRate > 0 ? "Build your recruiting pipeline now to avoid coverage shortfalls." : "Manage attrition carefully to maintain service levels during the contraction."}`
      : `No growth rate adjustment is applied — the forecast reflects the model's base projection, reaching ${lastRow.totalRequiredFTE.toFixed(1)} FTE by ${lastPeriod}.`;
    const gapPlaceholder = "Headcount gap analysis not yet connected. Link your active headcount module to unlock coverage risk scoring, over/under-staffing alerts, and hiring timeline recommendations.";
    return { headline, trendSentence, peakSentence, channelSentence, growthSentence, gapPlaceholder, trendDir };
  }, [futureData, selectedChannels, assumptions.growthRate, forecastMethod]);
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
      const snapCasesHistory = buildSnapHistory("cases");
      const voiceForecast = getCalculatedVolumes(snapVoiceHistory, activeForecastMethod, activeAssumptions, activeHwParams, activeArimaParams, activeDecompParams);
      const emailForecast = snapEmailHistory.length > 0
        ? getCalculatedVolumes(snapEmailHistory, activeForecastMethod, activeAssumptions, activeHwParams, activeArimaParams, activeDecompParams)
        : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.email));
      const chatForecast = snapChatHistory.length > 0
        ? getCalculatedVolumes(snapChatHistory, activeForecastMethod, activeAssumptions, activeHwParams, activeArimaParams, activeDecompParams)
        : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.chat));
      const casesForecast = snapCasesHistory.length > 0
        ? getCalculatedVolumes(snapCasesHistory, activeForecastMethod, activeAssumptions, activeHwParams, activeArimaParams, activeDecompParams)
        : emailForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.cases));
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
            cases: getChannelStaffingMetrics("cases", casesForecast[fi] ?? Math.round(emailVol * CHANNEL_VOLUME_FACTORS.cases / CHANNEL_VOLUME_FACTORS.email), activeAssumptions),
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
    cases: {
      model: getChannelModelLabel("cases"),
      averageFTE: futureData.length > 0 ? roundTo(futureData.reduce((sum, row) => sum + row.channelMetrics.cases.requiredFTE, 0) / futureData.length, 1) : 0,
      averageOccupancy: futureData.length > 0 ? roundTo(futureData.reduce((sum, row) => sum + row.channelMetrics.cases.requiredOccupancy, 0) / futureData.length, 1) : 0,
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
      key: "cases" as const,
      label: CHANNEL_ASSUMPTION_META.cases.label,
      isIncluded: isChannelIncludedInBlend("cases"),
      modelRule: averageChannelMetrics.cases.model,
      volumeRule: hasExplicitHistoryByChannel.cases ? "Uses channel historical series and forecast method" : "Email-style fallback volume",
      ahtRule: `${assumptions.emailAht}s AHT`,
      serviceRule: `Staffing uses the same backlog window as Email: ${assumptions.emailSlaTarget}% within ${assumptions.emailSlaAnswerSeconds}s. ASA ${assumptions.emailAsaTargetSeconds}s is stored on the page but not applied in this calculation.`,
      workloadRule: "Shares the async backlog pool with Email and only uses remaining idle capacity after Voice and Chat",
      staffingRule: isChannelIncludedInBlend("cases")
        ? "Cases competes with Email for the remaining idle capacity after Voice and Chat."
        : "Agents = max(base workload seats, SLA backlog seats) before shrinkage and safety margin.",
      occupancyRule: isChannelIncludedInBlend("cases")
        ? `${averageChannelMetrics.cases.averageOccupancy}% required occupancy when Cases needs dedicated coverage`
        : `${averageChannelMetrics.cases.averageOccupancy}% standalone required occupancy`,
      fteRule: isChannelIncludedInBlend("cases")
        ? `${averageChannelMetrics.cases.averageFTE} average FTE equivalent before shared-pool offsets`
        : `${averageChannelMetrics.cases.averageFTE} average standalone FTE`,
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
        const lobKey = activeLob ? `_lob${activeLob.id}` : "";
        const raw = localStorage.getItem(`wfm_shrinkage_totals${lobKey}`);
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
          <section className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-700 px-6 py-5 shadow-lg">
            {/* Header row — compact */}
            <div className="flex items-baseline gap-3 flex-wrap">
              <p className="text-[10px] uppercase tracking-[0.4em] text-slate-300 font-semibold shrink-0">Long Term Forecasting</p>
              <h1 className="font-bold text-xl md:text-2xl text-white leading-tight">Multi-Channel Demand & Capacity Planning</h1>
            </div>
            {/* KPI cards — compact */}
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Card className="bg-white/10 border border-white/10 shadow-none">
                <CardContent className="p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-200">Forecasted Monthly Volume</p>
                  <h3 className="mt-1 text-xl font-bold text-white">{kpis.avgVolume.toLocaleString()}</h3>
                  <p className="text-[11px] text-slate-300 mt-0.5">Avg across the active horizon</p>
                </CardContent>
              </Card>
              <Card className="bg-white/10 border border-white/10 shadow-none">
                <CardContent className="p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-200">Workload Hours</p>
                  <h3 className="mt-1 text-xl font-bold text-white">{kpis.avgWorkloadHours.toLocaleString()}</h3>
                  <p className="text-[11px] text-slate-300 mt-0.5">From channel AHTs &amp; open hours</p>
                </CardContent>
              </Card>
              <Card className="bg-white/10 border border-white/10 shadow-none">
                <CardContent className="p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-200">Required Agents / FTE</p>
                  <h3 className="mt-1 text-xl font-bold text-white">{kpis.avgRequiredFTE}</h3>
                  <p className="text-[11px] text-slate-300 mt-0.5">{selectedBlendConfig.label}</p>
                </CardContent>
              </Card>
            </div>
            {/* ── Insight Narrative ── */}
            {insightNarrative && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="size-3.5 text-violet-300 shrink-0" />
                    <span className="text-[10px] uppercase tracking-widest text-slate-200 font-bold">Insight Narrative</span>
                    <span className="hidden sm:inline text-[10px] text-slate-200">· Exordium Private AI Engine · runs on your isolated server</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsInsightNarrativeOpen((open) => !open)}
                    className="h-7 px-2 text-[10px] text-slate-100 hover:bg-white/10 hover:text-white shrink-0"
                  >
                    {isInsightNarrativeOpen ? "Collapse" : "Expand"}
                    {isInsightNarrativeOpen ? <ChevronUp className="size-3.5 ml-1" /> : <ChevronDown className="size-3.5 ml-1" />}
                  </Button>
                </div>
              </div>
            )}
            {insightNarrative && isInsightNarrativeOpen && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <p className={`text-sm font-bold mb-2 ${insightNarrative.trendDir === "growing" ? "text-emerald-300" : insightNarrative.trendDir === "declining" ? "text-rose-300" : "text-sky-200"}`}>
                  {insightNarrative.headline}
                </p>
                <div className="text-xs text-slate-200 space-y-1.5 leading-relaxed">
                  <p>{insightNarrative.trendSentence}</p>
                  <p>{insightNarrative.peakSentence}</p>
                  {insightNarrative.channelSentence && <p>{insightNarrative.channelSentence}</p>}
                  <p>{insightNarrative.growthSentence}</p>
                  <p className="text-slate-200 italic text-[11px]">⚠ {insightNarrative.gapPlaceholder}</p>
                </div>
              </div>
            )}
          </section>

          {/* ── Scenario Manager ── */}
          <Card className="border border-border/50 shadow-sm">
            <CardContent className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[11px] font-black uppercase tracking-widest text-foreground/60 shrink-0">Scenarios</span>
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={handleRevertToBaseCase}
                    disabled={selectedScenarioId === "base"}
                  >
                    <RotateCcw className="size-3.5" />
                    Base Case
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
            <CardHeader className="bg-muted/40 border-b border-border/50">
              <button type="button" className="w-full flex items-start justify-between gap-4 text-left" onClick={() => setIsHistoricalSourceOpen((current) => !current)}>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <CardTitle className="text-sm font-bold">Historical Data Source</CardTitle>
                    <Badge variant="outline" className="border-primary/20 text-primary">{historicalSourceRows.length} Months</Badge>
                    {overrideCount > 0 && <Badge className="bg-amber-500 hover:bg-amber-500 text-black">{overrideCount} Overrides</Badge>}
                  </div>
                  <p className="text-xs text-foreground/60">Review and adjust the baseline monthly historical volumes used for forecast generation</p>
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
                          <Label className="text-[11px] font-black uppercase tracking-widest text-foreground/60">Channel View</Label>
                          <Select value={historicalChannelView} onValueChange={(value) => setHistoricalChannelView(value as ChannelKey)}>
                            <SelectTrigger className="mt-2 h-10 font-semibold">
                              <SelectValue placeholder="Select channel" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="voice">Voice</SelectItem>
                              <SelectItem value="email">Email</SelectItem>
                              <SelectItem value="chat">Chat</SelectItem>
                              <SelectItem value="cases">Cases</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="w-full sm:w-[120px]">
                          <Label className="text-[11px] font-black uppercase tracking-widest text-foreground/60">Forecast Year</Label>
                          <Input
                            type="number"
                            min={2000}
                            max={2100}
                            className="mt-2 h-10 font-bold"
                            value={forecastYear}
                            onChange={(e) => {
                              const yr = Math.max(2000, Math.min(2100, Number(e.target.value)));
                              if (Number.isFinite(yr)) {
                                setAssumptions((prev) => ({ ...prev, startDate: `${yr}-01-01` }));
                              }
                            }}
                          />
                          <p className="mt-2 text-[11px] leading-relaxed text-foreground/55">
                            Requires the previous 24 months: {new Date(historicalWindowStart).toLocaleString("en-US", { month: "short", year: "numeric" })} - {new Date(historicalWindowEnd).toLocaleString("en-US", { month: "short", year: "numeric" })}
                          </p>
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
                      <Button
                        size="sm"
                        className="gap-2 bg-violet-600 hover:bg-violet-700 text-white border-0"
                        onClick={runOutlierAnalysis}
                        disabled={isAnalyzing || historicalSourceRows.length < 4}
                      >
                        {isAnalyzing ? <Loader2 className="size-4 animate-spin" /> : <BrainCircuit className="size-4" />}
                        {isAnalyzing ? "Analyzing…" : "Detect Outliers"}
                      </Button>
                    </div>
                  </div>
                  {outlierResults !== null && (
                    <div className="rounded-xl border border-violet-200/70 dark:border-violet-800/40 bg-violet-50/60 dark:bg-violet-950/20 overflow-hidden">
                      <button
                        type="button"
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-violet-100/40 dark:hover:bg-violet-900/20 transition-colors"
                        onClick={() => setIsOutlierPanelOpen((v) => !v)}
                      >
                        <div className="flex items-center gap-3 flex-wrap">
                          <BrainCircuit className="size-4 text-violet-600 shrink-0" />
                          <span className="text-sm font-bold text-violet-900 dark:text-violet-200">
                            AI Outlier Analysis
                          </span>
                          {outlierResults.length === 0
                            ? <Badge className="bg-emerald-500 text-white text-[10px] gap-1"><CheckCircle2 className="size-3" />Clean</Badge>
                            : <Badge className="bg-violet-600 text-white text-[10px]">{outlierResults.length} flagged</Badge>
                          }
                          <div className="flex items-center gap-1 text-[10px] text-violet-600/80 dark:text-violet-400/70 font-medium">
                            <ShieldCheck className="size-3" />
                            Exordium Private AI Engine — runs entirely on your isolated server. No data leaves your environment.
                          </div>
                        </div>
                        <ChevronDown className={`size-4 text-violet-500 shrink-0 transition-transform ${isOutlierPanelOpen ? "" : "-rotate-90"}`} />
                      </button>
                      {isOutlierPanelOpen && (
                        <div className="px-4 pb-4 space-y-3">
                          {outlierResults.length === 0 ? (
                            <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 font-medium py-1">
                              <CheckCircle2 className="size-4 shrink-0" />
                              All {historicalSourceRows.length} months are within normal statistical range. No normalization needed.
                            </div>
                          ) : (
                            <>
                              <p className="text-xs text-violet-700/80 dark:text-violet-300/70">
                                Outliers detected using IQR fences (Q1 − 1.5×IQR, Q3 + 1.5×IQR) and Modified Z-score. Click <strong>Apply</strong> to set the suggested value as an override.
                              </p>
                              <div className="space-y-2">
                                {outlierResults.map((result) => (
                                  <div
                                    key={result.index}
                                    className={`rounded-lg border px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3 ${
                                      result.applied
                                        ? "border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-800/40"
                                        : result.severity === "extreme"
                                          ? "border-rose-200/80 bg-rose-50/60 dark:bg-rose-950/20 dark:border-rose-800/40"
                                          : "border-amber-200/80 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800/40"
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 shrink-0">
                                      <AlertTriangle className={`size-4 ${result.applied ? "text-emerald-500" : result.severity === "extreme" ? "text-rose-500" : "text-amber-500"}`} />
                                      <span className="font-bold text-sm">{result.monthLabel}</span>
                                      <Badge variant="outline" className={`text-[10px] ${result.direction === "high" ? "border-rose-300 text-rose-700" : "border-blue-300 text-blue-700"}`}>
                                        {result.direction === "high" ? "↑ High" : "↓ Low"}
                                      </Badge>
                                      <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-700">
                                        Z {result.modZScore}
                                      </Badge>
                                    </div>
                                    <p className="text-xs text-foreground/70 flex-1">{result.reason}</p>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {result.applied ? (
                                        <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1"><CheckCircle2 className="size-3" /> Applied</span>
                                      ) : (
                                        <Button
                                          size="sm"
                                          className="h-7 text-xs gap-1 bg-violet-600 hover:bg-violet-700 text-white"
                                          onClick={() => applyOutlierSuggestion(result.index, result.suggestedValue)}
                                        >
                                          Apply {result.suggestedValue.toLocaleString()}
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {(() => {
                    const renderYearTable = (yearGroup: { year: string; rows: HistoricalSourceRow[] }) => (
                      <div key={yearGroup.year} className="flex-1 min-w-0 overflow-x-auto rounded-xl border border-border/60">
                        <div className="bg-muted/70 border-b border-border/60 px-3 py-1.5 text-center">
                          <span className="text-xs font-black uppercase tracking-widest text-foreground/70">{yearGroup.year}</span>
                        </div>
                        <Table className="table-fixed w-full">
                          <colgroup>
                            <col className="w-[18%]" />
                            <col className="w-[16%]" />
                            <col className="w-[20%]" />
                            <col className="w-[16%]" />
                            <col className="w-[11%]" />
                            <col className="w-[19%]" />
                          </colgroup>
                          <TableHeader className="bg-muted/50">
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Month</TableHead>
                              <TableHead className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap">API Vol</TableHead>
                              <TableHead className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Override</TableHead>
                              <TableHead className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Final</TableHead>
                              <TableHead className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Var%</TableHead>
                              <TableHead className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Edit</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {yearGroup.rows.map((row) => {
                              const outlier = outlierResults?.find((r) => r.index === row.index);
                              return (
                                <TableRow key={row.index} className={`h-9 ${outlier && !outlier.applied ? (outlier.severity === "extreme" ? "bg-rose-50/40 dark:bg-rose-950/10" : "bg-amber-50/40 dark:bg-amber-950/10") : row.canEdit ? "bg-amber-50/60 dark:bg-amber-950/10" : ""}`}>
                                  <TableCell className="px-2 py-1 text-center align-middle">
                                    <div className="flex items-center justify-center gap-1">
                                      <span className="font-bold text-xs">{row.monthLabel.split(" ")[0]}</span>
                                      {outlier && !outlier.applied && (
                                        <UITooltip>
                                          <TooltipTrigger asChild>
                                            <AlertTriangle className={`size-3 shrink-0 cursor-help ${outlier.severity === "extreme" ? "text-rose-500" : "text-amber-500"}`} />
                                          </TooltipTrigger>
                                          <TooltipContent className="max-w-[280px]">
                                            <p className="text-xs font-semibold mb-1">{outlier.severity === "extreme" ? "Extreme Outlier" : "Mild Outlier"} — {outlier.direction === "high" ? "↑ Above upper fence" : "↓ Below lower fence"}</p>
                                            <p className="text-xs">{outlier.reason}</p>
                                            <p className="text-xs mt-1 font-semibold text-violet-300">Suggested: {outlier.suggestedValue.toLocaleString()}</p>
                                          </TooltipContent>
                                        </UITooltip>
                                      )}
                                      {outlier?.applied && <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />}
                                    </div>
                                  </TableCell>
                                  <TableCell className="px-2 py-1 text-center font-mono text-xs tabular-nums whitespace-nowrap align-middle">{formatInteger(row.apiVolume)}</TableCell>
                                  <TableCell className="px-2 py-1 text-center align-middle">
                                    <Input
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={row.overrideVolume}
                                      onChange={(event) => handleOverrideChange(row.index, event.target.value)}
                                      onBlur={() => handleOverrideBlur(row.index)}
                                      placeholder={String(row.apiVolume)}
                                      disabled={!row.canEdit}
                                      className="h-7 w-full text-center font-mono tabular-nums text-xs px-1"
                                    />
                                  </TableCell>
                                  <TableCell className="px-2 py-1 text-center font-mono text-xs font-bold text-primary tabular-nums whitespace-nowrap align-middle">{formatInteger(row.finalVolume)}</TableCell>
                                  <TableCell className={`px-2 py-1 text-center font-mono text-xs tabular-nums whitespace-nowrap align-middle ${row.variancePct === null ? "text-muted-foreground" : row.variancePct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                    {row.variancePct === null ? "—" : `${row.variancePct > 0 ? "+" : ""}${row.variancePct.toFixed(1)}%`}
                                  </TableCell>
                                  <TableCell className="px-2 py-1 text-center align-middle">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <Switch checked={row.canEdit} onCheckedChange={(checked) => handleOverrideToggle(row.index, checked)} disabled={row.stateLabel === "Manual"} className="scale-75" />
                                      <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => handleResetMonthOverride(row.index)} disabled={!row.canEdit}>
                                        Reset
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    );
                    return (
                      <div className={`flex gap-3 ${historicalRowsByYear.length > 1 ? "flex-row" : "flex-col"}`}>
                        {historicalRowsByYear.map(renderYearTable)}
                      </div>
                    );
                  })()}
                </CardContent>
              </div>
            </div>
          </Card>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground/50">Section B</p>
            <p className="text-sm font-semibold text-foreground">Forecasted Demand Output</p>
          </div>
          <Card className="border border-border/60 shadow-sm overflow-hidden">
            <CardHeader className="border-b border-border/50 bg-muted/40">
              <button type="button" className="w-full flex items-start justify-between gap-4 text-left" onClick={() => setIsBlendedStaffingOpen((current) => !current)}>
                <div className="space-y-2">
                  <CardTitle className="text-sm font-bold">Channel Staffing Setup</CardTitle>
                  <p className="text-xs text-foreground/60">Choose which channels are included and whether they share one agent pool or stay dedicated.</p>
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
                <Card className="border border-border/60 shadow-none rounded-3xl bg-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground/80">Channel Selection</CardTitle>
                  <p className="text-xs text-foreground/55">Tick the channels to include in the staffing view.</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(["voice", "email", "chat", "cases"] as ChannelKey[]).map((channel) => (
                      <label key={channel} className={`flex items-start gap-3 rounded-xl border border-border/60 p-4 cursor-pointer ${CHANNEL_ASSUMPTION_META[channel].bgClass}`}>
                        <Checkbox
                          checked={selectedChannels[channel]}
                          onCheckedChange={(checked) => handleSelectedChannelChange(channel, checked)}
                          className="mt-0.5"
                        />
                        <div className="space-y-1">
                      <p className="text-xs font-black uppercase tracking-wider text-black">{CHANNEL_ASSUMPTION_META[channel].label}</p>
                          <p className="text-xs text-black/75 mt-0.5">
                            {channel === "voice" ? "Priority queue and base staffing channel." : channel === "chat" ? `Concurrent channel with ${assumptions.chatConcurrency} chats per staffed seat.` : "Deferred workload channel shared with Email."}
                          </p>
                        </div>
                      </label>
                    ))}
                  </CardContent>
                </Card>
                <Card className="border border-border/60 shadow-none rounded-3xl bg-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground/80">Pooling Mode</CardTitle>
                    <p className="text-xs text-foreground/55">Choose whether selected channels share one pool or remain dedicated.</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <RadioGroup value={poolingMode} onValueChange={(value) => setPoolingMode(value as PoolingMode)} className="gap-3">
                      <label className="flex items-start gap-3 rounded-xl border border-border/60 p-4 cursor-pointer">
                        <RadioGroupItem value="blended" className="mt-0.5" />
                        <div className="space-y-1">
                          <p className="text-sm font-semibold">Blend Selected Channels</p>
                          <p className="text-xs text-foreground/55">All selected channels share a single staffed pool.</p>
                        </div>
                      </label>
                      <label className="flex items-start gap-3 rounded-xl border border-border/60 p-4 cursor-pointer">
                        <RadioGroupItem value="dedicated" className="mt-0.5" />
                        <div className="space-y-1">
                          <p className="text-sm font-semibold">Dedicated</p>
                          <p className="text-xs text-foreground/55">Each selected channel remains in its own pool.</p>
                        </div>
                      </label>
                    </RadioGroup>
                    <div className="rounded-lg border border-border/60 bg-muted/50 p-3 text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">Active setup:</span> {selectedBlendConfig.label}. {selectedBlendConfig.description}.
                    </div>
                  </CardContent>
                </Card>
              </div>
              <Card className="border border-border/60 shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground/80">Blended Staffing Pools</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {poolExplainability.map((pool) => (
                    <div key={pool.poolName} className="rounded-lg border border-border/50 p-4 bg-muted/30">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">{pool.poolName}</p>
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
                </CardContent>
              </div>
            </div>
          </Card>
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_304px] gap-6 items-start">
            <div className="space-y-6">
              <div className="space-y-6">
                <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-muted/30"><CardTitle className="text-sm font-bold">Monthly Volume Trend</CardTitle><p className="text-xs text-foreground/60 mt-1">Month-by-month YoY view comparing actual years against the forecast year.</p></CardHeader><CardContent className="p-6 h-[340px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={volumeTrendComparison.chartData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="month" tickLine={false} axisLine={false} interval={0} /><YAxis tickLine={false} axisLine={false} /><Tooltip formatter={(value, name) => [value == null ? "-" : Number(value).toLocaleString(), name]} /><Legend />{volumeTrendComparison.series.map((series) => <Line key={series.key} type="linear" dataKey={series.key} name={series.label} stroke={series.stroke} strokeOpacity={series.isForecast ? 0.98 : 0.72} strokeWidth={series.isForecast ? 3.5 : 2.25} strokeDasharray={series.isForecast ? "8 5" : undefined} dot={series.isForecast ? false : { r: 1.75, fill: series.stroke, fillOpacity: 0.75, stroke: "#ffffff", strokeWidth: 1 }} activeDot={{ r: 5, fill: series.stroke, stroke: "#ffffff", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></CardContent></Card>
                <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-muted/30"><CardTitle className="text-sm font-bold">Workload Trend</CardTitle><p className="text-xs text-foreground/60 mt-1">Pool workloads update with the current channel selection and pooling mode.</p></CardHeader><CardContent className="p-6 h-[340px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={pooledWorkloadChartData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Legend />{selectedBlendConfig.pools.map((_, index) => <Line key={`pool${index + 1}`} type="monotone" dataKey={`pool${index + 1}`} name={`Pool ${String.fromCharCode(65 + index)} Workload`} stroke={["#4f46e5", "#0f766e", "#dc2626"][index % 3]} strokeWidth={3} />)}<Line type="monotone" dataKey="totalWorkloadHours" name="Total Workload" stroke="#94a3b8" strokeDasharray="6 4" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></CardContent></Card>
                <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-muted/30"><CardTitle className="text-sm font-bold">Blended Staffing Requirement</CardTitle><p className="text-xs text-foreground/60 mt-1">Voice is staffed with Erlang C, chat uses modified Erlang C with concurrency, and email uses a backlog model. In blended pools, idle capacity is reused across channels before additional staffing is added.</p></CardHeader><CardContent className="p-6 h-[340px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={requiredStaffingTrendData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Legend /><Line type="monotone" dataKey="sharedPoolFTE" name="Shared Pool FTE" stroke="#0f766e" strokeWidth={3} /><Line type="monotone" dataKey="standalonePoolFTE" name="Standalone Pool FTE" stroke="#2563eb" strokeWidth={3} /><Line type="monotone" dataKey="totalRequiredFTE" name="Total Required FTE" stroke="#f59e0b" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></CardContent></Card>
                <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-muted/30"><CardTitle className="text-sm font-bold">Seasonality Trend</CardTitle></CardHeader><CardContent className="p-6 h-[340px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={seasonalityTrend}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Legend /><Bar dataKey="seasonalityIndex" name="Seasonality Index" fill="#0f766e" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></CardContent></Card>
              </div>
              <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-muted/30"><CardTitle className="text-sm font-bold">Scenario Comparison — Required FTE</CardTitle></CardHeader><CardContent className="p-6 h-[360px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={scenarioComparisonData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="month" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Legend />{Object.values(scenarios).map((scenario, index) => <Line key={scenario.id} type="monotone" dataKey={scenario.id} name={scenario.name} stroke={scenarioColors[index % scenarioColors.length]} strokeWidth={scenario.id === selectedScenarioId ? 3.5 : 2} dot={false} />)}</LineChart></ResponsiveContainer></CardContent></Card>
              {/* ── Demand Forecast Detail + Re-cut ─────────────────────────── */}
              <Card className="border border-border/50 shadow-lg bg-card">
                <CardHeader className="border-b border-border/50 bg-muted/50">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <CardTitle className="text-sm font-bold flex items-center gap-2">
                          Demand Forecast Detail
                          {recutVolumesByChannel && (
                            <Badge className="bg-emerald-600 text-white text-[10px]">Re-cut Active</Badge>
                          )}
                        </CardTitle>
                        <p className="text-xs text-foreground/60 mt-0.5">Per-channel view. Enter actuals for completed months to generate a re-cut.</p>
                      </div>
                      {/* Channel selector tabs */}
                      <div className="flex gap-1 rounded-lg border border-border p-1 bg-muted/40">
                        {(["voice", "email", "chat", "cases"] as ChannelKey[]).map((ch) => (
                          <button
                            key={ch}
                            type="button"
                            onClick={() => setDetailChannel(ch)}
                            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${detailChannel === ch ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                          >
                            {CHANNEL_ASSUMPTION_META[ch].label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Re-cut factor banner */}
                    {activeRecutFactor != null && (
                      <div className="flex items-center gap-3 flex-wrap rounded-xl border border-emerald-200/60 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-800/40 px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Re-cut Factor ({CHANNEL_ASSUMPTION_META[detailChannel].label})</span>
                          <Badge className={`font-black text-sm ${activeRecutFactor >= 1 ? "bg-emerald-600" : "bg-rose-600"} text-white`}>
                            {activeRecutFactor.toFixed(4)}×
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">({activeRecutFactor >= 1 ? "+" : ""}{((activeRecutFactor - 1) * 100).toFixed(1)}% vs original)</span>
                        <div className="ml-auto flex gap-2">
                          {recutVolumesByChannel ? (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50" onClick={handleClearRecut}>
                              <X className="size-3" />Clear Re-cut
                            </Button>
                          ) : null}
                          <Button size="sm" className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handlePublishRecut}>
                            <TrendingUp className="size-3" />Publish to Intraday
                          </Button>
                        </div>
                      </div>
                    )}
                    {completedMonthIndices.length > 0 && activeRecutFactor == null && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Enter actual volumes for completed months below to unlock the Re-cut factor.
                      </p>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table className="table-fixed">
                    <colgroup>
                      <col className="w-[18%]" />
                      <col className="w-[17%]" />
                      <col className="w-[17%]" />
                      <col className="w-[12%]" />
                      <col className="w-[12%]" />
                      <col className="w-[24%]" />
                    </colgroup>
                    <TableHeader className="bg-muted/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-6 text-xs font-semibold uppercase tracking-wide text-foreground/70 whitespace-nowrap">Month</TableHead>
                        <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-foreground/70 whitespace-nowrap">Forecast Volume</TableHead>
                        <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-foreground/70 whitespace-nowrap">Actual Volume</TableHead>
                        <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-foreground/70 whitespace-nowrap">Variance</TableHead>
                        {activeRecutFactor != null && (
                          <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-emerald-700 whitespace-nowrap">Re-cut Forecast</TableHead>
                        )}
                        <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-foreground/70 whitespace-nowrap">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allForecastMonths.map((row) => {
                        const isSaving = savingActuals.has(row.actualKey);
                        const isSaved = savedActuals.has(row.actualKey);
                        return (
                          <TableRow key={`${row.year}-${row.month1}-${detailChannel}`} className={`hover:bg-muted/30 ${row.isCompleted ? "bg-blue-50/30 dark:bg-blue-950/10" : ""}`}>
                            <TableCell className="px-3 text-center align-middle">
                              <div className="flex items-center justify-center gap-2 min-w-0">
                                <span className="font-bold text-sm">{row.monthLabel} {row.year}</span>
                                {row.isCompleted && <Badge variant="outline" className="text-[10px] h-4 px-1 text-blue-600 border-blue-300">Completed</Badge>}
                              </div>
                            </TableCell>
                            <TableCell className="px-3 text-center font-mono text-sm font-bold text-primary tabular-nums whitespace-nowrap align-middle">{row.forecastVol.toLocaleString()}</TableCell>
                            <TableCell className="px-3 text-center align-middle">
                              {row.isCompleted ? (
                                <div className="flex items-center justify-center gap-1.5">
                                  <Input
                                    type="number"
                                    min={0}
                                    className="h-7 w-full max-w-[8.5rem] text-center text-xs font-mono font-bold tabular-nums"
                                    placeholder="Enter actual"
                                    defaultValue={row.actualVol ?? ""}
                                    onBlur={(e) => {
                                      const val = e.target.value.trim();
                                      if (val !== "" && !isNaN(Number(val)) && Number(val) >= 0) {
                                        void handleSaveActual(row.index, detailChannel, Number(val));
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        const val = (e.target as HTMLInputElement).value.trim();
                                        if (val !== "" && !isNaN(Number(val)) && Number(val) >= 0) {
                                          void handleSaveActual(row.index, detailChannel, Number(val));
                                          (e.target as HTMLInputElement).blur();
                                        }
                                      }
                                    }}
                                  />
                                  {isSaving && <Loader2 className="size-3.5 text-muted-foreground animate-spin shrink-0" />}
                                  {isSaved && !isSaving && <span className="text-emerald-600 text-xs font-bold shrink-0">✓</span>}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="px-3 text-center font-mono text-sm tabular-nums whitespace-nowrap align-middle">
                              {row.variancePct != null ? (
                                <span className={row.variancePct >= 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                                  {row.variancePct >= 0 ? "+" : ""}{row.variancePct}%
                                </span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            {activeRecutFactor != null && (
                              <TableCell className="px-3 text-center font-mono text-sm tabular-nums whitespace-nowrap align-middle">
                                {row.recutVol != null ? (
                                  <span className="font-bold text-emerald-700">{row.recutVol.toLocaleString()}</span>
                                ) : row.isCompleted && row.actualVol != null ? (
                                  <span className="font-bold text-blue-700">{row.actualVol.toLocaleString()}</span>
                                ) : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            )}
                            <TableCell className="px-3 text-center text-xs text-muted-foreground whitespace-nowrap align-middle">
                              {row.isCompleted ? "Actual entry" : "Forecast"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              {/* ── Staffing detail — future months ──────────────────────────── */}
              <Card className="border border-border/50 shadow-lg bg-card">
                <CardHeader className="border-b border-border/50 bg-muted/50">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <CardTitle className="text-sm font-bold">Staffing Detail — Future Months</CardTitle>
                      <p className="text-xs text-foreground/60 mt-0.5">
                        Volume column mirrors the <span className={`font-semibold ${CHANNEL_ASSUMPTION_META[detailChannel].colorClass}`}>{CHANNEL_ASSUMPTION_META[detailChannel].label}</span> selection above.
                        Workload &amp; FTE reflect the blended staffing allocation across all included channels ({selectedBlendConfig.label}), with voice as the base and idle capacity reused across chat and email.
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table className="table-fixed">
                    <colgroup>
                      <col className="w-[14%]" />
                      <col className="w-[10%]" />
                      <col className="w-[11%]" />
                      <col className="w-[9%]" />
                      <col className="w-[9%]" />
                      <col className="w-[9%]" />
                      <col className="w-[12%]" />
                      <col className="w-[10%]" />
                      <col className="w-[8%]" />
                      <col className="w-[8%]" />
                      <col className="w-[10%]" />
                    </colgroup>
                    <TableHeader className="bg-muted/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-6 text-[11px] font-semibold uppercase tracking-wide text-foreground/70 whitespace-normal leading-tight">Month</TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-foreground/70 whitespace-normal leading-tight">
                          {CHANNEL_ASSUMPTION_META[detailChannel].label} Vol.
                        </TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-foreground/70 whitespace-normal leading-tight">Blended Wkld</TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-foreground/70 whitespace-normal leading-tight">AHT</TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-foreground/70 whitespace-normal leading-tight">Occ.</TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-foreground/70 whitespace-normal leading-tight">Shr.</TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-foreground/70 whitespace-normal leading-tight">Setup</TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-foreground/70 whitespace-normal leading-tight">Shared Wkld</TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-foreground/70 whitespace-normal leading-tight">Shared FTE</TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-foreground/70 whitespace-normal leading-tight">Solo FTE</TableHead>
                        <TableHead className="pr-6 text-right text-[11px] font-semibold uppercase tracking-wide text-foreground/70 whitespace-normal leading-tight">Req. FTE</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {futureData.map((row) => {
                        // Show channel volume consistent with the Demand Forecast Detail tab selection
                        const channelVol = row.channelMetrics[detailChannel].volume;
                        return (
                          <TableRow key={`${row.year}-${row.month}`} className="hover:bg-muted/30">
                            <TableCell className="px-3 text-center font-bold text-sm align-middle">{row.month} {row.year}</TableCell>
                            <TableCell className="px-3 text-center font-mono text-sm font-bold text-primary tabular-nums whitespace-nowrap align-middle">{channelVol.toLocaleString()}</TableCell>
                            <TableCell className="px-3 text-center font-mono text-sm text-indigo-600 tabular-nums whitespace-nowrap align-middle">{row.workloadHours.toLocaleString()}</TableCell>
                            <TableCell className="px-3 text-center font-mono text-sm tabular-nums whitespace-nowrap align-middle">{row.aht}s</TableCell>
                            <TableCell className="px-3 text-center font-mono text-sm tabular-nums whitespace-nowrap align-middle">{row.occupancy}%</TableCell>
                            <TableCell className="px-3 text-center font-mono text-sm tabular-nums whitespace-nowrap align-middle">{row.shrinkage}%</TableCell>
                            <TableCell className="px-3 text-center text-sm whitespace-nowrap truncate max-w-0 align-middle">{row.activeBlendPreset}</TableCell>
                            <TableCell className="px-3 text-center font-mono text-sm tabular-nums whitespace-nowrap align-middle">{row.sharedPoolWorkload > 0 ? row.sharedPoolWorkload.toLocaleString() : "-"}</TableCell>
                            <TableCell className="px-3 text-center font-mono text-sm tabular-nums whitespace-nowrap align-middle">{row.sharedPoolFTE > 0 ? row.sharedPoolFTE.toLocaleString() : "-"}</TableCell>
                            <TableCell className="px-3 text-center font-mono text-sm tabular-nums whitespace-nowrap align-middle">{row.standalonePoolFTE > 0 ? row.standalonePoolFTE.toLocaleString() : "-"}</TableCell>
                            <TableCell className="px-3 text-center font-mono text-sm font-bold text-amber-600 tabular-nums whitespace-nowrap align-middle">{row.totalRequiredFTE}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
            <div className="xl:sticky xl:top-[180px]">
              <Card className="border border-border/80 shadow-xl overflow-hidden">
                <CardHeader className="border-b border-border/50 bg-slate-900 text-white py-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-black flex items-center gap-2 uppercase tracking-[0.2em]"><Settings2 className="size-4 text-blue-400" />Demand Assumptions</CardTitle>
                    <Button variant="ghost" size="icon" className="size-6 text-white hover:bg-white/10" onClick={() => setIsAssumptionsOpen(!isAssumptionsOpen)}>{isAssumptionsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Button>
                  </div>
                  {isOverridingLobDefaults && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Badge className="bg-amber-500 hover:bg-amber-500 text-black text-xs">Overriding LOB Defaults</Badge>
                      <Button variant="ghost" size="sm" className="text-xs text-white hover:bg-white/10 h-6 px-2 gap-1" onClick={resetToLobDefaults}>
                        <RotateCcw className="size-3" />Reset to defaults
                      </Button>
                    </div>
                  )}
                </CardHeader>
                {isAssumptionsOpen && <CardContent className="pt-6 space-y-6 bg-card">
                  <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="startDate" className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Planning Start Date</Label><Calendar className="size-3.5 text-primary" /></div><Input id="startDate" type="date" value={assumptions.startDate} onChange={(event) => setAssumptions({ ...assumptions, startDate: event.target.value })} className="h-10 font-bold" /></div>
                  <div className="space-y-3 border-t border-border pt-4">
                    <Select value={forecastMethod} onValueChange={setForecastMethod}>
                      <SelectTrigger className="h-10 font-bold"><SelectValue placeholder="Choose forecast method..." /></SelectTrigger>
                      <SelectContent>{FORECAST_METHODS.map((method) => <SelectItem key={method.key} value={method.key}>{method.label}</SelectItem>)}</SelectContent>
                    </Select>
                    {/* ── Model parameters — shown immediately below the selector ── */}
                    {forecastMethod === "holtwinters" && (
                      <div className="space-y-4 rounded-xl border border-border/60 bg-muted/30 p-4 mt-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-foreground/70">{FORECAST_MODEL_COPY.holtwinters.label}</Label>
                            <UITooltip>
                              <TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                              <TooltipContent className="max-w-[260px]"><p className="text-xs">{FORECAST_MODEL_COPY.holtwinters.description}</p></TooltipContent>
                            </UITooltip>
                          </div>
                          <Badge className="bg-amber-500 font-black tracking-tight">{FORECAST_MODEL_COPY.holtwinters.badge}</Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Label className="text-xs font-bold">Alpha (α) — Level</Label>
                              <UITooltip><TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent className="max-w-[220px]"><p className="text-xs">How quickly the model adapts to new observed levels. Higher α = more weight on recent data, faster response to sudden shifts. Lower α = smoother, more stable level estimate. Range: 0.01–0.99.</p></TooltipContent></UITooltip>
                            </div>
                            <Input type="number" step="0.05" min="0.01" max="0.99" value={hwParams.alpha} onChange={(e) => setHwParams({ ...hwParams, alpha: Number(e.target.value) })} className="h-8 text-xs" />
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Label className="text-xs font-bold">Beta (β) — Trend</Label>
                              <UITooltip><TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent className="max-w-[220px]"><p className="text-xs">How quickly the trend component adapts to new slope observations. Lower β = stable, persistent trend. Higher β = trend reacts faster to recent direction changes. Range: 0.01–0.99.</p></TooltipContent></UITooltip>
                            </div>
                            <Input type="number" step="0.05" min="0.01" max="0.99" value={hwParams.beta} onChange={(e) => setHwParams({ ...hwParams, beta: Number(e.target.value) })} className="h-8 text-xs" />
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Label className="text-xs font-bold">Gamma (γ) — Seasonality</Label>
                              <UITooltip><TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent className="max-w-[220px]"><p className="text-xs">How quickly the seasonal indices update each cycle. Higher γ = seasonal pattern adapts quickly to the most recent year. Lower γ = stable, averaged seasonal shape across all history. Range: 0.01–0.99.</p></TooltipContent></UITooltip>
                            </div>
                            <Input type="number" step="0.05" min="0.01" max="0.99" value={hwParams.gamma} onChange={(e) => setHwParams({ ...hwParams, gamma: Number(e.target.value) })} className="h-8 text-xs" />
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Label className="text-xs font-bold">Season Length</Label>
                              <UITooltip><TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent className="max-w-[220px]"><p className="text-xs">Number of periods per seasonal cycle. Set to 12 for monthly data with annual seasonality. Requires at least 2 full seasons of history to fit properly.</p></TooltipContent></UITooltip>
                            </div>
                            <Input type="number" min="2" max="24" value={hwParams.seasonLength} onChange={(e) => setHwParams({ ...hwParams, seasonLength: Number(e.target.value) })} className="h-8 text-xs" />
                          </div>
                        </div>
                      </div>
                    )}
                    {forecastMethod === "arima" && (
                      <div className="space-y-4 rounded-xl border border-border/60 bg-muted/30 p-4 mt-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-foreground/70">{FORECAST_MODEL_COPY.arima.label}</Label>
                            <UITooltip>
                              <TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                              <TooltipContent className="max-w-[260px]"><p className="text-xs">{FORECAST_MODEL_COPY.arima.description}</p></TooltipContent>
                            </UITooltip>
                          </div>
                          <Badge className="bg-emerald-500 font-black tracking-tight">{FORECAST_MODEL_COPY.arima.badge}</Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Label className="text-xs font-bold">p — AR Order</Label>
                              <UITooltip><TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent className="max-w-[240px]"><p className="text-xs"><span className="font-bold">Autoregressive order.</span> How many past periods the model uses to predict the next value. AR coefficients are estimated via OLS, so the model learns the actual momentum pattern from your data. Higher p captures longer-range persistence but needs more history. Typical range: 1–3.</p></TooltipContent></UITooltip>
                            </div>
                            <Input type="number" min="0" max="6" value={arimaParams.p} onChange={(e) => setArimaParams({ ...arimaParams, p: Number(e.target.value) })} className="h-8 text-xs" />
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Label className="text-xs font-bold">d — Differencing</Label>
                              <UITooltip><TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent className="max-w-[240px]"><p className="text-xs"><span className="font-bold">Integration order (trend removal).</span> 0 = model raw volumes (already stationary). 1 = model month-over-month changes — removes a linear trend and is correct for most call-volume series. 2 = model changes-in-changes — removes a quadratic (accelerating) trend. Start with d=1.</p></TooltipContent></UITooltip>
                            </div>
                            <Input type="number" min="0" max="2" value={arimaParams.d} onChange={(e) => setArimaParams({ ...arimaParams, d: Number(e.target.value) })} className="h-8 text-xs" />
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Label className="text-xs font-bold">q — MA Order</Label>
                              <UITooltip><TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent className="max-w-[240px]"><p className="text-xs"><span className="font-bold">Moving average order.</span> Uses the last q in-sample forecast errors to correct each next prediction, dampening the effect of random shocks. q=1 corrects for the most recent shock; q=2 smooths over two periods. Higher q reduces responsiveness to outliers. Typical range: 1–2.</p></TooltipContent></UITooltip>
                            </div>
                            <Input type="number" min="0" max="6" value={arimaParams.q} onChange={(e) => setArimaParams({ ...arimaParams, q: Number(e.target.value) })} className="h-8 text-xs" />
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground">AR coefficients are OLS-estimated from your historical data. MA term corrects for recent forecast error. Recommended starting point: p=1, d=1, q=1.</p>
                      </div>
                    )}
                    {forecastMethod === "decomposition" && (
                      <div className="space-y-4 rounded-xl border border-border/60 bg-muted/30 p-4 mt-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-foreground/70">{FORECAST_MODEL_COPY.decomposition.label}</Label>
                            <UITooltip>
                              <TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                              <TooltipContent className="max-w-[260px]"><p className="text-xs">{FORECAST_MODEL_COPY.decomposition.description}</p></TooltipContent>
                            </UITooltip>
                          </div>
                          <Badge className="bg-blue-500 font-black tracking-tight">{FORECAST_MODEL_COPY.decomposition.badge}</Badge>
                        </div>
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1">
                                <Label className="text-xs font-bold">Trend Strength</Label>
                                <UITooltip><TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent className="max-w-[240px]"><p className="text-xs"><span className="font-bold">Scales the extracted trend slope.</span> 1.0 = project the observed historical trend as-is. &lt;1.0 = dampen the trend (conservative / mean-reverting). &gt;1.0 = amplify the trend (optimistic growth assumption). Does not affect the seasonal pattern.</p></TooltipContent></UITooltip>
                              </div>
                              <span className="text-xs font-bold">{decompParams.trendStrength}×</span>
                            </div>
                            <Input type="number" step="0.1" min="0" max="3" value={decompParams.trendStrength} onChange={(e) => setDecompParams({ ...decompParams, trendStrength: Number(e.target.value) })} className="h-8 text-xs" />
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1">
                                <Label className="text-xs font-bold">Seasonality Strength</Label>
                                <UITooltip><TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent className="max-w-[240px]"><p className="text-xs"><span className="font-bold">Scales the seasonal indices around 1.0.</span> 1.0 = apply the observed seasonal pattern in full. &lt;1.0 = flatten seasonality (peaks and troughs are reduced toward the trend line). &gt;1.0 = amplify seasonal swings. Seasonal indices are normalized to average 1.0 before this multiplier is applied.</p></TooltipContent></UITooltip>
                              </div>
                              <span className="text-xs font-bold">{decompParams.seasonalityStrength}×</span>
                            </div>
                            <Input type="number" step="0.1" min="0" max="3" value={decompParams.seasonalityStrength} onChange={(e) => setDecompParams({ ...decompParams, seasonalityStrength: Number(e.target.value) })} className="h-8 text-xs" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="aht" className="text-xs font-semibold uppercase tracking-wider text-foreground/70">AHT Assumption</Label><span className="text-xs font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-primary">{assumptions.aht}s</span></div><Input id="aht" type="number" value={assumptions.aht} onChange={(event) => setAssumptions({ ...assumptions, aht: validateInput(Number(event.target.value)) })} className="h-10 font-bold" /></div>
                  <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="emailAht" className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Email AHT</Label><span className="text-xs font-black bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded text-emerald-700 dark:text-emerald-300">{assumptions.emailAht}s</span></div><Input id="emailAht" type="number" value={assumptions.emailAht} onChange={(event) => setAssumptions({ ...assumptions, emailAht: validateInput(Number(event.target.value)) })} className="h-10 font-bold" /></div>
                  <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="chatAht" className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Chat AHT</Label><span className="text-xs font-black bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded text-amber-700 dark:text-amber-300">{assumptions.chatAht}s</span></div><Input id="chatAht" type="number" value={assumptions.chatAht} onChange={(event) => setAssumptions({ ...assumptions, chatAht: validateInput(Number(event.target.value)) })} className="h-10 font-bold" /></div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Label htmlFor="chatConcurrency" className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Chat Concurrency</Label>
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
                        <Label className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Shrinkage</Label>
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
                      <Label className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Occupancy</Label>
                      <Badge variant="outline" className="font-black text-xs border-indigo-200 text-indigo-700">Derived From SLA</Badge>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {(["voice", "email", "chat", "cases"] as ChannelKey[]).map((channelKey) => (
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
                    <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Voice SLA / ASA</p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2"><Label htmlFor="voiceSlaTarget" className="text-xs font-medium text-foreground/70">SLA %</Label><Input id="voiceSlaTarget" type="number" value={assumptions.voiceSlaTarget} onChange={(event) => setAssumptions({ ...assumptions, voiceSlaTarget: validateInput(Number(event.target.value), 1, 100) })} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label htmlFor="voiceSlaAnswerSeconds" className="text-xs font-medium text-foreground/70">Within Sec</Label><Input id="voiceSlaAnswerSeconds" type="number" value={assumptions.voiceSlaAnswerSeconds} onChange={(event) => setAssumptions({ ...assumptions, voiceSlaAnswerSeconds: validateInput(Number(event.target.value), 1, 3600) })} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label htmlFor="voiceAsaTargetSeconds" className="text-xs font-medium text-foreground/70">ASA Sec</Label><Input id="voiceAsaTargetSeconds" type="number" value={assumptions.voiceAsaTargetSeconds} onChange={(event) => setAssumptions({ ...assumptions, voiceAsaTargetSeconds: validateInput(Number(event.target.value), 1, 3600) })} className="h-10 font-bold" /></div>
                    </div>
                  </div>
                  <div className="space-y-4 rounded-xl border border-border/60 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Email SLA / ASA</p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2"><Label htmlFor="emailSlaTarget" className="text-xs font-medium text-foreground/70">SLA %</Label><Input id="emailSlaTarget" type="number" value={assumptions.emailSlaTarget} onChange={(event) => setAssumptions({ ...assumptions, emailSlaTarget: validateInput(Number(event.target.value), 1, 100) })} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label htmlFor="emailSlaAnswerSeconds" className="text-xs font-medium text-foreground/70">Within Sec</Label><Input id="emailSlaAnswerSeconds" type="number" value={assumptions.emailSlaAnswerSeconds} onChange={(event) => setAssumptions({ ...assumptions, emailSlaAnswerSeconds: validateInput(Number(event.target.value), 1, 86400) })} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label htmlFor="emailAsaTargetSeconds" className="text-xs font-medium text-foreground/70">ASA Sec</Label><Input id="emailAsaTargetSeconds" type="number" value={assumptions.emailAsaTargetSeconds} onChange={(event) => setAssumptions({ ...assumptions, emailAsaTargetSeconds: validateInput(Number(event.target.value), 1, 86400) })} className="h-10 font-bold" /></div>
                    </div>
                  </div>
                  <div className="space-y-4 rounded-xl border border-border/60 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Chat SLA / ASA</p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2"><Label htmlFor="chatSlaTarget" className="text-xs font-medium text-foreground/70">SLA %</Label><Input id="chatSlaTarget" type="number" value={assumptions.chatSlaTarget} onChange={(event) => setAssumptions({ ...assumptions, chatSlaTarget: validateInput(Number(event.target.value), 1, 100) })} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label htmlFor="chatSlaAnswerSeconds" className="text-xs font-medium text-foreground/70">Within Sec</Label><Input id="chatSlaAnswerSeconds" type="number" value={assumptions.chatSlaAnswerSeconds} onChange={(event) => setAssumptions({ ...assumptions, chatSlaAnswerSeconds: validateInput(Number(event.target.value), 1, 3600) })} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label htmlFor="chatAsaTargetSeconds" className="text-xs font-medium text-foreground/70">ASA Sec</Label><Input id="chatAsaTargetSeconds" type="number" value={assumptions.chatAsaTargetSeconds} onChange={(event) => setAssumptions({ ...assumptions, chatAsaTargetSeconds: validateInput(Number(event.target.value), 1, 3600) })} className="h-10 font-bold" /></div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label htmlFor="operatingHoursPerDay" className="text-xs font-medium text-foreground/70">Hours Per Day</Label><Input id="operatingHoursPerDay" type="number" step="0.5" value={assumptions.operatingHoursPerDay} onChange={(event) => { const nextHours = validateInput(Number(event.target.value), 0.5, 24); const next: Assumptions = { ...assumptions, operatingHoursPerDay: nextHours }; if (assumptions.useShrinkageModeler) { const LEAVE_IDS = new Set(["annual_leave", "sick_leave"]); const shiftMin = Math.round(nextHours * 60); const scaledItems = (assumptions.shrinkageItems ?? DEFAULT_SHRINKAGE_ITEMS).map((item) => LEAVE_IDS.has(item.id) ? { ...item, durationMinutes: shiftMin } : item); next.shrinkageItems = scaledItems; next.shrinkage = computeShrinkageFromItems(scaledItems, nextHours, assumptions.operatingDaysPerWeek); } setAssumptions(next); }} className="h-10 font-bold" /></div>
                    <div className="space-y-2"><Label htmlFor="operatingDaysPerWeek" className="text-xs font-medium text-foreground/70">Days Per Week</Label><Input id="operatingDaysPerWeek" type="number" step="0.5" value={assumptions.operatingDaysPerWeek} onChange={(event) => { const nextDays = validateInput(Number(event.target.value), 0.5, 7); const next: Assumptions = { ...assumptions, operatingDaysPerWeek: nextDays }; if (assumptions.useShrinkageModeler) next.shrinkage = computeShrinkageFromItems(assumptions.shrinkageItems ?? DEFAULT_SHRINKAGE_ITEMS, assumptions.operatingHoursPerDay, nextDays); setAssumptions(next); }} className="h-10 font-bold" /></div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    Operating window: <span className="font-bold text-foreground">{assumptions.operatingHoursPerDay}h/day x {assumptions.operatingDaysPerWeek}d/week</span> = <span className="font-bold text-foreground">{openHoursPerMonth}</span> open hours/month
                  </div>
                  <div className="space-y-2"><div className="flex items-center gap-1"><Label htmlFor="safetyMargin" className="text-xs font-medium text-foreground/70">Safety Margin</Label><UITooltip><TooltipTrigger asChild><ShieldAlert className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-xs">Demand staffing buffer for forecast variance</p></TooltipContent></UITooltip></div><Input id="safetyMargin" type="number" value={assumptions.safetyMargin} onChange={(event) => setAssumptions({ ...assumptions, safetyMargin: validateInput(Number(event.target.value), 0, 20) })} className="h-10 font-bold" /></div>
                  <div className="space-y-2"><Label htmlFor="fteMonthlyHours" className="text-xs font-medium text-foreground/70">FTE Monthly Hours</Label><Input id="fteMonthlyHours" type="number" step="0.01" value={assumptions.fteMonthlyHours} onChange={(event) => setAssumptions({ ...assumptions, fteMonthlyHours: validateInput(Number(event.target.value), 1) })} className="h-10 font-bold" /></div>
                  <div className="space-y-3 border-t border-border pt-6 mt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Label htmlFor="growthRate" className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Growth Rate</Label>
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
                    {assumptions.growthRate !== 0 && (
                      <p className="text-[11px] text-muted-foreground">Applied as a ×{(1 + assumptions.growthRate / 100).toFixed(3)} multiplier after {FORECAST_METHODS.find((m) => m.key === forecastMethod)?.label ?? forecastMethod}.</p>
                    )}
                  </div>
                  <Button className="w-full h-11 font-black uppercase tracking-widest text-xs mt-4 shadow-lg shadow-primary/20" onClick={() => toast.info("Demand forecast recalculated", { duration: 1500 })}><LayoutDashboard className="size-4 mr-2" />Recalculate</Button>
                </CardContent>}
              </Card>
              <Card className="bg-gradient-to-br from-slate-900 to-slate-800 text-white border-none shadow-2xl mt-6"><CardHeader className="pb-2"><CardTitle className="text-[10px] font-black flex items-center gap-2 uppercase tracking-[0.2em] text-blue-400"><LineChartIcon className="size-4" />Demand Notes</CardTitle></CardHeader><CardContent className="space-y-4 pt-2"><div className="space-y-2"><p className="text-[10px] text-slate-300 uppercase font-bold tracking-[0.15em]">Staffing Logic</p><p className="text-xs font-medium leading-relaxed">Voice uses Erlang C, chat uses modified Erlang C with concurrency, and email uses a backlog-clearing model. Service-level targets drive the staffing requirement; occupancy is reported as an output, not an input.</p></div><div className="space-y-2"><p className="text-[10px] text-slate-300 uppercase font-bold tracking-[0.15em]">Blended Pools</p><p className="text-xs font-medium leading-relaxed">Voice establishes the staffed base. Remaining idle capacity is then reused for chat first and email second before any additional blended staffing is added.</p></div><div className="space-y-2"><p className="text-[10px] text-slate-300 uppercase font-bold tracking-[0.15em]">Open-Hours Effect</p><p className="text-xs font-medium leading-relaxed">Monthly open hours determine how much productive staffed-seat time is available and therefore the gross FTE after shrinkage.</p></div><div className="space-y-2"><p className="text-[10px] text-slate-300 uppercase font-bold tracking-[0.15em]">Seasonality View</p><p className="text-xs font-medium leading-relaxed">The seasonality chart indexes each forecast month against the average monthly forecast volume.</p></div></CardContent></Card>
            </div>
          </div>
        </div>
      </PageLayout>
    </TooltipProvider>
  );
}
