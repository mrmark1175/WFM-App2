import React from "react";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";

// ── Types ─────────────────────────────────────────────────────────────────────
interface FTEParams {
  callVolume: number; ahtSec: number; hoursOp: number;
  shrinkage: number; occupancy: number; targetSL: number; asaSec: number;
}
interface FTEResult {
  erlangs: number; rawAgents: number; fte: number; achievedSL: number; actualOcc: number;
}
interface WeekData {
  week: string; label: string; baseVol: number; startDate: Date;
}
interface WeekResult extends WeekData, FTEResult {}
interface DayResult extends FTEResult { day: string; vol: number; }
interface ForecastRecord {
  year_label: string; monthly_volumes: number[];
  forecast_results: number[]; forecast_method?: string;
}
interface TrainingClass {
  id: string; fte: number; live_date: string; ramp_weeks: number;
}
interface Scenario {
  id: number; scenario_name: string; forecast_year: string;
  aht: number; hours_op: number; work_days: number; day_pcts: number[];
  shrinkage: number; occupancy: number; target_sl: number; asa: number;
  selected_week: number;
  actual_fte?: number; actual_fte_start_date?: string;
  attrition_pct?: number; classes?: TrainingClass[];
  created_at?: string; updated_at?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const API_BASE = "http://localhost:5000";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function todayStr(): string { return new Date().toISOString().split("T")[0]; }
function newId(): string { return Math.random().toString(36).slice(2, 9); }

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}
function fmt(d: Date): string { return `${MONTHS[d.getMonth()]} ${d.getDate()}`; }

function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

function buildWeeksFromMonthly(monthlyVolumes: number[], startMonday: Date, workDays: number): WeekData[] {
  const weeks: WeekData[] = [];
  for (let w = 0; w < 52; w++) {
    const monday = new Date(startMonday);
    monday.setDate(monday.getDate() + w * 7);
    const lastDay = new Date(monday);
    lastDay.setDate(lastDay.getDate() + workDays - 1);
    let weekVol = 0;
    for (let d = 0; d < workDays; d++) {
      const day = new Date(monday);
      day.setDate(day.getDate() + d);
      const monthIdx = day.getMonth();
      const daysInMonth = new Date(day.getFullYear(), monthIdx + 1, 0).getDate();
      const workdaysInMonth = Math.round(daysInMonth * workDays / 7);
      weekVol += (monthlyVolumes[monthIdx] || 0) / workdaysInMonth;
    }
    weeks.push({ week: `Wk ${getISOWeek(monday)}`, label: `${fmt(monday)}–${fmt(lastDay)}`, baseVol: Math.round(weekVol), startDate: monday });
  }
  return weeks;
}

// ── Workforce: actual FTE decay + class additions ─────────────────────────────
function computeActualFTEByWeek(
  actualFTE: number, actualFTEStartDate: string,
  attritionPct: number, classes: TrainingClass[], weeks: WeekData[]
): number[] {
  if (actualFTE <= 0 || !actualFTEStartDate || weeks.length === 0)
    return Array(weeks.length).fill(0);

  // monthly attrition → weekly retention rate (compound)
  const weeklyRetention = attritionPct > 0
    ? Math.pow(1 - attritionPct / 100, 1 / 4.333)
    : 1;

  // Find which week the start date falls in
  const startMs = new Date(actualFTEStartDate + "T00:00:00").getTime();
  let startWeekIdx = 0;
  for (let i = 0; i < weeks.length; i++) {
    const wEnd = new Date(weeks[i].startDate); wEnd.setDate(wEnd.getDate() + 6);
    if (startMs <= wEnd.getTime()) { startWeekIdx = i; break; }
    startWeekIdx = i;
  }

  // Precompute which week each class goes live
  const classLiveWeeks: number[] = classes.map(cls => {
    if (!cls.live_date) return -1;
    const liveDt = new Date(cls.live_date + "T00:00:00").getTime();
    for (let i = 0; i < weeks.length; i++) {
      const wEnd = new Date(weeks[i].startDate); wEnd.setDate(wEnd.getDate() + 6);
      if (liveDt <= wEnd.getTime()) return i;
    }
    return -1;
  });

  const result: number[] = [];
  let current = actualFTE;

  for (let i = 0; i < weeks.length; i++) {
    if (i < startWeekIdx) { result.push(actualFTE); continue; }
    if (i > startWeekIdx) current *= weeklyRetention;

    // Class contributions
    classes.forEach((cls, ci) => {
      const liveWk = classLiveWeeks[ci];
      if (liveWk < 0 || cls.fte <= 0) return;
      const ramp = Math.max(cls.ramp_weeks || 0, 0);
      if (ramp === 0) {
        if (i === liveWk) current += cls.fte;
      } else {
        // Linear ramp: add fte/ramp_weeks per week for ramp_weeks weeks
        if (i >= liveWk && i < liveWk + ramp) current += cls.fte / ramp;
      }
    });

    result.push(Math.round(current * 10) / 10);
  }
  return result;
}

// ── Erlang C ──────────────────────────────────────────────────────────────────
function erlangC(A: number, N: number): number {
  const nInt = Math.floor(N);
  if (nInt <= A) return 1;
  let sumFact = 1, term = 1;
  for (let i = 1; i < nInt; i++) { term *= A / i; sumFact += term; }
  const lastTerm = term * A / nInt;
  const X = lastTerm * nInt / (nInt - A);
  return Math.min(1, Math.max(0, X / (sumFact + X)));
}
function computeServiceLevel(A: number, N: number, ahtSec: number, asaSec: number): number {
  if (N <= A) return 0;
  return 1 - erlangC(A, N) * Math.exp(-((N - A) * asaSec) / ahtSec);
}
function minAgentsForSL(A: number, ahtSec: number, asaSec: number, targetSL: number): number {
  let N = Math.ceil(A) + 1;
  for (let i = 0; i < 200; i++) { if (computeServiceLevel(A, N, ahtSec, asaSec) >= targetSL) return N; N++; }
  return N;
}
function computeFTE({ callVolume, ahtSec, hoursOp, shrinkage, occupancy, targetSL, asaSec }: FTEParams): FTEResult {
  const A = (callVolume / (hoursOp * 3600)) * ahtSec;
  const rawAgents = minAgentsForSL(A, ahtSec, asaSec, targetSL / 100);
  const actualOcc = A / rawAgents;
  const cap = actualOcc > occupancy / 100 ? Math.ceil(A / (occupancy / 100)) : rawAgents;
  const sl = computeServiceLevel(A, cap, ahtSec, asaSec) * 100;
  return { erlangs: +A.toFixed(2), rawAgents: cap, fte: +(cap / (1 - shrinkage / 100)).toFixed(1), achievedSL: +sl.toFixed(1), actualOcc: +((A / cap) * 100).toFixed(1) };
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Sparkline({ values, color = "#f97316" }: { values: number[]; color?: string }) {
  const max = Math.max(...values), min = Math.min(...values), range = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / range) * 26}`).join(" ");
  return <svg viewBox="0 0 100 30" style={{ width: 80, height: 24 }}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Badge({ value, target, unit = "" }: { value: number; target: number; unit?: string }) {
  const ok = value >= target;

  return (
    <span
      style={{
        fontSize: 15,      // ← increase this
        fontWeight: 700,
        padding: "6px 12px",
        borderRadius: 999,
        background: ok ? "#dcfce7" : "#fef9c3",
        color: ok ? "#16a34a" : "#a16207",
        display: "inline-block"
      }}
    >
      {value}
      {unit}
    </span>
  );
}

function GapBadge({ gap }: { gap: number }) {
  const over = gap >= 0;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: over ? "#dcfce7" : "#fee2e2", color: over ? "#16a34a" : "#dc2626" }}>
      {over ? "+" : ""}{Math.round(gap)}
    </span>
  );
}

function MetricCard({ label, value, sub, accent, borderColor }: { label: string; value: React.ReactNode; sub?: string; accent?: string; borderColor?: string }) {
  return (
    <div style={{
      background: "#fff",
      border: `1px solid ${borderColor || "#e5e7eb"}`,
      borderRadius: 12,
      padding: "16px",
      width: 154,
      height: 120,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
      transition: "all 0.2s"
    }}>
      <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", lineHeight: 1.2 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: accent || "#111827", display: "flex", alignItems: "center" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500, lineHeight: 1.2 }}>{sub}</div>}
    </div>
  );
}

function SliderInput({ label, value, min, max, step = 1, unit, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(String(value));
  const commit = () => {
    const p = parseFloat(draft);
    if (!isNaN(p)) onChange(Math.min(max, Math.max(min, p)));
    else setDraft(String(value));
    setEditing(false);
  };
  React.useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{label}</span>
        {editing ? (
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <input autoFocus type="number" min={min} max={max} step={step} value={draft}
              onChange={e => setDraft(e.target.value)} onBlur={commit}
              onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(String(value)); setEditing(false); } }}
              style={{ width: 62, padding: "2px 6px", fontSize: 13, fontWeight: 700, color: "#f97316", background: "#fff7ed", border: "1px solid #f97316", borderRadius: 6, textAlign: "center", outline: "none" }} />
            <span style={{ fontSize: 12, color: "#f97316", fontWeight: 600 }}>{unit}</span>
          </div>
        ) : (
          <span onClick={() => { setDraft(String(value)); setEditing(true); }} title="Click to type"
            style={{ fontSize: 13, fontWeight: 700, color: "#f97316", background: "#fff7ed", border: "1px solid #fed7aa", padding: "2px 8px", borderRadius: 6, cursor: "text", userSelect: "none", minWidth: 44, textAlign: "center" }}>
            {value}{unit}
          </span>
        )}
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)}
        style={{ width: "100%", accentColor: "#f97316", height: 4, cursor: "pointer" }} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>{min}{unit}</span>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>{max}{unit}</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function CapacityPlanning() {
  const navigate = useNavigate();

  // Planning parameters
  const [aht, setAht] = useState<number>(320);
  const [hoursOp, setHoursOp] = useState<number>(50);
  const [workDays, setWorkDays] = useState<number>(5);
  const [dayPcts, setDayPcts] = useState<number[]>([20, 20, 20, 20, 20]);
  const [shrinkage, setShrinkage] = useState<number>(30);
  const [occupancy, setOccupancy] = useState<number>(85);
  const [targetSL, setTargetSL] = useState<number>(80);
  const [asa, setAsa] = useState<number>(20);
  const [selectedWeek, setSelectedWeek] = useState<number>(0);

  // ── Workforce planning state ──
  const [actualFTE, setActualFTE] = useState<number>(0);
  const [actualFTEDate, setActualFTEDate] = useState<string>(todayStr());
  const [attritionPct, setAttritionPct] = useState<number>(0);
  const [classes, setClasses] = useState<TrainingClass[]>([]);

  // Forecast
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [selectedForecastYear, setSelectedForecastYear] = useState<string>("");
  const [projectionVolumes, setProjectionVolumes] = useState<number[]>(Array(12).fill(0));
  const [projectionLabel, setProjectionLabel] = useState<string>("");
  const [forecastMethod, setForecastMethod] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");

  // Scenarios
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved" | "">("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingScenario = useRef<boolean>(false);

  const startMonday = useMemo(() => getMondayOf(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)), []);

  useEffect(() => {
    if (isLoadingScenario.current) return;
    const even = Math.floor(100 / workDays), rem = 100 - even * workDays;
    setDayPcts(Array.from({ length: workDays }, (_, i) => even + (i === 0 ? rem : 0)));
  }, [workDays]);

  const parseVolumes = (raw: unknown): number[] => {
    if (Array.isArray(raw)) return raw as number[];
    if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return Array(12).fill(0); } }
    return Array(12).fill(0);
  };
  const parseClasses = (raw: unknown): TrainingClass[] => {
    if (Array.isArray(raw)) return raw as TrainingClass[];
    if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return []; } }
    return [];
  };
  const getProjectionLabel = (yearLabel: string, allYears: string[]): string => {
    const idx = allYears.indexOf(yearLabel);
    return idx < 0 ? `${yearLabel} Projection` : `Year ${idx + 2} Projection`;
  };

  // Build save payload including new workforce fields
  const buildPayload = useCallback((overrideName?: string) => ({
    scenario_name: overrideName ?? (scenarios.find(s => s.id === activeScenarioId)?.scenario_name ?? "Scenario 1"),
    forecast_year: selectedForecastYear,
    aht, hours_op: hoursOp, work_days: workDays, day_pcts: dayPcts,
    shrinkage, occupancy, target_sl: targetSL, asa, selected_week: selectedWeek,
    actual_fte: actualFTE, actual_fte_start_date: actualFTEDate,
    attrition_pct: attritionPct, classes,
  }), [scenarios, activeScenarioId, selectedForecastYear, aht, hoursOp, workDays, dayPcts,
       shrinkage, occupancy, targetSL, asa, selectedWeek, actualFTE, actualFTEDate, attritionPct, classes]);

  const saveScenario = useCallback(async (id: number | null = activeScenarioId) => {
    if (!id) return;
    setSaveStatus("saving");
    try {
      await fetch(`${API_BASE}/api/capacity-scenarios/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      setSaveStatus("saved"); setTimeout(() => setSaveStatus(""), 2500);
    } catch { setSaveStatus("unsaved"); }
  }, [activeScenarioId, buildPayload]);

  const triggerAutoSave = useCallback(() => {
    if (isLoadingScenario.current || !activeScenarioId) return;
    setSaveStatus("unsaved");
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveScenario(activeScenarioId), 1500);
  }, [activeScenarioId, saveScenario]);

  // Auto-save watches ALL planning + workforce fields
  useEffect(() => { triggerAutoSave(); },
    [aht, hoursOp, workDays, shrinkage, occupancy, targetSL, asa, selectedWeek,
     selectedForecastYear, dayPcts, actualFTE, actualFTEDate, attritionPct, classes]);

  const loadScenario = useCallback((s: Scenario) => {
    isLoadingScenario.current = true;
    setActiveScenarioId(s.id);
    setAht(s.aht); setHoursOp(s.hours_op); setWorkDays(s.work_days);
    setDayPcts(Array.isArray(s.day_pcts) ? s.day_pcts : JSON.parse(s.day_pcts as unknown as string));
    setShrinkage(s.shrinkage); setOccupancy(s.occupancy); setTargetSL(s.target_sl);
    setAsa(s.asa); setSelectedWeek(s.selected_week ?? 0);
    if (s.forecast_year) setSelectedForecastYear(s.forecast_year);
    setActualFTE(s.actual_fte ?? 0);
    setActualFTEDate(s.actual_fte_start_date || todayStr());
    setAttritionPct(s.attrition_pct ?? 0);
    setClasses(parseClasses(s.classes));
    setTimeout(() => { isLoadingScenario.current = false; }, 200);
  }, []);

  useEffect(() => {
    const fetchScenarios = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/capacity-scenarios`);
        const data: Scenario[] = await res.json();
        if (Array.isArray(data) && data.length > 0) { setScenarios(data); loadScenario(data[0]); }
        else await createNewScenario("Scenario 1", true);
      } catch { }
    };
    fetchScenarios();
  }, []);

  useEffect(() => {
    const fetchYears = async () => {
      setIsLoading(true); setLoadError("");
      try {
        const res = await fetch(`${API_BASE}/api/forecasts`);
        if (!res.ok) throw new Error();
        const data: ForecastRecord[] = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const years = data.map(d => d.year_label);
          setAvailableYears(years);
          setSelectedForecastYear(prev => prev || years[0]);
          const latest = data[data.length - 1];
          setProjectionVolumes(parseVolumes(latest.forecast_results));
          setProjectionLabel(getProjectionLabel(latest.year_label, years));
          setForecastMethod(latest.forecast_method || "");
        } else throw new Error();
      } catch {
        setLoadError("No forecast data found. Go to Forecasting and save a forecast first.");
        setProjectionVolumes([61000,57000,65000,70000,74000,68000,72000,75000,71000,77000,83000,79000]);
        setAvailableYears(["Sample"]); setSelectedForecastYear(prev => prev || "Sample");
        setProjectionLabel("Year 2 Projection");
      } finally { setIsLoading(false); }
    };
    fetchYears();
  }, []);

  useEffect(() => {
    if (!selectedForecastYear || selectedForecastYear === "Sample") return;
    const fetchProjection = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/forecasts/${encodeURIComponent(selectedForecastYear)}`);
        if (!res.ok) throw new Error();
        const data: ForecastRecord = await res.json();
        if (data) {
          const proj = parseVolumes(data.forecast_results);
          setProjectionVolumes(proj); setProjectionLabel(getProjectionLabel(selectedForecastYear, availableYears));
          setForecastMethod(data.forecast_method || ""); setLoadError("");
          if (proj.every(v => v === 0)) setLoadError(`No projection for ${selectedForecastYear}. Generate & save in Forecasting first.`);
        }
      } catch { setLoadError(`Failed to load projection for ${selectedForecastYear}.`); }
      finally { setIsLoading(false); }
    };
    fetchProjection();
  }, [selectedForecastYear, availableYears]);

  const createNewScenario = async (name?: string, isFirst = false) => {
    const newName = name ?? `Scenario ${scenarios.length + 1}`;
    try {
      const res = await fetch(`${API_BASE}/api/capacity-scenarios`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario_name: newName, forecast_year: selectedForecastYear,
          aht: isFirst ? 320 : aht, hours_op: isFirst ? 50 : hoursOp,
          work_days: isFirst ? 5 : workDays, day_pcts: isFirst ? [20,20,20,20,20] : dayPcts,
          shrinkage: isFirst ? 30 : shrinkage, occupancy: isFirst ? 85 : occupancy,
          target_sl: isFirst ? 80 : targetSL, asa: isFirst ? 20 : asa, selected_week: 0,
          actual_fte: isFirst ? 0 : actualFTE, actual_fte_start_date: isFirst ? todayStr() : actualFTEDate,
          attrition_pct: isFirst ? 0 : attritionPct, classes: isFirst ? [] : classes,
        }),
      });
      const created: Scenario = await res.json();
      setScenarios(prev => [...prev, created]); loadScenario(created);
    } catch {
      const fake: Scenario = { id: Date.now(), scenario_name: newName, forecast_year: selectedForecastYear,
        aht, hours_op: hoursOp, work_days: workDays, day_pcts: dayPcts, shrinkage, occupancy,
        target_sl: targetSL, asa, selected_week: 0, actual_fte: actualFTE,
        actual_fte_start_date: actualFTEDate, attrition_pct: attritionPct, classes };
      setScenarios(prev => [...prev, fake]); setActiveScenarioId(fake.id);
    }
  };

  const deleteScenario = async (id: number) => {
    if (scenarios.length <= 1) return;
    try { await fetch(`${API_BASE}/api/capacity-scenarios/${id}`, { method: "DELETE" }); } catch { }
    const remaining = scenarios.filter(s => s.id !== id);
    setScenarios(remaining);
    if (activeScenarioId === id) loadScenario(remaining[remaining.length - 1]);
  };

  const commitRename = async (id: number) => {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    setScenarios(prev => prev.map(s => s.id === id ? { ...s, scenario_name: trimmed } : s));
    try {
      await fetch(`${API_BASE}/api/capacity-scenarios/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(trimmed)),
      });
    } catch { }
    setRenamingId(null);
  };

  // Class management
  const addClass = () => setClasses(prev => [...prev, { id: newId(), fte: 10, live_date: todayStr(), ramp_weeks: 4 }]);
  const updateClass = (id: string, field: keyof TrainingClass, value: string | number) =>
    setClasses(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  const removeClass = (id: string) => setClasses(prev => prev.filter(c => c.id !== id));

  // ── Computations ──────────────────────────────────────────────────────────
  const weeks = useMemo<WeekData[]>(
    () => buildWeeksFromMonthly(projectionVolumes, startMonday, workDays),
    [projectionVolumes, startMonday, workDays]);

  const weeklyResults = useMemo<WeekResult[]>(() =>
    weeks.map(w => ({ ...w, ...computeFTE({ callVolume: w.baseVol, ahtSec: aht, hoursOp, shrinkage, occupancy, targetSL, asaSec: asa }) })),
    [weeks, aht, hoursOp, shrinkage, occupancy, targetSL, asa]);

  const actualFTEByWeek = useMemo(() =>
    computeActualFTEByWeek(actualFTE, actualFTEDate, attritionPct, classes, weeks),
    [actualFTE, actualFTEDate, attritionPct, classes, weeks]);

  const gapByWeek = useMemo(() =>
    weeklyResults.map((w, i) => actualFTEByWeek[i] > 0 ? actualFTEByWeek[i] - w.fte : null),
    [weeklyResults, actualFTEByWeek]);

  const hasWorkforceData = actualFTE > 0;

  const sel = weeklyResults[selectedWeek];
  const selWeek = weeks[selectedWeek];
  const selActualFTE = actualFTEByWeek[selectedWeek];
  const selGap = gapByWeek[selectedWeek];
  const ALL_DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const dailyBreakdown = useMemo(() => {
    const activeDays = ALL_DAY_NAMES.slice(0, workDays);
    const totalPct = dayPcts.slice(0, workDays).reduce((a, b) => a + b, 0) || 100;
    return activeDays.map((day, i) => {
      const pct = (dayPcts[i] ?? 0) / totalPct;
      const vol = Math.round((selWeek?.baseVol || 0) * pct);
      return { day, vol, ...computeFTE({ callVolume: vol, ahtSec: aht, hoursOp: hoursOp / workDays, shrinkage, occupancy, targetSL, asaSec: asa }) };
    });
  }, [selWeek, aht, hoursOp, shrinkage, occupancy, targetSL, asa, workDays, dayPcts]);

  const selActualSL = useMemo(() => {
    if (!sel || !selActualFTE || selActualFTE <= 0) return 0;
    // Raw agents = actual FTE * (1 - shrinkage%)
    const rawAgents = selActualFTE * (1 - shrinkage / 100);
    const A = sel.erlangs;
    if (rawAgents <= A) return 0;
    return computeServiceLevel(A, rawAgents, aht, asa) * 100;
  }, [sel, selActualFTE, shrinkage, aht, asa]);

  const maxFTE = Math.max(...weeklyResults.map(w => w.fte), hasWorkforceData ? Math.max(...actualFTEByWeek) : 0, 1);
  const maxProjectionVol = Math.max(...projectionVolumes, 1);
  const activeScenario = scenarios.find(s => s.id === activeScenarioId);

  // SVG actual FTE line points
  const svgActualPoints = useMemo(() => {
    if (!hasWorkforceData) return "";
    return actualFTEByWeek.map((fte, i) => {
      const x = i * 50 + 22;
      const y = 120 - (fte / (maxFTE * 1.2)) * 120;
      return `${x},${Math.max(2, Math.min(120, y))}`;
    }).join(" ");
  }, [actualFTEByWeek, maxFTE, hasWorkforceData]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: "#f9fafb", minHeight: "100vh" }}>

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="28" height="28" viewBox="0 0 28 28">
            <circle cx="14" cy="14" r="13" fill="none" stroke="#f97316" strokeWidth="2.5"/>
            <circle cx="14" cy="14" r="5" fill="#111827"/>
            <line x1="14" y1="1" x2="14" y2="6" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="14" y1="22" x2="14" y2="27" stroke="#111827" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="1" y1="14" x2="6" y2="14" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="22" y1="14" x2="27" y2="14" stroke="#111827" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#111827" }}>Exordium</span>
        </div>
        <nav style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Link to="/wfm" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }} onMouseEnter={e => (e.currentTarget.style.color = "#111827")} onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>Workforce Management</Link>
          <span style={{ color: "#d1d5db" }}>›</span>
          <Link to="/wfm" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }} onMouseEnter={e => (e.currentTarget.style.color = "#111827")} onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>Workforce Planning</Link>
          <span style={{ color: "#d1d5db" }}>›</span>
          <span style={{ fontSize: 13, color: "#f97316", fontWeight: 600 }}>Capacity Planning</span>
        </nav>
        <button style={{ fontSize: 13, color: "#6b7280", background: "none", border: "none", cursor: "pointer" }} onClick={() => navigate("/")}>🏠 Home</button>
      </div>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 32px" }}>

        {/* Page title */}
        <div style={{ marginBottom: 24 }}>
          <button onClick={() => navigate("/wfm")} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: "4px 0", marginBottom: 8 }} onMouseEnter={e => (e.currentTarget.style.color = "#f97316")} onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>
            ← Back to Workforce Management
          </button>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "#111827", margin: 0 }}>Capacity Planning</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6b7280" }}>52-week staffing forecast · Erlang C model · Workforce gap analysis</p>
        </div>

        {/* Scenario Bar */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "12px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginRight: 4 }}>📋 What if ? Scenario:</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
            {scenarios.map(s => (
              <div key={s.id} style={{ position: "relative", display: "flex", alignItems: "center" }}>
                {renamingId === s.id ? (
                  <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(s.id)}
                    onKeyDown={e => { if (e.key === "Enter") commitRename(s.id); if (e.key === "Escape") setRenamingId(null); }}
                    style={{ padding: "4px 10px", borderRadius: 6, fontSize: 13, fontWeight: 600, border: "2px solid #f97316", outline: "none", width: 130, background: "#fff7ed", color: "#111827" }} />
                ) : (
                  <button onClick={() => loadScenario(s)} onDoubleClick={() => { setRenamingId(s.id); setRenameValue(s.scenario_name); }}
                    title="Click to switch · Double-click to rename"
                    style={{ padding: "4px 12px", paddingRight: scenarios.length > 1 ? 28 : 12, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", transition: "all .15s", background: activeScenarioId === s.id ? "#f97316" : "#f3f4f6", color: activeScenarioId === s.id ? "#fff" : "#374151", position: "relative" }}>
                    {s.scenario_name}
                    {scenarios.length > 1 && (
                      <span onClick={e => { e.stopPropagation(); deleteScenario(s.id); }} title="Delete scenario"
                        style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", fontSize: 10, lineHeight: 1, color: activeScenarioId === s.id ? "rgba(255,255,255,0.75)" : "#9ca3af", fontWeight: 700, cursor: "pointer" }}>✕</span>
                    )}
                  </button>
                )}
              </div>
            ))}
            <button onClick={() => createNewScenario()} title="Add new scenario"
              style={{ padding: "4px 12px", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer", border: "1px dashed #d1d5db", background: "#fff", color: "#9ca3af", transition: "all .15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#f97316"; e.currentTarget.style.color = "#f97316"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.color = "#9ca3af"; }}>
              + New
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            {saveStatus === "saving" && <span style={{ fontSize: 12, color: "#9ca3af" }}>💾 Saving…</span>}
            {saveStatus === "saved" && <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>✓ Saved</span>}
            {saveStatus === "unsaved" && <span style={{ fontSize: 12, color: "#a16207" }}>● Unsaved changes</span>}
            <button onClick={() => saveScenario()}
              style={{ padding: "5px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid #f97316", background: "#fff7ed", color: "#f97316", transition: "all .15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#f97316"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#fff7ed"; e.currentTarget.style.color = "#f97316"; }}>
              💾 Save Now
            </button>
          </div>
        </div>

        {/* Forecast source bar */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>📊 Forecast Source:</span>
          {isLoading ? <span style={{ fontSize: 13, color: "#9ca3af" }}>Loading…</span> : (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {availableYears.map(y => (
                <button key={y} onClick={() => setSelectedForecastYear(y)}
                  style={{ padding: "4px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", transition: "all .15s", background: selectedForecastYear === y ? "#f97316" : "#f3f4f6", color: selectedForecastYear === y ? "#fff" : "#374151" }}>{y}</button>
              ))}
              {projectionLabel && <span style={{ fontSize: 12, color: "#6b7280", display: "flex", alignItems: "center", gap: 4 }}><span style={{ color: "#d1d5db" }}>→</span><span style={{ fontWeight: 600, color: "#f97316" }}>{projectionLabel}</span></span>}
            </div>
          )}
          {forecastMethod && <span style={{ fontSize: 12, color: "#6b7280", padding: "3px 10px", background: "#f3f4f6", borderRadius: 99 }}>{forecastMethod.split("(")[0].trim()}</span>}
          {loadError && <span style={{ fontSize: 12, color: "#b45309", background: "#fef9c3", padding: "4px 10px", borderRadius: 6 }}>⚠️ {loadError}</span>}
          <Link to="/wfm/forecasting" style={{ marginLeft: "auto", fontSize: 12, color: "#f97316", textDecoration: "none", fontWeight: 600 }} onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")} onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}>↗ Edit in Forecasting</Link>
        </div>

        {/* Projection mini-chart */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 20px", marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".05em" }}>
            {projectionLabel || "Projected Volume"} — from {selectedForecastYear}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 64 }}>
            {projectionVolumes.map((vol, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 600 }}>{vol >= 1000 ? `${(vol/1000).toFixed(0)}k` : vol || "—"}</div>
                <div style={{ width: "100%", minHeight: 4, height: `${Math.max((vol / maxProjectionVol) * 44, 4)}px`, background: "#fed7aa", borderRadius: "3px 3px 0 0" }} />
                <div style={{ fontSize: 9, color: "#9ca3af" }}>{MONTHS[i]}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>

          {/* ── LEFT PANEL ── */}
          <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Planning Parameters */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 20px 10px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 18, paddingBottom: 10, borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>⚙️ Planning Parameters</span>
                {activeScenario && <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400 }}>{activeScenario.scenario_name}</span>}
              </div>
              <SliderInput label="AHT (Avg Handle Time)" value={aht} min={60} max={900} step={10} unit="s" onChange={setAht} />
              <SliderInput label="Operating Hours per Week" value={hoursOp} min={10} max={168} step={1} unit="h" onChange={setHoursOp} />
              <SliderInput label="Working Days per Week" value={workDays} min={1} max={7} step={1} unit="d" onChange={setWorkDays} />
              <SliderInput label="Shrinkage" value={shrinkage} min={5} max={50} unit="%" onChange={setShrinkage} />
              <SliderInput label="Max Occupancy" value={occupancy} min={60} max={100} unit="%" onChange={setOccupancy} />
              <SliderInput label="Target Service Level" value={targetSL} min={50} max={99} unit="%" onChange={setTargetSL} />
              <SliderInput label="Target ASA" value={asa} min={5} max={120} unit="s" onChange={setAsa} />
              <div style={{ background: "#fff7ed", borderRadius: 8, padding: "10px 12px", marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#c2410c", marginBottom: 4 }}>MODEL INFO</div>
                <div style={{ fontSize: 11, color: "#9a3412", lineHeight: 1.5 }}>
                  Using <strong>Erlang C</strong> formula.<br />
                  SL = {targetSL}% answered within {asa}s.<br />
                  ≈ <strong>{(hoursOp / workDays).toFixed(1)}h/day</strong> × {workDays}d/week
                </div>
              </div>
            </div>

            {/* ── Workforce Planning Card ── */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 20px 16px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 16, paddingBottom: 10, borderBottom: "1px solid #f3f4f6" }}>
                👥 Workforce Planning
              </div>

              {/* Actual FTE */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Actual FTE Count</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="number" min={0} max={9999} value={actualFTE || ""}
                    placeholder="0"
                    onChange={e => setActualFTE(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{ width: 80, padding: "6px 10px", fontSize: 14, fontWeight: 700, border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827", outline: "none", textAlign: "center", background: actualFTE > 0 ? "#f0f9ff" : "#fff" }} />
                  <span style={{ fontSize: 11, color: "#6b7280" }}>FTE</span>
                </div>
              </div>

              {/* As-of date */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>As of Date</label>
                <input type="date" value={actualFTEDate} onChange={e => setActualFTEDate(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827", outline: "none", boxSizing: "border-box" }} />
              </div>

              {/* Monthly Attrition */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                  Monthly Attrition
                  <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>
                    {attritionPct > 0 ? `≈ ${(attritionPct / 4.333).toFixed(2)}% / week` : ""}
                  </span>
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="number" min={0} max={50} step={0.1} value={attritionPct || ""}
                    placeholder="0"
                    onChange={e => setAttritionPct(Math.max(0, Math.min(50, parseFloat(e.target.value) || 0)))}
                    style={{ width: 72, padding: "6px 10px", fontSize: 14, fontWeight: 700, border: "1px solid #e5e7eb", borderRadius: 8, color: "#ea580c", outline: "none", textAlign: "center", background: attritionPct > 0 ? "#fff7ed" : "#fff" }} />
                  <span style={{ fontSize: 11, color: "#6b7280" }}>% / month</span>
                </div>
              </div>

              {/* Training Classes */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Training Classes</label>
                  <button onClick={addClass}
                    style={{ fontSize: 11, fontWeight: 700, color: "#f97316", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
                    + Add Class
                  </button>
                </div>

                {classes.length === 0 && (
                  <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "12px 0", border: "1px dashed #e5e7eb", borderRadius: 8 }}>
                    No classes added yet
                  </div>
                )}

                {classes.map((cls, ci) => (
                  <div key={cls.id} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 12px 10px", marginBottom: 10, position: "relative" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>CLASS {ci + 1}</span>
                      <button onClick={() => removeClass(cls.id)}
                        style={{ fontSize: 11, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1 }}>✕</button>
                    </div>

                    {/* FTE count */}
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, display: "block", marginBottom: 3 }}>CLASS SIZE (FTE)</label>
                      <input type="number" min={1} max={500} value={cls.fte || ""}
                        onChange={e => updateClass(cls.id, "fte", parseInt(e.target.value) || 0)}
                        style={{ width: "100%", padding: "5px 8px", fontSize: 13, fontWeight: 700, border: "1px solid #e5e7eb", borderRadius: 6, color: "#111827", outline: "none", boxSizing: "border-box", background: "#fff" }} />
                    </div>

                    {/* Live date */}
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, display: "block", marginBottom: 3 }}>FLOOR DATE (LIVE)</label>
                      <input type="date" value={cls.live_date}
                        onChange={e => updateClass(cls.id, "live_date", e.target.value)}
                        style={{ width: "100%", padding: "5px 8px", fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 6, color: "#111827", outline: "none", boxSizing: "border-box", background: "#fff" }} />
                    </div>

                    {/* Ramp weeks */}
                    <div>
                      <label style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, display: "block", marginBottom: 3 }}>
                        RAMP-UP WEEKS
                        <span style={{ fontWeight: 400, marginLeft: 4 }}>(0 = full capacity on day 1)</span>
                      </label>
                      <input type="number" min={0} max={52} value={cls.ramp_weeks}
                        onChange={e => updateClass(cls.id, "ramp_weeks", parseInt(e.target.value) || 0)}
                        style={{ width: "100%", padding: "5px 8px", fontSize: 13, fontWeight: 600, border: "1px solid #e5e7eb", borderRadius: 6, color: "#6366f1", outline: "none", boxSizing: "border-box", background: "#fff" }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Workforce summary */}
              {hasWorkforceData && (
                <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "10px 12px", marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#0369a1", marginBottom: 4 }}>WORKFORCE SUMMARY</div>
                  <div style={{ fontSize: 11, color: "#0c4a6e", lineHeight: 1.6 }}>
                    Starting FTE: <strong>{actualFTE}</strong><br />
                    Weekly decay: <strong>~{attritionPct > 0 ? (attritionPct / 4.333).toFixed(2) : "0"}%</strong><br />
                    Classes: <strong>{classes.length}</strong> ({classes.reduce((s, c) => s + c.fte, 0)} FTE total)
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT ── */}
          <div style={{ flex: 1, minWidth: 0 }}>

            {/* 52-week bar chart */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 24px", marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>52-Week FTE Requirement</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                    Click a week to drill down · Based on <span style={{ color: "#f97316", fontWeight: 600 }}>{projectionLabel || "forecast projection"}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>Peak:</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#f97316" }}>{Math.round(maxFTE)} FTE</span>
                  <Sparkline values={weeklyResults.map(w => w.fte)} />
                </div>
              </div>

              {/* Legend */}
              <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#6b7280", marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 12, height: 12, background: "#fed7aa", borderRadius: 2, display: "inline-block" }} />Required FTE
                </span>
                {hasWorkforceData && <>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 20, height: 2, background: "#3b82f6", borderRadius: 1, display: "inline-block" }} />Actual FTE
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 10, background: "#dcfce7", color: "#16a34a", padding: "1px 4px", borderRadius: 3, fontWeight: 700 }}>+N</span>Surplus
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 10, background: "#fee2e2", color: "#dc2626", padding: "1px 4px", borderRadius: 3, fontWeight: 700 }}>−N</span>Deficit
                  </span>
                </>}
              </div>

              {/* Scrollable chart */}
              <div style={{ overflowX: "auto", paddingBottom: 4 }}>
                <div style={{ minWidth: 52 * 52 }}>

                  {/* Bar chart with SVG overlay */}
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 140, position: "relative" }}>

                    {/* Actual FTE blue line SVG overlay */}
                    {hasWorkforceData && (
                      <svg
                        style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 5 }}
                        viewBox={`0 0 ${52 * 50 + 44} 140`}
                        preserveAspectRatio="none"
                      >
                        <polyline points={svgActualPoints} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
                        {actualFTEByWeek.map((fte, i) => {
                          const x = i * 50 + 22;
                          const y = Math.max(3, Math.min(137, 140 - (fte / (maxFTE * 1.2)) * 140));
                          return <circle key={i} cx={x} cy={y} r="3" fill="#3b82f6" opacity="0.9" />;
                        })}
                      </svg>
                    )}

                    {weeklyResults.map((w, i) => {
                      const pct = (w.fte / (maxFTE * 1.2)) * 100;
                      const isSel = i === selectedWeek;
                      return (
                        <div key={i} style={{ width: 44, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer" }}
                          onClick={() => setSelectedWeek(i)}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: isSel ? "#f97316" : "#6b7280", marginBottom: 4 }}>
                            {Math.round(w.fte)}
                          </div>
                          <div style={{ width: "100%", height: `${pct}%`, minHeight: 8, background: isSel ? "#f97316" : "#fed7aa", borderRadius: "4px 4px 0 0", transition: "all .2s", border: isSel ? "2px solid #ea580c" : "2px solid transparent" }} />
                          <div style={{ marginTop: 6, textAlign: "center" }}>
                            <div style={{ fontSize: 10, fontWeight: isSel ? 700 : 500, color: isSel ? "#f97316" : "#374151", whiteSpace: "nowrap" }}>{w.week}</div>
                            <div style={{ fontSize: 9, color: "#9ca3af", whiteSpace: "nowrap" }}>{w.label}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Gap row */}
                  {hasWorkforceData && (
                    <div style={{ display: "flex", gap: 6, marginTop: 6, paddingTop: 6, borderTop: "1px dashed #e5e7eb" }}>
                      {gapByWeek.map((gap, i) => {
                        if (gap === null) return <div key={i} style={{ width: 44, flexShrink: 0 }} />;
                        const over = gap >= 0;
                        const isSel = i === selectedWeek;
                        return (
                          <div key={i} style={{ width: 44, flexShrink: 0, textAlign: "center" }} onClick={() => setSelectedWeek(i)}>
                            <div style={{
                              fontSize: 9, fontWeight: 700, padding: "2px 0",
                              borderRadius: 4, cursor: "pointer",
                              background: isSel ? (over ? "#dcfce7" : "#fee2e2") : (over ? "#f0fdf4" : "#fef2f2"),
                              color: over ? "#16a34a" : "#dc2626",
                              border: isSel ? `1px solid ${over ? "#86efac" : "#fca5a5"}` : "1px solid transparent",
                            }}>
                              {over ? "+" : ""}{Math.round(gap)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Metric cards */}
              {sel && (
                <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
                  <MetricCard label="Total Volume" value={selWeek?.baseVol.toLocaleString() ?? "—"} sub={`${sel.erlangs} Erlangs`} />
                  <MetricCard label="Required FTE" value={sel.fte} sub={`${sel.rawAgents} base agents`} accent="#f97316" />
                  
                  {hasWorkforceData && selActualFTE > 0 && (
                    <MetricCard label="Actual FTE" value={Math.round(selActualFTE)} sub={`After attrition & classes`} accent="#3b82f6" />
                  )}

                  {hasWorkforceData && selGap !== null && (
                    <MetricCard 
                      label="Headcount Gap" 
                      value={`${selGap >= 0 ? "+" : ""}${Math.round(selGap)}`} 
                      sub={selGap >= 0 ? "Surplus headcount" : "Headcount deficit"} 
                      accent={selGap >= 0 ? "#16a34a" : "#dc2626"}
                      borderColor={selGap >= 0 ? "#bbf7d0" : "#fecaca"}
                    />
                  )}

                  <MetricCard label="SL from Required" value={<Badge value={sel.achievedSL} target={targetSL} unit="%" />} sub={`Target: ${targetSL}%`} />
                  
                  {hasWorkforceData && selActualFTE > 0 && (
                    <MetricCard label="SL from Actual FTE" value={<Badge value={+selActualSL.toFixed(1)} target={targetSL} unit="%" />} sub={`Based on ${Math.round(selActualFTE)} FTE`} />
                  )}

                  <MetricCard label="Occupancy" value={<Badge value={sel.actualOcc} target={75} unit="%" />} sub={`Max: ${occupancy}%`} />
                  <MetricCard label="Shrinkage" value={`${shrinkage}%`} sub={`+${(sel.rawAgents * shrinkage / (100 - shrinkage)).toFixed(0)} buffer`} />
                </div>
              )}
            </div>

            {/* Daily breakdown */}
            {selWeek && sel && (
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 24px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>Daily Breakdown — {selWeek.week} ({selWeek.label})</div>
                    <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>Edit the % column to set each day's share of weekly volume</div>
                  </div>
                  {(() => {
                    const sum = dayPcts.slice(0, workDays).reduce((a, b) => a + b, 0);
                    const off = Math.abs(sum - 100) > 0.5;
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, background: off ? "#fef9c3" : "#f0fdf4", border: `1px solid ${off ? "#fde68a" : "#bbf7d0"}`, borderRadius: 8, padding: "6px 12px" }}>
                        <span style={{ fontSize: 12, color: off ? "#92400e" : "#166534", fontWeight: 600 }}>{off ? "⚠️" : "✓"} Total: {sum.toFixed(1)}%</span>
                        {off && (
                          <button onClick={() => { const e = Math.floor(100/workDays), r = 100-e*workDays; setDayPcts(Array.from({length:workDays},(_,i)=>e+(i===0?r:0))); }}
                            style={{ fontSize: 11, color: "#f97316", background: "none", border: "1px solid #f97316", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontWeight: 600 }}>Reset even</button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div style={{ display: "flex", gap: 3, height: 10, borderRadius: 6, overflow: "hidden", marginBottom: 16, marginTop: 12 }}>
                  {ALL_DAY_NAMES.slice(0, workDays).map((day, i) => {
                    const total = dayPcts.slice(0, workDays).reduce((a, b) => a + b, 0) || 100;
                    const pct = (dayPcts[i] ?? 0) / total * 100;
                    const colors = ["#f97316","#fb923c","#fdba74","#fed7aa","#fef3c7","#fde68a","#fcd34d"];
                    return <div key={day} style={{ flex: pct, background: colors[i % colors.length], transition: "flex .2s", minWidth: 2 }} title={`${day}: ${pct.toFixed(1)}%`} />;
                  })}
                </div>

                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                      {["Day", "% of Week", "Call Volume", "Erlangs (A)", "Base Agents", "Req. FTE", "Svc Level", "Occupancy"].map(h => (
                        <th key={h} style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textAlign: "left", padding: "0 10px 10px 0", textTransform: "uppercase", letterSpacing: ".04em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dailyBreakdown.map((d, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f9fafb" }}>
                        <td style={{ padding: "8px 10px 8px 0", fontWeight: 600, fontSize: 13, color: "#111827" }}>{d.day}</td>
                        <td style={{ padding: "8px 10px 8px 0" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <input type="number" min={0} max={100} step={0.1} value={dayPcts[i] ?? 0}
                              onChange={e => { const v = Math.max(0, Math.min(100, parseFloat(e.target.value)||0)); setDayPcts(prev => { const n=[...prev]; n[i]=v; return n; }); }}
                              style={{ width: 56, padding: "3px 6px", fontSize: 13, fontWeight: 600, border: "1px solid #e5e7eb", borderRadius: 6, textAlign: "center", color: "#f97316", outline: "none", background: "#fff7ed" }} />
                            <span style={{ fontSize: 12, color: "#9ca3af" }}>%</span>
                          </div>
                        </td>
                        <td style={{ padding: "8px 10px 8px 0", fontSize: 13, color: "#374151" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ height: 6, width: Math.max(Math.round((d.vol/(selWeek.baseVol||1))*60),4), background: "#fed7aa", borderRadius: 99 }} />
                            {d.vol.toLocaleString()}
                          </div>
                        </td>
                        <td style={{ padding: "8px 10px 8px 0", fontSize: 13, color: "#6b7280" }}>{d.erlangs}</td>
                        <td style={{ padding: "8px 10px 8px 0", fontSize: 13, color: "#374151", fontWeight: 500 }}>{d.rawAgents}</td>
                        <td style={{ padding: "8px 10px 8px 0", fontSize: 14, fontWeight: 700, color: "#f97316" }}>{d.fte}</td>
                        <td style={{ padding: "8px 10px 8px 0" }}><Badge value={d.achievedSL} target={targetSL} unit="%" /></td>
                        <td style={{ padding: "8px 10px 8px 0" }}><Badge value={d.actualOcc} target={75} unit="%" /></td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "2px solid #e5e7eb", background: "#f9fafb" }}>
                      <td style={{ padding: "10px 10px 10px 0", fontWeight: 700, fontSize: 13 }}>TOTAL</td>
                      <td style={{ padding: "10px 10px 10px 0", fontSize: 12, fontWeight: 700, color: "#6b7280" }}>{dayPcts.slice(0,workDays).reduce((a,b)=>a+b,0).toFixed(1)}%</td>
                      <td style={{ padding: "10px 10px 10px 0", fontWeight: 700, fontSize: 13 }}>{dailyBreakdown.reduce((a,d)=>a+d.vol,0).toLocaleString()}</td>
                      <td colSpan={2} />
                      <td style={{ padding: "10px 10px 10px 0", fontWeight: 700, fontSize: 14, color: "#f97316" }}>{sel.fte} avg</td>
                      <td colSpan={2} />
                    </tr>
                  </tbody>
                </table>

                <div style={{ marginTop: 20, background: "#f9fafb", borderRadius: 8, padding: "12px 16px", border: "1px solid #e5e7eb" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 8 }}>📐 FTE CALCULATION LOGIC</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                    {[
                      { step: "1", label: "Traffic Intensity", formula: "A = (Weekly Volume × AHT) ÷ (Weekly Hours × 3600)" },
                      { step: "2", label: "Erlang C", formula: "Min agents to hit SL at ASA target" },
                      { step: "3", label: "Occupancy Cap", formula: "Agents ≥ A ÷ Max Occupancy" },
                      { step: "4", label: "Shrinkage Gross-Up", formula: "FTE = Agents ÷ (1 − Shrinkage%)" },
                    ].map(s => (
                      <div key={s.step} style={{ flex: "1 1 180px" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#f97316", borderRadius: 99, padding: "1px 6px", marginRight: 6 }}>{s.step}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>{s.label}</span>
                        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{s.formula}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}