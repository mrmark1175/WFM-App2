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
export const COL_W   = 11;   // px per 15-min column
export const ROW_H   = 30;   // px per agent row (thin Genesys style)
export const AGENT_W = 240;  // px for the sticky name column (includes paid hours)
export const TOTAL_COLS = 144;  // 36h × 4 — extends to noon next day for overnight shifts

// Coverage row height
const COV_ROW_H = 26;

export function snapToGrid(px: number): number {
  return Math.round(px / COL_W) * COL_W;
}

export function pxToTime(px: number): string {
  const slot = Math.round(px / COL_W);
  const clamped = Math.max(0, Math.min(143, slot));
  const wrappedMins = (clamped * 15) % (24 * 60);
  const h = Math.floor(wrappedMins / 60);
  const m = wrappedMins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Pixel position of a shift's end time, accounting for is_overnight extension
export function effectiveEndPx(startTime: string, endTime: string, isOvernight: boolean): number {
  const startMins = timeToMins(startTime);
  let endMins = timeToMins(endTime) || 24 * 60;
  if (isOvernight && endMins <= startMins) endMins += 24 * 60;
  return (endMins / 15) * COL_W;
}

export function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function timeToPx(t: string): number {
  return (timeToMins(t) / 15) * COL_W;
}

export function fmt12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Build time header labels — 144 slots (36h), slots ≥ 96 are "next day"
export const TIME_LABELS: Array<{ slot: number; label: string; nextDay?: boolean }> = Array.from(
  { length: TOTAL_COLS },
  (_, slot) => {
    const totalMins = slot * 15;
    const nextDay = slot >= 96;
    if (totalMins % 60 !== 0) return { slot, label: "", nextDay };
    const wrappedMins = totalMins % (24 * 60);
    const h = Math.floor(wrappedMins / 60);
    let label: string;
    if (h === 0) label = nextDay ? "12 AM ▸" : "12 AM";
    else if (h < 12) label = `${h} AM`;
    else if (h === 12) label = "12 PM";
    else label = `${h - 12} PM`;
    return { slot, label, nextDay };
  }
);

interface ScheduleGridProps {
  agents: Array<{ id: number; full_name: string }>;
  assignments: Assignment[];
  allWeekAssignments?: Assignment[];  // full week for paid hours calc
  activeDate: string;
  requiredFte?: number[];   // 96-element array (one per 15-min slot)
  selectedShiftId?: number | null;
  selectedAgentIds?: Set<number>;
  onShiftMove: (id: number, newStart: string, newEnd: string, newAgentId?: number) => void;
  onShiftDelete: (id: number) => void;
  onAddShift: (agentId: number, startTime: string) => void;
  onAddActivity: (assignmentId: number, act: Omit<Activity, "id" | "assignment_id">) => void;
  onUpdateActivity: (id: number, fields: Partial<Activity>) => void;
  onDeleteActivity: (assignmentId: number, activityId: number) => void;
  onUpdateTimes: (id: number, start: string, end: string) => void;
  onSelectShift?: (id: number, shiftHeld: boolean) => void;
  onSelectAgent?: (id: number, shiftHeld: boolean) => void;
}

export function ScheduleGrid({
  agents,
  assignments,
  allWeekAssignments,
  activeDate,
  requiredFte,
  selectedShiftId,
  selectedAgentIds,
  onShiftMove,
  onShiftDelete,
  onAddShift,
  onAddActivity,
  onUpdateActivity,
  onDeleteActivity,
  onUpdateTimes,
  onSelectShift,
  onSelectAgent,
}: ScheduleGridProps) {
  const [activeShift, setActiveShift] = useState<Assignment | null>(null);
  const [activeType, setActiveType] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  // Conditional modifiers: horizontal-only for resize + activity; free for shift
  const modifiers = useMemo(() => {
    if (!activeType) return [restrictToHorizontalAxis];
    if (activeType === "shift") return [];  // free movement for cross-row drag
    return [restrictToHorizontalAxis];       // resize + activity = horizontal only
  }, [activeType]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === "shift") {
      setActiveShift(data.assignment);
    }
    setActiveType(data?.type ?? null);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveShift(null);
    setActiveType(null);
    const { active, delta } = event;
    const data = active.data.current;
    if (!data) return;

    const snappedDeltaX = snapToGrid(delta.x);

    if (data.type === "shift") {
      const assignment: Assignment = data.assignment;
      const startMins = timeToMins(assignment.start_time);
      let endMins = timeToMins(assignment.end_time) || 24 * 60;
      if (assignment.is_overnight && endMins <= startMins) endMins += 24 * 60;
      const duration = endMins - startMins;

      const newStartPx = Math.max(0, timeToPx(assignment.start_time) + snappedDeltaX);
      const newStart = pxToTime(newStartPx);
      const newStartM = timeToMins(newStart);
      const newEndM = newStartM + duration;
      const newEndH = Math.floor(newEndM / 60) % 24;
      const newEndMin = newEndM % 60;
      const newEnd = `${String(newEndH).padStart(2, "0")}:${String(newEndMin).padStart(2, "0")}`;

      // Cross-row: detect target agent from vertical delta
      let newAgentId: number | undefined;
      if (Math.abs(delta.y) > ROW_H / 2 && rowsRef.current) {
        // Find which agent row the shift was originally in
        const origIdx = agents.findIndex(a => a.id === assignment.agent_id);
        const rowShift = Math.round(delta.y / ROW_H);
        const targetIdx = Math.max(0, Math.min(agents.length - 1, origIdx + rowShift));
        if (targetIdx !== origIdx) {
          newAgentId = agents[targetIdx].id;
        }
      }

      if (snappedDeltaX === 0 && !newAgentId) return;
      onShiftMove(assignment.id, newAgentId ? newStart : (snappedDeltaX === 0 ? assignment.start_time : newStart), newAgentId ? newEnd : (snappedDeltaX === 0 ? assignment.end_time : newEnd), newAgentId);
    } else if (data.type === "resize-left") {
      const assignment: Assignment = data.assignment;
      if (snappedDeltaX === 0) return;
      const endMins = timeToMins(assignment.end_time) || 24 * 60;
      const newStartPx = Math.max(0, timeToPx(assignment.start_time) + snappedDeltaX);
      const newStart = pxToTime(newStartPx);
      const newStartMins = timeToMins(newStart);
      // Clamp: can't go past earliest activity or past end
      const earliestAct = assignment.activities.length > 0
        ? Math.min(...assignment.activities.map(a => timeToMins(a.start_time)))
        : endMins;
      if (newStartMins >= endMins - 15 || newStartMins > earliestAct) return;
      onShiftMove(assignment.id, newStart, assignment.end_time);
    } else if (data.type === "resize-right") {
      const assignment: Assignment = data.assignment;
      if (snappedDeltaX === 0) return;
      const startMins = timeToMins(assignment.start_time);
      const endPx = effectiveEndPx(assignment.start_time, assignment.end_time, assignment.is_overnight);
      const newEndPxClamped = Math.max(0, endPx + snappedDeltaX);
      const newEnd = pxToTime(newEndPxClamped);
      const newRawMins = Math.round(newEndPxClamped / COL_W) * 15;
      if (newRawMins - startMins < 15) return;
      onShiftMove(assignment.id, assignment.start_time, newEnd);
    } else if (data.type === "activity") {
      const activity: Activity = data.activity;
      const assignmentId: number = data.assignmentId;
      if (snappedDeltaX === 0) return;
      const actDuration = timeToMins(activity.end_time) - timeToMins(activity.start_time);
      const newStartPx = timeToPx(activity.start_time) + snappedDeltaX;
      const newStart = pxToTime(Math.max(0, newStartPx));
      const newStartMins = timeToMins(newStart);
      const newEndMins = newStartMins + actDuration;
      const newEndH = Math.floor(newEndMins / 60) % 24;
      const newEndMin = newEndMins % 60;
      const newEnd = `${String(newEndH).padStart(2, "0")}:${String(newEndMin).padStart(2, "0")}`;
      // Clamp to shift bounds
      const asgn = assignments.find(a => a.id === assignmentId);
      if (!asgn) return;
      const shiftStart = timeToMins(asgn.start_time);
      const shiftEnd = timeToMins(asgn.end_time) || 24 * 60;
      if (newStartMins < shiftStart || newEndMins > shiftEnd) return;
      onUpdateActivity(activity.id, { start_time: newStart, end_time: newEnd });
    }
  }, [onShiftMove, onUpdateActivity, agents, assignments]);

  const handleCellClick = useCallback((agentId: number, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const snapped = snapToGrid(clickX);
    onAddShift(agentId, pxToTime(snapped));
  }, [onAddShift]);

  // ── Per-slot scheduled headcount (excludes ALL activity types) ──────
  const scheduledPerSlot = useMemo(() => {
    const dayAssignments = assignments.filter(a => a.work_date?.startsWith(activeDate));
    return Array.from({ length: 144 }, (_, slot) => {
      const slotMins = slot * 15;
      return dayAssignments.filter(a => {
        const startMins = timeToMins(a.start_time);
        let endMins = timeToMins(a.end_time);
        if (endMins === 0) endMins = 24 * 60;
        if (a.is_overnight && endMins <= startMins) endMins += 24 * 60;
        if (slotMins < startMins || slotMins >= endMins) return false;
        const onActivity = a.activities.some(act => {
          let aStart = timeToMins(act.start_time);
          let aEnd = timeToMins(act.end_time);
          if (a.is_overnight && aStart < startMins) { aStart += 24 * 60; aEnd += 24 * 60; }
          return slotMins >= aStart && slotMins < aEnd;
        });
        return !onActivity;
      }).length;
    });
  }, [assignments, activeDate]);

  // ── Paid hours calculation ──────
  const paidHoursDay = useMemo(() => {
    const map = new Map<number, number>();
    const dayAssigns = assignments.filter(a => a.work_date?.startsWith(activeDate));
    for (const a of dayAssigns) {
      const s = timeToMins(a.start_time);
      let e = timeToMins(a.end_time) || 1440;
      if (a.is_overnight && e <= s) e += 1440;
      const shiftMins = e - s;
      const actMins = a.activities.reduce((sum, act) => sum + (timeToMins(act.end_time) - timeToMins(act.start_time)), 0);
      map.set(a.agent_id, (map.get(a.agent_id) ?? 0) + Math.max(0, shiftMins - actMins));
    }
    return map;
  }, [assignments, activeDate]);

  const paidHoursWeek = useMemo(() => {
    const map = new Map<number, number>();
    const weekAssigns = allWeekAssignments ?? assignments;
    for (const a of weekAssigns) {
      const s = timeToMins(a.start_time);
      let e = timeToMins(a.end_time) || 1440;
      if (a.is_overnight && e <= s) e += 1440;
      const shiftMins = e - s;
      const actMins = a.activities.reduce((sum, act) => sum + (timeToMins(act.end_time) - timeToMins(act.start_time)), 0);
      map.set(a.agent_id, (map.get(a.agent_id) ?? 0) + Math.max(0, shiftMins - actMins));
    }
    return map;
  }, [allWeekAssignments, assignments]);

  const gridWidth = AGENT_W + TOTAL_COLS * COL_W;

  return (
    <DndContext
      sensors={sensors}
      modifiers={modifiers}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        ref={gridRef}
        className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm"
        style={{ maxHeight: "70vh" }}
      >
        <div style={{ width: gridWidth, minWidth: gridWidth }}>

          {/* ── Time header ──────────────────────────────────────────────── */}
          <div className="flex sticky top-0 z-20 bg-white border-b border-slate-200">
            {/* Agent column header */}
            <div
              className="flex items-center sticky left-0 z-30 bg-slate-50 border-r border-slate-200 shrink-0"
              style={{ width: AGENT_W, height: 28 }}
            >
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-2" style={{ width: 130 }}>Agent</span>
              <span className="text-[9px] font-semibold text-slate-400 text-center" style={{ width: 52 }}>Day</span>
              <span className="text-[9px] font-semibold text-slate-400 text-center" style={{ width: 52 }}>Week</span>
            </div>
            <div className="relative" style={{ width: TOTAL_COLS * COL_W, height: 28 }}>
              {/* Next-day zone tint */}
              <div className="absolute pointer-events-none" style={{ left: 96 * COL_W, top: 0, width: 48 * COL_W, height: 28, backgroundColor: "rgba(99,102,241,0.07)" }} />
              {TIME_LABELS.filter(t => t.label).map(({ slot, label, nextDay }) => (
                <div
                  key={slot}
                  className={`absolute text-[9px] select-none ${nextDay ? "text-indigo-400/90" : "text-slate-500"}`}
                  style={{ left: slot * COL_W, top: 8 }}
                >
                  {label}
                </div>
              ))}
              {TIME_LABELS.filter(t => t.label).map(({ slot, nextDay }) => (
                <div
                  key={`vl-${slot}`}
                  className={`absolute ${slot === 96 ? "border-l-2 border-indigo-300/70" : "border-l border-slate-200/80"}`}
                  style={{ left: slot * COL_W, top: 0, height: 28 }}
                />
              ))}
            </div>
          </div>

          {/* ── Agent rows ───────────────────────────────────────────────── */}
          <div ref={rowsRef}>
            {agents.map((agent) => {
              const agentAssignments = assignments.filter(
                a => a.agent_id === agent.id && a.work_date?.startsWith(activeDate)
              );
              const firstShift = agentAssignments[0];
              const isAgentSelected = selectedAgentIds?.has(agent.id) ?? false;
              const dayHrs = (paidHoursDay.get(agent.id) ?? 0) / 60;
              const weekHrs = (paidHoursWeek.get(agent.id) ?? 0) / 60;

              return (
                <div
                  key={agent.id}
                  className={`flex border-b border-slate-100 ${isAgentSelected ? "bg-blue-50/60" : "odd:bg-slate-50/30"}`}
                  style={{ height: ROW_H }}
                >
                  {/* Agent name + paid hours (sticky left) */}
                  <div
                    className="flex items-center sticky left-0 z-10 bg-inherit border-r border-slate-200 shrink-0 min-w-0 cursor-pointer hover:bg-slate-100/50"
                    style={{ width: AGENT_W, height: ROW_H }}
                    onClick={(e) => onSelectAgent?.(agent.id, e.shiftKey)}
                    title={agent.full_name}
                  >
                    <div className="flex flex-col min-w-0 px-2" style={{ width: 130 }}>
                      <span className="text-[11px] font-semibold text-slate-700 truncate leading-tight">
                        {agent.full_name}
                      </span>
                      {firstShift ? (
                        <span className="text-[9px] text-slate-400 font-medium tabular-nums leading-tight">
                          {fmt12(firstShift.start_time)}–{fmt12(firstShift.end_time)}
                        </span>
                      ) : (
                        <span className="text-[9px] text-slate-300 leading-tight">No shift</span>
                      )}
                    </div>
                    <span className="text-[10px] tabular-nums font-medium text-slate-500 text-center" style={{ width: 52 }}>
                      {dayHrs > 0 ? dayHrs.toFixed(1) : "—"}
                    </span>
                    <span className="text-[10px] tabular-nums font-medium text-slate-500 text-center" style={{ width: 52 }}>
                      {weekHrs > 0 ? weekHrs.toFixed(1) : "—"}
                    </span>
                  </div>

                  {/* Grid row */}
                  <div
                    className="relative border-slate-200 cursor-pointer hover:bg-slate-50/50 transition-colors"
                    style={{ width: TOTAL_COLS * COL_W, height: ROW_H }}
                    onClick={(e) => handleCellClick(agent.id, e)}
                    title="Click to add a shift"
                  >
                    {/* Next-day zone tint */}
                    <div className="absolute pointer-events-none" style={{ left: 96 * COL_W, top: 0, width: 48 * COL_W, height: ROW_H, backgroundColor: "rgba(99,102,241,0.04)" }} />
                    {/* Hour grid lines */}
                    {TIME_LABELS.filter(t => t.label).map(({ slot }) => (
                      <div
                        key={`gl-${slot}`}
                        className={`absolute pointer-events-none ${slot === 96 ? "border-l-2 border-indigo-300/50" : "border-l border-slate-200/60"}`}
                        style={{ left: slot * COL_W, top: 0, height: ROW_H }}
                      />
                    ))}
                    {/* 30-min lighter lines */}
                    {Array.from({ length: 72 }, (_, i) => i * 2).map(slot => (
                      <div
                        key={`hl-${slot}`}
                        className="absolute border-l border-slate-200/25 pointer-events-none"
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
                          isSelected={selectedShiftId === a.id}
                          onSelect={(shiftHeld) => onSelectShift?.(a.id, shiftHeld)}
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
                        <span className="flex items-center gap-1 text-[9px] text-slate-300">
                          <Plus className="size-2.5" />click to add
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Coverage Rows (sticky bottom) ─────────────────────────────── */}
          <div className="sticky bottom-0 z-20 border-t-2 border-slate-300" style={{ background: "#f8fafc" }}>

            {/* Scheduled (Available) row */}
            <div className="flex border-b border-slate-200">
              <div
                className="flex items-center px-2 sticky left-0 z-30 border-r border-slate-200 shrink-0"
                style={{ width: AGENT_W, height: COV_ROW_H, background: "#f1f5f9" }}
              >
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-700">Scheduled</span>
              </div>
              <div className="flex" style={{ height: COV_ROW_H }}>
                {scheduledPerSlot.map((val, slot) => (
                  <div
                    key={slot}
                    className="flex items-center justify-center text-[9px] font-bold border-r border-slate-100/50 tabular-nums"
                    style={{
                      width: COL_W,
                      height: COV_ROW_H,
                      backgroundColor: val > 0 ? "rgba(37,99,235,0.16)" : "transparent",
                      color: val > 0 ? "#1d4ed8" : "#94a3b8",
                    }}
                  >
                    {val > 0 ? val : ""}
                  </div>
                ))}
              </div>
            </div>

            {/* Required row */}
            <div className="flex border-b border-slate-200">
              <div
                className="flex items-center gap-1.5 px-2 sticky left-0 z-30 border-r border-slate-200 shrink-0"
                style={{ width: AGENT_W, height: COV_ROW_H, background: "#f1f5f9" }}
              >
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-700">Required</span>
                {!requiredFte && (
                  <span className="text-[8px] text-slate-500 italic normal-case">no demand plan</span>
                )}
              </div>
              <div className="flex" style={{ height: COV_ROW_H }}>
                {Array.from({ length: 144 }, (_, slot) => {
                  const val = slot < 96 ? (requiredFte?.[slot] ?? 0) : 0;
                  const isHour = slot % 4 === 0;
                  const isNextDay = slot >= 96;
                  return (
                    <div
                      key={slot}
                      className="flex items-center justify-center text-[9px] font-bold border-r border-slate-100/50 tabular-nums"
                      style={{
                        width: COL_W,
                        height: COV_ROW_H,
                        backgroundColor: isNextDay
                          ? "rgba(99,102,241,0.05)"
                          : val > 0 ? "rgba(30,41,59,0.1)" : "rgba(100,116,139,0.03)",
                        color: val > 0 ? "#1e293b" : "#cbd5e1",
                      }}
                    >
                      {val > 0 ? Math.round(val) : (isHour && !isNextDay ? "·" : "")}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* OU (Over/Under) row */}
            <div className="flex">
              <div
                className="flex items-center px-2 sticky left-0 z-30 border-r border-slate-200 shrink-0"
                style={{ width: AGENT_W, height: COV_ROW_H, background: "#f1f5f9" }}
              >
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-700">Over/Under</span>
              </div>
              <div className="flex" style={{ height: COV_ROW_H }}>
                {Array.from({ length: 144 }, (_, slot) => {
                  const req = slot < 96 ? (requiredFte?.[slot] ?? 0) : 0;
                  const diff = scheduledPerSlot[slot] - Math.ceil(req);
                  const hasData = req > 0 || scheduledPerSlot[slot] > 0;
                  const isOver = diff >= 0;
                  const isNextDay = slot >= 96;
                  return (
                    <div
                      key={slot}
                      className="flex items-center justify-center text-[9px] font-bold border-r border-slate-100/50 tabular-nums"
                      style={{
                        width: COL_W,
                        height: COV_ROW_H,
                        backgroundColor: isNextDay && !hasData
                          ? "rgba(99,102,241,0.05)"
                          : hasData ? (isOver ? "rgba(22,163,74,0.2)" : "rgba(220,38,38,0.2)") : "transparent",
                        color: hasData ? (isOver ? "#14532d" : "#7f1d1d") : "#94a3b8",
                      }}
                    >
                      {hasData ? (diff >= 0 ? `+${diff}` : diff) : ""}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Drag overlay — ghost of the dragged shift ── */}
      <DragOverlay>
        {activeShift && (
          <div
            style={{
              width: Math.max(
                effectiveEndPx(activeShift.start_time, activeShift.end_time, activeShift.is_overnight) - timeToPx(activeShift.start_time),
                COL_W * 2
              ),
              height: ROW_H - 6,
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
