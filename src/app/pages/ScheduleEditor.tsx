import React, { useEffect, useState, useMemo, useCallback } from "react";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import { useLOB } from "../lib/lobContext";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, RotateCcw, Filter, CalendarDays, Users, Clock3, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { ScheduleGrid } from "../components/schedule/ScheduleGrid";
import { CoverageGraph } from "../components/schedule/CoverageGraph";
import { Assignment } from "../components/schedule/ShiftBlock";
import { Activity } from "../components/schedule/ActivityBlock";

// ── Date utilities ───────────────────────────────────────────────────────────

function getMondayOf(d: Date): Date {
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day);
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(d.getDate() + n);
  return r;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Intraday FTE helpers ─────────────────────────────────────────────────────

function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ── Agent & template types ───────────────────────────────────────────────────

interface Agent {
  id: number;
  full_name: string;
  skill_voice: boolean;
  skill_chat: boolean;
  skill_email: boolean;
  status: string;
}

interface ShiftTemplate {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  color: string;
  channel_coverage: string[];
  break_rules: Array<{ name: string; duration_minutes: number; after_hours: number; is_paid: boolean }>;
}

// ── Add Shift Dialog ─────────────────────────────────────────────────────────

interface AddShiftDialogProps {
  open: boolean;
  onClose: () => void;
  agents: Agent[];
  templates: ShiftTemplate[];
  prefillAgentId?: number;
  prefillStart?: string;
  onSave: (fields: {
    agent_id: number;
    shift_template_id: number | null;
    start_time: string;
    end_time: string;
    channel: string;
    notes: string;
  }) => void;
}

function AddShiftDialog({ open, onClose, agents, templates, prefillAgentId, prefillStart, onSave }: AddShiftDialogProps) {
  const [agentId, setAgentId] = useState<string>(prefillAgentId ? String(prefillAgentId) : "");
  const [templateId, setTemplateId] = useState<string>("");
  const [start, setStart] = useState(prefillStart ?? "08:00");
  const [end, setEnd] = useState("17:00");
  const [channel, setChannel] = useState("voice");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setAgentId(prefillAgentId ? String(prefillAgentId) : "");
      setStart(prefillStart ?? "08:00");
      setEnd("17:00");
      setTemplateId("");
      setChannel("voice");
      setNotes("");
    }
  }, [open, prefillAgentId, prefillStart]);

  const applyTemplate = (tid: string) => {
    setTemplateId(tid);
    const t = templates.find(t => String(t.id) === tid);
    if (t) {
      setStart(t.start_time);
      setEnd(t.end_time);
      if (t.channel_coverage[0]) setChannel(t.channel_coverage[0]);
    }
  };

  const valid = agentId && start && end;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Shift</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1">
            <Label>Agent <span className="text-destructive">*</span></Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger><SelectValue placeholder="Select agent…" /></SelectTrigger>
              <SelectContent>
                {agents.filter(a => a.status === "active").map(a => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Shift Template <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Select value={templateId} onValueChange={applyTemplate}>
              <SelectTrigger><SelectValue placeholder="Choose template to pre-fill…" /></SelectTrigger>
              <SelectContent>
                {templates.map(t => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.start_time}–{t.end_time})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label>Start Time <span className="text-destructive">*</span></Label>
              <Input type="time" step={900} value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>End Time <span className="text-destructive">*</span></Label>
              <Input type="time" step={900} value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Channel</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="voice">Voice</SelectItem>
                <SelectItem value="chat">Chat</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!valid} onClick={() => {
            onSave({ agent_id: Number(agentId), shift_template_id: templateId ? Number(templateId) : null, start_time: start, end_time: end, channel, notes });
            onClose();
          }}>
            Add Shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function ScheduleEditor() {
  const { activeLob } = useLOB();

  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOf(new Date()));
  const [activeDayIdx, setActiveDayIdx] = useState(0); // 0=Mon … 6=Sun
  const [agentQuery, setAgentQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState<"all" | "voice" | "chat" | "email">("all");

  const [agents, setAgents]           = useState<Agent[]>([]);
  const [templates, setTemplates]     = useState<ShiftTemplate[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [requiredFte, setRequiredFte] = useState<number[] | undefined>(undefined);

  const [loading, setLoading]         = useState(true);
  const [addOpen, setAddOpen]         = useState(false);
  const [prefillAgent, setPrefillAgent] = useState<number | undefined>();
  const [prefillStart, setPrefillStart] = useState<string | undefined>();

  const weekDates = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const activeDate = toDateStr(weekDates[activeDayIdx]);
  const dateStart  = toDateStr(weekStart);
  const dateEnd    = toDateStr(weekDates[6]);

  // ── Data loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetch(apiUrl("/api/scheduling/agents")).then(r => r.json()),
      fetch(apiUrl("/api/scheduling/shift-templates")).then(r => r.json()),
    ]).then(([ag, tmpl]) => {
      if (Array.isArray(ag)) setAgents(ag);
      if (Array.isArray(tmpl)) setTemplates(tmpl);
    }).catch(() => toast.error("Failed to load agents or templates"));
  }, []);

  useEffect(() => {
    if (!activeLob) return;
    setLoading(true);
    fetch(apiUrl(`/api/scheduling/assignments?lob_id=${activeLob.id}&date_start=${dateStart}&date_end=${dateEnd}`))
      .then(r => r.json())
      .then(rows => { if (Array.isArray(rows)) setAssignments(rows); })
      .catch(() => toast.error("Failed to load schedule"))
      .finally(() => setLoading(false));
  }, [activeLob, dateStart, dateEnd]);

  // Load required FTE from demand planner snapshot
  useEffect(() => {
    if (!activeLob) return;
    fetch(apiUrl(`/api/demand-planner-active-state?lob_id=${activeLob.id}`))
      .then(r => r.json())
      .then(data => {
        const snap = data?.state_value?.plannerSnapshot;
        if (!snap?.fteTable) return;
        // fteTable is keyed by day label; pick first available day's data
        const days = Object.values(snap.fteTable) as Array<Array<{ fte: number }>>;
        if (!days.length) return;
        // Average required FTE across all days (representative week)
        const slots = days[0].length;
        const avgFte = Array.from({ length: Math.min(slots, 96) }, (_, i) => {
          const sum = days.reduce((acc, d) => acc + (d[i]?.fte ?? 0), 0);
          return sum / days.length;
        });
        // Pad to 96 if needed
        while (avgFte.length < 96) avgFte.push(0);
        setRequiredFte(avgFte);
      })
      .catch(() => {}); // non-fatal
  }, [activeLob]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const addShift = useCallback(async (fields: {
    agent_id: number;
    shift_template_id: number | null;
    start_time: string;
    end_time: string;
    channel: string;
    notes: string;
  }) => {
    if (!activeLob) return;
    try {
      const res = await fetch(apiUrl("/api/scheduling/assignments"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, lob_id: activeLob.id, work_date: activeDate }),
      });
      const row: Assignment = await res.json();
      // Enrich with agent/template info
      const agent = agents.find(a => a.id === row.agent_id);
      const tmpl  = templates.find(t => t.id === row.shift_template_id);
      const enriched: Assignment = {
        ...row,
        agent_name: agent?.full_name ?? "",
        skill_voice: agent?.skill_voice ?? false,
        skill_chat: agent?.skill_chat ?? false,
        skill_email: agent?.skill_email ?? false,
        template_name: tmpl?.name ?? null,
        template_color: tmpl?.color ?? null,
        activities: [],
      };

      // Auto-add break rules from template
      if (tmpl?.break_rules?.length) {
        const shiftStartMins = timeToMins(fields.start_time);
        for (const rule of tmpl.break_rules) {
          const breakStartMins = shiftStartMins + rule.after_hours * 60;
          const breakEndMins   = breakStartMins + rule.duration_minutes;
          const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          try {
            const actRes = await fetch(apiUrl("/api/scheduling/activities"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                assignment_id: enriched.id,
                activity_type: rule.duration_minutes >= 30 ? "meal" : "break",
                start_time: toTime(breakStartMins),
                end_time: toTime(breakEndMins),
                is_paid: rule.is_paid,
                notes: rule.name,
              }),
            });
            const act = await actRes.json();
            enriched.activities.push(act);
          } catch {}
        }
      }

      setAssignments(prev => [...prev, enriched]);
    } catch { toast.error("Failed to add shift"); }
  }, [activeLob, activeDate, agents, templates]);

  const moveShift = useCallback(async (id: number, newStart: string, newEnd: string) => {
    const prev = assignments.find(a => a.id === id);
    if (!prev) return;

    // Optimistic update
    setAssignments(all => all.map(a => a.id === id ? { ...a, start_time: newStart, end_time: newEnd } : a));

    try {
      await fetch(apiUrl(`/api/scheduling/assignments/${id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_time: newStart, end_time: newEnd, is_overnight: prev.is_overnight, channel: prev.channel, notes: prev.notes, shift_template_id: prev.shift_template_id }),
      });
    } catch {
      // Rollback
      setAssignments(all => all.map(a => a.id === id ? prev : a));
      toast.error("Failed to save shift move");
    }
  }, [assignments]);

  const updateTimes = useCallback(async (id: number, start: string, end: string) => {
    await moveShift(id, start, end);
  }, [moveShift]);

  const deleteShift = useCallback(async (id: number) => {
    setAssignments(prev => prev.filter(a => a.id !== id));
    try {
      await fetch(apiUrl(`/api/scheduling/assignments/${id}`), { method: "DELETE" });
    } catch { toast.error("Failed to delete shift"); }
  }, []);

  const addActivity = useCallback(async (assignmentId: number, act: Omit<Activity, "id" | "assignment_id">) => {
    try {
      const res = await fetch(apiUrl("/api/scheduling/activities"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment_id: assignmentId, ...act }),
      });
      const newAct: Activity = await res.json();
      setAssignments(prev => prev.map(a =>
        a.id === assignmentId ? { ...a, activities: [...a.activities, newAct] } : a
      ));
    } catch { toast.error("Failed to add activity"); }
  }, []);

  const updateActivity = useCallback(async (id: number, fields: Partial<Activity>) => {
    setAssignments(prev => prev.map(a => ({
      ...a,
      activities: a.activities.map(act => act.id === id ? { ...act, ...fields } : act),
    })));
    try {
      const existing = assignments.flatMap(a => a.activities).find(act => act.id === id);
      if (!existing) return;
      await fetch(apiUrl(`/api/scheduling/activities/${id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...existing, ...fields }),
      });
    } catch { toast.error("Failed to update activity"); }
  }, [assignments]);

  const deleteActivity = useCallback(async (assignmentId: number, activityId: number) => {
    setAssignments(prev => prev.map(a =>
      a.id === assignmentId ? { ...a, activities: a.activities.filter(act => act.id !== activityId) } : a
    ));
    try {
      await fetch(apiUrl(`/api/scheduling/activities/${activityId}`), { method: "DELETE" });
    } catch { toast.error("Failed to delete activity"); }
  }, []);

  // ── Grid click → open add dialog pre-filled ──────────────────────────────

  const handleGridAddShift = useCallback((agentId: number, startTime: string) => {
    setPrefillAgent(agentId);
    setPrefillStart(startTime);
    setAddOpen(true);
  }, []);

  // ── Counts for header badges ──────────────────────────────────────────────

  const activeAgents = useMemo(() =>
    agents.filter(a => a.status === "active"),
    [agents]
  );

  const visibleAgents = useMemo(() => {
    const query = agentQuery.trim().toLowerCase();
    return activeAgents.filter((agent) => {
      const matchesQuery = !query || agent.full_name.toLowerCase().includes(query);
      const matchesSkill =
        skillFilter === "all" ||
        (skillFilter === "voice" && agent.skill_voice) ||
        (skillFilter === "chat" && agent.skill_chat) ||
        (skillFilter === "email" && agent.skill_email);
      return matchesQuery && matchesSkill;
    });
  }, [activeAgents, agentQuery, skillFilter]);

  const todayShiftCount = useMemo(() =>
    assignments.filter(a => a.work_date?.startsWith(activeDate)).length,
    [assignments, activeDate]
  );

  const visibleShiftCount = useMemo(() =>
    assignments.filter(a => a.work_date?.startsWith(activeDate) && visibleAgents.some(agent => agent.id === a.agent_id)).length,
    [assignments, activeDate, visibleAgents]
  );

  const coverageRate = useMemo(() => {
    if (!requiredFte || !requiredFte.length) return null;
    const scheduled = assignments.filter(a => a.work_date?.startsWith(activeDate)).length;
    const required = requiredFte.reduce((sum, v) => sum + (v ?? 0), 0) / requiredFte.length;
    if (!required) return null;
    return Math.min(999, Math.round((scheduled / required) * 100));
  }, [assignments, activeDate, requiredFte]);

  return (
    <PageLayout title="Schedule Editor">
      <div className="flex flex-col gap-5 pb-12 bg-gradient-to-b from-slate-50 via-white to-slate-100/70">

        {/* Hero toolbar */}
        <section className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-900 px-5 py-5 shadow-[0_20px_50px_rgba(15,23,42,0.20)] text-white">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-16 -right-20 h-48 w-48 rounded-full bg-cyan-400/20 blur-3xl" />
            <div className="absolute -bottom-16 left-1/3 h-56 w-56 rounded-full bg-sky-500/10 blur-3xl" />
          </div>

          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-4 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-0 bg-white/10 text-white">Exordium WFM</Badge>
                <Badge className="border-0 bg-cyan-400/15 text-cyan-100">{activeAgents.length} agents</Badge>
                <Badge className="border-0 bg-emerald-400/15 text-emerald-100">{todayShiftCount} shifts today</Badge>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-[0.45em] text-cyan-100/70 font-semibold">Schedule Editor</p>
                <h1 className="text-2xl lg:text-3xl font-black leading-tight">Schedule Editor</h1>
                <p className="max-w-2xl text-sm text-slate-200/80">
                  Plan weekly staffing, drag shifts across the timeline, and keep the roster aligned with coverage demand.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-[1.35fr_auto]">
                <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/8 p-3 backdrop-blur-sm">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                    <div className="relative flex-1 min-w-0">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/55" />
                      <Input
                        value={agentQuery}
                        onChange={(e) => setAgentQuery(e.target.value)}
                        placeholder="Search agents"
                        className="h-10 border-white/15 bg-white/10 pl-10 text-white placeholder:text-white/55 focus-visible:ring-cyan-300/60"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/8 p-1">
                        <button
                          type="button"
                          onClick={() => setWeekStart((d) => addDays(d, -7))}
                          className="rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                          aria-label="Previous week"
                        >
                          <ChevronLeft className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setWeekStart((d) => addDays(d, 7))}
                          className="rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                          aria-label="Next week"
                        >
                          <ChevronRight className="size-4" />
                        </button>
                      </div>
                      <Input
                        type="date"
                        value={activeDate}
                        onChange={(e) => {
                          const next = new Date(`${e.target.value}T00:00:00`);
                          if (Number.isNaN(next.getTime())) return;
                          const monday = getMondayOf(next);
                          setWeekStart(monday);
                          setActiveDayIdx(Math.max(0, Math.min(6, Math.floor((next.getTime() - monday.getTime()) / 86400000))));
                        }}
                        className="h-10 w-[160px] border-white/15 bg-white/10 text-white [color-scheme:dark]"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 gap-1.5 rounded-xl border border-white/10 bg-white/8 px-3 text-white hover:bg-white/12 hover:text-white"
                        onClick={() => { setWeekStart(getMondayOf(new Date())); setActiveDayIdx(0); }}
                      >
                        <RotateCcw className="size-3.5" />
                        This week
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/8 p-1">
                      <Filter className="ml-1 size-3.5 text-cyan-100/80" />
                      {(["all", "voice", "chat", "email"] as const).map((filter) => (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setSkillFilter(filter)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                            skillFilter === filter ? "bg-white text-slate-900 shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"
                          }`}
                        >
                          {filter}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-200/70">
                      <LayoutGrid className="size-3.5" />
                      <span>{visibleAgents.length} visible / {activeAgents.length} active agents</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:w-[420px]">
                  <div className="rounded-2xl border border-white/10 bg-white/8 p-3 backdrop-blur-sm">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-200/60">Visible</p>
                    <p className="mt-1 text-2xl font-black">{visibleAgents.length}</p>
                    <p className="text-xs text-slate-200/70">Agents</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/8 p-3 backdrop-blur-sm">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-200/60">Shifts</p>
                    <p className="mt-1 text-2xl font-black">{visibleShiftCount}</p>
                    <p className="text-xs text-slate-200/70">Today</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/8 p-3 backdrop-blur-sm">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-200/60">Coverage</p>
                    <p className="mt-1 text-2xl font-black">{coverageRate != null ? `${coverageRate}%` : "—"}</p>
                    <p className="text-xs text-slate-200/70">vs demand</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/8 p-3 backdrop-blur-sm">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-200/60">Window</p>
                    <p className="mt-1 text-2xl font-black">{formatDate(weekStart)}</p>
                    <p className="text-xs text-slate-200/70">Week start</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Day tabs */}
          <div className="relative mt-5 grid grid-cols-7 gap-2">
            {DAY_LABELS.map((label, i) => {
              const dayDate = weekDates[i];
              const count = assignments.filter(a => a.work_date?.startsWith(toDateStr(dayDate))).length;
              const isToday = toDateStr(dayDate) === toDateStr(new Date());
              const active = activeDayIdx === i;
              return (
                <button
                  key={label}
                  onClick={() => setActiveDayIdx(i)}
                  className={`rounded-2xl border px-3 py-2 text-left transition-all ${
                    active
                      ? "border-cyan-300 bg-white text-slate-900 shadow-lg shadow-cyan-950/20"
                      : "border-white/10 bg-white/10 text-white/85 hover:bg-white/15"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.28em]">{label}</span>
                    {isToday && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
                  </div>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <span className="text-sm font-semibold">{formatDate(dayDate)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${active ? "bg-cyan-100 text-cyan-900" : "bg-white/15 text-white"}`}>{count}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Schedule Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <Loader2 className="animate-spin size-5" />Loading schedule…
          </div>
        ) : activeAgents.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground text-sm">No active agents found.</p>
            <p className="text-xs text-muted-foreground mt-1">Add agents in the <a href="/scheduling/agents" className="underline text-primary">Agent Roster</a> first.</p>
          </div>
        ) : visibleAgents.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-10 text-center shadow-sm">
            <p className="text-sm font-semibold text-slate-700">No agents match the current search or skill filter.</p>
            <p className="mt-1 text-xs text-slate-500">Clear the search or switch back to All to view the full schedule.</p>
          </div>
        ) : (
          <ScheduleGrid
            agents={visibleAgents}
            assignments={assignments}
            activeDate={activeDate}
            onShiftMove={moveShift}
            onShiftDelete={deleteShift}
            onAddShift={handleGridAddShift}
            onAddActivity={addActivity}
            onUpdateActivity={updateActivity}
            onDeleteActivity={deleteActivity}
            onUpdateTimes={updateTimes}
          />
        )}

        {/* Coverage Graph */}
        <CoverageGraph
          assignments={assignments}
          activeDate={activeDate}
          requiredFte={requiredFte}
        />

      </div>

      {/* Add Shift Dialog */}
      <AddShiftDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        agents={agents}
        templates={templates}
        prefillAgentId={prefillAgent}
        prefillStart={prefillStart}
        onSave={addShift}
      />
    </PageLayout>
  );
}
