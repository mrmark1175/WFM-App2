import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import { useLOB } from "../lib/lobContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ArrowLeft, Calendar, Clock, Coffee, Loader2, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SchedulerRules {
  default_shift_hours: number;
  shift_start_granularity_mins: number;
  days_per_week: number;
  require_consecutive_rest: boolean;
  break_duration_mins: number;
  lunch_duration_mins: number;
  break_1_after_hours: number;
  lunch_after_hours: number;
  break_2_after_hours: number;
}

const DEFAULTS: SchedulerRules = {
  default_shift_hours: 9,
  shift_start_granularity_mins: 30,
  days_per_week: 5,
  require_consecutive_rest: true,
  break_duration_mins: 15,
  lunch_duration_mins: 60,
  break_1_after_hours: 2,
  lunch_after_hours: 4,
  break_2_after_hours: 7,
};

// ── Section card ──────────────────────────────────────────────────────────────

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3 pt-4 px-5">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {children}
      </CardContent>
    </Card>
  );
}

// ── Radio pill group ──────────────────────────────────────────────────────────

function PillGroup<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { label: string; value: T; hint?: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex flex-col items-center justify-center px-4 py-2 rounded-lg border text-sm font-semibold transition-colors min-w-[72px] ${
            value === opt.value
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:text-slate-900"
          }`}
        >
          <span>{opt.label}</span>
          {opt.hint && (
            <span className={`text-[10px] font-normal mt-0.5 ${value === opt.value ? "text-slate-300" : "text-slate-400"}`}>
              {opt.hint}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 flex-shrink-0 h-5 w-9 rounded-full border-2 transition-colors cursor-pointer ${
          checked ? "bg-slate-900 border-slate-900" : "bg-slate-200 border-slate-200"
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
      </div>
      <div>
        <div className="text-sm font-medium text-slate-800">{label}</div>
        {description && <div className="text-xs text-slate-400 mt-0.5">{description}</div>}
      </div>
    </label>
  );
}

// ── Number field ──────────────────────────────────────────────────────────────

function NumericField({ label, value, onChange, min, max, step, unit, hint }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number; unit?: string; hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={min}
          max={max}
          step={step ?? 1}
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
          className="h-8 w-24 text-sm border-slate-200"
        />
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
      {hint && <p className="text-[11px] text-slate-400 leading-snug">{hint}</p>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SchedulerRules() {
  const navigate = useNavigate();
  const { activeLob } = useLOB();

  const [rules, setRules] = useState<SchedulerRules>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const load = useCallback(() => {
    if (!activeLob) return;
    setLoading(true);
    fetch(apiUrl(`/api/scheduling/rules?lob_id=${activeLob.id}`))
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setRules({
            default_shift_hours: Number(data.default_shift_hours ?? DEFAULTS.default_shift_hours),
            shift_start_granularity_mins: Number(data.shift_start_granularity_mins ?? DEFAULTS.shift_start_granularity_mins),
            days_per_week: Number(data.days_per_week ?? DEFAULTS.days_per_week),
            require_consecutive_rest: data.require_consecutive_rest ?? DEFAULTS.require_consecutive_rest,
            break_duration_mins: Number(data.break_duration_mins ?? DEFAULTS.break_duration_mins),
            lunch_duration_mins: Number(data.lunch_duration_mins ?? DEFAULTS.lunch_duration_mins),
            break_1_after_hours: Number(data.break_1_after_hours ?? DEFAULTS.break_1_after_hours),
            lunch_after_hours: Number(data.lunch_after_hours ?? DEFAULTS.lunch_after_hours),
            break_2_after_hours: Number(data.break_2_after_hours ?? DEFAULTS.break_2_after_hours),
          });
        }
        setIsDirty(false);
      })
      .catch(() => toast.error("Failed to load scheduler rules"))
      .finally(() => setLoading(false));
  }, [activeLob]);

  useEffect(() => { load(); }, [load]);

  function update<K extends keyof SchedulerRules>(field: K, value: SchedulerRules[K]) {
    setRules(prev => ({ ...prev, [field]: value }));
    setIsDirty(true);
  }

  async function save() {
    if (!activeLob) return;
    setSaving(true);
    try {
      const res = await fetch(apiUrl(`/api/scheduling/rules?lob_id=${activeLob.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules),
      });
      if (!res.ok) throw new Error(await res.text());
      setIsDirty(false);
      toast.success("Scheduler rules saved");
    } catch (err: any) {
      toast.error(`Save failed: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setRules(DEFAULTS);
    setIsDirty(true);
  }

  const restDays = 7 - rules.days_per_week;

  return (
    <PageLayout title="Scheduler Rules">
      <div className="flex flex-col bg-white min-h-screen">

        {/* ── Toolbar ── */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 h-[52px]">
          <button
            type="button"
            onClick={() => navigate("/scheduling/schedule")}
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Back to Schedule Editor
          </button>

          <div className="flex-1" />

          {activeLob && (
            <span className="text-xs text-slate-500 font-medium hidden sm:block">
              {activeLob.lob_name}
            </span>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-slate-500"
            onClick={reset}
          >
            <RotateCcw className="size-3.5" />
            <span className="hidden sm:inline">Reset to defaults</span>
          </Button>

          <Button
            type="button"
            size="sm"
            className={`h-8 gap-1.5 ${isDirty ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-slate-900 hover:bg-slate-800 text-white"}`}
            disabled={!activeLob || saving}
            onClick={save}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {saving ? "Saving…" : "Save Rules"}
          </Button>
        </div>

        {/* ── Content ── */}
        <div className="max-w-2xl mx-auto w-full px-4 py-6 flex flex-col gap-5">

          {!activeLob ? (
            <div className="flex items-center justify-center py-24 text-slate-400 text-sm">
              Select a Line of Business to configure its scheduler rules.
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-24 text-slate-400 gap-2">
              <Loader2 className="animate-spin size-4" />
              <span className="text-sm">Loading rules…</span>
            </div>
          ) : (
            <>
              {/* ── Shift Settings ── */}
              <Section icon={<Clock className="size-4 text-blue-500" />} title="Shift Settings">
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Default Shift Length</Label>
                    <PillGroup
                      value={rules.default_shift_hours}
                      onChange={(v) => update("default_shift_hours", v)}
                      options={[
                        { label: "6 h",   value: 6 },
                        { label: "7 h",   value: 7 },
                        { label: "7.5 h", value: 7.5 },
                        { label: "8 h",   value: 8 },
                        { label: "8.5 h", value: 8.5 },
                        { label: "9 h",   value: 9 },
                        { label: "10 h",  value: 10 },
                        { label: "12 h",  value: 12 },
                      ]}
                    />
                    <p className="text-[11px] text-slate-400">
                      Applied as the LOB-wide default. Per-agent overrides set in Agent Roster take priority.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Shift Start Granularity</Label>
                    <PillGroup
                      value={rules.shift_start_granularity_mins}
                      onChange={(v) => update("shift_start_granularity_mins", v)}
                      options={[
                        { label: "15 min", value: 15, hint: "finer" },
                        { label: "30 min", value: 30, hint: "default" },
                        { label: "60 min", value: 60, hint: "coarser" },
                      ]}
                    />
                    <p className="text-[11px] text-slate-400">
                      Constrains which start times the generator considers (e.g. 30 min → 08:00, 08:30, 09:00…).
                      Finer granularity gives better coverage fit but more start-time variation.
                    </p>
                  </div>
                </div>
              </Section>

              {/* ── Work Pattern ── */}
              <Section icon={<Calendar className="size-4 text-violet-500" />} title="Work Pattern">
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Days Worked Per Week</Label>
                    <PillGroup
                      value={rules.days_per_week}
                      onChange={(v) => update("days_per_week", v)}
                      options={[
                        { label: "4 days", value: 4, hint: "3 rest days" },
                        { label: "5 days", value: 5, hint: "2 rest days" },
                      ]}
                    />
                    <p className="text-[11px] text-slate-400">
                      Agents on a 4-day schedule rest {restDays} day{restDays !== 1 ? "s" : ""} per week.
                      A 10-hour shift length is typical for 4×10 schedules.
                    </p>
                  </div>

                  <Toggle
                    checked={rules.require_consecutive_rest}
                    onChange={(v) => update("require_consecutive_rest", v)}
                    label="Require consecutive rest days"
                    description={
                      rules.require_consecutive_rest
                        ? `Agents get ${restDays} back-to-back rest day${restDays !== 1 ? "s" : ""} (e.g. Sat+Sun or Wed+Thu).`
                        : `Rest days may be split (e.g. Wednesday off + Sunday off). Gives more scheduling flexibility.`
                    }
                  />
                </div>
              </Section>

              {/* ── Break Rules ── */}
              <Section icon={<Coffee className="size-4 text-amber-500" />} title="Break Rules">
                <div className="flex flex-col gap-4">
                  <p className="text-xs text-slate-500">
                    Applied to shifts of <strong>8.5 hours or longer</strong>. Shorter shifts get fewer or shorter breaks automatically.
                  </p>

                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    <NumericField
                      label="1st Break — offset"
                      value={rules.break_1_after_hours}
                      onChange={(v) => update("break_1_after_hours", v)}
                      min={0.5} max={4} step={0.5} unit="hrs after start"
                    />
                    <NumericField
                      label="1st Break — duration"
                      value={rules.break_duration_mins}
                      onChange={(v) => update("break_duration_mins", v)}
                      min={5} max={30} unit="min"
                    />
                    <NumericField
                      label="Lunch — offset"
                      value={rules.lunch_after_hours}
                      onChange={(v) => update("lunch_after_hours", v)}
                      min={2} max={7} step={0.5} unit="hrs after start"
                    />
                    <NumericField
                      label="Lunch — duration"
                      value={rules.lunch_duration_mins}
                      onChange={(v) => update("lunch_duration_mins", v)}
                      min={15} max={90} step={5} unit="min"
                    />
                    <NumericField
                      label="2nd Break — offset"
                      value={rules.break_2_after_hours}
                      onChange={(v) => update("break_2_after_hours", v)}
                      min={4} max={10} step={0.5} unit="hrs after start"
                    />
                    <div className="text-[11px] text-slate-400 leading-snug pt-5">
                      Duration same as 1st break ({rules.break_duration_mins} min).
                    </div>
                  </div>

                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-500 leading-relaxed">
                    <strong className="text-slate-700">Preview</strong> for a {rules.default_shift_hours}h shift starting at 08:00:
                    {rules.default_shift_hours >= 8.5 ? (
                      <ul className="mt-1.5 space-y-0.5 list-none">
                        <li>Break 1: {formatOffset(8 * 60, rules.break_1_after_hours)} — {rules.break_duration_mins} min</li>
                        <li>Lunch: {formatOffset(8 * 60, rules.lunch_after_hours)} — {rules.lunch_duration_mins} min</li>
                        <li>Break 2: {formatOffset(8 * 60, rules.break_2_after_hours)} — {rules.break_duration_mins} min</li>
                      </ul>
                    ) : rules.default_shift_hours >= 6 ? (
                      <ul className="mt-1.5 space-y-0.5 list-none">
                        <li>Break: {formatOffset(8 * 60, rules.break_1_after_hours)} — {rules.break_duration_mins} min</li>
                        <li>Short lunch: {formatOffset(8 * 60, rules.default_shift_hours / 2)} — {Math.min(rules.lunch_duration_mins, 30)} min</li>
                      </ul>
                    ) : (
                      <ul className="mt-1.5 space-y-0.5 list-none">
                        <li>Break: {formatOffset(8 * 60, rules.default_shift_hours / 2)} — {rules.break_duration_mins} min</li>
                      </ul>
                    )}
                  </div>
                </div>
              </Section>

              {/* ── Bottom actions ── */}
              <div className="flex items-center justify-between pt-1 pb-4">
                <button
                  type="button"
                  onClick={() => navigate("/scheduling/schedule")}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors"
                >
                  <ArrowLeft className="size-3.5" />
                  Back to Schedule Editor
                </button>
                <Button
                  type="button"
                  size="sm"
                  className={`gap-1.5 ${isDirty ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-slate-900 hover:bg-slate-800 text-white"}`}
                  disabled={!activeLob || saving}
                  onClick={save}
                >
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  {saving ? "Saving…" : "Save Rules"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

function formatOffset(startMins: number, afterHours: number): string {
  const total = startMins + Math.round(afterHours * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
