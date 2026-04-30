import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiUrl } from "@/app/lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Lock, Eye, EyeOff } from "lucide-react";

export function ForceChangePassword() {
  const { refreshUser } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (newPassword !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/set-initial-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to update password."); return; }
      await refreshUser();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-background rounded-xl border shadow-2xl p-6 space-y-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="rounded-full bg-amber-100 dark:bg-amber-900/40 p-3">
            <Lock className="size-5 text-amber-600 dark:text-amber-400" />
          </div>
          <h2 className="text-lg font-semibold">Set Your Password</h2>
          <p className="text-sm text-muted-foreground">
            Your account was created with a temporary password. Please set a new password to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fcp-new">New Password</Label>
            <div className="relative">
              <Input
                id="fcp-new"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="pr-10"
                required
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowNew(v => !v)}
                className="absolute inset-y-0 right-2.5 flex items-center text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fcp-confirm">Confirm Password</Label>
            <div className="relative">
              <Input
                id="fcp-confirm"
                type={showConfirm ? "text" : "password"}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Re-enter new password"
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                className="absolute inset-y-0 right-2.5 flex items-center text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Saving…" : "Set Password & Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
