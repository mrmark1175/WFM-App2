import React, { useEffect, useState } from "react";
import { PageLayout } from "../components/PageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Building2, RefreshCw } from "lucide-react";
import { useLOB, type LOB } from "../lib/lobContext";
import { apiUrl } from "../lib/api";
import { toast } from "sonner";

interface LOBMeta {
  id: number;
  lob_name: string;
  created_at: string;
  capacity_scenario_count: number;
  demand_scenario_count: number;
  last_activity: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "No activity";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function LOBManagement() {
  const { lobs, createLob, renameLob, deleteLob, setActiveLob } = useLOB();
  const [meta, setMeta] = useState<LOBMeta[]>([]);
  const [loading, setLoading] = useState(true);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  // Rename dialog
  const [renameOpen, setRenameOpen] = useState(false);
  const [renamingLob, setRenamingLob] = useState<LOB | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingLob, setDeletingLob] = useState<LOBMeta | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchMeta = () => {
    setLoading(true);
    fetch(apiUrl("/api/lobs/metadata"))
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => toast.error("Failed to load LOB data"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchMeta(); }, []);

  // Merge context LOBs with metadata for real-time name updates
  const rows: LOBMeta[] = meta.map((m) => {
    const live = lobs.find((l) => l.id === m.id);
    return live ? { ...m, lob_name: live.lob_name } : m;
  });

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    setCreateLoading(true);
    try {
      const newLob = await createLob(name);
      setActiveLob(newLob);
      setCreateOpen(false);
      setCreateName("");
      toast.success(`"${newLob.lob_name}" created`);
      fetchMeta();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create LOB");
    } finally {
      setCreateLoading(false);
    }
  };

  const openRename = (lob: LOBMeta) => {
    setRenamingLob({ id: lob.id, lob_name: lob.lob_name, organization_id: 1 });
    setRenameName(lob.lob_name);
    setRenameOpen(true);
  };

  const handleRename = async () => {
    if (!renamingLob) return;
    const name = renameName.trim();
    if (!name || name === renamingLob.lob_name) { setRenameOpen(false); return; }
    setRenameLoading(true);
    try {
      await renameLob(renamingLob.id, name);
      setRenameOpen(false);
      toast.success("LOB renamed");
      fetchMeta();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename LOB");
    } finally {
      setRenameLoading(false);
    }
  };

  const openDelete = (lob: LOBMeta) => {
    setDeletingLob(lob);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingLob) return;
    setDeleteLoading(true);
    try {
      await deleteLob(deletingLob.id);
      setDeleteOpen(false);
      toast.success(`"${deletingLob.lob_name}" deleted`);
      fetchMeta();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete LOB");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <PageLayout title="Lines of Business">
      <div className="max-w-5xl space-y-6">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Each Line of Business is an isolated workforce planning context — its forecasts, capacity
            scenarios, and shrinkage data are completely independent.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchMeta} disabled={loading}>
              <RefreshCw className={`size-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => { setCreateName(""); setCreateOpen(true); }}>
              <Plus className="size-3.5 mr-1.5" />
              New LOB
            </Button>
          </div>
        </div>

        {/* LOB table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" />
              Your Lines of Business
              <Badge variant="secondary" className="ml-1">{rows.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="py-16 text-center text-sm text-muted-foreground animate-pulse">
                Loading…
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                No Lines of Business yet.
              </div>
            ) : (
              <div className="divide-y">
                {/* Column headers */}
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-6 py-2.5 bg-muted/40 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                  <div>Name</div>
                  <div className="text-center w-28">Capacity Scenarios</div>
                  <div className="text-center w-28">Demand Scenarios</div>
                  <div className="text-right w-32">Last Activity</div>
                  <div className="w-20" />
                </div>

                {rows.map((lob) => (
                  <div
                    key={lob.id}
                    className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-6 py-4 items-center hover:bg-muted/20 transition-colors"
                  >
                    {/* Name + created date */}
                    <div>
                      <p className="font-semibold">{lob.lob_name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Created {fmtDate(lob.created_at)}
                      </p>
                    </div>

                    {/* Capacity scenarios */}
                    <div className="text-center w-28">
                      <Badge variant={lob.capacity_scenario_count > 0 ? "secondary" : "outline"}>
                        {lob.capacity_scenario_count}
                      </Badge>
                    </div>

                    {/* Demand scenarios */}
                    <div className="text-center w-28">
                      <Badge variant={lob.demand_scenario_count > 0 ? "secondary" : "outline"}>
                        {lob.demand_scenario_count}
                      </Badge>
                    </div>

                    {/* Last activity */}
                    <div className="text-right w-32">
                      <p className="text-sm font-medium">{fmtRelative(lob.last_activity)}</p>
                      {lob.last_activity && (
                        <p className="text-xs text-muted-foreground">{fmtDate(lob.last_activity)}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-1 w-20">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => openRename(lob)}
                        title="Rename"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      {rows.length > 1 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={() => openDelete(lob)}
                          title="Delete"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info card */}
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="py-4 px-5 text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">About Lines of Business</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>The active LOB is selected from the dropdown in the top navigation bar.</li>
              <li>All planning pages (Forecasting, Capacity, Shrinkage, Arrival) filter data by the active LOB.</li>
              <li>Deleting an LOB permanently removes all its associated data — this cannot be undone.</li>
              <li>You can also create and rename LOBs quickly from the header dropdown on any page.</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Line of Business</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. Inbound Sales"
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createLoading}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!createName.trim() || createLoading}>
              {createLoading ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename "{renamingLob?.lob_name}"</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)} disabled={renameLoading}>Cancel</Button>
            <Button onClick={handleRename} disabled={!renameName.trim() || renameLoading}>
              {renameLoading ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deletingLob?.lob_name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all forecasts, capacity scenarios, shrinkage plans, arrival
              data, and demand scenarios for this LOB.{" "}
              <strong>This cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading ? "Deleting…" : "Delete LOB"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageLayout>
  );
}
