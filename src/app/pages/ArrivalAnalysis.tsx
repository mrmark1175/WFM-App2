import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiUrl } from "../lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface CellData { volume: number; aht: number; }
type GridData = Record<string, Record<number, CellData>>;

type ViewLevel = "yoy" | "monthly" | "weekly" | "daily" | "intraday" | "distribution";
type LayoutMode = "periods-as-rows" | "periods-as-cols";
type WeekStart  = 0 | 1; // 0=Sun, 1=Mon
type ChannelKey = "voice" | "chat" | "email" | "cases";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const SLOT_COUNT = 96;
const MONTHS    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW_LABELS  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DOW_MON_FIRST = [1,2,3,4,5,6,0];
const DOW_SUN_FIRST = [0,1,2,3,4,5,6];
const CHANNEL_OPTIONS: { value: ChannelKey; label: string }[] = [
  { value: "voice", label: "Voice" },
  { value: "chat", label: "Chat" },
  { value: "email", label: "Email" },
  { value: "cases", label: "Cases" },
];

const VIEW_META: Record<ViewLevel, { label: string; icon: string; desc: string }> = {
  yoy:          { label: "Year over Year",   icon: "📅", desc: "Total volume per year — long-term trend" },
  monthly:      { label: "Monthly",          icon: "🗓", desc: "Month-by-month within a year — seasonality" },
  weekly:       { label: "Weekly",           icon: "📆", desc: "Week-by-week within a year — short-term capacity" },
  daily:        { label: "Daily",            icon: "📋", desc: "Day-by-day within a month — intramonth pattern" },
  intraday:     { label: "Intraday",         icon: "⏱", desc: "Interval profile for a period — staffing input" },
  distribution: { label: "Distribution %",  icon: "📊", desc: "Interval % of day by DoW — forecast distribution" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmtSlot(slotIdx: number): string {
  const mins = slotIdx * 15;
  const h    = Math.floor(mins / 60);
  const m    = mins % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2,"0")} ${ampm}`;
}

function getISOWeek(date: Date, weekStart: WeekStart): number {
  const d = new Date(date);
  const day = d.getDay();
  const diff = weekStart === 1
    ? (day === 0 ? -6 : 1 - day)
    : -day;
  d.setDate(d.getDate() + diff);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
}

function getWeekYear(date: Date, weekStart: WeekStart): number {
  const d = new Date(date);
  const day = d.getDay();
  const diff = weekStart === 1 ? (day === 0 ? -6 : 1 - day) : -day;
  d.setDate(d.getDate() + diff);
  return d.getFullYear();
}

function dayVolume(data: GridData, ds: string): number {
  const slots = data[ds];
  if (!slots) return 0;
  return Object.values(slots).reduce((s, c) => s + (c.volume || 0), 0);
}

function dayAHT(data: GridData, ds: string): number {
  const slots = data[ds];
  if (!slots) return 0;
  const vals = Object.values(slots).map(c => c.aht || 0).filter(v => v > 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}

function heatColor(val: number, max: number): string {
  if (!max || !val) return "transparent";
  const t = Math.min(val / max, 1);
  const g = Math.round(255 - t * 140);
  const b = Math.round(255 - t * 255);
  return `rgba(255,${g},${b},${0.15 + t * 0.55})`;
}

function fmt(n: number): string {
  if (n === 0) return "—";
  return n >= 1000 ? n.toLocaleString() : String(n);
}

function pct(part: number, total: number): string {
  if (!total || !part) return "—";
  return (part / total * 100).toFixed(2) + "%";
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV / Clipboard export helpers
// ─────────────────────────────────────────────────────────────────────────────
function exportCSV(headers: string[], rows: (string | number)[][], filename: string) {
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function copyTSV(headers: string[], rows: (string | number)[][]) {
  const tsv = [headers, ...rows].map(r => r.join("\t")).join("\n");
  navigator.clipboard.writeText(tsv).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Pivot cell
// ─────────────────────────────────────────────────────────────────────────────
interface PivotCellProps {
  vol: number; pctStr: string; maxVol: number;
  isHdr?: boolean; isTotal?: boolean;
}
const PivotCell = ({ vol, pctStr, maxVol, isHdr, isTotal }: PivotCellProps) => (
  <td style={{
    padding: "5px 10px", textAlign: "right", fontSize: 12, whiteSpace: "nowrap",
    border: "1px solid #f3f4f6",
    background: isHdr || isTotal ? "#f8fafc" : heatColor(vol, maxVol),
    fontWeight: isTotal ? 700 : 500,
    color: vol > 0 ? "#111827" : "#d1d5db",
    minWidth: 110,
  }}>
    {vol > 0 ? (
      <span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(vol)}</span>
        {pctStr !== "—" && (
          <span style={{ marginLeft: 6, fontSize: 10, color: "#9ca3af", fontWeight: 400 }}>{pctStr}</span>
        )}
      </span>
    ) : "—"}
  </td>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────────────────────
export function ArrivalAnalysis() {
  const navigate = useNavigate();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [data,      setData]      = useState<GridData>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loaded,    setLoaded]    = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<ChannelKey>("voice");

  // ── View controls ───────────────────────────────────────────────────────────
  const [view,       setView]       = useState<ViewLevel>("yoy");
  const [layout,     setLayout]     = useState<LayoutMode>("periods-as-rows");
  const [weekStart,  setWeekStart]  = useState<WeekStart>(1);
  const [copyDone,   setCopyDone]   = useState(false);

  // ── Drill selectors ─────────────────────────────────────────────────────────
  const [selYear,  setSelYear]  = useState<number | null>(null);
  const [selMonth, setSelMonth] = useState<number | null>(null); // 0-based
  const [selWeek,  setSelWeek]  = useState<number | null>(null);
  const [selDay,   setSelDay]   = useState<string | null>(null);

  // ── Interval size ───────────────────────────────────────────────────────────
  const [intervalSize, setIntervalSize] = useState<15 | 30 | 60>(15);
  const intervalStep = intervalSize / 15;

  // ── Fetch ALL data on mount ─────────────────────────────────────────────────
  useEffect(() => {
    setIsLoading(true);
    const start = "2020-01-01";
    const end   = new Date().toISOString().split("T")[0];
    fetch(apiUrl(`/api/interaction-arrival?startDate=${start}&endDate=${end}&channel=${selectedChannel}`))
      .then(r => r.json())
      .then((records: any[]) => {
        if (!Array.isArray(records)) return;
        const d: GridData = {};
        records.forEach(r => {
          const ds = (r.interval_date as string).split("T")[0];
          if (!d[ds]) d[ds] = {};
          d[ds][r.interval_index] = { volume: r.volume || 0, aht: r.aht || 0 };
        });
        setData(d);
        setLoaded(true);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [selectedChannel]);

  // ── Derived: years / months / weeks / days present in data ─────────────────
  const allDates = useMemo(() => Object.keys(data).sort(), [data]);

  const years = useMemo(() => {
    const s = new Set<number>();
    allDates.forEach(ds => s.add(new Date(ds + "T00:00:00").getFullYear()));
    return Array.from(s).sort();
  }, [allDates]);

  const monthsForYear = useCallback((yr: number) => {
    const s = new Set<number>();
    allDates.forEach(ds => {
      const d = new Date(ds + "T00:00:00");
      if (d.getFullYear() === yr) s.add(d.getMonth());
    });
    return Array.from(s).sort((a,b) => a - b);
  }, [allDates]);

  const weeksForYear = useCallback((yr: number) => {
    const s = new Set<number>();
    allDates.forEach(ds => {
      const d = new Date(ds + "T00:00:00");
      if (getWeekYear(d, weekStart) === yr) s.add(getISOWeek(d, weekStart));
    });
    return Array.from(s).sort((a,b) => a - b);
  }, [allDates, weekStart]);

  const daysForMonthYear = useCallback((yr: number, mo: number) => {
    return allDates.filter(ds => {
      const d = new Date(ds + "T00:00:00");
      return d.getFullYear() === yr && d.getMonth() === mo;
    }).sort();
  }, [allDates]);

  const daysForWeekYear = useCallback((yr: number, wk: number) => {
    return allDates.filter(ds => {
      const d = new Date(ds + "T00:00:00");
      return getWeekYear(d, weekStart) === yr && getISOWeek(d, weekStart) === wk;
    }).sort();
  }, [allDates, weekStart]);

  // ── Auto-select first year when data loads ──────────────────────────────────
  useEffect(() => {
    if (years.length > 0 && selYear === null) setSelYear(years[years.length - 1]);
  }, [years]);

  // ─────────────────────────────────────────────────────────────────────────────
  // PIVOT COMPUTATION
  // ─────────────────────────────────────────────────────────────────────────────

  // Helper: sum volumes for an array of dates
  const sumVol = (dates: string[]) => dates.reduce((s, ds) => s + dayVolume(data, ds), 0);

  // ── YoY pivot ────────────────────────────────────────────────────────────────
  const yoyPivot = useMemo(() => {
    // rows = years, single col = total volume
    return years.map(yr => {
      const dates = allDates.filter(ds => new Date(ds + "T00:00:00").getFullYear() === yr);
      const vol   = sumVol(dates);
      return { label: String(yr), vol, dates };
    });
  }, [years, allDates, data]);

  // ── Monthly pivot ─────────────────────────────────────────────────────────────
  const monthlyPivot = useMemo(() => {
    if (!selYear) return [];
    return MONTHS.map((mo, mi) => {
      const dates = allDates.filter(ds => {
        const d = new Date(ds + "T00:00:00");
        return d.getFullYear() === selYear && d.getMonth() === mi;
      });
      return { label: mo, fullLabel: MONTHS_FULL[mi], vol: sumVol(dates), dates };
    });
  }, [selYear, allDates, data]);

  // ── Weekly pivot ──────────────────────────────────────────────────────────────
  const weeklyPivot = useMemo(() => {
    if (!selYear) return [];
    const weeks = weeksForYear(selYear);
    return weeks.map(wk => {
      const dates = daysForWeekYear(selYear, wk);
      const start = dates[0] ? new Date(dates[0] + "T00:00:00") : null;
      const label = start
        ? `W${String(wk).padStart(2,"0")} (${MONTHS[start.getMonth()]} ${start.getDate()})`
        : `W${String(wk).padStart(2,"0")}`;
      return { label, wk, vol: sumVol(dates), dates };
    });
  }, [selYear, weeksForYear, daysForWeekYear, data]);

  // ── Daily pivot ───────────────────────────────────────────────────────────────
  const dailyPivot = useMemo(() => {
    if (!selYear) return [];
    let dates: string[] = [];
    if (selMonth !== null) {
      dates = daysForMonthYear(selYear, selMonth);
    } else if (selWeek !== null) {
      dates = daysForWeekYear(selYear, selWeek);
    } else {
      // all days in year
      dates = allDates.filter(ds => new Date(ds + "T00:00:00").getFullYear() === selYear);
    }
    return dates.map(ds => {
      const d   = new Date(ds + "T00:00:00");
      const vol = dayVolume(data, ds);
      return {
        label: `${DOW_LABELS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`,
        ds, vol,
      };
    });
  }, [selYear, selMonth, selWeek, allDates, daysForMonthYear, daysForWeekYear, data]);

  // ── Intraday pivot ────────────────────────────────────────────────────────────
  // rows = intervals, cols = dates (for a day/week/month/year selection)
  const intradayPivot = useMemo(() => {
    if (!selYear) return { slots: [], dates: [], colLabels: [] };
    let dates: string[] = [];
    if (selDay) {
      dates = [selDay];
    } else if (selMonth !== null) {
      dates = daysForMonthYear(selYear, selMonth);
    } else if (selWeek !== null) {
      dates = daysForWeekYear(selYear, selWeek);
    } else {
      dates = allDates.filter(ds => new Date(ds + "T00:00:00").getFullYear() === selYear);
    }

    const slots: { label: string; idx: number; vols: number[] }[] = [];
    for (let si = 0; si < SLOT_COUNT; si += intervalStep) {
      const indices = Array.from({ length: intervalStep }, (_, j) => si + j);
      const vols = dates.map(ds => {
        const slots_ = data[ds] || {};
        return indices.reduce((s, i) => s + (slots_[i]?.volume || 0), 0);
      });
      slots.push({ label: fmtSlot(si), idx: si, vols });
    }

    const colLabels = dates.map(ds => {
      const d = new Date(ds + "T00:00:00");
      return `${DOW_LABELS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    });

    return { slots, dates, colLabels };
  }, [selYear, selMonth, selWeek, selDay, allDates, daysForMonthYear, daysForWeekYear, data, intervalStep]);

  // ── Distribution % pivot ──────────────────────────────────────────────────────
  const distPivot = useMemo(() => {
    const dowOrder = weekStart === 1 ? DOW_MON_FIRST : DOW_SUN_FIRST;
    // profile[year][dow][slotIdx] = avg %
    const acc: Record<number, Record<number, Record<number, { sum: number; cnt: number }>>> = {};
    Object.entries(data).forEach(([ds, slots]) => {
      const d   = new Date(ds + "T00:00:00");
      const yr  = d.getFullYear();
      const dow = d.getDay();
      const dayTotal = Object.values(slots).reduce((s, c) => s + (c.volume || 0), 0);
      if (!dayTotal) return;
      if (!acc[yr]) acc[yr] = {};
      if (!acc[yr][dow]) acc[yr][dow] = {};
      for (let si = 0; si < SLOT_COUNT; si++) {
        const v = slots[si]?.volume || 0;
        const p = (v / dayTotal) * 100;
        if (!acc[yr][dow][si]) acc[yr][dow][si] = { sum: 0, cnt: 0 };
        acc[yr][dow][si].sum += p;
        acc[yr][dow][si].cnt += 1;
      }
    });
    const result: Record<number, Record<number, Record<number, number>>> = {};
    Object.entries(acc).forEach(([yr, dows]) => {
      result[Number(yr)] = {};
      Object.entries(dows).forEach(([dow, si]) => {
        result[Number(yr)][Number(dow)] = {};
        Object.entries(si).forEach(([s, { sum, cnt }]) => {
          result[Number(yr)][Number(dow)][Number(s)] = cnt ? sum / cnt : 0;
        });
      });
    });
    return { profile: result, dowOrder };
  }, [data, weekStart]);

  // ─────────────────────────────────────────────────────────────────────────────
  // BUILD TABLE DATA (headers + rows) for export
  // ─────────────────────────────────────────────────────────────────────────────
  const tableData = useMemo((): { headers: string[]; rows: (string | number)[][] } => {
    if (view === "yoy") {
      const total = yoyPivot.reduce((s, r) => s + r.vol, 0);
      if (layout === "periods-as-rows") {
        return {
          headers: ["Year", "Volume", "% of Total"],
          rows: yoyPivot.map(r => [r.label, r.vol, pct(r.vol, total)]),
        };
      } else {
        return {
          headers: ["Metric", ...yoyPivot.map(r => r.label)],
          rows: [
            ["Volume",     ...yoyPivot.map(r => r.vol)],
            ["% of Total", ...yoyPivot.map(r => pct(r.vol, total))],
          ],
        };
      }
    }

    if (view === "monthly" && selYear) {
      const total = monthlyPivot.reduce((s, r) => s + r.vol, 0);
      if (layout === "periods-as-rows") {
        return {
          headers: ["Month", "Volume", "% of Year"],
          rows: monthlyPivot.map(r => [r.fullLabel, r.vol, pct(r.vol, total)]),
        };
      } else {
        return {
          headers: ["Metric", ...monthlyPivot.map(r => r.fullLabel)],
          rows: [
            ["Volume",    ...monthlyPivot.map(r => r.vol)],
            ["% of Year", ...monthlyPivot.map(r => pct(r.vol, total))],
          ],
        };
      }
    }

    if (view === "weekly" && selYear) {
      const total = weeklyPivot.reduce((s, r) => s + r.vol, 0);
      if (layout === "periods-as-rows") {
        return {
          headers: ["Week", "Volume", "% of Year"],
          rows: weeklyPivot.map(r => [r.label, r.vol, pct(r.vol, total)]),
        };
      } else {
        return {
          headers: ["Metric", ...weeklyPivot.map(r => r.label)],
          rows: [
            ["Volume",    ...weeklyPivot.map(r => r.vol)],
            ["% of Year", ...weeklyPivot.map(r => pct(r.vol, total))],
          ],
        };
      }
    }

    if (view === "daily") {
      const total = dailyPivot.reduce((s, r) => s + r.vol, 0);
      if (layout === "periods-as-rows") {
        return {
          headers: ["Date", "Volume", "% of Period"],
          rows: dailyPivot.map(r => [r.label, r.vol, pct(r.vol, total)]),
        };
      } else {
        return {
          headers: ["Metric", ...dailyPivot.map(r => r.label)],
          rows: [
            ["Volume",      ...dailyPivot.map(r => r.vol)],
            ["% of Period", ...dailyPivot.map(r => pct(r.vol, total))],
          ],
        };
      }
    }

    if (view === "intraday") {
      const { slots, colLabels } = intradayPivot;
      if (layout === "periods-as-rows") {
        // rows=dates, cols=intervals
        return {
          headers: ["Date", ...slots.map(s => s.label)],
          rows: colLabels.map((lbl, ci) => [lbl, ...slots.map(s => s.vols[ci] || 0)]),
        };
      } else {
        // rows=intervals, cols=dates
        return {
          headers: ["Interval", ...colLabels],
          rows: slots.map(s => [s.label, ...s.vols]),
        };
      }
    }

    if (view === "distribution") {
      const { profile, dowOrder } = distPivot;
      const headers = ["Interval", ...years.flatMap(yr => dowOrder.map(d => `${yr} ${DOW_LABELS[d]}`))];
      const rows: (string | number)[][] = [];
      for (let si = 0; si < SLOT_COUNT; si += intervalStep) {
        const label = fmtSlot(si);
        const indices = Array.from({ length: intervalStep }, (_, j) => si + j);
        const vals = years.flatMap(yr =>
          dowOrder.map(dow => {
            const p = indices.reduce((s, i) => s + (profile[yr]?.[dow]?.[i] ?? 0), 0);
            return p > 0 ? p.toFixed(4) : "—";
          })
        );
        rows.push([label, ...vals]);
      }
      return { headers, rows };
    }

    return { headers: [], rows: [] };
  }, [view, layout, yoyPivot, monthlyPivot, weeklyPivot, dailyPivot, intradayPivot, distPivot, selYear, years, intervalStep]);

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER TABLE
  // ─────────────────────────────────────────────────────────────────────────────
  const renderTable = () => {
    if (!loaded) return (
      <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>
        {isLoading ? "Loading data…" : "No data loaded."}
      </div>
    );

    // ── YoY ──
    if (view === "yoy") {
      const grandTotal = yoyPivot.reduce((s, r) => s + r.vol, 0);
      const maxVol     = Math.max(...yoyPivot.map(r => r.vol));
      if (layout === "periods-as-rows") {
        return (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                {["Year","Volume","% of Total","YoY Δ"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".05em", textAlign: h === "Year" ? "left" : "right", borderBottom: "2px solid #e5e7eb" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {yoyPivot.map((r, i) => {
                const prev = yoyPivot[i - 1];
                const delta = prev && prev.vol > 0 ? ((r.vol - prev.vol) / prev.vol * 100) : null;
                return (
                  <tr key={r.label} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "7px 12px", fontSize: 13, fontWeight: 700, color: "#111827" }}>{r.label}</td>
                    <PivotCell vol={r.vol} pctStr="—" maxVol={maxVol} />
                    <td style={{ padding: "7px 12px", fontSize: 12, textAlign: "right", color: "#6b7280" }}>{pct(r.vol, grandTotal)}</td>
                    <td style={{ padding: "7px 12px", fontSize: 12, textAlign: "right", fontWeight: 600, color: delta === null ? "#d1d5db" : delta >= 0 ? "#16a34a" : "#dc2626" }}>
                      {delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: "2px solid #e5e7eb", background: "#f8fafc" }}>
                <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, color: "#374151" }}>Total</td>
                <PivotCell vol={grandTotal} pctStr="—" maxVol={maxVol} isTotal />
                <td style={{ padding: "7px 12px", fontSize: 12, textAlign: "right", fontWeight: 700, color: "#374151" }}>100%</td>
                <td />
              </tr>
            </tbody>
          </table>
        );
      } else {
        // cols = years
        return (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".05em", textAlign: "left", borderBottom: "2px solid #e5e7eb", minWidth: 120 }}>Metric</th>
                {yoyPivot.map(r => <th key={r.label} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".05em", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 110 }}>{r.label}</th>)}
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".05em", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 110 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Volume",      vals: yoyPivot.map(r => r.vol) },
                { label: "% of Total",  vals: yoyPivot.map(r => pct(r.vol, grandTotal)) },
              ].map(row => (
                <tr key={row.label} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, color: "#374151" }}>{row.label}</td>
                  {row.vals.map((v, i) => (
                    typeof v === "number"
                      ? <PivotCell key={i} vol={v} pctStr={pct(v, grandTotal)} maxVol={maxVol} />
                      : <td key={i} style={{ padding: "7px 12px", fontSize: 12, textAlign: "right", color: "#6b7280" }}>{v}</td>
                  ))}
                  <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, textAlign: "right", color: "#374151", background: "#f8fafc" }}>
                    {row.label === "Volume" ? fmt(grandTotal) : "100%"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }
    }

    // ── Monthly ──
    if (view === "monthly" && selYear) {
      const grandTotal = monthlyPivot.reduce((s, r) => s + r.vol, 0);
      const maxVol     = Math.max(...monthlyPivot.map(r => r.vol));
      const allYearRows = years.map(yr => ({
        yr,
        months: MONTHS.map((_, mi) => {
          const dates = allDates.filter(ds => {
            const d = new Date(ds + "T00:00:00");
            return d.getFullYear() === yr && d.getMonth() === mi;
          });
          return sumVol(dates);
        }),
      }));

      if (layout === "periods-as-rows") {
        // rows=months, cols=years side by side
        return (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "left", borderBottom: "2px solid #e5e7eb", minWidth: 100 }}>Month</th>
                {years.map(yr => <th key={yr} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 110 }}>{yr}</th>)}
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 110 }}>% of Year</th>
              </tr>
            </thead>
            <tbody>
              {MONTHS.map((mo, mi) => {
                const selYearVol = allYearRows.find(r => r.yr === selYear)?.months[mi] || 0;
                return (
                  <tr key={mo} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "7px 12px", fontSize: 13, fontWeight: 600, color: "#111827" }}>{MONTHS_FULL[mi]}</td>
                    {allYearRows.map(r => {
                      const v = r.months[mi];
                      const yearTotal = r.months.reduce((s, n) => s + n, 0);
                      return <PivotCell key={r.yr} vol={v} pctStr={pct(v, yearTotal)} maxVol={Math.max(...allYearRows.flatMap(y => y.months))} />;
                    })}
                    <td style={{ padding: "7px 12px", fontSize: 12, textAlign: "right", color: "#6b7280" }}>{pct(selYearVol, grandTotal)}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: "2px solid #e5e7eb", background: "#f8fafc" }}>
                <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, color: "#374151" }}>Total</td>
                {allYearRows.map(r => {
                  const t = r.months.reduce((s, n) => s + n, 0);
                  return <td key={r.yr} style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, textAlign: "right", color: "#374151" }}>{fmt(t)}</td>;
                })}
                <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, textAlign: "right", color: "#374151" }}>100%</td>
              </tr>
            </tbody>
          </table>
        );
      } else {
        // rows=years, cols=months
        return (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "left", borderBottom: "2px solid #e5e7eb", minWidth: 80 }}>Year</th>
                {MONTHS.map(m => <th key={m} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 90 }}>{m}</th>)}
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 90 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {allYearRows.map(r => {
                const total  = r.months.reduce((s, n) => s + n, 0);
                const maxV   = Math.max(...allYearRows.flatMap(y => y.months));
                return (
                  <tr key={r.yr} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "7px 12px", fontSize: 13, fontWeight: 700, color: "#111827" }}>{r.yr}</td>
                    {r.months.map((v, mi) => <PivotCell key={mi} vol={v} pctStr={pct(v, total)} maxVol={maxV} />)}
                    <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, textAlign: "right", color: "#374151", background: "#f8fafc" }}>{fmt(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      }
    }

    // ── Weekly ──
    if (view === "weekly" && selYear) {
      const grandTotal = weeklyPivot.reduce((s, r) => s + r.vol, 0);
      const maxVol     = Math.max(...weeklyPivot.map(r => r.vol));

      // Build multi-year comparison
      const allYearWeeks = years.map(yr => {
        const wks = weeksForYear(yr);
        const volByWk: Record<number, number> = {};
        wks.forEach(wk => { volByWk[wk] = sumVol(daysForWeekYear(yr, wk)); });
        return { yr, wks, volByWk };
      });
      const allWeeks = Array.from(new Set(allYearWeeks.flatMap(y => y.wks))).sort((a,b)=>a-b);

      if (layout === "periods-as-rows") {
        return (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "left", borderBottom: "2px solid #e5e7eb", minWidth: 140 }}>Week</th>
                {years.map(yr => <th key={yr} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 110 }}>{yr}</th>)}
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 90 }}>% of Year</th>
              </tr>
            </thead>
            <tbody>
              {allWeeks.map(wk => {
                const selYrVol = allYearWeeks.find(y => y.yr === selYear)?.volByWk[wk] || 0;
                const maxV = Math.max(...allYearWeeks.flatMap(y => Object.values(y.volByWk)));
                return (
                  <tr key={wk} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 600, color: "#111827" }}>W{String(wk).padStart(2,"0")}</td>
                    {allYearWeeks.map(y => <PivotCell key={y.yr} vol={y.volByWk[wk] || 0} pctStr={pct(y.volByWk[wk]||0, Object.values(y.volByWk).reduce((s,n)=>s+n,0))} maxVol={maxV} />)}
                    <td style={{ padding: "7px 12px", fontSize: 12, textAlign: "right", color: "#6b7280" }}>{pct(selYrVol, grandTotal)}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: "2px solid #e5e7eb", background: "#f8fafc" }}>
                <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, color: "#374151" }}>Total</td>
                {allYearWeeks.map(y => {
                  const t = Object.values(y.volByWk).reduce((s,n)=>s+n,0);
                  return <td key={y.yr} style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, textAlign: "right", color: "#374151" }}>{fmt(t)}</td>;
                })}
                <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, textAlign: "right", color: "#374151" }}>100%</td>
              </tr>
            </tbody>
          </table>
        );
      } else {
        return (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "left", borderBottom: "2px solid #e5e7eb", minWidth: 80 }}>Year</th>
                {allWeeks.map(wk => <th key={wk} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 70 }}>W{String(wk).padStart(2,"0")}</th>)}
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 90 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {allYearWeeks.map(y => {
                const total = Object.values(y.volByWk).reduce((s,n)=>s+n,0);
                const maxV  = Math.max(...allYearWeeks.flatMap(yy => Object.values(yy.volByWk)));
                return (
                  <tr key={y.yr} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "7px 12px", fontSize: 13, fontWeight: 700, color: "#111827" }}>{y.yr}</td>
                    {allWeeks.map(wk => <PivotCell key={wk} vol={y.volByWk[wk]||0} pctStr={pct(y.volByWk[wk]||0,total)} maxVol={maxV} />)}
                    <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, textAlign: "right", color: "#374151", background: "#f8fafc" }}>{fmt(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      }
    }

    // ── Daily ──
    if (view === "daily") {
      const grandTotal = dailyPivot.reduce((s, r) => s + r.vol, 0);
      const maxVol     = Math.max(...dailyPivot.map(r => r.vol));
      if (layout === "periods-as-rows") {
        return (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                {["Date","Volume","% of Period","DoW"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: h === "Date" || h === "DoW" ? "left" : "right", borderBottom: "2px solid #e5e7eb", minWidth: h === "Date" ? 160 : 90 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dailyPivot.map(r => (
                <tr key={r.ds} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 600, color: "#111827" }}>{r.label}</td>
                  <PivotCell vol={r.vol} pctStr="—" maxVol={maxVol} />
                  <td style={{ padding: "7px 12px", fontSize: 12, textAlign: "right", color: "#6b7280" }}>{pct(r.vol, grandTotal)}</td>
                  <td style={{ padding: "7px 12px", fontSize: 11, color: "#9ca3af" }}>{DOW_LABELS[new Date(r.ds + "T00:00:00").getDay()]}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid #e5e7eb", background: "#f8fafc" }}>
                <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>Total</td>
                <PivotCell vol={grandTotal} pctStr="—" maxVol={maxVol} isTotal />
                <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, textAlign: "right" }}>100%</td>
                <td />
              </tr>
            </tbody>
          </table>
        );
      } else {
        // cols = dates (compact)
        return (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "left", borderBottom: "2px solid #e5e7eb", minWidth: 120 }}>Metric</th>
                {dailyPivot.map(r => <th key={r.ds} style={{ padding: "8px 6px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 80 }}>{r.label}</th>)}
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 90 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Volume",      vals: dailyPivot.map(r => r.vol) },
                { label: "% of Period", vals: dailyPivot.map(r => pct(r.vol, grandTotal)) },
              ].map(row => (
                <tr key={row.label} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, color: "#374151" }}>{row.label}</td>
                  {row.vals.map((v, i) => (
                    typeof v === "number"
                      ? <PivotCell key={i} vol={v} pctStr={pct(v, grandTotal)} maxVol={maxVol} />
                      : <td key={i} style={{ padding: "7px 12px", fontSize: 12, textAlign: "right", color: "#6b7280" }}>{v}</td>
                  ))}
                  <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, textAlign: "right", background: "#f8fafc" }}>
                    {row.label === "Volume" ? fmt(grandTotal) : "100%"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }
    }

    // ── Intraday ──
    if (view === "intraday") {
      const { slots, colLabels } = intradayPivot;
      if (!slots.length) return <div style={{ padding: 40, color: "#9ca3af", textAlign: "center" }}>Select a year/month/week/day to view intraday data.</div>;
      const colTotals = colLabels.map((_, ci) => slots.reduce((s, sl) => s + (sl.vols[ci] || 0), 0));
      const maxVol    = Math.max(...slots.flatMap(s => s.vols));

      if (layout === "periods-as-cols") {
        // rows=intervals, cols=dates  ← most useful for staffing
        return (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "left", borderBottom: "2px solid #e5e7eb", position: "sticky", left: 0, background: "#f8fafc", zIndex: 2, minWidth: 90 }}>Interval</th>
                {colLabels.map((lbl, ci) => (
                  <th key={ci} style={{ padding: "8px 8px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 100 }}>{lbl}</th>
                ))}
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 90 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {slots.map(sl => {
                const rowTotal = sl.vols.reduce((s, v) => s + v, 0);
                return (
                  <tr key={sl.idx} style={{ borderBottom: "1px solid #f3f4f6", background: sl.idx % (4 * intervalStep) === 0 ? "#fafafa" : undefined }}>
                    <td style={{ padding: "5px 12px", fontSize: 11, fontWeight: sl.idx % (4 * intervalStep) === 0 ? 700 : 400, color: sl.idx % (4 * intervalStep) === 0 ? "#374151" : "#9ca3af", position: "sticky", left: 0, background: sl.idx % (4 * intervalStep) === 0 ? "#f1f5f9" : "#f8fafc", zIndex: 1, whiteSpace: "nowrap" }}>{sl.label}</td>
                    {sl.vols.map((v, ci) => <PivotCell key={ci} vol={v} pctStr={pct(v, colTotals[ci])} maxVol={maxVol} />)}
                    <td style={{ padding: "5px 12px", fontSize: 12, fontWeight: 700, textAlign: "right", color: rowTotal > 0 ? "#f97316" : "#d1d5db", background: "#f8fafc" }}>{fmt(rowTotal)}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: "2px solid #e5e7eb", background: "#f8fafc" }}>
                <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, color: "#374151", position: "sticky", left: 0, background: "#f1f5f9", zIndex: 1 }}>Total</td>
                {colTotals.map((t, ci) => <PivotCell key={ci} vol={t} pctStr="—" maxVol={Math.max(...colTotals)} isTotal />)}
                <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, textAlign: "right", color: "#f97316" }}>{fmt(colTotals.reduce((s,n)=>s+n,0))}</td>
              </tr>
            </tbody>
          </table>
        );
      } else {
        // rows=dates, cols=intervals
        return (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "left", borderBottom: "2px solid #e5e7eb", position: "sticky", left: 0, background: "#f8fafc", zIndex: 2, minWidth: 140 }}>Date</th>
                {slots.map(sl => <th key={sl.idx} style={{ padding: "8px 6px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 70 }}>{sl.label}</th>)}
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 90 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {colLabels.map((lbl, ci) => {
                const row   = slots.map(sl => sl.vols[ci] || 0);
                const total = row.reduce((s,n)=>s+n,0);
                return (
                  <tr key={ci} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 600, color: "#111827", position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>{lbl}</td>
                    {row.map((v, si) => <PivotCell key={si} vol={v} pctStr={pct(v, total)} maxVol={maxVol} />)}
                    <td style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, textAlign: "right", color: "#f97316", background: "#f8fafc" }}>{fmt(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      }
    }

    // ── Distribution % ──
    if (view === "distribution") {
      const { profile, dowOrder } = distPivot;
      const maxPct = (() => {
        let m = 0;
        Object.values(profile).forEach(dows => Object.values(dows).forEach(slots => Object.values(slots).forEach(v => { if (v > m) m = v; })));
        return m;
      })();

      const slotRows: { label: string; idx: number; indices: number[] }[] = [];
      for (let si = 0; si < SLOT_COUNT; si += intervalStep) {
        slotRows.push({ label: fmtSlot(si), idx: si, indices: Array.from({ length: intervalStep }, (_, j) => si + j) });
      }

      if (layout === "periods-as-rows") {
        // rows=DoW, cols=years
        return (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "left", borderBottom: "2px solid #e5e7eb", minWidth: 90, position: "sticky", left: 0, background: "#f8fafc", zIndex: 2 }}>Interval</th>
                {years.flatMap(yr => dowOrder.map(d => (
                  <th key={`${yr}-${d}`} style={{ padding: "8px 6px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 72, borderLeft: d === dowOrder[0] ? "2px solid #e5e7eb" : undefined }}>
                    {yr} {DOW_LABELS[d]}
                  </th>
                )))}
              </tr>
            </thead>
            <tbody>
              {slotRows.map(sl => {
                const isHr = sl.idx % (4 * intervalStep) === 0;
                return (
                  <tr key={sl.idx} style={{ borderBottom: "1px solid #f3f4f6", background: isHr ? "#fafafa" : undefined }}>
                    <td style={{ padding: "4px 12px", fontSize: 11, fontWeight: isHr ? 700 : 400, color: isHr ? "#374151" : "#9ca3af", position: "sticky", left: 0, background: isHr ? "#f1f5f9" : "#f8fafc", zIndex: 1, whiteSpace: "nowrap" }}>{sl.label}</td>
                    {years.flatMap(yr => dowOrder.map(dow => {
                      const p = sl.indices.reduce((s, i) => s + (profile[yr]?.[dow]?.[i] ?? 0), 0);
                      return (
                        <td key={`${yr}-${dow}`} style={{ padding: "4px 7px", fontSize: 11, textAlign: "right", fontWeight: p > 0 ? 600 : 400, color: p > 0 ? "#111827" : "#e5e7eb", background: p > 0 ? heatColor(p, maxPct) : undefined, borderLeft: dow === dowOrder[0] ? "2px solid #e5e7eb" : "1px solid #f3f4f6", fontVariantNumeric: "tabular-nums" }}>
                          {p > 0 ? `${p.toFixed(2)}%` : "—"}
                        </td>
                      );
                    }))}
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr style={{ borderTop: "2px solid #e5e7eb", background: "#f8fafc" }}>
                <td style={{ padding: "6px 12px", fontSize: 11, fontWeight: 700, color: "#374151", position: "sticky", left: 0, background: "#f1f5f9", zIndex: 1 }}>Total</td>
                {years.flatMap(yr => dowOrder.map(dow => {
                  const total = slotRows.reduce((s, sl) => s + sl.indices.reduce((ss, i) => ss + (profile[yr]?.[dow]?.[i] ?? 0), 0), 0);
                  return <td key={`${yr}-${dow}`} style={{ padding: "6px 7px", fontSize: 11, fontWeight: 700, textAlign: "right", color: total > 0 ? "#f97316" : "#d1d5db", borderLeft: dow === dowOrder[0] ? "2px solid #e5e7eb" : "1px solid #f3f4f6" }}>{total > 0 ? `${total.toFixed(1)}%` : "—"}</td>;
                }))}
              </tr>
            </tbody>
          </table>
        );
      } else {
        // rows=years×DoW, cols=intervals
        return (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "left", borderBottom: "2px solid #e5e7eb", minWidth: 110, position: "sticky", left: 0, background: "#f8fafc", zIndex: 2 }}>Year / DoW</th>
                {slotRows.map(sl => <th key={sl.idx} style={{ padding: "8px 4px", fontSize: 9, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right", borderBottom: "2px solid #e5e7eb", minWidth: 58 }}>{sl.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {years.flatMap(yr => dowOrder.map(dow => {
                const isWknd = dow === 0 || dow === 6;
                return (
                  <tr key={`${yr}-${dow}`} style={{ borderBottom: "1px solid #f3f4f6", background: isWknd ? "#fafaf9" : undefined }}>
                    <td style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#111827", position: "sticky", left: 0, background: isWknd ? "#fafaf9" : "#fff", zIndex: 1, whiteSpace: "nowrap" }}>{yr} {DOW_LABELS[dow]}</td>
                    {slotRows.map(sl => {
                      const p = sl.indices.reduce((s, i) => s + (profile[yr]?.[dow]?.[i] ?? 0), 0);
                      return <td key={sl.idx} style={{ padding: "4px 4px", fontSize: 10, textAlign: "right", fontWeight: p > 0 ? 600 : 400, color: p > 0 ? "#111827" : "#e5e7eb", background: p > 0 ? heatColor(p, maxPct) : undefined, borderLeft: "1px solid #f3f4f6", fontVariantNumeric: "tabular-nums" }}>{p > 0 ? `${p.toFixed(2)}%` : "—"}</td>;
                    })}
                  </tr>
                );
              }))}
            </tbody>
          </table>
        );
      }
    }

    return null;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Styles
  // ─────────────────────────────────────────────────────────────────────────────
  const S = {
    page:   { fontFamily: "'DM Sans','Segoe UI',sans-serif", background: "#f9fafb", minHeight: "100vh" } as React.CSSProperties,
    header: { background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" } as React.CSSProperties,
    card:   { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12 } as React.CSSProperties,
    navBtn: (a: boolean): React.CSSProperties => ({
      display: "flex", alignItems: "center", gap: 8, width: "100%",
      padding: "9px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
      border: "none", cursor: "pointer", textAlign: "left" as const,
      background: a ? "#fff7ed" : "transparent",
      color: a ? "#f97316" : "#374151",
      borderLeft: a ? "3px solid #f97316" : "3px solid transparent",
    }),
    selBtn: (a: boolean): React.CSSProperties => ({
      padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
      border: "1px solid", cursor: "pointer",
      borderColor: a ? "#f97316" : "#e5e7eb",
      background: a ? "#fff7ed" : "#fff",
      color: a ? "#f97316" : "#6b7280",
    }),
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>

      {/* ── Header ── */}
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="28" height="28" viewBox="0 0 28 28">
            <circle cx="14" cy="14" r="13" fill="none" stroke="#f97316" strokeWidth="2.5"/>
            <circle cx="14" cy="14" r="5" fill="#111827"/>
            <line x1="14" y1="1"  x2="14" y2="6"  stroke="#f97316" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="14" y1="22" x2="14" y2="27" stroke="#111827" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="1"  y1="14" x2="6"  y2="14" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="22" y1="14" x2="27" y2="14" stroke="#111827" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#111827" }}>Exordium</span>
        </div>
        <nav style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Link to="/wfm" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#111827")}
            onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>Workforce Management</Link>
          <span style={{ color: "#d1d5db" }}>›</span>
          <Link to="/wfm/interaction-arrival" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#111827")}
            onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>Interaction Arrival</Link>
          <span style={{ color: "#d1d5db" }}>›</span>
          <span style={{ fontSize: 13, color: "#f97316", fontWeight: 600 }}>Arrival Analysis</span>
        </nav>
        <button onClick={() => navigate("/")} style={{ fontSize: 13, color: "#6b7280", background: "none", border: "none", cursor: "pointer" }}>🏠 Home</button>
      </div>

      {/* ── Main layout ── */}
      <div style={{ display: "flex", height: "calc(100vh - 56px)", overflow: "hidden" }}>

        {/* ── LEFT NAV ── */}
        <div style={{ width: 260, flexShrink: 0, background: "#fff", borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Title */}
          <div style={{ padding: "20px 20px 12px" }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>Arrival Analysis</h2>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "#9ca3af" }}>
              {isLoading ? "Loading…" : loaded ? `${Object.keys(data).length.toLocaleString()} days loaded` : "No data"}
            </p>
          </div>

          <div style={{ padding: "0 20px 12px", borderBottom: "1px solid #f3f4f6" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Channel</div>
            <select
              value={selectedChannel}
              onChange={e => setSelectedChannel(e.target.value as ChannelKey)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#111827", fontSize: 12, fontWeight: 600 }}
            >
              {CHANNEL_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {/* View selector */}
          <div style={{ padding: "0 12px 12px", borderBottom: "1px solid #f3f4f6" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".06em", padding: "0 4px 6px" }}>View</div>
            {(Object.keys(VIEW_META) as ViewLevel[]).map(v => (
              <button key={v} style={S.navBtn(view === v)} onClick={() => setView(v)}>
                <span>{VIEW_META[v].icon}</span>
                <span>{VIEW_META[v].label}</span>
              </button>
            ))}
          </div>

          {/* Drill-down selectors */}
          <div style={{ flex: 1, overflow: "auto", padding: "12px" }}>

            {/* Week start */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Week Starts</div>
              <div style={{ display: "flex", gap: 4 }}>
                <button style={S.selBtn(weekStart === 1)} onClick={() => setWeekStart(1)}>Mon</button>
                <button style={S.selBtn(weekStart === 0)} onClick={() => setWeekStart(0)}>Sun</button>
              </div>
            </div>

            {/* Interval size */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Interval</div>
              <div style={{ display: "flex", gap: 4 }}>
                {([15, 30, 60] as const).map(s => (
                  <button key={s} style={S.selBtn(intervalSize === s)} onClick={() => setIntervalSize(s)}>
                    {s === 60 ? "1hr" : `${s}m`}
                  </button>
                ))}
              </div>
            </div>

            {/* Year */}
            {years.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Year</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {years.map(yr => (
                    <button key={yr} style={S.selBtn(selYear === yr)} onClick={() => { setSelYear(yr); setSelMonth(null); setSelWeek(null); setSelDay(null); }}>
                      {yr}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Month (shown for monthly/daily/intraday views) */}
            {selYear && ["monthly","daily","intraday"].includes(view) && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Month</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  <button style={S.selBtn(selMonth === null)} onClick={() => { setSelMonth(null); setSelWeek(null); setSelDay(null); }}>All</button>
                  {monthsForYear(selYear).map(mi => (
                    <button key={mi} style={S.selBtn(selMonth === mi)} onClick={() => { setSelMonth(mi); setSelWeek(null); setSelDay(null); }}>
                      {MONTHS[mi]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Week (shown for weekly/daily/intraday views) */}
            {selYear && ["weekly","daily","intraday"].includes(view) && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Week</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 120, overflow: "auto" }}>
                  <button style={S.selBtn(selWeek === null)} onClick={() => { setSelWeek(null); setSelDay(null); }}>All</button>
                  {weeksForYear(selYear).map(wk => (
                    <button key={wk} style={S.selBtn(selWeek === wk)} onClick={() => { setSelWeek(wk); setSelMonth(null); setSelDay(null); }}>
                      W{String(wk).padStart(2,"0")}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Day (shown for intraday view) */}
            {selYear && view === "intraday" && (selMonth !== null || selWeek !== null) && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Day</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 140, overflow: "auto" }}>
                  <button style={S.selBtn(selDay === null)} onClick={() => setSelDay(null)}>All</button>
                  {(selMonth !== null
                    ? daysForMonthYear(selYear, selMonth)
                    : selWeek !== null ? daysForWeekYear(selYear, selWeek) : []
                  ).map(ds => {
                    const d = new Date(ds + "T00:00:00");
                    return (
                      <button key={ds} style={S.selBtn(selDay === ds)} onClick={() => setSelDay(ds)}>
                        {DOW_LABELS[d.getDay()]} {d.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "20px 28px" }}>

          {/* Top bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexShrink: 0, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827" }}>
                {VIEW_META[view].icon} {VIEW_META[view].label}
                {selYear && view !== "yoy" && view !== "distribution" && <span style={{ fontSize: 14, fontWeight: 400, color: "#9ca3af", marginLeft: 8 }}>{selYear}{selMonth !== null ? ` › ${MONTHS_FULL[selMonth]}` : ""}{selWeek !== null ? ` › W${String(selWeek).padStart(2,"0")}` : ""}{selDay ? ` › ${selDay}` : ""}</span>}
              </h2>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{VIEW_META[view].desc}</p>
            </div>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              {/* Layout toggle */}
              <div style={{ display: "flex", gap: 2, background: "#f3f4f6", borderRadius: 8, padding: 3 }}>
                <button
                  style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", background: layout === "periods-as-rows" ? "#fff" : "transparent", color: layout === "periods-as-rows" ? "#111827" : "#6b7280", boxShadow: layout === "periods-as-rows" ? "0 1px 3px rgba(0,0,0,.1)" : "none" }}
                  onClick={() => setLayout("periods-as-rows")} title="Periods as rows">
                  ☰ Rows
                </button>
                <button
                  style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", background: layout === "periods-as-cols" ? "#fff" : "transparent", color: layout === "periods-as-cols" ? "#111827" : "#6b7280", boxShadow: layout === "periods-as-cols" ? "0 1px 3px rgba(0,0,0,.1)" : "none" }}
                  onClick={() => setLayout("periods-as-cols")} title="Periods as columns">
                  ⊞ Cols
                </button>
              </div>

              {/* Copy */}
              <button
                onClick={() => { copyTSV(tableData.headers, tableData.rows); setCopyDone(true); setTimeout(() => setCopyDone(false), 2000); }}
                style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid #6366f1", background: "#eef2ff", color: "#6366f1" }}>
                {copyDone ? "✓ Copied!" : "📋 Copy"}
              </button>

              {/* Download CSV */}
              <button
                onClick={() => exportCSV(tableData.headers, tableData.rows, `arrival-${view}-${selYear || "all"}.csv`)}
                style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid #f97316", background: "#fff7ed", color: "#f97316" }}>
                ⬇ CSV
              </button>
            </div>
          </div>

          {/* Table */}
          <div style={{ flex: 1, overflow: "auto", ...S.card, borderRadius: 10 }}>
            {renderTable()}
          </div>

        </div>
      </div>
    </div>
  );
}
