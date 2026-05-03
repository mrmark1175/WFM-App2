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
import { UserPlus, Pencil, UserX, ChevronDown, ChevronUp, RefreshCw, Copy, Check, KeyRound } from "lucide-react";

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
  rta: {
    label: "RTA",
    description: "Real-time analyst access for adherence and live traffic monitoring.",
    can: ["Real Time Management", "Manual adherence dashboard", "Punch corrections"],
    cannot: ["User Management", "Core configuration"],
  },
  agent: {
    label: "Agent",
    description: "Self-service access for schedule and manual attendance punches.",
    can: ["View own schedule", "Punch own manual status"],
    cannot: ["View other agents", "Edit schedules", "Correct punches"],
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

interface AgentRow {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  user_id: number | null;
}

const ASSIGNABLE_ROLES: { value: UserRole; label: string }[] = [
  { value: "rta", label: "RTA" },
  { value: "supervisor", label: "Supervisor" },
  { value: "agent", label: "Agent" },
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
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rolesOpen, setRolesOpen] = useState(false);

  // Add user dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ email: "", full_name: "", password: "", role: "read_only" as UserRole });
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [showAddPassword, setShowAddPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [addNameTouched, setAddNameTouched] = useState(false);

  // Reset password dialog
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(true);
  const [resetCopied, setResetCopied] = useState(false);

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

  async function fetchAgents() {
    try {
      const res = await fetch(apiUrl("/api/scheduling/agents"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load agents");
      const data = await res.json();
      setAgents(Array.isArray(data) ? data : []);
    } catch {
      setAgents([]);
    }
  }

  useEffect(() => {
    fetchUsers();
    fetchAgents();
  }, []);

  const normalizedAddEmail = addForm.email.trim().toLowerCase();
  const normalizedAddName = addForm.full_name.trim().toLowerCase();
  const existingUserWithEmail = normalizedAddEmail
    ? users.find(u => u.email.trim().toLowerCase() === normalizedAddEmail)
    : undefined;
  const existingUsersWithName = normalizedAddName
    ? users.filter(u => (u.full_name || "").trim().toLowerCase() === normalizedAddName)
    : [];
  const matchingRosterAgent = normalizedAddEmail
    ? agents.find(a => (a.email || "").trim().toLowerCase() === normalizedAddEmail)
    : undefined;
  const matchingRosterName = matchingRosterAgent
    ? (matchingRosterAgent.full_name || [matchingRosterAgent.first_name, matchingRosterAgent.last_name].filter(Boolean).join(" ")).trim()
    : "";

  function handleAddEmailChange(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const matchedAgent = agents.find(a => (a.email || "").trim().toLowerCase() === normalizedEmail);
    const matchedName = matchedAgent
      ? (matchedAgent.full_name || [matchedAgent.first_name, matchedAgent.last_name].filter(Boolean).join(" ")).trim()
      : "";
    setAddForm(f => ({
      ...f,
      email,
      full_name: matchedName && !addNameTouched ? matchedName : f.full_name,
    }));
  }

  function resetAddUserDialog() {
    setAddForm({ email: "", full_name: "", password: "", role: "read_only" });
    setShowAddPassword(false);
    setCopied(false);
    setAddError("");
    setAddNameTouched(false);
  }

  function makeTemporaryPassword() {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
    const array = new Uint8Array(14);
    crypto.getRandomValues(array);
    return Array.from(array, b => charset[b % charset.length]).join("");
  }

  function generatePassword() {
    const pw = makeTemporaryPassword();
    setAddForm(f => ({ ...f, password: pw }));
    setShowAddPassword(true);
    setCopied(false);
  }

  function copyPassword() {
    navigator.clipboard.writeText(addForm.password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function openResetPassword(user: UserRow) {
    setResetUser(user);
    setResetPassword(makeTemporaryPassword());
    setResetError("");
    setResetLoading(false);
    setShowResetPassword(true);
    setResetCopied(false);
  }

  function generateResetPassword() {
    setResetPassword(makeTemporaryPassword());
    setShowResetPassword(true);
    setResetCopied(false);
  }

  function copyResetPassword() {
    navigator.clipboard.writeText(resetPassword).then(() => {
      setResetCopied(true);
      setTimeout(() => setResetCopied(false), 2000);
    });
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetUser) return;
    setResetError("");
    setResetLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/users/${resetUser.id}/reset-password`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: resetPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setResetError(data.error || "Failed to reset password"); return; }
      setResetUser(null);
      setResetPassword("");
      setResetCopied(false);
      await fetchUsers();
    } catch {
      setResetError("Network error");
    } finally {
      setResetLoading(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    if (existingUserWithEmail) {
      setAddError(`A user already exists for ${existingUserWithEmail.email}${existingUserWithEmail.full_name ? ` (${existingUserWithEmail.full_name})` : ""}.`);
      return;
    }
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
      resetAddUserDialog();
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

  async function handleActivate(user: UserRow) {
    try {
      const res = await fetch(apiUrl(`/api/users/${user.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ is_active: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to activate user");
        return;
      }
      await fetchUsers();
    } catch {
      setError("Network error");
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
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => { setEditUser(u); setEditForm({ full_name: u.full_name || "", role: u.role }); }}
                            title="Edit user"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          {hasRole("super_admin") && u.id !== me?.id && (
                            <Button variant="ghost" size="icon" onClick={() => openResetPassword(u)} title="Reset password">
                              <KeyRound className="size-3.5" />
                            </Button>
                          )}
                          {u.id === me?.id ? (
                            <Button variant="outline" size="sm" className="h-8 text-xs" disabled>
                              Current user
                            </Button>
                          ) : u.is_active ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
                              onClick={() => setDeactivateUser(u)}
                            >
                              <UserX className="size-3.5" />
                              Deactivate
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                              onClick={() => handleActivate(u)}
                            >
                              <Check className="size-3.5" />
                              Activate
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
        <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) resetAddUserDialog(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add User</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input
                  value={addForm.full_name}
                  onChange={e => { setAddNameTouched(true); setAddForm(f => ({ ...f, full_name: e.target.value })); }}
                  placeholder="Jane Cruz"
                />
                {matchingRosterName && (
                  <p className="text-xs text-emerald-700">Matched roster agent: {matchingRosterName}</p>
                )}
                {existingUsersWithName.length > 0 && !existingUserWithEmail && (
                  <p className="text-xs text-amber-700">
                    A user with this name already exists. Confirm the email before creating another login.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input type="email" required value={addForm.email} onChange={e => handleAddEmailChange(e.target.value)} placeholder="jane@company.com" />
                {existingUserWithEmail && (
                  <p className="text-xs text-destructive">
                    This email already belongs to {existingUserWithEmail.full_name || existingUserWithEmail.email}.
                  </p>
                )}
                {matchingRosterAgent?.user_id && !existingUserWithEmail && (
                  <p className="text-xs text-amber-700">
                    This roster agent is already linked to a user login. Check Agent Roster before creating another account.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Temporary Password *</Label>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Input
                      type={showAddPassword ? "text" : "password"}
                      required
                      minLength={8}
                      value={addForm.password}
                      onChange={e => { setAddForm(f => ({ ...f, password: e.target.value })); setCopied(false); }}
                      placeholder="Min 8 characters"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAddPassword(v => !v)}
                      className="absolute inset-y-0 right-2.5 flex items-center text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showAddPassword
                        ? <svg xmlns="http://www.w3.org/2000/svg" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg xmlns="http://www.w3.org/2000/svg" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                  <Button type="button" variant="outline" size="icon" onClick={generatePassword} title="Generate password">
                    <RefreshCw className="size-3.5" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={copyPassword} disabled={!addForm.password} title="Copy password">
                    {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">The user must set a new password on first login.</p>
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
                <Button type="submit" disabled={addLoading || !!existingUserWithEmail}>{addLoading ? "Creating..." : "Create User"}</Button>
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
                <Select
                  value={editForm.role}
                  onValueChange={v => setEditForm(f => ({ ...f, role: v as UserRole }))}
                  disabled={editUser?.id === me?.id && editUser?.role === "super_admin"}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {availableRoles.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{ROLE_DEFINITIONS[editForm.role].description}</p>
                {editUser?.id === me?.id && editUser?.role === "super_admin" && (
                  <p className="text-xs text-amber-700">Your own Super Admin role cannot be removed.</p>
                )}
              </div>
              {editError && <p className="text-sm text-destructive">{editError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
                <Button type="submit" disabled={editLoading}>{editLoading ? "Saving…" : "Save Changes"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Reset Password Dialog */}
        <Dialog open={!!resetUser} onOpenChange={v => { if (!v) setResetUser(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset Password - {resetUser?.email}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Temporary Password *</Label>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Input
                      type={showResetPassword ? "text" : "password"}
                      required
                      minLength={8}
                      value={resetPassword}
                      onChange={e => { setResetPassword(e.target.value); setResetCopied(false); }}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPassword(v => !v)}
                      className="absolute inset-y-0 right-2.5 flex items-center text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showResetPassword
                        ? <svg xmlns="http://www.w3.org/2000/svg" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg xmlns="http://www.w3.org/2000/svg" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                  <Button type="button" variant="outline" size="icon" onClick={generateResetPassword} title="Generate password">
                    <RefreshCw className="size-3.5" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={copyResetPassword} disabled={!resetPassword} title="Copy password">
                    {resetCopied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">The user must set a new password on next login.</p>
              </div>
              {resetError && <p className="text-sm text-destructive">{resetError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setResetUser(null)}>Cancel</Button>
                <Button type="submit" disabled={resetLoading}>{resetLoading ? "Resetting..." : "Reset Password"}</Button>
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
