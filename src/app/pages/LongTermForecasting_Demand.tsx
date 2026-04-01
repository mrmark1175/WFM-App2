import React, { useEffect, useMemo, useRef, useState } from "react";
import { PageLayout } from "../components/PageLayout";
import { TrendingUp, Clock, Users, Settings2, ChevronRight, ChevronDown, Save, Plus, Loader2, Calendar, Info, ShieldAlert, LayoutDashboard, Trash2, RotateCcw, CircleHelp, LineChart as LineChartIcon } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { Switch } from "../components/ui/switch";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { toast } from "sonner";
import { calculateYoY, calculateMovingAverage, calculateLinearRegression, calculateHoltWinters, calculateDecomposition, calculateARIMA } from "./forecasting-logic";
import { buildDemandHelpPrintHtml, demandForecastHelpSections } from "./LongTermForecasting_Demand.help";

interface Assumptions {
  startDate: string;
  aht: number;
  emailAht: number;
  chatAht: number;
  shrinkage: number;
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
  activeBlendPreset: BlendPresetId;
  isHistoricalSourceOpen: boolean;
  selectedHistoricalChannel: ChannelKey;
}
interface Scenario { id: string; name: string; assumptions: Assumptions; snapshot: PlannerSnapshot; }
interface HistoricalSourceRow { index: number; monthLabel: string; apiVolume: number; overrideVolume: string; finalVolume: number; variancePct: number | null; isOverridden: boolean; canEdit: boolean; stateLabel: "API" | "Editing" | "Manual"; }
type ChannelKey = "voice" | "email" | "chat";
type BlendPresetId = "voice-only" | "voice-email" | "voice-chat" | "email-chat" | "all-blended" | "dedicated";
interface BlendPreset { id: BlendPresetId; label: string; description: string; pools: ChannelKey[][]; }
interface PoolSummary { poolName: string; channels: ChannelKey[]; workloadHours: number; fte: number; isShared: boolean; }
interface ChannelStaffingMetrics { volume: number; workloadHours: number; staffedConcurrentAgents: number; concurrencyBuffer: number; requiredFTE: number; }
interface FutureStaffingRow extends DemandForecastData { activeBlendPreset: string; sharedPoolWorkload: number; sharedPoolFTE: number; standalonePoolFTE: number; totalRequiredFTE: number; pools: PoolSummary[]; }

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FORECAST_METHODS = [{ key: "holtwinters", label: "Holt-Winters (Triple Exponential Smoothing)" }, { key: "arima", label: "ARIMA (simplified version)" }, { key: "decomposition", label: "Decomposition (Trend + Seasonality)" }, { key: "ma", label: "Moving Average (baseline fallback)" }, { key: "genesys", label: "Direct Genesys Sync" }, { key: "yoy", label: "Year-over-Year Growth" }, { key: "regression", label: "Linear Regression" }];
const DEFAULT_ASSUMPTIONS: Assumptions = {
  startDate: "2026-01-01",
  aht: 300,
  emailAht: 600,
  chatAht: 450,
  shrinkage: 25,
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
};
const EMPTY_CHANNEL_DATA: Record<ChannelKey, number[]> = { voice: [], email: [], chat: [] };
const EMPTY_CHANNEL_OVERRIDES: Record<ChannelKey, Record<number, string>> = { voice: {}, email: {}, chat: {} };
const DEFAULT_HISTORY_MONTHS = 12;
const DEFAULT_SCENARIOS: Record<string, Scenario> = {
  base: createScenario("base", "Base Case (Steady)", buildPlannerSnapshot({ ...DEFAULT_ASSUMPTIONS }, "holtwinters", { alpha: 0.3, beta: 0.1, gamma: 0.3, seasonLength: 12 }, { p: 1, d: 1, q: 1 }, { trendStrength: 1, seasonalityStrength: 1 }, EMPTY_CHANNEL_DATA, EMPTY_CHANNEL_OVERRIDES, "all-blended", false, "voice")),
  "scenario-a": createScenario("scenario-a", "Scenario A (High Growth)", buildPlannerSnapshot({ ...DEFAULT_ASSUMPTIONS, growthRate: 15 }, "holtwinters", { alpha: 0.3, beta: 0.1, gamma: 0.3, seasonLength: 12 }, { p: 1, d: 1, q: 1 }, { trendStrength: 1, seasonalityStrength: 1 }, EMPTY_CHANNEL_DATA, EMPTY_CHANNEL_OVERRIDES, "all-blended", false, "voice")),
  "scenario-b": createScenario("scenario-b", "Scenario B (Efficiency)", buildPlannerSnapshot({ ...DEFAULT_ASSUMPTIONS, occupancy: 90, safetyMargin: 3 }, "holtwinters", { alpha: 0.3, beta: 0.1, gamma: 0.3, seasonLength: 12 }, { p: 1, d: 1, q: 1 }, { trendStrength: 1, seasonalityStrength: 1 }, EMPTY_CHANNEL_DATA, EMPTY_CHANNEL_OVERRIDES, "all-blended", false, "voice")),
};
const BLEND_PRESETS: BlendPreset[] = [
  { id: "voice-only", label: "Voice only", description: "Only voice shares the staffed pool", pools: [["voice"], ["email"], ["chat"]] },
  { id: "voice-email", label: "Voice + Email", description: "Blend voice and email; keep chat standalone", pools: [["voice", "email"], ["chat"]] },
  { id: "voice-chat", label: "Voice + Chat", description: "Blend voice and chat; keep email standalone", pools: [["voice", "chat"], ["email"]] },
  { id: "email-chat", label: "Email + Chat", description: "Blend email and chat; keep voice standalone", pools: [["email", "chat"], ["voice"]] },
  { id: "all-blended", label: "Voice + Email + Chat", description: "All selected channels share one agent pool", pools: [["voice", "email", "chat"]] },
  { id: "dedicated", label: "Dedicated per channel", description: "No channel blending across staffing pools", pools: [["voice"], ["email"], ["chat"]] },
];
const CHANNEL_VOLUME_FACTORS: Record<ChannelKey, number> = { voice: 1, email: 0.2, chat: 0.3 };
const EMAIL_AHT_SECONDS = 600;
const CHAT_AHT_SECONDS = 450;
const CHAT_CONCURRENCY = 2;
const WEEKS_PER_MONTH = 52.143 / 12;
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
const getServiceLevelBufferMultiplier = (serviceLevelPercent: number, answerSeconds: number, asaSeconds: number, ahtSeconds: number) => {
  const serviceLevelWeight = Math.max(0.15, Math.min(1.2, serviceLevelPercent / 100));
  const responsivenessWeight = Math.max(0.65, Math.min(2.5, Math.sqrt(ahtSeconds / Math.max(answerSeconds, 1))));
  const asaWeight = Math.max(0.65, Math.min(2.5, Math.sqrt(ahtSeconds / Math.max(asaSeconds, 1))));
  return serviceLevelWeight * ((responsivenessWeight + asaWeight) / 2);
};
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
const getChannelStaffingMetrics = (
  channel: ChannelKey,
  volume: number,
  workloadHours: number,
  assumptions: Assumptions,
  ahtSeconds: number,
): ChannelStaffingMetrics => {
  if (workloadHours <= 0 || volume <= 0) {
    return { volume, workloadHours, staffedConcurrentAgents: 0, concurrencyBuffer: 0, requiredFTE: 0 };
  }
  const openHoursPerMonth = getOpenHoursPerMonth(assumptions);
  const shrinkageFactor = 1 - assumptions.shrinkage / 100;
  if (openHoursPerMonth <= 0 || shrinkageFactor <= 0 || assumptions.fteMonthlyHours <= 0) {
    return { volume, workloadHours, staffedConcurrentAgents: 9999.9, concurrencyBuffer: 0, requiredFTE: 9999.9 };
  }
  let achievableOccupancyCap = 0.9;
  if (volume < 2000) achievableOccupancyCap = 0.65;
  else if (volume < 5000) achievableOccupancyCap = 0.75;
  else if (volume < 15000) achievableOccupancyCap = 0.82;
  else if (volume < 30000) achievableOccupancyCap = 0.86;
  const finalOccupancy = Math.min(assumptions.occupancy / 100, achievableOccupancyCap);
  if (finalOccupancy <= 0) {
    return { volume, workloadHours, staffedConcurrentAgents: 9999.9, concurrencyBuffer: 0, requiredFTE: 9999.9 };
  }
  const averageBusyAgentsPerOpenHour = workloadHours / openHoursPerMonth;
  const staffedConcurrentAgents = averageBusyAgentsPerOpenHour / (finalOccupancy * shrinkageFactor);
  const serviceTargets = getChannelServiceTargets(assumptions, channel);
  const serviceLevelBufferMultiplier = getServiceLevelBufferMultiplier(
    serviceTargets.slaTarget,
    serviceTargets.slaAnswerSeconds,
    serviceTargets.asaTargetSeconds,
    ahtSeconds,
  );
  const concurrencyBuffer = serviceLevelBufferMultiplier * Math.sqrt(Math.max(staffedConcurrentAgents, 1));
  let requiredFTE = ((staffedConcurrentAgents + concurrencyBuffer) * openHoursPerMonth) / assumptions.fteMonthlyHours;
  requiredFTE = requiredFTE * (1 + assumptions.safetyMargin / 100);
  return {
    volume,
    workloadHours,
    staffedConcurrentAgents: Number(staffedConcurrentAgents.toFixed(3)),
    concurrencyBuffer: Number(concurrencyBuffer.toFixed(3)),
    requiredFTE: Number(requiredFTE.toFixed(1)),
  };
};
const getAchievableOccupancyCap = (volume: number) => {
  if (volume < 2000) return 0.65;
  if (volume < 5000) return 0.75;
  if (volume < 15000) return 0.82;
  if (volume < 30000) return 0.86;
  return 0.9;
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
function cloneAssumptions(assumptions: Assumptions): Assumptions { return { ...assumptions, manualHistoricalData: [...assumptions.manualHistoricalData] }; }
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
  activeBlendPreset: BlendPresetId,
  isHistoricalSourceOpen: boolean,
  selectedHistoricalChannel: ChannelKey,
): PlannerSnapshot {
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
    activeBlendPreset,
    isHistoricalSourceOpen,
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
    selectedHistoricalChannel: snapshot.selectedHistoricalChannel,
  },
}); }
function normalizeScenario(value: unknown, fallbackId: string): Scenario | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Scenario> & { snapshot?: Partial<PlannerSnapshot> };
  const baseAssumptions = raw.assumptions ? { ...DEFAULT_ASSUMPTIONS, ...raw.assumptions, manualHistoricalData: Array.isArray(raw.assumptions.manualHistoricalData) ? [...raw.assumptions.manualHistoricalData] : [...DEFAULT_ASSUMPTIONS.manualHistoricalData] } : cloneAssumptions(DEFAULT_ASSUMPTIONS);
  const snapshot = raw.snapshot;
  return createScenario(raw.id || fallbackId, raw.name || "Scenario", {
    assumptions: snapshot?.assumptions ? { ...baseAssumptions, ...snapshot.assumptions, manualHistoricalData: Array.isArray(snapshot.assumptions.manualHistoricalData) ? [...snapshot.assumptions.manualHistoricalData] : [...baseAssumptions.manualHistoricalData] } : baseAssumptions,
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
    activeBlendPreset: normalizeBlendPreset(snapshot?.activeBlendPreset),
    isHistoricalSourceOpen: typeof snapshot?.isHistoricalSourceOpen === "boolean" ? snapshot.isHistoricalSourceOpen : false,
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
const calculateFTE = (volume: number, aht: number, assumptions: Assumptions, channel: ChannelKey = "voice") => {
  const workloadHours = (volume * aht) / 3600;
  return getChannelStaffingMetrics(channel, volume, workloadHours, assumptions, aht).requiredFTE;
};
const calculatePooledFTE = (
  workloadHours: number,
  referenceVolume: number,
  assumptions: Assumptions,
  channelMix?: Array<{ channel: ChannelKey; volume: number; workloadHours: number; ahtSeconds: number }>
) => {
  if (workloadHours === 0) return 0;
  if (channelMix && channelMix.length > 0) {
    const openHoursPerMonth = getOpenHoursPerMonth(assumptions);
    const shrinkageFactor = 1 - assumptions.shrinkage / 100;
    if (openHoursPerMonth <= 0 || assumptions.fteMonthlyHours <= 0 || shrinkageFactor <= 0) return 9999.9;
    const poolOccupancy = Math.min(assumptions.occupancy / 100, getAchievableOccupancyCap(referenceVolume));
    if (poolOccupancy <= 0) return 9999.9;
    const averageBusyAgentsPerOpenHour = workloadHours / openHoursPerMonth;
    const staffedConcurrentAgents = averageBusyAgentsPerOpenHour / (poolOccupancy * shrinkageFactor);
    const weightedTargets = channelMix.reduce((acc, entry) => {
      const weight = referenceVolume > 0 ? entry.volume / referenceVolume : 0;
      const serviceTargets = getChannelServiceTargets(assumptions, entry.channel);
      return {
        slaTarget: acc.slaTarget + (serviceTargets.slaTarget * weight),
        slaAnswerSeconds: acc.slaAnswerSeconds + (serviceTargets.slaAnswerSeconds * weight),
        asaTargetSeconds: acc.asaTargetSeconds + (serviceTargets.asaTargetSeconds * weight),
        ahtSeconds: acc.ahtSeconds + (entry.ahtSeconds * weight),
      };
    }, { slaTarget: 0, slaAnswerSeconds: 0, asaTargetSeconds: 0, ahtSeconds: 0 });
    const serviceLevelBufferMultiplier = getServiceLevelBufferMultiplier(
      weightedTargets.slaTarget,
      weightedTargets.slaAnswerSeconds,
      weightedTargets.asaTargetSeconds,
      weightedTargets.ahtSeconds || assumptions.aht,
    );
    const concurrencyBuffer = serviceLevelBufferMultiplier * Math.sqrt(Math.max(staffedConcurrentAgents, 1));
    let pooledFTE = ((staffedConcurrentAgents + concurrencyBuffer) * openHoursPerMonth) / assumptions.fteMonthlyHours;
    pooledFTE = pooledFTE * (1 + assumptions.safetyMargin / 100);
    return Number(pooledFTE.toFixed(1));
  }
  const pooledAhtSeconds = referenceVolume > 0 ? (workloadHours * 3600) / referenceVolume : assumptions.aht;
  return getChannelStaffingMetrics("voice", referenceVolume, workloadHours, assumptions, pooledAhtSeconds).requiredFTE;
};
const getCalculatedVolumes = (data: number[], forecastMethod: string, assumptions: Assumptions, hwParams: { alpha: number; beta: number; gamma: number; seasonLength: number }, arimaParams: { p: number; d: number; q: number }, decompParams: { trendStrength: number; seasonalityStrength: number }) => {
  if (data.length === 0) return Array(12).fill(0);
  switch (forecastMethod) {
    case "yoy": return calculateYoY(data.slice(-12), assumptions.growthRate);
    case "ma": return calculateMovingAverage(data, 3);
    case "regression": return calculateLinearRegression(data);
    case "holtwinters": return calculateHoltWinters(data, hwParams.alpha, hwParams.beta, hwParams.gamma, hwParams.seasonLength);
    case "decomposition": return calculateDecomposition(data, decompParams.trendStrength, decompParams.seasonalityStrength);
    case "arima": return calculateARIMA(data, arimaParams.p, arimaParams.d, arimaParams.q);
    case "genesys":
    default: return data.slice(-12);
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
      workloadHours: Number(((volume * assumptions.aht) / 3600).toFixed(1)),
      aht: assumptions.aht,
      occupancy: assumptions.occupancy,
      shrinkage: assumptions.shrinkage,
      requiredFTE: calculateFTE(volume, assumptions.aht, assumptions, "voice"),
      actualVolume: historicalVolume,
      forecastVolume,
      historicalVolume: historicalVolume ?? 0,
    };
  });
};

export default function LongTermForecastingDemand() {
  const [isAssumptionsOpen, setIsAssumptionsOpen] = useState(true);
  const [isHistoricalSourceOpen, setIsHistoricalSourceOpen] = useState(false);
  const [activeBlendPreset, setActiveBlendPreset] = useState<BlendPresetId>("all-blended");
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
  const getCurrentPlannerSnapshot = () => buildPlannerSnapshot(assumptions, forecastMethod, hwParams, arimaParams, decompParams, historicalApiDataByChannel, historicalOverridesByChannel, activeBlendPreset, isHistoricalSourceOpen, historicalChannelView);
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
    setActiveBlendPreset(snapshot.activeBlendPreset);
    setIsHistoricalSourceOpen(snapshot.isHistoricalSourceOpen);
    setHistoricalChannelView(snapshot.selectedHistoricalChannel || "voice");
  };

  useEffect(() => {
    let nextScenarios = DEFAULT_SCENARIOS;
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
    setScenarios(nextScenarios);
    try {
      const savedInputs = localStorage.getItem(USER_INPUTS_STORAGE_KEY);
      if (savedInputs) {
        const parsed = JSON.parse(savedInputs) as { selectedScenarioId?: string; plannerSnapshot?: Partial<PlannerSnapshot> };
        const nextSelectedScenarioId = parsed.selectedScenarioId && nextScenarios[parsed.selectedScenarioId] ? parsed.selectedScenarioId : Object.keys(nextScenarios)[0] || "base";
        setSelectedScenarioId(nextSelectedScenarioId);
        const fallbackSnapshot = nextScenarios[nextSelectedScenarioId]?.snapshot;
        if (parsed.plannerSnapshot) {
          applyPlannerSnapshot(normalizeScenario({ id: nextSelectedScenarioId, name: nextScenarios[nextSelectedScenarioId]?.name || "Scenario", assumptions: fallbackSnapshot?.assumptions || DEFAULT_ASSUMPTIONS, snapshot: parsed.plannerSnapshot }, nextSelectedScenarioId)?.snapshot || fallbackSnapshot || getCurrentPlannerSnapshot());
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
  }, []);
  useEffect(() => {
    if (!hasHydratedRef.current) return;
    localStorage.setItem(USER_INPUTS_STORAGE_KEY, JSON.stringify({
      selectedScenarioId,
      plannerSnapshot: getCurrentPlannerSnapshot(),
    }));
  }, [assumptions, forecastMethod, hwParams, arimaParams, decompParams, historicalApiDataByChannel, historicalOverridesByChannel, activeBlendPreset, isHistoricalSourceOpen, historicalChannelView, selectedScenarioId]);
  useEffect(() => {
    const fetchMockData = async () => {
      setLoading(true);
      try {
        const channels: ChannelKey[] = ["voice", "email", "chat"];
        const results = await Promise.all(channels.map(async (channel) => {
          const response = await fetch("http://localhost:5000/api/genesys/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queueId: "mock-queue-id", channel, interval: `${assumptions.startDate}/2030-12-31` }) });
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
    fetchMockData();
  }, [assumptions.startDate]);

  const saveScenariosToStorage = (updated: Record<string, Scenario>) => localStorage.setItem(SCENARIOS_STORAGE_KEY, JSON.stringify(updated));
  const handleScenarioChange = (nextScenarioId: string) => {
    const scenario = scenarios[nextScenarioId];
    if (!scenario) return;
    setSelectedScenarioId(nextScenarioId);
    applyPlannerSnapshot(scenario.snapshot);
  };
  const handleSaveScenario = () => {
    const id = activeScenario?.id || "base";
    const existing = scenarios[id];
    const snapshot = getCurrentPlannerSnapshot();
    const updatedScenario = createScenario(id, existing?.name || activeScenario?.name || "Scenario", snapshot);
    const updated = { ...scenarios, [id]: updatedScenario };
    setScenarios(updated);
    saveScenariosToStorage(updated);
    setSelectedScenarioId(id);
    toast.success("Scenario saved successfully");
  };
  const handleDeleteScenario = (event: React.MouseEvent, id: string) => {
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
    toast.success("Scenario deleted");
  };
  const handleNewScenario = () => {
    const id = `scenario-${Date.now()}`;
    const snapshot = getCurrentPlannerSnapshot();
    const updated = { ...scenarios, [id]: createScenario(id, `New Scenario ${Object.keys(scenarios).length + 1}`, snapshot) };
    setScenarios(updated);
    saveScenariosToStorage(updated);
    setSelectedScenarioId(id);
    toast.success("New scenario created");
  };
  const handleRenameScenario = () => {
    if (!activeScenario) return;
    const nextName = window.prompt("Rename scenario:", activeScenario.name);
    if (!nextName || nextName.trim() === "" || nextName.trim() === activeScenario.name) return;
    const updated = {
      ...scenarios,
      [activeScenario.id]: createScenario(activeScenario.id, nextName.trim(), activeScenario.snapshot),
    };
    setScenarios(updated);
    saveScenariosToStorage(updated);
    toast.success("Scenario renamed");
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
  // Per-channel 12-month forecast volumes — uses each channel's own history when available
  const forecastVolumesByChannel = useMemo<Record<ChannelKey, number[]>>(() => {
    const voiceForecast = getCalculatedVolumes(finalHistoricalDataByChannel.voice, forecastMethod, assumptions, hwParams, arimaParams, decompParams);
    const emailHistory = finalHistoricalDataByChannel.email;
    const chatHistory = finalHistoricalDataByChannel.chat;
    const emailForecast = emailHistory.length > 0
      ? getCalculatedVolumes(emailHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
      : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.email));
    const chatForecast = chatHistory.length > 0
      ? getCalculatedVolumes(chatHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
      : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.chat));
    return { voice: voiceForecast, email: emailForecast, chat: chatForecast };
  }, [finalHistoricalDataByChannel, forecastMethod, assumptions, hwParams, arimaParams, decompParams]);
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
  const volumeTrendChartData = useMemo(() => forecastData.map((row) => ({
    label: `${row.month} '${row.year.slice(2)}`,
    actualVolume: row.actualVolume,
    forecastVolume: row.forecastVolume,
  })), [forecastData]);
  const selectedBlendPreset = useMemo(() => BLEND_PRESETS.find((preset) => preset.id === activeBlendPreset) || BLEND_PRESETS[4], [activeBlendPreset]);
  const futureData = useMemo<FutureStaffingRow[]>(() => forecastData.filter((row) => row.isFuture).map((row, futureIdx) => {
    const emailForecastVol = forecastVolumesByChannel.email[futureIdx] ?? Math.round(row.volume * CHANNEL_VOLUME_FACTORS.email);
    const chatForecastVol = forecastVolumesByChannel.chat[futureIdx] ?? Math.round(row.volume * CHANNEL_VOLUME_FACTORS.chat);
    const channelMetrics: Record<ChannelKey, { volume: number; workloadHours: number }> = {
      voice: { volume: row.volume, workloadHours: row.workloadHours },
      email: { volume: emailForecastVol, workloadHours: Number(((emailForecastVol * assumptions.emailAht) / 3600).toFixed(1)) },
      chat: { volume: chatForecastVol, workloadHours: Number((((chatForecastVol * assumptions.chatAht) / 3600) / CHAT_CONCURRENCY).toFixed(1)) },
    };
    const pools = selectedBlendPreset.pools.map((channels, index) => {
      const workloadHours = Number(channels.reduce((sum, channel) => sum + channelMetrics[channel].workloadHours, 0).toFixed(1));
      const referenceVolume = channels.reduce((sum, channel) => sum + channelMetrics[channel].volume, 0);
      const channelMix = channels.map((channel) => ({
        channel,
        volume: channelMetrics[channel].volume,
        workloadHours: channelMetrics[channel].workloadHours,
        ahtSeconds: channel === "voice" ? assumptions.aht : channel === "email" ? assumptions.emailAht : assumptions.chatAht / CHAT_CONCURRENCY,
      }));
      return { poolName: `Pool ${String.fromCharCode(65 + index)}`, channels, workloadHours, fte: calculatePooledFTE(workloadHours, referenceVolume, assumptions, channelMix), isShared: channels.length > 1 };
    });
    const sharedPools = pools.filter((pool) => pool.isShared);
    const standalonePools = pools.filter((pool) => !pool.isShared);
    return {
      ...row,
      activeBlendPreset: selectedBlendPreset.label,
      sharedPoolWorkload: Number(sharedPools.reduce((sum, pool) => sum + pool.workloadHours, 0).toFixed(1)),
      sharedPoolFTE: Number(sharedPools.reduce((sum, pool) => sum + pool.fte, 0).toFixed(1)),
      standalonePoolFTE: Number(standalonePools.reduce((sum, pool) => sum + pool.fte, 0).toFixed(1)),
      totalRequiredFTE: Number(pools.reduce((sum, pool) => sum + pool.fte, 0).toFixed(1)),
      pools,
    };
  }), [forecastData, forecastVolumesByChannel, selectedBlendPreset, assumptions]);
  const kpis = useMemo(() => futureData.length === 0 ? { avgVolume: 0, avgWorkloadHours: 0, avgRequiredFTE: 0 } : ({
    avgVolume: Math.round(futureData.reduce((sum, row) => sum + row.volume, 0) / futureData.length),
    avgWorkloadHours: Number((futureData.reduce((sum, row) => sum + row.workloadHours, 0) / futureData.length).toFixed(1)),
    avgRequiredFTE: Number((futureData.reduce((sum, row) => sum + row.totalRequiredFTE, 0) / futureData.length).toFixed(1)),
  }), [futureData]);
  const pooledWorkloadChartData = useMemo(() => futureData.map((row) => {
    const point: Record<string, string | number> = {
      label: `${row.month} '${row.year.slice(2)}`,
      totalWorkloadHours: row.workloadHours,
    };
    row.pools.forEach((pool, index) => {
      point[`pool${index + 1}`] = pool.workloadHours;
    });
    return point;
  }), [futureData]);
  const seasonalityTrend = useMemo(() => {
    if (futureData.length === 0) return [];
    const average = futureData.reduce((sum, row) => sum + row.volume, 0) / futureData.length;
    return futureData.map((row) => ({ label: `${row.month} '${row.year.slice(2)}`, seasonalityIndex: average === 0 ? 0 : Number(((row.volume / average) * 100).toFixed(1)) }));
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
      const activeBlendPresetId = scenario.id === selectedScenarioId ? activeBlendPreset : snap.activeBlendPreset;
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
      const snapBlendPreset = BLEND_PRESETS.find((p) => p.id === activeBlendPresetId) ?? selectedBlendPreset;
      const snapEmailAht = activeAssumptions.emailAht ?? EMAIL_AHT_SECONDS;
      const snapChatAht = activeAssumptions.chatAht ?? CHAT_AHT_SECONDS;
      const forecast = buildDemandForecastData(snapVoiceHistory, activeAssumptions, activeForecastMethod, activeHwParams, activeArimaParams, activeDecompParams)
        .filter((row) => row.isFuture)
        .map((row, fi) => {
          const emailVol = emailForecast[fi] ?? Math.round(row.volume * CHANNEL_VOLUME_FACTORS.email);
          const chatVol = chatForecast[fi] ?? Math.round(row.volume * CHANNEL_VOLUME_FACTORS.chat);
          const channelMetrics: Record<ChannelKey, { volume: number; workloadHours: number }> = {
            voice: { volume: row.volume, workloadHours: row.workloadHours },
            email: { volume: emailVol, workloadHours: Number(((emailVol * snapEmailAht) / 3600).toFixed(1)) },
            chat: { volume: chatVol, workloadHours: Number((((chatVol * snapChatAht) / 3600) / CHAT_CONCURRENCY).toFixed(1)) },
          };
          const totalRequiredFTE = snapBlendPreset.pools.reduce((sum, channels) => {
            const workloadHours = channels.reduce((poolSum, ch) => poolSum + channelMetrics[ch].workloadHours, 0);
            const referenceVolume = channels.reduce((poolSum, ch) => poolSum + channelMetrics[ch].volume, 0);
            const channelMix = channels.map((ch) => ({
              channel: ch,
              volume: channelMetrics[ch].volume,
              workloadHours: channelMetrics[ch].workloadHours,
              ahtSeconds: ch === "voice" ? activeAssumptions.aht : ch === "email" ? snapEmailAht : snapChatAht / CHAT_CONCURRENCY,
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
  }, [scenarios, selectedScenarioId, assumptions, forecastMethod, hwParams, arimaParams, decompParams, activeBlendPreset, historicalOverridesByChannel, historicalApiDataByChannel, finalHistoricalData, selectedBlendPreset]);
  const scenarioColors = ["#2563eb", "#f59e0b", "#10b981", "#7c3aed", "#ef4444", "#0f766e"];
  const poolExplainability = useMemo(() => selectedBlendPreset.pools.map((channels, index) => ({
    poolName: `Pool ${String.fromCharCode(65 + index)}`,
    channels,
    averageWorkload: futureData.length > 0 ? Number((futureData.reduce((sum, row) => sum + (row.pools[index]?.workloadHours ?? 0), 0) / futureData.length).toFixed(1)) : 0,
    averageFTE: futureData.length > 0 ? Number((futureData.reduce((sum, row) => sum + (row.pools[index]?.fte ?? 0), 0) / futureData.length).toFixed(1)) : 0,
    isShared: channels.length > 1,
  })), [futureData, selectedBlendPreset]);
  const channelAssumptionSummary = useMemo(() => [
    {
      key: "voice" as const,
      label: CHANNEL_ASSUMPTION_META.voice.label,
      volumeRule: "100% of omni forecast volume",
      ahtRule: `${assumptions.aht}s AHT`,
      serviceRule: `${assumptions.voiceSlaTarget}% in ${assumptions.voiceSlaAnswerSeconds}s, ASA ${assumptions.voiceAsaTargetSeconds}s`,
      workloadRule: "Volume x AHT / 3600",
    },
    {
      key: "email" as const,
      label: CHANNEL_ASSUMPTION_META.email.label,
      volumeRule: "20% of omni forecast volume",
      ahtRule: `${assumptions.emailAht}s AHT`,
      serviceRule: `${assumptions.emailSlaTarget}% in ${assumptions.emailSlaAnswerSeconds}s, ASA ${assumptions.emailAsaTargetSeconds}s`,
      workloadRule: "Volume x AHT / 3600",
    },
    {
      key: "chat" as const,
      label: CHANNEL_ASSUMPTION_META.chat.label,
      volumeRule: "30% of omni forecast volume",
      ahtRule: `${assumptions.chatAht}s AHT`,
      serviceRule: `${assumptions.chatSlaTarget}% in ${assumptions.chatSlaAnswerSeconds}s, ASA ${assumptions.chatAsaTargetSeconds}s`,
      workloadRule: `Volume x AHT / 3600 / ${CHAT_CONCURRENCY} concurrency`,
    },
  ], [assumptions.aht, assumptions.emailAht, assumptions.chatAht, assumptions.voiceSlaTarget, assumptions.voiceSlaAnswerSeconds, assumptions.voiceAsaTargetSeconds, assumptions.emailSlaTarget, assumptions.emailSlaAnswerSeconds, assumptions.emailAsaTargetSeconds, assumptions.chatSlaTarget, assumptions.chatSlaAnswerSeconds, assumptions.chatAsaTargetSeconds]);
  const openHoursPerMonth = useMemo(() => Number(getOpenHoursPerMonth(assumptions).toFixed(1)), [assumptions]);

  if (loading) return <PageLayout title="Long Term Forecasting  Demand"><div className="h-[60vh] flex flex-col items-center justify-center gap-4"><Loader2 className="size-12 text-primary animate-spin" /><p className="text-muted-foreground font-medium">Loading demand forecast data...</p></div></PageLayout>;

  return (
    <TooltipProvider>
      <PageLayout title="Long Term Forecasting  Demand">
        <div className="flex flex-col gap-8 pb-12">
          <p className="-mt-6 text-sm text-muted-foreground">Forecasted monthly demand volumes and required staffing only</p>
          <div className="sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 -mx-4 px-4 py-4 space-y-4 border-b border-border shadow-sm">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-black uppercase text-muted-foreground tracking-widest">Active Planning Scenario</Label>
                  <Select value={selectedScenarioId} onValueChange={handleScenarioChange}>
                    <SelectTrigger className="w-[220px] h-10 border-primary/20 bg-primary/5 font-bold text-primary focus:ring-primary/20"><span className="truncate">{scenarios[selectedScenarioId]?.name || "Select Scenario"}</span></SelectTrigger>
                    <SelectContent>{Object.values(scenarios).map((scenario) => <SelectItem key={scenario.id} value={scenario.id} className="font-medium group"><div className="flex items-center justify-between w-full min-w-[200px] gap-2"><span className="truncate">{scenario.name}</span>{scenario.id !== "base" && <div role="button" className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-all shrink-0 z-50" onClick={(event) => handleDeleteScenario(event, scenario.id)} title="Delete Scenario"><Trash2 className="size-3.5" /></div>}</div></SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" className="h-10 mt-5 gap-2 font-semibold border-dashed hover:border-primary hover:text-primary transition-all" onClick={handleNewScenario}><Plus className="size-4" />New Scenario</Button>
                <Button variant="outline" size="sm" className="h-10 mt-5 gap-2 font-semibold" onClick={handleRenameScenario}><Save className="size-4" />Rename</Button>
              </div>
              <div className="flex items-center gap-3 mt-5">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="h-10 gap-2">
                      <CircleHelp className="size-4" />
                      Help
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Long Term Forecasting Demand Guide</DialogTitle>
                      <DialogDescription>
                        Use this guide to understand the page inputs, blended staffing logic, and required FTE outputs.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" className="gap-2" onClick={handlePrintQuickGuide}>
                        <Info className="size-4" />
                        Print Planner Quick Guide
                      </Button>
                    </div>
                    <div className="space-y-6">
                      {demandForecastHelpSections.map((section) => (
                        <section key={section.title} className="space-y-3">
                          <h3 className="text-sm font-black uppercase tracking-widest text-foreground">{section.title}</h3>
                          <ul className="space-y-2 text-sm text-muted-foreground">
                            {section.points.map((point) => (
                              <li key={point} className="flex items-start gap-2">
                                <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
                                <span>{point}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  </DialogContent>
                </Dialog>
                <Button variant="default" size="sm" className="h-10 gap-2 px-6 font-bold shadow-lg shadow-primary/20" onClick={handleSaveScenario}><Save className="size-4" />Save Scenario</Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card className="bg-slate-50 dark:bg-slate-900 border-none shadow-none rounded-lg"><CardContent className="p-4 flex items-center gap-4"><div className="p-2 bg-primary/10 rounded-lg"><TrendingUp className="size-5 text-primary" /></div><div><p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Forecasted Monthly Volume</p><h3 className="text-lg font-black tracking-tight">{kpis.avgVolume.toLocaleString()}</h3><p className="text-xs text-muted-foreground">Average across forecast horizon</p></div></CardContent></Card>
              <Card className="bg-slate-50 dark:bg-slate-900 border-none shadow-none rounded-lg"><CardContent className="p-4 flex items-center gap-4"><div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg"><Clock className="size-5 text-indigo-600 dark:text-indigo-400" /></div><div><p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Workload Hours</p><h3 className="text-lg font-black tracking-tight">{kpis.avgWorkloadHours.toLocaleString()}</h3><p className="text-xs text-muted-foreground">Average monthly workload requirement</p></div></CardContent></Card>
              <Card className="bg-slate-50 dark:bg-slate-900 border-none shadow-none rounded-lg"><CardContent className="p-4 flex items-center gap-4"><div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-lg"><Users className="size-5 text-amber-600 dark:text-amber-400" /></div><div><p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Required Agents / FTE</p><h3 className="text-lg font-black tracking-tight">{kpis.avgRequiredFTE}</h3><p className="text-xs text-muted-foreground">Average monthly staffing requirement</p></div></CardContent></Card>
            </div>
          </div>
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
          <Card className="border border-border/60 shadow-sm">
            <CardHeader className="border-b border-border/50 bg-slate-50/50">
              <CardTitle className="text-base font-black uppercase tracking-widest">Blended Channel Staffing</CardTitle>
              <p className="text-sm text-muted-foreground">Choose which channels share the same agent pool for required FTE aggregation.</p>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {BLEND_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setActiveBlendPreset(preset.id)}
                    className={`text-left rounded-xl border p-4 transition-all ${preset.id === activeBlendPreset ? "border-primary bg-primary/5 shadow-md" : "border-border hover:border-primary/40 hover:bg-slate-50/70"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-black text-sm uppercase tracking-wide">{preset.label}</span>
                      {preset.id === activeBlendPreset && <Badge className="bg-primary">Active</Badge>}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{preset.description}</p>
                  </button>
                ))}
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
              <Card className="border border-border/60 shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-black uppercase tracking-widest">Channel Workload Assumptions</CardTitle>
                  <p className="text-sm text-muted-foreground">These assumptions explain what each channel contributes before workload is pooled into shared staffing groups.</p>
                </CardHeader>
                <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  {channelAssumptionSummary.map((channel) => (
                    <div key={channel.key} className={`rounded-lg border border-border/50 p-4 ${CHANNEL_ASSUMPTION_META[channel.key].bgClass}`}>
                      <div className="flex items-center justify-between gap-3">
                        <p className={`text-sm font-black uppercase tracking-widest ${CHANNEL_ASSUMPTION_META[channel.key].colorClass}`}>{channel.label}</p>
                        <Badge variant="outline">{selectedBlendPreset.pools.some((pool) => pool.includes(channel.key)) ? "Included" : "Excluded"}</Badge>
                      </div>
                      <div className="mt-3 space-y-2 text-sm">
                        <p><span className="font-semibold">Volume:</span> {channel.volumeRule}</p>
                        <p><span className="font-semibold">AHT:</span> {channel.ahtRule}</p>
                        <p><span className="font-semibold">SLA / ASA:</span> {channel.serviceRule}</p>
                        <p><span className="font-semibold">Workload:</span> {channel.workloadRule}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
            <div className="space-y-6">
              <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
                <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-slate-50/30"><CardTitle className="text-base font-black uppercase tracking-widest">Monthly Volume Trend</CardTitle></CardHeader><CardContent className="p-6 h-[340px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={volumeTrendChartData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickLine={false} axisLine={false} /><Tooltip formatter={(value) => value == null ? "-" : Number(value).toLocaleString()} /><Legend /><Line type="linear" dataKey="actualVolume" name="Actual Historical" stroke="#94a3b8" strokeWidth={3} dot={{ r: 2, fill: "#cbd5e1", stroke: "#94a3b8" }} activeDot={{ r: 5, fill: "#94a3b8", stroke: "#ffffff", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} /><Line type="linear" dataKey="forecastVolume" name="Forecast" stroke="#2563eb" strokeWidth={3} strokeDasharray="8 5" dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></CardContent></Card>
                <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-slate-50/30"><CardTitle className="text-base font-black uppercase tracking-widest">Workload Trend</CardTitle><p className="text-sm text-muted-foreground">Pool workloads update with the active blend preset.</p></CardHeader><CardContent className="p-6 h-[340px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={pooledWorkloadChartData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Legend />{selectedBlendPreset.pools.map((_, index) => <Line key={`pool${index + 1}`} type="monotone" dataKey={`pool${index + 1}`} name={`Pool ${String.fromCharCode(65 + index)} Workload`} stroke={["#4f46e5", "#0f766e", "#dc2626"][index % 3]} strokeWidth={3} />)}<Line type="monotone" dataKey="totalWorkloadHours" name="Total Workload" stroke="#94a3b8" strokeDasharray="6 4" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></CardContent></Card>
                <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-slate-50/30"><CardTitle className="text-base font-black uppercase tracking-widest">Required Staffing Trend</CardTitle><p className="text-sm text-muted-foreground">Shared pools recalculate FTE from pooled workload, weighted service targets, and the active blend preset.</p></CardHeader><CardContent className="p-6 h-[340px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={futureData.map((row) => ({ label: `${row.month} '${row.year.slice(2)}`, totalRequiredFTE: row.totalRequiredFTE, sharedPoolFTE: row.sharedPoolFTE, standalonePoolFTE: row.standalonePoolFTE }))}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Legend /><Line type="monotone" dataKey="sharedPoolFTE" name="Shared Pool FTE" stroke="#0f766e" strokeWidth={3} /><Line type="monotone" dataKey="standalonePoolFTE" name="Standalone Pool FTE" stroke="#2563eb" strokeWidth={3} /><Line type="monotone" dataKey="totalRequiredFTE" name="Total Required FTE" stroke="#f59e0b" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></CardContent></Card>
                <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-slate-50/30"><CardTitle className="text-base font-black uppercase tracking-widest">Seasonality Trend</CardTitle></CardHeader><CardContent className="p-6 h-[340px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={seasonalityTrend}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Legend /><Bar dataKey="seasonalityIndex" name="Seasonality Index" fill="#0f766e" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></CardContent></Card>
              </div>
              <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-slate-50/30"><CardTitle className="text-base font-black uppercase tracking-widest">Scenario Comparison For Required FTE</CardTitle></CardHeader><CardContent className="p-6 h-[360px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={scenarioComparisonData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="month" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Legend />{Object.values(scenarios).map((scenario, index) => <Line key={scenario.id} type="monotone" dataKey={scenario.id} name={scenario.name} stroke={scenarioColors[index % scenarioColors.length]} strokeWidth={scenario.id === selectedScenarioId ? 3.5 : 2} dot={false} />)}</LineChart></ResponsiveContainer></CardContent></Card>
              <Card className="border border-border/50 shadow-md"><CardHeader className="border-b border-border/50 bg-slate-50/30"><CardTitle className="text-base font-black uppercase tracking-widest">Demand Forecast Detail</CardTitle></CardHeader><CardContent className="p-0 overflow-x-auto"><Table><TableHeader className="bg-slate-50/80 dark:bg-slate-900/80"><TableRow className="hover:bg-transparent"><TableHead className="pl-6 text-sm font-black uppercase tracking-widest">Month</TableHead><TableHead className="text-right text-sm font-black uppercase tracking-widest">Forecast Volume</TableHead><TableHead className="text-right text-sm font-black uppercase tracking-widest">Forecast Workload Hours</TableHead><TableHead className="text-right text-sm font-black uppercase tracking-widest">AHT</TableHead><TableHead className="text-right text-sm font-black uppercase tracking-widest">Occupancy</TableHead><TableHead className="text-right text-sm font-black uppercase tracking-widest">Shrinkage</TableHead><TableHead className="text-right text-sm font-black uppercase tracking-widest">Active Blend Preset</TableHead><TableHead className="text-right text-sm font-black uppercase tracking-widest">Shared Pool Workload</TableHead><TableHead className="text-right text-sm font-black uppercase tracking-widest">Shared Pool FTE</TableHead><TableHead className="text-right text-sm font-black uppercase tracking-widest">Standalone Pool FTE</TableHead><TableHead className="pr-6 text-right text-sm font-black uppercase tracking-widest">Total Required FTE</TableHead></TableRow></TableHeader><TableBody>{futureData.map((row) => <TableRow key={`${row.year}-${row.month}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50"><TableCell className="pl-6 font-bold text-sm">{row.month} {row.year}</TableCell><TableCell className="text-right font-mono text-sm font-bold text-primary">{row.volume.toLocaleString()}</TableCell><TableCell className="text-right font-mono text-sm text-indigo-600">{row.workloadHours.toLocaleString()}</TableCell><TableCell className="text-right font-mono text-sm">{row.aht}s</TableCell><TableCell className="text-right font-mono text-sm">{row.occupancy}%</TableCell><TableCell className="text-right font-mono text-sm">{row.shrinkage}%</TableCell><TableCell className="text-right text-sm">{row.activeBlendPreset}</TableCell><TableCell className="text-right font-mono text-sm">{row.sharedPoolWorkload > 0 ? row.sharedPoolWorkload.toLocaleString() : "-"}</TableCell><TableCell className="text-right font-mono text-sm">{row.sharedPoolFTE > 0 ? row.sharedPoolFTE.toLocaleString() : "-"}</TableCell><TableCell className="text-right font-mono text-sm">{row.standalonePoolFTE > 0 ? row.standalonePoolFTE.toLocaleString() : "-"}</TableCell><TableCell className="pr-6 text-right font-mono text-sm font-bold text-amber-600">{row.totalRequiredFTE}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
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
                  <div className="space-y-3"><div className="flex items-center justify-between"><div className="flex items-center gap-1"><Label htmlFor="shrinkage" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Shrinkage</Label><UITooltip><TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-xs">Demand staffing shrinkage assumption</p></TooltipContent></UITooltip></div><span className="text-xs font-black bg-rose-50 dark:bg-rose-900/20 px-2 py-1 rounded text-rose-600">{assumptions.shrinkage}%</span></div><Input id="shrinkage" type="number" value={assumptions.shrinkage} onChange={(event) => setAssumptions({ ...assumptions, shrinkage: validateInput(Number(event.target.value), 0, 100) })} className="h-10 font-bold" /></div>
                  <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="occupancy" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Occupancy</Label><span className="text-xs font-black bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded text-indigo-600">{assumptions.occupancy}%</span></div><Input id="occupancy" type="number" value={assumptions.occupancy} onChange={(event) => setAssumptions({ ...assumptions, occupancy: validateInput(Number(event.target.value), 0, 100) })} className="h-10 font-bold" /></div>
                  <div className="space-y-4 rounded-xl border border-border/60 p-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Voice SLA / ASA</p>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="voiceSlaTarget" className="text-xs font-black uppercase tracking-widest text-muted-foreground">SLA %</Label><Badge variant="outline" className="font-black text-xs text-primary border-primary/20">{assumptions.voiceSlaTarget}%</Badge></div><Input id="voiceSlaTarget" type="number" value={assumptions.voiceSlaTarget} onChange={(event) => setAssumptions({ ...assumptions, voiceSlaTarget: validateInput(Number(event.target.value), 1, 100) })} className="h-10 font-bold" /></div>
                      <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="voiceSlaAnswerSeconds" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Within Sec</Label><span className="text-xs font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-700 dark:text-slate-200">{assumptions.voiceSlaAnswerSeconds}s</span></div><Input id="voiceSlaAnswerSeconds" type="number" value={assumptions.voiceSlaAnswerSeconds} onChange={(event) => setAssumptions({ ...assumptions, voiceSlaAnswerSeconds: validateInput(Number(event.target.value), 1, 3600) })} className="h-10 font-bold" /></div>
                      <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="voiceAsaTargetSeconds" className="text-xs font-black uppercase tracking-widest text-muted-foreground">ASA Sec</Label><span className="text-xs font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-700 dark:text-slate-200">{assumptions.voiceAsaTargetSeconds}s</span></div><Input id="voiceAsaTargetSeconds" type="number" value={assumptions.voiceAsaTargetSeconds} onChange={(event) => setAssumptions({ ...assumptions, voiceAsaTargetSeconds: validateInput(Number(event.target.value), 1, 3600) })} className="h-10 font-bold" /></div>
                    </div>
                  </div>
                  <div className="space-y-4 rounded-xl border border-border/60 p-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Email SLA / ASA</p>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="emailSlaTarget" className="text-xs font-black uppercase tracking-widest text-muted-foreground">SLA %</Label><Badge variant="outline" className="font-black text-xs text-primary border-primary/20">{assumptions.emailSlaTarget}%</Badge></div><Input id="emailSlaTarget" type="number" value={assumptions.emailSlaTarget} onChange={(event) => setAssumptions({ ...assumptions, emailSlaTarget: validateInput(Number(event.target.value), 1, 100) })} className="h-10 font-bold" /></div>
                      <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="emailSlaAnswerSeconds" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Within Sec</Label><span className="text-xs font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-700 dark:text-slate-200">{assumptions.emailSlaAnswerSeconds}s</span></div><Input id="emailSlaAnswerSeconds" type="number" value={assumptions.emailSlaAnswerSeconds} onChange={(event) => setAssumptions({ ...assumptions, emailSlaAnswerSeconds: validateInput(Number(event.target.value), 1, 86400) })} className="h-10 font-bold" /></div>
                      <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="emailAsaTargetSeconds" className="text-xs font-black uppercase tracking-widest text-muted-foreground">ASA Sec</Label><span className="text-xs font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-700 dark:text-slate-200">{assumptions.emailAsaTargetSeconds}s</span></div><Input id="emailAsaTargetSeconds" type="number" value={assumptions.emailAsaTargetSeconds} onChange={(event) => setAssumptions({ ...assumptions, emailAsaTargetSeconds: validateInput(Number(event.target.value), 1, 86400) })} className="h-10 font-bold" /></div>
                    </div>
                  </div>
                  <div className="space-y-4 rounded-xl border border-border/60 p-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Chat SLA / ASA</p>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="chatSlaTarget" className="text-xs font-black uppercase tracking-widest text-muted-foreground">SLA %</Label><Badge variant="outline" className="font-black text-xs text-primary border-primary/20">{assumptions.chatSlaTarget}%</Badge></div><Input id="chatSlaTarget" type="number" value={assumptions.chatSlaTarget} onChange={(event) => setAssumptions({ ...assumptions, chatSlaTarget: validateInput(Number(event.target.value), 1, 100) })} className="h-10 font-bold" /></div>
                      <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="chatSlaAnswerSeconds" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Within Sec</Label><span className="text-xs font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-700 dark:text-slate-200">{assumptions.chatSlaAnswerSeconds}s</span></div><Input id="chatSlaAnswerSeconds" type="number" value={assumptions.chatSlaAnswerSeconds} onChange={(event) => setAssumptions({ ...assumptions, chatSlaAnswerSeconds: validateInput(Number(event.target.value), 1, 3600) })} className="h-10 font-bold" /></div>
                      <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="chatAsaTargetSeconds" className="text-xs font-black uppercase tracking-widest text-muted-foreground">ASA Sec</Label><span className="text-xs font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-700 dark:text-slate-200">{assumptions.chatAsaTargetSeconds}s</span></div><Input id="chatAsaTargetSeconds" type="number" value={assumptions.chatAsaTargetSeconds} onChange={(event) => setAssumptions({ ...assumptions, chatAsaTargetSeconds: validateInput(Number(event.target.value), 1, 3600) })} className="h-10 font-bold" /></div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="operatingHoursPerDay" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Hours Per Day</Label><span className="text-xs font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-700 dark:text-slate-200">{assumptions.operatingHoursPerDay}</span></div><Input id="operatingHoursPerDay" type="number" step="0.5" value={assumptions.operatingHoursPerDay} onChange={(event) => setAssumptions({ ...assumptions, operatingHoursPerDay: validateInput(Number(event.target.value), 0.5, 24) })} className="h-10 font-bold" /></div>
                    <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="operatingDaysPerWeek" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Days Per Week</Label><span className="text-xs font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-700 dark:text-slate-200">{assumptions.operatingDaysPerWeek}</span></div><Input id="operatingDaysPerWeek" type="number" step="0.5" value={assumptions.operatingDaysPerWeek} onChange={(event) => setAssumptions({ ...assumptions, operatingDaysPerWeek: validateInput(Number(event.target.value), 0.5, 7) })} className="h-10 font-bold" /></div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-slate-50/70 px-3 py-2 text-xs text-muted-foreground">
                    Operating window: <span className="font-bold text-foreground">{assumptions.operatingHoursPerDay}h/day x {assumptions.operatingDaysPerWeek}d/week</span> = <span className="font-bold text-foreground">{openHoursPerMonth}</span> open hours/month
                  </div>
                  <div className="space-y-3"><div className="flex items-center justify-between"><div className="flex items-center gap-1"><Label htmlFor="safetyMargin" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Safety Margin</Label><UITooltip><TooltipTrigger asChild><ShieldAlert className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent><p className="text-xs">Demand staffing buffer for forecast variance</p></TooltipContent></UITooltip></div><Badge variant="outline" className="font-black text-xs text-primary border-primary/20">{assumptions.safetyMargin}%</Badge></div><Input id="safetyMargin" type="number" value={assumptions.safetyMargin} onChange={(event) => setAssumptions({ ...assumptions, safetyMargin: validateInput(Number(event.target.value), 0, 20) })} className="h-10 font-bold" /></div>
                  <div className="space-y-3"><div className="flex items-center justify-between"><Label htmlFor="fteMonthlyHours" className="text-xs font-black uppercase tracking-widest text-muted-foreground">FTE Monthly Hours</Label><span className="text-xs font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-700 dark:text-slate-200">{assumptions.fteMonthlyHours}</span></div><Input id="fteMonthlyHours" type="number" step="0.01" value={assumptions.fteMonthlyHours} onChange={(event) => setAssumptions({ ...assumptions, fteMonthlyHours: validateInput(Number(event.target.value), 1) })} className="h-10 font-bold" /></div>
                  {forecastMethod === "yoy" && <div className="space-y-3 border-t border-border pt-6 mt-6"><div className="flex items-center justify-between"><Label htmlFor="growthRate" className="text-xs font-black uppercase tracking-widest text-muted-foreground">YoY Growth Rate</Label><Badge className="bg-emerald-500 font-black tracking-tight">+{assumptions.growthRate}%</Badge></div><Input id="growthRate" type="number" value={assumptions.growthRate} onChange={(event) => setAssumptions({ ...assumptions, growthRate: validateInput(Number(event.target.value)) })} className="h-10 font-bold border-emerald-200" /></div>}
                  {forecastMethod === "holtwinters" && <div className="space-y-4 border-t border-border pt-6 mt-6"><div className="flex items-center justify-between"><Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">HW Smoothing</Label><Badge className="bg-amber-500 font-black tracking-tight">Triple Exp</Badge></div><div className="grid grid-cols-2 gap-4"><div className="space-y-1"><Label className="text-xs font-bold">Alpha (Level)</Label><Input type="number" step="0.1" min="0" max="1" value={hwParams.alpha} onChange={(event) => setHwParams({ ...hwParams, alpha: Number(event.target.value) })} className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs font-bold">Beta (Trend)</Label><Input type="number" step="0.1" min="0" max="1" value={hwParams.beta} onChange={(event) => setHwParams({ ...hwParams, beta: Number(event.target.value) })} className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs font-bold">Gamma (Season)</Label><Input type="number" step="0.1" min="0" max="1" value={hwParams.gamma} onChange={(event) => setHwParams({ ...hwParams, gamma: Number(event.target.value) })} className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs font-bold">Season (Len)</Label><Input type="number" min="1" max="24" value={hwParams.seasonLength} onChange={(event) => setHwParams({ ...hwParams, seasonLength: Number(event.target.value) })} className="h-8 text-xs" /></div></div></div>}
                  {forecastMethod === "arima" && <div className="space-y-4 border-t border-border pt-6 mt-6"><div className="flex items-center justify-between"><Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">ARIMA (Simplified)</Label><Badge className="bg-emerald-500 font-black tracking-tight">p d q</Badge></div><div className="grid grid-cols-3 gap-2"><div className="space-y-1"><Label className="text-xs font-bold">p (AR)</Label><Input type="number" min="0" max="12" value={arimaParams.p} onChange={(event) => setArimaParams({ ...arimaParams, p: Number(event.target.value) })} className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs font-bold">d (Diff)</Label><Input type="number" min="0" max="2" value={arimaParams.d} onChange={(event) => setArimaParams({ ...arimaParams, d: Number(event.target.value) })} className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs font-bold">q (MA)</Label><Input type="number" min="1" max="10" value={arimaParams.q} onChange={(event) => setArimaParams({ ...arimaParams, q: Number(event.target.value) })} className="h-8 text-xs" /></div></div></div>}
                  {forecastMethod === "decomposition" && <div className="space-y-4 border-t border-border pt-6 mt-6"><div className="flex items-center justify-between"><Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Decomposition</Label><Badge className="bg-blue-500 font-black tracking-tight">Strengths</Badge></div><div className="space-y-3"><div className="space-y-1"><div className="flex justify-between"><Label className="text-xs font-bold">Trend Strength</Label><span className="text-xs font-bold">{decompParams.trendStrength}x</span></div><Input type="number" step="0.1" min="0" max="3" value={decompParams.trendStrength} onChange={(event) => setDecompParams({ ...decompParams, trendStrength: Number(event.target.value) })} className="h-8 text-xs" /></div><div className="space-y-1"><div className="flex justify-between"><Label className="text-xs font-bold">Seasonality Strength</Label><span className="text-xs font-bold">{decompParams.seasonalityStrength}x</span></div><Input type="number" step="0.1" min="0" max="3" value={decompParams.seasonalityStrength} onChange={(event) => setDecompParams({ ...decompParams, seasonalityStrength: Number(event.target.value) })} className="h-8 text-xs" /></div></div></div>}
                  {forecastMethod === "ma" && <div className="space-y-3 border-t border-border pt-6 mt-6"><div className="flex items-center justify-between"><Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">MA Periods</Label><Badge className="bg-indigo-500 font-black tracking-tight">Last 3 Months</Badge></div><p className="text-xs text-muted-foreground italic">Moving average uses the most recent historical periods to project a baseline.</p></div>}
                  <Button className="w-full h-11 font-black uppercase tracking-widest text-xs mt-4 shadow-lg shadow-primary/20" onClick={() => toast.info("Demand forecast recalculated", { duration: 1500 })}><LayoutDashboard className="size-4 mr-2" />Recalculate</Button>
                </CardContent>}
              </Card>
              <Card className="bg-gradient-to-br from-slate-900 to-slate-800 text-white border-none shadow-2xl mt-6"><CardHeader className="pb-2"><CardTitle className="text-[10px] font-black flex items-center gap-2 uppercase tracking-[0.2em] text-blue-400"><LineChartIcon className="size-4" />Demand Notes</CardTitle></CardHeader><CardContent className="space-y-4 pt-2"><div className="space-y-2"><p className="text-[9px] text-slate-400 uppercase font-black tracking-[0.15em]">Staffing Logic</p><p className="text-xs font-medium leading-relaxed">Required Agents / FTE uses forecast volume, AHT, occupancy, shrinkage, operating hours, safety margin, and channel-specific SLA and ASA targets for voice, email, and chat.</p></div><div className="space-y-2"><p className="text-[9px] text-slate-400 uppercase font-black tracking-[0.15em]">Blended Pools</p><p className="text-xs font-medium leading-relaxed">When channels are blended, the model recalculates staffing at the shared-pool level using pooled workload, weighted service targets, and a higher volume-driven occupancy cap where justified.</p></div><div className="space-y-2"><p className="text-[9px] text-slate-400 uppercase font-black tracking-[0.15em]">Open-Hours Effect</p><p className="text-xs font-medium leading-relaxed">Narrower or broader opening windows change the average concurrent load per open hour and the total staffed coverage hours required each month.</p></div><div className="space-y-2"><p className="text-[9px] text-slate-400 uppercase font-black tracking-[0.15em]">Seasonality View</p><p className="text-xs font-medium leading-relaxed">The seasonality chart indexes each forecast month against the average monthly forecast volume.</p></div></CardContent></Card>
            </div>
          </div>
        </div>
      </PageLayout>
    </TooltipProvider>
  );
}
