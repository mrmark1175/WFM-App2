import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiUrl } from "../lib/api";
import { useLOB } from "../lib/lobContext";
import { usePagePreferences } from "../lib/usePagePreferences";

// ── Types ─────────────────────────────────────────────────────────────────────
interface CellData { volume: number; aht: number; }
type GridData = Record<string, Record<number, CellData>>;
interface IntervalRow { label: string; indices: number[]; }
type ChannelKey = "voice" | "chat" | "email" | "cases";

// ── Constants ─────────────────────────────────────────────────────────────────
const SLOT_COUNT = 96;
const ROW_H      = 28;
const COL_W      = 96;
const LABEL_W    = 88;
const HDR_H      = 48;
const OVERSCAN   = 4;

const DOW_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DOW_FULL   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

const TELEPHONY_SYSTEMS = [
  { id: "genesys", label: "Genesys Cloud", icon: "☁️" },
  { id: "avaya",   label: "Avaya",          icon: "📞" },
  { id: "iex",     label: "NICE IEX",       icon: "📊" },
  { id: "five9",   label: "Five9",          icon: "5️⃣" },
  { id: "nice",    label: "NICE CXone",     icon: "🎯" },
  { id: "cisco",   label: "Cisco UCCE",     icon: "🔧" },
  { id: "custom",  label: "Custom API",     icon: "⚙️" },
];

const CHANNEL_OPTIONS: { value: ChannelKey; label: string }[] = [
  { value: "voice", label: "Voice" },
  { value: "chat", label: "Chat" },
  { value: "email", label: "Email" },
  { value: "cases", label: "Cases" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtSlot(slotIdx: number): string {
  const mins = slotIdx * 15;
  const h    = Math.floor(mins / 60);
  const m    = mins % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function makeIntervals(size: 15 | 30 | 60): IntervalRow[] {
  const step = size / 15;
  const rows: IntervalRow[] = [];
  for (let i = 0; i < SLOT_COUNT; i += step)
    rows.push({ label: fmtSlot(i), indices: Array.from({ length: step }, (_, j) => i + j) });
  return rows;
}

function makeDateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(start + "T00:00:00");
  const e = new Date(end   + "T00:00:00");
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return [start];
  const cur = new Date(s);
  while (cur <= e) { out.push(cur.toISOString().split("T")[0]); cur.setDate(cur.getDate() + 1); }
  return out;
}

function fmtHdr(dateStr: string): { dow: string; mmd: string } {
  const d = new Date(dateStr + "T00:00:00");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return { dow: DOW_LABELS[d.getDay()], mmd: `${months[d.getMonth()]} ${d.getDate()}` };
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + "T00:00:00").getDay();
  return day === 0 || day === 6;
}

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().split("T")[0];
}

function getCellValue(data: GridData, dateStr: string, indices: number[], tab: "volume" | "aht"): number {
  const d = data[dateStr] || {};
  if (tab === "volume") return indices.reduce((s, i) => s + (d[i]?.volume || 0), 0);
  const vals = indices.map(i => d[i]?.aht || 0).filter(v => v > 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}

function todayStr(): string { return new Date().toISOString().split("T")[0]; }

function lastMonday(): string {
  const d = new Date(); const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split("T")[0];
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// heat-map colour: white → orange
function pctColor(pct: number, max: number): string {
  if (max === 0 || pct === 0) return "transparent";
  const t = Math.min(pct / max, 1);
  const r = Math.round(255);
  const g = Math.round(255 - t * (255 - 115));
  const b = Math.round(255 - t * 255);
  return `rgba(${r},${g},${b},${0.18 + t * 0.55})`;
}

// ── Memoized Cell ─────────────────────────────────────────────────────────────
interface CellProps {
  rowIdx: number; colIdx: number; val: number;
  isAnchor: boolean; isHour: boolean; today: boolean; weekend: boolean;
  activeTab: "volume" | "aht";
  onFocus: (row: number, col: number) => void;
  onChange: (row: number, col: number, val: number) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => void;
}
const GridCell = React.memo(({ rowIdx, colIdx, val, isAnchor, isHour, today, weekend, activeTab, onFocus, onChange, onKeyDown }: CellProps) => (
  <td style={{
    padding: 0, height: ROW_H,
    border: `1px solid ${isHour ? "#e5e7eb" : "#f3f4f6"}`,
    background: isAnchor ? "#fff7ed" : today ? "#fffbf5" : weekend ? "#fafaf9" : undefined,
    outline: isAnchor ? "2px solid #f97316" : undefined,
    outlineOffset: isAnchor ? -2 : undefined,
    position: "relative",
  }}>
    <input
      id={`cell-${rowIdx}-${colIdx}`}
      type="text"
      value={val === 0 ? "" : String(val)}
      placeholder=""
      onFocus={() => onFocus(rowIdx, colIdx)}
      onChange={e => { const n = parseFloat(e.target.value.replace(/,/g, "")) || 0; onChange(rowIdx, colIdx, n); }}
      onKeyDown={e => onKeyDown(e, rowIdx, colIdx)}
      style={{
        display: "block", width: "100%", height: "100%",
        border: "none", outline: "none", padding: "0 8px", fontSize: 12,
        fontWeight: val > 0 ? 600 : 400,
        color: val > 0 ? (activeTab === "volume" ? "#111827" : "#6366f1") : "#e5e7eb",
        background: "transparent", textAlign: "right",
        cursor: "cell", boxSizing: "border-box", fontVariantNumeric: "tabular-nums",
      }}
    />
  </td>
), (prev, next) =>
  prev.val === next.val && prev.isAnchor === next.isAnchor && prev.activeTab === next.activeTab
);

// ── Distribution Tab ──────────────────────────────────────────────────────────
// Computes: for each (year, dow, intervalIdx) → avg % of that slot vs day total
// Rows = 96 intervals, Cols = 7 days × N years
interface DistProps { data: GridData; intervalSize: 15 | 30 | 60; }

function DistributionTab({ data, intervalSize }: DistProps) {
  const intervals = useMemo(() => makeIntervals(intervalSize), [intervalSize]);

  // ── Which years are present in data ──────────────────────────────────────────
  const years = useMemo(() => {
    const ys = new Set<number>();
    Object.keys(data).forEach(ds => ys.add(new Date(ds + "T00:00:00").getFullYear()));
    return Array.from(ys).sort();
  }, [data]);

  // ── Selected DoW filter (0=all, 1=Mon…7=Sun mapped to JS 1,2,3,4,5,6,0) ────
  const [selDow, setSelDow] = useState<number | null>(null); // null = show all

  // ── Build profile: profile[year][dow][intervalIdx] = avg % ───────────────────
  // For each date in data: compute daily total → each slot pct → accumulate by (year,dow,slot)
  const profile = useMemo(() => {
    // profile[year][dow 0-6][slotIdx 0-95] = { sum, count }
    const acc: Record<number, Record<number, Record<number, { sum: number; count: number }>>> = {};

    Object.entries(data).forEach(([ds, slots]) => {
      const d   = new Date(ds + "T00:00:00");
      const yr  = d.getFullYear();
      const dow = d.getDay(); // 0=Sun…6=Sat

      // day total volume
      const dayTotal = Object.values(slots).reduce((s, c) => s + (c.volume || 0), 0);
      if (dayTotal === 0) return;

      if (!acc[yr]) acc[yr] = {};
      if (!acc[yr][dow]) acc[yr][dow] = {};

      // accumulate each slot's % contribution to that day
      for (let si = 0; si < SLOT_COUNT; si++) {
        const vol = slots[si]?.volume || 0;
        const pct = (vol / dayTotal) * 100;
        if (!acc[yr][dow][si]) acc[yr][dow][si] = { sum: 0, count: 0 };
        acc[yr][dow][si].sum   += pct;
        acc[yr][dow][si].count += 1;
      }
    });

    // Convert to averages
    const result: Record<number, Record<number, Record<number, number>>> = {};
    Object.entries(acc).forEach(([yr, dows]) => {
      result[Number(yr)] = {};
      Object.entries(dows).forEach(([dow, slots]) => {
        result[Number(yr)][Number(dow)] = {};
        Object.entries(slots).forEach(([si, { sum, count }]) => {
          result[Number(yr)][Number(dow)][Number(si)] = count > 0 ? sum / count : 0;
        });
      });
    });
    return result;
  }, [data]);

  // ── Max pct across all cells for heatmap scaling ──────────────────────────────
  const maxPct = useMemo(() => {
    let m = 0;
    Object.values(profile).forEach(dows =>
      Object.values(dows).forEach(slots =>
        Object.values(slots).forEach(v => { if (v > m) m = v; })
      )
    );
    return m;
  }, [profile]);

  // ── Days to show (filtered by selDow) ────────────────────────────────────────
  // JS: 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat — show Mon-Sun order
  const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon first
  const visibleDows = selDow !== null ? [selDow] : DOW_ORDER;

  // ── Column headers: one group per year, one col per DoW ──────────────────────
  // total cols = years.length × visibleDows.length
  const DIST_COL_W = 72;
  const DIST_LABEL_W = 88;

  // ── Scroll for dist table ────────────────────────────────────────────────────
  const distScrollRef = useRef<HTMLDivElement>(null);
  const [distScrollTop, setDistScrollTop]   = useState(0);
  const [distVpHeight,  setDistVpHeight]    = useState(500);
  const visDistRowStart = Math.max(0, Math.floor(distScrollTop / ROW_H) - OVERSCAN);
  const visDistRowEnd   = Math.min(intervals.length - 1, Math.ceil((distScrollTop + distVpHeight) / ROW_H) + OVERSCAN);

  useEffect(() => {
    const el = distScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDistVpHeight(el.clientHeight));
    ro.observe(el);
    setDistVpHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const totalDistRowH = intervals.length * ROW_H;
  const totalDistColW = years.length * visibleDows.length * DIST_COL_W;

  if (years.length === 0) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 14 }}>
      No data loaded yet — set a date range and the distribution will appear here.
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, gap: 10 }}>

      {/* ── Info bar + DoW filter ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          Each cell = avg % of that interval's volume vs its day total · grouped by day-of-week · per year
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>Filter DoW:</span>
          <button
            onClick={() => setSelDow(null)}
            style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: "1px solid", cursor: "pointer",
              borderColor: selDow === null ? "#f97316" : "#e5e7eb",
              background: selDow === null ? "#fff7ed" : "#fff",
              color: selDow === null ? "#f97316" : "#6b7280" }}>
            All
          </button>
          {DOW_ORDER.map(d => (
            <button key={d} onClick={() => setSelDow(selDow === d ? null : d)}
              style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: "1px solid", cursor: "pointer",
                borderColor: selDow === d ? "#f97316" : "#e5e7eb",
                background: selDow === d ? "#fff7ed" : "#fff",
                color: selDow === d ? "#f97316" : "#6b7280" }}>
              {DOW_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Distribution table ── */}
      <div style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", minHeight: 0, background: "#fff" }}>
        <div
          ref={distScrollRef}
          onScroll={() => { const el = distScrollRef.current; if (el) setDistScrollTop(el.scrollTop); }}
          style={{ width: "100%", height: "100%", overflow: "auto" }}
        >
          <div style={{ position: "relative", width: DIST_LABEL_W + totalDistColW, height: HDR_H + 24 + totalDistRowH + ROW_H }}>

            {/* ── Double sticky header: year row + DoW row ── */}
            <div style={{ position: "sticky", top: 0, left: 0, zIndex: 6, background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>

              {/* Year group row */}
              <div style={{ display: "flex" }}>
                <div style={{
                  position: "sticky", left: 0, zIndex: 7, flexShrink: 0,
                  width: DIST_LABEL_W, minWidth: DIST_LABEL_W,
                  background: "#f1f5f9", borderRight: "2px solid #e5e7eb",
                  padding: "4px 10px", fontSize: 10, fontWeight: 700, color: "#6b7280",
                  textTransform: "uppercase", letterSpacing: ".06em",
                  display: "flex", alignItems: "center",
                }}>
                  {intervalSize === 15 ? "15 MIN" : intervalSize === 30 ? "30 MIN" : "HOURLY"}
                </div>
                {years.map(yr => (
                  <div key={yr} style={{
                    width: visibleDows.length * DIST_COL_W, flexShrink: 0,
                    background: "#f8fafc", borderLeft: "2px solid #e5e7eb",
                    padding: "4px 8px", fontSize: 12, fontWeight: 700, color: "#111827",
                    textAlign: "center", borderBottom: "1px solid #e5e7eb",
                  }}>
                    {yr}
                  </div>
                ))}
              </div>

              {/* DoW sub-header row */}
              <div style={{ display: "flex" }}>
                <div style={{
                  position: "sticky", left: 0, zIndex: 7, flexShrink: 0,
                  width: DIST_LABEL_W, minWidth: DIST_LABEL_W,
                  background: "#f1f5f9", borderRight: "2px solid #e5e7eb",
                  padding: "3px 10px", fontSize: 9, fontWeight: 700, color: "#9ca3af",
                  textTransform: "uppercase", display: "flex", alignItems: "center",
                }}>
                  % of Day
                </div>
                {years.map(yr =>
                  visibleDows.map(dow => (
                    <div key={`${yr}-${dow}`} style={{
                      width: DIST_COL_W, minWidth: DIST_COL_W, flexShrink: 0,
                      borderLeft: dow === visibleDows[0] ? "2px solid #e5e7eb" : "1px solid #f3f4f6",
                      padding: "3px 4px", fontSize: 10, fontWeight: 700,
                      color: dow === 0 || dow === 6 ? "#9ca3af" : "#374151",
                      textAlign: "center", background: dow === 0 || dow === 6 ? "#fafaf9" : "#f8fafc",
                    }}>
                      {DOW_FULL[dow].slice(0, 3)}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ── Visible interval rows ── */}
            <div style={{ position: "absolute", top: HDR_H + 24 + visDistRowStart * ROW_H, left: 0, width: DIST_LABEL_W + totalDistColW }}>
              {intervals.slice(visDistRowStart, visDistRowEnd + 1).map((interval, vi) => {
                const rowIdx = visDistRowStart + vi;
                const isHour = interval.indices[0] % 4 === 0;
                return (
                  <div key={rowIdx} style={{ display: "flex", height: ROW_H, background: isHour ? "#fafafa" : "#fff" }}>
                    {/* Time label */}
                    <div style={{
                      position: "sticky", left: 0, zIndex: 1, flexShrink: 0,
                      width: DIST_LABEL_W, minWidth: DIST_LABEL_W,
                      background: isHour ? "#f1f5f9" : "#f8fafc",
                      borderRight: "2px solid #e5e7eb",
                      borderBottom: `1px solid ${isHour ? "#e5e7eb" : "#f3f4f6"}`,
                      padding: "0 10px", fontSize: 11,
                      fontWeight: isHour ? 700 : 400,
                      color: isHour ? "#374151" : "#9ca3af",
                      whiteSpace: "nowrap", display: "flex", alignItems: "center",
                    }}>
                      {interval.label}
                    </div>

                    {/* Data cells */}
                    {years.map(yr =>
                      visibleDows.map(dow => {
                        // average the pct across all slots in this interval row
                        const pcts = interval.indices.map(si => profile[yr]?.[dow]?.[si] ?? 0);
                        const pct  = pcts.reduce((a, b) => a + b, 0); // sum (not avg) so 96 rows sum to ~100%
                        const isFirst = dow === visibleDows[0];
                        const isWknd  = dow === 0 || dow === 6;
                        return (
                          <div key={`${yr}-${dow}`} style={{
                            width: DIST_COL_W, minWidth: DIST_COL_W, flexShrink: 0,
                            borderLeft: isFirst ? "2px solid #e5e7eb" : "1px solid #f3f4f6",
                            borderBottom: `1px solid ${isHour ? "#e5e7eb" : "#f3f4f6"}`,
                            background: pct > 0 ? pctColor(pct, maxPct) : (isWknd ? "#fafaf9" : undefined),
                            display: "flex", alignItems: "center", justifyContent: "flex-end",
                            padding: "0 7px", fontSize: 11,
                            fontWeight: pct > 0 ? 600 : 400,
                            color: pct > 0 ? "#111827" : "#d1d5db",
                            fontVariantNumeric: "tabular-nums",
                          }}>
                            {pct > 0 ? `${pct.toFixed(2)}%` : "—"}
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Sticky totals row (should sum to ~100% per DoW per year) ── */}
            <div style={{
              position: "sticky", bottom: 0, left: 0, zIndex: 4,
              display: "flex", width: DIST_LABEL_W + totalDistColW,
              background: "#f8fafc", borderTop: "2px solid #e5e7eb",
            }}>
              <div style={{
                position: "sticky", left: 0, zIndex: 5, flexShrink: 0,
                width: DIST_LABEL_W, minWidth: DIST_LABEL_W,
                background: "#f1f5f9", borderRight: "2px solid #e5e7eb",
                padding: "6px 10px", fontSize: 10, fontWeight: 700, color: "#374151",
                textTransform: "uppercase", letterSpacing: ".04em",
                display: "flex", alignItems: "center",
              }}>
                Total
              </div>
              {years.map(yr =>
                visibleDows.map(dow => {
                  const total = intervals.reduce((sum, interval) => {
                    const pcts = interval.indices.map(si => profile[yr]?.[dow]?.[si] ?? 0);
                    return sum + pcts.reduce((a, b) => a + b, 0);
                  }, 0);
                  const isFirst = dow === visibleDows[0];
                  return (
                    <div key={`${yr}-${dow}`} style={{
                      width: DIST_COL_W, minWidth: DIST_COL_W, flexShrink: 0,
                      borderLeft: isFirst ? "2px solid #e5e7eb" : "1px solid #f3f4f6",
                      padding: "6px 7px", textAlign: "right", fontSize: 11, fontWeight: 700,
                      color: total > 0 ? "#f97316" : "#d1d5db",
                    }}>
                      {total > 0 ? `${total.toFixed(1)}%` : "—"}
                    </div>
                  );
                })
              )}
            </div>

          </div>
        </div>
      </div>

      {/* ── Legend ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, fontSize: 11, color: "#9ca3af" }}>
        <span>Heat map intensity:</span>
        {[0.1, 0.3, 0.6, 1.0].map(t => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <div style={{ width: 16, height: 16, borderRadius: 3, background: pctColor(t * maxPct, maxPct), border: "1px solid #e5e7eb" }} />
            <span>{(t * maxPct).toFixed(2)}%</span>
          </div>
        ))}
        <span style={{ marginLeft: 8 }}>· Totals should sum to ~100% per column (minor rounding variance)</span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function InteractionArrival() {
  const navigate = useNavigate();
  const { activeLob } = useLOB();

  // ── Persisted preferences (per LOB) ─────────────────────────────────────────
  const [prefs, setPrefs] = usePagePreferences("interaction_arrival", {
    selectedChannel: "voice" as ChannelKey,
    startDate: lastMonday(),
    endDate: addDays(lastMonday(), 6),
    activeTab: "volume" as "volume" | "aht" | "distribution",
    intervalSize: 15 as 15 | 30 | 60,
    telephonySystem: "genesys",
  });

  // ── Core state ───────────────────────────────────────────────────────────────
  const selectedChannel = prefs.selectedChannel;
  const activeTab       = prefs.activeTab;
  const intervalSize    = prefs.intervalSize;
  const startDate       = prefs.startDate;
  const endDate         = prefs.endDate;
  const telephonySystem = prefs.telephonySystem;

  const [data,         setData]         = useState<GridData>({});
  const [anchorCell,   setAnchorCell]   = useState<{ row: number; col: number } | null>(null);

  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [isLoading,  setIsLoading]  = useState(false);

  const [showModal,       setShowModal]       = useState(false);
  const [pullDate,        setPullDate]        = useState(todayStr());
  const [pullQueue,       setPullQueue]       = useState("");
  const [isPulling,       setIsPulling]       = useState(false);
  const [pullMsg,         setPullMsg]         = useState<{ ok: boolean; text: string } | null>(null);

  const scrollRef  = useRef<HTMLDivElement>(null);
  const [scrollTop,  setScrollTop]  = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [vpHeight,   setVpHeight]   = useState(600);
  const [vpWidth,    setVpWidth]    = useState(1200);

  const intervals = useMemo(() => makeIntervals(intervalSize), [intervalSize]);
  const dates     = useMemo(() => makeDateRange(startDate, endDate), [startDate, endDate]);

  const visRowStart = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const visRowEnd   = Math.min(intervals.length - 1, Math.ceil((scrollTop + vpHeight) / ROW_H) + OVERSCAN);
  const visColStart = Math.max(0, Math.floor(scrollLeft / COL_W) - OVERSCAN);
  const visColEnd   = Math.min(dates.length - 1, Math.ceil((scrollLeft + vpWidth - LABEL_W) / COL_W) + OVERSCAN);
  const totalRowH   = intervals.length * ROW_H;
  const totalColW   = dates.length * COL_W;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { setVpHeight(el.clientHeight); setVpWidth(el.clientWidth); });
    ro.observe(el);
    setVpHeight(el.clientHeight); setVpWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop); setScrollLeft(el.scrollLeft);
  }, []);

  const handleStartDateChange = (val: string) => {
    setPrefs({ startDate: val, ...(val > endDate ? { endDate: addDays(val, 6) } : {}) });
  };
  const handleEndDateChange = (val: string) => {
    setPrefs({ endDate: val, ...(val < startDate ? { startDate: val } : {}) });
  };

  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dates.length || !activeLob) return;
    if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
    fetchDebounceRef.current = setTimeout(() => {
      setIsLoading(true);
      fetch(apiUrl(`/api/interaction-arrival?startDate=${startDate}&endDate=${endDate}&channel=${selectedChannel}&lob_id=${activeLob.id}`))
        .then(r => r.json())
        .then((records: any[]) => {
          if (!Array.isArray(records)) return;
          const newData: GridData = {};
          records.forEach(r => {
            const ds = (r.interval_date as string).split("T")[0];
            if (!newData[ds]) newData[ds] = {};
            newData[ds][r.interval_index] = { volume: r.volume || 0, aht: r.aht || 0 };
          });
          setData(newData);
        })
        .catch(() => {})
        .finally(() => setIsLoading(false));
    }, 400);
    return () => { if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current); };
  }, [startDate, endDate, selectedChannel, activeLob?.id]);

  const handleGridPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!anchorCell) return;
    e.preventDefault();
    const text   = e.clipboardData.getData("text/plain");
    const rows   = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(r => r.trim());
    const parsed = rows.map(r => r.split("\t"));
    setData(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as GridData;
      parsed.forEach((rowVals, ri) => {
        const rowIdx = anchorCell.row + ri;
        if (rowIdx >= intervals.length) return;
        rowVals.forEach((val, ci) => {
          const colIdx = anchorCell.col + ci;
          if (colIdx >= dates.length) return;
          const ds  = dates[colIdx];
          const num = parseFloat(val.replace(/[,\s$]/g, "")) || 0;
          if (!next[ds]) next[ds] = {};
          intervals[rowIdx].indices.forEach(idx => {
            if (!next[ds][idx]) next[ds][idx] = { volume: 0, aht: 0 };
            if (activeTab === "volume") next[ds][idx].volume = Math.round(num / intervals[rowIdx].indices.length);
            else                        next[ds][idx].aht    = num;
          });
        });
      });
      return next;
    });
  }, [anchorCell, intervals, dates, activeTab]);

  const updateCell = useCallback((rowIdx: number, colIdx: number, val: number) => {
    const ds = dates[colIdx]; const slotIndices = intervals[rowIdx].indices;
    setData(prev => {
      const next = { ...prev, [ds]: { ...(prev[ds] || {}) } };
      slotIndices.forEach(idx => {
        next[ds][idx] = {
          volume: activeTab === "volume" ? Math.round(val / slotIndices.length) : (next[ds][idx]?.volume || 0),
          aht:    activeTab === "aht"    ? val : (next[ds][idx]?.aht || 0),
        };
      });
      return next;
    });
  }, [dates, intervals, activeTab]);

  const handleCellFocus  = useCallback((row: number, col: number) => setAnchorCell({ row, col }), []);
  const handleCellChange = useCallback((row: number, col: number, val: number) => updateCell(row, col, val), [updateCell]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      (document.getElementById(`cell-${Math.min(row + 1, intervals.length - 1)}-${col}`) as HTMLInputElement)?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      (document.getElementById(`cell-${Math.max(row - 1, 0)}-${col}`) as HTMLInputElement)?.focus();
    } else if (e.key === "Escape") { setAnchorCell(null); (e.target as HTMLInputElement).blur(); }
  }, [intervals.length]);

  const handleSave = async () => {
    setSaveStatus("saving");
    const records: any[] = [];
    Object.entries(data).forEach(([ds, dd]) =>
      Object.entries(dd).forEach(([idx, cell]) =>
        records.push({ interval_date: ds, interval_index: Number(idx), volume: cell.volume, aht: cell.aht })
      )
    );
    if (!records.length) { setSaveStatus("saved"); setTimeout(() => setSaveStatus(""), 2000); return; }
    try {
      const CHUNK_SIZE = 2000;
      for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE);
        const res = await fetch(apiUrl("/api/interaction-arrival"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: selectedChannel, lob_id: activeLob?.id, records: chunk }),
        });
        if (!res.ok) { setSaveStatus("error"); return; }
      }
      setSaveStatus("saved"); setTimeout(() => setSaveStatus(""), 2500);
    } catch { setSaveStatus("error"); }
  };

  const handlePull = async () => {
    setIsPulling(true); setPullMsg(null);
    try {
      const res = await fetch(apiUrl("/api/telephony/pull"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: telephonySystem, date: pullDate, queue: pullQueue, channel: selectedChannel }),
      });
      const result = await res.json();
      if (result.success && result.data) {
        setData(prev => {
          const next = { ...prev, [pullDate]: { ...(prev[pullDate] || {}) } };
          (result.data as any[]).forEach(r => { next[pullDate][r.interval_index] = { volume: r.volume || 0, aht: r.aht || 0 }; });
          return next;
        });
        setPullMsg({ ok: true, text: `✓ ${pullDate} pulled successfully` });
        setTimeout(() => { setShowModal(false); setPullMsg(null); }, 1500);
      } else { setPullMsg({ ok: false, text: result.message || "Pull failed" }); }
    } catch { setPullMsg({ ok: false, text: "Could not connect to server" }); }
    setIsPulling(false);
  };

  const colTotals = useMemo(() => dates.map(ds => {
    const cells = Object.values(data[ds] || {});
    const vol   = cells.reduce((s, c) => s + c.volume, 0);
    const ahts  = cells.map(c => c.aht).filter(v => v > 0);
    const aht   = ahts.length ? Math.round(ahts.reduce((a, b) => a + b, 0) / ahts.length) : 0;
    return { vol, aht };
  }), [data, dates]);

  const clearDay = (ds: string) => {
    if (!confirm(`Clear all data for ${ds}?`)) return;
    setData(prev => { const n = { ...prev }; delete n[ds]; return n; });
  };

  const S = {
    page:   { fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: "#f9fafb", minHeight: "100vh" } as React.CSSProperties,
    header: { background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" } as React.CSSProperties,
    body:   { maxWidth: 1500, margin: "0 auto", padding: "28px 32px", display: "flex", flexDirection: "column" as const, height: "calc(100vh - 56px)", boxSizing: "border-box" as const },
    card:   { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12 } as React.CSSProperties,
    tab: (a: boolean): React.CSSProperties => ({
      padding: "5px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
      background: a ? "#fff" : "transparent", color: a ? "#111827" : "#6b7280",
      boxShadow: a ? "0 1px 3px rgba(0,0,0,.1)" : "none",
    }),
    intBtn: (a: boolean): React.CSSProperties => ({
      padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
      background: a ? "#f97316" : "transparent", color: a ? "#fff" : "#6b7280",
    }),
    sysBtn: (a: boolean): React.CSSProperties => ({
      padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid",
      borderColor: a ? "#f97316" : "#e5e7eb", background: a ? "#fff7ed" : "#fff", color: a ? "#f97316" : "#374151",
    }),
  };

  const visibleIntervals = intervals.slice(visRowStart, visRowEnd + 1);
  const visibleDates     = dates.slice(visColStart, visColEnd + 1);

  const isGridTab = activeTab === "volume" || activeTab === "aht";

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
            onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>
            Workforce Management
          </Link>
          <span style={{ color: "#d1d5db" }}>›</span>
          <span style={{ fontSize: 13, color: "#f97316", fontWeight: 600 }}>Interaction Arrival</span>
        </nav>
        <button onClick={() => navigate("/")} style={{ fontSize: 13, color: "#6b7280", background: "none", border: "none", cursor: "pointer" }}>🏠 Home</button>
      </div>

      <div style={S.body}>

        {/* ── Page title ── */}
        <div style={{ marginBottom: 16, flexShrink: 0 }}>
          <button onClick={() => navigate("/wfm")}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: "4px 0", marginBottom: 6 }}
            onMouseEnter={e => (e.currentTarget.style.color = "#f97316")}
            onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>
            ← Back to Workforce Management
          </button>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "#111827", margin: 0 }}>Interaction Arrival</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6b7280" }}>
            Intraday volume & AHT by interval · Copy-paste from Excel · Pull from telephony
          </p>
        </div>

        {/* ── Controls bar ── */}
        <div style={{ ...S.card, padding: "12px 20px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flexShrink: 0 }}>

          {/* ── Tabs: Volume / AHT / Distribution ── */}
          <div style={{ display: "flex", gap: 2, background: "#f3f4f6", borderRadius: 8, padding: 3 }}>
            <button style={S.tab(activeTab === "volume")}       onClick={() => setPrefs({ activeTab: "volume" })}>📞 Interaction Volume</button>
            <button style={S.tab(activeTab === "aht")}          onClick={() => setPrefs({ activeTab: "aht" })}>⏱ AHT</button>
            <button style={S.tab(activeTab === "distribution")} onClick={() => setPrefs({ activeTab: "distribution" })}>📊 Distribution</button>
          </div>

          <div style={{ width: 1, height: 24, background: "#e5e7eb" }} />

          {/* Interval — shown for all tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>Interval:</span>
            <div style={{ display: "flex", gap: 2, background: "#f3f4f6", borderRadius: 8, padding: 3 }}>
              {([15, 30, 60] as const).map(s => (
                <button key={s} style={S.intBtn(intervalSize === s)} onClick={() => setPrefs({ intervalSize: s })}>
                  {s === 60 ? "1 hr" : `${s} min`}
                </button>
              ))}
            </div>
          </div>

          <div style={{ width: 1, height: 24, background: "#e5e7eb" }} />

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>Channel:</span>
            <select
              value={selectedChannel}
              onChange={e => setPrefs({ selectedChannel: e.target.value as ChannelKey })}
              style={{ fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", color: "#111827", background: "#fff", cursor: "pointer" }}
            >
              {CHANNEL_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div style={{ width: 1, height: 24, background: "#e5e7eb" }} />

          {/* Date range */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>From:</span>
            <input type="date" value={startDate} onChange={e => handleStartDateChange(e.target.value)}
              style={{ fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", color: "#111827", background: "#fff", cursor: "pointer" }} />
            <span style={{ fontSize: 12, color: "#9ca3af" }}>—</span>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>To:</span>
            <input type="date" value={endDate} min={startDate} onChange={e => handleEndDateChange(e.target.value)}
              style={{ fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", color: "#111827", background: "#fff", cursor: "pointer" }} />
            <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500 }}>
              ({dates.length} day{dates.length !== 1 ? "s" : ""})
            </span>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {isLoading && <span style={{ fontSize: 12, color: "#9ca3af" }}>Loading…</span>}
            {isGridTab && (
              <>
                <button onClick={() => setShowModal(true)} style={{
                  padding: "6px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  border: "1px solid #6366f1", background: "#eef2ff", color: "#6366f1",
                }}>📡 Pull from Telephony</button>
                {saveStatus === "saving" && <span style={{ fontSize: 12, color: "#9ca3af" }}>💾 Saving…</span>}
                {saveStatus === "saved"  && <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>✓ Saved</span>}
                {saveStatus === "error"  && <span style={{ fontSize: 12, color: "#dc2626" }}>✕ Error saving</span>}
                <button onClick={handleSave}
                  style={{ padding: "6px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid #f97316", background: "#fff7ed", color: "#f97316" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#f97316"; e.currentTarget.style.color = "#fff"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#fff7ed"; e.currentTarget.style.color = "#f97316"; }}>
                  💾 Save
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Distribution tab content ── */}
        {activeTab === "distribution" && (
          <DistributionTab data={data} intervalSize={intervalSize} />
        )}

        {/* ── Grid tabs content ── */}
        {isGridTab && (
          <>
            {/* Paste hint */}
            <div style={{ fontSize: 12, marginBottom: 8, flexShrink: 0 }}>
              {anchorCell ? (
                <span style={{ color: "#f97316", fontWeight: 600, background: "#fff7ed", padding: "3px 10px", borderRadius: 6, border: "1px solid #fed7aa" }}>
                  📋 Row {anchorCell.row + 1}, {dates[anchorCell.col]} selected — press Ctrl+V / Cmd+V to paste from Excel
                </span>
              ) : (
                <span style={{ color: "#9ca3af" }}>💡 Click any cell to select, then paste (Ctrl+V) to fill from Excel</span>
              )}
            </div>

            {/* Virtualized grid */}
            <div style={{ ...S.card, flex: 1, overflow: "hidden", minHeight: 0 }}>
              <div ref={scrollRef} onScroll={handleScroll} onPaste={handleGridPaste}
                style={{ width: "100%", height: "100%", overflow: "auto" }}>
                <div style={{ position: "relative", width: LABEL_W + totalColW, height: HDR_H + totalRowH + ROW_H }}>

                  {/* Sticky header */}
                  <div style={{ position: "sticky", top: 0, left: 0, zIndex: 4, display: "flex", width: LABEL_W + totalColW, background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                    <div style={{ position: "sticky", left: 0, zIndex: 5, flexShrink: 0, width: LABEL_W, minWidth: LABEL_W, background: "#f1f5f9", borderRight: "2px solid #e5e7eb", padding: "8px 10px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".06em", display: "flex", alignItems: "center" }}>
                      {intervalSize === 15 ? "15 MIN" : intervalSize === 30 ? "30 MIN" : "HOURLY"}
                    </div>
                    {visColStart > 0 && <div style={{ width: visColStart * COL_W, flexShrink: 0 }} />}
                    {visibleDates.map(ds => {
                      const { dow, mmd } = fmtHdr(ds);
                      const today = isToday(ds); const weekend = isWeekend(ds);
                      return (
                        <div key={ds} style={{ width: COL_W, minWidth: COL_W, flexShrink: 0, background: today ? "#fff7ed" : weekend ? "#fafaf9" : "#f8fafc", border: "1px solid #e5e7eb", borderBottom: "none", padding: "4px 4px 2px", textAlign: "center" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: today ? "#f97316" : weekend ? "#9ca3af" : "#6b7280" }}>{dow}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: today ? "#f97316" : "#111827" }}>{mmd}</div>
                          <button onClick={() => clearDay(ds)} title="Clear this day" style={{ fontSize: 9, color: "#d1d5db", background: "none", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>✕</button>
                        </div>
                      );
                    })}
                    {visColEnd < dates.length - 1 && <div style={{ width: (dates.length - 1 - visColEnd) * COL_W, flexShrink: 0 }} />}
                  </div>

                  {/* Visible rows */}
                  <div style={{ position: "absolute", top: HDR_H + visRowStart * ROW_H, left: 0, width: LABEL_W + totalColW }}>
                    {visibleIntervals.map((interval, vi) => {
                      const rowIdx = visRowStart + vi; const isHour = interval.indices[0] % 4 === 0;
                      return (
                        <div key={rowIdx} style={{ display: "flex", height: ROW_H, background: isHour ? "#fafafa" : "#fff" }}>
                          <div style={{ position: "sticky", left: 0, zIndex: 1, flexShrink: 0, width: LABEL_W, minWidth: LABEL_W, background: isHour ? "#f1f5f9" : "#f8fafc", borderRight: "2px solid #e5e7eb", borderBottom: `1px solid ${isHour ? "#e5e7eb" : "#f3f4f6"}`, padding: "0 10px", fontSize: 11, fontWeight: isHour ? 700 : 400, color: isHour ? "#374151" : "#9ca3af", whiteSpace: "nowrap", display: "flex", alignItems: "center" }}>
                            {interval.label}
                          </div>
                          {visColStart > 0 && <div style={{ width: visColStart * COL_W, flexShrink: 0 }} />}
                          <table style={{ borderCollapse: "collapse", tableLayout: "fixed", flexShrink: 0 }}>
                            <colgroup>{visibleDates.map((_, i) => <col key={i} style={{ width: COL_W }} />)}</colgroup>
                            <tbody><tr>
                              {visibleDates.map((ds, ci) => {
                                const colIdx = visColStart + ci;
                                const val = getCellValue(data, ds, interval.indices, activeTab as "volume" | "aht");
                                return (
                                  <GridCell key={ds} rowIdx={rowIdx} colIdx={colIdx} val={val}
                                    isAnchor={anchorCell?.row === rowIdx && anchorCell?.col === colIdx}
                                    isHour={isHour} today={isToday(ds)} weekend={isWeekend(ds)}
                                    activeTab={activeTab as "volume" | "aht"}
                                    onFocus={handleCellFocus} onChange={handleCellChange} onKeyDown={handleKeyDown} />
                                );
                              })}
                            </tr></tbody>
                          </table>
                          {visColEnd < dates.length - 1 && <div style={{ width: (dates.length - 1 - visColEnd) * COL_W, flexShrink: 0 }} />}
                        </div>
                      );
                    })}
                  </div>

                  {/* Sticky totals */}
                  <div style={{ position: "sticky", bottom: 0, left: 0, zIndex: 4, display: "flex", width: LABEL_W + totalColW, background: "#f8fafc", borderTop: "2px solid #e5e7eb" }}>
                    <div style={{ position: "sticky", left: 0, zIndex: 5, flexShrink: 0, width: LABEL_W, minWidth: LABEL_W, background: "#f1f5f9", borderRight: "2px solid #e5e7eb", padding: "6px 10px", fontSize: 10, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".04em", display: "flex", alignItems: "center" }}>
                      {activeTab === "volume" ? "Daily Total" : "Avg AHT"}
                    </div>
                    {visColStart > 0 && <div style={{ width: visColStart * COL_W, flexShrink: 0 }} />}
                    {visibleDates.map((ds, i) => {
                      const colIdx = visColStart + i;
                      const v = activeTab === "volume" ? colTotals[colIdx]?.vol : colTotals[colIdx]?.aht;
                      return (
                        <div key={ds} style={{ width: COL_W, minWidth: COL_W, flexShrink: 0, border: "1px solid #e5e7eb", padding: "6px 8px", textAlign: "right", fontSize: 12, fontWeight: 700, color: v > 0 ? "#f97316" : "#d1d5db", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                          {v > 0 ? (activeTab === "volume" ? v.toLocaleString() : `${v}s`) : "—"}
                        </div>
                      );
                    })}
                    {visColEnd < dates.length - 1 && <div style={{ width: (dates.length - 1 - visColEnd) * COL_W, flexShrink: 0 }} />}
                  </div>

                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Telephony Modal ── */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) { setShowModal(false); setPullMsg(null); } }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 480, maxWidth: "92vw", boxShadow: "0 24px 64px rgba(0,0,0,.22)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "#111827", margin: 0 }}>📡 Pull from Telephony</h2>
              <button onClick={() => { setShowModal(false); setPullMsg(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".05em" }}>SYSTEM</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {TELEPHONY_SYSTEMS.map(sys => (
                  <button key={sys.id} onClick={() => setPrefs({ telephonySystem: sys.id })} style={S.sysBtn(telephonySystem === sys.id)}>
                    {sys.icon} {sys.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".05em" }}>DATE TO PULL</label>
              <input type="date" value={pullDate} onChange={e => setPullDate(e.target.value)}
                style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: "9px 12px", fontSize: 13, boxSizing: "border-box", color: "#111827" }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".05em" }}>
                QUEUE / SKILL <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
              </label>
              <input type="text" value={pullQueue} onChange={e => setPullQueue(e.target.value)}
                placeholder="e.g. Main Queue, Support Tier 1, All Queues…"
                style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: "9px 12px", fontSize: 13, boxSizing: "border-box", color: "#111827" }} />
            </div>
            {telephonySystem !== "genesys" && (
              <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
                <p style={{ fontSize: 12, color: "#92400e", margin: 0 }}>
                  ⚠️ <strong>{TELEPHONY_SYSTEMS.find(s => s.id === telephonySystem)?.label}</strong> is not yet connected.
                  Add the API credentials to <code>server.cjs</code>.
                </p>
              </div>
            )}
            {pullMsg && (
              <div style={{ padding: "8px 12px", borderRadius: 8, marginBottom: 14, background: pullMsg.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${pullMsg.ok ? "#bbf7d0" : "#fecaca"}`, fontSize: 13, fontWeight: 600, color: pullMsg.ok ? "#16a34a" : "#dc2626" }}>
                {pullMsg.text}
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setShowModal(false); setPullMsg(null); }} style={{ flex: 1, padding: "10px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "#fff", color: "#374151" }}>Cancel</button>
              <button onClick={handlePull} disabled={isPulling} style={{ flex: 2, padding: "10px", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: isPulling ? "not-allowed" : "pointer", background: "#f97316", color: "#fff", opacity: isPulling ? 0.7 : 1 }}>
                {isPulling ? "Pulling…" : "Pull Data"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
