import React, { useEffect, useState } from "react";
import { PageLayout } from "../../components/PageLayout";
import { useAuth, type UserRole } from "@/context/AuthContext";
import { RoleBadge } from "../../components/RoleBadge";
import { ProtectedRoute } from "../../components/ProtectedRoute";
import { apiUrl } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../../components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../components/ui/select";
import { UserPlus, Pencil, UserX, ChevronDown, ChevronUp } from "lucide-react";

const ROLE_DEFINITIONS: Record<UserRole, { label: string; description: string; can: string[]; cannot: string[] }> = {
  super_admin: {
    label: "Super Admin",
    description: "Full platform access including user management.",
    can: ["All WFM forecasting & planning pages", "Scheduling (view + edit)", "Configuration & LOB settings", "AI settings", "Create, edit, and deactivate users"],
    cannot: [],
  },
  client_admin: {
    label: "Admin",
    description: "Full app access without the ability to manage users.",
    can: ["All WFM forecasting & planning pages", "Scheduling (view + edit)", "Configuration & LOB settings", "AI settings"],
    cannot: ["User Management (add, edit, deactivate users)"],
  },
  supervisor: {
    label: "Supervisor",
    description: "Standard WFM access for day-to-day operations.",
    can: ["Demand Forecasting", "Capacity & Shrinkage Planning", "Intraday Forecast", "Scheduling (view + edit)", "Agent Roster & Shift Templates"],
    cannot: ["Configuration", "AI Settings", "LOB Management", "User Management"],
  },
  read_only: {
    label: "Read Only",
    description: "View-only access — no edits or data changes allowed.",
    can: ["View all WFM pages and schedules"],
    cannot: ["Make any edits, save data, or run actions"],
  },
};

interface UserRow {
  id: number;
  organization_id: number;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

const ASSIGNABLE_ROLES: { value: UserRole; label: string }[] = [
  { value: "supervisor", label: "Supervisor" },
  { value: "read_only", label: "Read Only" },
];
const ADMIN_ROLES: { value: UserRole; label: string }[] = [
  { value: "super_admin", label: "Super Admin" },
  { value: "client_admin", label: "Admin" },
  ...ASSIGNABLE_ROLES,
];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export function UsersPage() {
  const { user: me, hasRole } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rolesOpen, setRolesOpen] = useState(false);

  // Add user dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ email: "", full_name: "", password: "", role: "read_only" as UserRole });
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  // Edit user dialog
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ full_name: "", role: "read_only" as UserRole });
  const [editError, setEditError] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // Deactivate confirm
  const [deactivateUser, setDeactivateUser] = useState<UserRow | null>(null);
  const [deactivateLoading, setDeactivateLoading] = useState(false);

  async function fetchUsers() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/api/users"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load users");
      setUsers(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchUsers(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    setAddLoading(true);
    try {
      const res = await fetch(apiUrl("/api/users"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error || "Failed to create user"); return; }
      setAddOpen(false);
      setAddForm({ email: "", full_name: "", password: "", role: "read_only" });
      await fetchUsers();
    } catch {
      setAddError("Network error");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setEditError("");
    setEditLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/users/${editUser.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) { setEditError(data.error || "Failed to update user"); return; }
      setEditUser(null);
      await fetchUsers();
    } catch {
      setEditError("Network error");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDeactivate() {
    if (!deactivateUser) return;
    setDeactivateLoading(true);
    try {
      await fetch(apiUrl(`/api/users/${deactivateUser.id}`), {
        method: "DELETE",
        credentials: "include",
      });
      setDeactivateUser(null);
      await fetchUsers();
    } finally {
      setDeactivateLoading(false);
    }
  }

  const availableRoles = hasRole("super_admin") ? ADMIN_ROLES : ASSIGNABLE_ROLES;

  return (
    <ProtectedRoute roles={["super_admin", "client_admin"]}>
      <PageLayout title="User Management">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Manage users in your organization.
            </p>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <UserPlus className="size-4 mr-1.5" />
              Add User
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="rounded-lg border overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium">Name</th>
                    <th className="text-left px-4 py-3 font-medium">Email</th>
                    <th className="text-left px-4 py-3 font-medium">Role</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Last Login</th>
                    <th className="text-right px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{u.full_name || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${u.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {u.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(u.last_login_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => { setEditUser(u); setEditForm({ full_name: u.full_name || "", role: u.role }); }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          {u.id !== me?.id && u.is_active && (
                            <Button variant="ghost" size="icon" onClick={() => setDeactivateUser(u)}>
                              <UserX className="size-3.5 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No users found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Role Definitions */}
        <div className="rounded-lg border">
          <button
            type="button"
            onClick={() => setRolesOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors"
          >
            <span>Role Definitions</span>
            {rolesOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
          </button>
          {rolesOpen && (
            <div className="border-t grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x">
              {(Object.keys(ROLE_DEFINITIONS) as UserRole[]).map(role => {
                const def = ROLE_DEFINITIONS[role];
                return (
                  <div key={role} className="px-4 py-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <RoleBadge role={role} />
                    </div>
                    <p className="text-xs text-muted-foreground">{def.description}</p>
                    {def.can.length > 0 && (
                      <ul className="space-y-1">
                        {def.can.map(item => (
                          <li key={item} className="flex items-start gap-1.5 text-xs text-green-700 dark:text-green-400">
                            <span className="mt-px shrink-0">✓</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {def.cannot.length > 0 && (
                      <ul className="space-y-1">
                        {def.cannot.map(item => (
                          <li key={item} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <span className="mt-px shrink-0">✕</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add User Dialog */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add User</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input value={addForm.full_name} onChange={e => setAddForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jane Cruz" />
              </div>
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input type="email" required value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Temporary Password *</Label>
                <Input type="password" required minLength={8} value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 8 characters" />
              </div>
              <div className="space-y-1.5">
                <Label>Role *</Label>
                <Select value={addForm.role} onValueChange={v => setAddForm(f => ({ ...f, role: v as UserRole }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {availableRoles.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{ROLE_DEFINITIONS[addForm.role].description}</p>
              </div>
              {addError && <p className="text-sm text-destructive">{addError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={addLoading}>{addLoading ? "Creating…" : "Create User"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Edit User Dialog */}
        <Dialog open={!!editUser} onOpenChange={v => { if (!v) setEditUser(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User — {editUser?.email}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={editForm.role} onValueChange={v => setEditForm(f => ({ ...f, role: v as UserRole }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {availableRoles.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{ROLE_DEFINITIONS[editForm.role].description}</p>
              </div>
              {editError && <p className="text-sm text-destructive">{editError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
                <Button type="submit" disabled={editLoading}>{editLoading ? "Saving…" : "Save Changes"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Deactivate Confirm */}
        <AlertDialog open={!!deactivateUser} onOpenChange={v => { if (!v) setDeactivateUser(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Deactivate User</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to deactivate <strong>{deactivateUser?.email}</strong>? They will no longer be able to log in.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeactivate} disabled={deactivateLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {deactivateLoading ? "Deactivating…" : "Deactivate"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageLayout>
    </ProtectedRoute>
  );
}
