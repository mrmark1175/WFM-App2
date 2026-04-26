import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { BarChart2, Download, Edit2, Eye, EyeOff, Info, LayoutDashboard, RotateCcw, Save, Trash2, Upload, X, ChevronDown, ChevronUp, ClipboardPaste, AlertTriangle, Calendar, Table2, SlidersHorizontal, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { apiUrl } from "../lib/api";
import { useLOB } from "../lib/lobContext";
import { useWFMPageData } from "../lib/WFMPageDataContext";
import { usePagePreferences } from "../lib/usePagePreferences";
import { PageLayout } from "../components/PageLayout";
import { getCalculatedVolumes, Assumptions } from "./forecasting-logic";
import {
  GridData, DOW_LABELS, SLOT_COUNT,
  computeMedianPattern, computeDistributionWeights,
  distributeWeeklyVolumeToIntervals, distributeMonthlyToTargetWeek,
  distributeMonthlyToWeekViaDailyDOW, computeWeekOutlierFence, WeekOutlierAnalysis,
  computeWeeklyBuckets,
  aggregateTo30Min, aggregateTo60Min, buildChartData, generateMonthLabels, monthFromOffset,
  makeIntervals, getWeeksInMonth, parseExcelPaste, parseIntervalGridPaste,
  getISOWeekNumber, getISOWeeksInYear, getWeekDateStrings, remapGridToWeek,
  computeIntervalFTE, IntervalFTEResult, smoothFTEValues, getWeekOfMonth,
} from "./intraday-distribution-logic";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";

// ── Types ─────────────────────────────────────────────────────────────────────
type ChannelKey = "voice" | "email" | "chat" | "cases";

interface PlannerSnapshot {
  assumptions: Assumptions;
  forecastMethod: string;
  hwParams: { alpha: number; beta: number; gamma: number; seasonLength: number };
  arimaParams: { p: number; d: number; q: number };
  decompParams: { trendStrength: number; seasonalityStrength: number };
  channelHistoricalApiData: Record<ChannelKey, number[]>;
  channelHistoricalOverrides: Record<ChannelKey, Record<number, string>>;
  recutVolumesByChannel?: Record<ChannelKey, number[]> | null;
}

interface DistributionProfile {
  id: number;
  profile_name: string;
  channel: string;
  interval_weights: number[][];
  day_weights: number[];
  baseline_start_date: string | null;
  baseline_end_date: string | null;
  sample_day_count: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface IntradayPrefs {
  targetMonthOffset: number;
  targetWeekStart: string;
  grain: 15 | 30 | 60;
  isBaselineOpen: boolean;
  dataSource: "api" | "manual";
  baselineYear: number;
  baselineStartWeek: number;
  manualRawData: GridData;
  manualWeeklyVolumes: number[];
  editableWeights: number[][] | null;
  hideBlankRows: boolean;
  smoothFTE: boolean;
  smoothWindow: number;
  patternShiftHours: number;
  /** Per-day volume multipliers [Mon…Sun]. 0 = holiday, 1.5 = +50%, etc. */
  dayOverrideMultipliers: number[];
  /** Which historical window to use for the API-sourced baseline pattern. */
  apiBaselinePreset: "last28" | "sameWeekLastYear" | "custom";
  apiBaselineCustomStart: string;
  apiBaselineCustomEnd: string;
  /** Show FTE table with global-max heatmap coloring (vs row-relative). */
  showFteHeatmap: boolean;
}

const CHANNEL_VOLUME_FACTORS: Record<ChannelKey, number> = { voice: 1, email: 0.2, chat: 0.3, cases: 0.2 };
const USER_INPUTS_STORAGE_KEY = "lt_forecast_demand_user_inputs";
const DEFAULT_PREFS: IntradayPrefs = {
  targetMonthOffset: 0,
  targetWeekStart: "",
  grain: 15,
  isBaselineOpen: true,
  dataSource: "api",
  baselineYear: new Date().getFullYear(),
  baselineStartWeek: getISOWeekNumber(new Date()),
  manualRawData: {},
  manualWeeklyVolumes: [],
  editableWeights: null,
  hideBlankRows: false,
  smoothFTE: false,
  smoothWindow: 2,
  patternShiftHours: 0,
  dayOverrideMultipliers: [1, 1, 1, 1, 1, 1, 1],
  apiBaselinePreset: "last28",
  apiBaselineCustomStart: "",
  apiBaselineCustomEnd: "",
  showFteHeatmap: false,
};
const DOW_COLORS = ["#2563eb", "#0891b2", "#16a34a", "#d97706", "#9333ea", "#e11d48", "#94a3b8"];

interface PersistedDemandPlannerState {
  selectedScenarioId?: string;
  plannerSnapshot?: Partial<PlannerSnapshot>;
}

function readPersistedDemandPlannerSnapshot(): PlannerSnapshot | null {
  try {
    const raw = localStorage.getItem(USER_INPUTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDemandPlannerState;
    return (parsed?.plannerSnapshot as PlannerSnapshot | undefined) ?? null;
  } catch {
    return null;
  }
}

// ── Helper: apply overrides to API data (mirrors demand planner logic) ────────
function applyHistoricalOverrides(apiData: number[], overrides: Record<number, string>): number[] {
  const len = Math.max(apiData.length, ...Object.keys(overrides).map(Number).map((k) => k + 1), 0);
  return Array.from({ length: len }, (_, i) => {
    const api = apiData[i] ?? 0;
    const ov = overrides[i];
    if (!ov || ov === "") return api;
    const parsed = parseInt(ov, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : api;
  });
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export const IntradayForecast = () => {
  const { activeLob, activeChannel } = useLOB();
  const selectedChannel = activeChannel as ChannelKey;
  const [prefs, setPrefs] = usePagePreferences<IntradayPrefs>("intraday_forecast", DEFAULT_PREFS);
  const { targetMonthOffset, targetWeekStart, grain, isBaselineOpen, dataSource,
          baselineYear, baselineStartWeek, manualRawData, manualWeeklyVolumes, editableWeights,
          hideBlankRows, smoothFTE, smoothWindow, patternShiftHours = 0,
          dayOverrideMultipliers = [1,1,1,1,1,1,1],
          apiBaselinePreset = "last28", apiBaselineCustomStart = "", apiBaselineCustomEnd = "",
          showFteHeatmap = false } = prefs;

  // Reset target month/week when global channel changes
  const prevChannelRef = React.useRef(selectedChannel);
  useEffect(() => {
    if (prevChannelRef.current !== selectedChannel) {
      prevChannelRef.current = selectedChannel;
      setPrefs({ targetMonthOffset: 0, targetWeekStart: "" });
    }
  }, [selectedChannel]);

  // ── State ──────────────────────────────────────────────────────────────────
  const [plannerSnapshot, setPlannerSnapshot] = useState<PlannerSnapshot | null>(null);
  // apiRawData: loaded from API (not persisted). manualRawData in prefs: user-pasted (persisted).
  const [apiRawData, setApiRawData] = useState<GridData>({});
  const rawData: GridData = dataSource === "api" ? apiRawData : (manualRawData ?? {});
  const [savedProfiles, setSavedProfiles] = useState<DistributionProfile[]>([]);
  const [isEditingWeights, setIsEditingWeights] = useState(false);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingForecast, setIsLoadingForecast] = useState(false);
  const [isLoadingBaseline, setIsLoadingBaseline] = useState(false);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [gridFocused, setGridFocused] = useState(false);
  const [showForecastTable, setShowForecastTable] = useState(true);
  const [showFTETable, setShowFTETable] = useState(true);
  const [showMedianTable, setShowMedianTable] = useState(false);
  const [showDistributionTable, setShowDistributionTable] = useState(false);
  const [shrinkageHoursPerDay, setShrinkageHoursPerDay] = useState<number>(7.5);
  const [lobHoursOfOperation, setLobHoursOfOperation] = useState<Record<string, Record<string, { enabled: boolean; open: string; close: string }>> | null>(null);
  const [commitStatus, setCommitStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [approveStatus, setApproveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Virtual scroll for weight editor
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [visStart, setVisStart] = useState(0);
  const ROW_HEIGHT = 36;
  const VIS_ROWS = 20;

  // ── Derived baseline date range — reactive to user-selected preset ────────
  const { baselineStart, baselineEnd } = useMemo(() => {
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    if (apiBaselinePreset === "sameWeekLastYear") {
      const end = new Date();
      end.setFullYear(end.getFullYear() - 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 27);
      return { baselineStart: fmt(start), baselineEnd: fmt(end) };
    }
    if (apiBaselinePreset === "custom" && apiBaselineCustomStart && apiBaselineCustomEnd) {
      return { baselineStart: apiBaselineCustomStart, baselineEnd: apiBaselineCustomEnd };
    }
    // Default: last 28 days
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 27);
    return { baselineStart: fmt(start), baselineEnd: fmt(end) };
  }, [apiBaselinePreset, apiBaselineCustomStart, apiBaselineCustomEnd]);

  // ── Load forecast state (falls back to LOB settings if no Demand Planner state) ──
  useEffect(() => {
    if (!activeLob) return;
    setIsLoadingForecast(true);
    Promise.all([
      fetch(apiUrl(`/api/demand-planner-active-state?lob_id=${activeLob.id}`)).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(apiUrl(`/api/lob-settings?lob_id=${activeLob.id}`)).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]).then(([activeState, lobSettings]) => {
      const apiSnapshot = activeState?.plannerSnapshot as PlannerSnapshot | undefined;
      const localSnapshot = readPersistedDemandPlannerSnapshot();
      const snapshot = localSnapshot?.recutVolumesByChannel
        ? localSnapshot
        : apiSnapshot?.recutVolumesByChannel
          ? apiSnapshot
          : localSnapshot ?? apiSnapshot;

      if (lobSettings?.hours_of_operation) {
        setLobHoursOfOperation(lobSettings.hours_of_operation as Record<string, Record<string, { enabled: boolean; open: string; close: string }>>);
      }
      if (snapshot) {
        setPlannerSnapshot(snapshot);
      } else if (lobSettings) {
        // No Demand Planner session yet — build a minimal snapshot from LOB settings
        const a = lobSettings as Record<string, number | Record<string, boolean> | string>;
        const voiceSched = (lobSettings.hours_of_operation as Record<string, Record<string, { enabled: boolean; open: string; close: string }>> | undefined)?.voice;
        const enabledDays = voiceSched ? Object.values(voiceSched).filter((d) => d.enabled).length : 5;
        const avgHrs = voiceSched ? (() => {
          const enabled = Object.values(voiceSched).filter((d) => d.enabled);
          if (!enabled.length) return 8;
          const tot = enabled.reduce((s, d) => {
            const [oh, om] = d.open.split(":").map(Number);
            const [ch, cm] = d.close.split(":").map(Number);
            return s + Math.max(0, (ch + cm / 60) - (oh + om / 60));
          }, 0);
          return Math.round((tot / enabled.length) * 10) / 10;
        })() : 8;
        setPlannerSnapshot({
          assumptions: {
            startDate: new Date().getFullYear() + "-01-01",
            aht: Number(a.voice_aht) || 300,
            emailAht: Number(a.email_aht) || 600,
            chatAht: Number(a.chat_aht) || 450,
            chatConcurrency: Number(a.chat_concurrency) || 2,
            shrinkage: Number(a.voice_shrinkage) || 25,
            shrinkageSource: "manual",
            voiceSlaTarget: Number(a.voice_sla_target) || 80,
            voiceSlaAnswerSeconds: Number(a.voice_sla_seconds) || 20,
            voiceAsaTargetSeconds: 15,
            emailSlaTarget: Number(a.email_sla_target) || 90,
            emailSlaAnswerSeconds: Number(a.email_sla_seconds) || 14400,
            emailAsaTargetSeconds: 3600,
            chatSlaTarget: Number(a.chat_sla_target) || 80,
            chatSlaAnswerSeconds: Number(a.chat_sla_seconds) || 30,
            chatAsaTargetSeconds: 20,
            occupancy: Number(a.email_occupancy) || 85,
            growthRate: 0,
            safetyMargin: 5,
            currency: "USD",
            annualSalary: 45000,
            onboardingCost: 5000,
            fteMonthlyHours: 166.67,
            operatingHoursPerDay: avgHrs,
            operatingDaysPerWeek: enabledDays,
            useManualVolume: false,
            manualHistoricalData: new Array(12).fill(10000),
          },
          forecastMethod: "holtwinters",
          hwParams: { alpha: 0.3, beta: 0.1, gamma: 0.3, seasonLength: 12 },
          arimaParams: { p: 1, d: 1, q: 1 },
          decompParams: { trendStrength: 1, seasonalityStrength: 1 },
          channelHistoricalApiData: { voice: [], email: [], chat: [], cases: [] },
          channelHistoricalOverrides: { voice: {}, email: {}, chat: {}, cases: {} },
          selectedChannels: (lobSettings.channels_enabled as Record<string, boolean> | undefined) ?? { voice: true, email: false, chat: false, cases: false },
          poolingMode: (a.pooling_mode as string) === "blended" ? "blended" : "dedicated",
          isHistoricalSourceOpen: false,
          isBlendedStaffingOpen: true,
          selectedHistoricalChannel: "voice",
        } as PlannerSnapshot);
      } else {
        setPlannerSnapshot(null);
      }
    }).finally(() => setIsLoadingForecast(false));
  }, [activeLob?.id]);

  // ── Load baseline interaction data ─────────────────────────────────────────
  useEffect(() => {
    if (!activeLob || dataSource !== "api") return;
    setIsLoadingBaseline(true);
    fetch(apiUrl(`/api/interaction-arrival?startDate=${baselineStart}&endDate=${baselineEnd}&channel=${selectedChannel}&lob_id=${activeLob.id}`))
      .then((r) => r.json())
      .then((records: any[]) => {
        if (!Array.isArray(records)) return;
        const newData: GridData = {};
        records.forEach((r) => {
          const ds = (r.interval_date as string).split("T")[0];
          if (!newData[ds]) newData[ds] = {};
          newData[ds][r.interval_index] = { volume: r.volume || 0, aht: r.aht || 0 };
        });
        setApiRawData(newData);
      })
      .catch(() => setApiRawData({}))
      .finally(() => setIsLoadingBaseline(false));
  }, [activeLob?.id, selectedChannel, baselineStart, baselineEnd, dataSource]);

  // ── Load saved profiles ────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeLob) return;
    setIsLoadingProfiles(true);
    fetch(apiUrl(`/api/distribution-profiles?lob_id=${activeLob.id}&channel=${selectedChannel}`))
      .then((r) => r.json())
      .then((data: DistributionProfile[]) => {
        if (Array.isArray(data)) setSavedProfiles(data);
      })
      .catch(() => setSavedProfiles([]))
      .finally(() => setIsLoadingProfiles(false));
  }, [activeLob?.id, selectedChannel]);

  // ── Fetch shrinkage plan hours_per_day (FTE daily hour definition) ──────────
  useEffect(() => {
    if (!activeLob) return;
    fetch(apiUrl(`/api/shrinkage-plan?lob_id=${activeLob.id}`))
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data.hours_per_day === "number" && data.hours_per_day > 0) {
          setShrinkageHoursPerDay(data.hours_per_day);
        }
      })
      .catch(() => {}); // fire-and-forget; default stays at 7.5
  }, [activeLob?.id]);

  // ── Forecast computation ───────────────────────────────────────────────────
  const forecastVolumesByChannel = useMemo<Record<ChannelKey, number[]>>(() => {
    const empty = { voice: [] as number[], email: [] as number[], chat: [] as number[], cases: [] as number[] };
    if (!plannerSnapshot) return empty;

    // Per-channel: use published recut where available; fall back to algorithm per channel.
    // Guard uses .length > 0 — Array.isArray([]) is truthy so an empty array must be
    // rejected explicitly, otherwise a partly-initialised recut silently zeroes months.
    const recut = (plannerSnapshot as Record<string, unknown>).recutVolumesByChannel as Record<ChannelKey, number[]> | null | undefined;
    const hasRecut = (ch: ChannelKey): boolean =>
      Array.isArray(recut?.[ch]) && (recut![ch]!.length > 0);

    const { forecastMethod, hwParams, arimaParams, decompParams, assumptions,
            channelHistoricalApiData = {} as Record<ChannelKey, number[]>,
            channelHistoricalOverrides = {} as Record<ChannelKey, Record<number, string>> } = plannerSnapshot;

    const getHistory = (ch: ChannelKey) =>
      applyHistoricalOverrides(channelHistoricalApiData[ch] ?? [], channelHistoricalOverrides[ch] ?? {});

    const voiceHistory = getHistory("voice");
    const emailHistory = getHistory("email");
    const chatHistory = getHistory("chat");
    const casesHistory = getHistory("cases");

    const voiceForecast = hasRecut("voice")
      ? recut!.voice
      : getCalculatedVolumes(voiceHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams);
    const emailForecast = hasRecut("email")
      ? recut!.email
      : emailHistory.length > 0
        ? getCalculatedVolumes(emailHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
        : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.email));
    const chatForecast = hasRecut("chat")
      ? recut!.chat
      : chatHistory.length > 0
        ? getCalculatedVolumes(chatHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
        : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.chat));
    const casesForecast = hasRecut("cases")
      ? recut!.cases
      : casesHistory.length > 0
        ? getCalculatedVolumes(casesHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
        : emailForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.cases));

    return { voice: voiceForecast, email: emailForecast, chat: chatForecast, cases: casesForecast };
  }, [plannerSnapshot]);

  const monthLabels = useMemo(
    () => plannerSnapshot?.assumptions?.startDate
      ? generateMonthLabels(plannerSnapshot.assumptions.startDate)
      : Array.from({ length: 12 }, (_, i) => `Month ${i + 1}`),
    [plannerSnapshot?.assumptions?.startDate]
  );

  const safeOffset = Math.min(
    Math.max(0, targetMonthOffset),
    Math.max(0, forecastVolumesByChannel[selectedChannel].length - 1)
  );
  const targetMonthlyVolume = forecastVolumesByChannel[selectedChannel][safeOffset] ?? 0;
  const { year: targetYear, month: targetMonthIndex } = useMemo(
    () => plannerSnapshot?.assumptions?.startDate
      ? monthFromOffset(plannerSnapshot.assumptions.startDate, safeOffset)
      : { year: new Date().getFullYear(), month: new Date().getMonth() },
    [plannerSnapshot?.assumptions?.startDate, safeOffset]
  );

  // ── Weeks in target month ──────────────────────────────────────────────────
  const weeksInMonth = useMemo(
    () => getWeeksInMonth(targetYear, targetMonthIndex),
    [targetYear, targetMonthIndex]
  );

  // Auto-select first week when month changes or when no week is selected
  useEffect(() => {
    if (weeksInMonth.length > 0 && (!targetWeekStart || !weeksInMonth.some((w) => w.start === targetWeekStart))) {
      setPrefs({ targetWeekStart: weeksInMonth[0].start });
    }
  }, [weeksInMonth, targetWeekStart]);

  // ── Weekly distribution from historical data ───────────────────────────────
  const weekBuckets = useMemo(() => computeWeeklyBuckets(rawData), [rawData]);
  const weekOutlierFence = useMemo(() => computeWeekOutlierFence(weekBuckets), [weekBuckets]);

  const hasEnoughWeeklyData = weekBuckets.length >= 4;

  // ── Manual volume outlier stats ────────────────────────────────────────────
  // Poisson self-referential fence: flag entries that deviate > 2σ from the
  // mean of all entered manual volumes (σ = √mean by Poisson assumption).
  const manualOutlierStats = useMemo(() => {
    const filled = manualWeeklyVolumes.filter(v => v > 0);
    if (filled.length < 4) return null;
    const mean = filled.reduce((a, b) => a + b, 0) / filled.length;
    const sigma = Math.sqrt(Math.max(mean, 1));
    return { mean, sigma, lower: Math.max(0, mean - 2 * sigma), upper: mean + 2 * sigma };
  }, [manualWeeklyVolumes]);

  // ── AI normalization state ─────────────────────────────────────────────────
  type AISuggestion = { weekIndex: number; suggestedVolume: number; reason: string; confidence: string };
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  async function requestAiNormalization(mode: "historical" | "manual") {
    setAiLoading(true);
    setAiSuggestions([]);
    try {
      const body = mode === "historical"
        ? {
            mode: "historical",
            channel: selectedChannel,
            monthlyForecast: targetMonthlyVolume,
            weeks: weekBuckets.map((w, i) => ({
              index: i,
              weekStart: w.weekStart,
              volume: w.volume,
              isOutlier: weekOutlierFence.outlierSet.has(w.weekStart),
            })),
          }
        : {
            mode: "manual",
            channel: selectedChannel,
            monthlyForecast: targetMonthlyVolume,
            weeks: manualWeeklyVolumes.map((v, i) => ({
              index: i,
              volume: v,
              isOutlier: manualOutlierStats !== null && v > 0 &&
                (v < manualOutlierStats.lower || v > manualOutlierStats.upper),
            })).filter(w => w.volume > 0),
          };

      const res = await fetch(apiUrl("/api/ai/normalize-week"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setAiSuggestions(data.suggestions ?? []);
    } catch (err) {
      toast.error("Normalization failed — check server connection");
    } finally {
      setAiLoading(false);
    }
  }

  function applyAiSuggestion(s: AISuggestion, mode: "manual") {
    if (mode === "manual") {
      const next = [...(manualWeeklyVolumes ?? [])];
      next[s.weekIndex] = s.suggestedVolume;
      setPrefs({ manualWeeklyVolumes: next });
      setAiSuggestions(prev => prev.filter(x => x.weekIndex !== s.weekIndex));
      toast.success(`Week ${s.weekIndex + 1} updated to ${s.suggestedVolume.toLocaleString()}`);
    }
  }

  // ── Distribution computation ───────────────────────────────────────────────
  // Must be declared BEFORE forecastedWeekVolume which reads distributionWeights.dayWeights.
  // useMemo callbacks run synchronously on first render; forward references cause TDZ errors.

  // Declared here (not near the grid helpers below) to avoid TDZ: syntheticMedianPattern,
  // usingFallbackPattern, and medianPattern all read this value.
  const baselineDataCount = useMemo(() => Object.keys(rawData).length, [rawData]);

  // Synthetic flat pattern built from LOB hours of operation.
  // Used as a fallback when no real interval data has been loaded yet.
  // Each enabled day gets uniform weight across every 15-min slot in its operating window.
  // This produces a rectangular intraday shape — accurate enough for early planning before
  // actual interaction data is available.
  const syntheticMedianPattern = useMemo((): { medians: number[][]; sampleCounts: number[] } | null => {
    // Prefer channel-specific schedule; fall back to voice, then any available channel.
    const schedule =
      lobHoursOfOperation?.[selectedChannel] ??
      lobHoursOfOperation?.["voice"] ??
      (lobHoursOfOperation ? Object.values(lobHoursOfOperation).find(Boolean) ?? null : null);
    if (!schedule) return null;

    const DOW_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const medians: number[][] = Array.from({ length: 7 }, () => new Array(SLOT_COUNT).fill(0));
    const sampleCounts: number[] = new Array(7).fill(0);

    DOW_KEYS.forEach((key, d) => {
      const day = (schedule as Record<string, { enabled: boolean; open: string; close: string }>)[key];
      if (!day?.enabled) return;
      const [oh, om] = day.open.split(":").map(Number);
      const [ch, cm] = day.close.split(":").map(Number);
      const openSlot  = Math.floor((oh * 60 + om) / 15);
      const closeSlot = Math.floor((ch * 60 + cm) / 15); // last slot that starts before close
      for (let i = openSlot; i < closeSlot && i < SLOT_COUNT; i++) medians[d][i] = 1;
      if (closeSlot > openSlot) sampleCounts[d] = 1; // mark this DOW as having data
    });

    return medians.some((day) => day.some((v) => v > 0))
      ? { medians, sampleCounts }
      : null;
  }, [lobHoursOfOperation, selectedChannel]);

  // True when using the synthetic fallback (no real baseline data loaded yet).
  const usingFallbackPattern = baselineDataCount === 0 && syntheticMedianPattern !== null;

  const medianPattern = useMemo(() => {
    if (baselineDataCount > 0) {
      // Real data path — apply week-of-month positional filter when sufficient history exists.
      if (!targetWeekStart) return computeMedianPattern(rawData);
      const pos = getWeekOfMonth(targetWeekStart);
      const positional = computeMedianPattern(rawData, pos);
      const activeCounts = positional.sampleCounts.filter((c) => c > 0);
      if (activeCounts.length > 0 && Math.min(...activeCounts) >= 2) return positional;
      return computeMedianPattern(rawData);
    }
    // Fallback: synthetic flat distribution derived from LOB hours of operation.
    if (syntheticMedianPattern) return syntheticMedianPattern;
    return computeMedianPattern(rawData); // empty — no data and no LOB hours
  }, [rawData, baselineDataCount, targetWeekStart, syntheticMedianPattern]);
  const distributionWeights = useMemo(
    () => computeDistributionWeights(medianPattern.medians),
    [medianPattern]
  );

  // Compute the forecasted weekly volume
  const forecastedWeekVolume = useMemo(() => {
    if (targetMonthlyVolume === 0 || !targetWeekStart) return 0;

    if (dataSource === "manual") {
      // Use all entered weekly volumes. Require at least 4.
      const allVolumes = manualWeeklyVolumes.filter((v) => v > 0);
      if (allVolumes.length < 4) return 0;

      const weekIdx = weeksInMonth.findIndex((w) => w.start === targetWeekStart);
      if (weekIdx < 0) return 0;

      // Average each week-of-month position across historical cycles so that
      // more entered weeks genuinely normalize the distribution.
      // e.g. 8 weeks for a 4-week month: pos 0 → avg(wks[0], wks[4]), pos 1 → avg(wks[1], wks[5]), …
      const cycleLength = weeksInMonth.length || 4;
      const cycleAvgs = Array.from({ length: cycleLength }, (_, pos) => {
        const vals: number[] = [];
        for (let c = 0; c * cycleLength + pos < allVolumes.length; c++) {
          vals.push(allVolumes[c * cycleLength + pos]);
        }
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      });

      const totalAvg = cycleAvgs.reduce((a, b) => a + b, 0);
      if (totalAvg === 0) return 0;
      const pct = cycleAvgs[weekIdx] / totalAvg;
      return targetMonthlyVolume * pct;
    }

    if (dataSource === "api") {
      // Use DOW-based daily expansion when we have pattern weights (most accurate).
      // Falls back to positional-average when no baseline data is loaded yet.
      const dw = distributionWeights.dayWeights;
      const hasDOWWeights = dw.some(w => w > 0);
      if (hasDOWWeights) {
        return distributeMonthlyToWeekViaDailyDOW(
          targetMonthlyVolume, targetYear, targetMonthIndex, targetWeekStart, dw
        );
      }
      if (weekBuckets.length > 0) {
        return distributeMonthlyToTargetWeek(targetMonthlyVolume, weekBuckets, targetWeekStart);
      }
    }

    // Fallback: simple division by weeks in month
    return weeksInMonth.length > 0 ? targetMonthlyVolume / weeksInMonth.length : 0;
  }, [targetMonthlyVolume, targetWeekStart, weekBuckets, manualWeeklyVolumes, dataSource,
      weeksInMonth, distributionWeights.dayWeights, targetYear, targetMonthIndex]);
  const activeIntervalWeights = editableWeights ?? distributionWeights.intervalWeights;

  // Distribute the forecasted week volume to interval-level
  const weekForecast = useMemo(
    () => distributeWeeklyVolumeToIntervals(
      forecastedWeekVolume,
      distributionWeights.dayWeights,
      activeIntervalWeights
    ),
    [forecastedWeekVolume, distributionWeights.dayWeights, activeIntervalWeights]
  );

  // ── DST / timezone shift: circularly rotate 15-min slots before aggregation ──
  // Positive hours → pattern shifts forward (e.g. +1h: peak moves from 10 AM to 11 AM).
  // Applied at the raw 96-slot level so grain aggregation sees the shifted data.
  const shiftedWeekForecast = useMemo((): number[][] => {
    const slotShift = Math.round(patternShiftHours * 4); // 4 × 15-min slots per hour
    if (slotShift === 0) return weekForecast;
    const N = SLOT_COUNT; // 96
    const k = ((slotShift % N) + N) % N; // normalise to [0, N)
    return weekForecast.map((dayData) => [
      ...dayData.slice(N - k),
      ...dayData.slice(0, N - k),
    ]);
  }, [weekForecast, patternShiftHours]);

  // Apply per-day override multipliers (0 = holiday, 1.5 = +50% campaign push, etc.)
  const adjustedWeekForecast = useMemo((): number[][] => {
    const mults = dayOverrideMultipliers.length === 7 ? dayOverrideMultipliers : [1,1,1,1,1,1,1];
    if (mults.every((m) => m === 1)) return shiftedWeekForecast;
    return shiftedWeekForecast.map((dayData, d) => {
      const m = mults[d] ?? 1;
      return m === 1 ? dayData : dayData.map((v) => v * m);
    });
  }, [shiftedWeekForecast, dayOverrideMultipliers]);

  const displayForecast = useMemo(() => {
    if (grain === 60) return aggregateTo60Min(adjustedWeekForecast);
    if (grain === 30) return aggregateTo30Min(adjustedWeekForecast);
    return adjustedWeekForecast;
  }, [adjustedWeekForecast, grain]);

  // ── Operating hours mask: zero out intervals outside the channel's LOB schedule ──
  // DOW_LABELS order: Mon=0 … Sun=6; matches schedule keys monday…sunday.
  const DOW_SCHEDULE_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const operatingHoursMask = useMemo((): boolean[][] | null => {
    const schedule = lobHoursOfOperation?.[selectedChannel];
    if (!schedule) return null;
    const intervalCount = displayForecast[0]?.length ?? 0;
    return DOW_SCHEDULE_KEYS.map((dayKey) => {
      const day = schedule[dayKey];
      if (!day?.enabled) return Array(intervalCount).fill(false);
      const [oh, om] = day.open.split(":").map(Number);
      const [ch, cm] = day.close.split(":").map(Number);
      const openMin = oh * 60 + om;
      const closeMin = ch * 60 + cm;
      return Array.from({ length: intervalCount }, (_, i) => {
        const startMin = i * grain;
        return startMin >= openMin && startMin < closeMin;
      });
    });
  }, [lobHoursOfOperation, selectedChannel, grain, displayForecast]);

  // Apply the mask: intervals outside operating hours get zero volume → zero FTE.
  const maskedDisplayForecast = useMemo((): number[][] => {
    if (!operatingHoursMask) return displayForecast;
    return displayForecast.map((dayData, d) =>
      dayData.map((calls, i) => (operatingHoursMask[d]?.[i] ? calls : 0))
    );
  }, [displayForecast, operatingHoursMask]);

  const chartData = useMemo(() => buildChartData(maskedDisplayForecast, grain), [maskedDisplayForecast, grain]);

  // Intervals where every day in the forecast is 0 — used to filter blank rows
  const blankIntervalSet = useMemo(() => {
    const set = new Set<number>();
    const len = maskedDisplayForecast[0]?.length ?? 0;
    for (let i = 0; i < len; i++) {
      if (DOW_LABELS.every((_, d) => (maskedDisplayForecast[d]?.[i] ?? 0) === 0)) set.add(i);
    }
    return set;
  }, [maskedDisplayForecast]);

  // ── FTE per Interval — pull staffing params from demand assumptions ───────────
  const fteParams = useMemo(() => {
    const a = plannerSnapshot?.assumptions;
    if (!a) return null;
    const ch = selectedChannel;
    return {
      ahtSec:       ch === "voice" ? a.aht    : ch === "chat" ? a.chatAht  : a.emailAht,
      slaTarget:    ch === "voice" ? a.voiceSlaTarget : ch === "chat" ? a.chatSlaTarget : a.emailSlaTarget,
      slaSec:       ch === "voice" ? a.voiceSlaAnswerSeconds : ch === "chat" ? a.chatSlaAnswerSeconds : a.emailSlaAnswerSeconds,
      // occupancy is NOT a staffing input for voice/chat Erlang A/C — it is an output.
      // We pass it only for the email-style workload model which needs a utilisation target.
      emailOccupancy: a.occupancy,
      shrinkage:    a.shrinkage,
      concurrency:  ch === "chat" ? Math.max(1, a.chatConcurrency ?? 2) : 1,
      // Erlang A: mean patience in seconds; 0 = fall back to pure Erlang C
      avgPatienceSeconds: ch === "voice" ? (a.voiceAvgPatienceSeconds ?? 120)
                        : ch === "chat"  ? (a.chatAvgPatienceSeconds  ?? 60)
                        : 0,
    };
  }, [plannerSnapshot, selectedChannel]);

  const fteTable = useMemo((): IntervalFTEResult[][] | null => {
    if (!fteParams) return null;
    return maskedDisplayForecast.map((dayData) =>
      dayData.map((calls) =>
        computeIntervalFTE(
          calls,
          grain,
          fteParams.ahtSec,
          fteParams.slaTarget,
          fteParams.slaSec,
          fteParams.emailOccupancy,
          fteParams.shrinkage,
          selectedChannel,
          fteParams.concurrency,
          fteParams.avgPatienceSeconds,
        )
      )
    );
  }, [maskedDisplayForecast, grain, fteParams, selectedChannel]);

  // Apply rolling-average smoothing to FTE values, preserving the daily total.
  const smoothedFteTable = useMemo((): IntervalFTEResult[][] | null => {
    if (!fteTable) return null;
    if (!smoothFTE) return fteTable;
    return fteTable.map((dayData) => {
      const rawFTEs = dayData.map((r) => r.fte);
      const smoothed = smoothFTEValues(rawFTEs, smoothWindow);
      return dayData.map((result, idx) => ({ ...result, fte: smoothed[idx] }));
    });
  }, [fteTable, smoothFTE, smoothWindow]);

  // Rounded-up required FTE shown in the table and committed to Scheduling.
  const roundedRequiredFteTable = useMemo((): number[][] | null => {
    if (!smoothedFteTable) return null;
    return smoothedFteTable.map((dayData) => dayData.map((r) => Math.ceil(r.fte ?? 0)));
  }, [smoothedFteTable]);

  // Commit FTE to scheduling — called by the "Commit to Scheduling" button.
  // Writes the EXACT rounded-up values shown in the Required FTE per Interval table
  // (smoothedFteTable, which already respects operating-hours mask, smoothing
  // toggle/window, and the currently selected channel assumptions).
  //
  // Grain handling: output is always 96 × 15-min slots. When display grain is
  // 30 or 60 min, each display-row value is repeated across its sub-slots (a
  // 30-min block of 1.8 FTE becomes two 15-min slots of 1.8 each — not halved,
  // because that many agents are needed throughout the block).
  async function saveCommitToScheduling() {
    if (!smoothedFteTable || !roundedRequiredFteTable || !activeLob || !targetWeekStart) return;

    const twMon = new Date(targetWeekStart + "T12:00:00");
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(twMon);
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    });

    const subSlots = grain === 15 ? 1 : grain === 30 ? 2 : 4;

    const dates: Record<string, number[]> = {};
    const weekdays: Record<string, number[]> = {};
    const erlangs_dates: Record<string, number[]> = {};
    const erlangs_weekdays: Record<string, number[]> = {};
    for (let d = 0; d < 7; d++) {
      const dayRoundedFTEs = roundedRequiredFteTable[d];
      if (!dayRoundedFTEs) continue;

      const expanded = new Array(96).fill(0) as number[];
      const expandedErlangs = new Array(96).fill(0) as number[];
      for (let i = 0; i < dayRoundedFTEs.length; i++) {
        const val = dayRoundedFTEs[i] ?? 0;
        const erl = smoothedFteTable![d]?.[i]?.erlangs ?? 0;
        for (let s = 0; s < subSlots; s++) {
          const idx = i * subSlots + s;
          if (idx < 96) { expanded[idx] = val; expandedErlangs[idx] = erl; }
        }
      }

      dates[weekDates[d]] = expanded;
      weekdays[DOW_SCHEDULE_KEYS[d]] = expanded;
      erlangs_dates[weekDates[d]] = expandedErlangs;
      erlangs_weekdays[DOW_SCHEDULE_KEYS[d]] = expandedErlangs;
    }

    const monKey = weekDates[0];
    console.log(`[Commit→Scheduling] LOB=${activeLob.id} channel=${selectedChannel} grain=${grain} smoothFTE=${smoothFTE}`);
    console.log(`[Commit→Scheduling] ${monKey} (Mon) first 24 slots:`, dates[monKey]?.slice(0, 24));
    console.log(`[Commit→Scheduling] ${monKey} (Mon) peak slots 48–56:`, dates[monKey]?.slice(48, 56));

    setCommitStatus("saving");
    try {
      await fetch(apiUrl(`/api/user-preferences?page_key=intraday_fte&lob_id=${activeLob.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: {
            dates,
            weekdays,
            erlangs_dates,
            erlangs_weekdays,
            aht_sec: fteParams!.ahtSec,
            sla_sec: fteParams!.slaSec,
            sla_target: fteParams!.slaTarget,
            channel: selectedChannel,
            grain: 15,
          },
        }),
        credentials: "include",
      });
      setCommitStatus("saved");
      toast.success(`Committed for LOB ${activeLob.name}. Mon 4:00 AM = ${dates[monKey]?.[16]?.toFixed(2) ?? "—"}`);
      setTimeout(() => setCommitStatus("idle"), 3000);
    } catch {
      setCommitStatus("idle");
    }
  }

  function handleCommitClick() {
    if (!fteParams) return;
    saveCommitToScheduling();
  }

  async function saveApproveForScheduler() {
    if (!smoothedFteTable || !roundedRequiredFteTable || !activeLob) return;
    const intervalMinutes = grain;
    const slotsPerDay = Math.ceil(1440 / intervalMinutes);
    const toHHMM = (i: number) => {
      const m = i * intervalMinutes;
      return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    };

    const rows: Array<{ channel: string; weekday: number; interval_start: string; required_fte: number }> = [];
    for (let d = 0; d < 7; d++) {
      const dayData = roundedRequiredFteTable[d] || [];
      for (let i = 0; i < Math.min(slotsPerDay, dayData.length); i++) {
        const val = dayData[i] ?? 0;
        if (val > 0) {
          rows.push({
            channel: selectedChannel,
            weekday: d,
            interval_start: toHHMM(i),
            required_fte: val,
          });
        }
      }
    }

    if (rows.length === 0) {
      toast.error("No non-zero FTE to approve. Check operating hours / data.");
      return;
    }

    setApproveStatus("saving");
    try {
      const res = await fetch(apiUrl(`/api/scheduling/demand-snapshots`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lob_id: activeLob.id,
          snapshot_label: `${activeLob.name} • ${selectedChannel} • ${new Date().toISOString().slice(0, 10)}`,
          interval_minutes: intervalMinutes,
          notes: `Approved from Intraday Forecast (smoothed=${smoothFTE}, window=${smoothWindow})`,
          rows,
        }),
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setApproveStatus("saved");
      toast.success(`Approved snapshot #${json.id} for scheduling (${rows.length} intervals)`);
      setTimeout(() => setApproveStatus("idle"), 3000);
    } catch (err: any) {
      setApproveStatus("idle");
      toast.error(`Failed to approve snapshot: ${err?.message || err}`);
    }
  }

  // Sorted date keys for the inline grid columns
  const gridDates = useMemo(() => Object.keys(rawData).sort(), [rawData]);

  // All ISO weeks for the selected baseline year, with Mon–Sun date ranges
  const weekOptions = useMemo(() => {
    const totalWeeks = getISOWeeksInYear(baselineYear);
    const fmt = (d: string) => {
      const date = new Date(d + "T12:00:00");
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };
    return Array.from({ length: totalWeeks }, (_, i) => {
      const wk = i + 1;
      const dates = getWeekDateStrings(baselineYear, wk);
      return { week: wk, label: `Week ${wk} · ${fmt(dates[0])} – ${fmt(dates[6])}`, dates };
    });
  }, [baselineYear]);

  // Column dates shown in the grid when no data is loaded (driven by selected year/week)
  const emptyGridColumns = useMemo(
    () => getWeekDateStrings(baselineYear, baselineStartWeek),
    [baselineYear, baselineStartWeek]
  );

  // Grid columns: { headerDate (for display), dataDate (for rawData lookup) }
  // - Empty: selected week dates (Mon–Sun)
  // - Single week (≤7 days): selected week dates as headers, DOW-matched stored dates for data
  // - Multi-week (>7 days): actual stored dates for both
  const gridColumns = useMemo(() => {
    if (baselineDataCount === 0) {
      return emptyGridColumns.map((d) => ({ headerDate: d, dataDate: d }));
    }
    if (baselineDataCount > 7) {
      return gridDates.map((d) => ({ headerDate: d, dataDate: d }));
    }
    // Single week: build a DOW → stored date map, then align to selected week order
    const dowToStored: Record<number, string> = {};
    gridDates.forEach((d) => {
      const jsDay = new Date(d + "T12:00:00").getDay();
      const dowIdx = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon … 6=Sun
      dowToStored[dowIdx] = d;
    });
    return emptyGridColumns.map((headerDate) => {
      const jsDay = new Date(headerDate + "T12:00:00").getDay();
      const dowIdx = jsDay === 0 ? 6 : jsDay - 1;
      return { headerDate, dataDate: dowToStored[dowIdx] ?? headerDate };
    });
  }, [baselineDataCount, emptyGridColumns, gridDates]);

  const totalIntervalCount = useMemo(
    () => Object.values(rawData).reduce((s, slots) => s + Object.keys(slots).length, 0),
    [rawData]
  );

  // Daily totals — derived from the fully-adjusted, masked display values so the
  // totals row always matches what's shown in the cells (overrides + operating hours).
  const dailyTotals = useMemo(() =>
    maskedDisplayForecast.map((day) => day.reduce((sum, v) => sum + v, 0)),
    [maskedDisplayForecast]
  );
  const grandTotal = useMemo(() => dailyTotals.reduce((sum, v) => sum + v, 0), [dailyTotals]);

  // ── Virtual scroll handler ─────────────────────────────────────────────────
  const handleEditorScroll = useCallback(() => {
    if (!editorContainerRef.current) return;
    const top = editorContainerRef.current.scrollTop;
    setVisStart(Math.max(0, Math.floor(top / ROW_HEIGHT) - 2));
  }, []);

  // ── Save profile ───────────────────────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (!activeLob || !profileName.trim()) return;
    setIsSaving(true);
    try {
      const resp = await fetch(apiUrl("/api/distribution-profiles"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lob_id: activeLob.id,
          channel: selectedChannel,
          profile_name: profileName.trim(),
          interval_weights: activeIntervalWeights,
          day_weights: distributionWeights.dayWeights,
          baseline_start_date: baselineStart,
          baseline_end_date: baselineEnd,
          sample_day_count: baselineDataCount,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((err.error as string) || "Save failed");
      }
      const saved = await resp.json() as DistributionProfile;
      setSavedProfiles((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)]);
      setSaveModalOpen(false);
      setProfileName("");
      toast.success(`Profile "${saved.profile_name}" saved`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProfile = async (id: number, name: string) => {
    if (!activeLob) return;
    try {
      await fetch(apiUrl(`/api/distribution-profiles/${id}`), { method: "DELETE" });
      setSavedProfiles((prev) => prev.filter((p) => p.id !== id));
      toast.success(`Profile "${name}" deleted`);
    } catch {
      toast.error("Failed to delete profile");
    }
  };

  const handleLoadProfile = (profile: DistributionProfile) => {
    setPrefs({ editableWeights: profile.interval_weights });
    toast.success(`Loaded profile "${profile.profile_name}"`);
  };

  // ── CSV Upload ─────────────────────────────────────────────────────────────
  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) { setCsvError("File is empty or has no data rows"); return; }
      const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
      const dateIdx = header.indexOf("date");
      const slotIdx = header.indexOf("interval_index");
      const volIdx = header.indexOf("volume");
      const ahtIdx = header.indexOf("aht");
      if (dateIdx < 0 || slotIdx < 0 || volIdx < 0) {
        setCsvError("CSV must have columns: date, interval_index, volume (aht optional)");
        return;
      }
      const newData: GridData = { ...(manualRawData ?? {}) };
      let rowsImported = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim());
        const ds = cols[dateIdx];
        const slot = parseInt(cols[slotIdx]);
        const vol = parseFloat(cols[volIdx]);
        const ahtVal = ahtIdx >= 0 ? parseFloat(cols[ahtIdx]) || 0 : 0;
        if (!ds || isNaN(slot) || isNaN(vol)) continue;
        if (!newData[ds]) newData[ds] = {};
        newData[ds][slot] = { volume: vol, aht: ahtVal };
        rowsImported++;
      }
      const csvBuckets = computeWeeklyBuckets(newData);
      const csvWeeklyVols = csvBuckets.map((b) => Math.round(b.volume));
      setPrefs({ manualRawData: newData, editableWeights: null, manualWeeklyVolumes: csvWeeklyVols });
      setCsvModalOpen(false);
      toast.success(`Imported ${rowsImported} rows from CSV · weekly volumes auto-filled (${csvBuckets.length} wk${csvBuckets.length !== 1 ? "s" : ""})`);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── Manual Weekly Volume Paste ─────────────────────────────────────────────
  const handlePasteConfirm = () => {
    const values = parseExcelPaste(pasteText);
    if (values.length < 4) {
      toast.error("Please paste at least 4 weekly volume values");
      return;
    }
    setPrefs({ manualWeeklyVolumes: values.slice(0, 52) }); // up to 52 weeks (1 year)
    setPasteModalOpen(false);
    setPasteText("");
    toast.success(`Imported ${Math.min(values.length, 52)} weekly volumes`);
  };

  // ── Inline grid paste ─────────────────────────────────────────────────────
  const handleInlineGridPaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text.trim()) return;
    const result = parseIntervalGridPaste(text);
    if (result.rowCount === 0) {
      toast.error("Could not parse pasted data. Make sure you include a time column (12:00 AM…) and day columns.");
      return;
    }
    // Remap dates: anchor column 0 to the user-selected year + starting week,
    // regardless of what dates (or synthetic labels) the parser produced.
    const mapped = result.hasRealDates
      ? result.data  // real dates from header — keep as-is
      : remapGridToWeek(result.data, result.dates, baselineYear, baselineStartWeek);

    // Merge into existing data so multiple weeks accumulate for a better median model.
    const merged = { ...(manualRawData ?? {}), ...mapped };
    const totalDays = Object.keys(merged).length;
    const totalWeeks = Math.ceil(totalDays / 7);
    // Auto-populate weekly volumes from the merged baseline so the two sections stay in sync.
    const pasteBuckets = computeWeeklyBuckets(merged);
    const pasteWeeklyVols = pasteBuckets.map((b) => Math.round(b.volume));
    setPrefs({ manualRawData: merged, editableWeights: null, manualWeeklyVolumes: pasteWeeklyVols });
    toast.success(
      `Added Wk ${baselineStartWeek} ${baselineYear} · ${result.colCount} day${result.colCount !== 1 ? "s" : ""}` +
      (result.weekCount > 1 ? ` (${result.weekCount} wks)` : "") +
      ` — ${totalDays} days total (${totalWeeks} wk${totalWeeks !== 1 ? "s" : ""}) · weekly volumes auto-filled`
    );
  }, [baselineYear, baselineStartWeek, manualRawData, setPrefs]);

  // ── Weight editor cell change ──────────────────────────────────────────────
  const handleWeightChange = (dow: number, slotIndex: number, value: string) => {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return;
    const current = editableWeights ?? distributionWeights.intervalWeights;
    const next = current.map((row) => [...row]);
    next[dow][slotIndex] = Math.max(0, parsed / 100);
    setPrefs({ editableWeights: next });
  };

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const handleExportCsv = () => {
    const intervals = makeIntervals(grain);
    const header = ["Time", ...DOW_LABELS];
    const rows = [header.join(",")];
    intervals.forEach((iv, idx) => {
      const vals = DOW_LABELS.map((_, d) => {
        const val = displayForecast[d]?.[idx] ?? 0;
        return val.toFixed(1);
      });
      rows.push(`${iv.label},${vals.join(",")}`);
    });
    // Add totals row
    rows.push(`Total,${dailyTotals.map((t) => t.toFixed(1)).join(",")}`);
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `intraday_forecast_${selectedChannel}_${monthLabels[safeOffset]?.replace(" ", "_")}_${targetWeekStart}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const intervals = useMemo(() => makeIntervals(grain), [grain]);
  const slotCount = grain === 15 ? SLOT_COUNT : grain === 30 ? SLOT_COUNT / 2 : SLOT_COUNT / 4;
  const visEnd = Math.min(slotCount, visStart + VIS_ROWS + 4);

  // Grain-aggregated medians [7][slotCount] for Table 1
  const displayMedians = useMemo(() => {
    const m = medianPattern.medians;
    if (grain === 60) return aggregateTo60Min(m);
    if (grain === 30) return aggregateTo30Min(m);
    return m;
  }, [medianPattern.medians, grain]);

  // Per-DOW sum of medians (daily totals) and grand total for Table 1
  const medianDayTotals = useMemo(
    () => displayMedians.map((d) => d.reduce((s, v) => s + v, 0)),
    [displayMedians]
  );
  const medianGrandTotal = useMemo(
    () => medianDayTotals.reduce((s, v) => s + v, 0),
    [medianDayTotals]
  );

  // Grain-aggregated interval weights [7][slotCount] for Table 2
  const displayIntervalWeights = useMemo(() => {
    const w = distributionWeights.intervalWeights;
    if (grain === 60) return aggregateTo60Min(w);
    if (grain === 30) return aggregateTo30Min(w);
    return w;
  }, [distributionWeights.intervalWeights, grain]);

  // Global FTE max across all days/intervals — used for week-level heatmap scale.
  const maxFTEGlobal = useMemo(() => {
    if (!smoothedFteTable) return 0;
    return Math.max(0, ...smoothedFteTable.flatMap((day) => day.map((r) => r?.fte ?? 0)));
  }, [smoothedFteTable]);

  // Volume tier: was this month sourced from a published recut, or is it a forecast?
  const volumeSourceLabel = useMemo((): { label: string; color: string } => {
    const recut = (plannerSnapshot as Record<string, unknown>)?.recutVolumesByChannel as Record<ChannelKey, number[]> | null | undefined;
    if (Array.isArray(recut?.[selectedChannel]) && recut![selectedChannel]!.length > 0) {
      return { label: "Recut", color: "text-blue-700 bg-blue-50 border-blue-200" };
    }
    if (plannerSnapshot?.assumptions?.startDate) {
      const { year, month } = monthFromOffset(plannerSnapshot.assumptions.startDate, safeOffset);
      const today = new Date();
      if (new Date(year, month, 1) < new Date(today.getFullYear(), today.getMonth(), 1)) {
        return { label: "Forecast · past month", color: "text-slate-600 bg-slate-100 border-slate-200" };
      }
    }
    return { label: "Forecast", color: "text-emerald-700 bg-emerald-50 border-emerald-200" };
  }, [plannerSnapshot, selectedChannel, safeOffset]);

  const { setPageData } = useWFMPageData();
  useEffect(() => {
    const a = plannerSnapshot?.assumptions;
    setPageData({
      channel: selectedChannel,
      targetMonthlyVolume,
      forecastedWeekVolume,
      grain,
      assumptions: a ? {
        aht: a.aht,
        chatAht: a.chatAht,
        emailAht: a.emailAht,
        chatConcurrency: a.chatConcurrency,
        voiceSlaTarget: a.voiceSlaTarget,
        voiceSlaAnswerSeconds: a.voiceSlaAnswerSeconds,
        chatSlaTarget: a.chatSlaTarget,
        emailSlaTarget: a.emailSlaTarget,
        shrinkage: a.shrinkage,
        operatingHoursPerDay: a.operatingHoursPerDay,
      } : null,
      fteSummary: smoothedFteTable
        ? smoothedFteTable.map((daySlots, d) => ({
            day: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][d],
            peakFTE: Math.max(...daySlots.map(s => s.fte)),
            avgFTE: daySlots.length ? Number((daySlots.reduce((s, r) => s + r.fte, 0) / daySlots.length).toFixed(1)) : 0,
          }))
        : null,
    });
    return () => setPageData(null);
  }, [selectedChannel, targetMonthlyVolume, forecastedWeekVolume, grain, plannerSnapshot, smoothedFteTable, setPageData]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // Forecast can be generated when there is real interval data OR the LOB-hours fallback is available.
  const canGenerateForecast = targetMonthlyVolume > 0 && (baselineDataCount > 0 || usingFallbackPattern) && forecastedWeekVolume > 0;

  return (
    <PageLayout title="Intraday Forecast">
      <div className="flex flex-col gap-6 max-w-[1400px] mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Intraday Forecast</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Distribute monthly forecasts into weekly, daily, and interval-level volumes
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!activeLob && (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
              <AlertTriangle className="h-3 w-3 mr-1" />Select a LOB from the top-right menu
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!canGenerateForecast}>
            <Download className="h-3.5 w-3.5 mr-1.5" />Export CSV
          </Button>
        </div>
      </div>

      {/* ── No LOB selected ── */}
      {!activeLob && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center text-amber-700">
          <AlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-70" />
          <p className="font-semibold">No Line of Business selected</p>
          <p className="text-sm mt-1 opacity-80">Use the LOB selector in the top-right corner of the header to choose a LOB.</p>
        </div>
      )}

      {/* ── Forecast Source Panel ── */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-700">
            <BarChart2 className="h-4 w-4 text-blue-500" />
            Forecast Source &amp; Target Selection
          </h2>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            {/* Target month */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">Target Month</span>
              <Select
                value={String(safeOffset)}
                onValueChange={(v) => setPrefs({ targetMonthOffset: parseInt(v), targetWeekStart: "" })}
                disabled={forecastVolumesByChannel[selectedChannel].length === 0}
              >
                <SelectTrigger className="w-36 h-8 text-sm">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {monthLabels.map((label, i) => (
                    <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Target week */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">Target Week</span>
              <Select
                value={targetWeekStart}
                onValueChange={(v) => setPrefs({ targetWeekStart: v })}
                disabled={weeksInMonth.length === 0}
              >
                <SelectTrigger className="w-52 h-8 text-sm">
                  <SelectValue placeholder="Select week" />
                </SelectTrigger>
                <SelectContent>
                  {weeksInMonth.map((w, i) => (
                    <SelectItem key={w.start} value={w.start}>
                      Wk {i + 1}: {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Monthly volume display */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">Monthly Volume</span>
              <div className="flex flex-col gap-0.5">
                <div className="h-8 flex items-center px-3 rounded-md border bg-muted/40 text-sm font-semibold min-w-[100px]">
                  {isLoadingForecast
                    ? <span className="text-muted-foreground animate-pulse">Loading...</span>
                    : targetMonthlyVolume > 0
                      ? targetMonthlyVolume.toLocaleString()
                      : <span className="text-muted-foreground">&mdash;</span>}
                </div>
                {targetMonthlyVolume > 0 && (
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${volumeSourceLabel.color}`}>
                    {volumeSourceLabel.label}
                  </span>
                )}
              </div>
            </div>

            {/* Weekly volume display */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">Week Volume</span>
              <div className="h-8 flex items-center px-3 rounded-md border bg-blue-50 dark:bg-blue-950/30 text-sm font-bold text-blue-900 dark:text-blue-100 min-w-[100px]">
                {forecastedWeekVolume > 0
                  ? Math.round(forecastedWeekVolume).toLocaleString()
                  : <span className="text-muted-foreground font-normal">&mdash;</span>}
              </div>
            </div>

            {/* Status badge */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">Source</span>
              {isLoadingForecast ? (
                <Badge variant="secondary" className="h-8 px-3 text-xs">Loading...</Badge>
              ) : plannerSnapshot ? (
                <Badge variant="default" className="h-8 px-3 text-xs bg-green-600 hover:bg-green-600">
                  Demand Planner
                </Badge>
              ) : (
                <Badge variant="destructive" className="h-8 px-3 text-xs">
                  No forecast found &mdash; run Demand Planner first
                </Badge>
              )}
            </div>
          </div>

          {/* Weekly distribution summary */}
          {weekBuckets.length > 0 && dataSource === "api" && targetMonthlyVolume > 0 && (
            <div className="mt-4 p-3 rounded-lg border bg-muted/20">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Weekly Distribution ({weekBuckets.length} week{weekBuckets.length !== 1 ? "s" : ""} of history)
                </span>
                {!hasEnoughWeeklyData && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    &lt;4 weeks — distribution may be inaccurate
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                {weekBuckets.map((wb, i) => {
                  const isSelected = wb.weekStart === targetWeekStart;
                  const isOutlier = weekOutlierFence.outlierSet.has(wb.weekStart);
                  const pos = Array.from(weekOutlierFence.fenceByPosition.entries())
                    .find(([, v]) => v !== undefined) && (() => {
                      // find fence for this week's position — imported getWeekOfMonth not available
                      // use the fenceByPosition map keyed by position; just show global stats
                      return null;
                    })();
                  return (
                    <button
                      key={wb.weekStart}
                      className={`relative text-left p-2 rounded-md border text-xs transition-colors ${
                        isSelected
                          ? isOutlier
                            ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30"
                            : "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                          : isOutlier
                            ? "border-amber-300 hover:border-amber-400 bg-amber-50/50"
                            : "border-border hover:border-blue-300 bg-background"
                      }`}
                      onClick={() => setPrefs({ targetWeekStart: wb.weekStart })}
                      title={isOutlier ? `Statistical outlier — volume ${wb.volume.toLocaleString()} is outside the expected Poisson range for this week-of-month position` : undefined}
                    >
                      {isOutlier && (
                        <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-white text-[8px] font-bold">!</span>
                      )}
                      <div className="font-medium">Wk {i + 1}: {wb.weekStart}</div>
                      <div className="text-muted-foreground">
                        {wb.volume.toLocaleString()} vol &middot; {(wb.pct * 100).toFixed(1)}%
                      </div>
                    </button>
                  );
                })}
              </div>
              {/* Outlier explanation bar */}
              {weekOutlierFence.outlierSet.size > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    <strong>{weekOutlierFence.outlierSet.size} week{weekOutlierFence.outlierSet.size > 1 ? "s" : ""}</strong> in your history are statistical outliers (Poisson ±2σ). They may reflect holidays or outages and could distort your pattern weights.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Per-Day Volume Override ── */}
          {forecastedWeekVolume > 0 && (() => {
            const mults = dayOverrideMultipliers.length === 7 ? dayOverrideMultipliers : [1,1,1,1,1,1,1];
            const anyOverride = mults.some((m) => m !== 1);
            return (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-violet-500" />
                    <span className="text-sm font-semibold">Per-Day Override</span>
                    {anyOverride ? (
                      <Badge className="text-xs bg-violet-100 text-violet-700 border border-violet-300 hover:bg-violet-100">
                        Active
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">optional — set 0 for holidays, 1.5 for +50% campaigns</span>
                    )}
                  </div>
                  {anyOverride && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground h-7"
                      onClick={() => setPrefs({ dayOverrideMultipliers: [1,1,1,1,1,1,1] })}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />Reset
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {DOW_LABELS.map((label, d) => {
                    const m = mults[d] ?? 1;
                    const baseVol = maskedDisplayForecast[d]?.reduce((s, v) => s + v, 0) ?? 0;
                    const adjustedVol = baseVol > 0 ? baseVol / (m || 1) * m : 0;
                    const isModified = m !== 1;
                    return (
                      <div key={label} className="flex flex-col items-center gap-1">
                        <span className={`text-xs font-semibold ${isModified ? "text-violet-700" : "text-muted-foreground"}`}
                          style={{ color: isModified ? undefined : DOW_COLORS[d] }}>
                          {label}
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={10}
                          step={0.1}
                          value={m}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(10, parseFloat(e.target.value) || 0));
                            const next = [...mults];
                            next[d] = +val.toFixed(2);
                            setPrefs({ dayOverrideMultipliers: next });
                          }}
                          className={`w-16 h-8 text-sm text-center rounded-md border font-mono ${
                            isModified
                              ? m === 0
                                ? "border-red-400 bg-red-50 text-red-700"
                                : "border-violet-400 bg-violet-50 text-violet-700"
                              : "border-border bg-background"
                          }`}
                          title={`${label} multiplier — ${m === 0 ? "holiday (no volume)" : m === 1 ? "normal" : `×${m} (${m > 1 ? "+" : ""}${((m-1)*100).toFixed(0)}%)`}`}
                        />
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {m === 0 ? "holiday" : adjustedVol > 0 ? Math.round(adjustedVol).toLocaleString() : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── Manual Weekly Volume Entry (always visible in this panel) ── */}
          <div className="mt-5 pt-4 border-t">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ClipboardPaste className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-semibold">Last 4 Weeks — Actual Volume</span>
                <Badge variant="outline" className="text-xs">
                  {dataSource === "api" ? "Auto from API" : "Manual Entry"}
                </Badge>
              </div>
              <div className="flex rounded-md border overflow-hidden">
                {(["api", "manual"] as const).map((src) => (
                  <button
                    key={src}
                    onClick={() => setPrefs({ dataSource: src })}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      dataSource === src
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {src === "api" ? "Auto" : "Manual"}
                  </button>
                ))}
              </div>
            </div>

            {dataSource === "manual" ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Enter weekly actual volumes (oldest → most recent). Minimum 4 weeks required; more weeks
                  normalize the distribution across multiple cycles for a better forecast.
                  {Object.keys(manualRawData ?? {}).length > 0 && manualWeeklyVolumes.some((v) => v > 0) && (
                    <span className="ml-1 text-teal-600 font-medium">Auto-filled from baseline — edit any value to override.</span>
                  )}
                </p>
                {/* Dynamic week inputs — grows as the user fills in data */}
                {(() => {
                  const filledCount = manualWeeklyVolumes.filter((v) => v > 0).length;
                  const inputCount = Math.min(Math.max(4, filledCount + 1), 52);
                  return (
                    <div className="flex flex-wrap gap-3 items-end">
                      {Array.from({ length: inputCount }, (_, i) => {
                        const vol = manualWeeklyVolumes[i] ?? 0;
                        const isOutlier = manualOutlierStats !== null && vol > 0 &&
                          (vol < manualOutlierStats.lower || vol > manualOutlierStats.upper);
                        const direction = isOutlier
                          ? vol > (manualOutlierStats?.upper ?? Infinity) ? "high" : "low"
                          : null;
                        const aiSugg = aiSuggestions.find(s => s.weekIndex === i);
                        return (
                          <div key={i} className="flex flex-col gap-1">
                            <div className="flex items-center gap-1">
                              <label className={`text-xs font-semibold ${isOutlier ? "text-amber-700" : "text-foreground"}`}>
                                Week {i + 1}{i === inputCount - 1 && filledCount >= inputCount - 1 ? " (most recent)" : ""}
                              </label>
                              {isOutlier && (
                                <span title={`${direction === "high" ? "Unusually high" : "Unusually low"} — expected range ${Math.round(manualOutlierStats!.lower).toLocaleString()}–${Math.round(manualOutlierStats!.upper).toLocaleString()}`}>
                                  {direction === "high"
                                    ? <TrendingUp className="h-3 w-3 text-amber-600" />
                                    : <TrendingDown className="h-3 w-3 text-amber-600" />}
                                </span>
                              )}
                            </div>
                            <Input
                              type="number"
                              min="0"
                              placeholder="0"
                              value={vol || ""}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const next = [...(manualWeeklyVolumes ?? [])];
                                next[i] = val;
                                setPrefs({ manualWeeklyVolumes: next });
                              }}
                              className={`w-28 h-8 text-sm ${isOutlier ? "border-amber-400 focus-visible:ring-amber-400" : ""}`}
                            />
                            {/* AI suggestion chip */}
                            {aiSugg && (
                              <div className="w-28 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px]">
                                <div className="font-semibold text-emerald-700">AI: {aiSugg.suggestedVolume.toLocaleString()}</div>
                                <div className="text-emerald-600 truncate" title={aiSugg.reason}>{aiSugg.reason}</div>
                                <button
                                  onClick={() => applyAiSuggestion(aiSugg, "manual")}
                                  className="mt-0.5 text-emerald-700 underline font-medium hover:text-emerald-900"
                                >Apply</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground invisible">or</label>
                        <Button variant="outline" size="sm" onClick={() => setPasteModalOpen(true)}>
                          <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />Paste from Excel
                        </Button>
                      </div>
                      {manualWeeklyVolumes.some((v) => v > 0) && (
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-muted-foreground invisible">clear</label>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setPrefs({ manualWeeklyVolumes: [] })}
                          >
                            <X className="h-3.5 w-3.5 mr-1.5" />Clear
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Distribution preview — all entered weeks */}
                {manualWeeklyVolumes.filter((v) => v > 0).length >= 1 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {manualWeeklyVolumes.map((vol, i) => {
                      if (!vol || vol <= 0) return null;
                      const allFilled = manualWeeklyVolumes.filter((v) => v > 0);
                      const total = allFilled.reduce((a, b) => a + b, 0);
                      const pct = total > 0 ? (vol / total * 100).toFixed(1) : "0.0";
                      return (
                        <div key={i} className="text-center px-3 py-1.5 rounded-md border bg-muted/30 text-xs">
                          <div className="text-muted-foreground">Wk {i + 1}</div>
                          <div className="font-bold">{vol.toLocaleString()}</div>
                          <div className="text-blue-600 font-medium">{pct}%</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {manualWeeklyVolumes.filter((v) => v > 0).length > 0 && manualWeeklyVolumes.filter((v) => v > 0).length < 4 && (
                  <div className="flex items-center gap-2 text-amber-600 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Enter at least 4 weeks to enable the weekly distribution calculation.
                  </div>
                )}
                {/* AI normalization — always visible in manual mode */}
                {(() => {
                  const hasOutliers = manualOutlierStats !== null && manualWeeklyVolumes.some(
                    v => v > 0 && (v < manualOutlierStats.lower || v > manualOutlierStats.upper)
                  );
                  return (
                    <div className={`flex items-start gap-3 rounded-md border px-3 py-2 text-xs ${
                      hasOutliers ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"
                    }`}>
                      {hasOutliers
                        ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                        : <Sparkles className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />}
                      <div className="flex-1">
                        {hasOutliers ? (
                          <>
                            <span className="font-semibold text-amber-800">Outlier weeks detected</span>
                            <span className="text-amber-700"> — expected range {Math.round(manualOutlierStats!.lower).toLocaleString()}–{Math.round(manualOutlierStats!.upper).toLocaleString()} (Poisson ±2σ, mean {Math.round(manualOutlierStats!.mean).toLocaleString()}). These may reflect holidays or campaigns.</span>
                          </>
                        ) : manualOutlierStats === null ? (
                          <span className="text-muted-foreground">Enter at least 4 weeks to enable AI normalization.</span>
                        ) : (
                          <span className="text-muted-foreground">All weeks are within the expected range — normalization available if needed.</span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className={`shrink-0 h-7 text-xs ${hasOutliers ? "border-amber-400 text-amber-700 hover:bg-amber-100" : ""}`}
                        onClick={() => requestAiNormalization("manual")}
                        disabled={aiLoading || manualOutlierStats === null}
                      >
                        {aiLoading
                          ? <><RotateCcw className="h-3 w-3 mr-1 animate-spin" />Thinking…</>
                          : <><Sparkles className="h-3 w-3 mr-1" />Normalize with AI</>}
                      </Button>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="space-y-2">
                {/* Baseline window preset selector */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium">Baseline window:</span>
                  {([
                    { key: "last28", label: "Last 4 weeks" },
                    { key: "sameWeekLastYear", label: "Same 4 weeks · last year" },
                    { key: "custom", label: "Custom range" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setPrefs({ apiBaselinePreset: opt.key })}
                      className={`px-2.5 py-1 rounded border text-xs font-medium transition-colors ${
                        apiBaselinePreset === opt.key
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-primary/50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {apiBaselinePreset === "custom" && (
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        value={apiBaselineCustomStart}
                        onChange={(e) => setPrefs({ apiBaselineCustomStart: e.target.value })}
                        className="h-7 text-xs rounded border border-border px-2"
                      />
                      <span className="text-xs text-muted-foreground">→</span>
                      <input
                        type="date"
                        value={apiBaselineCustomEnd}
                        onChange={(e) => setPrefs({ apiBaselineCustomEnd: e.target.value })}
                        className="h-7 text-xs rounded border border-border px-2"
                      />
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {isLoadingBaseline
                    ? <span className="animate-pulse">Loading from API ({baselineStart} → {baselineEnd})...</span>
                    : weekBuckets.length > 0
                      ? <span><span className="text-foreground font-medium">{weekBuckets.length} week{weekBuckets.length !== 1 ? "s" : ""}</span> of actual data ({baselineStart} &rarr; {baselineEnd}).</span>
                      : <span className="text-amber-600">No interval data found for this LOB/channel in the selected window. Try a different date range or switch to <strong>Manual</strong>.</span>
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Baseline Panel — Interval Pattern Data ── */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 cursor-pointer" onClick={() => setPrefs({ isBaselineOpen: !isBaselineOpen })}>
          <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-700">
            <Table2 className="h-4 w-4 text-orange-500" />
            Interval Pattern Baseline
            <span className="text-xs font-normal text-slate-400">(shapes the intraday curve)</span>
          </h2>
          <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {usingFallbackPattern && (
              <Badge variant="outline" className="text-xs text-teal-700 border-teal-300 bg-teal-50">
                LOB hours fallback — upload data to improve
              </Badge>
            )}
            {baselineDataCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {baselineDataCount} day{baselineDataCount !== 1 ? "s" : ""} · {totalIntervalCount.toLocaleString()} intervals
              </Badge>
            )}
            {isBaselineOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        </div>
        {isBaselineOpen && (
          <div className="p-4 space-y-3">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {isLoadingBaseline ? (
                  <span className="animate-pulse">Loading data from API...</span>
                ) : baselineDataCount > 0 ? (
                  <span className="flex flex-wrap gap-2 items-center">
                    <span className="text-foreground font-medium">{baselineDataCount} day{baselineDataCount !== 1 ? "s" : ""}</span>
                    <span className="opacity-60">·</span>
                    <span>{totalIntervalCount.toLocaleString()} intervals</span>
                    {DOW_LABELS.map((label, d) => {
                      const count = medianPattern.sampleCounts[d];
                      return count > 0 ? (
                        <Badge key={label} variant="outline" className="text-xs py-0" style={{ borderColor: DOW_COLORS[d], color: DOW_COLORS[d] }}>
                          {label} ×{count}
                        </Badge>
                      ) : null;
                    })}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Click the grid below and paste your Excel data (Ctrl+V)</span>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setCsvModalOpen(true)}>
                  <Upload className="h-3.5 w-3.5 mr-1.5" />Upload CSV
                </Button>
                {baselineDataCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => { setPrefs({ manualRawData: {}, editableWeights: null }); toast.success("Baseline cleared"); }}
                  >
                    <X className="h-3.5 w-3.5 mr-1.5" />Clear
                  </Button>
                )}
              </div>
            </div>

            {/* ── Baseline period selector ── */}
            <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg border bg-muted/20">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-foreground">Year</span>
                <Input
                  type="number"
                  min={2010}
                  max={new Date().getFullYear() + 2}
                  value={baselineYear}
                  onChange={(e) => {
                    const y = parseInt(e.target.value);
                    if (y >= 2010 && y <= new Date().getFullYear() + 2) {
                      setPrefs({ baselineYear: y, baselineStartWeek: 1 });
                    }
                  }}
                  className="w-24 h-8 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
                <span className="text-xs font-semibold text-foreground">Starting Week</span>
                <Select
                  value={String(baselineStartWeek)}
                  onValueChange={(v) => setPrefs({ baselineStartWeek: parseInt(v) })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {weekOptions.map((opt) => (
                      <SelectItem key={opt.week} value={String(opt.week)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1 justify-end pb-0.5">
                <span className="text-xs text-muted-foreground">
                  {baselineDataCount > 0
                    ? <>Each paste <strong>adds</strong> to the dataset — select a different week to layer more history</>
                    : <>Select a week, click the grid, paste (Ctrl+V) — repeat for each week you want to include</>
                  }
                </span>
              </div>
            </div>

            {/* ── Inline paste grid — always visible ── */}
            <div
              tabIndex={0}
              onPaste={handleInlineGridPaste}
              onFocus={() => setGridFocused(true)}
              onBlur={() => setGridFocused(false)}
              className={`rounded-lg border-2 transition-all outline-none ${
                gridFocused
                  ? "border-blue-500 ring-2 ring-blue-100 dark:ring-blue-950"
                  : "border-border hover:border-blue-200"
              }`}
            >
              {/* Instruction banner */}
              <div className={`px-4 py-2 border-b text-xs text-center transition-colors select-none ${
                gridFocused
                  ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-200"
                  : baselineDataCount === 0
                    ? "bg-muted/40 text-muted-foreground border-border"
                    : "bg-transparent text-muted-foreground/40 border-transparent"
              }`}>
                {gridFocused
                  ? "Ready — press Ctrl+V / Cmd+V to paste your Excel data"
                  : baselineDataCount === 0
                    ? "Select a week above, click anywhere in this grid, then paste from Excel (Ctrl+V) · Each week is added to the dataset"
                    : "Select the next week above, click grid + Ctrl+V to add more weeks to the model"
                }
              </div>

              {/* Grid — always rendered */}
                <Table containerClassName="overflow-auto" containerStyle={{ maxHeight: 400 }}>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background z-20 w-20 text-xs py-1.5">
                        <button
                          onClick={() => setPrefs({ hideBlankRows: !hideBlankRows })}
                          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                          title={hideBlankRows ? "Show all rows" : "Hide blank rows"}
                        >
                          {hideBlankRows ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                          Time
                        </button>
                      </TableHead>
                      {gridColumns.map(({ headerDate }, ci) => {
                        const jsDay = new Date(headerDate + "T12:00:00").getDay();
                        const dowIdx = jsDay === 0 ? 6 : jsDay - 1;
                        const dateLabel = headerDate.slice(5).replace("-", "/"); // MM/DD
                        return (
                          <TableHead
                            key={`${headerDate}-${ci}`}
                            className="text-xs text-center min-w-[48px] py-1"
                            style={{ color: DOW_COLORS[dowIdx % 7] }}
                          >
                            <div className="font-semibold">{DOW_LABELS[dowIdx]}</div>
                            <div className="font-normal text-[10px] text-muted-foreground leading-tight">
                              {dateLabel}
                            </div>
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {makeIntervals(15).map((iv, idx) => {
                      const rowVals = gridColumns.map(({ dataDate }) => rawData[dataDate]?.[idx]?.volume ?? 0);
                      const maxVal = Math.max(...rowVals);
                      const hasAny = rowVals.some((v) => v > 0);
                      if (hideBlankRows && baselineDataCount > 0 && !hasAny) return null;
                      return (
                        <TableRow
                          key={idx}
                          className={baselineDataCount > 0 && !hasAny ? "opacity-25" : undefined}
                        >
                          <TableCell className="sticky left-0 bg-background text-xs text-foreground font-mono py-0.5 z-10">
                            {iv.label}
                          </TableCell>
                          {rowVals.map((val, ci) => {
                            const intensity = maxVal > 0 ? val / maxVal : 0;
                            return (
                              <TableCell
                                key={ci}
                                className="text-xs text-center py-0.5 font-mono"
                                style={{
                                  backgroundColor: val > 0
                                    ? `rgba(34,197,94,${intensity * 0.45})`
                                    : undefined,
                                }}
                              >
                                {val > 0 ? (val % 1 === 0 ? val : val.toFixed(2)) : ""}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
            </div>
          </div>
        )}
      </section>

      {/* ── Pattern Preview Chart ── */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 flex-wrap">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            Intraday Arrival Pattern
            {patternShiftHours !== 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-700 uppercase tracking-wide">
                DST {patternShiftHours > 0 ? "+" : ""}{patternShiftHours}h
              </span>
            )}
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Pattern shift control */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-400">Pattern shift:</span>
              <button
                onClick={() => setPrefs({ patternShiftHours: Math.max(-12, patternShiftHours - 0.5) })}
                disabled={patternShiftHours <= -12}
                className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 text-sm leading-none"
                title="Shift pattern earlier by 30 min"
              >−</button>
              <span
                className={`w-12 text-center text-xs font-mono font-semibold tabular-nums ${patternShiftHours !== 0 ? "text-amber-700" : "text-slate-400"}`}
              >
                {patternShiftHours > 0 ? "+" : ""}{patternShiftHours}h
              </span>
              <button
                onClick={() => setPrefs({ patternShiftHours: Math.min(12, patternShiftHours + 0.5) })}
                disabled={patternShiftHours >= 12}
                className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 text-sm leading-none"
                title="Shift pattern later by 30 min"
              >+</button>
              {patternShiftHours !== 0 && (
                <button
                  onClick={() => setPrefs({ patternShiftHours: 0 })}
                  className="text-[10px] text-muted-foreground hover:text-destructive ml-0.5 px-1"
                  title="Reset shift to 0"
                >✕</button>
              )}
            </div>
            <div className="h-4 w-px bg-slate-200" />
            {/* Grain selector */}
            <span className="text-xs text-slate-400">Grain:</span>
            <div className="flex rounded-md border border-slate-200 overflow-hidden">
              {([15, 30, 60] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setPrefs({ grain: g })}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    grain === g
                      ? "bg-slate-800 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {g} min
                </button>
              ))}
            </div>
          </div>
        </div>
        {usingFallbackPattern && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-teal-200 bg-teal-50 text-xs text-teal-800">
            <Info className="h-3.5 w-3.5 shrink-0 text-teal-600" />
            <span>
              <strong>Flat distribution · LOB hours fallback</strong> — no historical interval data yet. Volume is distributed uniformly across operating hours. Upload real data in the <em>Interval Pattern Baseline</em> section below to replace this estimate.
            </span>
          </div>
        )}
        <div className="p-4">
          {!canGenerateForecast ? (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
              {targetMonthlyVolume === 0
                ? "Select a month with forecast data to see the pattern"
                : !usingFallbackPattern && baselineDataCount === 0
                  ? "Upload baseline data or switch to Manual Entry to generate the arrival pattern"
                  : "Select a target week to generate the forecast"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  {DOW_LABELS.map((label, d) => (
                    <linearGradient key={label} id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={DOW_COLORS[d]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={DOW_COLORS[d]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10 }}
                  interval={grain === 15 ? 7 : grain === 30 ? 3 : 1}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 10 }} width={50} tickLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(v: number) => [v.toFixed(1), ""]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {DOW_LABELS.map((label, d) => (
                  <Area
                    key={label}
                    type="monotone"
                    dataKey={label}
                    stroke={DOW_COLORS[d]}
                    fill={`url(#grad-${label})`}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* ── Forecast Results Table ── */}
      {canGenerateForecast && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-700">
              <Table2 className="h-4 w-4 text-indigo-500" />
              Interval Forecast &mdash; {targetWeekStart && weeksInMonth.find((w) => w.start === targetWeekStart)?.label}
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">
                Grand Total: <span className="font-bold text-slate-700">{Math.round(grandTotal).toLocaleString()}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowForecastTable((v) => !v)}
              >
                {showForecastTable ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          {showForecastTable && (
            <div>
              <Table containerClassName="overflow-auto border-t" containerStyle={{ maxHeight: 500 }}>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="w-24 text-xs sticky left-0 bg-background z-20">
                        <button
                          onClick={() => setPrefs({ hideBlankRows: !hideBlankRows })}
                          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                          title={hideBlankRows ? "Show all rows" : "Hide blank rows"}
                        >
                          {hideBlankRows ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                          Time
                        </button>
                      </TableHead>
                      {DOW_LABELS.map((label, d) => (
                        <TableHead
                          key={label}
                          className="text-xs text-right min-w-[80px]"
                          style={{ color: DOW_COLORS[d] }}
                        >
                          {label}
                        </TableHead>
                      ))}
                      <TableHead className="text-xs text-right min-w-[80px] font-bold">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {intervals.map((iv, idx) => {
                      if (hideBlankRows && blankIntervalSet.has(idx)) return null;
                      const rowTotal = DOW_LABELS.reduce((sum, _, d) => sum + (displayForecast[d]?.[idx] ?? 0), 0);
                      const maxVal = Math.max(...DOW_LABELS.map((_, d) => displayForecast[d]?.[idx] ?? 0));
                      return (
                        <TableRow key={idx}>
                          <TableCell className="text-xs text-foreground py-1.5 sticky left-0 bg-background">
                            {iv.label}
                          </TableCell>
                          {DOW_LABELS.map((_, d) => {
                            const val = displayForecast[d]?.[idx] ?? 0;
                            const intensity = maxVal > 0 ? val / maxVal : 0;
                            return (
                              <TableCell
                                key={d}
                                className="text-xs text-right py-1.5 font-mono"
                                style={{
                                  backgroundColor: val > 0
                                    ? `rgba(34, 197, 94, ${intensity * 0.3})`
                                    : undefined
                                }}
                              >
                                {val > 0 ? Math.round(val).toLocaleString() : "0"}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-xs text-right py-1.5 font-mono font-bold">
                            {Math.round(rowTotal).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {/* Totals row */}
                    <TableRow className="bg-muted/40 border-t-2">
                      <TableCell className="text-xs font-bold py-2 sticky left-0 bg-muted/40">Total</TableCell>
                      {DOW_LABELS.map((_, d) => (
                        <TableCell key={d} className="text-xs text-right py-2 font-mono font-bold">
                          {Math.round(dailyTotals[d]).toLocaleString()}
                        </TableCell>
                      ))}
                      <TableCell className="text-xs text-right py-2 font-mono font-black text-blue-600">
                        {Math.round(grandTotal).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {/* ── Required FTE per Interval ── */}
      {canGenerateForecast && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-slate-200 cursor-pointer"
            onClick={() => setShowFTETable((v) => !v)}
          >
            <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-700">
              <Table2 className="h-4 w-4 text-orange-500" />
              Required FTE per Interval
              <span className="text-xs font-normal text-slate-400">
                (Erlang C — min. agents to meet SLA, grossed up for shrinkage)
              </span>
            </h2>
            {showFTETable ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
          {showFTETable && (
            <div>
              {/* Assumptions banner */}
              {fteParams ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-2 border-b text-xs text-muted-foreground bg-muted/20">
                  <span><span className="font-semibold text-foreground">AHT</span> {fteParams.ahtSec}s</span>
                  {selectedChannel !== "email" && (
                    <span><span className="font-semibold text-foreground">SLA</span> {fteParams.slaTarget}% in {fteParams.slaSec}s</span>
                  )}
                  <span><span className="font-semibold text-foreground">Shrinkage</span> {fteParams.shrinkage}%</span>
                  {selectedChannel === "chat" && (
                    <span><span className="font-semibold text-foreground">Concurrency</span> {fteParams.concurrency}</span>
                  )}
                  {(selectedChannel === "voice" || selectedChannel === "chat") && fteParams.avgPatienceSeconds > 0 && (
                    <span title="Erlang A: average seconds before a customer abandons the queue"><span className="font-semibold text-foreground">Patience</span> {fteParams.avgPatienceSeconds}s</span>
                  )}
                  <span><span className="font-semibold text-foreground">FTE hrs/day</span> {shrinkageHoursPerDay}h</span>
                  <span className="text-[10px] italic">
                    {selectedChannel === "email"
                      ? "Email: workload ÷ available agent-seconds per interval"
                      : selectedChannel === "chat"
                      ? "Chat: Erlang C with concurrency-adjusted demand"
                      : selectedChannel === "cases"
                      ? "Cases: Erlang C queuing model (SLA-driven)"
                      : "Voice: Erlang C queuing model"}
                  </span>
                  {/* Smooth toggle + heatmap + window slider + Commit button */}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => setPrefs({ showFteHeatmap: !showFteHeatmap })}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs transition-colors ${
                        showFteHeatmap
                          ? "bg-red-100 border-red-300 text-red-700"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                      title="Heatmap: color scale is week-wide (red = peak across all days) instead of row-relative"
                    >
                      <LayoutDashboard className="h-3 w-3" />
                      Heatmap
                    </button>
                    <button
                      onClick={() => setPrefs({ smoothFTE: !smoothFTE })}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs transition-colors ${
                        smoothFTE
                          ? "bg-orange-100 border-orange-300 text-orange-700"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                      title="Smooth FTE with a rolling average that preserves the daily total"
                    >
                      <SlidersHorizontal className="h-3 w-3" />
                      Smooth
                    </button>
                    {!smoothFTE && (
                      <span className="text-[10px] italic text-amber-600" title="Raw Erlang output often has isolated zero-FTE intervals that make shifts hard to build around. Smoothing preserves the daily total while eliminating gaps.">
                        Recommended before committing
                      </span>
                    )}
                    {smoothFTE && (
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-muted-foreground">Window</span>
                        <input
                          type="range"
                          min={1} max={5} step={1}
                          value={smoothWindow}
                          onChange={(e) => setPrefs({ smoothWindow: Number(e.target.value) })}
                          className="w-20 accent-orange-500"
                        />
                        <span className="font-semibold text-foreground w-10">
                          {smoothWindow * 2 + 1} int
                        </span>
                      </div>
                    )}
                    <div className="h-4 w-px bg-border" />
                    <button
                      onClick={handleCommitClick}
                      disabled={commitStatus === "saving"}
                      className={`flex items-center gap-1 px-2.5 py-0.5 rounded border text-xs font-medium transition-colors ${
                        commitStatus === "saved"
                          ? "bg-emerald-100 border-emerald-300 text-emerald-700"
                          : commitStatus === "saving"
                          ? "opacity-60 cursor-not-allowed border-border text-muted-foreground"
                          : grain !== 15
                          ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                          : "bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100"
                      }`}
                      title="Save this FTE plan to the Schedule Editor's Required row"
                    >
                      {commitStatus === "saved" ? (
                        <><Save className="h-3 w-3" /> Committed</>
                      ) : commitStatus === "saving" ? (
                        <><RotateCcw className="h-3 w-3 animate-spin" /> Saving…</>
                      ) : (
                        <><Save className="h-3 w-3" /> Commit to Scheduling{grain !== 15 ? " ⚠" : ""}</>
                      )}
                    </button>
                    <button
                      onClick={saveApproveForScheduler}
                      disabled={approveStatus === "saving"}
                      className={`flex items-center gap-1 px-2.5 py-0.5 rounded border text-xs font-medium transition-colors ${
                        approveStatus === "saved"
                          ? "bg-emerald-100 border-emerald-300 text-emerald-700"
                          : approveStatus === "saving"
                          ? "opacity-60 cursor-not-allowed border-border text-muted-foreground"
                          : "bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100"
                      }`}
                      title="Freeze this Required-FTE curve as a scheduler snapshot for auto-generation"
                    >
                      {approveStatus === "saved" ? (
                        <><Save className="h-3 w-3" /> Approved</>
                      ) : approveStatus === "saving" ? (
                        <><RotateCcw className="h-3 w-3 animate-spin" /> Approving…</>
                      ) : (
                        <><Save className="h-3 w-3" /> Approve for Scheduler</>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-6 py-3 border-b text-xs text-amber-700 bg-amber-50">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  No demand assumptions found for this LOB. Open the <strong className="mx-1">Long-Term Forecast → Demand</strong> page, configure a scenario, and return here.
                </div>
              )}
              {smoothedFteTable && roundedRequiredFteTable && (
                <Table containerClassName="overflow-auto border-t" containerStyle={{ maxHeight: 500 }}>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="w-24 text-xs sticky left-0 bg-background z-20">
                        <button
                          onClick={(e) => { e.stopPropagation(); setPrefs({ hideBlankRows: !hideBlankRows }); }}
                          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                          title={hideBlankRows ? "Show all rows" : "Hide blank rows"}
                        >
                          {hideBlankRows ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                          Time
                        </button>
                      </TableHead>
                      {DOW_LABELS.map((label, d) => (
                        <TableHead
                          key={label}
                          className="text-xs text-right min-w-[72px]"
                          style={{ color: DOW_COLORS[d] }}
                        >
                          {label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {intervals.map((iv, idx) => {
                      if (hideBlankRows && blankIntervalSet.has(idx)) return null;
                      const rowVals = DOW_LABELS.map((_, d) => smoothedFteTable[d]?.[idx]);
                      const rowMaxFTE = Math.max(...rowVals.map((r) => r?.fte ?? 0));
                      return (
                        <TableRow key={idx}>
                          <TableCell className="text-xs text-foreground py-1.5 sticky left-0 bg-background font-mono">
                            {iv.label}
                          </TableCell>
                          {rowVals.map((result, d) => {
                            const fte = result?.fte ?? 0;
                            const roundedFte = roundedRequiredFteTable[d]?.[idx] ?? 0;
                            // Heatmap: intensity relative to weekly peak so hot spots are
                            // visible across all days (not just within each row).
                            const denominator = showFteHeatmap ? maxFTEGlobal : rowMaxFTE;
                            const intensity = denominator > 0 ? fte / denominator : 0;
                            let bgColor: string | undefined;
                            if (roundedFte > 0) {
                              if (showFteHeatmap) {
                                // Red (peak) → amber (mid) → green (low)
                                const r = Math.round(22 + intensity * (239 - 22));
                                const g = Math.round(197 - intensity * (197 - 68));
                                bgColor = `rgba(${r},${g},22,${0.15 + intensity * 0.55})`;
                              } else {
                                bgColor = `rgba(249, 115, 22, ${0.1 + intensity * 0.45})`;
                              }
                            }
                            return (
                              <TableCell
                                key={d}
                                className="text-xs text-right py-1.5 font-mono"
                                title={result && result.rawAgents > 0
                                  ? `Required FTE: ${roundedFte} | On-phone agents: ${result.rawAgents} | A=${result.erlangs} Erl${selectedChannel !== "email" ? ` | SL: ${result.achievedSL}% | Occ: ${result.occupancy}%` : ` | Occ: ${result.occupancy}%`}`
                                  : undefined}
                                style={{ backgroundColor: bgColor }}
                              >
                                {roundedFte > 0 ? String(roundedFte) : ""}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                    {/* Required FTE per Day row
                        Formula: sum(FTE_interval × grainHours) / hoursPerDay
                        e.g. 60-min grain: sum(all FTE) / 7.5
                             15-min grain: sum(all FTE) × 0.25 / 7.5            */}
                    <TableRow className="bg-orange-50 dark:bg-orange-950/20 border-t-2">
                      <TableCell
                        className="text-xs font-bold py-2 sticky left-0 bg-orange-50 dark:bg-orange-950/20 text-orange-700 whitespace-nowrap"
                        title={`Sum of all interval FTE × ${(grain / 60).toFixed(2)}h ÷ ${shrinkageHoursPerDay}h/day`}
                      >
                        Daily FTE
                      </TableCell>
                      {DOW_LABELS.map((_, d) => {
                        const grainHours = grain / 60;
                        const sumFTE = intervals.reduce((sum, _, idx) => {
                          if (hideBlankRows && blankIntervalSet.has(idx)) return sum;
                          return sum + (smoothedFteTable[d]?.[idx]?.fte ?? 0);
                        }, 0);
                        const dailyFTE = sumFTE * grainHours / shrinkageHoursPerDay;
                        return (
                          <TableCell
                            key={d}
                            className="text-xs text-right py-2 font-mono font-bold text-orange-700"
                            title={`${sumFTE.toFixed(1)} interval-FTE × ${grainHours}h ÷ ${shrinkageHoursPerDay}h`}
                          >
                            {dailyFTE > 0 ? dailyFTE.toFixed(2) : "—"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                    {/* Expected SLA row — volume-weighted average of achieved SL per interval */}
                    <TableRow className="bg-orange-50 dark:bg-orange-950/20">
                      <TableCell
                        className="text-xs font-semibold py-2 sticky left-0 bg-orange-50 dark:bg-orange-950/20 text-orange-700 whitespace-nowrap"
                        title="Volume-weighted average of achieved SL% across all displayed intervals"
                      >
                        Exp. SLA
                      </TableCell>
                      {DOW_LABELS.map((_, d) => {
                        if (selectedChannel === "email") {
                          return <TableCell key={d} className="text-xs text-right py-2 text-muted-foreground">N/A</TableCell>;
                        }
                        let weightedSL = 0, totalCalls = 0;
                        intervals.forEach((_, idx) => {
                          if (hideBlankRows && blankIntervalSet.has(idx)) return;
                          const calls = displayForecast[d]?.[idx] ?? 0;
                          const sl = smoothedFteTable[d]?.[idx]?.achievedSL ?? 0;
                          weightedSL += sl * calls;
                          totalCalls += calls;
                        });
                        const expSLA = totalCalls > 0 ? weightedSL / totalCalls : 0;
                        const target = fteParams?.slaTarget ?? 0;
                        const meetsTarget = expSLA >= target;
                        return (
                          <TableCell
                            key={d}
                            className="text-xs text-right py-2 font-mono font-semibold"
                            style={{ color: expSLA > 0 ? (meetsTarget ? "#16a34a" : "#dc2626") : undefined }}
                            title={`Target: ${target}%`}
                          >
                            {expSLA > 0 ? `${expSLA.toFixed(1)}%` : "—"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                    {/* Abandon % row — Erlang A only, voice and chat */}
                    {(selectedChannel === "voice" || selectedChannel === "chat") && fteParams && fteParams.avgPatienceSeconds > 0 && (
                    <TableRow className="bg-red-50 dark:bg-red-950/20">
                      <TableCell
                        className="text-xs font-semibold py-2 sticky left-0 bg-red-50 dark:bg-red-950/20 text-red-700 whitespace-nowrap"
                        title="Volume-weighted average abandonment rate (Erlang A). Red when > 5% — industry warning threshold."
                      >
                        Abandon %
                      </TableCell>
                      {DOW_LABELS.map((_, d) => {
                        let weightedAbandon = 0, totalCalls = 0;
                        intervals.forEach((_, idx) => {
                          if (hideBlankRows && blankIntervalSet.has(idx)) return;
                          const calls = displayForecast[d]?.[idx] ?? 0;
                          const ab = smoothedFteTable[d]?.[idx]?.abandonRate ?? 0;
                          weightedAbandon += ab * calls;
                          totalCalls += calls;
                        });
                        const expAbandon = totalCalls > 0 ? (weightedAbandon / totalCalls) * 100 : 0;
                        const isHigh = expAbandon > 5;
                        return (
                          <TableCell
                            key={d}
                            className="text-xs text-right py-2 font-mono font-semibold"
                            style={{ color: expAbandon > 0 ? (isHigh ? "#dc2626" : "#16a34a") : undefined }}
                            title={isHigh ? "Above 5% threshold — consider adding agents or adjusting patience parameter" : undefined}
                          >
                            {expAbandon > 0 ? `${expAbandon.toFixed(1)}%` : "—"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Day Weights Summary ── */}
      {baselineDataCount > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-700">Day-of-Week Weights</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-7 gap-2">
              {DOW_LABELS.map((label, d) => (
                <div key={label} className="text-center">
                  <div
                    className="text-xs font-semibold mb-1"
                    style={{ color: DOW_COLORS[d] }}
                  >
                    {label}
                  </div>
                  <div className="text-sm font-bold text-slate-700">
                    {(distributionWeights.dayWeights[d] * 100).toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Table 1: Median Pattern ── */}
      {baselineDataCount > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-slate-200 cursor-pointer"
            onClick={() => setShowMedianTable((v) => !v)}
          >
            <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-700">
              <Table2 className="h-4 w-4 text-teal-500" />
              Table 1 — Median Pattern
              <span className="text-xs font-normal text-slate-400">
                (median volume per interval &amp; day)
              </span>
            </h2>
            <span className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                Grand total: {medianGrandTotal.toFixed(1)}
              </Badge>
              <div
                className="flex rounded-md border border-slate-200 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {([15, 30, 60] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setPrefs({ grain: g })}
                    className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                      grain === g
                        ? "bg-slate-800 text-white"
                        : "bg-white text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {g === 60 ? "1 hr" : `${g} min`}
                  </button>
                ))}
              </div>
              {showMedianTable ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </span>
          </div>
          {showMedianTable && (
            <div>
              <Table containerClassName="overflow-auto border-t" containerStyle={{ maxHeight: 480 }}>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="w-24 text-xs sticky left-0 bg-background z-20">
                        <button
                          onClick={() => setPrefs({ hideBlankRows: !hideBlankRows })}
                          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                          title={hideBlankRows ? "Show all rows" : "Hide blank rows"}
                        >
                          {hideBlankRows ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                          Time
                        </button>
                      </TableHead>
                      {DOW_LABELS.map((label, d) => (
                        <TableHead
                          key={label}
                          className="text-xs text-right min-w-[80px]"
                          style={{ color: DOW_COLORS[d] }}
                        >
                          {label}
                        </TableHead>
                      ))}
                      <TableHead className="text-xs text-right min-w-[80px] font-bold">Sum</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {intervals.map((iv, idx) => {
                      if (hideBlankRows && blankIntervalSet.has(idx)) return null;
                      const rowVals = DOW_LABELS.map((_, d) => displayMedians[d]?.[idx] ?? 0);
                      const rowSum = rowVals.reduce((s, v) => s + v, 0);
                      const maxVal = Math.max(...rowVals);
                      return (
                        <TableRow key={idx}>
                          <TableCell className="text-xs text-foreground py-1 sticky left-0 bg-background font-mono">
                            {iv.label}
                          </TableCell>
                          {rowVals.map((val, d) => {
                            const intensity = maxVal > 0 ? val / maxVal : 0;
                            return (
                              <TableCell
                                key={d}
                                className="text-xs text-right py-1 font-mono"
                                style={{
                                  backgroundColor: val > 0
                                    ? `rgba(20, 184, 166, ${intensity * 0.35})`
                                    : undefined,
                                }}
                              >
                                {val > 0 ? val.toFixed(2) : "0"}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-xs text-right py-1 font-mono font-semibold">
                            {rowSum.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/40 border-t-2">
                      <TableCell className="text-xs font-bold py-2 sticky left-0 bg-muted/40">Sum per day</TableCell>
                      {DOW_LABELS.map((_, d) => (
                        <TableCell key={d} className="text-xs text-right py-2 font-mono font-bold">
                          {medianDayTotals[d].toFixed(1)}
                        </TableCell>
                      ))}
                      <TableCell className="text-xs text-right py-2 font-mono font-black text-teal-600">
                        {medianGrandTotal.toFixed(1)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {/* ── Table 2: Distribution Model ── */}
      {baselineDataCount > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-slate-200 cursor-pointer"
            onClick={() => setShowDistributionTable((v) => !v)}
          >
            <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-700">
              <Table2 className="h-4 w-4 text-purple-500" />
              Table 2 — Arrival Pattern Model
              <span className="text-xs font-normal text-slate-400">
                (% distribution weights)
              </span>
            </h2>
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {medianPattern.sampleCounts.reduce((s, c) => s + c, 0)} total samples
              </Badge>
              {showDistributionTable ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </span>
          </div>
          {showDistributionTable && (
            <div>
              <Table containerClassName="overflow-auto border-t" containerStyle={{ maxHeight: 480 }}>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="w-24 text-xs sticky left-0 bg-background z-20">
                        <button
                          onClick={() => setPrefs({ hideBlankRows: !hideBlankRows })}
                          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                          title={hideBlankRows ? "Show all rows" : "Hide blank rows"}
                        >
                          {hideBlankRows ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                          Time
                        </button>
                      </TableHead>
                      {DOW_LABELS.map((label, d) => (
                        <TableHead
                          key={label}
                          className="text-xs text-right min-w-[80px]"
                          style={{ color: DOW_COLORS[d] }}
                        >
                          {label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="bg-slate-50 dark:bg-slate-900 border-b-2">
                      <TableCell className="text-xs font-bold py-2 sticky left-0 bg-slate-50 dark:bg-slate-900">
                        DOW Weight
                      </TableCell>
                      {DOW_LABELS.map((_, d) => (
                        <TableCell
                          key={d}
                          className="text-xs text-right py-2 font-mono font-bold"
                          style={{ color: DOW_COLORS[d] }}
                        >
                          {(distributionWeights.dayWeights[d] * 100).toFixed(2)}%
                        </TableCell>
                      ))}
                    </TableRow>
                    {intervals.map((iv, idx) => {
                      if (hideBlankRows && blankIntervalSet.has(idx)) return null;
                      const rowVals = DOW_LABELS.map((_, d) => displayIntervalWeights[d]?.[idx] ?? 0);
                      const maxVal = Math.max(...rowVals);
                      return (
                        <TableRow key={idx}>
                          <TableCell className="text-xs text-foreground py-1 sticky left-0 bg-background font-mono">
                            {iv.label}
                          </TableCell>
                          {rowVals.map((val, d) => {
                            const intensity = maxVal > 0 ? val / maxVal : 0;
                            return (
                              <TableCell
                                key={d}
                                className="text-xs text-right py-1 font-mono"
                                style={{
                                  backgroundColor: val > 0
                                    ? `rgba(147, 51, 234, ${intensity * 0.3})`
                                    : undefined,
                                }}
                              >
                                {val > 0 ? (val * 100).toFixed(3) + "%" : "0%"}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {/* ── Weight Editor ── */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-700">
            <Edit2 className="h-4 w-4 text-purple-500" />
            Interval Weight Editor
            {editableWeights && (
              <Badge variant="secondary" className="text-xs">Custom weights active</Badge>
            )}
          </h2>
          <div className="flex gap-2">
            {editableWeights && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setPrefs({ editableWeights: null }); toast.success("Reset to computed weights"); }}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />Reset
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditingWeights((v) => !v)}
              disabled={baselineDataCount === 0}
            >
              {isEditingWeights ? <><X className="h-3.5 w-3.5 mr-1.5" />Close</> : <><Edit2 className="h-3.5 w-3.5 mr-1.5" />Edit Weights</>}
            </Button>
          </div>
        </div>
        {isEditingWeights && baselineDataCount > 0 && (
          <div>
            <p className="text-xs text-slate-400 px-6 pt-3 pb-2">
              Values are % of daily volume for each interval. Changes are applied immediately to the chart and table above.
            </p>
            <div
              ref={editorContainerRef}
              className="overflow-auto border-t"
              style={{ maxHeight: 400 }}
              onScroll={handleEditorScroll}
            >
              <div style={{ height: slotCount * ROW_HEIGHT }}>
                <Table containerClassName="overflow-x-clip">
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="w-24 text-xs">Time</TableHead>
                      {DOW_LABELS.map((label, d) => (
                        <TableHead key={label} className="text-xs text-center" style={{ color: DOW_COLORS[d] }}>
                          {label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visStart > 0 && (
                      <tr style={{ height: visStart * ROW_HEIGHT }}><td colSpan={8} /></tr>
                    )}
                    {intervals.slice(visStart, visEnd).map((iv, relIdx) => {
                      const absIdx = visStart + relIdx;
                      return (
                        <TableRow key={absIdx} style={{ height: ROW_HEIGHT }}>
                          <TableCell className="text-xs text-muted-foreground py-0">{iv.label}</TableCell>
                          {DOW_LABELS.map((_, d) => {
                            const w = activeIntervalWeights[d]?.[absIdx] ?? 0;
                            return (
                              <TableCell key={d} className="py-0 px-1">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="100"
                                  value={(w * 100).toFixed(3)}
                                  onChange={(e) => handleWeightChange(d, absIdx, e.target.value)}
                                  className="h-6 text-xs text-center px-1 w-full"
                                />
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                    {visEnd < slotCount && (
                      <tr style={{ height: (slotCount - visEnd) * ROW_HEIGHT }}><td colSpan={8} /></tr>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Profile Manager ── */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-700">
            <Save className="h-4 w-4 text-green-500" />
            Distribution Profiles
            <Badge variant="outline" className="text-xs">{selectedChannel}</Badge>
          </h2>
          <Button
            size="sm"
            onClick={() => setSaveModalOpen(true)}
            disabled={baselineDataCount === 0 || !canGenerateForecast}
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />Save Current
          </Button>
        </div>
        <div className="p-4">
          {isLoadingProfiles ? (
            <p className="text-sm text-slate-400 animate-pulse">Loading profiles...</p>
          ) : savedProfiles.length === 0 ? (
            <p className="text-sm text-slate-400">
              No saved profiles for this LOB + channel yet. Compute a pattern and save it.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {savedProfiles.map((profile) => (
                <div
                  key={profile.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-700">{profile.profile_name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {profile.baseline_start_date && profile.baseline_end_date
                        ? `Baseline: ${profile.baseline_start_date} \u2192 ${profile.baseline_end_date}`
                        : "No baseline metadata"}
                      {profile.sample_day_count ? ` \u00b7 ${profile.sample_day_count} days` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleLoadProfile(profile)}>
                      Load
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteProfile(profile.id, profile.profile_name)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>


      {/* ── Save Profile Dialog ── */}
      <Dialog open={saveModalOpen} onOpenChange={setSaveModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save Distribution Profile</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Profile Name</span>
              <Input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder='e.g. "Steady State" or "Pre-Holiday"'
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveProfile(); }}
                autoFocus
              />
            </div>
            <div className="text-xs text-muted-foreground">
              Channel: <strong>{selectedChannel}</strong> &middot;
              Month: <strong>{monthLabels[safeOffset]}</strong> &middot;
              Week: <strong>{targetWeekStart}</strong> &middot;
              Baseline: <strong>{baselineDataCount} days</strong>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSaveModalOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveProfile} disabled={!profileName.trim() || isSaving}>
                {isSaving ? "Saving..." : "Save Profile"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── CSV Upload Dialog ── */}
      <Dialog open={csvModalOpen} onOpenChange={setCsvModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Baseline CSV</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Expected CSV format:</p>
              <code className="text-xs block bg-muted px-2 py-1 rounded">
                date,interval_index,volume,aht<br />
                2026-03-10,36,42,245<br />
                2026-03-10,37,38,251<br />
                ...
              </code>
              <ul className="mt-2 space-y-0.5 text-xs list-disc list-inside">
                <li><code>date</code> &mdash; YYYY-MM-DD</li>
                <li><code>interval_index</code> &mdash; 0-95 (15-min slot)</li>
                <li><code>volume</code> &mdash; integer contact count</li>
                <li><code>aht</code> &mdash; average handle time in seconds (optional)</li>
              </ul>
            </div>
            {csvError && (
              <p className="text-sm text-destructive">{csvError}</p>
            )}
            <div className="flex justify-between items-center">
              <label className="cursor-pointer">
                <input type="file" accept=".csv,.txt" className="hidden" onChange={handleCsvFile} />
                <Button asChild variant="default">
                  <span><Upload className="h-3.5 w-3.5 mr-1.5" />Choose File</span>
                </Button>
              </label>
              <Button variant="outline" onClick={() => { setCsvModalOpen(false); setCsvError(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Manual Paste Dialog ── */}
      <Dialog open={pasteModalOpen} onOpenChange={setPasteModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Paste Weekly Volume Data</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <div className="text-sm text-muted-foreground">
              Paste at least 4 weekly total volumes from Excel. Values can be one per line,
              tab-separated, or comma-separated. The system will compute the distribution pattern
              from these values.
            </div>
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Example:</p>
              <code className="block bg-muted px-2 py-1 rounded">
                3260<br />
                3180<br />
                3420<br />
                3050
              </code>
            </div>
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              onPaste={(e) => {
                // Allow native paste to fill the textarea
                setTimeout(() => {
                  const val = (e.target as HTMLTextAreaElement).value;
                  setPasteText(val);
                }, 0);
              }}
              placeholder="Paste weekly volumes here (one per line, or tab/comma separated)..."
              rows={6}
              autoFocus
            />
            {pasteText && (
              <div className="text-xs text-muted-foreground">
                Detected {parseExcelPaste(pasteText).length} values:{" "}
                {parseExcelPaste(pasteText).map((v) => v.toLocaleString()).join(", ")}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setPasteModalOpen(false); setPasteText(""); }}>
                Cancel
              </Button>
              <Button
                onClick={handlePasteConfirm}
                disabled={parseExcelPaste(pasteText).length < 4}
              >
                <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
                Import {parseExcelPaste(pasteText).length} Values
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </PageLayout>
  );
};
