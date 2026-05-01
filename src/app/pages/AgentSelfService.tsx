import { useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, CalendarDays, ChevronLeft, ChevronRight, Clock, Coffee, Loader2, LogIn, LogOut, RefreshCw, Send, Utensils } from "lucide-react";
import { toast } from "sonner";
import { PageLayout } from "../components/PageLayout";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { apiUrl } from "../lib/api";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

interface PunchAction {
  label: string;
  activity_type: string;
  punch_action: string;
  shift_activity_id?: number | null;
}

interface ScheduleInterval {
  schedule_activity_id: number | null;
  activity_type: string;
  label: string;
  start: string;
  end: string;
  scheduled_start?: string;
  scheduled_end?: string;
  is_paid?: boolean | null;
  notes?: string | null;
}

interface AgentToday {
  date: string;
  agent: { id: number; full_name: string; team_name?: string | null };
  assignment: { id: number; start_time: string; end_time: string; channel: string; status?: string; team_name?: string | null } | null;
  schedule: ScheduleInterval[];
  current_scheduled_activity: ScheduleInterval | null;
  current_status: {
    is_logged_in: boolean;
    current_status: string;
    current_status_label: string;
    current_status_started_at: string | null;
    last_punch: { punched_at: string; activity_type: string; punch_action: string } | null;
  };
  adherence: {
    scheduled_activity_label: string | null;
    current_status_label: string;
    adherence_state: string;
    variance_minutes: number | null;
  };
  valid_actions: PunchAction[];
  punches: Array<{ id: number; activity_type: string; punch_action: string; punched_at: string; notes: string | null }>;
  settings: { grace_period_minutes: number; manual_mode_enabled: boolean };
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function labelize(value: string | null | undefined) {
  if (!value) return "-";
  return value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function fmtDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function intervalStart(item: ScheduleInterval) {
  return item.scheduled_start || item.start;
}

function intervalEnd(item: ScheduleInterval) {
  return item.scheduled_end || item.end;
}

function minutesBetween(start: string, end: string) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

function stateClass(state: string | undefined) {
  if (state === "in_adherence") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (state === "missing_punch" || state === "late_login" || state === "early_logout") return "border-red-200 bg-red-50 text-red-800";
  if (state?.includes("break") || state?.includes("lunch")) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function activityClass(type: string) {
  if (type.includes("break")) return "border-amber-200 bg-amber-50 text-amber-800";
  if (type.includes("lunch") || type.includes("meal")) return "border-orange-200 bg-orange-50 text-orange-800";
  if (type.includes("queue") || type.includes("work")) return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function activityIcon(type: string) {
  if (type.includes("break")) return <Coffee className="size-4" />;
  if (type.includes("lunch") || type.includes("meal")) return <Utensils className="size-4" />;
  return <BriefcaseBusiness className="size-4" />;
}

export function AgentSelfService() {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState<AgentToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const isToday = date === todayStr();

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/agent/self-service/today?date=${date}`), { credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load schedule");
      setData(body);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setData(null);
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function punch(action: PunchAction) {
    setSaving(true);
    try {
      const res = await fetch(apiUrl("/api/agent/self-service/punch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          date,
          activity_type: action.activity_type,
          punch_action: action.punch_action,
          shift_activity_id: action.shift_activity_id ?? null,
          timezone,
          notes: notes.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Punch failed");
      setNotes("");
      toast.success("Status punch saved.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save punch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProtectedRoute roles={["agent"]}>
      <PageLayout title="My Schedule">
        <div className="space-y-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-mono uppercase tracking-[.16em] text-slate-500">Agent self-service</p>
              <h2 className="mt-1 text-2xl font-semibold text-black">My Schedule</h2>
              <p className="mt-1 text-sm text-slate-500">Published shift details and manual adherence status.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDate(addDays(date, -1))}>
                <ChevronLeft className="size-3.5" />
                Prev
              </Button>
              <Input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value || todayStr())}
                className="h-9 w-[150px] text-sm"
              />
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDate(todayStr())}>
                <CalendarDays className="size-3.5" />
                Today
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDate(addDays(date, 1))}>
                Next
                <ChevronRight className="size-3.5" />
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={load} disabled={loading}>
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Refresh
              </Button>
            </div>
          </div>

          {loading && !data ? (
            <div className="flex h-64 items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading schedule...
            </div>
          ) : data ? (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <Card className="rounded-lg">
                  <CardContent className="p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Agent</p>
                    <p className="mt-2 text-xl font-semibold text-black">{data.agent.full_name}</p>
                    <p className="mt-1 text-xs text-slate-500">{data.agent.team_name || "No team assigned"}</p>
                  </CardContent>
                </Card>
                <Card className="rounded-lg">
                  <CardContent className="p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Selected date</p>
                    <p className="mt-2 text-xl font-semibold text-black">{fmtDate(date)}</p>
                    <p className="mt-1 text-xs text-slate-500">{data.assignment ? `${data.assignment.start_time.slice(0, 5)} - ${data.assignment.end_time.slice(0, 5)} ${labelize(data.assignment.channel)}` : "No published shift"}</p>
                  </CardContent>
                </Card>
                <Card className={`rounded-lg border ${stateClass(data.adherence.adherence_state)}`}>
                  <CardContent className="p-4">
                    <p className="text-xs font-medium uppercase tracking-wide">Adherence</p>
                    <p className="mt-2 text-xl font-semibold">{labelize(data.adherence.adherence_state)}</p>
                    <p className="mt-1 text-xs">Grace: {data.settings.grace_period_minutes} min</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
                <Card className="rounded-lg">
                  <CardHeader className="px-4 pt-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base text-black">Published schedule</CardTitle>
                        <p className="mt-1 text-sm text-slate-500">{fmtDate(date)}</p>
                      </div>
                      {data.assignment && (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                          Published
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {data.schedule.length === 0 ? (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-slate-500">No published schedule for this date.</div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="rounded-md border bg-white p-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Login</p>
                            <p className="mt-1 font-mono text-lg text-black">{fmtTime(data.schedule[0] ? intervalStart(data.schedule[0]) : undefined)}</p>
                          </div>
                          <div className="rounded-md border bg-white p-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Logout</p>
                            <p className="mt-1 font-mono text-lg text-black">{fmtTime(data.schedule[data.schedule.length - 1] ? intervalEnd(data.schedule[data.schedule.length - 1]) : undefined)}</p>
                          </div>
                          <div className="rounded-md border bg-white p-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Channel</p>
                            <p className="mt-1 text-lg font-semibold text-black">{labelize(data.assignment?.channel)}</p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {data.schedule.map((item, idx) => {
                            const start = intervalStart(item);
                            const end = intervalEnd(item);
                            const isCurrent = isToday && data.current_scheduled_activity?.scheduled_start === item.scheduled_start && data.current_scheduled_activity?.scheduled_end === item.scheduled_end && data.current_scheduled_activity?.activity_type === item.activity_type;
                            return (
                              <div key={`${item.schedule_activity_id ?? "queue"}-${start}-${idx}`} className={`rounded-md border p-3 ${isCurrent ? "border-blue-500 bg-blue-50 shadow-sm" : "bg-white"}`}>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="flex items-center gap-3">
                                    <div className={`flex size-9 items-center justify-center rounded-md border ${activityClass(item.activity_type)}`}>
                                      {activityIcon(item.activity_type)}
                                    </div>
                                    <div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-semibold text-black">{item.label}</p>
                                        {isCurrent && <Badge className="bg-blue-600 text-white">Current</Badge>}
                                      </div>
                                      <p className="text-xs text-slate-500">{minutesBetween(start, end)} min{item.notes ? ` - ${item.notes}` : ""}</p>
                                    </div>
                                  </div>
                                  <div className="font-mono text-sm text-slate-700">{fmtTime(start)} - {fmtTime(end)}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-lg">
                  <CardHeader className="px-4 pt-4">
                    <CardTitle className="text-base text-black">Punch status</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 px-4 pb-4">
                    <div className="rounded-md border bg-slate-50 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Actual status</p>
                      <p className="mt-1 text-lg font-semibold text-black">{data.current_status.current_status_label}</p>
                      <p className="mt-1 text-xs text-slate-500">Since {fmtTime(data.current_status.current_status_started_at)}</p>
                    </div>
                    <Textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="Optional note for this punch"
                      className="min-h-20 text-sm"
                    />
                    <div className="grid gap-2">
                      {data.valid_actions.map(action => (
                        <Button key={`${action.punch_action}-${action.activity_type}-${action.shift_activity_id ?? "none"}`} className="justify-start gap-2" onClick={() => punch(action)} disabled={saving}>
                          {action.punch_action === "login" ? <LogIn className="size-4" /> : action.punch_action === "logout" ? <LogOut className="size-4" /> : <Send className="size-4" />}
                          {action.label}
                        </Button>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                        <Clock className="size-3.5" /> Latest punches
                      </div>
                      {data.punches.length === 0 ? (
                        <div className="rounded-md border border-dashed p-3 text-sm text-slate-500">No punches yet.</div>
                      ) : data.punches.slice(-5).reverse().map(p => (
                        <div key={p.id} className="rounded-md border bg-white p-3 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant="outline">{labelize(p.punch_action)}</Badge>
                            <span className="font-mono text-xs text-slate-500">{fmtTime(p.punched_at)}</span>
                          </div>
                          <p className="mt-1 font-medium text-black">{labelize(p.activity_type)}</p>
                          {p.notes && <p className="mt-1 text-xs text-slate-500">{p.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : null}
        </div>
      </PageLayout>
    </ProtectedRoute>
  );
}
