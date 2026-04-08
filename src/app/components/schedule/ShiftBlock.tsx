import React, { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { MoreVertical, Plus, Pencil, Trash2 } from "lucide-react";
import { ActivityBlock, Activity, ActivityType, ACTIVITY_CONFIG } from "./ActivityBlock";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

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

interface ShiftBlockProps {
  assignment: Assignment;
  colW: number;
  rowH: number;
  ghost?: boolean;
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
  onUpdateTimes,
  onDelete,
  onAddActivity,
  onUpdateActivity,
  onDeleteActivity,
}: ShiftBlockProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [addActOpen, setAddActOpen] = useState(false);
  const [editTimes, setEditTimes] = useState({ start: assignment.start_time, end: assignment.end_time });
  const [newAct, setNewAct] = useState<{ activity_type: ActivityType; start_time: string; end_time: string; is_paid: boolean; notes: string }>({
    activity_type: "break", start_time: assignment.start_time, end_time: assignment.start_time, is_paid: false, notes: "",
  });

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `shift-${assignment.id}`,
    data: { type: "shift", assignment },
    disabled: ghost,
  });

  const startMins    = timeToMins(assignment.start_time);
  const endMins      = timeToMins(assignment.end_time) || 24 * 60;
  const durationMins = endMins - startMins;

  const left  = (startMins / 15) * colW;
  const width = Math.max((durationMins / 15) * colW, colW * 2);

  const color = assignment.template_color ?? "#3b82f6";

  const style: React.CSSProperties = {
    position: ghost ? "relative" : "absolute",
    top: ghost ? undefined : 1,
    left: ghost ? undefined : left,
    width: ghost ? "100%" : width,
    height: rowH - 2,
    backgroundColor: color,
    borderRadius: 6,
    overflow: "hidden",
    cursor: isDragging ? "grabbing" : "grab",
    userSelect: "none",
    opacity: ghost ? 0.6 : isDragging ? 0.4 : 1,
    boxShadow: isDragging ? "none" : "0 1px 3px rgba(0,0,0,0.3)",
    transform: ghost ? undefined : CSS.Translate.toString(transform),
    zIndex: isDragging ? 1 : 2,
  };

  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <>
      <div ref={setNodeRef} style={style} {...(ghost ? {} : { ...listeners, ...attributes })}>
        {/* Header bar */}
        <div className="flex items-center justify-between px-2 py-0.5 gap-1" style={{ background: "rgba(0,0,0,0.2)", height: 24 }}>
          <span className="text-white text-[11px] font-bold truncate flex-1">
            {assignment.agent_name}
          </span>
          <span className="text-white/80 text-[10px] shrink-0">
            {fmt12(assignment.start_time)}–{fmt12(assignment.end_time)}
          </span>
          {!ghost && (
            <div onClick={stopProp}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="text-white/80 hover:text-white ml-1 flex-shrink-0">
                    <MoreVertical className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-50">
                  <DropdownMenuItem onClick={() => { setEditTimes({ start: assignment.start_time, end: assignment.end_time }); setEditOpen(true); }}>
                    <Pencil className="size-3 mr-2" />Edit Times
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    setNewAct({ activity_type: "break", start_time: assignment.start_time, end_time: assignment.start_time, is_paid: false, notes: "" });
                    setAddActOpen(true);
                  }}>
                    <Plus className="size-3 mr-2" />Add Activity
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => onDelete?.(assignment.id)}>
                    <Trash2 className="size-3 mr-2" />Delete Shift
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* Activity sub-blocks */}
        {!ghost && assignment.activities.map(act => (
          <ActivityBlock
            key={act.id}
            activity={act}
            shiftStartMins={startMins}
            colW={colW}
            rowH={rowH}
            onUpdate={(id, fields) => onUpdateActivity?.(id, fields)}
            onDelete={(id) => onDeleteActivity?.(assignment.id, id)}
          />
        ))}
      </div>

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
            <Button size="sm" onClick={() => { onUpdateTimes?.(assignment.id, editTimes.start, editTimes.end); setEditOpen(false); }}>Save</Button>
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
            }}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
