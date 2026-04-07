import React, { useEffect, useState } from "react";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Scale, Lock, Globe, Loader2, Info } from "lucide-react";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { toast } from "sonner";

interface LaborLaw {
  id: number;
  jurisdiction_name: string;
  jurisdiction_code: string | null;
  is_preset: boolean;
  max_hours_per_day: number;
  max_hours_per_week: number;
  max_consecutive_days: number;
  overtime_threshold_daily: number | null;
  overtime_threshold_weekly: number;
  rest_hours_between_shifts: number;
  rest_days_per_week: number;
  meal_break_minutes: number;
  meal_break_after_hours: number;
  short_breaks_count: number;
  short_break_minutes: number;
  night_differential_pct: number;
  overtime_rate_multiplier: number;
  notes: string | null;
}

const EMPTY_FORM: Omit<LaborLaw, "id" | "is_preset"> = {
  jurisdiction_name: "", jurisdiction_code: "",
  max_hours_per_day: 8, max_hours_per_week: 40,
  max_consecutive_days: 5,
  overtime_threshold_daily: null, overtime_threshold_weekly: 40,
  rest_hours_between_shifts: 8, rest_days_per_week: 1,
  meal_break_minutes: 60, meal_break_after_hours: 5,
  short_breaks_count: 2, short_break_minutes: 15,
  night_differential_pct: 0, overtime_rate_multiplier: 1.25,
  notes: "",
};

const PRESET_FLAG_COLORS: Record<string, string> = {
  PH: "bg-blue-500",
  US: "bg-red-500",
  IN: "bg-orange-500",
};

function NumField({ label, tooltip, value, onChange, step = 1 }: { label: string; tooltip?: string; value: number | null | string; onChange: (v: number | null) => void; step?: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Label className="text-xs font-semibold">{label}</Label>
        {tooltip && (
          <UITooltip>
            <TooltipTrigger asChild><Info className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger>
            <TooltipContent className="max-w-[200px]"><p className="text-xs">{tooltip}</p></TooltipContent>
          </UITooltip>
        )}
      </div>
      <Input
        type="number"
        step={step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="h-9"
      />
    </div>
  );
}

function PresetCard({ law }: { law: LaborLaw }) {
  const flagColor = law.jurisdiction_code ? (PRESET_FLAG_COLORS[law.jurisdiction_code] ?? "bg-slate-500") : "bg-slate-500";
  return (
    <Card className="border border-border/50 shadow-sm">
      <CardHeader className="pb-3 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${flagColor}`}>
              <Globe className="size-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold">{law.jurisdiction_name}</CardTitle>
              {law.jurisdiction_code && <p className="text-[10px] text-muted-foreground">{law.jurisdiction_code}</p>}
            </div>
          </div>
          <Badge variant="outline" className="gap-1 text-[10px]"><Lock className="size-2.5" />Preset</Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {[
            ["Max hrs/day", law.max_hours_per_day],
            ["Max hrs/week", law.max_hours_per_week],
            ["Max consec. days", law.max_consecutive_days],
            ["OT threshold/day", law.overtime_threshold_daily ?? "—"],
            ["OT threshold/week", law.overtime_threshold_weekly],
            ["Rest between shifts", `${law.rest_hours_between_shifts}h`],
            ["Rest days/week", law.rest_days_per_week],
            ["Meal break", `${law.meal_break_minutes}min after ${law.meal_break_after_hours}h`],
            ["Short breaks", `${law.short_breaks_count}×${law.short_break_minutes}min`],
            ["Night differential", `${law.night_differential_pct}%`],
            ["OT rate", `${law.overtime_rate_multiplier}×`],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex justify-between gap-2 py-0.5 border-b border-border/30">
              <span className="text-foreground/60">{k}</span>
              <span className="font-semibold">{v}</span>
            </div>
          ))}
        </div>
        {law.notes && (
          <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed italic">{law.notes}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function LaborLawRules() {
  const [laws, setLaws] = useState<LaborLaw[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLaw, setEditingLaw] = useState<LaborLaw | null>(null);
  const [form, setForm] = useState<Omit<LaborLaw, "id" | "is_preset">>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingLaw, setDeletingLaw] = useState<LaborLaw | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    fetch(apiUrl("/api/scheduling/labor-laws"))
      .then((r) => r.json())
      .then((rows) => { if (Array.isArray(rows)) setLaws(rows); })
      .catch(() => toast.error("Failed to load labor law rules"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const presets = laws.filter((l) => l.is_preset);
  const custom = laws.filter((l) => !l.is_preset);

  const openAdd = () => { setEditingLaw(null); setForm(EMPTY_FORM); setDialogOpen(true); };
  const openEdit = (l: LaborLaw) => { setEditingLaw(l); setForm({ ...l, notes: l.notes ?? "" }); setDialogOpen(true); };

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.jurisdiction_name.trim()) { toast.error("Jurisdiction name is required"); return; }
    setSaving(true);
    try {
      const url = editingLaw ? apiUrl(`/api/scheduling/labor-laws/${editingLaw.id}`) : apiUrl("/api/scheduling/labor-laws");
      const res = await fetch(url, { method: editingLaw ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(editingLaw ? "Rule updated" : "Jurisdiction added");
      setDialogOpen(false);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deletingLaw) return;
    setDeleting(true);
    try {
      const res = await fetch(apiUrl(`/api/scheduling/labor-laws/${deletingLaw.id}`), { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Jurisdiction removed");
      setDeleteOpen(false);
      setDeletingLaw(null);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally { setDeleting(false); }
  };

  return (
    <TooltipProvider>
      <PageLayout title="Labor Law Rules">
        <div className="flex flex-col gap-8 pb-12">
          {/* Preset jurisdictions */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <p className="text-[11px] font-black uppercase tracking-widest text-foreground/50">Preset Jurisdictions</p>
              <Badge variant="outline" className="text-[10px] gap-1"><Lock className="size-2.5" />Read-only</Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Pre-configured rule sets for BPO's primary labor markets. These cannot be edited or deleted. Use them as reference when setting up custom client-specific jurisdictions.
            </p>
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {presets.map((l) => <PresetCard key={l.id} law={l} />)}
              </div>
            )}
          </div>

          {/* Custom jurisdictions */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-foreground/50 mb-1">Custom Jurisdictions</p>
                <p className="text-sm text-muted-foreground">Add client-specific or regional rule overrides. These are fully editable and will be available for selection in the scheduling engine.</p>
              </div>
              <Button className="gap-2 shrink-0" onClick={openAdd}>
                <Plus className="size-4" />Add Jurisdiction
              </Button>
            </div>

            {!loading && custom.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-border p-12 flex flex-col items-center gap-3 text-center">
                <Scale className="size-10 text-muted-foreground/30" />
                <p className="font-semibold text-foreground">No custom jurisdictions yet</p>
                <p className="text-sm text-muted-foreground max-w-sm">Add a custom jurisdiction for clients with country-specific or site-specific labor rules that differ from the presets.</p>
                <Button className="gap-2 mt-2" onClick={openAdd}><Plus className="size-4" />Add First Jurisdiction</Button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {custom.map((l) => (
                  <Card key={l.id} className="border border-border/50 shadow-sm">
                    <CardHeader className="pb-3 pt-4 px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Globe className="size-4 text-primary" />
                          </div>
                          <div>
                            <CardTitle className="text-sm font-bold">{l.jurisdiction_name}</CardTitle>
                            {l.jurisdiction_code && <p className="text-[10px] text-muted-foreground">{l.jurisdiction_code}</p>}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(l)}><Pencil className="size-3.5" /></Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-rose-500 hover:bg-rose-50" onClick={() => { setDeletingLaw(l); setDeleteOpen(true); }}><Trash2 className="size-3.5" /></Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        {[
                          ["Max hrs/day", l.max_hours_per_day],
                          ["Max hrs/week", l.max_hours_per_week],
                          ["OT rate", `${l.overtime_rate_multiplier}×`],
                          ["Night diff.", `${l.night_differential_pct}%`],
                        ].map(([k, v]) => (
                          <div key={String(k)} className="flex justify-between gap-2 py-0.5 border-b border-border/30">
                            <span className="text-foreground/60">{k}</span>
                            <span className="font-semibold">{v}</span>
                          </div>
                        ))}
                      </div>
                      {l.notes && <p className="mt-2 text-[11px] text-muted-foreground italic">{l.notes}</p>}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Add/Edit Dialog */}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingLaw ? "Edit Jurisdiction" : "Add Custom Jurisdiction"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-5 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label className="text-xs font-semibold">Jurisdiction Name *</Label>
                    <Input value={form.jurisdiction_name} onChange={(e) => set("jurisdiction_name", e.target.value)} placeholder="e.g. Malaysia (EA 1955)" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Code</Label>
                    <Input value={form.jurisdiction_code ?? ""} onChange={(e) => set("jurisdiction_code", e.target.value)} placeholder="MY" maxLength={10} />
                  </div>
                </div>

                <p className="text-[11px] font-black uppercase tracking-widest text-foreground/50">Working Hours</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <NumField label="Max hrs/day" tooltip="Maximum ordinary working hours per day" value={form.max_hours_per_day} onChange={(v) => set("max_hours_per_day", v ?? 8)} step={0.5} />
                  <NumField label="Max hrs/week" tooltip="Maximum ordinary working hours per week" value={form.max_hours_per_week} onChange={(v) => set("max_hours_per_week", v ?? 40)} step={0.5} />
                  <NumField label="Max consecutive days" tooltip="Maximum days worked without a rest day" value={form.max_consecutive_days} onChange={(v) => set("max_consecutive_days", v ?? 5)} />
                  <NumField label="OT threshold/day (hrs)" tooltip="Hours per day after which overtime pay applies. Leave blank if no daily OT rule." value={form.overtime_threshold_daily} onChange={(v) => set("overtime_threshold_daily", v)} step={0.5} />
                  <NumField label="OT threshold/week (hrs)" value={form.overtime_threshold_weekly} onChange={(v) => set("overtime_threshold_weekly", v ?? 40)} step={0.5} />
                  <NumField label="Rest between shifts (hrs)" tooltip="Minimum rest hours required between the end of one shift and start of the next" value={form.rest_hours_between_shifts} onChange={(v) => set("rest_hours_between_shifts", v ?? 8)} step={0.5} />
                  <NumField label="Rest days/week" value={form.rest_days_per_week} onChange={(v) => set("rest_days_per_week", v ?? 1)} />
                </div>

                <p className="text-[11px] font-black uppercase tracking-widest text-foreground/50">Breaks</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <NumField label="Meal break (min)" value={form.meal_break_minutes} onChange={(v) => set("meal_break_minutes", v ?? 60)} />
                  <NumField label="Meal break after (hrs)" value={form.meal_break_after_hours} onChange={(v) => set("meal_break_after_hours", v ?? 5)} step={0.5} />
                  <NumField label="Short breaks (#)" value={form.short_breaks_count} onChange={(v) => set("short_breaks_count", v ?? 2)} />
                  <NumField label="Short break (min)" value={form.short_break_minutes} onChange={(v) => set("short_break_minutes", v ?? 15)} />
                </div>

                <p className="text-[11px] font-black uppercase tracking-widest text-foreground/50">Pay Rules</p>
                <div className="grid grid-cols-2 gap-4">
                  <NumField label="Night differential %" tooltip="Additional % pay for night shift hours (e.g. 10 = 10% premium)" value={form.night_differential_pct} onChange={(v) => set("night_differential_pct", v ?? 0)} step={0.5} />
                  <NumField label="OT rate multiplier" tooltip="e.g. 1.25 = 125% of regular rate, 1.5 = 150%" value={form.overtime_rate_multiplier} onChange={(v) => set("overtime_rate_multiplier", v ?? 1.25)} step={0.05} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Notes</Label>
                  <textarea
                    value={form.notes ?? ""}
                    onChange={(e) => set("notes", e.target.value)}
                    rows={3}
                    placeholder="Any additional compliance notes or jurisdiction-specific caveats…"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="size-4 animate-spin mr-2" />}
                  {editingLaw ? "Save Changes" : "Add Jurisdiction"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete confirm */}
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove Jurisdiction</AlertDialogTitle>
                <AlertDialogDescription>Remove <strong>{deletingLaw?.jurisdiction_name}</strong>? This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={handleDelete} disabled={deleting}>
                  {deleting && <Loader2 className="size-4 animate-spin mr-2" />}Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </PageLayout>
    </TooltipProvider>
  );
}
