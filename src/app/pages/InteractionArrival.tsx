import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";

// ── Types ─────────────────────────────────────────────────────────────────────
interface CellData { volume: number; aht: number; }
type GridData = Record<string, Record<number, CellData>>; // dateStr → slotIndex → data
interface IntervalRow { label: string; indices: number[]; }

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE   = "http://localhost:5000";
const SLOT_COUNT = 96; // 15-min slots per day

const TELEPHONY_SYSTEMS = [
  { id: "genesys", label: "Genesys Cloud",  icon: "☁️" },
  { id: "avaya",   label: "Avaya",           icon: "📞" },
  { id: "iex",     label: "NICE IEX",        icon: "📊" },
  { id: "five9",   label: "Five9",           icon: "5️⃣" },
  { id: "nice",    label: "NICE CXone",      icon: "🎯" },
  { id: "cisco",   label: "Cisco UCCE",      icon: "🔧" },
  { id: "custom",  label: "Custom API",      icon: "⚙️" },
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
  for (let i = 0; i < SLOT_COUNT; i += step) {
    rows.push({ label: fmtSlot(i), indices: Array.from({ length: step }, (_, j) => i + j) });
  }
  return rows;
}

function makeDates(start: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00");
  for (let i = 0; i < n; i++) {
    const c = new Date(d);
    c.setDate(c.getDate() + i);
    out.push(c.toISOString().split("T")[0]);
  }
  return out;
}

function fmtHdr(dateStr: string): { dow: string; mmd: string } {
  const d      = new Date(dateStr + "T00:00:00");
  const days   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return { dow: days[d.getDay()], mmd: `${months[d.getMonth()]} ${d.getDate()}` };
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
  if (tab === "volume") {
    return indices.reduce((s, i) => s + (d[i]?.volume || 0), 0);
  }
  const vals = indices.map(i => d[i]?.aht || 0).filter(v => v > 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function lastMonday(): string {
  const d   = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split("T")[0];
}

// ── Main Component ─────────────────────────────────────────────────────────────
export function InteractionArrival() {
  const navigate = useNavigate();

  // ── Core state ──────────────────────────────────────────────────────────────
  const [activeTab,    setActiveTab]    = useState<"volume" | "aht">("volume");
  const [intervalSize, setIntervalSize] = useState<15 | 30 | 60>(15);
  const [startDate,    setStartDate]    = useState<string>(lastMonday);
  const [numDays,      setNumDays]      = useState<number>(7);
  const [data,         setData]         = useState<GridData>({});
  const [anchorCell,   setAnchorCell]   = useState<{ row: number; col: number } | null>(null);

  // ── Status ───────────────────────────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [isLoading,  setIsLoading]  = useState(false);

  // ── Telephony modal state ────────────────────────────────────────────────────
  const [showModal,        setShowModal]        = useState(false);
  const [telephonySystem,  setTelephonySystem]  = useState("genesys");
  const [pullDate,         setPullDate]         = useState(todayStr);
  const [pullQueue,        setPullQueue]        = useState("");
  const [isPulling,        setIsPulling]        = useState(false);
  const [pullMsg,          setPullMsg]          = useState<{ ok: boolean; text: string } | null>(null);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const intervals = useMemo(() => makeIntervals(intervalSize), [intervalSize]);
  const dates     = useMemo(() => makeDates(startDate, numDays), [startDate, numDays]);

  // ── Fetch from DB when date range changes ────────────────────────────────────
  useEffect(() => {
    if (!dates.length) return;
    setIsLoading(true);
    const endDate = dates[dates.length - 1];
    fetch(`${API_BASE}/api/interaction-arrival?startDate=${startDate}&endDate=${endDate}`)
      .then(r => r.json())
      .then((records: any[]) => {
        if (!Array.isArray(records)) return;
        const newData: GridData = {};
        records.forEach(r => {
          const ds = (r.interval_date as string).split("T")[0];
          if (!newData[ds]) newData[ds] = {};
          newData[ds][r.interval_index] = { volume: r.volume || 0, aht: r.aht || 0 };
        });
        setData(prev => ({ ...prev, ...newData }));
      })
      .catch(() => {/* silently use local data */})
      .finally(() => setIsLoading(false));
  }, [startDate, numDays]);

  // ── Paste handler (attached to grid container) ───────────────────────────────
  const handleGridPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!anchorCell) return;
    e.preventDefault();
    const text    = e.clipboardData.getData("text/plain");
    const rows    = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(r => r.trim());
    const parsed  = rows.map(r => r.split("\t"));

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

  // ── Update a single cell ─────────────────────────────────────────────────────
  const updateCell = useCallback((rowIdx: number, colIdx: number, val: number) => {
    const ds          = dates[colIdx];
    const slotIndices = intervals[rowIdx].indices;
    setData(prev => {
      const next = { ...prev, [ds]: { ...(prev[ds] || {}) } };
      slotIndices.forEach(idx => {
        next[ds][idx] = {
          volume: activeTab === "volume" ? Math.round(val / slotIndices.length) : (next[ds][idx]?.volume || 0),
          aht:    activeTab === "aht"    ? val                                  : (next[ds][idx]?.aht    || 0),
        };
      });
      return next;
    });
  }, [dates, intervals, activeTab]);

  // ── Keyboard navigation ──────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = document.getElementById(`cell-${Math.min(row + 1, intervals.length - 1)}-${col}`);
      (next as HTMLInputElement)?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = document.getElementById(`cell-${Math.max(row - 1, 0)}-${col}`);
      (next as HTMLInputElement)?.focus();
    } else if (e.key === "Tab") {
      // browser default moves to next input naturally
    } else if (e.key === "Escape") {
      setAnchorCell(null);
      (e.target as HTMLInputElement).blur();
    }
  }, [intervals.length]);

  // ── Save to DB ───────────────────────────────────────────────────────────────
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
      const res = await fetch(`${API_BASE}/api/interaction-arrival`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records }),
      });
      if (res.ok) { setSaveStatus("saved"); setTimeout(() => setSaveStatus(""), 2500); }
      else          setSaveStatus("error");
    } catch { setSaveStatus("error"); }
  };

  // ── Telephony pull ────────────────────────────────────────────────────────────
  const handlePull = async () => {
    setIsPulling(true);
    setPullMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/telephony/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: telephonySystem, date: pullDate, queue: pullQueue }),
      });
      const result = await res.json();
      if (result.success && result.data) {
        setData(prev => {
          const next = { ...prev, [pullDate]: { ...(prev[pullDate] || {}) } };
          (result.data as any[]).forEach(r => {
            next[pullDate][r.interval_index] = { volume: r.volume || 0, aht: r.aht || 0 };
          });
          return next;
        });
        setPullMsg({ ok: true, text: `✓ ${pullDate} pulled successfully` });
        setTimeout(() => { setShowModal(false); setPullMsg(null); }, 1500);
      } else {
        setPullMsg({ ok: false, text: result.message || "Pull failed" });
      }
    } catch {
      setPullMsg({ ok: false, text: "Could not connect to server" });
    }
    setIsPulling(false);
  };

  // ── Column totals ─────────────────────────────────────────────────────────────
  const colTotals = useMemo(() => dates.map(ds => {
    const cells = Object.values(data[ds] || {});
    const vol   = cells.reduce((s, c) => s + c.volume, 0);
    const ahts  = cells.map(c => c.aht).filter(v => v > 0);
    const aht   = ahts.length ? Math.round(ahts.reduce((a, b) => a + b, 0) / ahts.length) : 0;
    return { vol, aht };
  }), [data, dates]);

  // ── Clear a day's data ────────────────────────────────────────────────────────
  const clearDay = (ds: string) => {
    if (!confirm(`Clear all data for ${ds}?`)) return;
    setData(prev => { const n = { ...prev }; delete n[ds]; return n; });
  };

  // ── Styles ────────────────────────────────────────────────────────────────────
  const S = {
    page:       { fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: "#f9fafb", minHeight: "100vh" } as React.CSSProperties,
    header:     { background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" } as React.CSSProperties,
    body:       { maxWidth: 1500, margin: "0 auto", padding: "28px 32px" } as React.CSSProperties,
    card:       { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12 } as React.CSSProperties,
    tab: (active: boolean): React.CSSProperties => ({
      padding: "5px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
      background: active ? "#fff" : "transparent",
      color:      active ? "#111827" : "#6b7280",
      boxShadow:  active ? "0 1px 3px rgba(0,0,0,.1)" : "none",
    }),
    intBtn: (active: boolean): React.CSSProperties => ({
      padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
      background: active ? "#f97316" : "transparent",
      color:      active ? "#fff"    : "#6b7280",
    }),
    dayBtn: (active: boolean): React.CSSProperties => ({
      padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
      background: active ? "#111827" : "transparent",
      color:      active ? "#fff"    : "#6b7280",
    }),
    sysBtn: (active: boolean): React.CSSProperties => ({
      padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid",
      borderColor: active ? "#f97316" : "#e5e7eb",
      background:  active ? "#fff7ed" : "#fff",
      color:       active ? "#f97316" : "#374151",
    }),
  };

  // ── Render ────────────────────────────────────────────────────────────────────
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
        <div style={{ marginBottom: 20 }}>
          <button onClick={() => navigate("/wfm")}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: "4px 0", marginBottom: 8 }}
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
        <div style={{ ...S.card, padding: "12px 20px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2, background: "#f3f4f6", borderRadius: 8, padding: 3 }}>
            <button style={S.tab(activeTab === "volume")} onClick={() => setActiveTab("volume")}>
              📞 Interaction Volume
            </button>
            <button style={S.tab(activeTab === "aht")} onClick={() => setActiveTab("aht")}>
              ⏱ AHT
            </button>
          </div>

          <div style={{ width: 1, height: 24, background: "#e5e7eb" }} />

          {/* Interval */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>Interval:</span>
            <div style={{ display: "flex", gap: 2, background: "#f3f4f6", borderRadius: 8, padding: 3 }}>
              {([15, 30, 60] as const).map(s => (
                <button key={s} style={S.intBtn(intervalSize === s)} onClick={() => setIntervalSize(s)}>
                  {s === 60 ? "1 hr" : `${s} min`}
                </button>
              ))}
            </div>
          </div>

          <div style={{ width: 1, height: 24, background: "#e5e7eb" }} />

          {/* Start date */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>Start:</span>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              style={{ fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", color: "#111827", background: "#fff", cursor: "pointer" }} />
          </div>

          {/* Num days */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>Days:</span>
            <div style={{ display: "flex", gap: 2, background: "#f3f4f6", borderRadius: 8, padding: 3 }}>
              {[7, 14, 21, 30].map(n => (
                <button key={n} style={S.dayBtn(numDays === n)} onClick={() => setNumDays(n)}>{n}d</button>
              ))}
            </div>
          </div>

          {/* Right side actions */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {isLoading && <span style={{ fontSize: 12, color: "#9ca3af" }}>Loading…</span>}

            <button onClick={() => setShowModal(true)} style={{
              padding: "6px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: "1px solid #6366f1", background: "#eef2ff", color: "#6366f1",
            }}>
              📡 Pull from Telephony
            </button>

            {saveStatus === "saving" && <span style={{ fontSize: 12, color: "#9ca3af" }}>💾 Saving…</span>}
            {saveStatus === "saved"  && <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>✓ Saved</span>}
            {saveStatus === "error"  && <span style={{ fontSize: 12, color: "#dc2626" }}>✕ Error saving</span>}

            <button onClick={handleSave} style={{
              padding: "6px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: "1px solid #f97316", background: "#fff7ed", color: "#f97316",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = "#f97316"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#fff7ed"; e.currentTarget.style.color = "#f97316"; }}>
              💾 Save
            </button>
          </div>
        </div>

        {/* ── Paste hint ── */}
        <div style={{ fontSize: 12, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
          {anchorCell ? (
            <span style={{ color: "#f97316", fontWeight: 600, background: "#fff7ed", padding: "3px 10px", borderRadius: 6, border: "1px solid #fed7aa" }}>
              📋 Row {anchorCell.row + 1}, {dates[anchorCell.col]} selected — press Ctrl+V / Cmd+V to paste from Excel
            </span>
          ) : (
            <span style={{ color: "#9ca3af" }}>
              💡 Click any cell to select, then paste (Ctrl+V) to fill from Excel · Double-click to edit
            </span>
          )}
        </div>

        {/* ── Spreadsheet grid ── */}
        <div style={{ ...S.card, overflow: "hidden" }}>
          <div
            onPaste={handleGridPaste}
            style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 320px)" }}
          >
            <table style={{ borderCollapse: "collapse", tableLayout: "fixed", minWidth: "100%" }}>
              <colgroup>
                <col style={{ width: 88 }} />
                {dates.map(ds => <col key={ds} style={{ width: 96 }} />)}
              </colgroup>

              {/* ── Header row ── */}
              <thead>
                <tr>
                  {/* Time corner */}
                  <th style={{
                    position: "sticky", left: 0, top: 0, zIndex: 4,
                    background: "#f1f5f9", borderRight: "2px solid #e5e7eb", borderBottom: "2px solid #e5e7eb",
                    padding: "8px 10px", fontSize: 10, fontWeight: 700, color: "#6b7280",
                    textTransform: "uppercase", letterSpacing: ".06em", textAlign: "left",
                  }}>
                    {intervalSize === 15 ? "15 MIN" : intervalSize === 30 ? "30 MIN" : "HOURLY"}
                  </th>

                  {/* Date headers */}
                  {dates.map(ds => {
                    const { dow, mmd } = fmtHdr(ds);
                    const today   = isToday(ds);
                    const weekend = isWeekend(ds);
                    return (
                      <th key={ds} style={{
                        position: "sticky", top: 0, zIndex: 3,
                        background: today ? "#fff7ed" : weekend ? "#fafaf9" : "#f8fafc",
                        border: "1px solid #e5e7eb", borderBottom: "2px solid #e5e7eb",
                        padding: "4px 4px 2px", textAlign: "center",
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: today ? "#f97316" : weekend ? "#9ca3af" : "#6b7280" }}>{dow}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: today ? "#f97316" : "#111827" }}>{mmd}</div>
                        <button
                          onClick={() => clearDay(ds)}
                          title="Clear this day"
                          style={{ fontSize: 9, color: "#d1d5db", background: "none", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>
                          ✕
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {/* ── Data rows ── */}
              <tbody>
                {intervals.map((interval, rowIdx) => {
                  // Highlight top-of-hour rows
                  const isHour = interval.indices[0] % 4 === 0;
                  return (
                    <tr key={rowIdx} style={{ background: isHour ? "#fafafa" : "#fff" }}>
                      {/* Time label */}
                      <td style={{
                        position: "sticky", left: 0, zIndex: 1,
                        background: isHour ? "#f1f5f9" : "#f8fafc",
                        borderRight: "2px solid #e5e7eb",
                        borderBottom: `1px solid ${isHour ? "#e5e7eb" : "#f3f4f6"}`,
                        padding: "0 10px", fontSize: 11, fontWeight: isHour ? 700 : 400,
                        color: isHour ? "#374151" : "#9ca3af", whiteSpace: "nowrap", height: 28,
                      }}>
                        {interval.label}
                      </td>

                      {/* Data cells */}
                      {dates.map((ds, colIdx) => {
                        const val       = getCellValue(data, ds, interval.indices, activeTab);
                        const isAnchor  = anchorCell?.row === rowIdx && anchorCell?.col === colIdx;
                        const today     = isToday(ds);
                        const weekend   = isWeekend(ds);
                        return (
                          <td key={ds} style={{
                            padding: 0, height: 28,
                            border: `1px solid ${isHour ? "#e5e7eb" : "#f3f4f6"}`,
                            background: isAnchor
                              ? "#fff7ed"
                              : today   ? "#fffbf5"
                              : weekend ? "#fafaf9"
                              : undefined,
                            outline:       isAnchor ? "2px solid #f97316" : undefined,
                            outlineOffset: isAnchor ? -2 : undefined,
                            position:      "relative",
                          }}>
                            <input
                              id={`cell-${rowIdx}-${colIdx}`}
                              type="text"
                              value={val === 0 ? "" : String(val)}
                              placeholder=""
                              onFocus={() => setAnchorCell({ row: rowIdx, col: colIdx })}
                              onChange={e => {
                                const n = parseFloat(e.target.value.replace(/,/g, "")) || 0;
                                updateCell(rowIdx, colIdx, n);
                              }}
                              onKeyDown={e => handleKeyDown(e, rowIdx, colIdx)}
                              style={{
                                display: "block", width: "100%", height: "100%",
                                border: "none", outline: "none",
                                padding: "0 8px", fontSize: 12,
                                fontWeight: val > 0 ? 600 : 400,
                                color: val > 0 ? (activeTab === "volume" ? "#111827" : "#6366f1") : "#e5e7eb",
                                background: "transparent", textAlign: "right",
                                cursor: "cell", boxSizing: "border-box",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                {/* ── Total row ── */}
                <tr style={{ background: "#f8fafc", borderTop: "2px solid #e5e7eb", position: "sticky", bottom: 0, zIndex: 2 }}>
                  <td style={{
                    position: "sticky", left: 0, zIndex: 3, background: "#f1f5f9",
                    borderRight: "2px solid #e5e7eb", padding: "6px 10px",
                    fontSize: 10, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".04em",
                  }}>
                    {activeTab === "volume" ? "Daily Total" : "Avg AHT"}
                  </td>
                  {dates.map((ds, i) => {
                    const v = activeTab === "volume" ? colTotals[i].vol : colTotals[i].aht;
                    return (
                      <td key={ds} style={{
                        border: "1px solid #e5e7eb", padding: "6px 8px",
                        textAlign: "right", fontSize: 12, fontWeight: 700,
                        color: v > 0 ? "#f97316" : "#d1d5db",
                      }}>
                        {v > 0
                          ? activeTab === "volume"
                            ? v.toLocaleString()
                            : `${v}s`
                          : "—"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Telephony Modal ── */}
      {showModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) { setShowModal(false); setPullMsg(null); } }}
        >
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 480, maxWidth: "92vw", boxShadow: "0 24px 64px rgba(0,0,0,.22)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "#111827", margin: 0 }}>📡 Pull from Telephony</h2>
              <button onClick={() => { setShowModal(false); setPullMsg(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>

            {/* System */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".05em" }}>
                SYSTEM
              </label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {TELEPHONY_SYSTEMS.map(sys => (
                  <button key={sys.id} onClick={() => setTelephonySystem(sys.id)} style={S.sysBtn(telephonySystem === sys.id)}>
                    {sys.icon} {sys.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".05em" }}>
                DATE TO PULL
              </label>
              <input type="date" value={pullDate} onChange={e => setPullDate(e.target.value)}
                style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: "9px 12px", fontSize: 13, boxSizing: "border-box", color: "#111827" }} />
            </div>

            {/* Queue */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".05em" }}>
                QUEUE / SKILL <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
              </label>
              <input
                type="text" value={pullQueue} onChange={e => setPullQueue(e.target.value)}
                placeholder="e.g. Main Queue, Support Tier 1, All Queues…"
                style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: "9px 12px", fontSize: 13, boxSizing: "border-box", color: "#111827" }}
              />
            </div>

            {/* Non-Genesys warning */}
            {telephonySystem !== "genesys" && (
              <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
                <p style={{ fontSize: 12, color: "#92400e", margin: 0 }}>
                  ⚠️ <strong>{TELEPHONY_SYSTEMS.find(s => s.id === telephonySystem)?.label}</strong> is not yet connected.
                  Add the API credentials to <code>server.cjs</code> using the snippet in <code>server_routes_to_add.cjs</code>.
                </p>
              </div>
            )}

            {/* Pull result message */}
            {pullMsg && (
              <div style={{
                padding: "8px 12px", borderRadius: 8, marginBottom: 14,
                background: pullMsg.ok ? "#f0fdf4" : "#fef2f2",
                border: `1px solid ${pullMsg.ok ? "#bbf7d0" : "#fecaca"}`,
                fontSize: 13, fontWeight: 600,
                color: pullMsg.ok ? "#16a34a" : "#dc2626",
              }}>
                {pullMsg.text}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setShowModal(false); setPullMsg(null); }} style={{
                flex: 1, padding: "10px", border: "1px solid #e5e7eb", borderRadius: 8,
                fontSize: 13, fontWeight: 600, cursor: "pointer", background: "#fff", color: "#374151",
              }}>
                Cancel
              </button>
              <button onClick={handlePull} disabled={isPulling} style={{
                flex: 2, padding: "10px", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: isPulling ? "not-allowed" : "pointer",
                background: "#f97316", color: "#fff", opacity: isPulling ? 0.7 : 1,
              }}>
                {isPulling ? "Pulling…" : "Pull Data"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
