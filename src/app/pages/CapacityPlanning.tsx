import React from "react";
import { useState, useMemo } from "react";
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
}

interface WeekResult extends WeekData, FTEResult {}

interface DayResult extends FTEResult {
  day: string;
  vol: number;
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
  const arrivalRate = callVolume / (hoursOp * 3600);
  const A = arrivalRate * ahtSec;
  const rawAgents = minAgentsForSL(A, ahtSec, asaSec, targetSL / 100);
  const actualOcc = A / rawAgents;
  const occupancyCapped = actualOcc > occupancy / 100
    ? Math.ceil(A / (occupancy / 100))
    : rawAgents;
  const withShrinkage = occupancyCapped / (1 - shrinkage / 100);
  const sl = computeServiceLevel(A, occupancyCapped, ahtSec, asaSec) * 100;
  const actualOccPct = (A / occupancyCapped) * 100;
  return {
    erlangs: +A.toFixed(2),
    rawAgents: occupancyCapped,
    fte: +withShrinkage.toFixed(1),
    achievedSL: +sl.toFixed(1),
    actualOcc: +actualOccPct.toFixed(1),
  };
}

// ── Static data ───────────────────────────────────────────────────────────────
const WEEKS: WeekData[] = [
  { week: "Wk 1", label: "Mar 17–21", baseVol: 14200 },
  { week: "Wk 2", label: "Mar 24–28", baseVol: 15800 },
  { week: "Wk 3", label: "Mar 31–Apr 4", baseVol: 13400 },
  { week: "Wk 4", label: "Apr 7–11", baseVol: 16900 },
  { week: "Wk 5", label: "Apr 14–18", baseVol: 15100 },
  { week: "Wk 6", label: "Apr 21–25", baseVol: 14600 },
  { week: "Wk 7", label: "Apr 28–May 2", baseVol: 17300 },
  { week: "Wk 8", label: "May 5–9", baseVol: 15900 },
];

const DAY_SPLIT: number[] = [0.18, 0.21, 0.20, 0.22, 0.19];
const DAY_NAMES: string[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// ── Sparkline ─────────────────────────────────────────────────────────────────
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

// ── Badge ─────────────────────────────────────────────────────────────────────
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

// ── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, accent }: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: string;
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 18px", minWidth: 130 }}>
      <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent || "#111827" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Slider input ──────────────────────────────────────────────────────────────
function SliderInput({ label, value, min, max, step = 1, unit, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f97316" }}>{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        style={{ width: "100%", accentColor: "#f97316", height: 4, cursor: "pointer" }}
      />
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
  const [aht, setAht] = useState<number>(320);
  const [hoursOp, setHoursOp] = useState<number>(10);
  const [shrinkage, setShrinkage] = useState<number>(30);
  const [occupancy, setOccupancy] = useState<number>(85);
  const [targetSL, setTargetSL] = useState<number>(80);
  const [asa, setAsa] = useState<number>(20);
  const [selectedWeek, setSelectedWeek] = useState<number>(0);

  const weeklyResults = useMemo<WeekResult[]>(() =>
    WEEKS.map(w => {
      const r = computeFTE({ callVolume: w.baseVol, ahtSec: aht, hoursOp, shrinkage, occupancy, targetSL, asaSec: asa });
      return { ...w, ...r };
    }), [aht, hoursOp, shrinkage, occupancy, targetSL, asa]);

  const sel = weeklyResults[selectedWeek];
  const selWeek = WEEKS[selectedWeek];

  const dailyBreakdown = useMemo<DayResult[]>(() =>
    DAY_SPLIT.map((pct, i) => {
      const vol = Math.round(selWeek.baseVol * pct);
      const r = computeFTE({ callVolume: vol, ahtSec: aht, hoursOp, shrinkage, occupancy, targetSL, asaSec: asa });
      return { day: DAY_NAMES[i], vol, ...r };
    }), [selWeek, aht, hoursOp, shrinkage, occupancy, targetSL, asa]);

  const maxFTE = Math.max(...weeklyResults.map(w => w.fte));
  const fteValues = weeklyResults.map(w => w.fte);

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
        <button style={{ fontSize: 13, color: "#6b7280", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
          🏠 Home
        </button>
      </div>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 32px" }}>

        {/* ── Page title ── */}
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={() => navigate("/wfm")}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 13, color: "#6b7280", background: "none",
              border: "none", cursor: "pointer", padding: "4px 0",
              marginBottom: 8,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "#f97316")}
            onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}
          >
            ← Back to Workforce Management
          </button>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "#111827", margin: 0 }}>Capacity Planning</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6b7280" }}>
            8-week forecast · Erlang C staffing model · Based on Long-Term Forecast
          </p>
        </div>

        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>

          {/* ── LEFT: Parameters panel ── */}
          <div style={{ width: 280, flexShrink: 0 }}>
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 20px 10px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 18, paddingBottom: 10, borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 15 }}>⚙️</span> Planning Parameters
              </div>
              <SliderInput label="AHT (Avg Handle Time)" value={aht} min={60} max={900} step={10} unit="s" onChange={setAht} />
              <SliderInput label="Hours of Operation" value={hoursOp} min={4} max={24} unit="h" onChange={setHoursOp} />
              <SliderInput label="Shrinkage" value={shrinkage} min={5} max={50} unit="%" onChange={setShrinkage} />
              <SliderInput label="Max Occupancy" value={occupancy} min={60} max={100} unit="%" onChange={setOccupancy} />
              <SliderInput label="Target Service Level" value={targetSL} min={50} max={99} unit="%" onChange={setTargetSL} />
              <SliderInput label="Target ASA" value={asa} min={5} max={120} unit="s" onChange={setAsa} />

              <div style={{ background: "#fff7ed", borderRadius: 8, padding: "10px 12px", marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#c2410c", marginBottom: 4 }}>MODEL INFO</div>
                <div style={{ fontSize: 11, color: "#9a3412", lineHeight: 1.5 }}>
                  Using <strong>Erlang C</strong> formula.<br />
                  SL = {targetSL}% calls answered within {asa}s.
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Main content ── */}
          <div style={{ flex: 1, minWidth: 0 }}>

            {/* ── 8-week chart ── */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 24px", marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>8-Week FTE Requirement</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                    Click a week to drill down · Based on long-term volume forecast
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>Peak:</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#f97316" }}>{Math.round(maxFTE)} FTE</span>
                  <Sparkline values={fteValues} />
                </div>
              </div>

              {/* Bar chart */}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 140 }}>
                {weeklyResults.map((w, i) => {
                  const pct = (w.fte / (maxFTE * 1.2)) * 100;
                  const isSelected = i === selectedWeek;
                  return (
                    <div
                      key={i}
                      style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer" }}
                      onClick={() => setSelectedWeek(i)}
                    >
                      <div style={{ fontSize: 10, fontWeight: 700, color: isSelected ? "#f97316" : "#6b7280", marginBottom: 4 }}>
                        {Math.round(w.fte)}
                      </div>
                      <div style={{
                        width: "100%",
                        height: `${pct}%`,
                        minHeight: 8,
                        background: isSelected ? "#f97316" : "#fed7aa",
                        borderRadius: "4px 4px 0 0",
                        transition: "all .2s",
                        border: isSelected ? "2px solid #ea580c" : "2px solid transparent",
                      }} />
                      <div style={{ marginTop: 6, textAlign: "center" }}>
                        <div style={{ fontSize: 11, fontWeight: isSelected ? 700 : 500, color: isSelected ? "#f97316" : "#374151" }}>{w.week}</div>
                        <div style={{ fontSize: 10, color: "#9ca3af" }}>{w.label}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Summary metrics */}
              <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
                <MetricCard label="Total Volume" value={selWeek.baseVol.toLocaleString()} sub={`${sel.erlangs} Erlangs`} />
                <MetricCard label="Required FTE" value={sel.fte} sub={`${sel.rawAgents} base agents`} accent="#f97316" />
                <MetricCard label="Achieved SL" value={<Badge value={sel.achievedSL} target={targetSL} unit="%" />} sub={`Target: ${targetSL}%`} />
                <MetricCard label="Occupancy" value={<Badge value={sel.actualOcc} target={75} unit="%" />} sub={`Max: ${occupancy}%`} />
                <MetricCard label="Shrinkage" value={`${shrinkage}%`} sub={`+${(sel.rawAgents * shrinkage / (100 - shrinkage)).toFixed(0)} buffer`} />
              </div>
            </div>

            {/* ── Daily breakdown table ── */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 24px" }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#111827", marginBottom: 4 }}>
                Daily Breakdown — {selWeek.week} ({selWeek.label})
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>
                Per-day staffing based on volume distribution pattern
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                    {["Day", "Call Volume", "Erlangs (A)", "Base Agents", "Req. FTE", "Svc Level", "Occupancy"].map(h => (
                      <th key={h} style={{
                        fontSize: 11, fontWeight: 600, color: "#9ca3af",
                        textAlign: "left", padding: "0 12px 10px 0",
                        textTransform: "uppercase", letterSpacing: ".04em",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dailyBreakdown.map((d, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f9fafb" }}>
                      <td style={{ padding: "10px 12px 10px 0", fontWeight: 600, fontSize: 13, color: "#111827" }}>{d.day}</td>
                      <td style={{ padding: "10px 12px 10px 0", fontSize: 13, color: "#374151" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ height: 6, width: Math.round(d.vol / 80), maxWidth: 60, background: "#fed7aa", borderRadius: 99 }} />
                          {d.vol.toLocaleString()}
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px 10px 0", fontSize: 13, color: "#6b7280" }}>{d.erlangs}</td>
                      <td style={{ padding: "10px 12px 10px 0", fontSize: 13, color: "#374151", fontWeight: 500 }}>{d.rawAgents}</td>
                      <td style={{ padding: "10px 12px 10px 0", fontSize: 14, fontWeight: 700, color: "#f97316" }}>{d.fte}</td>
                      <td style={{ padding: "10px 12px 10px 0" }}><Badge value={d.achievedSL} target={targetSL} unit="%" /></td>
                      <td style={{ padding: "10px 12px 10px 0" }}><Badge value={d.actualOcc} target={75} unit="%" /></td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid #e5e7eb", background: "#f9fafb" }}>
                    <td style={{ padding: "10px 12px 10px 0", fontWeight: 700, fontSize: 13, color: "#111827" }}>TOTAL</td>
                    <td style={{ padding: "10px 12px 10px 0", fontWeight: 700, fontSize: 13, color: "#111827" }}>
                      {dailyBreakdown.reduce((a, d) => a + d.vol, 0).toLocaleString()}
                    </td>
                    <td colSpan={2} />
                    <td style={{ padding: "10px 12px 10px 0", fontWeight: 700, fontSize: 14, color: "#f97316" }}>
                      {sel.fte} avg
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>

              {/* Erlang formula explainer */}
              <div style={{ marginTop: 20, background: "#f9fafb", borderRadius: 8, padding: "12px 16px", border: "1px solid #e5e7eb" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 8 }}>📐 FTE CALCULATION LOGIC</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                  {[
                    { step: "1", label: "Traffic Intensity", formula: "A = (Volume × AHT) ÷ (Hours × 3600)" },
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

          </div>
        </div>
      </div>
    </div>
  );
}