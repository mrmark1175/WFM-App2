import React, { useState, useEffect, useMemo } from "react";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import { 
  BarChart3, 
  Download, 
  Search, 
  ChevronLeft, 
  ChevronRight,
  Globe,
  Clock,
  Calendar as CalendarIcon,
  Database
} from "lucide-react";
import { Link } from "react-router-dom";

interface PerformanceData {
  date: string;
  interval_index: number;
  interval_start: string;
  interval_end: string;
  offer: number;
  answer: number;
  answer_pct: number;
  abandon: number;
  abandon_pct: number;
  asa: number;
  sl_pct: number;
  sl_target: number;
  avg_wait: number;
  avg_handle: number;
  avg_talk: number;
  avg_hold: number;
  avg_acw: number;
  hold_count: number;
  transfer_count: number;
  short_abandon: number;
}

type RollupLevel = "Day" | "Week" | "Month" | "Month by Week" | "Interval";

export function PerformanceAnalytics() {
  const [rawData, setRawData] = useState<PerformanceData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Date & Time States
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");
  
  const [rollupLevel, setRollupLevel] = useState<RollupLevel>("Interval");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchPerformance = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(apiUrl("/api/telephony/pull"), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: 'genesys', startDate, endDate })
      });
      const result = await res.json();
      
      if (result.success) {
        const fullData: PerformanceData[] = result.data.map((item: any) => {
          const offer = item.offer || 0;
          const answer = item.answer || 0;
          const abandon = item.abandon || 0;
          
          return {
            ...item,
            answer_pct: offer > 0 ? answer / offer : 1,
            abandon_pct: offer > 0 ? abandon / offer : 0,
            interval_start: `${item.date} ${Math.floor(item.interval_index/4).toString().padStart(2,'0')}:${(item.interval_index%4*15).toString().padStart(2,'0')}`,
            interval_end: `${item.date} ${Math.floor((item.interval_index+1)/4).toString().padStart(2,'0')}:${((item.interval_index+1)%4*15).toString().padStart(2,'0')}`,
            sl_target: 0.8,
          };
        });
        setRawData(fullData);
      }
    } catch (error) {
      console.error("Fetch failed", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPerformance();
  }, [startDate, endDate]);

  const displayData = useMemo(() => {
    // Filter by time range and search term
    const filtered = rawData.filter(item => {
      const intervalTime = item.interval_start.split(' ')[1];
      const matchesTime = intervalTime >= startTime && intervalTime <= endTime;
      
      // Since mock data currently doesn't have queue_name, 
      // we'll simulate search matches or implement actual filtering if available.
      const matchesSearch = !searchTerm || 
        (item as any).queue_name?.toLowerCase().includes(searchTerm.toLowerCase());
      
      return matchesTime && matchesSearch;
    });

    if (rollupLevel === "Interval") return filtered;

    const groups: Record<string, PerformanceData[]> = {};

    filtered.forEach(item => {
      let key = "";
      const d = new Date(item.date + 'T00:00:00');
      
      if (rollupLevel === "Day") {
        key = item.date;
      } else if (rollupLevel === "Week") {
        const firstDay = new Date(d);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        firstDay.setDate(diff);
        key = `Week of ${firstDay.toISOString().split('T')[0]}`;
      } else if (rollupLevel === "Month") {
        key = d.toLocaleString('default', { month: 'long', year: 'numeric' });
      } else if (rollupLevel === "Month by Week") {
        const firstDay = new Date(d);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        firstDay.setDate(diff);
        const monthName = d.toLocaleString('default', { month: 'short' });
        key = `${monthName} - Wk ${Math.ceil(d.getDate() / 7)}`;
      }

      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });

    return Object.entries(groups).map(([key, items]) => {
      const totalOffer = items.reduce((s, i) => s + (i.offer || 0), 0);
      const totalAnswer = items.reduce((s, i) => s + (i.answer || 0), 0);
      const totalAbandon = items.reduce((s, i) => s + (i.abandon || 0), 0);
      
      const avgASA = totalAnswer > 0 ? items.reduce((s, i) => s + ((i.asa || 0) * (i.answer || 0)), 0) / totalAnswer : 0;
      const avgWait = totalAnswer > 0 ? items.reduce((s, i) => s + ((i.avg_wait || 0) * (i.answer || 0)), 0) / totalAnswer : 0;
      const avgHandle = totalAnswer > 0 ? items.reduce((s, i) => s + ((i.avg_handle || 0) * (i.answer || 0)), 0) / totalAnswer : 0;
      const avgTalk = totalAnswer > 0 ? items.reduce((s, i) => s + ((i.avg_talk || 0) * (i.answer || 0)), 0) / totalAnswer : 0;
      const avgHold = totalAnswer > 0 ? items.reduce((s, i) => s + ((i.avg_hold || 0) * (i.answer || 0)), 0) / totalAnswer : 0;
      const avgAcw = totalAnswer > 0 ? items.reduce((s, i) => s + ((i.avg_acw || 0) * (i.answer || 0)), 0) / totalAnswer : 0;
      const avgSL = totalOffer > 0 ? items.reduce((s, i) => s + ((i.sl_pct || 0) * (i.offer || 0)), 0) / totalOffer : 1;

      return {
        interval_start: key,
        interval_end: "Summary",
        offer: totalOffer,
        answer: totalAnswer,
        answer_pct: totalOffer > 0 ? totalAnswer / totalOffer : 1,
        abandon: totalAbandon,
        abandon_pct: totalOffer > 0 ? totalAbandon / totalOffer : 0,
        asa: Math.round(avgASA),
        sl_pct: avgSL,
        sl_target: 0.8,
        avg_wait: Math.round(avgWait),
        avg_handle: Math.round(avgHandle),
        avg_talk: Math.round(avgTalk),
        avg_hold: Math.round(avgHold),
        avg_acw: Math.round(avgAcw),
        hold_count: items.reduce((s, i) => s + (i.hold_count || 0), 0),
        transfer_count: items.reduce((s, i) => s + (i.transfer_count || 0), 0),
        short_abandon: items.reduce((s, i) => s + (i.short_abandon || 0), 0),
      } as PerformanceData;
    });
  }, [rawData, rollupLevel, startTime, endTime, searchTerm]);

  const formatPct = (val: number) => (val * 100).toFixed(1) + "%";

  const formatDateLocal = (date: Date) => {
    return date.getFullYear() + '-' + 
           String(date.getMonth() + 1).padStart(2, '0') + '-' + 
           String(date.getDate()).padStart(2, '0');
  };

  const presets = [
    { label: "Today", action: () => {
      const d = new Date();
      setStartDate(formatDateLocal(d)); setEndDate(formatDateLocal(d));
    }},
    { label: "Yesterday", action: () => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      setStartDate(formatDateLocal(d)); setEndDate(formatDateLocal(d));
    }},
    { label: "This week", action: () => {
      const d = new Date(); const day = d.getDay();
      const start = new Date(d); start.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      setStartDate(formatDateLocal(start));
      setEndDate(formatDateLocal(new Date()));
    }},
    { label: "Last week", action: () => {
      const d = new Date(); const day = d.getDay();
      const start = new Date(d); start.setDate(d.getDate() - (day === 0 ? 6 : day - 1) - 7);
      const end = new Date(start); end.setDate(start.getDate() + 6);
      setStartDate(formatDateLocal(start));
      setEndDate(formatDateLocal(end));
    }},
    { label: "Previous 7 days", action: () => {
      const end = new Date(); const start = new Date();
      start.setDate(end.getDate() - 7);
      setStartDate(formatDateLocal(start));
      setEndDate(formatDateLocal(end));
    }},
    { label: "This month", action: () => {
      const start = new Date(); start.setDate(1);
      setStartDate(formatDateLocal(start));
      setEndDate(formatDateLocal(new Date()));
    }},
    { label: "This month by week", action: () => {
      const start = new Date(); start.setDate(1);
      setStartDate(formatDateLocal(start));
      setEndDate(formatDateLocal(new Date()));
      setRollupLevel("Month by Week");
    }},
    { label: "Last month", action: () => {
      const d = new Date(); d.setMonth(d.getMonth() - 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      setStartDate(formatDateLocal(start));
      setEndDate(formatDateLocal(end));
    }},
    { label: "Previous 30 days", action: () => {
      const end = new Date(); const start = new Date();
      start.setDate(end.getDate() - 30);
      setStartDate(formatDateLocal(start));
      setEndDate(formatDateLocal(end));
    }},
    { label: "Previous 3 months", action: () => {
      const end = new Date(); const start = new Date();
      start.setMonth(end.getMonth() - 3);
      setStartDate(formatDateLocal(start));
      setEndDate(formatDateLocal(end));
    }},
  ];

  return (
    <PageLayout title="Performance Analytics">
      <div className="flex h-[calc(100vh-140px)] gap-6 overflow-hidden">
        
        {/* ── Sidebar Filters ── */}
        <div className="w-64 bg-card border rounded-xl overflow-y-auto shrink-0 flex flex-col shadow-sm">
          <div className="p-4 border-b">
            <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] mb-4">Presets</h3>
            <div className="space-y-1">
              {presets.map(p => (
                <button 
                  key={p.label}
                  onClick={p.action}
                  className="w-full text-left px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 border-b">
            <div className="space-y-1">
              {(["Day", "Week", "Month", "Month by Week", "Interval"] as RollupLevel[]).map(level => (
                <button 
                  key={level}
                  onClick={() => setRollupLevel(level)}
                  className={`w-full text-left px-3 py-1.5 text-sm font-medium rounded-md transition-all
                    ${rollupLevel === level ? "text-blue-600 bg-blue-50" : "text-slate-600 hover:text-blue-600 hover:bg-blue-50"}`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 mt-auto space-y-4">
            <div>
              <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] mb-3">Data Source</h3>
              <div className="flex items-center gap-2.5 p-2.5 bg-emerald-50/50 border border-emerald-100 rounded-lg">
                <div className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <Database className="size-3 text-emerald-600" />
                    <span className="text-[11px] font-bold text-emerald-700 leading-none">Genesys Cloud</span>
                  </div>
                  <span className="text-[9px] font-medium text-emerald-600/70 mt-1 uppercase tracking-wider">Live API Connection</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] mb-3">Time zone</h3>
              <div className="flex items-center gap-2 p-2 bg-muted/50 border rounded-lg">
                <Globe className="size-3.5 text-muted-foreground" />
                <select className="bg-transparent border-none text-[11px] font-bold focus:outline-none w-full cursor-pointer">
                  <option>Manila, Philippines (UTC+8)</option>
                  <option>London, UK (UTC+0)</option>
                  <option>New York, USA (UTC-5)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* ── Main Content ── */}
        <div className="flex-1 flex flex-col gap-6 min-w-0">
          
          {/* Top Bar with Date & Time (Screenshot Match) */}
          <div className="bg-card border rounded-xl p-6 shadow-sm shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-8">
              {/* Range Selector Visualization */}
              <div className="flex items-center gap-6">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CalendarIcon className="size-3.5" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Start</span>
                  </div>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-sm font-bold bg-muted/50 rounded-lg px-3 py-1.5 border-none focus:ring-2 focus:ring-blue-500/20" />
                  <div className="flex items-center gap-2 mt-1">
                    <Clock className="size-3.5 text-muted-foreground" />
                    <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="text-xs font-bold bg-transparent border-none p-0 focus:ring-0" />
                  </div>
                </div>

                <div className="h-12 w-px bg-border self-center" />

                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CalendarIcon className="size-3.5" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">End</span>
                  </div>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-sm font-bold bg-muted/50 rounded-lg px-3 py-1.5 border-none focus:ring-2 focus:ring-blue-500/20" />
                  <div className="flex items-center gap-2 mt-1">
                    <Clock className="size-3.5 text-muted-foreground" />
                    <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="text-xs font-bold bg-transparent border-none p-0 focus:ring-0" />
                  </div>
                </div>
              </div>

              <div className="h-16 w-px bg-border" />

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input 
                  type="text" 
                  placeholder="Filter by Queue..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-muted/30 border-transparent rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all text-sm outline-none w-64"
                />
              </div>
            </div>

            <button className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-all shadow-md active:scale-95">
              <Download className="size-4" />
              Export Detailed CSV
            </button>
          </div>

          {/* Table Container */}
          <div className="bg-card border rounded-xl overflow-hidden shadow-sm flex-1 flex flex-col min-h-0">
            <div className="overflow-auto flex-1">
              <table className="w-full text-left border-collapse min-w-[2000px]">
                <thead>
                  <tr className="bg-muted/50 border-b sticky top-0 z-20 backdrop-blur-md">
                    <th className="p-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest sticky left-0 bg-muted/50 z-30 border-r">
                      {rollupLevel === "Interval" ? "Interval Start" : "Time Period"}
                    </th>
                    <th className="p-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest border-r">
                      {rollupLevel === "Interval" ? "Interval End" : "Status"}
                    </th>
                    <th className="p-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest border-r">Offer</th>
                    <th className="p-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest border-r">Answer</th>
                    <th className="p-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest border-r">Answer %</th>
                    <th className="p-3 text-[10px] font-black text-rose-600 uppercase tracking-widest border-r">Abandon</th>
                    <th className="p-3 text-[10px] font-black text-rose-600 uppercase tracking-widest border-r">Abandon %</th>
                    <th className="p-3 text-[10px] font-black text-blue-600 uppercase tracking-widest border-r">ASA</th>
                    <th className="p-3 text-[10px] font-black text-emerald-600 uppercase tracking-widest border-r">SL %</th>
                    <th className="p-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest border-r">Target</th>
                    <th className="p-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest border-r">Avg Wait</th>
                    <th className="p-3 text-[10px] font-black text-blue-600 uppercase tracking-widest border-r">Avg Handle</th>
                    <th className="p-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest border-r">Avg Talk</th>
                    <th className="p-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest border-r">Avg Hold</th>
                    <th className="p-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest border-r">Avg ACW</th>
                    <th className="p-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest border-r">Hold #</th>
                    <th className="p-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest border-r">Xfer #</th>
                    <th className="p-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest">S.Abandon</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    Array(10).fill(0).map((_, i) => (
                      <tr key={i}>
                        <td className="p-3 sticky left-0 bg-card border-r"><div className="h-4 w-32 bg-muted animate-pulse rounded" /></td>
                        {Array(17).fill(0).map((_, j) => (
                          <td key={j} className="p-3"><div className="h-4 bg-muted animate-pulse rounded" /></td>
                        ))}
                      </tr>
                    ))
                  ) : displayData.length === 0 ? (
                    <tr>
                      <td colSpan={18} className="p-20 text-center flex flex-col items-center justify-center">
                        <BarChart3 className="size-12 text-muted-foreground/20 mb-4" />
                        <p className="text-muted-foreground font-medium">No performance data found for this period.</p>
                      </td>
                    </tr>
                  ) : (
                    displayData.map((row, i) => (
                      <tr key={i} className="hover:bg-blue-50/30 transition-colors group">
                        <td className={`p-3 text-[11px] font-bold sticky left-0 bg-card border-r z-10 transition-colors group-hover:bg-slate-50
                          ${rollupLevel !== "Interval" ? "text-blue-600 uppercase tracking-wider" : "font-mono text-muted-foreground"}`}>
                          {row.interval_start}
                        </td>
                        <td className="p-3 text-[10px] font-bold border-r text-muted-foreground italic">
                          {row.interval_end}
                        </td>
                        <td className="p-3 text-sm font-bold border-r text-right tabular-nums text-slate-700">{row.offer.toLocaleString()}</td>
                        <td className="p-3 text-sm font-bold border-r text-right tabular-nums text-slate-700">{row.answer.toLocaleString()}</td>
                        <td className="p-3 text-xs font-bold border-r text-right tabular-nums text-slate-400">{formatPct(row.answer_pct)}</td>
                        <td className="p-3 text-sm font-bold border-r text-right tabular-nums text-rose-600">{row.abandon > 0 ? row.abandon.toLocaleString() : "—"}</td>
                        <td className="p-3 text-xs font-bold border-r text-right tabular-nums text-rose-500">{row.abandon > 0 ? formatPct(row.abandon_pct) : "—"}</td>
                        <td className="p-3 text-sm font-black border-r text-right tabular-nums text-blue-600">{row.asa}s</td>
                        <td className={`p-3 text-sm font-black border-r text-right tabular-nums ${row.sl_pct >= row.sl_target ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {formatPct(row.sl_pct)}
                        </td>
                        <td className="p-3 text-xs font-bold border-r text-right tabular-nums text-slate-300">{formatPct(row.sl_target)}</td>
                        <td className="p-3 text-xs font-bold border-r text-right tabular-nums text-slate-500">{row.avg_wait}s</td>
                        <td className="p-3 text-sm font-black border-r text-right tabular-nums text-blue-600">{row.avg_handle}s</td>
                        <td className="p-3 text-xs font-bold border-r text-right tabular-nums text-slate-500">{row.avg_talk}s</td>
                        <td className="p-3 text-xs font-bold border-r text-right tabular-nums text-slate-500">{row.avg_hold}s</td>
                        <td className="p-3 text-xs font-bold border-r text-right tabular-nums text-slate-500">{row.avg_acw}s</td>
                        <td className="p-3 text-xs font-bold border-r text-right tabular-nums text-slate-500">{row.hold_count || "—"}</td>
                        <td className="p-3 text-xs font-bold border-r text-right tabular-nums text-slate-500">{row.transfer_count || "—"}</td>
                        <td className="p-3 text-xs font-bold text-right tabular-nums text-slate-500">{row.short_abandon || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination / Footer */}
            <div className="p-4 border-t bg-muted/20 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  Showing {displayData.length} {rollupLevel}{displayData.length !== 1 ? "s" : ""}
                </p>
                <div className="size-1 rounded-full bg-slate-300" />
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  Date Range Sync: {startDate} to {endDate}
                </p>
                <div className="size-1 rounded-full bg-slate-300" />
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                  Provider: <span className="text-blue-600">Genesys Cloud</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button className="p-1.5 rounded-lg border bg-white hover:bg-accent transition-all shadow-sm active:scale-95"><ChevronLeft className="size-4" /></button>
                <span className="text-xs font-black px-3">1</span>
                <button className="p-1.5 rounded-lg border bg-white hover:bg-accent transition-all shadow-sm active:scale-95"><ChevronRight className="size-4" /></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
