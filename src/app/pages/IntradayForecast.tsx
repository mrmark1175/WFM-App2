import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { BarChart2, Download, Edit2, RotateCcw, Save, Trash2, Upload, X, ChevronDown, ChevronUp, ClipboardPaste, AlertTriangle, Calendar, Table2 } from "lucide-react";
import { toast } from "sonner";
import { apiUrl } from "../lib/api";
import { useLOB } from "../lib/lobContext";
import { usePagePreferences } from "../lib/usePagePreferences";
import { PageLayout } from "../components/PageLayout";
import { getCalculatedVolumes, Assumptions } from "./forecasting-logic";
import {
  GridData, DOW_LABELS, SLOT_COUNT,
  computeMedianPattern, computeDistributionWeights,
  distributeWeeklyVolumeToIntervals, distributeMonthlyToTargetWeek,
  computeWeeklyBuckets,
  aggregateTo30Min, aggregateTo60Min, buildChartData, generateMonthLabels, monthFromOffset,
  makeIntervals, getWeeksInMonth, parseExcelPaste, parseIntervalGridPaste, GridPasteResult,
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
type ChannelKey = "voice" | "email" | "chat";

interface PlannerSnapshot {
  assumptions: Assumptions;
  forecastMethod: string;
  hwParams: { alpha: number; beta: number; gamma: number; seasonLength: number };
  arimaParams: { p: number; d: number; q: number };
  decompParams: { trendStrength: number; seasonalityStrength: number };
  channelHistoricalApiData: Record<ChannelKey, number[]>;
  channelHistoricalOverrides: Record<ChannelKey, Record<number, string>>;
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
  selectedChannel: ChannelKey;
  targetMonthOffset: number;
  targetWeekStart: string;
  grain: 15 | 30 | 60;
  isBaselineOpen: boolean;
  dataSource: "api" | "manual";
}

const CHANNEL_VOLUME_FACTORS: Record<ChannelKey, number> = { voice: 1, email: 0.2, chat: 0.3 };
const DEFAULT_PREFS: IntradayPrefs = {
  selectedChannel: "voice",
  targetMonthOffset: 0,
  targetWeekStart: "",
  grain: 15,
  isBaselineOpen: true,
  dataSource: "api",
};
const DOW_COLORS = ["#2563eb", "#0891b2", "#16a34a", "#d97706", "#9333ea", "#e11d48", "#94a3b8"];

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
  const { activeLob } = useLOB();
  const [prefs, setPrefs] = usePagePreferences<IntradayPrefs>("intraday_forecast", DEFAULT_PREFS);
  const { selectedChannel, targetMonthOffset, targetWeekStart, grain, isBaselineOpen, dataSource } = prefs;

  // ── State ──────────────────────────────────────────────────────────────────
  const [plannerSnapshot, setPlannerSnapshot] = useState<PlannerSnapshot | null>(null);
  const [rawData, setRawData] = useState<GridData>({});
  const [manualWeeklyVolumes, setManualWeeklyVolumes] = useState<number[]>([]);
  const [savedProfiles, setSavedProfiles] = useState<DistributionProfile[]>([]);
  const [editableWeights, setEditableWeights] = useState<number[][] | null>(null);
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
  const [gridPasteModalOpen, setGridPasteModalOpen] = useState(false);
  const [gridPasteText, setGridPasteText] = useState("");
  const [gridPastePreview, setGridPastePreview] = useState<GridPasteResult | null>(null);
  const [showForecastTable, setShowForecastTable] = useState(true);

  // Virtual scroll for weight editor
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [visStart, setVisStart] = useState(0);
  const ROW_HEIGHT = 36;
  const VIS_ROWS = 20;

  // ── Derived 4-week date range ──────────────────────────────────────────────
  const { baselineStart, baselineEnd } = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 27); // 28 days inclusive
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    return { baselineStart: fmt(start), baselineEnd: fmt(end) };
  }, []);

  // ── Load forecast state ────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeLob) return;
    setIsLoadingForecast(true);
    fetch(apiUrl(`/api/demand-planner-active-state?lob_id=${activeLob.id}`))
      .then((r) => r.json())
      .then((data: { selectedScenarioId?: string; plannerSnapshot?: Partial<PlannerSnapshot> } | null) => {
        if (data?.plannerSnapshot) {
          setPlannerSnapshot(data.plannerSnapshot as PlannerSnapshot);
        } else {
          setPlannerSnapshot(null);
        }
      })
      .catch(() => setPlannerSnapshot(null))
      .finally(() => setIsLoadingForecast(false));
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
        setRawData(newData);
        setEditableWeights(null);
      })
      .catch(() => setRawData({}))
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

  // ── Forecast computation ───────────────────────────────────────────────────
  const forecastVolumesByChannel = useMemo<Record<ChannelKey, number[]>>(() => {
    const empty = { voice: [] as number[], email: [] as number[], chat: [] as number[] };
    if (!plannerSnapshot) return empty;
    const { forecastMethod, hwParams, arimaParams, decompParams, assumptions,
            channelHistoricalApiData = {} as Record<ChannelKey, number[]>,
            channelHistoricalOverrides = {} as Record<ChannelKey, Record<number, string>> } = plannerSnapshot;

    const getHistory = (ch: ChannelKey) =>
      applyHistoricalOverrides(channelHistoricalApiData[ch] ?? [], channelHistoricalOverrides[ch] ?? {});

    const voiceHistory = getHistory("voice");
    const emailHistory = getHistory("email");
    const chatHistory = getHistory("chat");

    const voiceForecast = getCalculatedVolumes(voiceHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams);
    const emailForecast = emailHistory.length > 0
      ? getCalculatedVolumes(emailHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
      : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.email));
    const chatForecast = chatHistory.length > 0
      ? getCalculatedVolumes(chatHistory, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
      : voiceForecast.map((v) => Math.round(v * CHANNEL_VOLUME_FACTORS.chat));

    return { voice: voiceForecast, email: emailForecast, chat: chatForecast };
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

  const hasEnoughWeeklyData = weekBuckets.length >= 4;

  // Compute the forecasted weekly volume
  const forecastedWeekVolume = useMemo(() => {
    if (targetMonthlyVolume === 0 || !targetWeekStart) return 0;

    if (dataSource === "manual") {
      // Use manual weekly volumes to compute distribution pattern
      // Require at least 4 entries (index 0-3 filled with non-zero values)
      const filledVolumes = manualWeeklyVolumes.slice(0, 4);
      const filledCount = filledVolumes.filter((v) => v > 0).length;
      if (filledCount < 4) return 0;
      const total = filledVolumes.reduce((a, b) => a + b, 0);
      if (total === 0) return 0;
      const weekIdx = weeksInMonth.findIndex((w) => w.start === targetWeekStart);
      const safeIdx = Math.min(weekIdx >= 0 ? weekIdx : 0, filledVolumes.length - 1);
      const pct = filledVolumes[safeIdx] / total;
      return targetMonthlyVolume * pct;
    }

    if (dataSource === "api" && weekBuckets.length > 0) {
      return distributeMonthlyToTargetWeek(targetMonthlyVolume, weekBuckets, targetWeekStart);
    }

    // Fallback: simple division by weeks in month
    return weeksInMonth.length > 0 ? targetMonthlyVolume / weeksInMonth.length : 0;
  }, [targetMonthlyVolume, targetWeekStart, weekBuckets, manualWeeklyVolumes, dataSource, weeksInMonth]);

  // ── Distribution computation ───────────────────────────────────────────────
  const medianPattern = useMemo(() => computeMedianPattern(rawData), [rawData]);
  const distributionWeights = useMemo(
    () => computeDistributionWeights(medianPattern.medians),
    [medianPattern]
  );
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

  const displayForecast = useMemo(() => {
    if (grain === 60) return aggregateTo60Min(weekForecast);
    if (grain === 30) return aggregateTo30Min(weekForecast);
    return weekForecast;
  }, [weekForecast, grain]);

  const chartData = useMemo(() => buildChartData(displayForecast, grain), [displayForecast, grain]);

  const baselineDataCount = useMemo(() => Object.keys(rawData).length, [rawData]);
  const totalIntervalCount = useMemo(
    () => Object.values(rawData).reduce((s, slots) => s + Object.keys(slots).length, 0),
    [rawData]
  );

  // Daily totals for the forecast table
  const dailyTotals = useMemo(() =>
    weekForecast.map((day) => day.reduce((sum, v) => sum + v, 0)),
    [weekForecast]
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
    setEditableWeights(profile.interval_weights);
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
      const newData: GridData = { ...rawData };
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
      setRawData(newData);
      setEditableWeights(null);
      setCsvModalOpen(false);
      toast.success(`Imported ${rowsImported} rows from CSV`);
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
    setManualWeeklyVolumes(values.slice(0, 8)); // max 8 weeks
    setPasteModalOpen(false);
    setPasteText("");
    toast.success(`Imported ${Math.min(values.length, 8)} weekly volumes`);
  };

  // ── Interval Grid Paste ────────────────────────────────────────────────────
  const handleGridPasteChange = (text: string) => {
    setGridPasteText(text);
    if (text.trim()) {
      const result = parseIntervalGridPaste(text);
      setGridPastePreview(result.rowCount > 0 ? result : null);
    } else {
      setGridPastePreview(null);
    }
  };

  const handleGridPasteConfirm = () => {
    if (!gridPastePreview || gridPastePreview.rowCount === 0) {
      toast.error("No valid interval data detected. Check the pasted format.");
      return;
    }
    setRawData(gridPastePreview.data);
    setEditableWeights(null);
    setGridPasteModalOpen(false);
    setGridPasteText("");
    setGridPastePreview(null);
    toast.success(
      `Imported ${gridPastePreview.rowCount} time slots × ${gridPastePreview.colCount} days` +
      (gridPastePreview.hasRealDates ? ` (with real dates)` : ` (Mon–Sun pattern)`)
    );
  };

  // ── Weight editor cell change ──────────────────────────────────────────────
  const handleWeightChange = (dow: number, slotIndex: number, value: string) => {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return;
    setEditableWeights((prev) => {
      const next = prev
        ? prev.map((row) => [...row])
        : distributionWeights.intervalWeights.map((row) => [...row]);
      next[dow][slotIndex] = Math.max(0, parsed / 100);
      return next;
    });
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

  // ── Render ─────────────────────────────────────────────────────────────────
  const forecastMethodLabel = plannerSnapshot?.forecastMethod
    ? { holtwinters: "Holt-Winters", arima: "ARIMA", decomposition: "Decomposition",
        ma: "Moving Average", yoy: "Year-over-Year", regression: "Linear Regression",
        genesys: "Genesys Sync" }[plannerSnapshot.forecastMethod] ?? plannerSnapshot.forecastMethod
    : null;

  // Interval pattern data (for intraday shape) always requires baseline
  const canGenerateForecast = targetMonthlyVolume > 0 && baselineDataCount > 0 && forecastedWeekVolume > 0;

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
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="py-8 text-center text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-70" />
            <p className="font-semibold">No Line of Business selected</p>
            <p className="text-sm mt-1 opacity-80">Use the LOB selector in the top-right corner of the header to choose a LOB.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Forecast Source Panel ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-blue-500" />
            Forecast Source &amp; Target Selection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            {/* Channel */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Channel</span>
              <Select value={selectedChannel} onValueChange={(v) => setPrefs({ selectedChannel: v as ChannelKey, targetMonthOffset: 0, targetWeekStart: "" })}>
                <SelectTrigger className="w-32 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="voice">Voice</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="chat">Chat</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Target month */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Target Month</span>
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
              <span className="text-xs font-medium text-muted-foreground">Target Week</span>
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
              <span className="text-xs font-medium text-muted-foreground">Monthly Volume</span>
              <div className="h-8 flex items-center px-3 rounded-md border bg-muted/40 text-sm font-semibold min-w-[100px]">
                {isLoadingForecast
                  ? <span className="text-muted-foreground animate-pulse">Loading...</span>
                  : targetMonthlyVolume > 0
                    ? targetMonthlyVolume.toLocaleString()
                    : <span className="text-muted-foreground">&mdash;</span>}
              </div>
            </div>

            {/* Weekly volume display */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Week Volume</span>
              <div className="h-8 flex items-center px-3 rounded-md border bg-blue-50 dark:bg-blue-950/30 text-sm font-bold text-blue-700 dark:text-blue-300 min-w-[100px]">
                {forecastedWeekVolume > 0
                  ? Math.round(forecastedWeekVolume).toLocaleString()
                  : <span className="text-muted-foreground font-normal">&mdash;</span>}
              </div>
            </div>

            {/* Status badge */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Source</span>
              {isLoadingForecast ? (
                <Badge variant="secondary" className="h-8 px-3 text-xs">Loading...</Badge>
              ) : plannerSnapshot ? (
                <Badge variant="default" className="h-8 px-3 text-xs bg-green-600 hover:bg-green-600">
                  Demand Planner{forecastMethodLabel ? ` \u00b7 ${forecastMethodLabel}` : ""}
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
                  return (
                    <button
                      key={wb.weekStart}
                      className={`text-left p-2 rounded-md border text-xs transition-colors ${
                        isSelected
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                          : "border-border hover:border-blue-300 bg-background"
                      }`}
                      onClick={() => setPrefs({ targetWeekStart: wb.weekStart })}
                    >
                      <div className="font-medium">Wk {i + 1}: {wb.weekStart}</div>
                      <div className="text-muted-foreground">
                        {wb.volume.toLocaleString()} vol &middot; {(wb.pct * 100).toFixed(1)}%
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
                  Enter the last 4 weeks of actual total weekly volumes. These percentages will be used
                  to distribute the monthly forecast to the selected target week.
                </p>
                {/* Inline 4-week inputs */}
                <div className="flex flex-wrap gap-3 items-end">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        Week {i + 1} {i === 3 ? "(most recent)" : ""}
                      </label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={manualWeeklyVolumes[i] ?? ""}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setManualWeeklyVolumes((prev) => {
                            const next = [...prev];
                            next[i] = val;
                            return next;
                          });
                        }}
                        className="w-28 h-8 text-sm"
                      />
                    </div>
                  ))}
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
                        onClick={() => setManualWeeklyVolumes([])}
                      >
                        <X className="h-3.5 w-3.5 mr-1.5" />Clear
                      </Button>
                    </div>
                  )}
                </div>

                {/* Distribution preview */}
                {manualWeeklyVolumes.filter((v) => v > 0).length >= 4 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {manualWeeklyVolumes.slice(0, 4).map((vol, i) => {
                      const total = manualWeeklyVolumes.slice(0, 4).reduce((a, b) => a + b, 0);
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
                    Enter all 4 weeks to enable the weekly distribution calculation.
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                {isLoadingBaseline
                  ? <span className="animate-pulse">Loading last 4 weeks from API...</span>
                  : weekBuckets.length > 0
                    ? <span><span className="text-foreground font-medium">{weekBuckets.length} week{weekBuckets.length !== 1 ? "s" : ""}</span> of actual data loaded automatically from the Interaction Arrival data ({baselineStart} &rarr; {baselineEnd}).</span>
                    : <span className="text-amber-600">No interval data found for this LOB/channel in the last 28 days. Switch to <strong>Manual</strong> to enter weekly volumes, or upload data via the Historical Baseline section below.</span>
                }
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Baseline Panel — Interval Pattern Data ── */}
      <Card>
        <CardHeader className="pb-3 cursor-pointer" onClick={() => setPrefs({ isBaselineOpen: !isBaselineOpen })}>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Table2 className="h-4 w-4 text-orange-500" />
              Interval Pattern Baseline
              <span className="text-xs font-normal text-muted-foreground">(shapes the intraday curve)</span>
            </span>
            <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {baselineDataCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {baselineDataCount} day{baselineDataCount !== 1 ? "s" : ""} · {totalIntervalCount.toLocaleString()} intervals
                </Badge>
              )}
              {isBaselineOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </span>
          </CardTitle>
        </CardHeader>
        {isBaselineOpen && (
          <CardContent className="space-y-4">
            {/* Status row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                {isLoadingBaseline ? (
                  <span className="animate-pulse">Loading baseline data from API...</span>
                ) : baselineDataCount > 0 ? (
                  <span>
                    Pattern computed from{" "}
                    <span className="text-foreground font-medium">{baselineDataCount} days</span>
                    {" "}({baselineStart} &rarr; {baselineEnd})
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">
                    No interval data yet. Paste from Excel or upload a CSV to define the intraday shape.
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setGridPasteModalOpen(true)}
                >
                  <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />Paste from Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => setCsvModalOpen(true)}>
                  <Upload className="h-3.5 w-3.5 mr-1.5" />Upload CSV
                </Button>
                {baselineDataCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => { setRawData({}); setEditableWeights(null); toast.success("Baseline cleared"); }}
                  >
                    <X className="h-3.5 w-3.5 mr-1.5" />Clear
                  </Button>
                )}
              </div>
            </div>

            {/* Format hint when no data */}
            {baselineDataCount === 0 && (
              <div className="rounded-lg border border-dashed p-4 bg-muted/20">
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Expected Excel layout</p>
                <div className="overflow-x-auto">
                  <table className="text-xs border-collapse font-mono">
                    <thead>
                      <tr className="bg-muted/60">
                        <td className="border px-2 py-1 font-bold">Date</td>
                        {["05/12","05/13","05/14","05/15","05/16","05/17","05/18"].map((d) => (
                          <td key={d} className="border px-2 py-1 text-center">{d}</td>
                        ))}
                      </tr>
                      <tr className="bg-muted/40">
                        <td className="border px-2 py-1 font-bold">Day</td>
                        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
                          <td key={d} className="border px-2 py-1 text-center">{d}</td>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[["12:00 AM","3","0","2","0","1","0","2"],
                        ["12:30 AM","0","1","0","0","1","0","3"],
                        ["1:00 AM","0","0","0","0","1","3","2"],
                        ["…","…","…","…","…","…","…","…"]].map((row, ri) => (
                        <tr key={ri} className={ri % 2 === 0 ? "bg-white dark:bg-slate-950" : "bg-muted/20"}>
                          {row.map((cell, ci) => (
                            <td key={ci} className={`border px-2 py-1 ${ci === 0 ? "font-bold" : "text-center"}`}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Copy this range from Excel (including headers) and click <strong>Paste from Excel</strong>. Works with 15-min, 30-min, or 60-min intervals. Real dates or day labels are both supported.
                </p>
              </div>
            )}

            {/* Day coverage badges */}
            {baselineDataCount > 0 && (
              <div className="flex flex-wrap gap-2">
                {DOW_LABELS.map((label, d) => {
                  const count = medianPattern.sampleCounts[d];
                  return (
                    <Badge key={label} variant="outline" className="text-xs" style={{ borderColor: DOW_COLORS[d] }}>
                      {label}: {count} day{count !== 1 ? "s" : ""}
                    </Badge>
                  );
                })}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ── Pattern Preview Chart ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Intraday Arrival Pattern</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Grain:</span>
              <div className="flex rounded-md border overflow-hidden">
                {([15, 30, 60] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setPrefs({ grain: g })}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      grain === g
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {g} min
                  </button>
                ))}
              </div>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!canGenerateForecast ? (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
              {targetMonthlyVolume === 0
                ? "Select a month with forecast data to see the pattern"
                : baselineDataCount === 0
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
        </CardContent>
      </Card>

      {/* ── Forecast Results Table ── */}
      {canGenerateForecast && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Table2 className="h-4 w-4 text-indigo-500" />
                Interval Forecast &mdash; {targetWeekStart && weeksInMonth.find((w) => w.start === targetWeekStart)?.label}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Grand Total: <span className="font-bold text-foreground">{Math.round(grandTotal).toLocaleString()}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowForecastTable((v) => !v)}
                >
                  {showForecastTable ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          {showForecastTable && (
            <CardContent className="p-0">
              <div className="overflow-auto border-t" style={{ maxHeight: 500 }}>
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="w-24 text-xs sticky left-0 bg-background z-20">Time</TableHead>
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
                      const rowTotal = DOW_LABELS.reduce((sum, _, d) => sum + (displayForecast[d]?.[idx] ?? 0), 0);
                      const maxVal = Math.max(...DOW_LABELS.map((_, d) => displayForecast[d]?.[idx] ?? 0));
                      return (
                        <TableRow key={idx}>
                          <TableCell className="text-xs text-muted-foreground py-1.5 sticky left-0 bg-background">
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
            </CardContent>
          )}
        </Card>
      )}

      {/* ── Day Weights Summary ── */}
      {baselineDataCount > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Day-of-Week Weights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2">
              {DOW_LABELS.map((label, d) => (
                <div key={label} className="text-center">
                  <div
                    className="text-xs font-semibold mb-1"
                    style={{ color: DOW_COLORS[d] }}
                  >
                    {label}
                  </div>
                  <div className="text-sm font-bold">
                    {(distributionWeights.dayWeights[d] * 100).toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Weight Editor ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Edit2 className="h-4 w-4 text-purple-500" />
              Interval Weight Editor
              {editableWeights && (
                <Badge variant="secondary" className="text-xs">Custom weights active</Badge>
              )}
            </span>
            <div className="flex gap-2">
              {editableWeights && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setEditableWeights(null); toast.success("Reset to computed weights"); }}
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
          </CardTitle>
        </CardHeader>
        {isEditingWeights && baselineDataCount > 0 && (
          <CardContent className="p-0">
            <p className="text-xs text-muted-foreground px-6 pb-2">
              Values are % of daily volume for each interval. Changes are applied immediately to the chart and table above.
            </p>
            <div
              ref={editorContainerRef}
              className="overflow-auto border-t"
              style={{ maxHeight: 400 }}
              onScroll={handleEditorScroll}
            >
              <div style={{ height: slotCount * ROW_HEIGHT }}>
                <Table>
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
          </CardContent>
        )}
      </Card>

      {/* ── Profile Manager ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Save className="h-4 w-4 text-green-500" />
              Distribution Profiles
              <Badge variant="outline" className="text-xs">{selectedChannel}</Badge>
            </span>
            <Button
              size="sm"
              onClick={() => setSaveModalOpen(true)}
              disabled={baselineDataCount === 0 || !canGenerateForecast}
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />Save Current
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingProfiles ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading profiles...</p>
          ) : savedProfiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No saved profiles for this LOB + channel yet. Compute a pattern and save it.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {savedProfiles.map((profile) => (
                <div
                  key={profile.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                >
                  <div>
                    <p className="text-sm font-medium">{profile.profile_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
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
        </CardContent>
      </Card>

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
      {/* ── Interval Grid Paste Dialog ── */}
      <Dialog open={gridPasteModalOpen} onOpenChange={(open) => { setGridPasteModalOpen(open); if (!open) { setGridPasteText(""); setGridPastePreview(null); } }}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardPaste className="h-4 w-4 text-orange-500" />
              Paste Interval Data from Excel
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <div className="text-sm text-muted-foreground">
              Copy a range from Excel where <strong>rows = time slots</strong> (e.g. 12:00 AM, 12:30 AM…) and <strong>columns = days</strong> (Mon–Sun). Include the date/day header row — real dates like <code>05/12</code> will be used directly.
            </div>

            {/* Example format */}
            <div className="rounded-lg border border-dashed bg-muted/20 p-3 overflow-x-auto">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Copy this layout from Excel:</p>
              <table className="text-xs border-collapse font-mono">
                <tbody>
                  {[
                    ["Date","05/12","05/13","05/14","05/15","05/16","05/17","05/18"],
                    ["Day","Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
                    ["12:00 AM","3","0","2","0","1","0","2"],
                    ["12:30 AM","0","1","0","0","1","0","3"],
                    ["1:00 AM","0","0","0","0","1","3","2"],
                    ["…","…","…","…","…","…","…","…"],
                  ].map((row, ri) => (
                    <tr key={ri} className={ri < 2 ? "bg-slate-200 dark:bg-slate-700 font-bold" : ri % 2 === 0 ? "bg-white dark:bg-slate-950" : "bg-muted/30"}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-center min-w-[52px]">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paste area */}
            <Textarea
              value={gridPasteText}
              onChange={(e) => handleGridPasteChange(e.target.value)}
              onPaste={(e) => {
                setTimeout(() => {
                  handleGridPasteChange((e.target as HTMLTextAreaElement).value);
                }, 0);
              }}
              placeholder="Paste your Excel data here (Ctrl+V / Cmd+V)..."
              rows={10}
              className="font-mono text-xs"
              autoFocus
            />

            {/* Live parse preview */}
            {gridPasteText && (
              <div className={`rounded-lg border p-3 text-sm ${gridPastePreview && gridPastePreview.rowCount > 0 ? "border-green-300 bg-green-50 dark:bg-green-950/20" : "border-amber-300 bg-amber-50 dark:bg-amber-950/20"}`}>
                {gridPastePreview && gridPastePreview.rowCount > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-green-700 dark:text-green-400">
                      <span>✓ Detected {gridPastePreview.rowCount} time slots × {gridPastePreview.colCount} days</span>
                      <Badge variant="outline" className="text-xs border-green-400 text-green-700 dark:text-green-400">
                        {gridPastePreview.grain}-min grain
                      </Badge>
                      {gridPastePreview.hasRealDates && (
                        <Badge variant="outline" className="text-xs border-blue-400 text-blue-700 dark:text-blue-400">
                          Real dates
                        </Badge>
                      )}
                    </div>
                    {/* Mini heatmap preview — first 8 rows, all days */}
                    <div className="overflow-x-auto mt-1">
                      <table className="text-xs border-collapse w-full">
                        <thead>
                          <tr className="bg-muted/60">
                            <th className="border px-2 py-1 text-left font-medium text-muted-foreground w-20">Time</th>
                            {gridPastePreview.dates.map((d, di) => (
                              <th key={di} className="border px-1 py-1 text-center font-medium" style={{ color: DOW_COLORS[di % 7] }}>
                                {d.slice(5)} {/* MM-DD */}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            // Get first 8 non-empty slots for preview
                            const previewSlots: Array<{ time: string; vols: number[] }> = [];
                            const sortedSlots = Object.entries(gridPastePreview.data[gridPastePreview.dates[0]] ?? {})
                              .sort(([a], [b]) => Number(a) - Number(b))
                              .slice(0, 8);
                            const maxVol = Math.max(...gridPastePreview.dates.flatMap((d) =>
                              Object.values(gridPastePreview.data[d] ?? {}).map((s) => s.volume)
                            ));
                            return sortedSlots.map(([slotStr]) => {
                              const slot = Number(slotStr);
                              const mins = slot * 15;
                              const h = Math.floor(mins / 60);
                              const m = mins % 60;
                              const period = h < 12 ? "AM" : "PM";
                              const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
                              const timeLabel = `${dh}:${m.toString().padStart(2,"0")} ${period}`;
                              const vols = gridPastePreview.dates.map((d) => gridPastePreview.data[d]?.[slot]?.volume ?? 0);
                              return (
                                <tr key={slot}>
                                  <td className="border px-2 py-0.5 text-muted-foreground font-mono">{timeLabel}</td>
                                  {vols.map((v, vi) => {
                                    const intensity = maxVol > 0 ? v / maxVol : 0;
                                    return (
                                      <td
                                        key={vi}
                                        className="border px-1 py-0.5 text-center font-mono"
                                        style={{ backgroundColor: v > 0 ? `rgba(34,197,94,${intensity * 0.5})` : undefined }}
                                      >
                                        {Math.round(v)}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                      {Object.keys(gridPastePreview.data[gridPastePreview.dates[0]] ?? {}).length > 8 && (
                        <p className="text-xs text-muted-foreground mt-1 text-center">
                          … and {Object.keys(gridPastePreview.data[gridPastePreview.dates[0]] ?? {}).length - 8} more rows
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-amber-700 dark:text-amber-400 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>Could not detect a valid interval grid. Make sure rows are time slots and columns are days, with a header row.</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setGridPasteModalOpen(false); setGridPasteText(""); setGridPastePreview(null); }}>
                Cancel
              </Button>
              <Button
                onClick={handleGridPasteConfirm}
                disabled={!gridPastePreview || gridPastePreview.rowCount === 0}
              >
                <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
                Import {gridPastePreview?.rowCount ?? 0} Slots × {gridPastePreview?.colCount ?? 0} Days
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      </div>
    </PageLayout>
  );
};
