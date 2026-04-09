import React, { useRef, useState, useCallback } from "react";
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
export const COL_W = 14;   // px per 15-min column
export const ROW_H = 56;   // px per agent row
export const AGENT_W = 168; // px for the sticky name column
const TOTAL_COLS = 96;      // 24h × 4

function snapToGrid(px: number): number {
  return Math.round(px / COL_W) * COL_W;
}

function pxToTime(px: number): string {
  const slot = Math.round(px / COL_W);
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
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
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

    const startMins = timeToMins(assignment.start_time);
    const endMins   = timeToMins(assignment.end_time) || 24 * 60;
    const duration  = endMins - startMins;

    const newStartPx  = Math.max(0, timeToPx(assignment.start_time) + snappedDelta);
    const newStart    = pxToTime(newStartPx);
    const newStartM   = timeToMins(newStart);
    const newEndM     = newStartM + duration;
    const newEndH     = Math.floor(newEndM / 60) % 24;
    const newEndMin   = newEndM % 60;
    const newEnd      = `${String(newEndH).padStart(2, "0")}:${String(newEndMin).padStart(2, "0")}`;

    onShiftMove(assignment.id, newStart, newEnd);
  }, [onShiftMove]);

  const handleCellClick = useCallback((agentId: number, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const snapped = snapToGrid(clickX);
    onAddShift(agentId, pxToTime(snapped));
  }, [onAddShift]);

  const gridWidth = AGENT_W + TOTAL_COLS * COL_W;

  return (
    <DndContext sensors={sensors} modifiers={[restrictToHorizontalAxis]} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="overflow-auto rounded-[24px] border border-slate-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.08)]" style={{ maxHeight: "60vh" }}>
        <div style={{ width: gridWidth, minWidth: gridWidth }}>
          {/* Time header */}
          <div className="flex sticky top-0 z-20 bg-white border-b border-slate-200">
            {/* Agent column header */}
            <div
              className="flex items-center px-3 text-[11px] font-black text-slate-500 uppercase tracking-[0.25em] sticky left-0 z-30 bg-slate-50 border-r border-slate-200 shrink-0"
              style={{ width: AGENT_W, height: 32 }}
            >
              Agent
            </div>
            {/* Time labels */}
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
              {/* Hour grid lines in header */}
              {TIME_LABELS.filter(t => t.label).map(({ slot }) => (
                <div
                  key={`vl-${slot}`}
                  className="absolute border-l border-slate-200/80"
                  style={{ left: slot * COL_W, top: 0, height: 32 }}
                />
              ))}
            </div>
          </div>

          {/* Agent rows */}
          {agents.map((agent, idx) => {
            const agentAssignments = assignments.filter(
              a => a.agent_id === agent.id && a.work_date?.startsWith(activeDate)
            );
            return (
              <div key={agent.id} className="flex odd:bg-slate-50/40" style={{ height: ROW_H }}>
                {/* Agent name (sticky left) */}
                <div
                  className="flex items-center px-3 text-sm font-semibold text-slate-700 sticky left-0 z-10 bg-slate-50 border-r border-b border-slate-200 shrink-0 truncate"
                  style={{ width: AGENT_W, height: ROW_H }}
                  title={agent.full_name}
                >
                  {agent.full_name}
                </div>

                {/* Grid row (clickable to add shift) */}
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

                  {/* Empty state hint */}
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
        </div>
      </div>

      {/* Drag overlay — ghost of the dragged shift */}
      <DragOverlay>
        {activeShift && (
          <div style={{ width: Math.max(((timeToMins(activeShift.end_time) || 24 * 60) - timeToMins(activeShift.start_time)) / 15 * COL_W, COL_W * 2), height: ROW_H - 2 }}>
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
