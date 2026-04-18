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
import { ChevronRight, ChevronDown, Plus } from "lucide-react";
import {
  COL_W,
  ROW_H,
  AGENT_W,
  TOTAL_COLS,
  snapToGrid,
  pxToTime,
  timeToPx,
  timeToMins,
  fmt12,
  TIME_LABELS,
  effectiveEndPx,
} from "./ScheduleGrid";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface RowMapEntry {
  agentId: number;
  dateStr: string | null; // null = collapsed row (keep original date on drop)
}

interface WeeklyScheduleGridProps {
  agents: Array<{ id: number; full_name: string }>;
  assignments: Assignment[];
  weekDates: string[];       // 7 date strings [Mon..Sun]
  selectedShiftId?: number | null;
  selectedAgentIds?: Set<number>;
  hasClipboard?: boolean;
  onShiftMove: (id: number, newStart: string, newEnd: string, newAgentId?: number, newWorkDate?: string) => void;
  onShiftDelete: (id: number) => void;
  onAddShift: (agentId: number, startTime: string, workDate: string) => void;
  onAddActivity: (assignmentId: number, act: Omit<Activity, "id" | "assignment_id">) => void;
  onUpdateActivity: (id: number, fields: Partial<Activity>) => void;
  onDeleteActivity: (assignmentId: number, activityId: number) => void;
  onUpdateTimes: (id: number, start: string, end: string) => void;
  onSelectShift?: (id: number, shiftHeld: boolean) => void;
  onSelectAgent?: (id: number, shiftHeld: boolean) => void;
  onPaste?: (agentId: number, dateStr: string) => void;
}

export function WeeklyScheduleGrid({
  agents,
  assignments,
  weekDates,
  selectedShiftId,
  selectedAgentIds,
  hasClipboard,
  onShiftMove,
  onShiftDelete,
  onAddShift,
  onAddActivity,
  onUpdateActivity,
  onDeleteActivity,
  onUpdateTimes,
  onSelectShift,
  onSelectAgent,
  onPaste,
}: WeeklyScheduleGridProps) {
  const [expandedAgents, setExpandedAgents] = useState<Set<number>>(new Set());
  const [activeShift, setActiveShift] = useState<Assignment | null>(null);
  const [activeType, setActiveType] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  const modifiers = useMemo(() => {
    if (!activeType) return [restrictToHorizontalAxis];
    if (activeType === "shift") return [];
    return [restrictToHorizontalAxis];
  }, [activeType]);

  const toggleAgent = useCallback((id: number) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedAgents(new Set(agents.map(a => a.id)));
  }, [agents]);

  const collapseAll = useCallback(() => {
    setExpandedAgents(new Set());
  }, []);

  // Build flat row map for drag targeting
  const rowMap = useMemo<RowMapEntry[]>(() => {
    const map: RowMapEntry[] = [];
    for (const agent of agents) {
      if (expandedAgents.has(agent.id)) {
        for (const dateStr of weekDates) {
          map.push({ agentId: agent.id, dateStr });
        }
      } else {
        map.push({ agentId: agent.id, dateStr: null });
      }
    }
    return map;
  }, [agents, expandedAgents, weekDates]);

  // Per-agent weekly shift counts
  const weeklyShiftCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const a of assignments) {
      map.set(a.agent_id, (map.get(a.agent_id) ?? 0) + 1);
    }
    return map;
  }, [assignments]);

  // Per-agent weekly paid hours
  const weeklyPaidHours = useMemo(() => {
    const map = new Map<number, number>();
    for (const a of assignments) {
      const s = timeToMins(a.start_time);
      let e = timeToMins(a.end_time) || 1440;
      if (a.is_overnight && e <= s) e += 1440;
      const shiftMins = e - s;
      const actMins = a.activities.reduce((sum, act) => sum + (timeToMins(act.end_time) - timeToMins(act.start_time)), 0);
      map.set(a.agent_id, (map.get(a.agent_id) ?? 0) + Math.max(0, shiftMins - actMins));
    }
    return map;
  }, [assignments]);

  // Format short date label
  const formatDayLabel = useCallback((dateStr: string, dayIdx: number) => {
    const d = new Date(`${dateStr}T00:00:00`);
    return `${DAY_LABELS[dayIdx]} ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }, []);

  // ── Drag handlers ──────────────────────────────────────────────────────

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
      const newEnd = `${String(Math.floor(newEndM / 60) % 24).padStart(2, "0")}:${String(newEndM % 60).padStart(2, "0")}`;

      // Cross-row: detect target from rowMap
      let newAgentId: number | undefined;
      let newWorkDate: string | undefined;

      if (Math.abs(delta.y) > ROW_H / 2) {
        // Find the source row index
        const origDateStr = assignment.work_date?.slice(0, 10);
        const origRowIdx = rowMap.findIndex(r =>
          r.agentId === assignment.agent_id &&
          (r.dateStr === origDateStr || (r.dateStr === null && !expandedAgents.has(assignment.agent_id)))
        );

        if (origRowIdx >= 0) {
          const rowShift = Math.round(delta.y / ROW_H);
          const targetIdx = Math.max(0, Math.min(rowMap.length - 1, origRowIdx + rowShift));
          const target = rowMap[targetIdx];

          if (target.agentId !== assignment.agent_id) {
            newAgentId = target.agentId;
          }
          if (target.dateStr && target.dateStr !== origDateStr) {
            newWorkDate = target.dateStr;
          }
          // Dropping on collapsed row: keep original date, change agent only
          if (target.dateStr === null && target.agentId !== assignment.agent_id) {
            newAgentId = target.agentId;
          }
        }
      }

      if (snappedDeltaX === 0 && !newAgentId && !newWorkDate) return;
      onShiftMove(
        assignment.id,
        snappedDeltaX === 0 && !newAgentId && !newWorkDate ? assignment.start_time : newStart,
        snappedDeltaX === 0 && !newAgentId && !newWorkDate ? assignment.end_time : newEnd,
        newAgentId,
        newWorkDate
      );
    } else if (data.type === "resize-left") {
      const assignment: Assignment = data.assignment;
      if (snappedDeltaX === 0) return;
      const endMins = timeToMins(assignment.end_time) || 24 * 60;
      const newStartPx = Math.max(0, timeToPx(assignment.start_time) + snappedDeltaX);
      const newStart = pxToTime(newStartPx);
      const newStartMins = timeToMins(newStart);
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
      const newEnd = `${String(Math.floor(newEndMins / 60) % 24).padStart(2, "0")}:${String(newEndMins % 60).padStart(2, "0")}`;
      const asgn = assignments.find(a => a.id === assignmentId);
      if (!asgn) return;
      const shiftStart = timeToMins(asgn.start_time);
      const shiftEnd = timeToMins(asgn.end_time) || 24 * 60;
      if (newStartMins < shiftStart || newEndMins > shiftEnd) return;
      onUpdateActivity(activity.id, { start_time: newStart, end_time: newEnd });
    }
  }, [onShiftMove, onUpdateActivity, assignments, rowMap, expandedAgents]);

  const handleCellClick = useCallback((agentId: number, dateStr: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (hasClipboard && onPaste) {
      onPaste(agentId, dateStr);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const snapped = snapToGrid(clickX);
    onAddShift(agentId, pxToTime(snapped), dateStr);
  }, [hasClipboard, onPaste, onAddShift]);

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
        style={{ maxHeight: "75vh" }}
      >
        <div style={{ width: gridWidth, minWidth: gridWidth }}>

          {/* ── Time header ──────────────────────────────────────────────── */}
          <div className="flex sticky top-0 z-20 bg-white border-b border-slate-200">
            <div
              className="flex items-center sticky left-0 z-30 bg-slate-50 border-r border-slate-200 shrink-0"
              style={{ width: AGENT_W, height: 28 }}
            >
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-2 flex-1">Agent</span>
              <div className="flex items-center gap-1 pr-2">
                <button
                  type="button"
                  onClick={expandAll}
                  className="text-[8px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-wider"
                  title="Expand all"
                >
                  All
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={collapseAll}
                  className="text-[8px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-wider"
                  title="Collapse all"
                >
                  None
                </button>
              </div>
            </div>
            <div className="relative" style={{ width: TOTAL_COLS * COL_W, height: 28 }}>
              {/* Next-day zone tint */}
              <div className="absolute pointer-events-none" style={{ left: 96 * COL_W, top: 0, width: 48 * COL_W, height: 28, backgroundColor: "rgba(99,102,241,0.07)" }} />
              {TIME_LABELS.filter(t => t.label).map(({ slot, label, nextDay }) => (
                <div
                  key={slot}
                  className={`absolute text-[9px] select-none ${nextDay ? "text-indigo-400/90" : "text-slate-500"}`}
                  style={{ left: slot * COL_W, top: 8, transform: "translateX(-50%)" }}
                >
                  {label}
                </div>
              ))}
              {TIME_LABELS.filter(t => t.label).map(({ slot }) => (
                <div
                  key={`vl-${slot}`}
                  className={`absolute ${slot === 96 ? "border-l-2 border-indigo-300/70" : "border-l border-slate-200/80"}`}
                  style={{ left: slot * COL_W, top: 0, height: 28 }}
                />
              ))}
            </div>
          </div>

          {/* ── Agent sections ────────────────────────────────────────────── */}
          <div>
            {agents.map((agent) => {
              const isExpanded = expandedAgents.has(agent.id);
              const isAgentSelected = selectedAgentIds?.has(agent.id) ?? false;
              const shiftCount = weeklyShiftCounts.get(agent.id) ?? 0;
              const paidMins = weeklyPaidHours.get(agent.id) ?? 0;
              const paidHrs = paidMins / 60;

              if (!isExpanded) {
                // ── Collapsed row ────────────────────────────────────────
                return (
                  <div
                    key={agent.id}
                    className={`flex border-b border-slate-100 ${isAgentSelected ? "bg-blue-50/60" : "odd:bg-slate-50/30"}`}
                    style={{ height: ROW_H }}
                  >
                    <div
                      className="flex items-center sticky left-0 z-10 bg-inherit border-r border-slate-200 shrink-0 min-w-0 cursor-pointer hover:bg-slate-100/50"
                      style={{ width: AGENT_W, height: ROW_H }}
                      onClick={(e) => onSelectAgent?.(agent.id, e.shiftKey)}
                      title={agent.full_name}
                    >
                      <button
                        type="button"
                        className="flex items-center justify-center w-5 h-5 ml-1 shrink-0 text-slate-400 hover:text-slate-600"
                        onClick={(e) => { e.stopPropagation(); toggleAgent(agent.id); }}
                      >
                        <ChevronRight className="size-3" />
                      </button>
                      <div className="flex flex-col min-w-0 px-1.5 flex-1">
                        <span className="text-[11px] font-semibold text-slate-700 truncate leading-tight">
                          {agent.full_name}
                        </span>
                        <span className="text-[9px] text-slate-400 leading-tight">
                          {shiftCount > 0 ? `${shiftCount} shift${shiftCount !== 1 ? "s" : ""} · ${paidHrs.toFixed(1)}h` : "No shifts"}
                        </span>
                      </div>
                    </div>

                    {/* Empty grid area for collapsed row */}
                    <div
                      className="relative border-slate-200"
                      style={{ width: TOTAL_COLS * COL_W, height: ROW_H }}
                    >
                      {TIME_LABELS.filter(t => t.label).map(({ slot }) => (
                        <div
                          key={`gl-${slot}`}
                          className="absolute border-l border-slate-200/40 pointer-events-none"
                          style={{ left: slot * COL_W, top: 0, height: ROW_H }}
                        />
                      ))}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="text-[9px] text-slate-300 italic">
                          Click [+] to expand
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }

              // ── Expanded: 7 day sub-rows ────────────────────────────────
              return (
                <div key={agent.id} className="border-b-2 border-slate-300">
                  {weekDates.map((dateStr, dayIdx) => {
                    const dayAssignments = assignments.filter(
                      a => a.agent_id === agent.id && a.work_date?.startsWith(dateStr)
                    );
                    const isFirstRow = dayIdx === 0;
                    const isWeekend = dayIdx >= 5;

                    return (
                      <div
                        key={dateStr}
                        className={`flex border-b border-slate-100 ${
                          isAgentSelected ? "bg-blue-50/60" :
                          isWeekend ? "bg-slate-50/60" :
                          dayIdx % 2 === 0 ? "bg-white" : "bg-slate-50/30"
                        }`}
                        style={{ height: ROW_H }}
                      >
                        {/* Left column: agent name (first row only) + day label */}
                        <div
                          className="flex items-center sticky left-0 z-10 bg-inherit border-r border-slate-200 shrink-0 min-w-0"
                          style={{ width: AGENT_W, height: ROW_H }}
                        >
                          {isFirstRow ? (
                            <>
                              <button
                                type="button"
                                className="flex items-center justify-center w-5 h-5 ml-1 shrink-0 text-slate-400 hover:text-slate-600"
                                onClick={() => toggleAgent(agent.id)}
                              >
                                <ChevronDown className="size-3" />
                              </button>
                              <div
                                className="flex flex-col min-w-0 px-1 cursor-pointer hover:bg-slate-100/50 rounded"
                                style={{ width: 100 }}
                                onClick={(e) => onSelectAgent?.(agent.id, e.shiftKey)}
                                title={agent.full_name}
                              >
                                <span className="text-[11px] font-semibold text-slate-700 truncate leading-tight">
                                  {agent.full_name}
                                </span>
                                <span className="text-[9px] text-slate-400 leading-tight tabular-nums">
                                  {paidHrs.toFixed(1)}h/wk
                                </span>
                              </div>
                            </>
                          ) : (
                            <div style={{ width: 126 }} /> // spacer matching chevron + name
                          )}
                          <span className={`text-[10px] font-medium tabular-nums ml-auto pr-2 ${
                            isWeekend ? "text-slate-400" : "text-slate-500"
                          }`}>
                            {formatDayLabel(dateStr, dayIdx)}
                          </span>
                        </div>

                        {/* Grid row with shift blocks */}
                        <div
                          className={`relative transition-colors ${
                            hasClipboard
                              ? "cursor-copy hover:bg-blue-50/40"
                              : "cursor-pointer hover:bg-slate-50/50"
                          }`}
                          style={{ width: TOTAL_COLS * COL_W, height: ROW_H }}
                          onClick={(e) => handleCellClick(agent.id, dateStr, e)}
                          title={hasClipboard ? "Click to paste copied shift" : "Click to add a shift"}
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
                          {dayAssignments.map(a => (
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

                          {dayAssignments.length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              {hasClipboard ? (
                                <span className="text-[9px] text-blue-300 font-medium">click to paste</span>
                              ) : (
                                <span className="flex items-center gap-1 text-[9px] text-slate-300">
                                  <Plus className="size-2.5" />click to add
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
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
