import { useEffect, useMemo, useState, type ElementType } from "react";
import { AlertTriangle, Activity, Clock, FileText, Loader2, RefreshCw, Send, ShieldAlert, Users } from "lucide-react";
import { toast } from "sonner";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import { useLOB, CHANNEL_OPTIONS, type ChannelKey } from "../lib/lobContext";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";

type Risk = "normal" | "watch" | "alert" | "critical";

interface RtmInterval {
  interval_index: number;
  interval_start: string;
  required_fte: number;
  scheduled_fte: number;
  staffing_gap: number;
  actual_volume: number | null;
  actual_aht: number | null;
  forecast_volume: number | null;
  forecast_variance_pct: number | null;
  risk: Risk;
}

interface RtmAction {
  id: number;
  interval_index: number | null;
  action_type: string;
  note: string;
  created_by: string | null;
  created_at: string;
}

interface RtmDashboard {
  date: string;
  channel: string;
  data_mode: "traffic_only" | "not_configured" | "live_agent_status";
  interval_minutes: number;
  current_interval_index: number;
  integration: {
    agent_status_available: boolean;
    queue_actuals_available: boolean;
  };
  snapshot: { id: number; label: string | null } | null;
  summary: {
    current_risk: Risk;
    current_required_fte: number;
    current_scheduled_fte: number;
    current_staffing_gap: number;
    open_gap_intervals: number;
    critical_intervals: number;
    total_actual_volume: number;
    action_count: number;
  };
  intervals: RtmInterval[];
  actions: RtmAction[];
}

const riskStyles: Record<Risk, string> = {
  normal: "bg-emerald-50 text-emerald-800 border-emerald-200",
  watch: "bg-amber-50 text-amber-800 border-amber-200",
  alert: "bg-orange-50 text-orange-800 border-orange-200",
  critical: "bg-red-50 text-red-800 border-red-200",
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtNum(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function modeLabel(mode: RtmDashboard["data_mode"]) {
  if (mode === "live_agent_status") return "Live agent status";
  if (mode === "traffic_only") return "Traffic only";
  return "Not configured";
}

function KpiCard({ icon: Icon, label, value, subtext }: { icon: ElementType; label: string; value: string; subtext?: string }) {
  return (
    <Card className="gap-3 rounded-lg">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#0072B1]/10 text-[#0072B1]">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-semibold text-black">{value}</p>
          {subtext && <p className="mt-0.5 truncate text-xs text-slate-500">{subtext}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function RealTimeManagement() {
  const { activeLob, activeChannel, setActiveChannel } = useLOB();
  const [date, setDate] = useState(todayStr());
  const [channel, setChannel] = useState<ChannelKey>(activeChannel);
  const [dashboard, setDashboard] = useState<RtmDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [actionType, setActionType] = useState("staffing_action");
  const [savingAction, setSavingAction] = useState(false);

  useEffect(() => {
    setChannel(activeChannel);
  }, [activeChannel]);

  const currentInterval = useMemo(() => {
    if (!dashboard) return null;
    return dashboard.intervals.find(i => i.interval_index === dashboard.current_interval_index) || dashboard.intervals[0] || null;
  }, [dashboard]);

  const focusIntervals = useMemo(() => {
    if (!dashboard) return [];
    const current = dashboard.current_interval_index;
    return dashboard.intervals.filter(i =>
      Math.abs(i.interval_index - current) <= 8 ||
      i.risk === "critical" ||
      i.risk === "alert"
    );
  }, [dashboard]);

  async function loadDashboard() {
    if (!activeLob) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/rtm/dashboard?lob_id=${activeLob.id}&date=${date}&channel=${channel}`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      setDashboard(await res.json());
    } catch {
      toast.error("Failed to load Real Time Management dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLob?.id, date, channel]);

  async function saveAction() {
    if (!activeLob || !dashboard || !note.trim()) return;
    setSavingAction(true);
    try {
      const res = await fetch(apiUrl("/api/rtm/action-logs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          lob_id: activeLob.id,
          channel,
          interval_date: date,
          interval_index: dashboard.current_interval_index,
          action_type: actionType,
          note,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNote("");
      toast.success("RTM action logged.");
      await loadDashboard();
    } catch {
      toast.error("Failed to save RTM action.");
    } finally {
      setSavingAction(false);
    }
  }

  return (
    <PageLayout title="Real Time Management">
      <div className="py-5 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-[.16em] text-slate-500">RTA & Traffic</p>
            <h2 className="mt-1 text-2xl font-semibold text-black">Live traffic control</h2>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-black">Date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 w-[150px] text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-black">Channel</Label>
              <Select value={channel} onValueChange={(v) => { setChannel(v as ChannelKey); setActiveChannel(v as ChannelKey); }}>
                <SelectTrigger className="h-9 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNEL_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={loadDashboard} disabled={loading}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Refresh
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">Hybrid RTM mode</p>
              <p className="mt-0.5">
                {dashboard?.integration.queue_actuals_available
                  ? "Agent status is not connected for this LOB. This view shows traffic and staffing risk from queue actuals, approved intraday staffing, and published schedules."
                  : "Agent status and queue actuals are not connected for this LOB. This view shows schedule coverage against approved intraday staffing until traffic data is available."}
              </p>
            </div>
          </div>
        </div>

        {loading && !dashboard ? (
          <div className="flex h-64 items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading RTM dashboard...
          </div>
        ) : dashboard ? (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <Card className={`gap-3 rounded-lg border ${riskStyles[dashboard.summary.current_risk]}`}>
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide">Current risk</p>
                  <p className="mt-2 text-2xl font-semibold capitalize">{dashboard.summary.current_risk}</p>
                  <p className="mt-1 text-xs">Interval {currentInterval?.interval_start ?? "-"}</p>
                </CardContent>
              </Card>
              <KpiCard icon={Users} label="Scheduled" value={fmtNum(dashboard.summary.current_scheduled_fte)} subtext="Published shifts" />
              <KpiCard icon={Activity} label="Required" value={fmtNum(dashboard.summary.current_required_fte, 1)} subtext="Approved intraday FTE" />
              <KpiCard icon={AlertTriangle} label="Staffing gap" value={fmtNum(dashboard.summary.current_staffing_gap, 1)} subtext={`${dashboard.summary.open_gap_intervals} intervals below plan`} />
              <KpiCard icon={FileText} label="Actual volume" value={fmtNum(dashboard.summary.total_actual_volume)} subtext={modeLabel(dashboard.data_mode)} />
            </div>

            <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
              <Card className="rounded-lg">
                <CardHeader className="px-4 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base text-black">Interval traffic and staffing</CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-xs">{modeLabel(dashboard.data_mode)}</Badge>
                      <Badge variant="outline" className="text-xs">
                        {dashboard.snapshot ? `Snapshot #${dashboard.snapshot.id}` : "No approved staffing snapshot"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <Table containerClassName="max-h-[540px] overflow-auto rounded-md border">
                    <TableHeader className="sticky top-0 z-10 bg-white">
                      <TableRow>
                        <TableHead className="w-[90px] text-xs">Time</TableHead>
                        <TableHead className="text-right text-xs">Actual</TableHead>
                        <TableHead className="text-right text-xs">AHT</TableHead>
                        <TableHead className="text-right text-xs">Required</TableHead>
                        <TableHead className="text-right text-xs">Scheduled</TableHead>
                        <TableHead className="text-right text-xs">Gap</TableHead>
                        <TableHead className="text-xs">Risk</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {focusIntervals.map(row => (
                        <TableRow key={row.interval_index} className={row.interval_index === dashboard.current_interval_index ? "bg-blue-50" : ""}>
                          <TableCell className="font-mono text-xs">{row.interval_start}</TableCell>
                          <TableCell className="text-right text-xs">{fmtNum(row.actual_volume)}</TableCell>
                          <TableCell className="text-right text-xs">{row.actual_aht ? `${row.actual_aht}s` : "-"}</TableCell>
                          <TableCell className="text-right text-xs">{fmtNum(row.required_fte, 1)}</TableCell>
                          <TableCell className="text-right text-xs">{fmtNum(row.scheduled_fte)}</TableCell>
                          <TableCell className={`text-right text-xs font-semibold ${row.staffing_gap < 0 ? "text-red-700" : "text-emerald-700"}`}>
                            {fmtNum(row.staffing_gap, 1)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`capitalize ${riskStyles[row.risk]}`}>{row.risk}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="mt-2 text-xs text-slate-500">
                    Showing current-window intervals plus alert and critical exceptions.
                  </p>
                </CardContent>
              </Card>

              <Card className="rounded-lg">
                <CardHeader className="px-4 pt-4">
                  <CardTitle className="text-base text-black">Supervisor action log</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 px-4 pb-4">
                  <div className="space-y-2">
                    <Select value={actionType} onValueChange={setActionType}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="staffing_action">Staffing action</SelectItem>
                        <SelectItem value="client_update">Client update</SelectItem>
                        <SelectItem value="system_issue">System issue</SelectItem>
                        <SelectItem value="note">Note</SelectItem>
                      </SelectContent>
                    </Select>
                    <Textarea
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="Log VTO, OT request, coaching moved, client escalation, outage, or other RTM action."
                      className="min-h-24 text-sm"
                    />
                    <Button className="w-full gap-1.5" size="sm" onClick={saveAction} disabled={savingAction || !note.trim()}>
                      {savingAction ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                      Log action
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {dashboard.actions.length === 0 ? (
                      <div className="rounded-md border border-dashed p-4 text-sm text-slate-500">No RTM actions logged for this date.</div>
                    ) : dashboard.actions.map(action => (
                      <div key={action.id} className="rounded-md border bg-white p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline" className="capitalize">{action.action_type.replace("_", " ")}</Badge>
                          <span className="flex items-center gap-1 text-[11px] text-slate-500">
                            <Clock className="size-3" />
                            {new Date(action.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-black">{action.note}</p>
                        <p className="mt-1 text-xs text-slate-500">{action.created_by || "User"}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
            Select an LOB to load Real Time Management.
          </div>
        )}
      </div>
    </PageLayout>
  );
}
