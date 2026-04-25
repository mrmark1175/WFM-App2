import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import { useLOB } from "../lib/lobContext";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, RotateCcw, Filter, Upload, CalendarDays, Calendar, Wand2, Send, HelpCircle, Eraser, Settings2 } from "lucide-react";
import { erlangC, erlangServiceLevel } from "./intraday-distribution-logic";
import { toast } from "sonner";
import { ScheduleGrid } from "../components/schedule/ScheduleGrid";
import { WeeklyScheduleGrid } from "../components/schedule/WeeklyScheduleGrid";
import { Assignment } from "../components/schedule/ShiftBlock";
import { Activity, ActivityType } from "../components/schedule/ActivityBlock";

// ── Date utilities ───────────────────────────────────────────────────────────

function getMondayOf(d: Date): Date {
  const day = d.getDay();
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
  // Use local date components to avoid UTC-offset day shift for UTC+ timezones.
  // toISOString() converts local midnight to UTC, which rolls back to the previous
  // day for any UTC+ timezone (e.g. UTC+8: Mon 00:00 local → Sun 16:00 UTC).
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFullDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOW_SCHEDULE_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function toTime(m: number): string {
  const wrapped = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function isOvernightTimes(start: string, end: string): boolean {
  return end !== start && timeToMins(end) <= timeToMins(start);
}

const BREAK_MEAL_DRIFT_LIMIT_MINS = 30;
const BREAK_MEAL_INCREMENT_MINS = 15;

function getForwardMinsDiff(start: number, end: number): number {
  return end >= start ? end - start : end + 1440 - start;
}

function snapToIncrement(mins: number, increment: number): number {
  return Math.round(mins / increment) * increment;
}

// ── Types ───────────────────────────────────────────────────────────────────

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

interface ClipboardShift {
  shift_template_id: number | null;
  start_time: string;
  end_time: string;
  channel: string;
  template_color: string | null;
  template_name: string | null;
  activities: Array<{ activity_type: ActivityType; offset_mins: number; duration_mins: number; is_paid: boolean; notes: string | null }>;
}

type UndoAction =
  | { type: "add"; assignmentId: number }
  | { type: "delete"; assignment: Assignment }
  | { type: "move"; assignmentId: number; prevStart: string; prevEnd: string; prevAgentId: number; prevWorkDate: string; prevActivities: Activity[] }
  | { type: "addActivity"; activityId: number; assignmentId: number }
  | { type: "updateActivity"; activityId: number; prevFields: Partial<Activity> };

// ── KPI tile ─────────────────────────────────────────────────────────────────

interface KpiTileProps {
  label: string;
  value: string | number;
  accent: string;
}

function KpiTile({ label, value, accent }: KpiTileProps) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-lg px-3 py-1.5 min-w-[56px] ${accent}`}>
      <span className="text-lg font-black leading-none">{value}</span>
      <span className="text-[10px] uppercase tracking-widest font-semibold mt-0.5 opacity-80">{label}</span>
    </div>
  );
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
                <SelectItem value="cases">Cases</SelectItem>
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

// ── Auto-Generate Dialog ─────────────────────────────────────────────────────

interface DemandSnapshot {
  id: number;
  snapshot_label: string | null;
  interval_minutes: number;
  approved_at: string;
}

interface AutoGenerateDialogProps {
  open: boolean;
  onClose: () => void;
  lobId: number | null;
  initialStart: string;
  onGenerated: (result: { run_id: number; draft_count: number; coverage_report: any }) => void;
}

function AutoGenerateDialog({ open, onClose, lobId, initialStart, onGenerated }: AutoGenerateDialogProps) {
  const [snapshots, setSnapshots] = useState<DemandSnapshot[]>([]);
  const [snapshotId, setSnapshotId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [localTemplates, setLocalTemplates] = useState<ShiftTemplate[]>([]);
  const [horizonStart, setHorizonStart] = useState(initialStart);
  const [horizonEnd, setHorizonEnd] = useState(() => {
    const d = new Date(initialStart + "T00:00:00");
    d.setDate(d.getDate() + 13);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [fairnessEnabled, setFairnessEnabled] = useState(false);
  const [clearPublished, setClearPublished] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open || !lobId) return;
    Promise.all([
      fetch(apiUrl(`/api/scheduling/demand-snapshots?lob_id=${lobId}`)).then(r => r.json()),
      fetch(apiUrl("/api/scheduling/shift-templates")).then(r => r.json()),
    ]).then(([snaps, tmpls]) => {
      if (Array.isArray(snaps)) {
        setSnapshots(snaps);
        if (snaps.length > 0) setSnapshotId(String(snaps[0].id));
      }
      if (Array.isArray(tmpls)) setLocalTemplates(tmpls);
    }).catch(() => toast.error("Failed to load snapshots or templates"));
    setHorizonStart(initialStart);
    const endDate = new Date(initialStart + "T00:00:00");
    endDate.setDate(endDate.getDate() + 13);
    setHorizonEnd(`${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`);
  }, [open, lobId, initialStart]);

  const valid = !!lobId && !!snapshotId && !!horizonStart && !!horizonEnd && horizonStart <= horizonEnd;

  async function runGenerate() {
    if (!valid) return;
    setRunning(true);
    try {
      const res = await fetch(apiUrl(`/api/scheduling/auto-generate`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lob_id: lobId,
          snapshot_id: Number(snapshotId),
          horizon_start: horizonStart,
          horizon_end: horizonEnd,
          fairness_enabled: fairnessEnabled,
          clear_published: clearPublished,
          template_id: templateId && templateId !== "none" ? Number(templateId) : null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      onGenerated(result);
      toast.success(`Generated ${result.draft_count} draft shifts (run #${result.run_id})`);
      onClose();
    } catch (err: any) {
      toast.error(`Generation failed: ${err?.message || err}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !running) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Auto-Generate Schedule</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1">
            <Label>Demand Snapshot <span className="text-destructive">*</span></Label>
            <Select value={snapshotId} onValueChange={setSnapshotId}>
              <SelectTrigger><SelectValue placeholder={snapshots.length === 0 ? "No approved snapshots" : "Choose snapshot…"} /></SelectTrigger>
              <SelectContent>
                {snapshots.map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    #{s.id} · {s.snapshot_label || "(unnamed)"} · {new Date(s.approved_at).toLocaleDateString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {snapshots.length === 0 && (
              <span className="text-xs text-muted-foreground">
                Approve a snapshot on the Intraday Forecast page first.
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label>Shift Template <span className="text-muted-foreground text-xs">(optional — sets break/lunch structure)</span></Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Use Rules page defaults…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Use Rules page defaults</SelectItem>
                {localTemplates.map(t => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name} ({t.start_time}–{t.end_time})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templateId && templateId !== "none" && (() => {
              const t = localTemplates.find(x => String(x.id) === templateId);
              if (!t?.break_rules?.length) return null;
              return (
                <span className="text-xs text-muted-foreground">
                  Breaks: {t.break_rules.map(r => `${r.name} (${r.duration_minutes}m @ +${r.after_hours}h)`).join(", ")}
                </span>
              );
            })()}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label>Horizon Start <span className="text-destructive">*</span></Label>
              <Input type="date" value={horizonStart} onChange={e => setHorizonStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Horizon End <span className="text-destructive">*</span></Label>
              <Input type="date" value={horizonEnd} onChange={e => setHorizonEnd(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fairnessEnabled} onChange={e => setFairnessEnabled(e.target.checked)} />
            Rotate rest days fairly across agents
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={clearPublished} onChange={e => setClearPublished(e.target.checked)} />
            Also replace PUBLISHED shifts in this horizon
          </label>
          <div className="text-xs text-muted-foreground border-l-2 border-amber-300 pl-2">
            {clearPublished
              ? "This will DELETE all existing shifts (drafts AND published) in the horizon and create new drafts."
              : "This will DELETE existing draft shifts in the horizon and create new ones. Published shifts are not affected."}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={running}>Cancel</Button>
          <Button size="sm" disabled={!valid || running} onClick={runGenerate}>
            {running ? <><Loader2 className="size-3.5 animate-spin mr-1" /> Generating…</> : "Generate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Publish Drafts Dialog ────────────────────────────────────────────────────

interface PublishDraftsDialogProps {
  open: boolean;
  onClose: () => void;
  lobId: number | null;
  dateStart: string;
  dateEnd: string;
  agents: Agent[];
  onPublished: () => void;
}

function PublishDraftsDialog({ open, onClose, lobId, dateStart, dateEnd, agents, onPublished }: PublishDraftsDialogProps) {
  const [scope, setScope] = useState<"site" | "team" | "agent">("site");
  const [teamName, setTeamName] = useState("");
  const [agentIds, setAgentIds] = useState<number[]>([]);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (open) { setScope("site"); setTeamName(""); setAgentIds([]); }
  }, [open]);

  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents as any[]) {
      if (a.team_name) set.add(a.team_name);
    }
    return [...set].sort();
  }, [agents]);

  const valid = !!lobId && (scope === "site" || (scope === "team" && !!teamName) || (scope === "agent" && agentIds.length > 0));

  async function runPublish() {
    if (!valid) return;
    setPublishing(true);
    try {
      const res = await fetch(apiUrl(`/api/scheduling/publish`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lob_id: lobId,
          date_start: dateStart,
          date_end: dateEnd,
          scope,
          agent_ids: scope === "agent" ? agentIds : undefined,
          team_name: scope === "team" ? teamName : undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      toast.success(`Published ${result.published_count} draft shifts`);
      onPublished();
      onClose();
    } catch (err: any) {
      toast.error(`Publish failed: ${err?.message || err}`);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !publishing) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Publish Draft Schedule</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1">
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as "site" | "team" | "agent")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="site">Whole LOB / Site</SelectItem>
                <SelectItem value="team">Single Team</SelectItem>
                <SelectItem value="agent">Specific Agents</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope === "team" && (
            <div className="flex flex-col gap-1">
              <Label>Team</Label>
              <Select value={teamName} onValueChange={setTeamName}>
                <SelectTrigger><SelectValue placeholder={teams.length === 0 ? "No teams defined" : "Choose team…"} /></SelectTrigger>
                <SelectContent>
                  {teams.map(t => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          )}
          {scope === "agent" && (
            <div className="flex flex-col gap-1">
              <Label>Agents ({agentIds.length} selected)</Label>
              <div className="border rounded max-h-48 overflow-auto">
                {agents.filter(a => a.status === "active").map(a => (
                  <label key={a.id} className="flex items-center gap-2 px-2 py-1 hover:bg-muted text-sm">
                    <input
                      type="checkbox"
                      checked={agentIds.includes(a.id)}
                      onChange={(e) => {
                        if (e.target.checked) setAgentIds([...agentIds, a.id]);
                        else setAgentIds(agentIds.filter(id => id !== a.id));
                      }}
                    />
                    <span>{a.full_name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Range: {dateStart} → {dateEnd}. Only DRAFT shifts are affected.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={publishing}>Cancel</Button>
          <Button size="sm" disabled={!valid || publishing} onClick={runPublish}>
            {publishing ? <><Loader2 className="size-3.5 animate-spin mr-1" /> Publishing…</> : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function ScheduleEditor() {
  const navigate = useNavigate();
  const { activeLob } = useLOB();

  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOf(new Date()));
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const [agentQuery, setAgentQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState<"all" | "voice" | "chat" | "email">("all");
  const [sortBy, setSortBy] = useState<"name" | "start" | null>("start");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [agents, setAgents]           = useState<Agent[]>([]);
  const [templates, setTemplates]     = useState<ShiftTemplate[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [requiredFteByDate, setRequiredFteByDate] = useState<Record<string, number[]>>({});
  const [requiredFteByWeekday, setRequiredFteByWeekday] = useState<Record<string, number[]>>({});
  const [erlangsByDate, setErlangsByDate] = useState<Record<string, number[]>>({});
  const [erlangsByWeekday, setErlangsByWeekday] = useState<Record<string, number[]>>({});
  const [slaParams, setSlaParams] = useState<{ ahtSec: number; slaSec: number; slaTarget: number; channel: string } | null>(null);

  const [viewMode, setViewMode]       = useState<"daily" | "weekly">("daily");
  const [loading, setLoading]         = useState(true);
  const [addOpen, setAddOpen]         = useState(false);
  const [autoGenOpen, setAutoGenOpen] = useState(false);
  const [publishDraftsOpen, setPublishDraftsOpen] = useState(false);
  const [clearWeekOpen, setClearWeekOpen] = useState(false);
  const [clearScope, setClearScope] = useState<"draft" | "all">("draft");
  const [clearing, setClearing] = useState(false);
  const [prefillAgent, setPrefillAgent] = useState<number | undefined>();
  const [prefillStart, setPrefillStart] = useState<string | undefined>();
  const [prefillDate, setPrefillDate]   = useState<string | undefined>();

  // Absence
  const [absenceDialogAgentId, setAbsenceDialogAgentId] = useState<number | null>(null);
  const [absenceInput, setAbsenceInput] = useState("");

  // Local-first: dirty tracking + publish
  const [isDirty, setIsDirty]         = useState(false);
  const [publishing, setPublishing]   = useState(false);
  const tempIdRef = useRef(-1);
  const nextTempId = useCallback(() => { const id = tempIdRef.current; tempIdRef.current -= 1; return id; }, []);

  // Selection, clipboard, undo
  const [selectedShiftId, setSelectedShiftId] = useState<number | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<number>>(new Set());
  const [clipboard, setClipboard] = useState<ClipboardShift | null>(null);
  const [pendingPasteAgents, setPendingPasteAgents] = useState<number[] | null>(null);
  const [pendingPasteDate, setPendingPasteDate] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);

  const undoStackRef = useRef(undoStack);
  undoStackRef.current = undoStack;
  const assignmentsRef = useRef(assignments);
  assignmentsRef.current = assignments;

  const pushUndo = useCallback((action: UndoAction) => {
    setUndoStack(prev => [...prev.slice(-19), action]);
  }, []);

  const weekDates = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const activeDate = toDateStr(weekDates[activeDayIdx]);
  const dateStart = toDateStr(weekStart);
  const dateEnd = toDateStr(weekDates[6]);

  const clampBreakMealToTemplateWindow = useCallback((rows: Assignment[]): Assignment[] => {
    if (!templates.length || !Array.isArray(rows)) return rows;

    return rows.map((assignment) => {
      const tmpl = templates.find(t => t.id === assignment.shift_template_id);
      if (!tmpl?.break_rules?.length || !assignment.activities?.length) return assignment;

      const shiftStartMins = timeToMins(assignment.start_time);
      const activities = assignment.activities.map(a => ({ ...a }));
      const typeIndexes = {
        break: [] as number[],
        meal: [] as number[],
      };

      activities.forEach((act, idx) => {
        if (act.activity_type === "break") typeIndexes.break.push(idx);
        if (act.activity_type === "meal") typeIndexes.meal.push(idx);
      });

      const cursors = { break: 0, meal: 0 };
      let changed = false;

      for (const rule of tmpl.break_rules) {
        const expectedType: "break" | "meal" = rule.duration_minutes >= 30 ? "meal" : "break";
        const nextIdx = typeIndexes[expectedType][cursors[expectedType]];
        if (nextIdx == null) continue;
        cursors[expectedType] += 1;

        const act = activities[nextIdx];
        const actStartMins = timeToMins(act.start_time);
        const actEndMins = timeToMins(act.end_time);
        const currentOffset = getForwardMinsDiff(shiftStartMins, actStartMins);
        const expectedOffset = Math.round(rule.after_hours * 60);
        const offsetDelta = currentOffset - expectedOffset;
        const clampedDelta = Math.max(
          -BREAK_MEAL_DRIFT_LIMIT_MINS,
          Math.min(BREAK_MEAL_DRIFT_LIMIT_MINS, snapToIncrement(offsetDelta, BREAK_MEAL_INCREMENT_MINS))
        );
        const adjustedOffset = expectedOffset + clampedDelta;
        const adjustedStartMins = shiftStartMins + adjustedOffset;
        const durationMins = getForwardMinsDiff(actStartMins, actEndMins);
        const adjustedStart = toTime(adjustedStartMins);
        const adjustedEnd = toTime(adjustedStartMins + durationMins);

        if (act.start_time !== adjustedStart || act.end_time !== adjustedEnd) {
          activities[nextIdx] = { ...act, start_time: adjustedStart, end_time: adjustedEnd };
          changed = true;
        }
      }

      return changed ? { ...assignment, activities } : assignment;
    });
  }, [templates]);

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
      .then(rows => {
        if (Array.isArray(rows)) {
          setAssignments(clampBreakMealToTemplateWindow(rows));
          setIsDirty(false);
          setUndoStack([]);
        }
      })
      .catch(() => toast.error("Failed to load schedule"))
      .finally(() => setLoading(false));
  }, [activeLob, dateStart, dateEnd, clampBreakMealToTemplateWindow]);

  const loadRequiredFte = useCallback(() => {
    if (!activeLob) return;
    fetch(apiUrl(`/api/user-preferences?page_key=intraday_fte&lob_id=${activeLob.id}`))
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;

        const expand = (map: unknown): Record<string, number[]> => {
          const out: Record<string, number[]> = {};
          if (!map || typeof map !== "object") return out;
          for (const [k, slots] of Object.entries(map as Record<string, unknown>)) {
            if (!Array.isArray(slots)) continue;
            const padded = [...(slots as number[])];
            while (padded.length < 96) padded.push(0);
            out[String(k).toLowerCase()] = padded.slice(0, 96);
          }
          return out;
        };

        setRequiredFteByWeekday(expand(data.weekdays));
        setErlangsByWeekday(expand(data.erlangs_weekdays));

        if (data.dates && typeof data.dates === "object") {
          const byDate = expand(data.dates);
          setRequiredFteByDate(byDate);
          setErlangsByDate(expand(data.erlangs_dates));
          if (data.aht_sec && data.sla_sec != null && data.sla_target != null) {
            setSlaParams({
              ahtSec: Number(data.aht_sec),
              slaSec: Number(data.sla_sec),
              slaTarget: Number(data.sla_target),
              channel: String(data.channel ?? "voice"),
            });
          }
          return;
        }
        // Legacy format: { slots: [96 numbers] }
        const slots = data.slots as number[] | undefined;
        if (!slots?.length) return;
        const padded = [...slots];
        while (padded.length < 96) padded.push(0);
        setRequiredFteByDate({ "*": padded.slice(0, 96) });
      })
      .catch(() => {});
  }, [activeLob]);

  useEffect(() => { loadRequiredFte(); }, [loadRequiredFte]);

  // Refetch required FTE when window regains focus — catches the case where
  // the user commits in IntradayForecast in another tab, then returns here.
  useEffect(() => {
    const onFocus = () => loadRequiredFte();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadRequiredFte]);

  // ── Local-only mutations (no API calls) ──────────────────────────────────

  const addShift = useCallback((fields: {
    agent_id: number;
    shift_template_id: number | null;
    start_time: string;
    end_time: string;
    channel: string;
    notes: string;
    work_date?: string;
  }) => {
    if (!activeLob) return;

    const agent = agents.find(a => a.id === fields.agent_id);
    const tmpl = templates.find(t => t.id === fields.shift_template_id);
    const assignmentId = nextTempId();

    const enriched: Assignment = {
      id: assignmentId,
      agent_id: fields.agent_id,
      agent_name: agent?.full_name ?? "",
      skill_voice: agent?.skill_voice ?? false,
      skill_chat: agent?.skill_chat ?? false,
      skill_email: agent?.skill_email ?? false,
      shift_template_id: fields.shift_template_id,
      template_name: tmpl?.name ?? null,
      template_color: tmpl?.color ?? null,
      work_date: fields.work_date ?? activeDate,
      start_time: fields.start_time,
      end_time: fields.end_time,
      is_overnight: isOvernightTimes(fields.start_time, fields.end_time),
      channel: fields.channel,
      notes: fields.notes || null,
      activities: [],
    };

    // Create default activities from template break_rules or default 9h pattern
    const shiftStartMins = timeToMins(fields.start_time);
    const breakRules = tmpl?.break_rules?.length
      ? tmpl.break_rules
      : [
          { name: "Break", duration_minutes: 15, after_hours: 2, is_paid: true },
          { name: "Lunch", duration_minutes: 60, after_hours: 4, is_paid: false },
          { name: "Break", duration_minutes: 15, after_hours: 6, is_paid: true },
        ];

    for (const rule of breakRules) {
      const breakStartMins = shiftStartMins + rule.after_hours * 60;
      const breakEndMins = breakStartMins + rule.duration_minutes;
      enriched.activities.push({
        id: nextTempId(),
        assignment_id: assignmentId,
        activity_type: rule.duration_minutes >= 30 ? "meal" : "break",
        start_time: toTime(breakStartMins),
        end_time: toTime(breakEndMins),
        is_paid: rule.is_paid,
        notes: rule.name,
      });
    }

    setAssignments(prev => [...prev, enriched]);
    pushUndo({ type: "add", assignmentId: enriched.id });
    setIsDirty(true);
  }, [activeLob, activeDate, agents, templates, pushUndo, nextTempId]);

  const moveShift = useCallback((id: number, newStart: string, newEnd: string, newAgentId?: number, newWorkDate?: string) => {
    const prev = assignmentsRef.current.find(a => a.id === id);
    if (!prev) return;

    pushUndo({
      type: "move",
      assignmentId: id,
      prevStart: prev.start_time,
      prevEnd: prev.end_time,
      prevAgentId: prev.agent_id,
      prevWorkDate: prev.work_date,
      prevActivities: prev.activities.map(a => ({ ...a })),
    });

    // Compute time delta to shift activities along with the shift
    const deltaMins = timeToMins(newStart) - timeToMins(prev.start_time);

    const updatedAgent = newAgentId ? agents.find(a => a.id === newAgentId) : null;
    setAssignments(all => all.map(a => a.id === id ? {
      ...a,
      start_time: newStart,
      end_time: newEnd,
      is_overnight: isOvernightTimes(newStart, newEnd),
      ...(newAgentId ? { agent_id: newAgentId, agent_name: updatedAgent?.full_name ?? a.agent_name } : {}),
      ...(newWorkDate ? { work_date: newWorkDate } : {}),
      // Shift all activities by the same time delta
      activities: deltaMins !== 0 ? a.activities.map(act => ({
        ...act,
        start_time: toTime(timeToMins(act.start_time) + deltaMins),
        end_time: toTime(timeToMins(act.end_time) + deltaMins),
      })) : a.activities,
    } : a));

    setIsDirty(true);
  }, [agents, pushUndo]);

  const updateTimes = useCallback((id: number, start: string, end: string) => {
    moveShift(id, start, end);
  }, [moveShift]);

  const deleteShift = useCallback((id: number) => {
    const prev = assignmentsRef.current.find(a => a.id === id);
    if (prev) pushUndo({ type: "delete", assignment: prev });

    setAssignments(prev => prev.filter(a => a.id !== id));
    if (selectedShiftId === id) setSelectedShiftId(null);
    setIsDirty(true);
  }, [selectedShiftId, pushUndo]);

  // Executes a clipboard paste for the given agent IDs on the given date,
  // removing any existing shifts for those agents on that date first.
  const executePaste = useCallback((targetAgents: number[], targetDate?: string) => {
    if (!clipboard) return;
    const pasteDate = targetDate ?? activeDate;
    for (const agentId of targetAgents) {
      const existing = assignmentsRef.current.filter(
        a => a.agent_id === agentId && a.work_date?.startsWith(pasteDate)
      );
      for (const a of existing) {
        const prev = a;
        setAssignments(p => p.filter(x => x.id !== prev.id));
        setIsDirty(true);
      }
    }
    for (const agentId of targetAgents) {
      addShift({
        agent_id: agentId,
        shift_template_id: clipboard.shift_template_id,
        start_time: clipboard.start_time,
        end_time: clipboard.end_time,
        channel: clipboard.channel,
        notes: "",
        work_date: pasteDate,
      });
    }
    toast.success(`Pasted shift to ${targetAgents.length} agent${targetAgents.length > 1 ? "s" : ""}`);
  }, [clipboard, activeDate, addShift]);

  // Called from WeeklyScheduleGrid when the user clicks a day cell while a
  // shift is on the clipboard — pastes to that specific agent + date.
  const handleWeeklyPaste = useCallback((agentId: number, dateStr: string) => {
    if (!clipboard) return;
    const hasConflict = assignmentsRef.current.some(
      a => a.agent_id === agentId && a.work_date?.startsWith(dateStr)
    );
    if (hasConflict) {
      setPendingPasteAgents([agentId]);
      setPendingPasteDate(dateStr);
    } else {
      executePaste([agentId], dateStr);
    }
  }, [clipboard, executePaste]);

  const addActivity = useCallback((assignmentId: number, act: Omit<Activity, "id" | "assignment_id">) => {
    const actId = nextTempId();
    const newAct: Activity = { id: actId, assignment_id: assignmentId, ...act };
    setAssignments(prev => prev.map(a =>
      a.id === assignmentId ? { ...a, activities: [...a.activities, newAct] } : a
    ));
    pushUndo({ type: "addActivity", activityId: actId, assignmentId });
    setIsDirty(true);
  }, [pushUndo, nextTempId]);

  const updateActivity = useCallback((id: number, fields: Partial<Activity>) => {
    const existing = assignmentsRef.current.flatMap(a => a.activities).find(act => act.id === id);
    if (existing) {
      pushUndo({ type: "updateActivity", activityId: id, prevFields: { start_time: existing.start_time, end_time: existing.end_time, activity_type: existing.activity_type } });
    }

    setAssignments(prev => prev.map(a => ({
      ...a,
      activities: a.activities.map(act => act.id === id ? { ...act, ...fields } : act),
    })));
    setIsDirty(true);
  }, [pushUndo]);

  const deleteActivity = useCallback((assignmentId: number, activityId: number) => {
    setAssignments(prev => prev.map(a =>
      a.id === assignmentId ? { ...a, activities: a.activities.filter(act => act.id !== activityId) } : a
    ));
    setIsDirty(true);
  }, []);

  const handleRequestAbsence = useCallback((agentId: number) => {
    const existing = assignmentsRef.current.find(
      a => a.agent_id === agentId && a.work_date?.startsWith(activeDate) && a.absence_type
    );
    setAbsenceInput(existing?.absence_type ?? "");
    setAbsenceDialogAgentId(agentId);
  }, [activeDate]);

  const handleConfirmAbsence = useCallback((type: string) => {
    if (!absenceDialogAgentId || !type.trim()) return;
    setAssignments(prev => prev.map(a =>
      a.agent_id === absenceDialogAgentId && a.work_date?.startsWith(activeDate)
        ? { ...a, absence_type: type.trim() }
        : a
    ));
    setIsDirty(true);
    setAbsenceDialogAgentId(null);
  }, [absenceDialogAgentId, activeDate]);

  const handleClearAbsence = useCallback((agentId: number) => {
    setAssignments(prev => prev.map(a =>
      a.agent_id === agentId && a.work_date?.startsWith(activeDate)
        ? { ...a, absence_type: null }
        : a
    ));
    setIsDirty(true);
  }, [activeDate]);

  const handleGridAddShift = useCallback((agentId: number, startTime: string, workDate?: string) => {
    setPrefillAgent(agentId);
    setPrefillStart(startTime);
    setPrefillDate(workDate);
    setAddOpen(true);
  }, []);

  // ── Publish (batch save to DB) ──────────────────────────────────────────

  const publish = useCallback(async () => {
    if (!activeLob) return;
    setPublishing(true);
    try {
      const res = await fetch(apiUrl("/api/scheduling/assignments-publish"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lob_id: activeLob.id,
          date_start: dateStart,
          date_end: dateEnd,
          assignments: assignments.map(a => ({
            agent_id: a.agent_id,
            shift_template_id: a.shift_template_id,
            work_date: a.work_date,
            start_time: a.start_time,
            end_time: a.end_time,
            is_overnight: a.is_overnight,
            channel: a.channel,
            notes: a.notes,
            activities: a.activities.map(act => ({
              activity_type: act.activity_type,
              start_time: act.start_time,
              end_time: act.end_time,
              is_paid: act.is_paid,
              notes: act.notes,
            })),
          })),
        }),
      });
      if (!res.ok) throw new Error("Publish failed");
      const rows: Assignment[] = await res.json();
      setAssignments(clampBreakMealToTemplateWindow(rows));
      setIsDirty(false);
      setUndoStack([]);
      toast.success("Schedule published successfully");
    } catch {
      toast.error("Failed to publish schedule");
    } finally {
      setPublishing(false);
    }
  }, [activeLob, dateStart, dateEnd, assignments, clampBreakMealToTemplateWindow]);

  // ── Selection handlers ───────────────────────────────────────────────────

  const handleSelectShift = useCallback((id: number, shiftHeld: boolean) => {
    setSelectedShiftId(prev => prev === id && !shiftHeld ? null : id);
  }, []);

  const handleSelectAgent = useCallback((id: number, shiftHeld: boolean) => {
    setSelectedAgentIds(prev => {
      const next = new Set(shiftHeld ? prev : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.ctrlKey && e.key === "c") {
        // Copy selected shift
        if (!selectedShiftId) return;
        const shift = assignmentsRef.current.find(a => a.id === selectedShiftId);
        if (!shift) return;
        e.preventDefault();
        const shiftStart = timeToMins(shift.start_time);
        setClipboard({
          shift_template_id: shift.shift_template_id,
          start_time: shift.start_time,
          end_time: shift.end_time,
          channel: shift.channel,
          template_color: shift.template_color,
          template_name: shift.template_name,
          activities: shift.activities.map(a => ({
            activity_type: a.activity_type,
            offset_mins: timeToMins(a.start_time) - shiftStart,
            duration_mins: timeToMins(a.end_time) - timeToMins(a.start_time),
            is_paid: a.is_paid,
            notes: a.notes,
          })),
        });
        toast.success("Shift copied");
      }

      if (e.ctrlKey && e.key === "v") {
        if (!clipboard) return;
        e.preventDefault();
        const targetAgents = selectedAgentIds.size > 0
          ? Array.from(selectedAgentIds)
          : [];
        if (targetAgents.length === 0) {
          toast.error("Select an agent row first (click agent name)");
          return;
        }
        const hasConflict = targetAgents.some(agentId =>
          assignmentsRef.current.some(a => a.agent_id === agentId && a.work_date?.startsWith(activeDate))
        );
        if (hasConflict) {
          setPendingPasteAgents(targetAgents);
        } else {
          executePaste(targetAgents);
        }
      }

      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        const stack = undoStackRef.current;
        if (stack.length === 0) { toast("Nothing to undo"); return; }
        const last = stack[stack.length - 1];
        setUndoStack(prev => prev.slice(0, -1));

        if (last.type === "add") {
          setAssignments(prev => prev.filter(a => a.id !== last.assignmentId));
          toast("Undone: shift removed");
        } else if (last.type === "delete") {
          setAssignments(prev => [...prev, last.assignment]);
          toast("Undone: shift restored");
        } else if (last.type === "move") {
          const agent = agents.find(a => a.id === last.prevAgentId);
          setAssignments(all => all.map(a => a.id === last.assignmentId ? {
            ...a,
            start_time: last.prevStart,
            end_time: last.prevEnd,
            agent_id: last.prevAgentId,
            agent_name: agent?.full_name ?? a.agent_name,
            work_date: last.prevWorkDate,
            activities: last.prevActivities,
          } : a));
          toast("Undone: shift moved back");
        } else if (last.type === "addActivity") {
          setAssignments(prev => prev.map(a =>
            a.id === last.assignmentId ? { ...a, activities: a.activities.filter(act => act.id !== last.activityId) } : a
          ));
          toast("Undone: activity removed");
        } else if (last.type === "updateActivity") {
          setAssignments(prev => prev.map(a => ({
            ...a,
            activities: a.activities.map(act => act.id === last.activityId ? { ...act, ...last.prevFields } : act),
          })));
          toast("Undone: activity reverted");
        }

        setIsDirty(true);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedShiftId, clipboard, selectedAgentIds, agents, addShift, activeDate, executePaste]);

  // ── Required FTE for the active day (derived from per-date map) ──────────
  // Exact date match first, then fall back to same day-of-week from committed
  // baseline week (IntradayForecast commits Mon–Sun keyed by baseline dates,
  // which won't match the schedule editor's current week).
  const requiredFte = useMemo(() => {
    const weekdayKey = DOW_SCHEDULE_KEYS[activeDayIdx];
    if (weekdayKey && requiredFteByWeekday[weekdayKey]) return requiredFteByWeekday[weekdayKey];
    if (requiredFteByDate[activeDate]) return requiredFteByDate[activeDate];
    if (requiredFteByDate["*"]) return requiredFteByDate["*"];
    // Day-of-week fallback: find a committed date with the same weekday
    const targetDow = new Date(activeDate + "T12:00:00").getDay(); // 0=Sun..6=Sat
    for (const [dateStr, slots] of Object.entries(requiredFteByDate)) {
      if (dateStr === "*") continue;
      const dow = new Date(dateStr + "T12:00:00").getDay();
      if (dow === targetDow) return slots;
    }
    return undefined;
  }, [requiredFteByWeekday, activeDayIdx, requiredFteByDate, activeDate]);

  const requiredErlangs = useMemo(() => {
    const weekdayKey = DOW_SCHEDULE_KEYS[activeDayIdx];
    if (weekdayKey && erlangsByWeekday[weekdayKey]) return erlangsByWeekday[weekdayKey];
    if (erlangsByDate[activeDate]) return erlangsByDate[activeDate];
    const targetDow = new Date(activeDate + "T12:00:00").getDay();
    for (const [dateStr, slots] of Object.entries(erlangsByDate)) {
      if (new Date(dateStr + "T12:00:00").getDay() === targetDow) return slots;
    }
    return undefined;
  }, [erlangsByWeekday, activeDayIdx, erlangsByDate, activeDate]);

  // ── Derived counts ────────────────────────────────────────────────────────

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

  const sortedAgents = useMemo(() => {
    if (!sortBy) return visibleAgents;
    return [...visibleAgents].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") {
        cmp = a.full_name.localeCompare(b.full_name);
      } else {
        const aShift = assignments.find(x => x.agent_id === a.id && x.work_date?.startsWith(activeDate));
        const bShift = assignments.find(x => x.agent_id === b.id && x.work_date?.startsWith(activeDate));
        const aTime = aShift ? timeToMins(aShift.start_time) : 9999;
        const bTime = bShift ? timeToMins(bShift.start_time) : 9999;
        cmp = aTime - bTime;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [visibleAgents, sortBy, sortDir, assignments, activeDate]);

  const todayShiftCount = useMemo(() =>
    assignments.filter(a => a.work_date?.startsWith(activeDate)).length,
    [assignments, activeDate]
  );

  const coverageRate = useMemo(() => {
    if (!requiredFte?.length) return null;
    const scheduled = assignments.filter(a => a.work_date?.startsWith(activeDate)).length;
    const required = requiredFte.reduce((sum, v) => sum + (v ?? 0), 0) / requiredFte.length;
    if (!required) return null;
    return Math.min(999, Math.round((scheduled / required) * 100));
  }, [assignments, activeDate, requiredFte]);

  const projectedSla = useMemo(() => {
    if (!requiredErlangs?.length || !slaParams) return null;
    if (slaParams.channel === "email" || slaParams.channel === "cases") return null;
    const { ahtSec, slaSec } = slaParams;
    let weightedSL = 0, totalWeight = 0;
    for (let slot = 0; slot < 96; slot++) {
      const A = requiredErlangs[slot] ?? 0;
      if (A <= 0) continue;
      const slotStart = slot * 15;
      const N = assignments.filter(a => {
        if (a.absence_type) return false;
        if (!a.work_date?.startsWith(activeDate)) return false;
        const s = timeToMins(a.start_time);
        let e = timeToMins(a.end_time) || 24 * 60;
        if (a.is_overnight && e <= s) e += 24 * 60;
        return s <= slotStart && e > slotStart;
      }).length;
      const sl = N > A ? erlangServiceLevel(A, N, ahtSec, slaSec) : (N > 0 ? erlangServiceLevel(A, N, ahtSec, slaSec) : 0);
      weightedSL += sl * A;
      totalWeight += A;
    }
    if (totalWeight === 0) return null;
    return Math.round((weightedSL / totalWeight) * 100);
  }, [requiredErlangs, assignments, activeDate, slaParams]);

  const projectedSlaByDay = useMemo(() => {
    if (!slaParams) return null;
    if (slaParams.channel === "email" || slaParams.channel === "cases") return null;
    const { ahtSec, slaSec, slaTarget } = slaParams;
    return weekDates.map((date, idx) => {
      const dateStr = toDateStr(date);
      const weekdayKey = DOW_SCHEDULE_KEYS[idx];
      const erlangs = erlangsByDate[dateStr] ?? erlangsByWeekday[weekdayKey] ?? null;
      if (!erlangs) return null;
      let weightedSL = 0, totalWeight = 0;
      for (let slot = 0; slot < 96; slot++) {
        const A = erlangs[slot] ?? 0;
        if (A <= 0) continue;
        const slotStart = slot * 15;
        const N = assignments.filter(a => {
          if (a.absence_type) return false;
          if (!a.work_date?.startsWith(dateStr)) return false;
          const s = timeToMins(a.start_time);
          let e = timeToMins(a.end_time) || 24 * 60;
          if (a.is_overnight && e <= s) e += 24 * 60;
          return s <= slotStart && e > slotStart;
        }).length;
        const sl = N > 0 ? erlangServiceLevel(A, N, ahtSec, slaSec) : 0;
        weightedSL += sl * A;
        totalWeight += A;
      }
      if (totalWeight === 0) return null;
      const pct = Math.round((weightedSL / totalWeight) * 100);
      return { pct, target: slaTarget };
    });
  }, [slaParams, weekDates, erlangsByDate, erlangsByWeekday, assignments]);

  const todayStr = toDateStr(new Date());

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <PageLayout title="Schedule Editor">
      <div className="flex flex-col bg-white">

        {/* ── Primary toolbar ─────────────────────────────────────────────── */}
        <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white px-4 h-[52px]">

          {/* Week navigation */}
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setWeekStart(d => addDays(d, -7))}
              className="flex items-center justify-center h-8 w-8 text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors border-r border-slate-200"
              aria-label="Previous week"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(d => addDays(d, 7))}
              className="flex items-center justify-center h-8 w-8 text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors"
              aria-label="Next week"
            >
              <ChevronRight className="size-3.5" />
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
            className="h-8 w-36 text-xs border-slate-200 text-slate-700"
          />

          <button
            type="button"
            onClick={() => { setWeekStart(getMondayOf(new Date())); setActiveDayIdx(new Date().getDay() === 0 ? 6 : new Date().getDay() - 1); }}
            className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
          >
            <RotateCcw className="size-3" />
            Today
          </button>

          {/* Daily / Weekly toggle */}
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("daily")}
              className={`flex items-center gap-1 h-8 px-2.5 text-[11px] font-semibold transition-colors ${
                viewMode === "daily" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              }`}
            >
              <Calendar className="size-3" />
              Day
            </button>
            <button
              type="button"
              onClick={() => setViewMode("weekly")}
              className={`flex items-center gap-1 h-8 px-2.5 text-[11px] font-semibold transition-colors ${
                viewMode === "weekly" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              }`}
            >
              <CalendarDays className="size-3" />
              Week
            </button>
          </div>

          <div className="flex-1" />

          {/* Clipboard indicator */}
          {clipboard && (
            <span className="text-[10px] text-slate-400 font-medium hidden md:inline">
              Shift copied (Ctrl+V to paste)
            </span>
          )}

          <div className="hidden md:flex items-center gap-1.5">
            <KpiTile label="Active" value={activeAgents.length} accent="bg-blue-50 text-blue-700" />
            <KpiTile label="Shifts" value={todayShiftCount} accent="bg-emerald-50 text-emerald-700" />
            {projectedSla !== null && slaParams && (
              <KpiTile
                label="Proj. SLA"
                value={`${projectedSla}%`}
                accent={
                  projectedSla >= slaParams.slaTarget
                    ? "bg-green-50 text-green-700"
                    : projectedSla >= slaParams.slaTarget - 10
                    ? "bg-amber-50 text-amber-700"
                    : "bg-red-50 text-red-700"
                }
              />
            )}
          </div>

          <div className="h-5 w-px bg-slate-200 hidden md:block" />

          {/* Publish button */}
          <Button
            size="sm"
            variant={isDirty ? "default" : "outline"}
            className={`h-8 gap-1.5 ${isDirty ? "bg-emerald-600 text-white hover:bg-emerald-700" : "text-slate-500"}`}
            disabled={!isDirty || publishing}
            onClick={publish}
          >
            {publishing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            <span className="hidden sm:inline">{publishing ? "Publishing…" : "Publish"}</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-slate-300 text-slate-600 hover:bg-slate-50"
            disabled={!activeLob}
            onClick={() => navigate("/scheduling/scheduler-rules")}
            title="Configure scheduler rules"
          >
            <Settings2 className="size-3.5" />
            <span className="hidden sm:inline">Rules</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50"
            disabled={!activeLob}
            onClick={() => setAutoGenOpen(true)}
          >
            <Wand2 className="size-3.5" />
            <span className="hidden sm:inline">Auto-Generate</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            disabled={!activeLob}
            onClick={() => setPublishDraftsOpen(true)}
          >
            <Send className="size-3.5" />
            <span className="hidden sm:inline">Publish Drafts</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50"
            disabled={!activeLob}
            onClick={() => { setClearScope("draft"); setClearWeekOpen(true); }}
          >
            <Eraser className="size-3.5" />
            <span className="hidden sm:inline">Clear Week</span>
          </Button>

          <a
            href="/help/auto-scheduler"
            target="_blank"
            rel="noopener noreferrer"
            title="Auto-Scheduler user guide"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 text-sm font-medium"
          >
            <HelpCircle className="size-3.5" />
            <span className="hidden sm:inline">Help</span>
          </a>

          <Button
            size="sm"
            className="h-8 gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
            onClick={() => { setPrefillAgent(undefined); setPrefillStart(undefined); setAddOpen(true); }}
          >
            <Plus className="size-3.5" />
            <span className="hidden sm:inline">Add Shift</span>
          </Button>
        </div>

        {/* ── Unsaved changes banner ─────────────────────────────────────── */}
        {isDirty && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            You have unsaved changes. Click <strong>Publish</strong> to save to the database.
          </div>
        )}

        {/* ── Search + skill filter row ────────────────────────────────────── */}
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/40 px-4 h-[40px]">
          <Filter className="size-3.5 text-slate-400 shrink-0" />
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-slate-400" />
            <Input
              value={agentQuery}
              onChange={(e) => setAgentQuery(e.target.value)}
              placeholder="Search agents…"
              className="h-7 w-44 pl-7 text-xs border-slate-200 bg-white text-slate-700 placeholder:text-slate-400"
            />
          </div>

          <div className="flex items-center gap-0.5 ml-1">
            {(["all", "voice", "chat", "email"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSkillFilter(f)}
                className={`h-6 px-2.5 rounded-full text-[11px] font-semibold capitalize transition-colors ${
                  skillFilter === f
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                }`}
              >
                {f === "all" ? "All Skills" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/* Sort controls */}
          <div className="flex items-center gap-1 ml-2">
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mr-0.5">Sort:</span>
            {([
              { key: "name" as const, dir: "asc" as const, label: "Name" },
              { key: "start" as const, dir: "asc" as const, label: "Earliest" },
              { key: "start" as const, dir: "desc" as const, label: "Latest" },
            ]).map(({ key, dir, label }) => {
              const active = sortBy === key && sortDir === dir;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    if (active) { setSortBy(null); setSortDir("asc"); }
                    else { setSortBy(key); setSortDir(dir); }
                  }}
                  className={`h-6 px-2 rounded-full text-[11px] font-semibold transition-colors ${
                    active ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="flex-1" />
          <span className="text-[11px] text-slate-400 font-medium">
            {visibleAgents.length} of {activeAgents.length} agents
          </span>
        </div>

        {/* ── Day tabs (daily mode only) ────────────────────────────────── */}
        {viewMode === "daily" && (
          <div className="flex items-stretch border-b border-slate-200 bg-white overflow-x-auto">
            {DAY_LABELS.map((label, i) => {
              const dayDate = weekDates[i];
              const dayStr = toDateStr(dayDate);
              const count = assignments.filter(a => a.work_date?.startsWith(dayStr)).length;
              const isToday = dayStr === todayStr;
              const active = activeDayIdx === i;
              const daySla = projectedSlaByDay?.[i] ?? null;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setActiveDayIdx(i)}
                  className={`relative flex flex-col items-center justify-center gap-0 px-5 py-2.5 text-center min-w-[80px] transition-colors border-b-2 ${
                    active
                      ? "border-blue-600 bg-white text-blue-600"
                      : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${active ? "text-blue-500" : "text-slate-400"}`}>
                    {label}
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-sm font-bold ${active ? "text-blue-700" : "text-slate-700"}`}>
                      {dayDate.getDate()}
                    </span>
                    {isToday && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                    )}
                  </div>
                  {count > 0 && (
                    <span className={`text-[10px] font-black mt-0.5 ${active ? "text-blue-400" : "text-slate-400"}`}>
                      {count} shift{count !== 1 ? "s" : ""}
                    </span>
                  )}
                  {daySla !== null && (
                    <span className={`text-[9px] font-bold mt-0.5 ${
                      daySla.pct >= daySla.target ? "text-green-600" :
                      daySla.pct >= daySla.target - 10 ? "text-amber-500" : "text-red-500"
                    }`}>
                      {daySla.pct}% SLA
                    </span>
                  )}
                </button>
              );
            })}

            <div className="flex items-center ml-auto px-4 shrink-0">
              <span className="text-[11px] text-slate-400 font-medium hidden lg:block">
                {formatFullDate(weekDates[activeDayIdx])}
              </span>
            </div>
          </div>
        )}

        {/* ── Week header (weekly mode only) ──────────────────────────────── */}
        {viewMode === "weekly" && (
          <div className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-200 bg-white">
            <span className="text-xs font-semibold text-slate-600">
              {formatShortDate(weekDates[0])} — {formatShortDate(weekDates[6])}
            </span>
            <span className="text-[10px] text-slate-400">
              ({assignments.length} shift{assignments.length !== 1 ? "s" : ""} this week)
            </span>
          </div>
        )}

        {/* ── Schedule content ─────────────────────────────────────────────── */}
        <div className="flex-1 p-2 bg-slate-50/30">
          {loading ? (
            <div className="flex items-center justify-center py-24 text-slate-400 gap-2">
              <Loader2 className="animate-spin size-5" />
              <span className="text-sm">Loading schedule…</span>
            </div>
          ) : activeAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-white py-20 text-center">
              <div className="text-slate-400 text-sm font-semibold">No active agents found</div>
              <div className="text-xs text-slate-400">
                Add agents in the{" "}
                <a href="/scheduling/agents" className="text-blue-600 underline underline-offset-2">
                  Agent Roster
                </a>{" "}
                first.
              </div>
            </div>
          ) : visibleAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-16 text-center">
              <div className="text-sm font-semibold text-slate-700">No agents match this filter</div>
              <button
                type="button"
                onClick={() => { setAgentQuery(""); setSkillFilter("all"); }}
                className="text-xs text-blue-600 hover:underline"
              >
                Clear filters
              </button>
            </div>
          ) : viewMode === "daily" ? (
            <ScheduleGrid
              agents={sortedAgents}
              assignments={assignments}
              allWeekAssignments={assignments}
              activeDate={activeDate}
              requiredFte={requiredFte}
              selectedShiftId={selectedShiftId}
              selectedAgentIds={selectedAgentIds}
              onShiftMove={moveShift}
              onShiftDelete={deleteShift}
              onAddShift={handleGridAddShift}
              onAddActivity={addActivity}
              onUpdateActivity={updateActivity}
              onDeleteActivity={deleteActivity}
              onUpdateTimes={updateTimes}
              onSelectShift={handleSelectShift}
              onSelectAgent={handleSelectAgent}
              onRequestAbsence={handleRequestAbsence}
              onClearAbsence={handleClearAbsence}
            />
          ) : (
            <WeeklyScheduleGrid
              agents={sortedAgents}
              assignments={assignments}
              weekDates={weekDates.map(d => toDateStr(d))}
              selectedShiftId={selectedShiftId}
              selectedAgentIds={selectedAgentIds}
              hasClipboard={!!clipboard}
              onShiftMove={moveShift}
              onShiftDelete={deleteShift}
              onAddShift={handleGridAddShift}
              onAddActivity={addActivity}
              onUpdateActivity={updateActivity}
              onDeleteActivity={deleteActivity}
              onUpdateTimes={updateTimes}
              onSelectShift={handleSelectShift}
              onSelectAgent={handleSelectAgent}
              onPaste={handleWeeklyPaste}
            />
          )}
        </div>

      </div>

      {/* Add Shift Dialog */}
      <AddShiftDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        agents={agents}
        templates={templates}
        prefillAgentId={prefillAgent}
        prefillStart={prefillStart}
        onSave={(fields) => addShift({ ...fields, work_date: prefillDate })}
      />

      {/* Auto-Generate Dialog */}
      <AutoGenerateDialog
        open={autoGenOpen}
        onClose={() => setAutoGenOpen(false)}
        lobId={activeLob?.id ?? null}
        initialStart={dateStart}
        onGenerated={() => {
          if (!activeLob) return;
          fetch(apiUrl(`/api/scheduling/assignments?lob_id=${activeLob.id}&date_start=${dateStart}&date_end=${dateEnd}`))
            .then(r => r.json())
            .then(rows => {
              if (Array.isArray(rows)) {
                setAssignments(clampBreakMealToTemplateWindow(rows));
                setIsDirty(false);
              }
            });
        }}
      />

      {/* Publish Drafts Dialog */}
      <PublishDraftsDialog
        open={publishDraftsOpen}
        onClose={() => setPublishDraftsOpen(false)}
        lobId={activeLob?.id ?? null}
        dateStart={dateStart}
        dateEnd={dateEnd}
        agents={agents}
        onPublished={() => {
          if (!activeLob) return;
          fetch(apiUrl(`/api/scheduling/assignments?lob_id=${activeLob.id}&date_start=${dateStart}&date_end=${dateEnd}`))
            .then(r => r.json())
            .then(rows => { if (Array.isArray(rows)) setAssignments(clampBreakMealToTemplateWindow(rows)); });
        }}
      />

      {/* Clear Week Dialog */}
      <AlertDialog open={clearWeekOpen} onOpenChange={(open) => { if (!open && !clearing) setClearWeekOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear schedule for {dateStart} → {dateEnd}?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose what to delete. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 text-sm py-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="clearScope" checked={clearScope === "draft"} onChange={() => setClearScope("draft")} />
              <span><strong>Drafts only</strong> — keep published shifts</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="clearScope" checked={clearScope === "all"} onChange={() => setClearScope("all")} />
              <span><strong>All shifts</strong> — drafts AND published</span>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={clearing || !activeLob}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={async (e) => {
                e.preventDefault();
                if (!activeLob) return;
                setClearing(true);
                try {
                  const res = await fetch(apiUrl(`/api/scheduling/assignments/bulk-delete`), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ lob_id: activeLob.id, date_start: dateStart, date_end: dateEnd, status: clearScope }),
                  });
                  if (!res.ok) throw new Error(await res.text());
                  const { deleted } = await res.json();
                  toast.success(`Cleared ${deleted} shift${deleted === 1 ? "" : "s"}`);
                  const r = await fetch(apiUrl(`/api/scheduling/assignments?lob_id=${activeLob.id}&date_start=${dateStart}&date_end=${dateEnd}`));
                  const rows = await r.json();
                  if (Array.isArray(rows)) { setAssignments(clampBreakMealToTemplateWindow(rows)); setIsDirty(false); }
                  setClearWeekOpen(false);
                } catch (err: any) {
                  toast.error(`Clear failed: ${err?.message || err}`);
                } finally {
                  setClearing(false);
                }
              }}
            >
              {clearing ? <><Loader2 className="size-3.5 animate-spin mr-1" /> Clearing…</> : "Clear"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Absence Dialog */}
      <Dialog open={absenceDialogAgentId !== null} onOpenChange={(open) => { if (!open) setAbsenceDialogAgentId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Mark Absent — {agents.find(a => a.id === absenceDialogAgentId)?.full_name}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex gap-2 flex-wrap">
              {["Sick", "Emergency", "NCNS"].map(preset => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAbsenceInput(preset)}
                  className={`h-7 px-3 rounded-full text-xs font-semibold border transition-colors ${
                    absenceInput === preset
                      ? "bg-red-600 text-white border-red-600"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <Label>Absence Type</Label>
              <Input
                value={absenceInput}
                onChange={e => setAbsenceInput(e.target.value)}
                placeholder="e.g. Training, Bereavement…"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter" && absenceInput.trim()) handleConfirmAbsence(absenceInput); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAbsenceDialogAgentId(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!absenceInput.trim()}
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => handleConfirmAbsence(absenceInput)}
            >
              Mark Absent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Overwrite confirmation dialog */}
      <AlertDialog
        open={pendingPasteAgents !== null}
        onOpenChange={(open) => { if (!open) setPendingPasteAgents(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overwrite existing schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingPasteAgents && pendingPasteAgents.length === 1
                ? "This agent already has a shift scheduled on this day. Pasting will replace it."
                : `${pendingPasteAgents?.length} agents already have shifts scheduled on this day. Pasting will replace them.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setPendingPasteAgents(null); setPendingPasteDate(null); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingPasteAgents) {
                  executePaste(pendingPasteAgents, pendingPasteDate ?? undefined);
                  setPendingPasteAgents(null);
                  setPendingPasteDate(null);
                }
              }}
            >
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageLayout>
  );
}
