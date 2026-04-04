import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { BarChart2, Download, Edit2, RotateCcw, Save, Trash2, Upload, X, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { apiUrl } from "../lib/api";
import { useLOB } from "../lib/lobContext";
import { usePagePreferences } from "../lib/usePagePreferences";
import { getCalculatedVolumes, Assumptions } from "./forecasting-logic";
import {
  GridData, DOW_LABELS, SLOT_COUNT,
  computeMedianPattern, computeDistributionWeights, distributeMonthlyVolumeToWeek,
  aggregateTo30Min, buildChartData, generateMonthLabels, monthFromOffset, makeIntervals, fmtSlot,
} from "./intraday-distribution-logic";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

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
  grain: 15 | 30;
  isBaselineOpen: boolean;
}

const CHANNEL_VOLUME_FACTORS: Record<ChannelKey, number> = { voice: 1, email: 0.2, chat: 0.3 };
const DEFAULT_PREFS: IntradayPrefs = {
  selectedChannel: "voice",
  targetMonthOffset: 0,
  grain: 15,
  isBaselineOpen: true,
};
const DOW_COLORS = ["#94a3b8", "#2563eb", "#0891b2", "#16a34a", "#d97706", "#9333ea", "#e11d48"];

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
  const { selectedChannel, targetMonthOffset, grain, isBaselineOpen } = prefs;

  // ── State ──────────────────────────────────────────────────────────────────
  const [plannerSnapshot, setPlannerSnapshot] = useState<PlannerSnapshot | null>(null);
  const [rawData, setRawData] = useState<GridData>({});
  const [savedProfiles, setSavedProfiles] = useState<DistributionProfile[]>([]);
  const [editableWeights, setEditableWeights] = useState<number[][] | null>(null);
  const [isEditingWeights, setIsEditingWeights] = useState(false);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingForecast, setIsLoadingForecast] = useState(false);
  const [isLoadingBaseline, setIsLoadingBaseline] = useState(false);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);

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
    if (!activeLob) return;
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
        setEditableWeights(null); // reset edits on channel/LOB change
      })
      .catch(() => setRawData({}))
      .finally(() => setIsLoadingBaseline(false));
  }, [activeLob?.id, selectedChannel, baselineStart, baselineEnd]);

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

  const safeOffset = Math.min(targetMonthOffset, forecastVolumesByChannel[selectedChannel].length - 1);
  const targetMonthlyVolume = forecastVolumesByChannel[selectedChannel][safeOffset] ?? 0;
  const { year: targetYear, month: targetMonthIndex } = useMemo(
    () => plannerSnapshot?.assumptions?.startDate
      ? monthFromOffset(plannerSnapshot.assumptions.startDate, safeOffset)
      : { year: new Date().getFullYear(), month: new Date().getMonth() },
    [plannerSnapshot?.assumptions?.startDate, safeOffset]
  );

  // ── Distribution computation ───────────────────────────────────────────────
  const medianPattern = useMemo(() => computeMedianPattern(rawData), [rawData]);
  const distributionWeights = useMemo(
    () => computeDistributionWeights(medianPattern.medians),
    [medianPattern]
  );
  const activeIntervalWeights = editableWeights ?? distributionWeights.intervalWeights;
  const weekForecast = useMemo(
    () => distributeMonthlyVolumeToWeek(
      targetMonthlyVolume, targetYear, targetMonthIndex,
      distributionWeights.dayWeights, activeIntervalWeights
    ),
    [targetMonthlyVolume, targetYear, targetMonthIndex, distributionWeights.dayWeights, activeIntervalWeights]
  );
  const displayForecast = useMemo(
    () => grain === 30 ? aggregateTo30Min(weekForecast) : weekForecast,
    [weekForecast, grain]
  );
  const chartData = useMemo(() => buildChartData(displayForecast, grain), [displayForecast, grain]);

  const baselineDataCount = useMemo(() => Object.keys(rawData).length, [rawData]);
  const totalIntervalCount = useMemo(
    () => Object.values(rawData).reduce((s, slots) => s + Object.keys(slots).length, 0),
    [rawData]
  );

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
      // Expect header: date,interval_index,volume,aht
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

  // ── Weight editor cell change ──────────────────────────────────────────────
  const handleWeightChange = (dow: number, slotIndex: number, value: string) => {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return;
    setEditableWeights((prev) => {
      const next = prev
        ? prev.map((row) => [...row])
        : distributionWeights.intervalWeights.map((row) => [...row]);
      next[dow][slotIndex] = Math.max(0, parsed / 100); // stored as fraction 0-1
      return next;
    });
  };

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const handleExportCsv = () => {
    const intervals = makeIntervals(grain);
    const rows = ["Day,Time," + intervals.map((iv) => iv.label).join(",")];
    DOW_LABELS.forEach((dow, d) => {
      const vals = intervals.map((iv) =>
        iv.indices.reduce((s, i) => s + (weekForecast[d]?.[i] ?? 0), 0).toFixed(1)
      );
      rows.push(`${dow},${new Date().getFullYear()},${vals.join(",")}`);
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `distribution_${selectedChannel}_${monthLabels[safeOffset]?.replace(" ", "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const intervals = useMemo(() => makeIntervals(grain), [grain]);
  const slotCount = grain === 15 ? SLOT_COUNT : SLOT_COUNT / 2;
  const visEnd = Math.min(slotCount, visStart + VIS_ROWS + 4);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!activeLob) {
    return (
      <div className="p-8 text-muted-foreground">Select a Line of Business to get started.</div>
    );
  }

  const forecastMethodLabel = plannerSnapshot?.forecastMethod
    ? { holtwinters: "Holt-Winters", arima: "ARIMA", decomposition: "Decomposition",
        ma: "Moving Average", yoy: "Year-over-Year", regression: "Linear Regression",
        genesys: "Genesys Sync" }[plannerSnapshot.forecastMethod] ?? plannerSnapshot.forecastMethod
    : null;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Intra-Day Distribution Engine</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Distribute monthly forecasts into 15/30-min interval volumes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">{activeLob.lob_name}</Badge>
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={targetMonthlyVolume === 0}>
            <Download className="h-3.5 w-3.5 mr-1.5" />Export CSV
          </Button>
        </div>
      </div>

      {/* ── Forecast Source Panel ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-blue-500" />
            Forecast Source
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            {/* Channel */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Channel</span>
              <Select value={selectedChannel} onValueChange={(v) => setPrefs({ selectedChannel: v as ChannelKey, targetMonthOffset: 0 })}>
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
                onValueChange={(v) => setPrefs({ targetMonthOffset: parseInt(v) })}
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

            {/* Monthly volume display */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Forecasted Volume</span>
              <div className="h-8 flex items-center px-3 rounded-md border bg-muted/40 text-sm font-semibold min-w-[100px]">
                {isLoadingForecast
                  ? <span className="text-muted-foreground animate-pulse">Loading…</span>
                  : targetMonthlyVolume > 0
                    ? targetMonthlyVolume.toLocaleString()
                    : <span className="text-muted-foreground">—</span>}
              </div>
            </div>

            {/* Status badge */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Source</span>
              {isLoadingForecast ? (
                <Badge variant="secondary" className="h-8 px-3 text-xs">Loading…</Badge>
              ) : plannerSnapshot ? (
                <Badge variant="default" className="h-8 px-3 text-xs bg-green-600 hover:bg-green-600">
                  Demand Planner{forecastMethodLabel ? ` · ${forecastMethodLabel}` : ""}
                </Badge>
              ) : (
                <Badge variant="destructive" className="h-8 px-3 text-xs">
                  No forecast found — run Demand Planner first
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Baseline Panel ── */}
      <Card>
        <CardHeader className="pb-3 cursor-pointer" onClick={() => setPrefs({ isBaselineOpen: !isBaselineOpen })}>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-orange-500" />
              Historical Baseline
            </span>
            {isBaselineOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CardTitle>
        </CardHeader>
        {isBaselineOpen && (
          <CardContent>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm text-muted-foreground">
                {isLoadingBaseline ? (
                  <span className="animate-pulse">Loading baseline data…</span>
                ) : baselineDataCount > 0 ? (
                  <span>
                    <span className="text-foreground font-medium">{baselineDataCount} days</span> of data loaded
                    &nbsp;({baselineStart} → {baselineEnd}) ·{" "}
                    <span className="text-foreground font-medium">{totalIntervalCount.toLocaleString()}</span> intervals
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">
                    No interval data found for this LOB/channel in the last 28 days.
                    Upload a CSV or enter data in Interaction Arrival.
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setCsvModalOpen(true)}>
                  <Upload className="h-3.5 w-3.5 mr-1.5" />Upload CSV
                </Button>
              </div>
            </div>

            {baselineDataCount > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
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
            <span>Arrival Pattern Preview</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Grain:</span>
              <div className="flex rounded-md border overflow-hidden">
                {([15, 30] as const).map((g) => (
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
          {targetMonthlyVolume === 0 ? (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
              Select a month with forecast data to see the pattern
            </div>
          ) : baselineDataCount === 0 ? (
            <div className="flex items-center justify-center h-48 text-sm text-amber-600 dark:text-amber-400">
              Upload baseline data to generate the arrival pattern
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
                  interval={grain === 15 ? 7 : 3}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 10 }} width={40} tickLine={false} />
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
              Values are % of daily volume for each interval. Changes are applied immediately to the chart above.
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
                    {/* Spacer above visible rows */}
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
                    {/* Spacer below visible rows */}
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
              disabled={baselineDataCount === 0 || targetMonthlyVolume === 0}
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />Save Current
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingProfiles ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading profiles…</p>
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
                        ? `Baseline: ${profile.baseline_start_date} → ${profile.baseline_end_date}`
                        : "No baseline metadata"}
                      {profile.sample_day_count ? ` · ${profile.sample_day_count} days` : ""}
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
              Channel: <strong>{selectedChannel}</strong> ·
              Month: <strong>{monthLabels[safeOffset]}</strong> ·
              Baseline: <strong>{baselineDataCount} days</strong>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSaveModalOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveProfile} disabled={!profileName.trim() || isSaving}>
                {isSaving ? "Saving…" : "Save Profile"}
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
                …
              </code>
              <ul className="mt-2 space-y-0.5 text-xs list-disc list-inside">
                <li><code>date</code> — YYYY-MM-DD</li>
                <li><code>interval_index</code> — 0–95 (15-min slot)</li>
                <li><code>volume</code> — integer contact count</li>
                <li><code>aht</code> — average handle time in seconds (optional)</li>
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
    </div>
  );
};
