import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiUrl } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface DemandSnapshot {
  id: number;
  snapshot_label: string | null;
  staffing_mode?: string;
  interval_minutes: number;
  approved_at: string;
}

interface ShiftTemplate {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  break_rules?: Array<{ name: string; duration_minutes: number; after_hours: number; is_paid: boolean }>;
}

interface PreviewShift {
  agent_id: number;
  agent_name: string;
  channel: string;
  date: string;
  start_time: string;
  end_time: string;
  is_overnight?: boolean;
  shift_template_id?: number | null;
  activities?: Array<{
    activity_type: string;
    start_time: string;
    end_time: string;
    is_paid?: boolean;
    notes?: string | null;
  }>;
  productive_minutes: number;
  paid_minutes: number;
  warnings?: string[];
}

interface CoverageVarianceRow {
  channel: string;
  date: string;
  interval_start: string;
  required_fte: number;
  scheduled_productive_fte: number;
  shortage_fte: number;
  surplus_fte: number;
}

interface DailySummaryRow {
  channel: string;
  date: string;
  required_fte_intervals: number;
  scheduled_productive_fte_intervals: number;
  shortage_fte_intervals: number;
  surplus_fte_intervals: number;
  shortage_interval_count: number;
}

interface WeeklyChannelSummary {
  channel: string;
  required_fte_intervals: number;
  scheduled_productive_fte_intervals: number;
  shortage_fte_intervals: number;
  surplus_fte_intervals: number;
  shortage_interval_count: number;
  shift_count: number;
}

interface PreviewSummary {
  feasible: boolean;
  total_required_fte_intervals: number;
  total_scheduled_productive_fte_intervals: number;
  total_shortage_fte_intervals: number;
  total_surplus_fte_intervals: number;
  shortage_interval_count: number;
  worst_shortage: null | {
    channel: string;
    date: string;
    interval_start: string;
    shortage_fte: number;
  };
  daily_summary: DailySummaryRow[];
  weekly_summary: {
    channels: WeeklyChannelSummary[];
    shift_count: number;
    agent_count: number;
    interval_minutes: number;
    source_interval_minutes: number;
    horizon_start: string;
    horizon_end: string;
  };
}

interface PreviewResult {
  preview_mode: true;
  snapshot: {
    id: number;
    label: string | null;
    staffing_mode: string | null;
    interval_minutes: number;
    preview_interval_minutes: number;
    approved_at: string;
  };
  inputs: {
    lob_id: number;
    snapshot_id: number;
    horizon_start: string;
    horizon_end: string;
    fairness_enabled: boolean;
    template_id: number | null;
  };
  proposed_shifts: PreviewShift[];
  coverage_variance: CoverageVarianceRow[];
  summary: PreviewSummary;
  warnings: string[];
  hard_rule_limitations: string[];
  skipped: Array<{ agent_id?: number; agent_name?: string; channel?: string; reason: string }>;
}

interface AutoGeneratePreviewDialogProps {
  open: boolean;
  onClose: () => void;
  lobId: number | null;
  initialStart: string;
  onCommitted?: (result: CommitResult) => Promise<void> | void;
}

interface CommitResult {
  success: boolean;
  run_id: number;
  draft_count: number;
  activity_count: number;
  replaced_existing_drafts: boolean;
  deleted_draft_count: number;
  reload_assignments: boolean;
  message: string;
}

interface CommitConflict {
  draft_count: number;
  message: string;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatNumber(value: number | null | undefined): string {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatSnapshotLabel(snapshot: DemandSnapshot): string {
  return `#${snapshot.id} - ${snapshot.snapshot_label || "(unnamed)"} - ${new Date(snapshot.approved_at).toLocaleDateString()}`;
}

export function AutoGeneratePreviewDialog({ open, onClose, lobId, initialStart, onCommitted }: AutoGeneratePreviewDialogProps) {
  const [snapshots, setSnapshots] = useState<DemandSnapshot[]>([]);
  const [snapshotId, setSnapshotId] = useState("");
  const [templateId, setTemplateId] = useState("none");
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [horizonStart, setHorizonStart] = useState(initialStart);
  const [horizonEnd, setHorizonEnd] = useState(addDays(initialStart, 13));
  const [fairnessEnabled, setFairnessEnabled] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitConflict, setCommitConflict] = useState<CommitConflict | null>(null);
  const [commitSuccess, setCommitSuccess] = useState<CommitResult | null>(null);
  const [confirmMode, setConfirmMode] = useState<"save" | "replace" | null>(null);

  useEffect(() => {
    if (!open) return;
    setHorizonStart(initialStart);
    setHorizonEnd(addDays(initialStart, 13));
    setResult(null);
    setError(null);
    setCommitError(null);
    setCommitConflict(null);
    setCommitSuccess(null);
    setConfirmMode(null);
  }, [open, initialStart]);

  useEffect(() => {
    if (!open || !lobId) return;
    setLoadingOptions(true);
    Promise.all([
      fetch(apiUrl(`/api/scheduling/demand-snapshots?lob_id=${lobId}`)).then(r => r.json()),
      fetch(apiUrl("/api/scheduling/shift-templates")).then(r => r.json()),
    ]).then(([snaps, tmpls]) => {
      if (Array.isArray(snaps)) {
        setSnapshots(snaps);
        setSnapshotId(snaps.length > 0 ? String(snaps[0].id) : "");
      } else {
        setSnapshots([]);
        setSnapshotId("");
      }
      setTemplates(Array.isArray(tmpls) ? tmpls : []);
    }).catch(() => {
      setSnapshots([]);
      setTemplateId("none");
      toast.error("Failed to load preview options");
    }).finally(() => setLoadingOptions(false));
  }, [open, lobId]);

  const selectedTemplate = useMemo(
    () => templates.find(template => String(template.id) === templateId),
    [templates, templateId]
  );

  const valid = !!lobId && !!snapshotId && !!horizonStart && !!horizonEnd && horizonStart <= horizonEnd;
  const varianceRows = result?.coverage_variance || [];
  const visibleVariance = varianceRows.filter(row => row.shortage_fte > 0 || row.surplus_fte > 0).slice(0, 80);
  const hiddenZeroVarianceCount = varianceRows.filter(row => row.shortage_fte <= 0 && row.surplus_fte <= 0).length;
  const hiddenVarianceCount = Math.max(0, varianceRows.filter(row => row.shortage_fte > 0 || row.surplus_fte > 0).length - visibleVariance.length);
  const selectedTemplateId = templateId !== "none" ? Number(templateId) : null;
  const resultMatchesCurrentInputs = !!result
    && result.inputs.lob_id === lobId
    && result.inputs.snapshot_id === Number(snapshotId)
    && result.inputs.horizon_start === horizonStart
    && result.inputs.horizon_end === horizonEnd
    && !!result.inputs.fairness_enabled === fairnessEnabled
    && (result.inputs.template_id ?? null) === selectedTemplateId;

  async function runPreview() {
    if (!valid) return;
    setPreviewing(true);
    setError(null);
    setResult(null);
    setCommitError(null);
    setCommitConflict(null);
    setCommitSuccess(null);
    setConfirmMode(null);
    try {
      const res = await fetch(apiUrl("/api/scheduling/auto-generate-preview"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lob_id: lobId,
          snapshot_id: Number(snapshotId),
          horizon_start: horizonStart,
          horizon_end: horizonEnd,
          fairness_enabled: fairnessEnabled,
          template_id: selectedTemplateId,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data);
      toast.success("Preview ready");
    } catch (err: any) {
      const message = err?.message || "Preview failed";
      setError(message);
      toast.error(`Preview failed: ${message}`);
    } finally {
      setPreviewing(false);
    }
  }

  async function commitPreview(replaceExistingDrafts: boolean) {
    if (!lobId || !result || !resultMatchesCurrentInputs) return;
    setCommitting(true);
    setCommitError(null);
    setCommitConflict(null);
    try {
      const res = await fetch(apiUrl("/api/scheduling/auto-generate-preview/commit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lob_id: lobId,
          snapshot_id: Number(snapshotId),
          horizon_start: horizonStart,
          horizon_end: horizonEnd,
          fairness_enabled: fairnessEnabled,
          template_id: selectedTemplateId,
          replace_existing_drafts: replaceExistingDrafts,
          confirmation: {
            accepted_preview_warnings: true,
            accepted_draft_replacement: replaceExistingDrafts,
            confirmed_at: new Date().toISOString(),
            confirmation_text: replaceExistingDrafts ? "Replace Existing Drafts with Preview" : "Save Preview as Draft",
          },
          preview: {
            proposed_shifts: result.proposed_shifts,
            summary: result.summary,
            coverage_variance: result.coverage_variance,
            warnings: result.warnings,
            hard_rule_limitations: result.hard_rule_limitations,
            skipped: result.skipped,
            inputs: result.inputs,
          },
        }),
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: text || "Commit failed" };
      }
      if (!res.ok) {
        if (res.status === 409 && data?.reason === "draft_assignments_exist") {
          setConfirmMode(null);
          setCommitConflict({
            draft_count: Number(data.draft_count || 0),
            message: data.message || "Draft assignments already exist for this horizon.",
          });
          return;
        }
        throw new Error(data?.error || data?.message || text || "Commit failed");
      }
      const commitResult = data as CommitResult;
      setCommitSuccess(commitResult);
      setConfirmMode(null);
      toast.success("Preview saved as draft schedule");
      try {
        await onCommitted?.(commitResult);
      } catch (reloadErr: any) {
        const message = reloadErr?.message || "Preview saved, but schedule reload failed.";
        setCommitError(message);
        toast.error(message);
      }
    } catch (err: any) {
      const message = err?.message || "Failed to save preview as draft";
      setCommitError(message);
      toast.error(`Save preview failed: ${message}`);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !previewing && !committing) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Preview Auto Schedule</DialogTitle>
          <DialogDescription>
            Preview only. No schedules are saved, existing drafts are not cleared, and publish is not triggered.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-semibold">Read-only scheduling preview</div>
              <div className="text-xs leading-5">
                Labor law, contract, leave, and availability rules may still be warnings until full enforcement is implemented.
                This preview does not call the production generator and does not write to the schedule grid.
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <Label>Demand Snapshot <span className="text-destructive">*</span></Label>
              <Select value={snapshotId} onValueChange={setSnapshotId} disabled={loadingOptions || snapshots.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingOptions ? "Loading snapshots..." : snapshots.length === 0 ? "No approved snapshots" : "Choose snapshot..."} />
                </SelectTrigger>
                <SelectContent>
                  {snapshots.map(snapshot => (
                    <SelectItem key={snapshot.id} value={String(snapshot.id)}>
                      {formatSnapshotLabel(snapshot)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {snapshots.length === 0 && !loadingOptions && (
                <span className="text-xs text-muted-foreground">
                  Approve a demand snapshot in Intraday Forecast first.
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <Label>Shift Template <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Select value={templateId} onValueChange={setTemplateId} disabled={loadingOptions}>
                <SelectTrigger><SelectValue placeholder="Use Rules page defaults" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Use Rules page defaults</SelectItem>
                  {templates.map(template => (
                    <SelectItem key={template.id} value={String(template.id)}>
                      {template.name} ({template.start_time}-{template.end_time})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplate?.break_rules?.length ? (
                <span className="text-xs text-muted-foreground">
                  Breaks: {selectedTemplate.break_rules.map(rule => `${rule.name} (${rule.duration_minutes}m @ +${rule.after_hours}h)`).join(", ")}
                </span>
              ) : null}
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

            <Button size="sm" className="w-full" disabled={!valid || previewing || loadingOptions} onClick={runPreview}>
              {previewing ? <><Loader2 className="size-3.5 animate-spin" /> Previewing...</> : "Preview Auto Schedule"}
            </Button>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {result && !resultMatchesCurrentInputs && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Preview inputs changed after this result was generated. Run preview again before saving as draft.
              </div>
            )}

            {commitError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {commitError}
              </div>
            )}

            {commitSuccess && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <div className="font-semibold">Preview saved as draft schedule</div>
                <div className="mt-1 text-xs">
                  Run #{commitSuccess.run_id} - {commitSuccess.draft_count} draft shifts - {commitSuccess.activity_count} activities
                  {commitSuccess.replaced_existing_drafts ? ` - replaced ${commitSuccess.deleted_draft_count} existing drafts` : ""}
                </div>
              </div>
            )}

            {commitConflict && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="font-semibold">Existing drafts found</div>
                <div className="mt-1 text-xs">
                  {commitConflict.message} Draft count: {commitConflict.draft_count}.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setCommitConflict(null)} disabled={committing}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setConfirmMode("replace")} disabled={committing}>
                    Replace Existing Drafts
                  </Button>
                </div>
              </div>
            )}

            {confirmMode && (
              <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                <div className="font-semibold">
                  {confirmMode === "replace" ? "Confirm draft replacement" : "Confirm draft save"}
                </div>
                <div className="mt-1 space-y-1 text-xs">
                  <p>This saves the reviewed preview as draft assignments only.</p>
                  <p>This does not publish schedules or delete published shifts.</p>
                  <p>
                    {confirmMode === "replace"
                      ? "Existing draft shifts in this horizon will be replaced because you explicitly confirmed replacement."
                      : "Existing drafts are not replaced unless explicitly confirmed."}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirmMode(null)} disabled={committing}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => commitPreview(confirmMode === "replace")} disabled={committing}>
                    {committing
                      ? <><Loader2 className="size-3.5 animate-spin" /> Saving preview as draft...</>
                      : confirmMode === "replace" ? "Confirm Replace Drafts" : "Confirm Save as Draft"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            {!result && !previewing && !error && (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Choose an approved demand snapshot, set the horizon, then run a read-only preview. Results stay in this dialog only.
              </div>
            )}

            {previewing && (
              <div className="rounded-lg border p-6 text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline size-4 animate-spin" />
                Previewing...
              </div>
            )}

            {result && (
              <>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                  <Badge variant={result.summary.feasible ? "default" : "destructive"}>
                    {result.summary.feasible ? "Feasible" : "Shortage"}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Snapshot #{result.snapshot.id} - {result.snapshot.label || "(unnamed)"}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {result.summary.weekly_summary.shift_count} proposed shifts - {result.summary.weekly_summary.agent_count} agents
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <SummaryCard label="Required FTE intervals" value={formatNumber(result.summary.total_required_fte_intervals)} />
                  <SummaryCard label="Scheduled productive" value={formatNumber(result.summary.total_scheduled_productive_fte_intervals)} />
                  <SummaryCard label="Shortage intervals" value={formatNumber(result.summary.total_shortage_fte_intervals)} tone={result.summary.total_shortage_fte_intervals > 0 ? "danger" : "normal"} />
                  <SummaryCard label="Surplus intervals" value={formatNumber(result.summary.total_surplus_fte_intervals)} />
                </div>

                {result.summary.worst_shortage && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                    Worst shortage: {result.summary.worst_shortage.shortage_fte} FTE on {result.summary.worst_shortage.date} at {result.summary.worst_shortage.interval_start} ({result.summary.worst_shortage.channel}).
                  </div>
                )}

                <ResultSection title="Weekly Summary">
                  <CompactTable
                    headers={["Channel", "Required", "Scheduled", "Shortage", "Surplus", "Intervals", "Shifts"]}
                    rows={result.summary.weekly_summary.channels.map(row => [
                      row.channel,
                      formatNumber(row.required_fte_intervals),
                      formatNumber(row.scheduled_productive_fte_intervals),
                      formatNumber(row.shortage_fte_intervals),
                      formatNumber(row.surplus_fte_intervals),
                      formatNumber(row.shortage_interval_count),
                      formatNumber(row.shift_count),
                    ])}
                  />
                </ResultSection>

                <ResultSection title="Daily Summary">
                  <CompactTable
                    headers={["Date", "Channel", "Required", "Scheduled", "Shortage", "Surplus", "Short intervals"]}
                    rows={result.summary.daily_summary.slice(0, 21).map(row => [
                      row.date,
                      row.channel,
                      formatNumber(row.required_fte_intervals),
                      formatNumber(row.scheduled_productive_fte_intervals),
                      formatNumber(row.shortage_fte_intervals),
                      formatNumber(row.surplus_fte_intervals),
                      formatNumber(row.shortage_interval_count),
                    ])}
                    footer={result.summary.daily_summary.length > 21 ? `${result.summary.daily_summary.length - 21} more daily rows hidden.` : undefined}
                  />
                </ResultSection>

                <ResultSection title="Coverage Variance">
                  <CompactTable
                    headers={["Date", "Time", "Channel", "Required", "Scheduled", "Shortage", "Surplus"]}
                    rows={visibleVariance.map(row => [
                      row.date,
                      row.interval_start,
                      row.channel,
                      formatNumber(row.required_fte),
                      formatNumber(row.scheduled_productive_fte),
                      formatNumber(row.shortage_fte),
                      formatNumber(row.surplus_fte),
                    ])}
                    empty="No shortage or surplus rows. All preview intervals are balanced."
                    footer={`${hiddenZeroVarianceCount} zero-variance rows hidden${hiddenVarianceCount > 0 ? `; ${hiddenVarianceCount} additional non-zero rows hidden` : ""}.`}
                  />
                </ResultSection>

                <ResultSection title="Proposed Shifts">
                  <CompactTable
                    headers={["Date", "Agent", "Channel", "Start", "End", "Productive", "Warnings"]}
                    rows={result.proposed_shifts.slice(0, 50).map(shift => [
                      shift.date,
                      shift.agent_name,
                      shift.channel,
                      shift.start_time,
                      shift.end_time,
                      `${formatNumber(shift.productive_minutes)}m`,
                      shift.warnings?.length ? shift.warnings.join("; ") : "-",
                    ])}
                    empty="No proposed shifts returned."
                    footer={result.proposed_shifts.length > 50 ? `${result.proposed_shifts.length - 50} more proposed shifts hidden.` : undefined}
                  />
                </ResultSection>

                <div className="grid gap-3 lg:grid-cols-2">
                  <TextList title="Warnings and hard-rule limitations" items={[...result.hard_rule_limitations, ...result.warnings.filter(w => !result.hard_rule_limitations.includes(w))]} />
                  <TextList
                    title="Skipped Agents"
                    items={result.skipped.map(item => `${item.agent_name || `Agent ${item.agent_id || "unknown"}`} (${item.channel || "unknown"}): ${item.reason}`)}
                    empty="No skipped agents reported."
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={previewing || committing}>Close</Button>
          <Button
            size="sm"
            disabled={!result || !resultMatchesCurrentInputs || previewing || committing}
            onClick={() => {
              setCommitError(null);
              setCommitConflict(null);
              setCommitSuccess(null);
              setConfirmMode("save");
            }}
          >
            {committing ? <><Loader2 className="size-3.5 animate-spin" /> Saving preview as draft...</> : "Save Preview as Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "danger" }) {
  return (
    <div className={`rounded-lg border p-3 ${tone === "danger" ? "border-rose-200 bg-rose-50" : "bg-background"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function ResultSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function CompactTable({ headers, rows, empty, footer }: { headers: string[]; rows: string[][]; empty?: string; footer?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="max-h-64 overflow-auto">
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-600">
            <tr>
              {headers.map(header => <th key={header} className="px-3 py-2 font-semibold">{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-muted-foreground" colSpan={headers.length}>{empty || "No rows."}</td>
              </tr>
            ) : rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t">
                {row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && <div className="border-t bg-slate-50 px-3 py-2 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}

function TextList({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  return (
    <section className="rounded-lg border p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{empty || "None reported."}</p>
      ) : (
        <ul className="mt-2 max-h-44 space-y-1 overflow-auto text-xs text-muted-foreground">
          {items.map((item, index) => <li key={`${item}-${index}`}>- {item}</li>)}
        </ul>
      )}
    </section>
  );
}
