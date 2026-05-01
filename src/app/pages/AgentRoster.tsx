import React, { useEffect, useState, useMemo, useRef } from "react";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Checkbox } from "../components/ui/checkbox";
import { Switch } from "../components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Plus, Pencil, Trash2, Users, Phone, MessageSquare, Mail, Search, Loader2, ClipboardPaste } from "lucide-react";
import { toast } from "sonner";
import { useLOB } from "../lib/lobContext";

interface Agent {
  id: number;
  employee_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  email: string | null;
  contract_type: string;
  skill_voice: boolean;
  skill_chat: boolean;
  skill_email: boolean;
  lob_assignments: number[];
  accommodation_flags: string[];
  availability: Record<string, { available?: boolean; start?: string; end?: string }> & { fixed_rest_days?: string[] };
  status: string;
  user_id?: number | null;
  shift_length_hours?: number;
  team_name?: string | null;
  team_lead_id?: number | null;
  team_leader_name?: string | null;
}

const CONTRACT_TYPES = [
  { value: "full_time", label: "Full-Time" },
  { value: "part_time", label: "Part-Time" },
  { value: "contractor", label: "Contractor" },
  { value: "seasonal", label: "Seasonal" },
];

const ACCOMMODATION_OPTIONS = [
  { value: "no_night_shifts", label: "No Night Shifts" },
  { value: "no_overtime", label: "No Overtime" },
  { value: "max_3_consecutive", label: "Max 3 Consecutive Days" },
  { value: "ergonomic_breaks", label: "Ergonomic Break Schedule" },
  { value: "reduced_hours", label: "Reduced Hours" },
  { value: "flexible_schedule", label: "Flexible Schedule" },
  { value: "wfh_only", label: "Work-From-Home Only" },
];

const DAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

const DEFAULT_AVAILABILITY = Object.fromEntries(
  DAYS.map((d) => [d.key, { available: !["sat", "sun"].includes(d.key), start: "08:00", end: "17:00" }])
);

const EMPTY_FORM: Omit<Agent, "id"> = {
  employee_id: "", first_name: "", last_name: "", full_name: "", email: "",
  contract_type: "full_time",
  skill_voice: true, skill_chat: false, skill_email: false,
  lob_assignments: [], accommodation_flags: [],
  availability: DEFAULT_AVAILABILITY,
  status: "active",
  user_id: null,
  shift_length_hours: 9,
  team_name: "",
  team_lead_id: null,
  team_leader_name: "",
};

const REST_DAY_OPTIONS = [
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
  { value: "sunday", label: "Sun" },
];

function contractLabel(v: string) { return CONTRACT_TYPES.find((c) => c.value === v)?.label ?? v; }
function statusColor(s: string) {
  if (s === "active") return "bg-emerald-500 text-white";
  if (s === "inactive") return "bg-slate-400 text-white";
  if (s === "on_leave") return "bg-amber-500 text-black";
  return "bg-muted text-muted-foreground";
}

// ── Paste-from-spreadsheet helpers ───────────────────────────────────────────

const PASTE_FIELD_OPTIONS = [
  { value: "skip", label: "— Skip —" },
  { value: "first_name", label: "First Name" },
  { value: "last_name", label: "Last Name" },
  { value: "employee_id", label: "Employee ID" },
  { value: "email", label: "Email" },
  { value: "team_leader_name", label: "Team Leader" },
  { value: "team_name", label: "Team Name" },
];

const HEADER_MAP: Record<string, string> = {
  "first name": "first_name", "firstname": "first_name", "first": "first_name", "given name": "first_name",
  "last name": "last_name", "lastname": "last_name", "last": "last_name", "surname": "last_name", "family name": "last_name",
  "employee id": "employee_id", "emp id": "employee_id", "employee_id": "employee_id", "emp_id": "employee_id",
  "email": "email", "e-mail": "email", "email address": "email",
  "team leader": "team_leader_name", "team lead": "team_leader_name", "tl": "team_leader_name",
  "leader": "team_leader_name", "supervisor": "team_leader_name", "team_leader": "team_leader_name",
  "team": "team_name", "team name": "team_name", "team_name": "team_name", "group": "team_name",
};

function parseTSV(text: string): string[][] {
  return text.trim().split(/\r?\n/).map((row) => row.split("\t"));
}

function detectColMapping(headerRow: string[]): string[] {
  return headerRow.map((h) => HEADER_MAP[h.toLowerCase().trim()] ?? "skip");
}

function looksLikeHeader(row: string[]): boolean {
  return detectColMapping(row).some((m) => m !== "skip");
}

function defaultColMapping(colCount: number): string[] {
  const defaults = ["first_name", "last_name", "team_leader_name"];
  return Array.from({ length: colCount }, (_, i) => defaults[i] ?? "skip");
}

export function AgentRoster() {
  const { lobs, activeLob } = useLOB();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterSkill, setFilterSkill] = useState("all");
  const [filterContract, setFilterContract] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [form, setForm] = useState<Omit<Agent, "id">>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [colMapping, setColMapping] = useState<string[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] } | null>(null);
  const pasteAreaRef = useRef<HTMLTextAreaElement>(null);

  const load = () => {
    setLoading(true);
    const url = activeLob
      ? apiUrl(`/api/scheduling/agents?lob_id=${activeLob.id}`)
      : apiUrl("/api/scheduling/agents");
    fetch(url)
      .then((r) => r.json())
      .then((rows) => { if (Array.isArray(rows)) setAgents(rows); })
      .catch(() => toast.error("Failed to load agents"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [activeLob?.id]);

  const filtered = useMemo(() => agents.filter((a) => {
    if (search) {
      const q = search.toLowerCase();
      const nameMatch = a.full_name.toLowerCase().includes(q)
        || (a.first_name?.toLowerCase().includes(q))
        || (a.last_name?.toLowerCase().includes(q))
        || (a.employee_id?.toLowerCase().includes(q));
      if (!nameMatch) return false;
    }
    if (filterSkill === "voice" && !a.skill_voice) return false;
    if (filterSkill === "chat" && !a.skill_chat) return false;
    if (filterSkill === "email" && !a.skill_email) return false;
    if (filterContract !== "all" && a.contract_type !== filterContract) return false;
    if (filterStatus !== "all" && a.status !== filterStatus) return false;
    return true;
  }), [agents, search, filterSkill, filterContract, filterStatus]);

  const openAdd = () => {
    setEditingAgent(null);
    setForm({ ...EMPTY_FORM, lob_assignments: activeLob ? [activeLob.id] : [] });
    setDialogOpen(true);
  };
  const openEdit = (a: Agent) => {
    setEditingAgent(a);
    setForm({
      ...a,
      employee_id: a.employee_id ?? "",
      first_name: a.first_name ?? "",
      last_name: a.last_name ?? "",
      email: a.email ?? "",
      availability: { ...DEFAULT_AVAILABILITY, ...a.availability },
      user_id: a.user_id ?? null,
      shift_length_hours: a.shift_length_hours ?? 9,
      team_name: a.team_name ?? "",
      team_lead_id: a.team_lead_id ?? null,
      team_leader_name: a.team_leader_name ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.first_name?.trim()) { toast.error("First name is required"); return; }
    if (!form.last_name?.trim()) { toast.error("Last name is required"); return; }
    const payload = { ...form, full_name: `${form.first_name?.trim()} ${form.last_name?.trim()}` };
    setSaving(true);
    try {
      const url = editingAgent ? apiUrl(`/api/scheduling/agents/${editingAgent.id}`) : apiUrl("/api/scheduling/agents");
      const method = editingAgent ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(editingAgent ? "Agent updated" : "Agent added");
      setDialogOpen(false);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deletingAgent) return;
    setDeleting(true);
    try {
      await fetch(apiUrl(`/api/scheduling/agents/${deletingAgent.id}`), { method: "DELETE" });
      toast.success("Agent removed");
      setDeleteOpen(false);
      setDeletingAgent(null);
      load();
    } catch { toast.error("Delete failed"); }
    finally { setDeleting(false); }
  };

  const setAvail = (day: string, field: "available" | "start" | "end", value: boolean | string) => {
    setForm((prev) => ({ ...prev, availability: { ...prev.availability, [day]: { ...prev.availability[day], [field]: value } } }));
  };

  const toggleAccommodation = (val: string) => {
    setForm((prev) => {
      const flags = prev.accommodation_flags.includes(val)
        ? prev.accommodation_flags.filter((f) => f !== val)
        : [...prev.accommodation_flags, val];
      return { ...prev, accommodation_flags: flags };
    });
  };

  const dataRows = useMemo(
    () => (hasHeader ? rawRows.slice(1) : rawRows).filter((r) => r.some((c) => c.trim())),
    [rawRows, hasHeader]
  );

  const validImportCount = useMemo(() => {
    return dataRows.filter((row) => {
      const a: Record<string, string> = {};
      colMapping.forEach((field, i) => { if (field !== "skip" && row[i]?.trim()) a[field] = row[i].trim(); });
      return a.first_name || a.last_name;
    }).length;
  }, [dataRows, colMapping]);

  const openPasteDialog = () => {
    setRawRows([]); setColMapping([]); setHasHeader(true); setImportResult(null);
    setPasteOpen(true);
    setTimeout(() => pasteAreaRef.current?.focus(), 80);
  };

  const handlePasteText = (text: string) => {
    const rows = parseTSV(text);
    if (rows.length === 0) return;
    setRawRows(rows);
    const isHeader = looksLikeHeader(rows[0]);
    setHasHeader(isHeader);
    setColMapping(isHeader ? detectColMapping(rows[0]) : defaultColMapping(rows[0].length));
    setImportResult(null);
  };

  const handleBulkImport = async () => {
    const agentsToImport = dataRows
      .map((row) => {
        const a: Record<string, string> = {};
        colMapping.forEach((field, i) => { if (field !== "skip" && row[i]?.trim()) a[field] = row[i].trim(); });
        return a;
      })
      .filter((a) => a.first_name || a.last_name);
    if (agentsToImport.length === 0) { toast.error("No valid rows — each row needs at least a first or last name"); return; }
    setImporting(true);
    try {
      const agentsWithLob = activeLob
        ? agentsToImport.map((a) => ({ ...a, lob_id: activeLob.id }))
        : agentsToImport;
      const res = await fetch(apiUrl("/api/scheduling/agents/bulk"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agents: agentsWithLob }),
      });
      const data = await res.json();
      setImportResult({ success: data.imported, errors: data.errors ?? [] });
      if (data.imported > 0) { load(); toast.success(`${data.imported} agent${data.imported !== 1 ? "s" : ""} imported`); }
    } catch { toast.error("Bulk import failed"); }
    finally { setImporting(false); }
  };

  const stats = useMemo(() => ({
    total: agents.length,
    active: agents.filter((a) => a.status === "active").length,
    voice: agents.filter((a) => a.skill_voice).length,
    chat: agents.filter((a) => a.skill_chat).length,
    email: agents.filter((a) => a.skill_email).length,
  }), [agents]);

  return (
    <PageLayout title="Agent Roster">
      <div className="flex flex-col gap-6 pb-12">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total Agents", value: stats.total },
            { label: "Active", value: stats.active },
            { label: "Voice Skilled", value: stats.voice },
            { label: "Chat Skilled", value: stats.chat },
            { label: "Email Skilled", value: stats.email },
          ].map((s) => (
            <Card key={s.label} className="border border-border/50 shadow-none">
              <CardContent className="p-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-foreground/50">{s.label}</p>
                <p className="text-2xl font-black mt-1">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters + Add */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input placeholder="Search by name or employee ID…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={filterSkill} onValueChange={setFilterSkill}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="All Skills" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Skills</SelectItem>
              <SelectItem value="voice">Voice</SelectItem>
              <SelectItem value="chat">Chat</SelectItem>
              <SelectItem value="email">Email</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterContract} onValueChange={setFilterContract}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Contracts" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Contracts</SelectItem>
              {CONTRACT_TYPES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[130px]"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="on_leave">On Leave</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="gap-2" onClick={openPasteDialog}>
            <ClipboardPaste className="size-4" />Import from Spreadsheet
          </Button>
          <Button className="gap-2" onClick={openAdd}>
            <Plus className="size-4" />Add Agent
          </Button>
        </div>

        {/* Table */}
        <Card className="border border-border/50 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-6 text-xs font-semibold uppercase tracking-wide text-foreground/70">First Name</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-foreground/70">Last Name</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-foreground/70">LOB</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-foreground/70">Team Leader</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-foreground/70">Contract</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-foreground/70">Skills</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-foreground/70">Accommodations</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-foreground/70">Avail. Days</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-foreground/70">Status</TableHead>
                  <TableHead className="pr-6 text-right text-xs font-semibold uppercase tracking-wide text-foreground/70">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-12"><Loader2 className="size-6 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2">
                      <Users className="size-10 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">{agents.length === 0 ? "No agents yet. Click Add Agent to get started." : "No agents match the current filters."}</p>
                    </div>
                  </TableCell></TableRow>
                ) : filtered.map((a) => {
                  const availDays = Object.entries(a.availability || {}).filter(([k, v]) => k !== "fixed_rest_days" && (v as { available?: boolean }).available).length;
                  const agentLobs = lobs.filter((l) => a.lob_assignments?.includes(l.id));
                  return (
                    <TableRow key={a.id} className="hover:bg-muted/30">
                      <TableCell className="pl-6">
                        <div>
                          <p className="font-bold text-sm">{a.first_name || a.full_name}</p>
                          <p className="text-xs text-muted-foreground">{a.employee_id || "—"}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-bold text-sm">{a.last_name || ""}</p>
                          {a.email && <p className="text-xs text-muted-foreground">{a.email}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {agentLobs.length > 0
                            ? agentLobs.map((l) => <Badge key={l.id} variant="outline" className="text-[10px] px-1.5">{l.lob_name}</Badge>)
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {a.team_leader_name
                          ? <span className="text-sm">{a.team_leader_name}</span>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{contractLabel(a.contract_type)}</Badge></TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {a.skill_voice && <Badge className="bg-blue-500 text-white text-[10px] gap-1 px-1.5"><Phone className="size-2.5" />Voice</Badge>}
                          {a.skill_chat && <Badge className="bg-violet-500 text-white text-[10px] gap-1 px-1.5"><MessageSquare className="size-2.5" />Chat</Badge>}
                          {a.skill_email && <Badge className="bg-amber-500 text-white text-[10px] gap-1 px-1.5"><Mail className="size-2.5" />Email</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {a.accommodation_flags?.length > 0
                          ? <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">{a.accommodation_flags.length} flag{a.accommodation_flags.length > 1 ? "s" : ""}</Badge>
                          : <span className="text-xs text-muted-foreground">None</span>}
                      </TableCell>
                      <TableCell><span className="text-sm font-semibold">{availDays}/7</span></TableCell>
                      <TableCell><Badge className={`text-[10px] ${statusColor(a.status)}`}>{a.status.replace("_", " ")}</Badge></TableCell>
                      <TableCell className="pr-6">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(a)}><Pencil className="size-3.5" /></Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50" onClick={() => { setDeletingAgent(a); setDeleteOpen(true); }}><Trash2 className="size-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingAgent ? "Edit Agent" : "Add Agent"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 py-2">
              {/* Basic info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">First Name *</Label>
                  <Input value={form.first_name ?? ""} onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))} placeholder="Maria" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Last Name *</Label>
                  <Input value={form.last_name ?? ""} onChange={(e) => setForm((p) => ({ ...p, last_name: e.target.value }))} placeholder="Santos" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Employee ID</Label>
                  <Input value={form.employee_id ?? ""} onChange={(e) => setForm((p) => ({ ...p, employee_id: e.target.value }))} placeholder="EMP-0001" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Email</Label>
                  <Input type="email" value={form.email ?? ""} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="maria@company.com" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Linked User ID</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.user_id ?? ""}
                    onChange={(e) => setForm((p) => ({ ...p, user_id: e.target.value ? Number(e.target.value) : null }))}
                    placeholder="Optional app user ID"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Team Leader</Label>
                  <Input value={form.team_leader_name ?? ""} onChange={(e) => setForm((p) => ({ ...p, team_leader_name: e.target.value }))} placeholder="e.g., Juan Dela Cruz" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Contract Type</Label>
                  <Select value={form.contract_type} onValueChange={(v) => setForm((p) => ({ ...p, contract_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CONTRACT_TYPES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="on_leave">On Leave</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Channel Skills */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-widest text-foreground/50 block mb-2">Channel Skills</Label>
                <div className="flex gap-4 flex-wrap">
                  {[
                    { key: "skill_voice" as const, label: "Voice", color: "text-blue-600" },
                    { key: "skill_chat" as const, label: "Chat", color: "text-violet-600" },
                    { key: "skill_email" as const, label: "Email", color: "text-amber-600" },
                  ].map(({ key, label, color }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={form[key]} onCheckedChange={(v) => setForm((p) => ({ ...p, [key]: !!v }))} />
                      <span className={`text-sm font-semibold ${color}`}>{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* LOB Assignments */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-widest text-foreground/50 block mb-2">LOB Assignments</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Agent must be assigned to at least one LOB to be eligible for auto-scheduling.
                </p>
                {lobs.length === 0 ? (
                  <p className="text-sm text-amber-700 italic">No LOBs defined. Create one under Configuration → LOB Management.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {lobs.map((lob) => {
                      const checked = form.lob_assignments.includes(lob.id);
                      return (
                        <label key={lob.id} className="flex items-center gap-1.5 cursor-pointer border rounded px-2 py-1">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => setForm((p) => {
                              const current = p.lob_assignments.slice();
                              const idx = current.indexOf(lob.id);
                              if (idx >= 0) current.splice(idx, 1);
                              else current.push(lob.id);
                              return { ...p, lob_assignments: current };
                            })}
                          />
                          <span className="text-xs">{lob.lob_name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Accommodations */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-widest text-foreground/50 block mb-2">Accommodation Flags</Label>
                <div className="grid grid-cols-2 gap-2">
                  {ACCOMMODATION_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={form.accommodation_flags.includes(opt.value)} onCheckedChange={() => toggleAccommodation(opt.value)} />
                      <span className="text-sm">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Scheduling fields */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-widest text-foreground/50 block mb-2">Scheduling</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Shift Length (hrs)</Label>
                    <Input
                      type="number" step="0.5" min="1" max="24"
                      value={form.shift_length_hours ?? 9}
                      onChange={(e) => setForm((p) => ({ ...p, shift_length_hours: Number(e.target.value) || 9 }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Team</Label>
                    <Input
                      value={form.team_name ?? ""}
                      onChange={(e) => setForm((p) => ({ ...p, team_name: e.target.value }))}
                      placeholder="e.g., Team Alpha"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <Label className="text-xs font-semibold block mb-1.5">Fixed Rest Days (accommodation)</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Leave empty to let the auto-scheduler pick 2 consecutive rest days. Select 2 to lock them (e.g., Sat + Sun).
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {REST_DAY_OPTIONS.map((d) => {
                      const checked = (form.availability.fixed_rest_days ?? []).includes(d.value);
                      return (
                        <label key={d.value} className="flex items-center gap-1.5 cursor-pointer border rounded px-2 py-1">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => setForm((p) => {
                              const current = (p.availability.fixed_rest_days ?? []).slice();
                              const idx = current.indexOf(d.value);
                              if (idx >= 0) current.splice(idx, 1);
                              else if (current.length < 2) current.push(d.value);
                              return { ...p, availability: { ...p.availability, fixed_rest_days: current } };
                            })}
                          />
                          <span className="text-xs">{d.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Availability */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-widest text-foreground/50 block mb-2">Weekly Availability</Label>
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-foreground/60">Day</th>
                        <th className="text-center px-3 py-2 text-xs font-semibold text-foreground/60">Available</th>
                        <th className="text-center px-3 py-2 text-xs font-semibold text-foreground/60">Start</th>
                        <th className="text-center px-3 py-2 text-xs font-semibold text-foreground/60">End</th>
                      </tr>
                    </thead>
                    <tbody>
                      {DAYS.map((d) => {
                        const av = form.availability[d.key] ?? { available: false, start: "08:00", end: "17:00" };
                        return (
                          <tr key={d.key} className="border-t border-border/40 hover:bg-muted/20">
                            <td className="px-3 py-2 font-medium">{d.label}</td>
                            <td className="px-3 py-2 text-center">
                              <Switch checked={av.available} onCheckedChange={(v) => setAvail(d.key, "available", v)} />
                            </td>
                            <td className="px-3 py-2">
                              <Input type="time" value={av.start} disabled={!av.available} onChange={(e) => setAvail(d.key, "start", e.target.value)} className="h-8 text-xs w-28 mx-auto" />
                            </td>
                            <td className="px-3 py-2">
                              <Input type="time" value={av.end} disabled={!av.available} onChange={(e) => setAvail(d.key, "end", e.target.value)} className="h-8 text-xs w-28 mx-auto" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin mr-2" />}
                {editingAgent ? "Save Changes" : "Add Agent"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirm */}
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Agent</AlertDialogTitle>
              <AlertDialogDescription>
                Remove <strong>{deletingAgent?.full_name}</strong> from the roster? This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={handleDelete} disabled={deleting}>
                {deleting && <Loader2 className="size-4 animate-spin mr-2" />}Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Paste-from-spreadsheet import dialog */}
        <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ClipboardPaste className="size-5" />Import from Spreadsheet
              </DialogTitle>
            </DialogHeader>

            {rawRows.length === 0 ? (
              /* ── Step 1: paste zone ── */
              <div className="flex flex-col items-center gap-4 py-6 px-2">
                <div className="flex flex-col items-center gap-2 text-center">
                  <ClipboardPaste className="size-12 text-muted-foreground/30" />
                  <p className="text-sm font-semibold">Copy cells from Excel or Google Sheets, then paste below</p>
                  <p className="text-xs text-muted-foreground">
                    Select your columns (e.g. First Name · Last Name · Team Leader), press <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">Ctrl+C</kbd>, then click inside the box and press <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">Ctrl+V</kbd>
                  </p>
                </div>
                <textarea
                  ref={pasteAreaRef}
                  rows={5}
                  className="w-full font-mono text-xs border border-border rounded-md px-3 py-2 bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/40"
                  placeholder="Paste here…"
                  onPaste={(e) => {
                    e.preventDefault();
                    const text = e.clipboardData.getData("text/plain");
                    if (text) handlePasteText(text);
                  }}
                  onChange={(e) => {
                    if (e.target.value.includes("\t")) handlePasteText(e.target.value);
                  }}
                />
                <p className="text-[11px] text-muted-foreground">
                  Column order is auto-detected from headers. Supported: First Name, Last Name, Employee ID, Email, Team Leader, Team Name.
                </p>
              </div>
            ) : importResult ? (
              /* ── Step 3: result ── */
              <div className="py-4 space-y-3">
                {importResult.success > 0 && (
                  <div className="rounded-lg px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold">
                    {importResult.success} agent{importResult.success !== 1 ? "s" : ""} imported successfully.
                  </div>
                )}
                {importResult.errors.length > 0 && (
                  <div className="rounded-lg px-4 py-3 bg-rose-50 border border-rose-200 text-rose-800 text-sm">
                    <p className="font-semibold mb-1">{importResult.errors.length} row{importResult.errors.length !== 1 ? "s" : ""} skipped:</p>
                    <ul className="list-disc list-inside text-xs space-y-0.5">
                      {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              /* ── Step 2: mapping + preview ── */
              <div className="space-y-5 py-1">
                {/* Info bar */}
                <div className="flex items-center gap-4 bg-muted/40 rounded-lg px-4 py-2 text-sm flex-wrap">
                  <span className="text-muted-foreground flex-1">
                    <strong>{dataRows.length}</strong> data row{dataRows.length !== 1 ? "s" : ""} detected
                  </span>
                  <label className="flex items-center gap-2 cursor-pointer shrink-0">
                    <Checkbox checked={hasHeader} onCheckedChange={(v) => setHasHeader(!!v)} />
                    <span className="text-xs">First row is a header</span>
                  </label>
                  <button
                    className="text-xs text-muted-foreground underline underline-offset-2 shrink-0"
                    onClick={() => { setRawRows([]); setTimeout(() => pasteAreaRef.current?.focus(), 80); }}
                  >
                    Paste again
                  </button>
                </div>

                {/* Column mapping */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-foreground/50 mb-2">Map Columns</p>
                  <div className="flex flex-wrap gap-3">
                    {rawRows[0]?.map((_, colIdx) => (
                      <div key={colIdx} className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground font-medium truncate max-w-[140px]">
                          {hasHeader && rawRows[0][colIdx] ? rawRows[0][colIdx] : `Column ${colIdx + 1}`}
                        </span>
                        <Select
                          value={colMapping[colIdx] ?? "skip"}
                          onValueChange={(v) => setColMapping((p) => { const n = [...p]; n[colIdx] = v; return n; })}
                        >
                          <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PASTE_FIELD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Preview table */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-foreground/50 mb-2">
                    Preview — first {Math.min(dataRows.length, 5)} of {dataRows.length} rows
                  </p>
                  <div className="rounded border border-border/50 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40">
                        <tr>
                          {colMapping.map((field, i) => (
                            <th key={i} className="px-3 py-2 text-left font-semibold text-foreground/60 whitespace-nowrap">
                              {PASTE_FIELD_OPTIONS.find((o) => o.value === field)?.label ?? "Skip"}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dataRows.slice(0, 5).map((row, ri) => (
                          <tr key={ri} className="border-t border-border/30 hover:bg-muted/20">
                            {colMapping.map((field, ci) => (
                              <td key={ci} className={`px-3 py-2 ${field === "skip" ? "text-muted-foreground/40 italic" : ""}`}>
                                {row[ci] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {dataRows.length > 5 && (
                    <p className="text-[11px] text-muted-foreground mt-1 text-right">…and {dataRows.length - 5} more rows</p>
                  )}
                </div>
              </div>
            )}

            <DialogFooter>
              {!importResult && rawRows.length === 0 && (
                <Button variant="outline" onClick={() => setPasteOpen(false)}>Cancel</Button>
              )}
              {!importResult && rawRows.length > 0 && (
                <>
                  <Button variant="outline" onClick={() => setPasteOpen(false)}>Cancel</Button>
                  <Button onClick={handleBulkImport} disabled={importing || validImportCount === 0}>
                    {importing && <Loader2 className="size-4 animate-spin mr-2" />}
                    Import {validImportCount} agent{validImportCount !== 1 ? "s" : ""}
                  </Button>
                </>
              )}
              {importResult && (
                <>
                  {importResult.errors.length > 0 && (
                    <Button variant="outline" onClick={() => { setRawRows([]); setImportResult(null); setTimeout(() => pasteAreaRef.current?.focus(), 80); }}>
                      Paste Again
                    </Button>
                  )}
                  <Button onClick={() => setPasteOpen(false)}>Done</Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageLayout>
  );
}
