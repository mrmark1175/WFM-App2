import React, { useState, useEffect } from "react";
import { PageLayout } from "../components/PageLayout";
import { 
  BarChart3, 
  Download, 
  Filter, 
  Search, 
  ChevronLeft, 
  ChevronRight,
  ArrowUpDown
} from "lucide-react";
import { Link } from "react-router-dom";

interface PerformanceData {
  interval_start: string;
  interval_end: string;
  interval_complete: boolean;
  filters: string;
  media_type: string;
  queue_id: string;
  queue_name: string;
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

export function PerformanceAnalytics() {
  const [data, setData] = useState<PerformanceData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchPerformance = async () => {
    setIsLoading(true);
    try {
      // Fetching from our mock telephony endpoint for now
      const res = await fetch(`http://localhost:5000/api/telephony/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: 'genesys', date: startDate })
      });
      const result = await res.json();
      
      if (result.success) {
        const fullData: PerformanceData[] = result.data.map((item: any) => {
          return {
            interval_start: `${startDate} ${Math.floor(item.interval_index/4).toString().padStart(2,'0')}:${(item.interval_index%4*15).toString().padStart(2,'0')}`,
            interval_end: `${startDate} ${Math.floor((item.interval_index+1)/4).toString().padStart(2,'0')}:${((item.interval_index+1)%4*15).toString().padStart(2,'0')}`,
            interval_complete: true,
            filters: "",
            media_type: "voice",
            queue_id: "b14113c6-caf4-491c-815e-1b89bb25c6b2",
            queue_name: "Vodafone DA",
            offer: item.offer,
            answer: item.answer,
            answer_pct: item.offer > 0 ? (item.answer / item.offer) : 1,
            abandon: item.abandon,
            abandon_pct: item.offer > 0 ? (item.abandon / item.offer) : 0,
            asa: item.asa,
            sl_pct: item.sl_pct,
            sl_target: 0.8,
            avg_wait: item.avg_wait,
            avg_handle: item.avg_handle,
            avg_talk: item.avg_talk,
            avg_hold: item.avg_hold,
            avg_acw: item.avg_acw,
            hold_count: item.hold_count,
            transfer_count: item.transfer_count,
            short_abandon: item.short_abandon,
          };
        });
        setData(fullData);
      }
    } catch (error) {
      console.error("Fetch failed", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPerformance();
  }, [startDate]);

  const formatPct = (val: number) => (val * 100).toFixed(1) + "%";
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <PageLayout title="Performance Analytics">
      <div className="space-y-6">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/wfm" className="hover:text-primary transition-colors">Workforce Management</Link>
          <span>/</span>
          <span className="text-foreground font-medium">Performance Analytics</span>
        </nav>

        {/* Filters Bar */}
        <div className="bg-card border rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Date:</span>
              <input 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-background border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              />
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input 
                type="text" 
                placeholder="Search queues..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-1.5 bg-background border rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none w-64"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-4 py-1.5 border rounded-lg text-sm font-medium hover:bg-accent transition-colors">
              <Download className="size-4" />
              Export CSV
            </button>
            <button className="flex items-center gap-2 px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:shadow-md transition-all">
              <Filter className="size-4" />
              Advanced Filters
            </button>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[2000px]">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider sticky left-0 bg-muted/50 z-10 border-r">Interval Start</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r">Interval End</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r">Offer</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r">Answer</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r">Answer %</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r text-rose-600">Abandon</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r text-rose-600">Abandon %</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r text-blue-600">ASA</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r text-emerald-600">SL %</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r">Target</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r">Avg Wait</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r font-bold text-primary">Avg Handle</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r">Avg Talk</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r">Avg Hold</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r">Avg ACW</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r">Hold #</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-r">Xfer #</th>
                  <th className="p-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">S.Abandon</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  Array(10).fill(0).map((_, i) => (
                    <tr key={i}>
                      {Array(18).fill(0).map((_, j) => (
                        <td key={j} className="p-3"><div className="h-4 bg-muted animate-pulse rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={18} className="p-12 text-center text-muted-foreground">No data found for the selected criteria.</td>
                  </tr>
                ) : (
                  data.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3 text-xs font-mono sticky left-0 bg-card border-r z-10">{row.interval_start}</td>
                      <td className="p-3 text-xs font-mono border-r">{row.interval_end}</td>
                      <td className="p-3 text-sm font-semibold border-r text-right tabular-nums">{row.offer}</td>
                      <td className="p-3 text-sm font-semibold border-r text-right tabular-nums">{row.answer}</td>
                      <td className="p-3 text-xs border-r text-right tabular-nums text-muted-foreground">{formatPct(row.answer_pct)}</td>
                      <td className="p-3 text-sm font-semibold border-r text-right tabular-nums text-rose-600">{row.abandon || "—"}</td>
                      <td className="p-3 text-xs border-r text-right tabular-nums text-rose-500">{row.abandon > 0 ? formatPct(row.abandon_pct) : "—"}</td>
                      <td className="p-3 text-sm font-bold border-r text-right tabular-nums text-blue-600">{row.asa}s</td>
                      <td className={`p-3 text-sm font-bold border-r text-right tabular-nums ${row.sl_pct >= row.sl_target ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {formatPct(row.sl_pct)}
                      </td>
                      <td className="p-3 text-xs border-r text-right tabular-nums text-muted-foreground">{formatPct(row.sl_target)}</td>
                      <td className="p-3 text-xs border-r text-right tabular-nums">{row.avg_wait}s</td>
                      <td className="p-3 text-sm font-black border-r text-right tabular-nums text-primary">{row.avg_handle}s</td>
                      <td className="p-3 text-xs border-r text-right tabular-nums">{row.avg_talk}s</td>
                      <td className="p-3 text-xs border-r text-right tabular-nums">{row.avg_hold}s</td>
                      <td className="p-3 text-xs border-r text-right tabular-nums">{row.avg_acw}s</td>
                      <td className="p-3 text-xs border-r text-right tabular-nums">{row.hold_count || "—"}</td>
                      <td className="p-3 text-xs border-r text-right tabular-nums">{row.transfer_count || "—"}</td>
                      <td className="p-3 text-xs text-right tabular-nums">{row.short_abandon || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          {/* Pagination */}
          <div className="p-4 border-t bg-muted/20 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Showing 1 to {data.length} of {data.length} intervals</p>
            <div className="flex items-center gap-2">
              <button disabled className="p-1.5 rounded-md border bg-muted/50 text-muted-foreground cursor-not-allowed"><ChevronLeft className="size-4" /></button>
              <button className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-bold">1</button>
              <button disabled className="p-1.5 rounded-md border hover:bg-accent transition-colors"><ChevronRight className="size-4" /></button>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
