import React, { useState } from "react";
import { Check, ChevronDown, Pencil, Plus, Trash2, Building2 } from "lucide-react";
import { useLOB, type LOB } from "@/app/lib/lobContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/app/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { toast } from "sonner";

export function LOBSelector() {
  const { lobs, activeLob, setActiveLob, createLob, renameLob, deleteLob, isLoading } = useLOB();

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renamingLob, setRenamingLob] = useState<LOB | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingLob, setDeletingLob] = useState<LOB | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const openRename = (lob: LOB, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingLob(lob);
    setRenameName(lob.lob_name);
    setRenameOpen(true);
  };

  const openDelete = (lob: LOB, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingLob(lob);
    setDeleteOpen(true);
  };

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    setCreateLoading(true);
    try {
      const newLob = await createLob(name);
      setActiveLob(newLob);
      setCreateOpen(false);
      setCreateName("");
      toast.success(`LOB "${newLob.lob_name}" created`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create LOB");
    } finally {
      setCreateLoading(false);
    }
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
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to rename LOB");
    } finally {
      setRenameLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingLob) return;
    setDeleteLoading(true);
    try {
      await deleteLob(deletingLob.id);
      setDeleteOpen(false);
      toast.success(`LOB "${deletingLob.lob_name}" deleted`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete LOB");
    } finally {
      setDeleteLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-muted-foreground animate-pulse">
        <Building2 className="size-4" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="flex items-center gap-2 max-w-[220px]">
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{activeLob?.lob_name ?? "Select LOB"}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground ml-auto" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {lobs.map((lob) => (
            <DropdownMenuItem
              key={lob.id}
              className="flex items-center justify-between gap-2 cursor-pointer pr-1"
              onSelect={() => setActiveLob(lob)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Check
                  className={`size-3.5 shrink-0 ${activeLob?.id === lob.id ? "opacity-100" : "opacity-0"}`}
                />
                <span className="truncate">{lob.lob_name}</span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  onClick={(e) => openRename(lob, e)}
                  title="Rename"
                >
                  <Pencil className="size-3" />
                </Button>
                {lobs.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 text-destructive hover:text-destructive"
                    onClick={(e) => openDelete(lob, e)}
                    title="Delete"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="flex items-center gap-2 cursor-pointer text-primary"
            onSelect={() => { setCreateName(""); setCreateOpen(true); }}
          >
            <Plus className="size-4" />
            New Line of Business
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create LOB Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Line of Business</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="lob-create-name">Name</Label>
            <Input
              id="lob-create-name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. Inbound Sales"
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createLoading}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!createName.trim() || createLoading}>
              {createLoading ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename LOB Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename LOB</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="lob-rename-name">New name</Label>
            <Input
              id="lob-rename-name"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)} disabled={renameLoading}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={!renameName.trim() || renameLoading}>
              {renameLoading ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete LOB Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deletingLob?.lob_name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all forecasts, actuals, capacity scenarios, and shrinkage
              data for this LOB. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading ? "Deleting..." : "Delete LOB"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
