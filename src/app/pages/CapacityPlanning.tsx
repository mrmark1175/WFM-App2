import React from "react";
import { useState, useMemo, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";

// ── Types ─────────────────────────────────────────────────────────────────────
interface FTEParams {
  callVolume: number;
  ahtSec: number;
  hoursOp: number;
  shrinkage: number;
  occupancy: number;
  targetSL: number;
  asaSec: number;
}

interface FTEResult {
  erlangs: number;
  rawAgents: number;
  fte: number;
  achievedSL: number;
  actualOcc: number;
}

interface WeekData {
  week: string;
  label: string;
  baseVol: number;
  startDate: Date;
}

interface WeekResult extends WeekData, FTEResult {}

interface DayResult extends FTEResult {
  day: string;
  vol: number;
}

interface ForecastRecord {
  year_label: string;
  monthly_volumes: number[];
  forecast_method?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const API_BASE = "http://localhost:5000";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_SPLIT: number[] = [0.18, 0.21, 0.20, 0.22, 0.19];
const DAY_NAMES: string[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmt(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/**
 * Converts 12 monthly volumes into 8 weekly volumes.
 * Uses workDays to determine how many days per week are operational,
 * and proportionally allocates monthly volume across those days.
 */
function buildWeeksFromMonthly(monthlyVolumes: number[], startMonday: Date, workDays: number): WeekData[] {
  const weeks: WeekData[] = [];
  for (let w = 0; w < 8; w++) {
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
      // Workdays in this month proportional to user's workDays setting
      const workdaysInMonth = Math.round(daysInMonth * workDays / 7);
      const dailyVol = (monthlyVolumes[monthIdx] || 0) / workdaysInMonth;
      weekVol += dailyVol;
    }

    weeks.push({
      week: `Wk ${w + 1}`,
      label: `${fmt(monday)}–${fmt(lastDay)}`,
      baseVol: Math.round(weekVol),
      startDate: monday,
    });
  }
  return weeks;
}

// ── Erlang C engine ───────────────────────────────────────────────────────────
function erlangC(A: number, N: number): number {
  if (N <= A) return 1;
  let sumFact = 1, term = 1;
  for (let i = 1; i < N; i++) { term *= A / i; sumFact += term; }
  const lastTerm = term * A / N;
  const erlang = lastTerm / (sumFact + lastTerm * N / (N - A));
  return Math.min(1, Math.max(0, erlang));
}

function computeServiceLevel(A: number, N: number, ahtSec: number, asaSec: number): number {
  if (N <= A) return 0;
  const ec = erlangC(A, N);
  return 1 - ec * Math.exp(-((N - A) * asaSec) / ahtSec);
}

function minAgentsForSL(A: number, ahtSec: number, asaSec: number, targetSL: number): number {
  let N = Math.ceil(A) + 1;
  for (let i = 0; i < 200; i++) {
    if (computeServiceLevel(A, N, ahtSec, asaSec) >= targetSL) return N;
    N++;
  }
  return N;
}

function computeFTE({ callVolume, ahtSec, hoursOp, shrinkage, occupancy, targetSL, asaSec }: FTEParams): FTEResult {
  // hoursOp is now WEEKLY operating hours
  // arrival rate = weekly calls / total weekly seconds of operation
  const arrivalRate = callVolume / (hoursOp * 3600);
  const A = arrivalRate * ahtSec;
  const rawAgents = minAgentsForSL(A, ahtSec, asaSec, targetSL / 100);
  const actualOcc = A / rawAgents;
  const occupancyCapped = actualOcc > occupancy / 100
    ? Math.ceil(A / (occupancy / 100))
    : rawAgents;
  const withShrinkage = occupancyCapped / (1 - shrinkage / 100);
  const sl = computeServiceLevel(A, occupancyCapped, ahtSec, asaSec) * 100;
  return {
    erlangs: +A.toFixed(2),
    rawAgents: occupancyCapped,
    fte: +withShrinkage.toFixed(1),
    achievedSL: +sl.toFixed(1),
    actualOcc: +((A / occupancyCapped) * 100).toFixed(1),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Sparkline({ values, color = "#f97316" }: { values: number[]; color?: string }) {
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 30 - ((v - min) / range) * 26;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 100 30" style={{ width: 80, height: 24 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Badge({ value, target, unit = "" }: { value: number; target: number; unit?: string }) {
  const ok = value >= target;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 99,
      background: ok ? "#dcfce7" : "#fef9c3",
      color: ok ? "#16a34a" : "#a16207",
    }}>{value}{unit}</span>
  );
}

function MetricCard({ label, value, sub, accent }: {
  label: string; value: React.ReactNode; sub?: string; accent?: string;
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 18px", minWidth: 130 }}>
      <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent || "#111827" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SliderInput({ label, value, min, max, step = 1, unit, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f97316" }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
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
  const [hoursOp, setHoursOp] = useState<number>(50); // weekly hours (e.g. 10h/day × 5 days)
  const [workDays, setWorkDays] = useState<number>(5); // working days per week
  const [dayPcts, setDayPcts] = useState<number[]>([20, 20, 20, 20, 20]); // % of weekly volume per day
  const [shrinkage, setShrinkage] = useState<number>(30);
  const [occupancy, setOccupancy] = useState<number>(85);
  const [targetSL, setTargetSL] = useState<number>(80);
  const [asa, setAsa] = useState<number>(20);
  const [selectedWeek, setSelectedWeek] = useState<number>(0);

  // Forecast data
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [selectedForecastYear, setSelectedForecastYear] = useState<string>("");
  const [monthlyVolumes, setMonthlyVolumes] = useState<number[]>(Array(12).fill(0));
  const [forecastMethod, setForecastMethod] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");

  // Start from next Monday
  const startMonday = useMemo(() => getMondayOf(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)), []);

  // ── Reset day percentages evenly when workDays changes ──
  useEffect(() => {
    const even = Math.floor(100 / workDays);
    const remainder = 100 - even * workDays;
    setDayPcts(Array.from({ length: workDays }, (_, i) => even + (i === 0 ? remainder : 0)));
  }, [workDays]);

  // ── Parse monthly_volumes whether it's a string or array (pg JSON column) ──
  const parseVolumes = (raw: unknown): number[] => {
    if (Array.isArray(raw)) return raw as number[];
    if (typeof raw === "string") {
      try { return JSON.parse(raw) as number[]; } catch { return Array(12).fill(0); }
    }
    return Array(12).fill(0);
  };

  // ── Fetch all available forecast years on mount ──
  useEffect(() => {
    const fetchYears = async () => {
      setIsLoading(true);
      setLoadError("");
      try {
        const res = await fetch(`${API_BASE}/api/forecasts`);
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data: ForecastRecord[] = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const years = data.map(d => d.year_label);
          setAvailableYears(years);
          // Also load the latest year's volumes immediately from this response
          const latest = data[data.length - 1];
          setSelectedForecastYear(latest.year_label);
          setMonthlyVolumes(parseVolumes(latest.monthly_volumes));
          setForecastMethod(latest.forecast_method || "");
        } else {
          throw new Error("No forecast records found");
        }
      } catch {
        setLoadError("No forecast data found. Go to Forecasting and save a forecast first.");
        setMonthlyVolumes([58000,54000,62000,67000,71000,65000,69000,72000,68000,74000,80000,76000]);
        setAvailableYears(["Sample"]);
        setSelectedForecastYear("Sample");
      } finally {
        setIsLoading(false);
      }
    };
    fetchYears();
  }, []);

  // ── Fetch monthly volumes when selected year changes ──
  useEffect(() => {
    if (!selectedForecastYear || selectedForecastYear === "Sample") return;
    const fetchVolumes = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/forecasts/${encodeURIComponent(selectedForecastYear)}`);
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data: ForecastRecord = await res.json();
        if (data?.monthly_volumes) {
          setMonthlyVolumes(parseVolumes(data.monthly_volumes));
          setForecastMethod(data.forecast_method || "");
          setLoadError("");
        }
      } catch {
        setLoadError(`Failed to load volumes for ${selectedForecastYear}.`);
      } finally {
        setIsLoading(false);
      }
    };
    fetchVolumes();
  }, [selectedForecastYear]);

  // ── Derive weeks from monthly volumes ──
  const weeks = useMemo<WeekData[]>(
    () => buildWeeksFromMonthly(monthlyVolumes, startMonday, workDays),
    [monthlyVolumes, startMonday, workDays]
  );

  const weeklyResults = useMemo<WeekResult[]>(() =>
    weeks.map(w => ({
      ...w,
      ...computeFTE({ callVolume: w.baseVol, ahtSec: aht, hoursOp, shrinkage, occupancy, targetSL, asaSec: asa }),
    })), [weeks, aht, hoursOp, shrinkage, occupancy, targetSL, asa]);

  const sel = weeklyResults[selectedWeek];
  const selWeek = weeks[selectedWeek];

  const ALL_DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const dailyBreakdown = useMemo<DayResult[]>(() => {
    const activeDays = ALL_DAY_NAMES.slice(0, workDays);
    const totalPct = dayPcts.slice(0, workDays).reduce((a, b) => a + b, 0) || 100;
    return activeDays.map((day, i) => {
      const pct = (dayPcts[i] ?? 0) / totalPct; // normalise so it always sums to 1
      const vol = Math.round((selWeek?.baseVol || 0) * pct);
      return { day, vol, ...computeFTE({ callVolume: vol, ahtSec: aht, hoursOp, shrinkage, occupancy, targetSL, asaSec: asa }) };
    });
  }, [selWeek, aht, hoursOp, shrinkage, occupancy, targetSL, asa, workDays, dayPcts]);

  const maxFTE = Math.max(...weeklyResults.map(w => w.fte), 1);
  const maxMonthlyVol = Math.max(...monthlyVolumes, 1);

  return (
    <div style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: "#f9fafb", minHeight: "100vh" }}>

      {/* ── Header ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="28" height="28" viewBox="0 0 28 28">
            <circle cx="14" cy="14" r="13" fill="none" stroke="#f97316" strokeWidth="2.5" />
            <circle cx="14" cy="14" r="5" fill="#111827" />
            <line x1="14" y1="1" x2="14" y2="6" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="14" y1="22" x2="14" y2="27" stroke="#111827" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="1" y1="14" x2="6" y2="14" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="22" y1="14" x2="27" y2="14" stroke="#111827" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#111827" }}>Exordium</span>
        </div>
        <nav style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Link to="/wfm" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#111827")}
            onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>
            Workforce Management
          </Link>
          <span style={{ color: "#d1d5db" }}>›</span>
          <Link to="/wfm" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#111827")}
            onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>
            Workforce Planning
          </Link>
          <span style={{ color: "#d1d5db" }}>›</span>
          <span style={{ fontSize: 13, color: "#f97316", fontWeight: 600 }}>Capacity Planning</span>
        </nav>
        <button style={{ fontSize: 13, color: "#6b7280", background: "none", border: "none", cursor: "pointer" }}
          onClick={() => navigate("/")}>🏠 Home</button>
      </div>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 32px" }}>

        {/* ── Page title ── */}
        <div style={{ marginBottom: 24 }}>
          <button onClick={() => navigate("/wfm")}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: "4px 0", marginBottom: 8 }}
            onMouseEnter={e => (e.currentTarget.style.color = "#f97316")}
            onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>
            ← Back to Workforce Management
          </button>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "#111827", margin: 0 }}>Capacity Planning</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6b7280" }}>
            8-week staffing forecast · Erlang C model · Volumes pulled from Long-Term Forecast
          </p>
        </div>

        {/* ── Forecast source bar ── */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>📊 Forecast Source:</span>

          {isLoading ? (
            <span style={{ fontSize: 13, color: "#9ca3af" }}>Loading forecasts…</span>
          ) : (
            <div style={{ display: "flex", gap: 6 }}>
              {availableYears.map(y => (
                <button key={y} onClick={() => setSelectedForecastYear(y)}
                  style={{
                    padding: "4px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600,
                    cursor: "pointer", border: "none", transition: "all .15s",
                    background: selectedForecastYear === y ? "#f97316" : "#f3f4f6",
                    color: selectedForecastYear === y ? "#fff" : "#374151",
                  }}>{y}</button>
              ))}
            </div>
          )}

          {forecastMethod && (
            <span style={{ fontSize: 12, color: "#6b7280", padding: "3px 10px", background: "#f3f4f6", borderRadius: 99 }}>
              {forecastMethod.split("(")[0].trim()}
            </span>
          )}

          {loadError && (
            <span style={{ fontSize: 12, color: "#b45309", background: "#fef9c3", padding: "4px 10px", borderRadius: 6 }}>
              ⚠️ {loadError}
            </span>
          )}

          <Link to="/wfm/forecasting"
            style={{ marginLeft: "auto", fontSize: 12, color: "#f97316", textDecoration: "none", fontWeight: 600 }}
            onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
            onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}>
            ↗ Edit in Forecasting
          </Link>
        </div>

        {/* ── Monthly volume mini-chart ── */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 20px", marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".05em" }}>
            Monthly Volume — {selectedForecastYear}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 64 }}>
            {monthlyVolumes.map((vol, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 600 }}>
                  {vol >= 1000 ? `${(vol / 1000).toFixed(0)}k` : vol || "—"}
                </div>
                <div style={{
                  width: "100%", minHeight: 4,
                  height: `${Math.max((vol / maxMonthlyVol) * 44, 4)}px`,
                  background: "#fed7aa", borderRadius: "3px 3px 0 0",
                }} />
                <div style={{ fontSize: 9, color: "#9ca3af" }}>{MONTHS[i]}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>

          {/* ── LEFT: Parameters ── */}
          <div style={{ width: 280, flexShrink: 0 }}>
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 20px 10px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 18, paddingBottom: 10, borderBottom: "1px solid #f3f4f6" }}>
                ⚙️ Planning Parameters
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
          </div>

          {/* ── RIGHT ── */}
          <div style={{ flex: 1, minWidth: 0 }}>

            {/* 8-week bar chart */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 24px", marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>8-Week FTE Requirement</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                    Click a week to drill down · Derived from {selectedForecastYear} monthly volumes
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>Peak:</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#f97316" }}>{Math.round(maxFTE)} FTE</span>
                  <Sparkline values={weeklyResults.map(w => w.fte)} />
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 140 }}>
                {weeklyResults.map((w, i) => {
                  const pct = (w.fte / (maxFTE * 1.2)) * 100;
                  const isSel = i === selectedWeek;
                  return (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer" }}
                      onClick={() => setSelectedWeek(i)}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: isSel ? "#f97316" : "#6b7280", marginBottom: 4 }}>
                        {Math.round(w.fte)}
                      </div>
                      <div style={{
                        width: "100%", height: `${pct}%`, minHeight: 8,
                        background: isSel ? "#f97316" : "#fed7aa",
                        borderRadius: "4px 4px 0 0", transition: "all .2s",
                        border: isSel ? "2px solid #ea580c" : "2px solid transparent",
                      }} />
                      <div style={{ marginTop: 6, textAlign: "center" }}>
                        <div style={{ fontSize: 11, fontWeight: isSel ? 700 : 500, color: isSel ? "#f97316" : "#374151" }}>{w.week}</div>
                        <div style={{ fontSize: 10, color: "#9ca3af" }}>{w.label}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {sel && (
                <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
                  <MetricCard label="Total Volume" value={selWeek?.baseVol.toLocaleString() ?? "—"} sub={`${sel.erlangs} Erlangs`} />
                  <MetricCard label="Required FTE" value={sel.fte} sub={`${sel.rawAgents} base agents`} accent="#f97316" />
                  <MetricCard label="Achieved SL" value={<Badge value={sel.achievedSL} target={targetSL} unit="%" />} sub={`Target: ${targetSL}%`} />
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
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>
                      Daily Breakdown — {selWeek.week} ({selWeek.label})
                    </div>
                    <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                      Edit the % column to set each day's share of weekly volume
                    </div>
                  </div>

                  {/* Sum indicator */}
                  {(() => {
                    const sum = dayPcts.slice(0, workDays).reduce((a, b) => a + b, 0);
                    const off = Math.abs(sum - 100) > 0.5;
                    return (
                      <div style={{
                        display: "flex", alignItems: "center", gap: 8,
                        background: off ? "#fef9c3" : "#f0fdf4",
                        border: `1px solid ${off ? "#fde68a" : "#bbf7d0"}`,
                        borderRadius: 8, padding: "6px 12px",
                      }}>
                        <span style={{ fontSize: 12, color: off ? "#92400e" : "#166534", fontWeight: 600 }}>
                          {off ? "⚠️" : "✓"} Total: {sum.toFixed(1)}%
                        </span>
                        {off && (
                          <button onClick={() => {
                            // Auto-normalise to 100
                            const even = Math.floor(100 / workDays);
                            const rem = 100 - even * workDays;
                            setDayPcts(Array.from({ length: workDays }, (_, i) => even + (i === 0 ? rem : 0)));
                          }} style={{
                            fontSize: 11, color: "#f97316", background: "none",
                            border: "1px solid #f97316", borderRadius: 4,
                            padding: "2px 8px", cursor: "pointer", fontWeight: 600,
                          }}>Reset even</button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Visual day % bar */}
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

                        {/* Editable % input */}
                        <td style={{ padding: "8px 10px 8px 0" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <input
                              type="number"
                              min={0} max={100} step={0.1}
                              value={dayPcts[i] ?? 0}
                              onChange={e => {
                                const val = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
                                setDayPcts(prev => {
                                  const next = [...prev];
                                  next[i] = val;
                                  return next;
                                });
                              }}
                              style={{
                                width: 56, padding: "3px 6px", fontSize: 13, fontWeight: 600,
                                border: "1px solid #e5e7eb", borderRadius: 6,
                                textAlign: "center", color: "#f97316",
                                outline: "none", background: "#fff7ed",
                              }}
                            />
                            <span style={{ fontSize: 12, color: "#9ca3af" }}>%</span>
                          </div>
                        </td>

                        <td style={{ padding: "8px 10px 8px 0", fontSize: 13, color: "#374151" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ height: 6, width: Math.max(Math.round((d.vol / (selWeek.baseVol || 1)) * 60), 4), background: "#fed7aa", borderRadius: 99 }} />
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
                      <td style={{ padding: "10px 10px 10px 0", fontSize: 12, fontWeight: 700, color: "#6b7280" }}>
                        {dayPcts.slice(0, workDays).reduce((a, b) => a + b, 0).toFixed(1)}%
                      </td>
                      <td style={{ padding: "10px 10px 10px 0", fontWeight: 700, fontSize: 13 }}>
                        {dailyBreakdown.reduce((a, d) => a + d.vol, 0).toLocaleString()}
                      </td>
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