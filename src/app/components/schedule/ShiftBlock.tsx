import React, { useState, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ActivitySegment, Activity, ActivityType, ACTIVITY_CONFIG } from "./ActivityBlock";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ui/context-menu";

export interface Assignment {
  id: number;
  agent_id: number;
  agent_name: string;
  skill_voice: boolean;
  skill_chat: boolean;
  skill_email: boolean;
  shift_template_id: number | null;
  template_name: string | null;
  template_color: string | null;
  work_date: string;
  start_time: string;
  end_time: string;
  is_overnight: boolean;
  channel: string;
  notes: string | null;
  activities: Activity[];
}

function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function fmt12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Build segments array: alternating "On Queue" gaps and activity segments
interface Segment {
  type: "queue" | "activity";
  startMins: number;
  endMins: number;
  durationMins: number;
  activity?: Activity;
}

function buildSegments(activities: Activity[], shiftStartMins: number, shiftEndMins: number): Segment[] {
  const sorted = [...activities].sort((a, b) => timeToMins(a.start_time) - timeToMins(b.start_time));
  const segments: Segment[] = [];
  let cursor = shiftStartMins;

  for (const act of sorted) {
    const actStart = timeToMins(act.start_time);
    const actEnd = timeToMins(act.end_time);
    if (actStart < shiftStartMins || actEnd > shiftEndMins) continue;

    // Gap before this activity = On Queue
    if (actStart > cursor) {
      segments.push({ type: "queue", startMins: cursor, endMins: actStart, durationMins: actStart - cursor });
    }
    segments.push({ type: "activity", startMins: actStart, endMins: actEnd, durationMins: actEnd - actStart, activity: act });
    cursor = actEnd;
  }

  // Trailing gap
  if (cursor < shiftEndMins) {
    segments.push({ type: "queue", startMins: cursor, endMins: shiftEndMins, durationMins: shiftEndMins - cursor });
  }

  return segments;
}

interface ShiftBlockProps {
  assignment: Assignment;
  colW: number;
  rowH: number;
  ghost?: boolean;
  isSelected?: boolean;
  onSelect?: (shiftHeld: boolean) => void;
  onUpdateTimes?: (id: number, start: string, end: string) => void;
  onDelete?: (id: number) => void;
  onAddActivity?: (assignmentId: number, act: Omit<Activity, "id" | "assignment_id">) => void;
  onUpdateActivity?: (id: number, fields: Partial<Activity>) => void;
  onDeleteActivity?: (assignmentId: number, activityId: number) => void;
}

export function ShiftBlock({
  assignment,
  colW,
  rowH,
  ghost = false,
  isSelected = false,
  onSelect,
  onUpdateTimes,
  onDelete,
  onAddActivity,
  onUpdateActivity,
  onDeleteActivity,
}: ShiftBlockProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [addActOpen, setAddActOpen] = useState(false);
  const [editTimes, setEditTimes] = useState({ start: assignment.start_time, end: assignment.end_time });
  const [newAct, setNewAct] = useState<{
    activity_type: ActivityType;
    start_time: string;
    end_time: string;
    is_paid: boolean;
    notes: string;
  }>({
    activity_type: "break",
    start_time: assignment.start_time,
    end_time: assignment.start_time,
    is_paid: false,
    notes: "",
  });

  // Main shift draggable
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `shift-${assignment.id}`,
    data: { type: "shift", assignment },
    disabled: ghost,
  });

  // Resize handles
  const { setNodeRef: setLeftRef, listeners: leftListeners, attributes: leftAttrs } = useDraggable({
    id: `resize-left-${assignment.id}`,
    data: { type: "resize-left", assignment },
    disabled: ghost,
  });
  const { setNodeRef: setRightRef, listeners: rightListeners, attributes: rightAttrs } = useDraggable({
    id: `resize-right-${assignment.id}`,
    data: { type: "resize-right", assignment },
    disabled: ghost,
  });

  const startMins = timeToMins(assignment.start_time);
  const endMins = timeToMins(assignment.end_time) || 24 * 60;
  const durationMins = endMins - startMins;

  const left = (startMins / 15) * colW;
  const width = Math.max((durationMins / 15) * colW, colW * 2);
  const barH = rowH - 6;

  const color = assignment.template_color ?? "#3b82f6";

  const segments = useMemo(
    () => buildSegments(assignment.activities, startMins, endMins),
    [assignment.activities, startMins, endMins]
  );

  const outerStyle: React.CSSProperties = {
    position: ghost ? "relative" : "absolute",
    top: ghost ? undefined : 3,
    left: ghost ? undefined : left,
    width: ghost ? "100%" : width,
    height: barH,
    borderRadius: 4,
    overflow: "hidden",
    cursor: isDragging ? "grabbing" : "move",
    userSelect: "none",
    opacity: ghost ? 0.7 : isDragging ? 0.4 : 1,
    boxShadow: isSelected
      ? "0 0 0 2px #3b82f6, 0 1px 3px rgba(0,0,0,0.2)"
      : isDragging ? "none" : "0 1px 3px rgba(0,0,0,0.18)",
    transform: ghost ? undefined : CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : isSelected ? 5 : 2,
    display: "flex",
    flexDirection: "row" as const,
    alignItems: "stretch",
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!ghost && onSelect) {
      onSelect(e.shiftKey);
    }
  };

  const shiftBar = (
    <div
      ref={setNodeRef}
      style={outerStyle}
      {...(ghost ? {} : { ...listeners, ...attributes })}
      onClick={handleClick}
      title={`${fmt12(assignment.start_time)} – ${fmt12(assignment.end_time)}${assignment.template_name ? ` (${assignment.template_name})` : ""}`}
    >
      {/* Left resize handle */}
      {!ghost && (
        <div
          ref={setLeftRef}
          {...leftListeners}
          {...leftAttrs}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 6,
            height: "100%",
            cursor: "col-resize",
            zIndex: 20,
          }}
          onClick={e => e.stopPropagation()}
        />
      )}

      {/* Segments */}
      {segments.map((seg, i) => {
        const segWidth = Math.max((seg.durationMins / 15) * colW, 1);
        if (seg.type === "queue") {
          return (
            <div
              key={`q-${i}`}
              style={{
                width: segWidth,
                height: "100%",
                backgroundColor: color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              {segWidth > 40 && (
                <span style={{ fontSize: 9, color: "#fff", fontWeight: 600, opacity: 0.9 }} className="truncate px-0.5">
                  On Queue
                </span>
              )}
            </div>
          );
        }
        // Activity segment
        return (
          <ActivitySegment
            key={seg.activity!.id}
            activity={seg.activity!}
            assignmentId={assignment.id}
            widthPx={segWidth}
            heightPx={barH}
            onUpdate={(id, fields) => onUpdateActivity?.(id, fields)}
            onDelete={(id) => onDeleteActivity?.(assignment.id, id)}
            ghost={ghost}
          />
        );
      })}

      {/* Right resize handle */}
      {!ghost && (
        <div
          ref={setRightRef}
          {...rightListeners}
          {...rightAttrs}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 6,
            height: "100%",
            cursor: "col-resize",
            zIndex: 20,
          }}
          onClick={e => e.stopPropagation()}
        />
      )}
    </div>
  );

  return (
    <>
      {ghost ? (
        shiftBar
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            {shiftBar}
          </ContextMenuTrigger>
          <ContextMenuContent className="z-50">
            <ContextMenuItem
              onClick={() => {
                setEditTimes({ start: assignment.start_time, end: assignment.end_time });
                setEditOpen(true);
              }}
            >
              <Pencil className="size-3 mr-2" />Edit Times
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                setNewAct({
                  activity_type: "break",
                  start_time: assignment.start_time,
                  end_time: assignment.start_time,
                  is_paid: false,
                  notes: "",
                });
                setAddActOpen(true);
              }}
            >
              <Plus className="size-3 mr-2" />Add Activity
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive"
              onClick={() => onDelete?.(assignment.id)}
            >
              <Trash2 className="size-3 mr-2" />Delete Shift
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}

      {/* Edit Times Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Shift Times</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="flex flex-col gap-1">
              <Label>Start Time</Label>
              <Input type="time" step={900} value={editTimes.start} onChange={e => setEditTimes(t => ({ ...t, start: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>End Time</Label>
              <Input type="time" step={900} value={editTimes.end} onChange={e => setEditTimes(t => ({ ...t, end: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => { onUpdateTimes?.(assignment.id, editTimes.start, editTimes.end); setEditOpen(false); }}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Activity Dialog */}
      <Dialog open={addActOpen} onOpenChange={setAddActOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Activity</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1">
              <Label>Type</Label>
              <Select value={newAct.activity_type} onValueChange={(v) => setNewAct(a => ({ ...a, activity_type: v as ActivityType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTIVITY_CONFIG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label>Start</Label>
                <Input type="time" step={900} value={newAct.start_time} onChange={e => setNewAct(a => ({ ...a, start_time: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1">
                <Label>End</Label>
                <Input type="time" step={900} value={newAct.end_time} onChange={e => setNewAct(a => ({ ...a, end_time: e.target.value }))} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Notes (optional)</Label>
              <Input value={newAct.notes} onChange={e => setNewAct(a => ({ ...a, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddActOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => {
              onAddActivity?.(assignment.id, { ...newAct });
              setAddActOpen(false);
            }}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
