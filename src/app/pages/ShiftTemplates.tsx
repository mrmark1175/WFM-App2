import React, { useEffect, useState, useMemo } from "react";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
import { Switch } from "../components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Clock, Moon, Coffee, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface BreakRule { name: string; duration_minutes: number; after_hours: number; is_paid: boolean; }
interface ShiftTemplate {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  duration_hours: number | null;
  break_rules: BreakRule[];
  channel_coverage: string[];
  color: string;
  is_overnight: boolean;
}

const CHANNEL_OPTIONS = [
  { value: "voice", label: "Voice" },
  { value: "chat", label: "Chat" },
  { value: "email", label: "Email" },
];

const PRESET_COLORS = [
  "#6366f1", "#3b82f6", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
];

function calcDuration(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // overnight
  return Math.round((mins / 60) * 100) / 100;
}

function fmt12(t: string) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

const EMPTY_FORM: Omit<ShiftTemplate, "id"> = {
  name: "", start_time: "08:00", end_time: "17:00",
  duration_hours: null, break_rules: [], channel_coverage: ["voice"],
  color: "#6366f1", is_overnight: false,
};

export function ShiftTemplates() {
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);
  const [form, setForm] = useState<Omit<ShiftTemplate, "id">>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState<ShiftTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    fetch(apiUrl("/api/scheduling/shift-templates"))
      .then((r) => r.json())
      .then((rows) => { if (Array.isArray(rows)) setTemplates(rows); })
      .catch(() => toast.error("Failed to load shift templates"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const derivedDuration = useMemo(() => calcDuration(form.start_time, form.end_time), [form.start_time, form.end_time]);
  const derivedOvernight = useMemo(() => {
    const [sh] = form.start_time.split(":").map(Number);
    const [eh] = form.end_time.split(":").map(Number);
    return eh <= sh;
  }, [form.start_time, form.end_time]);

  const openAdd = () => { setEditingTemplate(null); setForm(EMPTY_FORM); setDialogOpen(true); };
  const openEdit = (t: ShiftTemplate) => { setEditingTemplate(t); setForm({ ...t }); setDialogOpen(true); };

  const toggleChannel = (ch: string) => {
    setForm((prev) => ({
      ...prev,
      channel_coverage: prev.channel_coverage.includes(ch)
        ? prev.channel_coverage.filter((c) => c !== ch)
        : [...prev.channel_coverage, ch],
    }));
  };

  const addBreak = () => {
    setForm((prev) => ({ ...prev, break_rules: [...prev.break_rules, { name: "Break", duration_minutes: 15, after_hours: 2, is_paid: true }] }));
  };

  const updateBreak = (i: number, field: keyof BreakRule, value: string | number | boolean) => {
    setForm((prev) => {
      const rules = [...prev.break_rules];
      rules[i] = { ...rules[i], [field]: value };
      return { ...prev, break_rules: rules };
    });
  };

  const removeBreak = (i: number) => {
    setForm((prev) => ({ ...prev, break_rules: prev.break_rules.filter((_, idx) => idx !== i) }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Shift name is required"); return; }
    if (!form.start_time || !form.end_time) { toast.error("Start and end times are required"); return; }
    setSaving(true);
    const payload = { ...form, duration_hours: derivedDuration, is_overnight: derivedOvernight };
    try {
      const url = editingTemplate ? apiUrl(`/api/scheduling/shift-templates/${editingTemplate.id}`) : apiUrl("/api/scheduling/shift-templates");
      const res = await fetch(url, { method: editingTemplate ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(editingTemplate ? "Template updated" : "Template created");
      setDialogOpen(false);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deletingTemplate) return;
    setDeleting(true);
    try {
      await fetch(apiUrl(`/api/scheduling/shift-templates/${deletingTemplate.id}`), { method: "DELETE" });
      toast.success("Template deleted");
      setDeleteOpen(false);
      setDeletingTemplate(null);
      load();
    } catch { toast.error("Delete failed"); }
    finally { setDeleting(false); }
  };

  return (
    <PageLayout title="Shift Template Library">
      <div className="flex flex-col gap-6 pb-12">
        {/* Header bar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm text-muted-foreground">Define reusable shift patterns. These templates will be used by the scheduling engine to assign agents to coverage windows.</p>
          </div>
          <Button className="gap-2" onClick={openAdd}>
            <Plus className="size-4" />New Template
          </Button>
        </div>

        {/* Template cards */}
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>
        ) : templates.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border p-16 flex flex-col items-center gap-3 text-center">
            <Clock className="size-12 text-muted-foreground/30" />
            <p className="font-semibold text-foreground">No shift templates yet</p>
            <p className="text-sm text-muted-foreground">Create your first template to define the shift patterns agents can be assigned to.</p>
            <Button className="gap-2 mt-2" onClick={openAdd}><Plus className="size-4" />Create First Template</Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((t) => (
              <Card key={t.id} className="border border-border/50 shadow-sm overflow-hidden">
                {/* Color bar */}
                <div className="h-2" style={{ backgroundColor: t.color }} />
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-base">{t.name}</p>
                      <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
                        {t.is_overnight && <Moon className="size-3 text-indigo-500" />}
                        {fmt12(t.start_time)} – {fmt12(t.end_time)}
                        <span className="text-foreground/50">·</span>
                        {t.duration_hours}h
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(t)}><Pencil className="size-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-rose-500 hover:bg-rose-50" onClick={() => { setDeletingTemplate(t); setDeleteOpen(true); }}><Trash2 className="size-3.5" /></Button>
                    </div>
                  </div>

                  {/* Channels */}
                  <div className="flex gap-1 flex-wrap">
                    {t.channel_coverage.map((ch) => (
                      <Badge key={ch} className={`text-[10px] text-white ${ch === "voice" ? "bg-blue-500" : ch === "chat" ? "bg-violet-500" : "bg-amber-500"}`}>{ch}</Badge>
                    ))}
                    {t.is_overnight && <Badge className="text-[10px] bg-indigo-500 text-white gap-1"><Moon className="size-2.5" />Overnight</Badge>}
                  </div>

                  {/* Breaks */}
                  {t.break_rules?.length > 0 && (
                    <div className="space-y-1">
                      {t.break_rules.map((b, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Coffee className="size-3 shrink-0" />
                          <span>{b.name} — {b.duration_minutes}min after {b.after_hours}h {b.is_paid ? "(paid)" : "(unpaid)"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingTemplate ? "Edit Template" : "New Shift Template"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 py-2">
              {/* Name + Color */}
              <div className="flex gap-3 items-end">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs font-semibold">Shift Name *</Label>
                  <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Morning Shift" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Color</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    {PRESET_COLORS.map((c) => (
                      <button key={c} type="button" onClick={() => setForm((p) => ({ ...p, color: c }))}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${form.color === c ? "border-foreground scale-110" : "border-transparent"}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Times */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Start Time *</Label>
                  <Input type="time" value={form.start_time} onChange={(e) => setForm((p) => ({ ...p, start_time: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">End Time *</Label>
                  <Input type="time" value={form.end_time} onChange={(e) => setForm((p) => ({ ...p, end_time: e.target.value }))} />
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground/70 flex items-center gap-2">
                <Clock className="size-4 shrink-0" />
                <span>Duration: <strong>{derivedDuration}h</strong></span>
                {derivedOvernight && <Badge className="ml-2 bg-indigo-500 text-white text-[10px] gap-1"><Moon className="size-2.5" />Overnight</Badge>}
              </div>

              {/* Channel coverage */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-widest text-foreground/50 block mb-2">Channel Coverage</Label>
                <div className="flex gap-4">
                  {CHANNEL_OPTIONS.map(({ value, label }) => (
                    <label key={value} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={form.channel_coverage.includes(value)} onCheckedChange={() => toggleChannel(value)} />
                      <span className="text-sm font-semibold">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Break rules */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-semibold uppercase tracking-widest text-foreground/50">Break Rules</Label>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addBreak}><Plus className="size-3" />Add Break</Button>
                </div>
                {form.break_rules.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No breaks configured.</p>
                ) : (
                  <div className="space-y-2">
                    {form.break_rules.map((br, i) => (
                      <div key={i} className="rounded-lg border border-border/60 p-3 grid grid-cols-2 gap-2 text-sm relative">
                        <button type="button" className="absolute top-2 right-2 text-rose-400 hover:text-rose-600" onClick={() => removeBreak(i)}><Trash2 className="size-3.5" /></button>
                        <div className="space-y-1 col-span-2 sm:col-span-1">
                          <Label className="text-[10px] text-foreground/50">Break Name</Label>
                          <Input value={br.name} onChange={(e) => updateBreak(i, "name", e.target.value)} className="h-8 text-sm" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-foreground/50">Duration (min)</Label>
                          <Input type="number" value={br.duration_minutes} onChange={(e) => updateBreak(i, "duration_minutes", Number(e.target.value))} className="h-8 text-sm" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-foreground/50">After (hours)</Label>
                          <Input type="number" step="0.5" value={br.after_hours} onChange={(e) => updateBreak(i, "after_hours", Number(e.target.value))} className="h-8 text-sm" />
                        </div>
                        <label className="flex items-center gap-2 col-span-2 cursor-pointer">
                          <Checkbox checked={br.is_paid} onCheckedChange={(v) => updateBreak(i, "is_paid", !!v)} />
                          <span className="text-sm">Paid break</span>
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin mr-2" />}
                {editingTemplate ? "Save Changes" : "Create Template"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirm */}
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Template</AlertDialogTitle>
              <AlertDialogDescription>Delete <strong>{deletingTemplate?.name}</strong>? This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={handleDelete} disabled={deleting}>
                {deleting && <Loader2 className="size-4 animate-spin mr-2" />}Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PageLayout>
  );
}
