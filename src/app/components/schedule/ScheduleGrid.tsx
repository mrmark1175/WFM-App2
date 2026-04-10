import React, { useRef, useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { ShiftBlock, Assignment } from "./ShiftBlock";
import { Activity } from "./ActivityBlock";
import { Plus } from "lucide-react";

// Grid constants
export const COL_W   = 14;   // px per 15-min column
export const ROW_H   = 56;   // px per agent row
export const AGENT_W = 168;  // px for the sticky name column
const TOTAL_COLS     = 96;   // 24h × 4

// Required-agents row height
const REQ_ROW_H = 44;

function snapToGrid(px: number): number {
  return Math.round(px / COL_W) * COL_W;
}

function pxToTime(px: number): string {
  const slot    = Math.round(px / COL_W);
  const clamped = Math.max(0, Math.min(95, slot));
  const h = Math.floor((clamped * 15) / 60);
  const m = (clamped * 15) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function timeToPx(t: string): number {
  return (timeToMins(t) / 15) * COL_W;
}

function fmt12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Build time header labels
const TIME_LABELS: Array<{ slot: number; label: string }> = Array.from(
  { length: TOTAL_COLS },
  (_, slot) => {
    const mins = slot * 15;
    if (mins % 60 !== 0) return { slot, label: "" };
    const h = Math.floor(mins / 60);
    return {
      slot,
      label: h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`,
    };
  }
);

interface ScheduleGridProps {
  agents: Array<{ id: number; full_name: string }>;
  assignments: Assignment[];
  activeDate: string;
  requiredFte?: number[];   // 96-element array (one per 15-min slot)
  onShiftMove: (id: number, newStart: string, newEnd: string) => void;
  onShiftDelete: (id: number) => void;
  onAddShift: (agentId: number, startTime: string) => void;
  onAddActivity: (assignmentId: number, act: Omit<Activity, "id" | "assignment_id">) => void;
  onUpdateActivity: (id: number, fields: Partial<Activity>) => void;
  onDeleteActivity: (assignmentId: number, activityId: number) => void;
  onUpdateTimes: (id: number, start: string, end: string) => void;
}

export function ScheduleGrid({
  agents,
  assignments,
  activeDate,
  requiredFte,
  onShiftMove,
  onShiftDelete,
  onAddShift,
  onAddActivity,
  onUpdateActivity,
  onDeleteActivity,
  onUpdateTimes,
}: ScheduleGridProps) {
  const [activeShift, setActiveShift] = useState<Assignment | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,  { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === "shift") setActiveShift(data.assignment);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveShift(null);
    const { active, delta } = event;
    const data = active.data.current;
    if (!data || data.type !== "shift") return;

    const assignment: Assignment = data.assignment;
    const snappedDelta = snapToGrid(delta.x);
    if (snappedDelta === 0) return;

    const startMins  = timeToMins(assignment.start_time);
    const endMins    = timeToMins(assignment.end_time) || 24 * 60;
    const duration   = endMins - startMins;

    const newStartPx = Math.max(0, timeToPx(assignment.start_time) + snappedDelta);
    const newStart   = pxToTime(newStartPx);
    const newStartM  = timeToMins(newStart);
    const newEndM    = newStartM + duration;
    const newEndH    = Math.floor(newEndM / 60) % 24;
    const newEndMin  = newEndM % 60;
    const newEnd     = `${String(newEndH).padStart(2, "0")}:${String(newEndMin).padStart(2, "0")}`;

    onShiftMove(assignment.id, newStart, newEnd);
  }, [onShiftMove]);

  const handleCellClick = useCallback((agentId: number, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const snapped = snapToGrid(clickX);
    onAddShift(agentId, pxToTime(snapped));
  }, [onAddShift]);

  // ── Per-slot scheduled headcount for the active day (for Required row) ──────
  const scheduledPerSlot = useMemo(() => {
    if (!requiredFte) return null;
    const dayAssignments = assignments.filter(a => a.work_date?.startsWith(activeDate));
    return Array.from({ length: 96 }, (_, slot) => {
      const slotMins = slot * 15;
      return dayAssignments.filter(a => {
        const startMins = timeToMins(a.start_time);
        let endMins     = timeToMins(a.end_time);
        if (endMins === 0) endMins = 24 * 60;
        return slotMins >= startMins && slotMins < endMins;
      }).length;
    });
  }, [requiredFte, assignments, activeDate]);

  const maxRequired = useMemo(
    () => requiredFte ? Math.max(...requiredFte, 1) : 1,
    [requiredFte]
  );

  const gridWidth = AGENT_W + TOTAL_COLS * COL_W;

  return (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToHorizontalAxis]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        className="overflow-auto rounded-[24px] border border-slate-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.08)]"
        style={{ maxHeight: "60vh" }}
      >
        <div style={{ width: gridWidth, minWidth: gridWidth }}>

          {/* ── Time header ──────────────────────────────────────────────── */}
          <div className="flex sticky top-0 z-20 bg-white border-b border-slate-200">
            <div
              className="flex items-center px-3 text-[11px] font-black text-slate-500 uppercase tracking-[0.25em] sticky left-0 z-30 bg-slate-50 border-r border-slate-200 shrink-0"
              style={{ width: AGENT_W, height: 32 }}
            >
              Agent
            </div>
            <div className="relative" style={{ width: TOTAL_COLS * COL_W, height: 32 }}>
              {TIME_LABELS.filter(t => t.label).map(({ slot, label }) => (
                <div
                  key={slot}
                  className="absolute text-[10px] text-slate-500 select-none"
                  style={{ left: slot * COL_W, top: 8, transform: "translateX(-50%)" }}
                >
                  {label}
                </div>
              ))}
              {TIME_LABELS.filter(t => t.label).map(({ slot }) => (
                <div
                  key={`vl-${slot}`}
                  className="absolute border-l border-slate-200/80"
                  style={{ left: slot * COL_W, top: 0, height: 32 }}
                />
              ))}
            </div>
          </div>

          {/* ── Agent rows ───────────────────────────────────────────────── */}
          {agents.map((agent, idx) => {
            const agentAssignments = assignments.filter(
              a => a.agent_id === agent.id && a.work_date?.startsWith(activeDate)
            );
            // First shift for this day (to show time inline in the name cell)
            const firstShift = agentAssignments[0];

            return (
              <div key={agent.id} className="flex odd:bg-slate-50/40" style={{ height: ROW_H }}>

                {/* Agent name + shift time (sticky left) */}
                <div
                  className="flex flex-col items-start justify-center px-3 sticky left-0 z-10 bg-slate-50 border-r border-b border-slate-200 shrink-0 min-w-0"
                  style={{ width: AGENT_W, height: ROW_H }}
                  title={agent.full_name}
                >
                  <span className="text-sm font-semibold text-slate-700 truncate w-full leading-tight">
                    {agent.full_name}
                  </span>
                  {firstShift ? (
                    <span className="text-[10px] text-slate-400 font-medium tabular-nums leading-tight mt-0.5">
                      {fmt12(firstShift.start_time)}–{fmt12(firstShift.end_time)}
                      {agentAssignments.length > 1 && (
                        <span className="ml-1 text-slate-300">+{agentAssignments.length - 1}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-300 leading-tight mt-0.5">No shift</span>
                  )}
                </div>

                {/* Grid row (click to add shift) */}
                <div
                  ref={idx === 0 ? gridRef : undefined}
                  className="relative border-b border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors"
                  style={{ width: TOTAL_COLS * COL_W, height: ROW_H }}
                  onClick={(e) => handleCellClick(agent.id, e)}
                  title="Click to add a shift"
                >
                  {/* Hour grid lines */}
                  {TIME_LABELS.filter(t => t.label).map(({ slot }) => (
                    <div
                      key={`gl-${slot}`}
                      className="absolute border-l border-slate-200/70 pointer-events-none"
                      style={{ left: slot * COL_W, top: 0, height: ROW_H }}
                    />
                  ))}
                  {/* 30-min lighter lines */}
                  {Array.from({ length: 48 }, (_, i) => i * 2).map(slot => (
                    <div
                      key={`hl-${slot}`}
                      className="absolute border-l border-slate-200/35 pointer-events-none"
                      style={{ left: slot * COL_W, top: 0, height: ROW_H }}
                    />
                  ))}

                  {/* Shift blocks */}
                  {agentAssignments.map(a => (
                    <div key={a.id} onClick={e => e.stopPropagation()}>
                      <ShiftBlock
                        assignment={a}
                        colW={COL_W}
                        rowH={ROW_H}
                        onUpdateTimes={onUpdateTimes}
                        onDelete={onShiftDelete}
                        onAddActivity={onAddActivity}
                        onUpdateActivity={onUpdateActivity}
                        onDeleteActivity={onDeleteActivity}
                      />
                    </div>
                  ))}

                  {agentAssignments.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="flex items-center gap-1 text-[10px] text-slate-400">
                        <Plus className="size-3" />click to assign shift
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* ── Required Agents Row ──────────────────────────────────────── */}
          {requiredFte && scheduledPerSlot && (
            <div
              className="flex sticky bottom-0 z-20 border-t-2 border-slate-300"
              style={{ background: "#f8fafc" }}
            >
              {/* Label cell */}
              <div
                className="flex flex-col items-start justify-center px-3 sticky left-0 z-30 border-r border-slate-300 shrink-0"
                style={{ width: AGENT_W, height: REQ_ROW_H, background: "#f1f5f9" }}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 leading-tight">
                  Required
                </span>
                <span className="text-[9px] text-slate-400 leading-tight mt-0.5">
                  agents / 15 min
                </span>
              </div>

              {/* Per-interval bars */}
              <div className="relative" style={{ width: TOTAL_COLS * COL_W, height: REQ_ROW_H }}>
                {requiredFte.map((req, slot) => {
                  const sched  = scheduledPerSlot[slot];
                  const barH   = Math.max(2, Math.round((req / maxRequired) * (REQ_ROW_H - 8)));
                  const isShort = sched < Math.ceil(req);
                  const color  = req === 0 ? "#e2e8f0" : isShort ? "#ef4444" : "#22c55e";
                  const slotMins = slot * 15;
                  const hh = String(Math.floor(slotMins / 60)).padStart(2, "0");
                  const mm = String(slotMins % 60).padStart(2, "0");
                  return (
                    <div
                      key={slot}
                      title={`${hh}:${mm} — Required: ${req.toFixed(1)}, Scheduled: ${sched}`}
                      style={{
                        position: "absolute",
                        left: slot * COL_W,
                        bottom: 4,
                        width: Math.max(1, COL_W - 1),
                        height: barH,
                        backgroundColor: color,
                        opacity: 0.75,
                        borderRadius: 1,
                      }}
                    />
                  );
                })}

                {/* Hour grid lines */}
                {TIME_LABELS.filter(t => t.label).map(({ slot }) => (
                  <div
                    key={`rl-${slot}`}
                    className="absolute border-l border-slate-200/70 pointer-events-none"
                    style={{ left: slot * COL_W, top: 0, height: REQ_ROW_H }}
                  />
                ))}

                {/* Legend labels at the top of bars */}
                {TIME_LABELS.filter(t => t.label).map(({ slot }) => {
                  const req = requiredFte[slot];
                  if (!req) return null;
                  return (
                    <div
                      key={`rv-${slot}`}
                      className="absolute text-[8px] text-slate-500 select-none pointer-events-none"
                      style={{ left: slot * COL_W + 1, top: 3 }}
                    >
                      {Math.round(req)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Drag overlay — ghost of the dragged shift (with activities) ── */}
      <DragOverlay>
        {activeShift && (
          <div
            style={{
              width: Math.max(
                ((timeToMins(activeShift.end_time) || 24 * 60) - timeToMins(activeShift.start_time)) / 15 * COL_W,
                COL_W * 2
              ),
              height: ROW_H - 2,
            }}
          >
            <ShiftBlock
              assignment={activeShift}
              colW={COL_W}
              rowH={ROW_H}
              ghost
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
