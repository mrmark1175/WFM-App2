import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { PageLayout } from "../components/PageLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { Plus, Trash2, Cloud, CloudOff, Loader2 } from "lucide-react";
import { useLOB } from "../lib/lobContext";
import { apiUrl } from "../lib/api";

// Types
type ShrinkageFrequency = "per_day" | "per_week" | "per_month" | "per_year";

interface ShrinkageItem {
  id: string;
  label: string;
  enabled: boolean;
  durationMinutes: number;
  occurrences: number;
  frequency: ShrinkageFrequency;
  isHoliday?: boolean;
}

const FREQ_OPTIONS = [
  { value: "per_day",   label: "/ Day"   },
  { value: "per_week",  label: "/ Week"  },
  { value: "per_month", label: "/ Month" },
  { value: "per_year",  label: "/ Year"  },
] as const;

const DEFAULT_ABSENCE_ITEMS: ShrinkageItem[] = [
  { id: "annual_leave",    label: "Annual Leave",          enabled: true, durationMinutes: 450, occurrences: 15, frequency: "per_year" },
  { id: "sick_leave",      label: "Sick / Personal Leave", enabled: true, durationMinutes: 450, occurrences: 5,  frequency: "per_year" },
  { id: "special_leave",   label: "Special Day Leave",     enabled: true, durationMinutes: 450, occurrences: 3,  frequency: "per_year" },
  { id: "public_holidays", label: "Public Holidays",       enabled: true, durationMinutes: 450, occurrences: 11, frequency: "per_year", isHoliday: true },
];

const DEFAULT_ACTIVITY_ITEMS: ShrinkageItem[] = [
  { id: "breaks",   label: "Breaks (2 × 15 min)", enabled: true, durationMinutes: 15,  occurrences: 2, frequency: "per_day"   },
  { id: "lunch",    label: "Lunch / On Dine",      enabled: true, durationMinutes: 30,  occurrences: 1, frequency: "per_day"   },
  { id: "coaching", label: "Coaching / 1:1",        enabled: true, durationMinutes: 30,  occurrences: 1, frequency: "per_month" },
  { id: "training", label: "Training",              enabled: true, durationMinutes: 120, occurrences: 1, frequency: "per_month" },
  { id: "meetings", label: "Team Meetings",         enabled: true, durationMinutes: 60,  occurrences: 1, frequency: "per_week"  },
  { id: "huddle",   label: "Team Huddle",           enabled: true, durationMinutes: 15,  occurrences: 1, frequency: "per_week"  },
];

function computeShrinkage(items: ShrinkageItem[], hoursPerDay: number, daysPerWeek: number): number {
  const daysPerYear = daysPerWeek * 52;
  const minutesPerYear = hoursPerDay * 60 * daysPerYear;
  if (minutesPerYear <= 0) return 0;
  const totalLostMinutes = items.filter(i => i.enabled).reduce((sum, item) => {
    const annual = item.frequency === "per_day" ? item.occurrences * daysPerYear
      : item.frequency === "per_week"  ? item.occurrences * 52
      : item.frequency === "per_month" ? item.occurrences * 12
      : item.occurrences;
    return sum + annual * item.durationMinutes;
  }, 0);
  return Math.min(99, Number(((totalLostMinutes / minutesPerYear) * 100).toFixed(1)));
}

function itemContribution(item: ShrinkageItem, hoursPerDay: number, daysPerWeek: number): number {
  const daysPerYear = daysPerWeek * 52;
  const minutesPerYear = hoursPerDay * 60 * daysPerYear;
  if (minutesPerYear <= 0 || !item.enabled) return 0;
  const annual = item.frequency === "per_day" ? item.occurrences * daysPerYear
    : item.frequency === "per_week"  ? item.occurrences * 52
    : item.frequency === "per_month" ? item.occurrences * 12
    : item.occurrences;
  return Number(((annual * item.durationMinutes / minutesPerYear) * 100).toFixed(1));
}

// ── Excel-like section table ──────────────────────────────────────────────────

interface ShrinkageTableProps {
  items: ShrinkageItem[];
  onChange: (id: string, changes: Partial<ShrinkageItem>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  hoursPerDay: number;
  daysPerWeek: number;
}

function ShrinkageTableSection({ items, onChange, onAdd, onRemove, hoursPerDay, daysPerWeek }: ShrinkageTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs min-w-[580px]">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="w-8 py-2 pl-3" />
            <th className="py-2 px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Item</th>
            <th className="py-2 px-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500 w-24">Occurrences</th>
            <th className="py-2 px-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500 w-28">Frequency</th>
            <th className="py-2 px-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500 w-28">Duration (min)</th>
            <th className="py-2 px-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500 w-14">%</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className={`border-b border-slate-100 transition-colors hover:bg-slate-50/70 ${!item.enabled ? "opacity-40" : ""}`}
            >
              <td className="py-1.5 pl-3 w-8">
                <Checkbox
                  checked={item.enabled}
                  onCheckedChange={(checked) => onChange(item.id, { enabled: checked as boolean })}
                />
              </td>
              <td className="py-1 px-2">
                <Input
                  type="text"
                  value={item.label}
                  onChange={(e) => onChange(item.id, { label: e.target.value })}
                  className="h-7 text-xs px-2 border-transparent bg-transparent hover:border-slate-200 focus:border-slate-300 focus:bg-white rounded"
                />
              </td>
              <td className="py-1 px-2">
                <Input
                  type="number"
                  value={item.occurrences}
                  onChange={(e) => onChange(item.id, { occurrences: parseFloat(e.target.value) || 1 })}
                  className="h-7 text-xs text-right font-mono border-transparent bg-transparent hover:border-slate-200 focus:border-slate-300 focus:bg-white rounded w-full"
                />
              </td>
              <td className="py-1 px-2">
                <Select value={item.frequency} onValueChange={(f) => onChange(item.id, { frequency: f as ShrinkageFrequency })}>
                  <SelectTrigger className="h-7 text-xs border-transparent bg-transparent hover:border-slate-200 focus:border-slate-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQ_OPTIONS.map(({ value, label }) => (
                      <SelectItem key={value} value={value} className="text-xs">{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td className="py-1 px-2">
                <Input
                  type="number"
                  value={item.durationMinutes}
                  onChange={(e) => onChange(item.id, { durationMinutes: parseFloat(e.target.value) || 1 })}
                  className="h-7 text-xs text-right font-mono border-transparent bg-transparent hover:border-slate-200 focus:border-slate-300 focus:bg-white rounded w-full"
                />
              </td>
              <td className="py-1.5 px-3 text-right font-mono font-bold text-rose-600 tabular-nums">
                {itemContribution(item, hoursPerDay, daysPerWeek)}%
              </td>
              <td className="py-1.5 pr-2 w-8">
                {!item.isHoliday && (
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    className="flex items-center justify-center h-5 w-5 rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </td>
            </tr>
          ))}
          <tr className="border-b border-slate-100">
            <td colSpan={7} className="py-1.5 px-3">
              <button
                type="button"
                onClick={onAdd}
                className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
              >
                <Plus className="size-3" />
                Add Item
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ShrinkagePlanning() {
  const { activeLob, isLoading: lobLoading } = useLOB();

  const [hoursPerDay, setHoursPerDay]     = useState<number>(7.5);
  const [daysPerWeek, setDaysPerWeek]     = useState<number>(5);
  const [absenceItems, setAbsenceItems]   = useState<ShrinkageItem[]>(DEFAULT_ABSENCE_ITEMS);
  const [activityItems, setActivityItems] = useState<ShrinkageItem[]>(DEFAULT_ACTIVITY_ITEMS);
  const [netFteInput, setNetFteInput]     = useState<string>("");
  const [isLoading, setIsLoading]         = useState(false);
  const [saveStatus, setSaveStatus]       = useState<"idle" | "saving" | "saved" | "error">("idle");

  const initialized    = useRef(false);
  const loadedForLob   = useRef<number | null | undefined>(undefined);
  const saveTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lobLoading || !activeLob) return;
    if (loadedForLob.current === activeLob.id) return;
    initialized.current = false;
    loadedForLob.current = activeLob.id;
    setIsLoading(true);
    fetch(apiUrl(`/api/shrinkage-plan?lob_id=${activeLob.id}`))
      .then((r) => r.json())
      .then((data) => {
        if (data && data.id) {
          setHoursPerDay(data.hours_per_day ?? 7.5);
          setDaysPerWeek(data.days_per_week ?? 5);
          setAbsenceItems(data.absence_items?.length ? data.absence_items : DEFAULT_ABSENCE_ITEMS);
          setActivityItems(data.activity_items?.length ? data.activity_items : DEFAULT_ACTIVITY_ITEMS);
          setNetFteInput(data.net_fte_input != null ? String(data.net_fte_input) : "");
        } else {
          setHoursPerDay(7.5); setDaysPerWeek(5);
          setAbsenceItems(DEFAULT_ABSENCE_ITEMS);
          setActivityItems(DEFAULT_ACTIVITY_ITEMS);
          setNetFteInput("");
        }
      })
      .catch(() => {})
      .finally(() => {
        setIsLoading(false);
        setTimeout(() => { initialized.current = true; }, 100);
      });
  }, [lobLoading, activeLob]);

  const saveToDb = useCallback((
    hpd: number, dpw: number,
    absence: ShrinkageItem[], activity: ShrinkageItem[],
    netFte: string, lobId: number,
  ) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(apiUrl(`/api/shrinkage-plan?lob_id=${lobId}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hours_per_day: hpd, days_per_week: dpw, absence_items: absence, activity_items: activity, net_fte_input: parseFloat(netFte) || null }),
        });
        setSaveStatus(r.ok ? "saved" : "error");
        setTimeout(() => setSaveStatus("idle"), 2500);
      } catch {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 2500);
      }
    }, 1500);
  }, []);

  useEffect(() => {
    if (!initialized.current || !activeLob) return;
    saveToDb(hoursPerDay, daysPerWeek, absenceItems, activityItems, netFteInput, activeLob.id);
  }, [hoursPerDay, daysPerWeek, absenceItems, activityItems, netFteInput, activeLob, saveToDb]);

  const handleHoursPerDayChange = (next: number) => {
    const shiftMin = Math.round(next * 60);
    setAbsenceItems((prev) => prev.map((item) => ({ ...item, durationMinutes: shiftMin })));
    setHoursPerDay(next);
  };

  const handleAbsenceChange  = (id: string, changes: Partial<ShrinkageItem>) => setAbsenceItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  const handleActivityChange = (id: string, changes: Partial<ShrinkageItem>) => setActivityItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const addAbsenceItem  = () => setAbsenceItems((prev) => [...prev, { id: `absence_${Date.now()}`,  label: "New Absence Item", enabled: true, durationMinutes: Math.round(hoursPerDay * 60), occurrences: 1, frequency: "per_year" }]);
  const removeAbsenceItem  = (id: string) => setAbsenceItems((prev) => prev.filter((i) => i.id !== id));
  const addActivityItem = () => setActivityItems((prev) => [...prev, { id: `activity_${Date.now()}`, label: "New Activity",      enabled: true, durationMinutes: 30, occurrences: 1, frequency: "per_week" }]);
  const removeActivityItem = (id: string) => setActivityItems((prev) => prev.filter((i) => i.id !== id));

  // Derived values
  const absenceExclHolidays = useMemo(() => computeShrinkage(absenceItems.filter(i => !i.isHoliday), hoursPerDay, daysPerWeek), [absenceItems, hoursPerDay, daysPerWeek]);
  const absenceInclHolidays = useMemo(() => computeShrinkage(absenceItems, hoursPerDay, daysPerWeek), [absenceItems, hoursPerDay, daysPerWeek]);
  const activityShrinkage   = useMemo(() => computeShrinkage(activityItems, hoursPerDay, daysPerWeek), [activityItems, hoursPerDay, daysPerWeek]);
  const totalExclHolidays   = Number((absenceExclHolidays + activityShrinkage).toFixed(1));
  const totalInclHolidays   = Number((absenceInclHolidays + activityShrinkage).toFixed(1));
  const holidayContrib      = Number((absenceInclHolidays - absenceExclHolidays).toFixed(1));

  const netFte        = parseFloat(netFteInput) || 0;
  const grossFteExcl  = netFte > 0 && totalExclHolidays < 100 ? Number((netFte / (1 - totalExclHolidays / 100)).toFixed(1)) : null;
  const grossFteIncl  = netFte > 0 && totalInclHolidays < 100 ? Number((netFte / (1 - totalInclHolidays / 100)).toFixed(1)) : null;

  const shiftMinutes = Math.round(hoursPerDay * 60);
  const daysPerYear  = daysPerWeek * 52;
  const lobKey       = activeLob ? `_lob${activeLob.id}` : "";

  useEffect(() => {
    localStorage.setItem(`wfm_shrinkage_totals${lobKey}`, JSON.stringify({ totalExcl: totalExclHolidays, totalIncl: totalInclHolidays, lastUpdated: new Date().toISOString() }));
  }, [totalExclHolidays, totalInclHolidays, lobKey]);

  // ── UI ──────────────────────────────────────────────────────────────────────

  return (
    <PageLayout title="Shrinkage Planning">

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white -mx-4 px-4 mb-5 h-[52px]">
        <span className="text-sm font-bold text-slate-800">Shrinkage Planning</span>
        {activeLob && (
          <Badge variant="outline" className="text-[11px] border-slate-200 text-slate-500 font-medium">{activeLob.lob_name}</Badge>
        )}
        <div className="h-4 w-px bg-slate-200 hidden sm:block" />

        {/* FTE definition inline */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap">Hrs / Day</span>
          <Input
            type="number" step="0.5" min="0.5" max="24"
            value={hoursPerDay}
            onChange={(e) => handleHoursPerDayChange(parseFloat(e.target.value) || 0)}
            className="h-7 w-16 text-xs text-center border-slate-200 font-semibold"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap">Days / Wk</span>
          <Input
            type="number" step="1" min="1" max="7"
            value={daysPerWeek}
            onChange={(e) => setDaysPerWeek(parseFloat(e.target.value) || 1)}
            className="h-7 w-14 text-xs text-center border-slate-200 font-semibold"
          />
        </div>
        <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-400">
          <span className="font-mono">{shiftMinutes} min/shift</span>
          <span>·</span>
          <span className="font-mono">{(hoursPerDay * daysPerWeek).toFixed(1)} h/wk</span>
          <span>·</span>
          <span className="font-mono">{daysPerYear} d/yr</span>
        </div>

        <div className="flex-1" />

        {/* Save status */}
        <div className="flex items-center gap-1.5 text-[11px]">
          {isLoading && <><Loader2 className="size-3 animate-spin text-slate-400" /><span className="text-slate-400">Loading…</span></>}
          {!isLoading && saveStatus === "saving" && <><Loader2 className="size-3 animate-spin text-slate-400" /><span className="text-slate-400">Saving…</span></>}
          {!isLoading && saveStatus === "saved"  && <><Cloud className="size-3 text-emerald-500" /><span className="text-emerald-600">Saved</span></>}
          {!isLoading && saveStatus === "error"  && <><CloudOff className="size-3 text-rose-500" /><span className="text-rose-600">Save failed</span></>}
        </div>
      </div>

      {/* ── Section: Absence Shrinkage ──────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Absence Shrinkage</span>
            <span className="text-[11px] text-slate-400 hidden sm:inline">Off-Phone — Absent</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-semibold shrink-0">
            <span className="text-amber-600">Excl. Holidays: <span className="font-black tabular-nums">{absenceExclHolidays}%</span></span>
            <span className="text-slate-200">|</span>
            <span className="text-orange-600">Incl. Holidays: <span className="font-black tabular-nums">{absenceInclHolidays}%</span></span>
          </div>
        </div>
        <ShrinkageTableSection
          items={absenceItems}
          onChange={handleAbsenceChange}
          onAdd={addAbsenceItem}
          onRemove={removeAbsenceItem}
          hoursPerDay={hoursPerDay}
          daysPerWeek={daysPerWeek}
        />
      </div>

      {/* ── Section: In-Work Activities ─────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">In-Work Off-Phone Activities</span>
          </div>
          <span className="text-[11px] font-semibold text-blue-600 shrink-0">
            Activities: <span className="font-black tabular-nums">{activityShrinkage}%</span>
          </span>
        </div>
        <ShrinkageTableSection
          items={activityItems}
          onChange={handleActivityChange}
          onAdd={addActivityItem}
          onRemove={removeActivityItem}
          hoursPerDay={hoursPerDay}
          daysPerWeek={daysPerWeek}
        />
      </div>

      {/* ── Section: Summary ────────────────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Summary</span>
        </div>

        {/* Stacked bar */}
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="flex h-4 rounded overflow-hidden bg-slate-100">
            <div style={{ width: `${absenceExclHolidays}%` }} className="bg-amber-400 transition-all" title={`Absence (excl. holidays) ${absenceExclHolidays}%`} />
            <div style={{ width: `${holidayContrib}%` }}     className="bg-orange-400 transition-all" title={`Holidays ${holidayContrib}%`} />
            <div style={{ width: `${activityShrinkage}%` }}  className="bg-blue-400 transition-all"   title={`Activities ${activityShrinkage}%`} />
            <div style={{ width: `${Math.max(0, 100 - totalInclHolidays)}%` }} className="bg-emerald-200 transition-all" title={`Productive ${Math.max(0, 100 - totalInclHolidays).toFixed(1)}%`} />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-0.5 px-0.5">
            <span>0%</span><span>100%</span>
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-2">
            {[
              { color: "bg-amber-400",   label: `Absence (excl.)  ${absenceExclHolidays}%` },
              { color: "bg-orange-400",  label: `Holidays  ${holidayContrib}%` },
              { color: "bg-blue-400",    label: `In-Work  ${activityShrinkage}%` },
              { color: "bg-emerald-200", label: `Productive  ${Math.max(0, 100 - totalInclHolidays).toFixed(1)}%` },
            ].map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${color}`} />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Metric tiles */}
        <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-slate-100">
          {[
            { label: "Absence (excl.)",  value: `${absenceExclHolidays}%`,  accent: "text-amber-600" },
            { label: "In-Work",          value: `${activityShrinkage}%`,    accent: "text-blue-600"  },
            { label: "Holidays",         value: `${holidayContrib}%`,       accent: "text-orange-600"},
            { label: "Total (excl.)",    value: `${totalExclHolidays}%`,    accent: "text-rose-600"  },
            { label: "Total (incl.)",    value: `${totalInclHolidays}%`,    accent: "text-rose-700 font-black" },
          ].map(({ label, value, accent }) => (
            <div key={label} className="flex flex-col items-center py-3 px-2 text-center">
              <span className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">{label}</span>
              <span className={`text-xl font-black tabular-nums mt-0.5 ${accent}`}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section: FTE Gross-Up ────────────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">FTE Gross-Up Calculator</span>
        </div>
        <div className="flex flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap">Net FTE Required</span>
            <Input
              id="net-fte"
              type="number"
              placeholder="e.g. 45"
              value={netFteInput}
              onChange={(e) => setNetFteInput(e.target.value)}
              className="h-8 w-24 text-sm text-center font-bold border-slate-200"
            />
          </div>

          <div className="h-5 w-px bg-slate-200 hidden sm:block" />

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 whitespace-nowrap">Gross FTE (excl. Holidays)</span>
            <span className="text-lg font-black text-slate-700 tabular-nums min-w-[3rem] text-center">
              {grossFteExcl !== null ? grossFteExcl : "—"}
            </span>
            <span className="text-[11px] text-slate-400">using {totalExclHolidays}%</span>
          </div>

          <div className="h-5 w-px bg-slate-200 hidden sm:block" />

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 whitespace-nowrap">Gross FTE (incl. Holidays)</span>
            <span className="text-lg font-black text-rose-600 tabular-nums min-w-[3rem] text-center">
              {grossFteIncl !== null ? grossFteIncl : "—"}
            </span>
            <span className="text-[11px] text-slate-400">using {totalInclHolidays}%</span>
          </div>
        </div>

        <div className="px-4 py-2.5 border-t border-slate-100 bg-blue-50/40">
          <p className="text-[11px] text-blue-700">
            <span className="font-semibold">Tip:</span> These shrinkage values are available in{" "}
            <strong>Long Term Forecasting (Demand)</strong> → Demand Assumptions → Shrinkage dropdown.
          </p>
        </div>
      </div>

    </PageLayout>
  );
}
