import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Switch } from "../components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import {
  ChevronDown, ChevronRight, Cloud, CloudOff, Loader2,
  Phone, Mail, MessageSquare, Clock, SlidersHorizontal, ClipboardList, Globe,
} from "lucide-react";
import { toast } from "sonner";
import { getUTCOffsetMinutes, getTZLabel, TIMEZONE_OPTIONS } from "../lib/timezone";

// ── Types ─────────────────────────────────────────────────────────────────────
type ChannelKey = "voice" | "email" | "chat" | "cases";
type DayKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
type PoolingMode = "blended" | "dedicated";

interface DaySchedule {
  enabled: boolean;
  open: string;
  close: string;
}

type ChannelSchedule = Record<DayKey, DaySchedule>;
type HoursOfOperation = Record<ChannelKey, ChannelSchedule>;

// shrinkage is owned by the Shrinkage Planning page.
// voice max-occupancy is an Erlang C OUTPUT (driven by SLA target), not an input.
interface LobSettings {
  lob_id: number;
  lob_name: string;
  channels_enabled: Record<ChannelKey, boolean>;
  pooling_mode: PoolingMode;
  // Voice — SLA drives staffing; occupancy is an output
  voice_aht: number;
  voice_sla_target: number;
  voice_sla_seconds: number;
  // Chat
  chat_aht: number;
  chat_sla_target: number;
  chat_sla_seconds: number;
  chat_concurrency: number;
  // Email — utilisation IS an input (async backlog model, no queue)
  email_aht: number;
  email_sla_target: number;
  email_sla_seconds: number;
  email_occupancy: number;
  hours_of_operation: HoursOfOperation;
  demand_timezone: string;
  supply_timezone: string;
  updated_at?: string;
}

// ── Callback types (stable across renders) ────────────────────────────────────
type UpdateFn = <K extends keyof LobSettings>(lobId: number, field: K, value: LobSettings[K]) => void;
type UpdateHoursFn = (lobId: number, channel: ChannelKey, day: DayKey, field: keyof DaySchedule, value: boolean | string) => void;

// ── Constants ─────────────────────────────────────────────────────────────────
const DAYS: DayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_SHORT: Record<DayKey, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed",
  thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
};

const CHANNEL_META: Record<ChannelKey, { label: string; Icon: React.FC<{ className?: string }>; colorClass: string; bgClass: string }> = {
  voice: { label: "Voice", Icon: Phone,          colorClass: "text-sky-600 dark:text-sky-400",     bgClass: "bg-sky-50 dark:bg-sky-950/30" },
  email: { label: "Email", Icon: Mail,            colorClass: "text-emerald-600 dark:text-emerald-400", bgClass: "bg-emerald-50 dark:bg-emerald-950/30" },
  chat:  { label: "Chat",  Icon: MessageSquare,   colorClass: "text-amber-600 dark:text-amber-400", bgClass: "bg-amber-50 dark:bg-amber-950/30" },
  cases: { label: "Cases", Icon: ClipboardList,   colorClass: "text-violet-600 dark:text-violet-400", bgClass: "bg-violet-50 dark:bg-violet-950/30" },
};

// ── Defaults ──────────────────────────────────────────────────────────────────
function makeDefaultDay(enabled: boolean): DaySchedule {
  return { enabled, open: "08:00", close: "17:00" };
}
function makeDefaultChannelSchedule(): ChannelSchedule {
  return {
    monday: makeDefaultDay(true), tuesday: makeDefaultDay(true),
    wednesday: makeDefaultDay(true), thursday: makeDefaultDay(true),
    friday: makeDefaultDay(true), saturday: makeDefaultDay(false), sunday: makeDefaultDay(false),
  };
}
const DEFAULT_HOURS: HoursOfOperation = {
  voice: makeDefaultChannelSchedule(),
  email: makeDefaultChannelSchedule(),
  chat:  makeDefaultChannelSchedule(),
  cases: makeDefaultChannelSchedule(),
};

function mergeHours(saved: Partial<HoursOfOperation> | null | undefined): HoursOfOperation {
  const result = {
    voice: { ...makeDefaultChannelSchedule(), ...(saved?.voice ?? {}) },
    email: { ...makeDefaultChannelSchedule(), ...(saved?.email ?? {}) },
    chat:  { ...makeDefaultChannelSchedule(), ...(saved?.chat  ?? {}) },
    cases: { ...makeDefaultChannelSchedule(), ...(saved?.cases ?? {}) },
  };
  return result;
}

function applyDefaults(raw: Partial<LobSettings> & { lob_id: number; lob_name: string }): LobSettings {
  return {
    lob_id:            raw.lob_id,
    lob_name:          raw.lob_name,
    channels_enabled:  raw.channels_enabled  ?? { voice: true, email: false, chat: false, cases: false },
    pooling_mode:      raw.pooling_mode       ?? "dedicated",
    voice_aht:         raw.voice_aht          ?? 300,
    voice_sla_target:  raw.voice_sla_target   ?? 80,
    voice_sla_seconds: raw.voice_sla_seconds  ?? 20,
    chat_aht:          raw.chat_aht           ?? 450,
    chat_sla_target:   raw.chat_sla_target    ?? 80,
    chat_sla_seconds:  raw.chat_sla_seconds   ?? 30,
    chat_concurrency:  raw.chat_concurrency   ?? 2,
    email_aht:         raw.email_aht          ?? 600,
    email_sla_target:  raw.email_sla_target   ?? 90,
    email_sla_seconds: raw.email_sla_seconds  ?? 14400,
    email_occupancy:   raw.email_occupancy    ?? 85,
    hours_of_operation: mergeHours(raw.hours_of_operation as Partial<HoursOfOperation> | null),
    demand_timezone:   raw.demand_timezone   ?? "America/New_York",
    supply_timezone:   raw.supply_timezone   ?? "Asia/Manila",
    updated_at:        raw.updated_at,
  };
}

// ── Derived helpers ───────────────────────────────────────────────────────────
function countEnabledDays(schedule: ChannelSchedule): number {
  return DAYS.filter((d) => schedule[d].enabled).length;
}
function is24HoursChannel(schedule: ChannelSchedule): boolean {
  return DAYS.every((d) => schedule[d].enabled && schedule[d].open === "00:00" && schedule[d].close === "23:59");
}
function avgHoursPerDay(schedule: ChannelSchedule): number {
  if (is24HoursChannel(schedule)) return 24;
  const enabled = DAYS.filter((d) => schedule[d].enabled);
  if (enabled.length === 0) return 0;
  const total = enabled.reduce((sum, d) => {
    const [oh, om] = schedule[d].open.split(":").map(Number);
    const [ch, cm] = schedule[d].close.split(":").map(Number);
    return sum + Math.max(0, (ch + cm / 60) - (oh + om / 60));
  }, 0);
  return Math.round((total / enabled.length) * 10) / 10;
}

// ── NumericField — module-level so identity is stable across renders ───────────
function NumericField({
  label, value, onChange, min = 0, max = 99999, step = 1, unit = "", tooltip,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string; tooltip?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">{label}</Label>
        {tooltip && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[10px] text-muted-foreground cursor-help underline decoration-dotted">?</span>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs max-w-[220px]">{tooltip}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="number" min={min} max={max} step={step} value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
          className="h-8 text-sm font-bold"
        />
        {unit && <span className="text-xs text-muted-foreground shrink-0">{unit}</span>}
      </div>
    </div>
  );
}

// ── ChannelStaffingSection — module-level ─────────────────────────────────────
function ChannelStaffingSection({
  s, channel, onUpdate,
}: {
  s: LobSettings; channel: ChannelKey; onUpdate: UpdateFn;
}) {
  const { Icon, colorClass, bgClass, label } = CHANNEL_META[channel];
  return (
    <div className={`rounded-lg border border-border/60 p-4 ${bgClass} space-y-4`}>
      <p className={`text-xs font-black uppercase tracking-widest ${colorClass} flex items-center gap-1.5`}>
        <Icon className="size-3.5" />{label} Channel
      </p>
      {channel === "voice" && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <NumericField label="AHT" value={s.voice_aht} unit="s" min={1} max={9999}
            onChange={(v) => onUpdate(s.lob_id, "voice_aht", v)}
            tooltip="Average Handle Time in seconds per voice interaction" />
          <NumericField label="SLA Target" value={s.voice_sla_target} unit="%" min={1} max={100}
            onChange={(v) => onUpdate(s.lob_id, "voice_sla_target", v)}
            tooltip="% of calls answered within the SLA answer seconds. Drives Erlang C staffing — occupancy is the output, not the input." />
          <NumericField label="SLA Seconds (ASA)" value={s.voice_sla_seconds} unit="s" min={1} max={3600}
            onChange={(v) => onUpdate(s.lob_id, "voice_sla_seconds", v)}
            tooltip="Target answer speed in seconds (e.g. 80% answered in 20s)" />
        </div>
      )}
      {channel === "chat" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumericField label="AHT" value={s.chat_aht} unit="s" min={1} max={9999}
            onChange={(v) => onUpdate(s.lob_id, "chat_aht", v)}
            tooltip="Average Handle Time in seconds per chat interaction" />
          <NumericField label="SLA Target" value={s.chat_sla_target} unit="%" min={1} max={100}
            onChange={(v) => onUpdate(s.lob_id, "chat_sla_target", v)}
            tooltip="% of chats answered within the SLA answer seconds" />
          <NumericField label="SLA Seconds (ASA)" value={s.chat_sla_seconds} unit="s" min={1} max={3600}
            onChange={(v) => onUpdate(s.lob_id, "chat_sla_seconds", v)}
            tooltip="Target answer speed in seconds for chat" />
          <NumericField label="Concurrency" value={s.chat_concurrency} unit="chats" min={1} max={10} step={0.5}
            onChange={(v) => onUpdate(s.lob_id, "chat_concurrency", v)}
            tooltip="Simultaneous chats per agent. Divides effective AHT in Erlang C calculations." />
        </div>
      )}
      {channel === "email" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumericField label="AHT" value={s.email_aht} unit="s" min={1} max={99999}
            onChange={(v) => onUpdate(s.lob_id, "email_aht", v)}
            tooltip="Average Handle Time in seconds per email interaction" />
          <NumericField label="SLA Target" value={s.email_sla_target} unit="%" min={1} max={100}
            onChange={(v) => onUpdate(s.lob_id, "email_sla_target", v)}
            tooltip="% of emails handled within the SLA seconds" />
          <NumericField label="SLA Seconds" value={s.email_sla_seconds} unit="s" min={60} max={259200}
            onChange={(v) => onUpdate(s.lob_id, "email_sla_seconds", v)}
            tooltip="Target handling time for email (e.g. 14400 = 4 hours). No queue model — email uses a backlog/async model." />
          <NumericField label="Utilisation Target" value={s.email_occupancy} unit="%" min={1} max={100}
            onChange={(v) => onUpdate(s.lob_id, "email_occupancy", v)}
            tooltip="Target agent utilisation % for email. Unlike voice, this IS an input — email has no queue, so utilisation drives the backlog model." />
        </div>
      )}
      {channel === "cases" && (
        <div className="rounded-md border border-dashed border-violet-300/70 bg-violet-50/60 dark:bg-violet-950/20 p-3">
          <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">Cases uses the same staffing settings as Email.</p>
          <p className="text-xs text-muted-foreground mt-1">
            It is saved as a separate channel toggle and operating-hours schedule, but the blended staffing model reuses the Email backlog parameters.
          </p>
        </div>
      )}
    </div>
  );
}

// ── HoursTable — module-level ─────────────────────────────────────────────────
function HoursTable({ s, onUpdateHours, onUpdate }: { s: LobSettings; onUpdateHours: UpdateHoursFn; onUpdate: UpdateFn }) {
  const enabledChannels = (["voice", "email", "chat", "cases"] as ChannelKey[]).filter((c) => s.channels_enabled[c]);

  function toggle24h(ch: ChannelKey, enable: boolean) {
    const newSchedule: ChannelSchedule = enable
      ? Object.fromEntries(DAYS.map((d) => [d, { enabled: true, open: "00:00", close: "23:59" }])) as ChannelSchedule
      : makeDefaultChannelSchedule();
    onUpdate(s.lob_id, "hours_of_operation", { ...s.hours_of_operation, [ch]: newSchedule });
  }

  if (enabledChannels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Enable at least one channel in the Channels &amp; Staffing tab to configure hours.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="text-left text-xs font-black uppercase tracking-widest py-2 pl-4 pr-3 w-24">Day</th>
            {enabledChannels.map((ch) => {
              const { Icon: ChIcon, colorClass, label } = CHANNEL_META[ch];
              const active24h = is24HoursChannel(s.hours_of_operation[ch]);
              return (
                <th key={ch} colSpan={3}
                  className={`text-center text-xs font-black uppercase tracking-widest py-2 px-2 border-l border-border/40 ${colorClass}`}>
                  <span className="flex items-center justify-center gap-2">
                    <ChIcon className="size-3" />{label}
                    <span className="flex items-center gap-1 ml-1" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={active24h}
                        onCheckedChange={(v) => toggle24h(ch, v)}
                        className="scale-[0.65]"
                      />
                      <span className={`text-[10px] font-semibold ${active24h ? colorClass : "text-muted-foreground"}`}>24h</span>
                    </span>
                  </span>
                </th>
              );
            })}
          </tr>
          <tr className="border-b border-border/50 bg-muted/20">
            <th className="py-1.5 pl-4 pr-3" />
            {enabledChannels.map((ch) => (
              <React.Fragment key={ch}>
                <th className="text-center text-[10px] font-semibold text-muted-foreground py-1.5 px-1 border-l border-border/30 w-12">Open</th>
                <th className="text-center text-[10px] font-semibold text-muted-foreground py-1.5 px-1 w-12">Close</th>
                <th className="text-center text-[10px] font-semibold text-muted-foreground py-1.5 px-1 w-10">On</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day, idx) => (
            <tr key={day} className={`border-b border-border/30 ${idx % 2 === 0 ? "" : "bg-muted/10"} hover:bg-muted/20 transition-colors`}>
              <td className="py-2 pl-4 pr-3 font-semibold text-sm">{DAY_SHORT[day]}</td>
              {enabledChannels.map((ch) => {
                const sched = s.hours_of_operation[ch][day];
                const locked = is24HoursChannel(s.hours_of_operation[ch]);
                return (
                  <React.Fragment key={ch}>
                    <td className="py-1.5 px-1 border-l border-border/30">
                      <Input type="time" value={sched.open} disabled={!sched.enabled || locked}
                        onChange={(e) => onUpdateHours(s.lob_id, ch, day, "open", e.target.value)}
                        className="h-7 text-xs font-mono px-1.5 disabled:opacity-40 min-w-[80px]" />
                    </td>
                    <td className="py-1.5 px-1">
                      <Input type="time" value={sched.close} disabled={!sched.enabled || locked}
                        onChange={(e) => onUpdateHours(s.lob_id, ch, day, "close", e.target.value)}
                        className="h-7 text-xs font-mono px-1.5 disabled:opacity-40 min-w-[80px]" />
                    </td>
                    <td className="py-1.5 px-1 text-center">
                      <Switch checked={sched.enabled} disabled={locked}
                        onCheckedChange={(v) => onUpdateHours(s.lob_id, ch, day, "enabled", v)}
                        className="scale-75 disabled:opacity-40" />
                    </td>
                  </React.Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border/50 bg-muted/30">
            <td className="py-2 pl-4 pr-3 text-xs font-black uppercase tracking-widest text-muted-foreground">Total</td>
            {enabledChannels.map((ch) => {
              const days = countEnabledDays(s.hours_of_operation[ch]);
              const hrs  = avgHoursPerDay(s.hours_of_operation[ch]);
              return (
                <td key={ch} colSpan={3} className="py-2 px-2 text-center border-l border-border/30">
                  <span className="text-xs font-semibold">{days} day{days !== 1 ? "s" : ""}/wk</span>
                  <span className="text-xs text-muted-foreground ml-1.5">· {hrs}h avg</span>
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── TimezoneSection — module-level ───────────────────────────────────────────
function TimezoneSection({ s, onUpdate }: { s: LobSettings; onUpdate: UpdateFn }) {
  const now = useMemo(() => new Date(), []);
  const demandOffsetMin = getUTCOffsetMinutes(s.demand_timezone, now);
  const supplyOffsetMin = getUTCOffsetMinutes(s.supply_timezone, now);
  const demandLabel = getTZLabel(s.demand_timezone, now);
  const supplyLabel = getTZLabel(s.supply_timezone, now);
  const diffHours = (supplyOffsetMin - demandOffsetMin) / 60;
  const diffStr = diffHours === 0
    ? "same UTC offset"
    : `${supplyLabel} is ${Math.abs(diffHours)}h ${diffHours > 0 ? "ahead of" : "behind"} ${demandLabel}`;

  function fmtOffset(min: number) {
    const sign = min >= 0 ? "+" : "-";
    const abs = Math.abs(min);
    const h = Math.floor(abs / 60).toString().padStart(2, "0");
    const m = (abs % 60).toString().padStart(2, "0");
    return `UTC${sign}${h}:${m}`;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure the timezone for customer demand and the timezone where agents work.
        Used to detect DST transitions that affect scheduling.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
            Demand Timezone (customers)
          </Label>
          <select
            value={s.demand_timezone}
            onChange={(e) => onUpdate(s.lob_id, "demand_timezone", e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            {TIMEZONE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Current: {demandLabel} ({fmtOffset(demandOffsetMin)})
          </p>
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
            Supply Timezone (agents)
          </Label>
          <select
            value={s.supply_timezone}
            onChange={(e) => onUpdate(s.lob_id, "supply_timezone", e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            {TIMEZONE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Current: {supplyLabel} ({fmtOffset(supplyOffsetMin)})
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground border-t border-border/50 pt-3">{diffStr}</p>
    </div>
  );
}

// ── LobCard — module-level ────────────────────────────────────────────────────
interface LobCardProps {
  s: LobSettings;
  isOpen: boolean;
  isSaving: boolean;
  hasError: boolean;
  onToggle: (lobId: number) => void;
  onUpdate: UpdateFn;
  onUpdateHours: UpdateHoursFn;
}
function LobCard({ s, isOpen, isSaving, hasError, onToggle, onUpdate, onUpdateHours }: LobCardProps) {
  const enabledChannelCount = (["voice", "email", "chat", "cases"] as ChannelKey[]).filter((c) => s.channels_enabled[c]).length;

  return (
    <Card className="border border-border shadow-sm overflow-hidden">
      <button type="button" onClick={() => onToggle(s.lob_id)} className="w-full text-left">
        <CardHeader className={`border-b transition-colors ${isOpen ? "border-border/50 bg-muted/30" : "border-transparent"}`}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <CardTitle className="text-base font-black uppercase tracking-widest truncate">{s.lob_name}</CardTitle>
              <div className="flex gap-1.5 flex-wrap">
                {(["voice", "email", "chat", "cases"] as ChannelKey[]).filter((c) => s.channels_enabled[c]).map((c) => (
                  <Badge key={c} variant="outline" className={`text-xs ${CHANNEL_META[c].colorClass}`}>
                    {CHANNEL_META[c].label}
                  </Badge>
                ))}
                {enabledChannelCount === 0 && <Badge variant="outline" className="text-xs text-muted-foreground">No channels</Badge>}
              </div>
              <Badge variant={s.pooling_mode === "blended" ? "default" : "outline"} className="text-xs capitalize shrink-0">
                {s.pooling_mode}
              </Badge>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isSaving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              {!isSaving && !hasError && s.updated_at && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Cloud className="size-4 text-emerald-500" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Saved {new Date(s.updated_at).toLocaleTimeString()}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {hasError && <CloudOff className="size-4 text-destructive" />}
              {isOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
      </button>

      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <CardContent className={`pt-6 transition-opacity duration-200 ${isOpen ? "opacity-100" : "opacity-0"}`}>
            <Tabs defaultValue="staffing">
              <TabsList className="mb-6">
                <TabsTrigger value="staffing" className="gap-1.5">
                  <SlidersHorizontal className="size-3.5" />Channels &amp; Staffing
                </TabsTrigger>
                <TabsTrigger value="hours" className="gap-1.5">
                  <Clock className="size-3.5" />Hours of Operation
                </TabsTrigger>
                <TabsTrigger value="timezone" className="gap-1.5">
                  <Globe className="size-3.5" />Timezone
                </TabsTrigger>
              </TabsList>

              {/* ── Tab 1: Channels & Staffing ── */}
              <TabsContent value="staffing" className="space-y-6 mt-0">
                <div className="space-y-3">
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Active Channels</p>
                  <div className="flex gap-4 flex-wrap">
                    {(["voice", "email", "chat", "cases"] as ChannelKey[]).map((ch) => {
                      const { Icon: ChIcon, colorClass, bgClass, label } = CHANNEL_META[ch];
                      return (
                        <label key={ch} className={`flex items-center gap-2.5 rounded-lg border border-border/60 px-4 py-3 cursor-pointer transition-colors ${s.channels_enabled[ch] ? bgClass : "bg-muted/20 opacity-60"}`}>
                          <Checkbox
                            checked={s.channels_enabled[ch]}
                            onCheckedChange={(checked) =>
                              onUpdate(s.lob_id, "channels_enabled", { ...s.channels_enabled, [ch]: !!checked })
                            }
                          />
                          <ChIcon className={`size-4 ${colorClass}`} />
                          <span className={`text-sm font-bold ${colorClass}`}>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Pooling Mode</p>
                  <RadioGroup value={s.pooling_mode}
                    onValueChange={(v) => onUpdate(s.lob_id, "pooling_mode", v as PoolingMode)}
                    className="flex gap-3 flex-wrap">
                    {([
                      { value: "dedicated", label: "Dedicated", desc: "Each channel has its own agent pool" },
                      { value: "blended",   label: "Blended",   desc: "All channels share a single agent pool" },
                    ] as const).map(({ value, label, desc }) => (
                      <label key={value} className={`flex items-start gap-3 rounded-lg border border-border/60 px-4 py-3 cursor-pointer flex-1 min-w-[200px] transition-colors ${s.pooling_mode === value ? "bg-primary/10 border-primary/30" : "bg-muted/20"}`}>
                        <RadioGroupItem value={value} className="mt-0.5" />
                        <div>
                          <p className="text-sm font-bold">{label}</p>
                          <p className="text-xs text-muted-foreground">{desc}</p>
                        </div>
                      </label>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Staffing Parameters</p>
                  {(["voice", "email", "chat", "cases"] as ChannelKey[])
                    .filter((c) => s.channels_enabled[c])
                    .map((ch) => <ChannelStaffingSection key={ch} s={s} channel={ch} onUpdate={onUpdate} />)
                  }
                  {enabledChannelCount === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">Enable at least one channel above to configure staffing parameters.</p>
                  )}
                  <p className="text-xs text-muted-foreground pt-1">
                    Shrinkage is managed on the <span className="font-semibold">Shrinkage Planning</span> page and applied automatically.
                  </p>
                </div>
              </TabsContent>

              {/* ── Tab 2: Hours of Operation ── */}
              <TabsContent value="hours" className="mt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Set operating hours per channel per day. The totals row feeds into Demand Planner operating hours/days defaults.
                </p>
                <HoursTable s={s} onUpdateHours={onUpdateHours} onUpdate={onUpdate} />
              </TabsContent>

              {/* ── Tab 3: Timezone ── */}
              <TabsContent value="timezone" className="mt-0">
                <TimezoneSection s={s} onUpdate={onUpdate} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </div>
      </div>
    </Card>
  );
}

// ── SummaryTable — module-level ───────────────────────────────────────────────
function SummaryTable({ settings, onToggle }: { settings: LobSettings[]; onToggle: (id: number) => void }) {
  return (
    <Card className="border border-border shadow-sm mb-8">
      <CardHeader className="pb-3 border-b border-border/50 bg-muted/30">
        <CardTitle className="text-sm font-black uppercase tracking-widest">All LOBs — Quick View</CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left text-xs font-black uppercase tracking-widest py-2 pl-4 pr-2">LOB</th>
              <th className="text-left text-xs font-black uppercase tracking-widest py-2 px-2">Channels</th>
              <th className="text-left text-xs font-black uppercase tracking-widest py-2 px-2">Pooling</th>
              <th className="text-right text-xs font-black uppercase tracking-widest py-2 px-2">Voice AHT</th>
              <th className="text-right text-xs font-black uppercase tracking-widest py-2 px-2">Chat AHT</th>
              <th className="text-right text-xs font-black uppercase tracking-widest py-2 px-2">Email AHT</th>
              <th className="text-right text-xs font-black uppercase tracking-widest py-2 pl-2 pr-4">Voice Op. Days</th>
            </tr>
          </thead>
          <tbody>
            {settings.map((s) => {
              const voiceDays = countEnabledDays(s.hours_of_operation.voice);
              const voiceHrs  = avgHoursPerDay(s.hours_of_operation.voice);
              return (
                <tr key={s.lob_id}
                  className="border-b border-border/40 hover:bg-muted/20 cursor-pointer transition-colors"
                  onClick={() => onToggle(s.lob_id)}>
                  <td className="py-2 pl-4 pr-2 font-semibold">{s.lob_name}</td>
                  <td className="py-2 px-2">
                    <div className="flex gap-1 flex-wrap">
                      {(["voice", "email", "chat", "cases"] as ChannelKey[]).filter((c) => s.channels_enabled[c]).map((c) => (
                        <Badge key={c} variant="outline" className={`text-xs ${CHANNEL_META[c].colorClass}`}>
                          {CHANNEL_META[c].label}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <Badge variant={s.pooling_mode === "blended" ? "default" : "outline"} className="text-xs capitalize">
                      {s.pooling_mode}
                    </Badge>
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs">{s.voice_aht}s</td>
                  <td className="py-2 px-2 text-right font-mono text-xs">{s.chat_aht}s</td>
                  <td className="py-2 px-2 text-right font-mono text-xs">{s.email_aht}s</td>
                  <td className="py-2 pl-2 pr-4 text-right font-mono text-xs">{voiceDays}d · {voiceHrs}h/day</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function LOBSettings() {
  const [settings, setSettings] = useState<LobSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState<Set<number>>(new Set());
  const [saveError, setSaveError] = useState<Set<number>>(new Set());
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    fetch(apiUrl("/api/lob-settings"))
      .then((r) => r.json())
      .then((rows: Array<Partial<LobSettings> & { lob_id: number; lob_name: string }>) => {
        setSettings(rows.map(applyDefaults));
        if (rows.length > 0) setExpanded(new Set([rows[0].lob_id]));
      })
      .catch(() => toast.error("Failed to load LOB settings"))
      .finally(() => setLoading(false));
  }, []);

  const scheduleSave = useCallback((lobId: number, current: LobSettings) => {
    if (saveTimers.current[lobId]) clearTimeout(saveTimers.current[lobId]);
    saveTimers.current[lobId] = setTimeout(async () => {
      setSaving((s) => new Set(s).add(lobId));
      setSaveError((s) => { const n = new Set(s); n.delete(lobId); return n; });
      try {
        const res = await fetch(apiUrl(`/api/lob-settings?lob_id=${lobId}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(current),
        });
        if (!res.ok) throw new Error("save failed");
        setSettings((prev) =>
          prev.map((s) => s.lob_id === lobId ? { ...s, updated_at: new Date().toISOString() } : s)
        );
      } catch {
        setSaveError((s) => new Set(s).add(lobId));
        toast.error(`Failed to save settings for LOB ${lobId}`);
      } finally {
        setSaving((sv) => { const n = new Set(sv); n.delete(lobId); return n; });
      }
    }, 1500);
  }, []);

  const update: UpdateFn = useCallback(<K extends keyof LobSettings>(
    lobId: number, field: K, value: LobSettings[K]
  ) => {
    setSettings((prev) =>
      prev.map((s) => {
        if (s.lob_id !== lobId) return s;
        const updated = { ...s, [field]: value };
        scheduleSave(lobId, updated);
        return updated;
      })
    );
  }, [scheduleSave]);

  const updateHours: UpdateHoursFn = useCallback((lobId, channel, day, field, value) => {
    setSettings((prev) =>
      prev.map((s) => {
        if (s.lob_id !== lobId) return s;
        const updated: LobSettings = {
          ...s,
          hours_of_operation: {
            ...s.hours_of_operation,
            [channel]: {
              ...s.hours_of_operation[channel],
              [day]: { ...s.hours_of_operation[channel][day], [field]: value },
            },
          },
        };
        scheduleSave(lobId, updated);
        return updated;
      })
    );
  }, [scheduleSave]);

  const toggleExpanded = useCallback((lobId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(lobId)) next.delete(lobId); else next.add(lobId);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <PageLayout title="LOB Settings">
        <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /><span>Loading LOB settings…</span>
        </div>
      </PageLayout>
    );
  }

  if (settings.length === 0) {
    return (
      <PageLayout title="LOB Settings">
        <div className="text-center py-24 text-muted-foreground">
          <p className="text-base">No Lines of Business found.</p>
          <p className="text-sm mt-1">Create an LOB in Configuration → Lines of Business first.</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="LOB Settings">
      <p className="text-sm text-muted-foreground mb-8 max-w-3xl">
        Define channels, pooling mode, staffing parameters (AHT, SLA, ASA, concurrency), and operating hours per LOB per channel.
        These are the default values used by Demand Planning and Intraday Forecast. All changes save automatically.
      </p>

      <SummaryTable settings={settings} onToggle={toggleExpanded} />

      <div className="space-y-4">
        {settings.map((s) => (
          <LobCard
            key={s.lob_id}
            s={s}
            isOpen={expanded.has(s.lob_id)}
            isSaving={saving.has(s.lob_id)}
            hasError={saveError.has(s.lob_id)}
            onToggle={toggleExpanded}
            onUpdate={update}
            onUpdateHours={updateHours}
          />
        ))}
      </div>
    </PageLayout>
  );
}
