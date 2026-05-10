import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, Layers3, Loader2, RefreshCw, Save, Send, Table2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { PageLayout } from "../components/PageLayout";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { CHANNEL_OPTIONS, type ChannelKey, useLOB } from "../lib/lobContext";
import { apiUrl } from "../lib/api";
import { getCalculatedVolumes, type Assumptions } from "./forecasting-logic";

type StaffingMode = "dedicated" | "blended";

interface LobSettings {
  channels_enabled?: Partial<Record<ChannelKey, boolean>>;
  pooling_mode?: StaffingMode | string;
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
    title: "Week Allocation",
    description: "Future month-to-week distribution for the selected scope.",
    icon: CalendarDays,
  },
  {
    title: "Day Allocation",
    description: "Future week-to-day distribution for the selected scope.",
    icon: Table2,
  },
  {
    title: "Interval Allocation",
    description: "Future day-to-interval volume shaping. This is volume, not FTE.",
    icon: Clock3,
  },
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
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString();
}

function formatChannelLabel(channel: ChannelKey): string {
  return CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? "Voice";
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
              Phase 2 shell only. These controls define the future planning scope; no planning data is saved.
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
                    Phase 2 shell only — not wired yet.
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
