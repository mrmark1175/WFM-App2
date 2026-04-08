import React, { useMemo } from "react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Assignment } from "./ShiftBlock";

function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function slotLabel(slot: number): string {
  const h = Math.floor((slot * 15) / 60);
  const m = (slot * 15) % 60;
  if (m !== 0) return "";
  return `${String(h).padStart(2, "0")}:00`;
}

interface CoverageGraphProps {
  assignments: Assignment[];
  activeDate: string;           // "YYYY-MM-DD"
  requiredFte?: number[];       // 96-element array (one per 15-min slot); undefined = not loaded
}

export function CoverageGraph({ assignments, activeDate, requiredFte }: CoverageGraphProps) {
  const scheduledPerSlot = useMemo(() => {
    const dayAssignments = assignments.filter(a => a.work_date?.startsWith(activeDate));
    return Array.from({ length: 96 }, (_, slot) => {
      const slotMins = slot * 15;
      return dayAssignments.filter(a => {
        const startMins = timeToMins(a.start_time);
        let endMins     = timeToMins(a.end_time);
        if (endMins === 0) endMins = 24 * 60; // midnight end
        if (slotMins < startMins || slotMins >= endMins) return false;
        // Exclude if on break or meal during this slot
        const onBreak = a.activities.some(act =>
          (act.activity_type === "break" || act.activity_type === "meal") &&
          slotMins >= timeToMins(act.start_time) &&
          slotMins < timeToMins(act.end_time)
        );
        return !onBreak;
      }).length;
    });
  }, [assignments, activeDate]);

  const data = useMemo(() => {
    return Array.from({ length: 96 }, (_, i) => ({
      slot: i,
      label: slotLabel(i),
      scheduled: scheduledPerSlot[i],
      required: requiredFte?.[i] ?? null,
      gap: requiredFte ? Math.max(0, (requiredFte[i] ?? 0) - scheduledPerSlot[i]) : 0,
    }));
  }, [scheduledPerSlot, requiredFte]);

  // Only show hourly ticks
  const ticks = Array.from({ length: 25 }, (_, i) => i * 4);

  const maxVal = Math.max(
    ...scheduledPerSlot,
    ...(requiredFte ?? [0])
  ) + 2;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-4 mb-3">
        <h3 className="text-sm font-bold text-foreground">Staffing Coverage</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-500" />Scheduled</span>
          {requiredFte && <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-slate-300 dark:bg-slate-600" />Required</span>}
          {requiredFte && <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-400" />Gap</span>}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={0} barCategoryGap={0}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.15)" />
          <XAxis
            dataKey="slot"
            ticks={ticks}
            tickFormatter={(v) => slotLabel(v)}
            tick={{ fontSize: 10 }}
            interval={0}
          />
          <YAxis
            domain={[0, maxVal]}
            tick={{ fontSize: 10 }}
            width={28}
            allowDecimals={false}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const slotMins = (label as number) * 15;
              const h = Math.floor(slotMins / 60).toString().padStart(2, "0");
              const m = (slotMins % 60).toString().padStart(2, "0");
              return (
                <div className="bg-popover border border-border rounded-lg p-2 text-xs shadow-lg">
                  <p className="font-bold mb-1">{h}:{m}</p>
                  {payload.map((p) => (
                    <p key={p.dataKey as string} style={{ color: p.color }}>
                      {p.name}: {typeof p.value === "number" ? p.value.toFixed(1) : p.value}
                    </p>
                  ))}
                </div>
              );
            }}
          />
          {requiredFte && (
            <Bar dataKey="required" name="Required" fill="#94a3b8" opacity={0.5} radius={[2, 2, 0, 0]} />
          )}
          <Bar dataKey="scheduled" name="Scheduled" radius={[2, 2, 0, 0]}>
            {data.map((entry, index) => {
              const isShort = requiredFte && entry.scheduled < (requiredFte[index] ?? 0);
              return <Cell key={`cell-${index}`} fill={isShort ? "#ef4444" : "#3b82f6"} />;
            })}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
