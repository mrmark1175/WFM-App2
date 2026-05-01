import React, { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Input } from "../ui/input";
import { Trash2 } from "lucide-react";

export type ActivityType = "break" | "meal" | "coaching" | "training" | "meeting" | "offline_work" | "late" | "absent";

export interface Activity {
  id: number;
  assignment_id: number;
  activity_type: ActivityType;
  start_time: string;
  end_time: string;
  is_paid: boolean;
  notes: string | null;
}

export const ACTIVITY_CONFIG: Record<ActivityType, { label: string; color: string; textColor: string }> = {
  break:    { label: "Break",    color: "#f97316", textColor: "#fff" },
  meal:     { label: "Meal",     color: "#f59e0b", textColor: "#000" },
  coaching: { label: "Coaching", color: "#8b5cf6", textColor: "#fff" },
  training: { label: "Training", color: "#14b8a6", textColor: "#fff" },
  meeting:  { label: "Meeting",  color: "#64748b", textColor: "#fff" },
  offline_work: { label: "Offline Work", color: "#0f766e", textColor: "#fff" },
  late:     { label: "Late",     color: "#dc2626", textColor: "#fff" },
  absent:   { label: "Absent",   color: "#374151", textColor: "#fff" },
};

interface ActivitySegmentProps {
  activity: Activity;
  assignmentId: number;
  widthPx: number;
  heightPx: number;
  onUpdate: (id: number, fields: Partial<Activity>) => void;
  onDelete: (id: number) => void;
  ghost?: boolean;
}

export function ActivitySegment({
  activity,
  assignmentId,
  widthPx,
  heightPx,
  onUpdate,
  onDelete,
  ghost = false,
}: ActivitySegmentProps) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Activity>>({});

  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({
    id: `activity-${activity.id}`,
    data: { type: "activity", activity, assignmentId },
    disabled: ghost,
  });

  const cfg = ACTIVITY_CONFIG[activity.activity_type] ?? ACTIVITY_CONFIG.break;

  const style: React.CSSProperties = {
    width: widthPx,
    height: heightPx,
    backgroundColor: cfg.color,
    color: cfg.textColor,
    fontSize: 9,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    cursor: ghost ? "default" : isDragging ? "grabbing" : "grab",
    userSelect: "none",
    flexShrink: 0,
    opacity: isDragging ? 0.4 : 1,
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 30 : 10,
    position: "relative",
  };

  const openEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setForm({
      activity_type: activity.activity_type,
      start_time: activity.start_time,
      end_time: activity.end_time,
      is_paid: activity.is_paid,
      notes: activity.notes ?? "",
    });
    setEditing(true);
  };

  const save = () => {
    onUpdate(activity.id, form);
    setEditing(false);
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...(ghost ? {} : { ...listeners, ...attributes })}
        onDoubleClick={openEdit}
        title={`${cfg.label} ${activity.start_time}–${activity.end_time}`}
      >
        <span className="truncate px-0.5 font-semibold leading-none">{cfg.label}</span>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Activity</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1">
              <Label>Type</Label>
              <Select value={form.activity_type} onValueChange={(v) => setForm(f => ({ ...f, activity_type: v as ActivityType }))}>
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
                <Input type="time" value={form.start_time ?? ""} step={900} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1">
                <Label>End</Label>
                <Input type="time" value={form.end_time ?? ""} step={900} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Notes (optional)</Label>
              <Input value={form.notes ?? ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="flex justify-between">
            <Button variant="destructive" size="sm" onClick={() => { onDelete(activity.id); setEditing(false); }}>
              <Trash2 className="size-3 mr-1" />Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" onClick={save}>Save</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
