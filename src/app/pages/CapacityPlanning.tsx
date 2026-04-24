import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../lib/api";
import { useLOB } from "../lib/lobContext";
import { getCalculatedVolumes, Assumptions } from "./forecasting-logic";
import { computeIntervalFTE, computeAchievedSLFromFTE } from "./intraday-distribution-logic";
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
  Users, UserPlus, Activity, Target, Download,
} from "lucide-react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

type ChannelKey = "voice" | "chat" | "email" | "cases";

interface PlanConfig {
  planStartDate: string;
  horizonWeeks: number;
  attritionRateMonthly: number;
  rampTrainingWeeks: number;
  rampNestingWeeks: number;
  rampNestingPct: number;
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
}

interface DaySchedule { enabled: boolean; open: string; close: string; }

interface LobSettings {
  lob_id: number; lob_name: string;
  channels_enabled: Record<string, boolean>;
  pooling_mode: string;
  voice_aht?: number; voice_sla_target?: number; voice_sla_seconds?: number;
  chat_aht?: number; chat_sla_target?: number; chat_sla_seconds?: number; chat_concurrency?: number;
  email_aht?: number; email_sla_target?: number; email_sla_seconds?: number; email_occupancy?: number;
  hours_of_operation?: Record<string, Record<string, DaySchedule>>;
}

interface DemandAssumptions {
  voiceVolume?: number; chatVolume?: number; emailVolume?: number;
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

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DEFAULT_CONFIG: PlanConfig = {
  planStartDate: new Date().toISOString().split("T")[0],
  horizonWeeks: 26,
  attritionRateMonthly: 2,
  rampTrainingWeeks: 4,
  rampNestingWeeks: 2,
  rampNestingPct: 50,
  startingHc: 0,
  billableFte: 0,
};

const CHANNEL_LABELS: Record<ChannelKey, string> = { voice: "Voice", chat: "Chat", email: "Email", cases: "Cases" };
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

// Derive operating days/hours from a channel's hours-of-operation schedule.
// Returns null when no schedule is configured so callers can fall back.
function hoursFromSchedule(
  schedule: Record<string, DaySchedule> | undefined,
): { daysPerWeek: number; hoursPerDay: number } | null {
  if (!schedule) return null;
  const enabled = Object.values(schedule).filter(d => d.enabled);
  if (!enabled.length) return null;
  const totalHrs = enabled.reduce((sum, d) => {
    const [oh, om] = d.open.split(":").map(Number);
    const [ch, cm] = d.close.split(":").map(Number);
    return sum + Math.max(0, (ch + cm / 60) - (oh + om / 60));
  }, 0);
  return {
    daysPerWeek: enabled.length,
    hoursPerDay: Math.round((totalHrs / enabled.length) * 10) / 10,
  };
}
function roundTo(n: number, dp = 1) { return Math.round(n * 10 ** dp) / 10 ** dp; }
function fmtSeconds(s: number): string {
  if (s >= 3600) return `${roundTo(s / 3600, 1)}h`;
  if (s >= 60) return `${Math.round(s / 60)}m`;
  return `${s}s`;
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
): { fte: number; occupancy: number } {
  if (weeklyVolume <= 0 || ahtSeconds <= 0 || daysPerWeek <= 0 || operatingHoursPerDay <= 0) {
    return { fte: 0, occupancy: 0 };
  }
  const dailyCalls = weeklyVolume / daysPerWeek;
  const intervalsPerDay = operatingHoursPerDay * 2; // 30-min intervals
  const callsPerInterval = dailyCalls / intervalsPerDay;
  const result = computeIntervalFTE(
    callsPerInterval, 30, ahtSeconds,
    slaTarget, slaAnswerSeconds, emailOccupancyPct,
    shrinkagePct, channel, concurrency,
  );
  // result.fte is agents-on-floor per interval, shrinkage-adjusted.
  // Scale to daily FTE: an agent works fteHoursPerDay but the floor needs
  // coverage for operatingHoursPerDay, so multiply by the coverage ratio.
  const coverageRatio = fteHoursPerDay > 0 ? operatingHoursPerDay / fteHoursPerDay : 1;
  return { fte: roundTo(result.fte * coverageRatio), occupancy: result.occupancy };
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

function InputCell({ value, onChange, onReset, placeholder = "", color = "default", note, onNoteChange }: {
  value: number | undefined; onChange: (v: number | null) => void; onReset?: () => void;
  placeholder?: string; color?: "blue" | "orange" | "green" | "default";
  note?: string; onNoteChange?: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string>("");
  const [focused, setFocused] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [noteOpen, setNoteOpen] = useState(false);

  const colorClass = {
    blue: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",
    orange: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800",
    green: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
    default: "bg-muted/30 border-border",
  }[color];

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
      {/* Excel-style triangle indicator when note exists */}
      {onNoteChange && (
        <Popover open={noteOpen} onOpenChange={open => { if (open) openNote(); else setNoteOpen(false); }}>
          <PopoverTrigger asChild>
            <button
              className="absolute top-0 right-0 w-0 h-0 border-0 p-0 bg-transparent cursor-pointer focus:outline-none"
              style={{
                borderTop: `8px solid ${hasNote ? "#f59e0b" : "transparent"}`,
                borderLeft: "8px solid transparent",
              }}
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
        className={`w-full text-right text-xs border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-blue-400 ${colorClass}`}
      />
    </td>
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
  const [demandAssumptions, setDemandAssumptions] = useState<DemandAssumptions | null>(null);
  const [plannerSnapshot, setPlannerSnapshot] = useState<CapacityPlannerSnapshot | null>(null);
  const [lobSettings, setLobSettings] = useState<LobSettings | null>(null);
  const [hoursPerDay, setHoursPerDay] = useState(7.5);
  const [activeChannel, setActiveChannel] = useState<ChannelKey>("voice");
  const [assumptionsOpen, setAssumptionsOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState({ demand: false, staffing: false, hcPlan: false });
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const configTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataLoadedFor = useRef<string | null>(null);

  // ── Derived
  const isDedicated = lobSettings?.pooling_mode === "dedicated";
  const enabledChannels = useMemo<ChannelKey[]>(() => {
    if (!lobSettings?.channels_enabled) return ["voice"];
    return (["voice", "chat", "email", "cases"] as ChannelKey[]).filter(c => lobSettings.channels_enabled[c]);
  }, [lobSettings]);
  const apiChannel = isDedicated ? activeChannel : "blended";

  // ── Load data when LOB or channel changes
  useEffect(() => {
    if (!activeLob) return;
    const key = `${activeLob.id}:${apiChannel}`;
    if (dataLoadedFor.current === key) return;
    dataLoadedFor.current = key;
    loadAllData(activeLob.id, apiChannel);
  }, [activeLob?.id, apiChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAllData(lobId: number, channel: string) {
    setLoading(true);
    try {
      const [configRes, inputsRes, demandRes, lobSettingsRes, shrinkageRes] = await Promise.all([
        fetch(apiUrl(`/api/capacity-plan-config?lob_id=${lobId}&channel=${channel}`)),
        fetch(apiUrl(`/api/capacity-plan-inputs?lob_id=${lobId}&channel=${channel}`)),
        fetch(apiUrl(`/api/demand-planner-active-state?lob_id=${lobId}`)),
        fetch(apiUrl(`/api/lob-settings?lob_id=${lobId}`)),
        fetch(apiUrl(`/api/shrinkage-plan?lob_id=${lobId}`)),
      ]);

      const [cfgData, inputsData, demandData, lsData, shrData] = await Promise.all([
        configRes.json(), inputsRes.json(), demandRes.json(), lobSettingsRes.json(), shrinkageRes.json(),
      ]);

      if (cfgData) {
        setConfig({
          planStartDate: cfgData.plan_start_date?.split("T")[0] ?? DEFAULT_CONFIG.planStartDate,
          horizonWeeks: cfgData.horizon_weeks ?? DEFAULT_CONFIG.horizonWeeks,
          attritionRateMonthly: parseFloat(cfgData.attrition_rate_monthly) ?? DEFAULT_CONFIG.attritionRateMonthly,
          rampTrainingWeeks: cfgData.ramp_training_weeks ?? DEFAULT_CONFIG.rampTrainingWeeks,
          rampNestingWeeks: cfgData.ramp_nesting_weeks ?? DEFAULT_CONFIG.rampNestingWeeks,
          rampNestingPct: parseFloat(cfgData.ramp_nesting_pct) ?? DEFAULT_CONFIG.rampNestingPct,
          startingHc: parseFloat(cfgData.starting_hc) ?? DEFAULT_CONFIG.startingHc,
          billableFte: parseFloat(cfgData.billable_fte) || DEFAULT_CONFIG.billableFte,
        });
      } else {
        setConfig(DEFAULT_CONFIG);
      }

      if (Array.isArray(inputsData)) {
        const map: WeekInputMap = {};
        for (const row of inputsData) {
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
        setWeeklyInputs(map);
      }

      const snap = demandData?.plannerSnapshot ?? null;
      if (snap?.assumptions) {
        setDemandAssumptions(snap.assumptions as DemandAssumptions);
        setPlannerSnapshot(snap as CapacityPlannerSnapshot);
      } else {
        setDemandAssumptions(null);
        setPlannerSnapshot(null);
      }

      if (lsData) setLobSettings(lsData as LobSettings);

      if (shrData?.hours_per_day) setHoursPerDay(parseFloat(shrData.hours_per_day));
      else setHoursPerDay(7.5);

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
            ramp_training_weeks: next.rampTrainingWeeks,
            ramp_nesting_weeks: next.rampNestingWeeks,
            ramp_nesting_pct: next.rampNestingPct,
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

  // ── Computed weeks
  const weeks = useMemo(() => buildWeeks(config.planStartDate, config.horizonWeeks), [config.planStartDate, config.horizonWeeks]);

  // ── Monthly forecast arrays from demand planner snapshot (captures seasonality)
  const forecastedMonthlyVols = useMemo<{ voice: number[]; chat: number[]; email: number[]; cases: number[] } | null>(() => {
    if (!plannerSnapshot) return null;
    const sel = plannerSnapshot.selectedChannels ?? {};
    const chatEnabled = !!sel.chat;
    const emailEnabled = !!sel.email;
    const casesEnabled = !!sel.cases;
    const recut = plannerSnapshot.recutVolumesByChannel;
    if (recut?.voice?.length) {
      return {
        voice: recut.voice as number[],
        chat: chatEnabled && recut.chat?.length ? recut.chat as number[] : recut.voice.map(() => 0),
        email: emailEnabled && recut.email?.length ? recut.email as number[] : recut.voice.map(() => 0),
        cases: casesEnabled && recut.cases?.length ? recut.cases as number[] : recut.voice.map(() => 0),
      };
    }
    const { forecastMethod, hwParams, arimaParams, decompParams, assumptions } = plannerSnapshot;
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
    const voice = getCalculatedVolumes(voiceH, forecastMethod, assumptions, hwParams, arimaParams, decompParams);
    const zeros = voice.map(() => 0);
    const chat = !chatEnabled ? zeros
      : chatH.length > 0
        ? getCalculatedVolumes(chatH, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
        : voice.map(v => Math.round(v * 0.3));
    const email = !emailEnabled ? zeros
      : emailH.length > 0
        ? getCalculatedVolumes(emailH, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
        : voice.map(v => Math.round(v * 0.2));
    const cases = !casesEnabled ? zeros
      : casesH.length > 0
        ? getCalculatedVolumes(casesH, forecastMethod, assumptions, hwParams, arimaParams, decompParams)
        : voice.map(v => Math.round(v * 0.2));
    return { voice, chat, email, cases };
  }, [plannerSnapshot]);

  // ── Auto volumes from demand snapshot
  const autoBaseVolumes = useMemo(() => {
    const forecastStart = plannerSnapshot?.assumptions?.startDate;
    const growthPct = demandAssumptions?.growthRate ?? 0;
    const monday = getMondayOf(new Date(config.planStartDate + "T00:00:00"));

    return weeks.map(w => {
      if (forecastedMonthlyVols && forecastStart) {
        const weekStart = new Date(monday);
        weekStart.setDate(weekStart.getDate() + w.weekOffset * 7);
        const midWeek = new Date(weekStart);
        midWeek.setDate(midWeek.getDate() + 3);
        const start = new Date(forecastStart + "T00:00:00");
        const monthOffset = (midWeek.getFullYear() - start.getFullYear()) * 12
          + (midWeek.getMonth() - start.getMonth());
        if (monthOffset >= 0 && monthOffset < forecastedMonthlyVols.voice.length) {
          const daysInMonth = new Date(midWeek.getFullYear(), midWeek.getMonth() + 1, 0).getDate();
          const f = 7 / daysInMonth;
          return {
            voice: Math.round(forecastedMonthlyVols.voice[monthOffset] * f),
            chat: Math.round(forecastedMonthlyVols.chat[monthOffset] * f),
            email: Math.round(forecastedMonthlyVols.email[monthOffset] * f),
            cases: Math.round(forecastedMonthlyVols.cases[monthOffset] * f),
          };
        }
      }
      // Fallback: flat conversion from base monthly volumes
      const a = demandAssumptions;
      return {
        voice: monthlyToWeekly(a?.voiceVolume ?? 0, growthPct, w.weekOffset),
        chat: monthlyToWeekly(a?.chatVolume ?? 0, growthPct, w.weekOffset),
        email: monthlyToWeekly(a?.emailVolume ?? 0, growthPct, w.weekOffset),
        cases: 0,
      };
    });
  }, [demandAssumptions, weeks, forecastedMonthlyVols, plannerSnapshot, config.planStartDate]);

  // ── Auto AHTs (from lob_settings, fall back to demand assumptions)
  const autoAhts = useMemo(() => ({
    voice: lobSettings?.voice_aht ?? demandAssumptions?.aht ?? 300,
    chat: lobSettings?.chat_aht ?? demandAssumptions?.chatAht ?? 450,
    email: lobSettings?.email_aht ?? demandAssumptions?.emailAht ?? 600,
    cases: lobSettings?.email_aht ?? demandAssumptions?.emailAht ?? 600,
  }), [lobSettings, demandAssumptions]);

  // ── Staffing params
  const shrinkagePct = Number(demandAssumptions?.shrinkage ?? 20) || 20;

  // Operating hours: LOB settings (hours_of_operation) is the source of truth.
  // For dedicated LOBs use the active channel's schedule; for blended use voice.
  // Falls back to demand assumptions, then hard defaults.
  const lobOpHours = useMemo(() => {
    const hoo = lobSettings?.hours_of_operation;
    if (!hoo) return null;
    const channelKey = isDedicated ? activeChannel : "voice";
    return hoursFromSchedule(hoo[channelKey]);
  }, [lobSettings, isDedicated, activeChannel]);

  const daysPerWeek = lobOpHours?.daysPerWeek ?? demandAssumptions?.operatingDaysPerWeek ?? 5;
  const operatingHoursPerDay = lobOpHours?.hoursPerDay ?? demandAssumptions?.operatingHoursPerDay ?? 8;
  // SLA params — LOB settings are authoritative; fall back to demand planner snapshot values
  const snap = plannerSnapshot?.assumptions;
  const slaVoiceTarget = Number(lobSettings?.voice_sla_target ?? snap?.voiceSlaTarget ?? 80);
  const slaVoiceSec    = Number(lobSettings?.voice_sla_seconds ?? snap?.voiceSlaAnswerSeconds ?? 20);
  const slaChatTarget  = Number(lobSettings?.chat_sla_target ?? snap?.chatSlaTarget ?? 80);
  const slaChatSec     = Number(lobSettings?.chat_sla_seconds ?? snap?.chatSlaAnswerSeconds ?? 30);
  const slaEmailTarget = Number(lobSettings?.email_sla_target ?? snap?.emailSlaTarget ?? 90);
  const slaEmailSec    = Number(lobSettings?.email_sla_seconds ?? snap?.emailSlaAnswerSeconds ?? 14400);
  const emailOccupancy = Number(lobSettings?.email_occupancy ?? snap?.occupancy ?? 85) || 85;
  const chatConcurrency = Math.max(1, Number(lobSettings?.chat_concurrency ?? snap?.chatConcurrency ?? 1));
  // Erlang A patience — sourced from demand assumptions; 0 falls back to Erlang C
  const voiceAvgPatienceSec = Number(snap?.voiceAvgPatienceSeconds ?? 120);
  const chatAvgPatienceSec  = Number(snap?.chatAvgPatienceSeconds  ?? 60);

  // ── Full computed calculations per week
  const weekCalcs = useMemo<WeekCalc[]>(() => {
    let projHC = config.startingHc;
    const { attritionRateMonthly, rampTrainingWeeks, rampNestingWeeks, rampNestingPct } = config;
    const weeklyAttritionRate = 1 - Math.pow(1 - attritionRateMonthly / 100, 12 / 52);

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

      // Required FTE via Erlang C — occupancy is an OUTPUT, SLA drives the agent count.
      let requiredFTE = 0;
      let erlangOccupancy = 0;
      if (isDedicated) {
        const vol = activeChannel === "voice" ? effVolVoice : activeChannel === "chat" ? effVolChat : activeChannel === "cases" ? effVolCases : effVolEmail;
        const aht = activeChannel === "voice" ? effAhtVoice : activeChannel === "chat" ? effAhtChat : activeChannel === "cases" ? effAhtCases : effAhtEmail;
        const target = activeChannel === "voice" ? slaVoiceTarget : activeChannel === "chat" ? slaChatTarget : slaEmailTarget;
        const sec    = activeChannel === "voice" ? slaVoiceSec    : activeChannel === "chat" ? slaChatSec    : slaEmailSec;
        const conc   = activeChannel === "chat" ? chatConcurrency : 1;
        // cases uses the email (backlog/deferred) model
        const modelChannel: "voice" | "chat" | "email" = activeChannel === "voice" ? "voice" : activeChannel === "chat" ? "chat" : "email";
        const r = calcWeeklyErlangFTE(vol, aht, daysPerWeek, operatingHoursPerDay, hoursPerDay, target, sec, shrinkagePct, modelChannel, conc, emailOccupancy);
        requiredFTE = r.fte;
        erlangOccupancy = r.occupancy;
      } else {
        // Blended: sum Erlang FTE per enabled channel (each channel staffed to its own SLA)
        const rVoice = enabledChannels.includes("voice")
          ? calcWeeklyErlangFTE(effVolVoice, effAhtVoice, daysPerWeek, operatingHoursPerDay, hoursPerDay, slaVoiceTarget, slaVoiceSec, shrinkagePct, "voice")
          : { fte: 0, occupancy: 0 };
        const rChat = enabledChannels.includes("chat")
          ? calcWeeklyErlangFTE(effVolChat, effAhtChat, daysPerWeek, operatingHoursPerDay, hoursPerDay, slaChatTarget, slaChatSec, shrinkagePct, "chat", chatConcurrency)
          : { fte: 0, occupancy: 0 };
        const rEmail = enabledChannels.includes("email")
          ? calcWeeklyErlangFTE(effVolEmail, effAhtEmail, daysPerWeek, operatingHoursPerDay, hoursPerDay, slaEmailTarget, slaEmailSec, shrinkagePct, "email", 1, emailOccupancy)
          : { fte: 0, occupancy: 0 };
        // cases uses email (backlog/deferred) staffing model
        const rCases = enabledChannels.includes("cases")
          ? calcWeeklyErlangFTE(effVolCases, effAhtCases, daysPerWeek, operatingHoursPerDay, hoursPerDay, slaEmailTarget, slaEmailSec, shrinkagePct, "email", 1, emailOccupancy)
          : { fte: 0, occupancy: 0 };
        requiredFTE = roundTo(rVoice.fte + rChat.fte + rEmail.fte + rCases.fte);
        // Blended occupancy: weighted average by volume
        const totalVol = effVolVoice + effVolChat + effVolEmail + effVolCases;
        erlangOccupancy = totalVol > 0
          ? (rVoice.occupancy * effVolVoice + rChat.occupancy * effVolChat + rEmail.occupancy * effVolEmail + rCases.occupancy * effVolCases) / totalVol
          : 0;
      }

      // Attrition decay
      const attritionDecay = w > 0 ? roundTo(projHC * weeklyAttritionRate, 2) : 0;

      // Effective new HC delta from ramp (all cohorts)
      let effectiveNewHc = 0;
      for (let h = 0; h <= w; h++) {
        const cohort = weeklyInputs[h]?.plannedHires ?? 0;
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

      // Helper: compute achieved SLA% from a given FTE headcount (Erlang A when patience > 0)
      function achievedSLFor(hc: number): number | null {
        if (isDedicated) {
          if (activeChannel === "email" || activeChannel === "cases") return null;
          const vol = activeChannel === "voice" ? effVolVoice : effVolChat;
          const aht = activeChannel === "voice" ? effAhtVoice : effAhtChat;
          const sec = activeChannel === "voice" ? slaVoiceSec : slaChatSec;
          const conc = activeChannel === "chat" ? chatConcurrency : 1;
          const patience = activeChannel === "voice" ? voiceAvgPatienceSec : chatAvgPatienceSec;
          return computeAchievedSLFromFTE(vol, aht, hc, daysPerWeek, operatingHoursPerDay, hoursPerDay, sec, shrinkagePct, activeChannel, conc, patience);
        } else {
          // Blended: volume-weighted average SLA across non-email enabled channels
          let weightedSL = 0, totalVol = 0;
          if (enabledChannels.includes("voice") && effVolVoice > 0) {
            const sl = computeAchievedSLFromFTE(effVolVoice, effAhtVoice, hc, daysPerWeek, operatingHoursPerDay, hoursPerDay, slaVoiceSec, shrinkagePct, "voice", 1, voiceAvgPatienceSec);
            if (sl != null) { weightedSL += sl * effVolVoice; totalVol += effVolVoice; }
          }
          if (enabledChannels.includes("chat") && effVolChat > 0) {
            const sl = computeAchievedSLFromFTE(effVolChat, effAhtChat, hc, daysPerWeek, operatingHoursPerDay, hoursPerDay, slaChatSec, shrinkagePct, "chat", chatConcurrency, chatAvgPatienceSec);
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
        requiredFTE, plannedHires, effectiveNewHc, attritionDecay,
        knownExits, transfersOut, promotionsOut, projectedHc: modelProjHC, actualHc, actualAttrition,
        gapSurplus, actualGapSurplus, billableGapSurplus, achievedSLAProj, achievedSLAActual,
      };
    });
  }, [weeks, weeklyInputs, autoBaseVolumes, autoAhts, config, isDedicated, activeChannel, hoursPerDay,
      shrinkagePct, daysPerWeek, operatingHoursPerDay, enabledChannels,
      slaVoiceTarget, slaVoiceSec, slaChatTarget, slaChatSec, slaEmailTarget, slaEmailSec,
      emailOccupancy, chatConcurrency]);

  // ── Attrition summary
  const attritionSummary = useMemo(() => {
    const totalExits = weekCalcs.reduce((s, w) => s + w.attritionDecay + w.knownExits + w.transfersOut + w.promotionsOut, 0);
    const annualizedPct = config.attritionRateMonthly * 12;
    const totalActualAttrition = weekCalcs.reduce((s, w) => s + (w.actualAttrition ?? 0), 0);
    return { totalExits: roundTo(totalExits), annualizedPct, totalActualAttrition };
  }, [weekCalcs, config.attritionRateMonthly]);

  // ── Hiring need summary
  // Peak Required HC: the highest requiredFTE across the horizon — the roster ceiling.
  // Gross Hiring Need: seats Recruitment must fill = gap to close (start → peak) + attrition replacements.
  const hiringNeed = useMemo(() => {
    if (weekCalcs.length === 0) return { peakRequired: 0, grossHireNeed: 0 };
    const peakRequired = Math.ceil(Math.max(...weekCalcs.map(w => w.requiredFTE)));
    const gapToClose = Math.max(0, peakRequired - config.startingHc);
    const grossHireNeed = gapToClose + Math.ceil(attritionSummary.totalExits);
    return { peakRequired, grossHireNeed };
  }, [weekCalcs, config.startingHc, attritionSummary.totalExits]);

  // ── Bottom-line summary metrics for the hero strip
  const currentGap = weekCalcs[0]?.gapSurplus ?? 0;
  const planHealth = useMemo(() => {
    if (weekCalcs.length === 0) return 0;
    const ok = weekCalcs.filter(w => w.gapSurplus >= 0).length;
    return Math.round((ok / weekCalcs.length) * 100);
  }, [weekCalcs]);
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
    rows.push(row("Required FTE", weekCalcs.map(wk => roundTo(wk.requiredFTE, 1))));
    rows.push(row("Proj. Occupancy %", weekCalcs.map(wk => roundTo(wk.projOccupancyPct, 1))));
    rows.push(row("Proj. Shrinkage %", weekCalcs.map(wk => roundTo(wk.projShrinkagePct, 1))));

    // ── Headcount Plan
    rows.push(["--- HEADCOUNT PLAN ---", ...weekCalcs.map(() => "")]);
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
  const TOP_WEEK_HDR  = 0;
  const TOP_REQ_FTE   = 40;
  const TOP_BILLABLE  = 73;
  const TOP_GAP_REQ   = billableActive ? 106 : 73;
  const TOP_GAP_BILL  = 139;

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
            <div className="flex items-center gap-2">
              <Settings2 className="size-4 text-black" />
              <CardTitle className="text-sm font-semibold">Plan Assumptions</CardTitle>
            </div>
            {assumptionsOpen ? <ChevronDown className="size-4 text-black" /> : <ChevronRight className="size-4 text-black" />}
          </div>
        </CardHeader>
        {assumptionsOpen && (
          <CardContent className="pb-4 pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-black">Plan Start Date</Label>
                <Input type="date" value={config.planStartDate} onChange={e => updateConfig({ planStartDate: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-black">Horizon (weeks)</Label>
                <Input type="number" min={4} max={104} value={config.horizonWeeks} onChange={e => updateConfig({ horizonWeeks: parseInt(e.target.value) || 26 })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-black">Starting HC</Label>
                <Input type="number" min={0} value={config.startingHc} onChange={e => updateConfig({ startingHc: parseFloat(e.target.value) || 0 })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-black">Attrition Rate (%/mo)</Label>
                <Input type="number" min={0} max={50} step={0.1} value={config.attritionRateMonthly} onChange={e => updateConfig({ attritionRateMonthly: parseFloat(e.target.value) || 0 })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-black">Training Weeks (0%)</Label>
                <Input type="number" min={0} max={26} value={config.rampTrainingWeeks} onChange={e => updateConfig({ rampTrainingWeeks: parseInt(e.target.value) || 0 })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-black">Nesting Weeks</Label>
                <Input type="number" min={0} max={26} value={config.rampNestingWeeks} onChange={e => updateConfig({ rampNestingWeeks: parseInt(e.target.value) || 0 })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-black">Nesting Productivity (%)</Label>
                <Input type="number" min={0} max={100} value={config.rampNestingPct} onChange={e => updateConfig({ rampNestingPct: parseFloat(e.target.value) || 0 })} className="h-8 text-xs" />
              </div>
            </div>
            <p className="text-xs text-black mt-3">
              Ramp: {config.rampTrainingWeeks}wk training (0%) → {config.rampNestingWeeks}wk nesting ({config.rampNestingPct}%) → full production (100%)
            </p>

            {/* ── Billing Parameters */}
            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-xs font-semibold text-black mb-2">Billing Parameters</p>
              <div className="flex items-end gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-black">Billable FTE (Contract Max)</Label>
                  <Input
                    type="number" min={0} step={1}
                    value={config.billableFte || ""}
                    placeholder="0 — not set"
                    onChange={e => updateConfig({ billableFte: parseFloat(e.target.value) || 0 })}
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
                <span className="font-normal text-black"> — read-only, edit in LOB Settings &amp; Shrinkage Planning</span>
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 mb-2.5">
                {[
                  { label: "Op. Hrs/Day", value: `${operatingHoursPerDay}h` },
                  { label: "Days/Week", value: `${daysPerWeek}d` },
                  { label: "FTE Hrs/Day", value: `${hoursPerDay}h` },
                  { label: "Shrinkage", value: `${shrinkagePct}%` },
                ].map(p => (
                  <div key={p.label} className="flex items-center gap-1 text-xs">
                    <span className="text-black">{p.label}:</span>
                    <span className="font-medium">{p.value}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {(isDedicated ? [activeChannel] : enabledChannels).map(ch => {
                  const slaTarget = ch === "voice" ? slaVoiceTarget : ch === "chat" ? slaChatTarget : slaEmailTarget;
                  const slaSec   = ch === "voice" ? slaVoiceSec    : ch === "chat" ? slaChatSec    : slaEmailSec;
                  return (
                    <div key={ch} className="flex items-center gap-2 bg-muted/40 rounded-md px-2.5 py-1 text-xs">
                      <span className="font-semibold text-black">{CHANNEL_LABELS[ch]}</span>
                      <span className="text-black">SLA {slaTarget}% in {fmtSeconds(slaSec)}</span>
                      {ch === "chat" && (
                        <span className="text-black">· {chatConcurrency}× concurrency</span>
                      )}
                      {ch === "email" && (
                        <span className="text-black">· {emailOccupancy}% utilisation</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Hero Strip — the bottom-line metrics, always the first thing a manager sees */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
        {/* Peak Required FTE */}
        <div className="bg-card border border-border rounded-md px-3 py-2.5 shadow-sm border-l-4 border-l-blue-500">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-black uppercase tracking-wide">
            <Users className="size-3" /> Peak Required FTE
          </div>
          <div className="text-2xl font-bold mt-1 text-black dark:text-black leading-none">
            {hiringNeed.peakRequired > 0 ? hiringNeed.peakRequired : "—"}
          </div>
          <div className="text-[10px] text-black mt-1">
            roster ceiling over {config.horizonWeeks} wks
          </div>
        </div>

        {/* Current Gap (W1) — the most visceral metric */}
        <div className={`bg-card border border-border rounded-md px-3 py-2.5 shadow-sm border-l-4 ${
          currentGap >= 0 ? "border-l-green-500" : "border-l-red-500"
        }`}>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-black uppercase tracking-wide">
            <Target className="size-3" /> Current Gap (W1)
          </div>
          <div className={`text-2xl font-bold mt-1 leading-none ${
            currentGap >= 0 ? "text-black dark:text-black" : "text-black dark:text-black"
          }`}>
            {currentGap >= 0 ? `+${fmt1(currentGap)}` : fmt1(currentGap)}
          </div>
          <div className="text-[10px] text-black mt-1">
            {currentGap >= 0 ? "surplus vs. required" : "understaffed vs. required"}
          </div>
        </div>

        {/* Gross Hiring Need */}
        <div className="bg-card border border-border rounded-md px-3 py-2.5 shadow-sm border-l-4 border-l-violet-500"
          title={`Gap to close: ${Math.max(0, hiringNeed.peakRequired - config.startingHc)} + Attrition replacements: ${Math.ceil(attritionSummary.totalExits)}`}
        >
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-black uppercase tracking-wide">
            <UserPlus className="size-3" /> Gross Hiring Need
          </div>
          <div className="text-2xl font-bold mt-1 text-black dark:text-black leading-none">
            {hiringNeed.grossHireNeed > 0 ? hiringNeed.grossHireNeed : "—"}
          </div>
          <div className="text-[10px] text-black mt-1">
            hires for peak + attrition
          </div>
        </div>

        {/* Plan Health */}
        <div className={`bg-card border border-border rounded-md px-3 py-2.5 shadow-sm border-l-4 ${
          planHealth >= 80 ? "border-l-green-500" : planHealth >= 50 ? "border-l-amber-500" : "border-l-red-500"
        }`}>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-black uppercase tracking-wide">
            <Activity className="size-3" /> Plan Health
          </div>
          <div className={`text-2xl font-bold mt-1 leading-none ${
            planHealth >= 80 ? "text-black dark:text-black"
              : planHealth >= 50 ? "text-black dark:text-black"
              : "text-black dark:text-black"
          }`}>
            {planHealth}%
          </div>
          <div className="text-[10px] text-black mt-1">
            weeks at-or-above required
          </div>
        </div>
      </div>

      {/* ── Secondary metrics strip */}
      <div className="flex items-center gap-3 mb-4 flex-wrap text-xs">
        <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-3 py-1.5">
          <TrendingDown className="size-3.5 text-black" />
          <span className="text-black">Annualized Attrition:</span>
          <span className="font-semibold">{fmtPct(attritionSummary.annualizedPct)}</span>
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
                Required vs. plan — gap is where the red line sits above the dashed blue
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
                <Line type="monotone" dataKey="required" name="Required FTE" stroke="#dc2626" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="projected" name="Projected HC" stroke="#2563eb" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                {config.billableFte > 0 && (
                  <Line type="monotone" dataKey="billable" name="Billable FTE" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
                )}
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

              {/* Row 2 — Required FTE (Based on Demand) */}
              <tr className="border-b border-border">
                <td
                  className="bg-card border-r border-border border-t-2 border-t-primary px-3 py-2 text-xs font-bold whitespace-nowrap text-black"
                  style={{ position: "sticky", left: 0, top: TOP_REQ_FTE, zIndex: 30 }}
                >
                  Required FTE (Based on Demand)
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
                    className="border-r border-border bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs font-bold whitespace-nowrap text-amber-700 dark:text-amber-400"
                    style={{ position: "sticky", left: 0, top: TOP_BILLABLE, zIndex: 30 }}
                  >
                    Billable FTE
                  </td>
                  {weekCalcs.map(wk => (
                    <td
                      key={wk.weekOffset}
                      className="bg-amber-50 dark:bg-amber-950/20 px-2 py-2 text-right text-xs font-bold whitespace-nowrap text-amber-700 dark:text-amber-400"
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
                        onChange={v => setCellInput(wk.weekOffset, "plannedHires", v ?? 0)}
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
                        onChange={v => setCellInput(wk.weekOffset, "knownExits", v ?? 0)}
                        placeholder="0" color="orange"
                      />
                    ))}
                  </tr>
                  <tr className="border-b border-border/40 hover:bg-muted/20">
                    <RowLabel label="Transfers Out" indent />
                    {weekCalcs.map(wk => (
                      <InputCell key={wk.weekOffset}
                        value={weeklyInputs[wk.weekOffset]?.transfersOut}
                        onChange={v => setCellInput(wk.weekOffset, "transfersOut", v ?? 0)}
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
                        onChange={v => setCellInput(wk.weekOffset, "promotionsOut", v ?? 0)}
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


