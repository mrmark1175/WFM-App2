import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { PageLayout } from "../components/PageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
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

// Frequency options
const FREQ_OPTIONS = [
  { value: "per_day", label: "/ Day" },
  { value: "per_week", label: "/ Week" },
  { value: "per_month", label: "/ Month" },
  { value: "per_year", label: "/ Year" },
] as const;

// Default absence items (with shift = 450 min = 7.5 hours)
const DEFAULT_ABSENCE_ITEMS: ShrinkageItem[] = [
  {
    id: "annual_leave",
    label: "Annual Leave",
    enabled: true,
    durationMinutes: 450,
    occurrences: 15,
    frequency: "per_year",
  },
  {
    id: "sick_leave",
    label: "Sick / Personal Leave",
    enabled: true,
    durationMinutes: 450,
    occurrences: 5,
    frequency: "per_year",
  },
  {
    id: "special_leave",
    label: "Special Day Leave",
    enabled: true,
    durationMinutes: 450,
    occurrences: 3,
    frequency: "per_year",
  },
  {
    id: "public_holidays",
    label: "Public Holidays",
    enabled: true,
    durationMinutes: 450,
    occurrences: 11,
    frequency: "per_year",
    isHoliday: true,
  },
];

// Default in-work activity items (fixed durations)
const DEFAULT_ACTIVITY_ITEMS: ShrinkageItem[] = [
  {
    id: "breaks",
    label: "Breaks (2 × 15 min)",
    enabled: true,
    durationMinutes: 15,
    occurrences: 2,
    frequency: "per_day",
  },
  {
    id: "lunch",
    label: "Lunch / On Dine",
    enabled: true,
    durationMinutes: 30,
    occurrences: 1,
    frequency: "per_day",
  },
  {
    id: "coaching",
    label: "Coaching / 1:1",
    enabled: true,
    durationMinutes: 30,
    occurrences: 1,
    frequency: "per_month",
  },
  {
    id: "training",
    label: "Training",
    enabled: true,
    durationMinutes: 120,
    occurrences: 1,
    frequency: "per_month",
  },
  {
    id: "meetings",
    label: "Team Meetings",
    enabled: true,
    durationMinutes: 60,
    occurrences: 1,
    frequency: "per_week",
  },
  {
    id: "huddle",
    label: "Team Huddle",
    enabled: true,
    durationMinutes: 15,
    occurrences: 1,
    frequency: "per_week",
  },
];

// Computation functions
function computeShrinkage(
  items: ShrinkageItem[],
  hoursPerDay: number,
  daysPerWeek: number
): number {
  const daysPerYear = daysPerWeek * 52;
  const minutesPerYear = hoursPerDay * 60 * daysPerYear;
  if (minutesPerYear <= 0) return 0;

  const totalLostMinutes = items
    .filter((i) => i.enabled)
    .reduce((sum, item) => {
      const annual =
        item.frequency === "per_day"
          ? item.occurrences * daysPerYear
          : item.frequency === "per_week"
            ? item.occurrences * 52
            : item.frequency === "per_month"
              ? item.occurrences * 12
              : item.occurrences;
      return sum + annual * item.durationMinutes;
    }, 0);

  return Math.min(99, Number(((totalLostMinutes / minutesPerYear) * 100).toFixed(1)));
}

function itemContribution(
  item: ShrinkageItem,
  hoursPerDay: number,
  daysPerWeek: number
): number {
  const daysPerYear = daysPerWeek * 52;
  const minutesPerYear = hoursPerDay * 60 * daysPerYear;
  if (minutesPerYear <= 0 || !item.enabled) return 0;

  const annual =
    item.frequency === "per_day"
      ? item.occurrences * daysPerYear
      : item.frequency === "per_week"
        ? item.occurrences * 52
        : item.frequency === "per_month"
          ? item.occurrences * 12
          : item.occurrences;

  return Number(((annual * item.durationMinutes / minutesPerYear) * 100).toFixed(1));
}

export function ShrinkagePlanning() {
  const { activeLob, isLoading: lobLoading } = useLOB();

  // State
  const [hoursPerDay, setHoursPerDay] = useState<number>(7.5);
  const [daysPerWeek, setDaysPerWeek] = useState<number>(5);
  const [absenceItems, setAbsenceItems] = useState<ShrinkageItem[]>(DEFAULT_ABSENCE_ITEMS);
  const [activityItems, setActivityItems] = useState<ShrinkageItem[]>(DEFAULT_ACTIVITY_ITEMS);
  const [netFteInput, setNetFteInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Refs to prevent save-on-load and track the loaded LOB
  const initialized = useRef(false);
  const loadedForLob = useRef<number | null | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load from DB when LOB changes ──────────────────────────────────────────
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
          // No saved plan yet — reset to defaults
          setHoursPerDay(7.5);
          setDaysPerWeek(5);
          setAbsenceItems(DEFAULT_ABSENCE_ITEMS);
          setActivityItems(DEFAULT_ACTIVITY_ITEMS);
          setNetFteInput("");
        }
      })
      .catch(() => { /* keep defaults */ })
      .finally(() => {
        setIsLoading(false);
        // Small delay so React flushes the state updates before we enable saving
        setTimeout(() => { initialized.current = true; }, 100);
      });
  }, [lobLoading, activeLob]);

  // ── Debounced save to DB ────────────────────────────────────────────────────
  const saveToDb = useCallback((
    hpd: number,
    dpw: number,
    absence: ShrinkageItem[],
    activity: ShrinkageItem[],
    netFte: string,
    lobId: number,
  ) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(apiUrl(`/api/shrinkage-plan?lob_id=${lobId}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hours_per_day: hpd,
            days_per_week: dpw,
            absence_items: absence,
            activity_items: activity,
            net_fte_input: parseFloat(netFte) || null,
          }),
        });
        setSaveStatus(r.ok ? "saved" : "error");
        setTimeout(() => setSaveStatus("idle"), 2500);
      } catch {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 2500);
      }
    }, 1500);
  }, []);

  // Trigger save whenever any editable state changes (after initial load)
  useEffect(() => {
    if (!initialized.current || !activeLob) return;
    saveToDb(hoursPerDay, daysPerWeek, absenceItems, activityItems, netFteInput, activeLob.id);
  }, [hoursPerDay, daysPerWeek, absenceItems, activityItems, netFteInput, activeLob, saveToDb]);

  // Handlers
  const handleHoursPerDayChange = (next: number) => {
    const shiftMin = Math.round(next * 60);
    setAbsenceItems((prev) =>
      prev.map((item) => ({ ...item, durationMinutes: shiftMin }))
    );
    setHoursPerDay(next);
  };

  const handleAbsenceChange = (id: string, changes: Partial<ShrinkageItem>) => {
    setAbsenceItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes } : item))
    );
  };

  const handleActivityChange = (id: string, changes: Partial<ShrinkageItem>) => {
    setActivityItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes } : item))
    );
  };

  const addAbsenceItem = () => {
    const id = `absence_${Date.now()}`;
    setAbsenceItems((prev) => [
      ...prev,
      {
        id,
        label: "New Absence Item",
        enabled: true,
        durationMinutes: Math.round(hoursPerDay * 60),
        occurrences: 1,
        frequency: "per_year",
      },
    ]);
  };

  const removeAbsenceItem = (id: string) => {
    setAbsenceItems((prev) => prev.filter((i) => i.id !== id));
  };

  const addActivityItem = () => {
    const id = `activity_${Date.now()}`;
    setActivityItems((prev) => [
      ...prev,
      {
        id,
        label: "New Activity",
        enabled: true,
        durationMinutes: 30,
        occurrences: 1,
        frequency: "per_week",
      },
    ]);
  };

  const removeActivityItem = (id: string) => {
    setActivityItems((prev) => prev.filter((i) => i.id !== id));
  };

  // Derived values
  const absenceExclHolidays = useMemo(
    () =>
      computeShrinkage(
        absenceItems.filter((i) => !i.isHoliday),
        hoursPerDay,
        daysPerWeek
      ),
    [absenceItems, hoursPerDay, daysPerWeek]
  );

  const absenceInclHolidays = useMemo(
    () => computeShrinkage(absenceItems, hoursPerDay, daysPerWeek),
    [absenceItems, hoursPerDay, daysPerWeek]
  );

  const activityShrinkage = useMemo(
    () => computeShrinkage(activityItems, hoursPerDay, daysPerWeek),
    [activityItems, hoursPerDay, daysPerWeek]
  );

  const totalExclHolidays = Number(
    (absenceExclHolidays + activityShrinkage).toFixed(1)
  );
  const totalInclHolidays = Number(
    (absenceInclHolidays + activityShrinkage).toFixed(1)
  );

  const netFte = parseFloat(netFteInput) || 0;
  const grossFteExcl =
    netFte > 0 && totalExclHolidays < 100
      ? Number((netFte / (1 - totalExclHolidays / 100)).toFixed(1))
      : null;
  const grossFteIncl =
    netFte > 0 && totalInclHolidays < 100
      ? Number((netFte / (1 - totalInclHolidays / 100)).toFixed(1))
      : null;

  const shiftMinutes = Math.round(hoursPerDay * 60);
  const daysPerYear = daysPerWeek * 52;

  // Mirror computed totals to localStorage so LongTermForecasting_Demand can read them (keyed by LOB)
  const lobKey = activeLob ? `_lob${activeLob.id}` : "";
  useEffect(() => {
    localStorage.setItem(
      `wfm_shrinkage_totals${lobKey}`,
      JSON.stringify({
        totalExcl: totalExclHolidays,
        totalIncl: totalInclHolidays,
        lastUpdated: new Date().toISOString(),
      })
    );
  }, [totalExclHolidays, totalInclHolidays, lobKey]);

  return (
    <PageLayout title="Shrinkage Planning">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          {activeLob && (
            <>
              <span className="text-sm text-muted-foreground">Line of Business:</span>
              <Badge variant="outline" className="text-sm font-medium">{activeLob.lob_name}</Badge>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {isLoading && <><Loader2 className="size-3 animate-spin" /><span>Loading…</span></>}
          {!isLoading && saveStatus === "saving" && <><Loader2 className="size-3 animate-spin" /><span>Saving…</span></>}
          {!isLoading && saveStatus === "saved" && <><Cloud className="size-3 text-green-500" /><span className="text-green-600 dark:text-green-400">Saved</span></>}
          {!isLoading && saveStatus === "error" && <><CloudOff className="size-3 text-destructive" /><span className="text-destructive">Save failed</span></>}
        </div>
      </div>
      <div className="flex gap-6 items-start">
        {/* LEFT PANEL — FTE Definition */}
        <div className="w-72 shrink-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>FTE Definition</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="hours-per-day">Hours per Day</Label>
                <Input
                  id="hours-per-day"
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="24"
                  value={hoursPerDay}
                  onChange={(e) => handleHoursPerDayChange(parseFloat(e.target.value) || 0)}
                  className="h-9 font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="days-per-week">Days per Week</Label>
                <Input
                  id="days-per-week"
                  type="number"
                  step="1"
                  min="1"
                  max="7"
                  value={daysPerWeek}
                  onChange={(e) => setDaysPerWeek(parseFloat(e.target.value) || 1)}
                  className="h-9 font-semibold"
                />
              </div>

              <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Shift Duration</span>
                  <span className="font-bold">{shiftMinutes} min</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Hours per Week</span>
                  <span className="font-bold">
                    {(hoursPerDay * daysPerWeek).toFixed(1)}h
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Operating Days/Year</span>
                  <span className="font-bold">{daysPerYear}d</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT CONTENT — Shrinkage sections + summary */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* SECTION A: Absence / Leave */}
          <Card>
            <CardHeader className="border-b pb-4">
              <div className="flex items-center justify-between">
                <CardTitle>Absence Shrinkage (Off-Phone — Absent)</CardTitle>
                <div className="flex gap-2">
                  <Badge variant="outline" className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200">
                    Excl. Holidays: {absenceExclHolidays}%
                  </Badge>
                  <Badge variant="outline" className="bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border-orange-200">
                    Incl. Holidays: {absenceInclHolidays}%
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <ShrinkageTable
                items={absenceItems}
                onChange={handleAbsenceChange}
                onAdd={addAbsenceItem}
                onRemove={removeAbsenceItem}
                hoursPerDay={hoursPerDay}
                daysPerWeek={daysPerWeek}
                showHolidayFlag
              />
            </CardContent>
          </Card>

          {/* SECTION B: In-Work Off-Phone Activities */}
          <Card>
            <CardHeader className="border-b pb-4">
              <div className="flex items-center justify-between">
                <CardTitle>In-Work Off-Phone Activities</CardTitle>
                <Badge variant="outline" className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-200">
                  Activities: {activityShrinkage}%
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <ShrinkageTable
                items={activityItems}
                onChange={handleActivityChange}
                onAdd={addActivityItem}
                onRemove={removeActivityItem}
                hoursPerDay={hoursPerDay}
                daysPerWeek={daysPerWeek}
              />
            </CardContent>
          </Card>

          {/* SUMMARY */}
          <ShrinkageSummary
            absenceExcl={absenceExclHolidays}
            absenceIncl={absenceInclHolidays}
            activity={activityShrinkage}
            totalExcl={totalExclHolidays}
            totalIncl={totalInclHolidays}
          />

          {/* FTE IMPACT CALCULATOR */}
          <FteImpactCalculator
            netFteInput={netFteInput}
            onNetFteChange={setNetFteInput}
            totalExcl={totalExclHolidays}
            totalIncl={totalInclHolidays}
            grossFteExcl={grossFteExcl}
            grossFteIncl={grossFteIncl}
          />
        </div>
      </div>
    </PageLayout>
  );
}

// Sub-components

interface ShrinkageTableProps {
  items: ShrinkageItem[];
  onChange: (id: string, changes: Partial<ShrinkageItem>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  hoursPerDay: number;
  daysPerWeek: number;
  showHolidayFlag?: boolean;
}

function ShrinkageTable({
  items,
  onChange,
  onAdd,
  onRemove,
  hoursPerDay,
  daysPerWeek,
  showHolidayFlag,
}: ShrinkageTableProps) {
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div className="min-w-max space-y-0.5">
          {/* Header */}
          <div className="grid gap-2 px-2 py-1.5 bg-slate-100 dark:bg-slate-800 rounded text-[11px] font-black uppercase tracking-widest text-muted-foreground"
            style={{ gridTemplateColumns: "2rem 1fr 5rem 5.5rem 5.5rem 3.5rem 2rem" }}>
            <div></div>
            <div>Item</div>
            <div className="text-right">Occurrences</div>
            <div className="text-right">Frequency</div>
            <div className="text-right">Duration (min)</div>
            <div className="text-right">%</div>
            <div></div>
          </div>

          {/* Rows */}
          {items.map((item) => (
            <div
              key={item.id}
              className={`grid gap-2 px-2 py-2 border rounded items-center ${
                item.enabled ? "opacity-100" : "opacity-40"
              }`}
              style={{ gridTemplateColumns: "2rem 1fr 5rem 5.5rem 5.5rem 3.5rem 2rem" }}>
              <Checkbox
                checked={item.enabled}
                onCheckedChange={(checked) =>
                  onChange(item.id, { enabled: checked as boolean })
                }
              />

              <Input
                type="text"
                value={item.label}
                onChange={(e) => onChange(item.id, { label: e.target.value })}
                placeholder="Label"
                className="h-6 text-xs px-2"
              />

              <Input
                type="number"
                value={item.occurrences}
                onChange={(e) => onChange(item.id, { occurrences: parseFloat(e.target.value) || 1 })}
                className="h-6 text-xs px-1 text-center font-bold"
              />

              <Select
                value={item.frequency}
                onValueChange={(freq) =>
                  onChange(item.id, { frequency: freq as ShrinkageFrequency })
                }>
                <SelectTrigger className="h-6 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-max">
                  {FREQ_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={value} className="text-xs">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                type="number"
                value={item.durationMinutes}
                onChange={(e) =>
                  onChange(item.id, { durationMinutes: parseFloat(e.target.value) || 1 })
                }
                className="h-6 text-xs px-1 text-center font-bold"
              />

              <div
                className={`text-xs font-black text-right ${
                  item.enabled
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-muted-foreground"
                }`}>
                {itemContribution(item, hoursPerDay, daysPerWeek)}%
              </div>

              <div>
                {!item.isHoliday && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onRemove(item.id)}
                    className="h-5 w-5 hover:text-destructive">
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add Button */}
      <Button
        onClick={onAdd}
        variant="ghost"
        size="sm"
        className="w-full text-xs">
        <Plus className="size-3 mr-1" />
        Add Item
      </Button>
    </div>
  );
}

interface ShrinkageSummaryProps {
  absenceExcl: number;
  absenceIncl: number;
  activity: number;
  totalExcl: number;
  totalIncl: number;
}

function ShrinkageSummary({
  absenceExcl,
  absenceIncl,
  activity,
  totalExcl,
  totalIncl,
}: ShrinkageSummaryProps) {
  const holidayContrib = Number((absenceIncl - absenceExcl).toFixed(1));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border p-4 text-center space-y-1">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              Absence (excl.)
            </p>
            <p className="text-2xl font-black text-amber-600 dark:text-amber-400">
              {absenceExcl}%
            </p>
          </div>

          <div className="rounded-lg border p-4 text-center space-y-1">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              In-Work Off-Phone
            </p>
            <p className="text-2xl font-black text-blue-600 dark:text-blue-400">
              {activity}%
            </p>
          </div>

          <div className="rounded-lg border p-4 text-center space-y-1 bg-rose-50/40 dark:bg-rose-950/20">
            <p className="text-xs font-black uppercase tracking-widest text-rose-700 dark:text-rose-400">
              Total (excl. Holidays)
            </p>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-400">
              {totalExcl}%
            </p>
          </div>

          <div className="rounded-lg border p-4 text-center space-y-1 bg-rose-50/60 dark:bg-rose-950/30 border-rose-300/60 dark:border-rose-700/60">
            <p className="text-xs font-black uppercase tracking-widest text-rose-700 dark:text-rose-400">
              Total (incl. Holidays)
            </p>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-400">
              {totalIncl}%
            </p>
          </div>
        </div>

        {/* Stacked bar */}
        <div className="space-y-1">
          <div className="flex h-4 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
            <div
              style={{ width: `${absenceExcl}%` }}
              className="bg-amber-400"
              title={`Absence (excl.) ${absenceExcl}%`}
            />
            <div
              style={{ width: `${holidayContrib}%` }}
              className="bg-orange-400"
              title={`Holidays ${holidayContrib}%`}
            />
            <div
              style={{ width: `${activity}%` }}
              className="bg-blue-400"
              title={`Activities ${activity}%`}
            />
            <div
              style={{ width: `${Math.max(0, 100 - totalIncl)}%` }}
              className="bg-green-200 dark:bg-green-900/40"
              title={`Productive ${Math.max(0, 100 - totalIncl)}%`}
            />
          </div>
          <div className="text-[10px] text-muted-foreground flex justify-between px-0.5">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Integration note */}
        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-700/40 p-2.5 text-[10px] text-blue-700 dark:text-blue-300 space-y-1">
          <p className="font-semibold">💡 Tip:</p>
          <p>These shrinkage values are available in <strong>Long Term Forecasting (Demand)</strong> → Demand Assumptions → Shrinkage dropdown.</p>
        </div>
      </CardContent>
    </Card>
  );
}

interface FteImpactCalculatorProps {
  netFteInput: string;
  onNetFteChange: (value: string) => void;
  totalExcl: number;
  totalIncl: number;
  grossFteExcl: number | null;
  grossFteIncl: number | null;
}

function FteImpactCalculator({
  netFteInput,
  onNetFteChange,
  totalExcl,
  totalIncl,
  grossFteExcl,
  grossFteIncl,
}: FteImpactCalculatorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>FTE Gross-Up Calculator</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
          <div className="space-y-2">
            <Label htmlFor="net-fte">Net FTE Required (from Erlang C)</Label>
            <Input
              id="net-fte"
              type="number"
              placeholder="e.g. 45"
              value={netFteInput}
              onChange={(e) => onNetFteChange(e.target.value)}
              className="h-10 font-bold text-lg"
            />
          </div>

          <div className="rounded-xl border p-4 text-center space-y-1">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              Gross FTE (excl. Holidays)
            </p>
            <p className="text-2xl font-black text-foreground">
              {grossFteExcl !== null ? grossFteExcl : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              Using {totalExcl}% shrinkage
            </p>
          </div>

          <div className="rounded-xl border p-4 text-center space-y-1 bg-rose-50/40 dark:bg-rose-950/20 border-rose-200/60 dark:border-rose-700/40">
            <p className="text-xs font-black uppercase tracking-widest text-rose-700 dark:text-rose-400">
              Gross FTE (incl. Holidays)
            </p>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-400">
              {grossFteIncl !== null ? grossFteIncl : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              Using {totalIncl}% shrinkage
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
