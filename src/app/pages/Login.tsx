import React, { useState } from "react";
import { apiUrl } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Eye, EyeOff, KeyRound, Loader2, Lock, ShieldCheck } from "lucide-react";
import logo from "../../assets/logo.svg";

type View = "login" | "recover" | "recover-done";

interface LoginPageProps {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [view, setView] = useState<View>("login");

  // login form
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // recover form
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [recoverError, setRecoverError] = useState("");
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [newRecoveryKey, setNewRecoveryKey] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) { setLoginError(data.error || "Login failed"); return; }
      onLogin();
    } catch {
      setLoginError("Could not reach server. Please try again.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    setRecoverError("");
    if (newPassword !== confirmPassword) { setRecoverError("Passwords do not match"); return; }
    if (newPassword.length < 6) { setRecoverError("Password must be at least 6 characters"); return; }
    setRecoverLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/recover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryKey, newPassword }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) { setRecoverError(data.error || "Recovery failed"); return; }
      setNewRecoveryKey(data.newRecoveryKey || "");
      setView("recover-done");
    } catch {
      setRecoverError("Could not reach server. Please try again.");
    } finally {
      setRecoverLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo / branding */}
        <div className="flex flex-col items-center gap-3">
          <img src={logo} alt="Exordium" className="h-10 w-auto" />
          <p className="text-sm text-muted-foreground">Workforce Management Platform</p>
        </div>

        {/* ── Login form ───────────────────────────────────────── */}
        {view === "login" && (
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Lock className="size-4 text-muted-foreground" />
                Sign in
              </CardTitle>
              <CardDescription>Enter the admin password to continue.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Enter password"
                      autoFocus
                      className="pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute inset-y-0 right-2.5 flex items-center text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                {loginError && (
                  <p className="text-sm text-destructive">{loginError}</p>
                )}
                <Button type="submit" className="w-full" disabled={loginLoading}>
                  {loginLoading && <Loader2 className="size-4 animate-spin" />}
                  {loginLoading ? "Signing in…" : "Sign in"}
                </Button>
              </form>
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => { setView("recover"); setLoginError(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                >
                  Forgot your password?
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Recovery form ────────────────────────────────────── */}
        {view === "recover" && (
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" />
                Recover access
              </CardTitle>
              <CardDescription>
                Enter your recovery key (shown in server logs when auth was first set up or last recovered).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRecover} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="recoveryKey">Recovery key</Label>
                  <Input
                    id="recoveryKey"
                    type="text"
                    value={recoveryKey}
                    onChange={e => setRecoveryKey(e.target.value)}
                    placeholder="Paste your recovery key"
                    autoFocus
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="newPassword">New password</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPw ? "text" : "password"}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="New password (min 6 chars)"
                      className="pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPw(v => !v)}
                      className="absolute inset-y-0 right-2.5 flex items-center text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showNewPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirm new password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    required
                  />
                </div>
                {recoverError && (
                  <p className="text-sm text-destructive">{recoverError}</p>
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setView("login")}>
                    Back
                  </Button>
                  <Button type="submit" className="flex-1" disabled={recoverLoading}>
                    {recoverLoading && <Loader2 className="size-4 animate-spin" />}
                    {recoverLoading ? "Recovering…" : "Reset password"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ── Recovery success ──────────────────────────────────── */}
        {view === "recover-done" && (
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-600" />
                Password reset
              </CardTitle>
              <CardDescription>Your password has been changed successfully.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {newRecoveryKey && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
                  <p className="text-xs font-semibold text-amber-800">Your new recovery key</p>
                  <p className="font-mono text-sm text-amber-900 break-all select-all">{newRecoveryKey}</p>
                  <p className="text-xs text-amber-700 mt-1">Save this somewhere safe — it is only shown once.</p>
                </div>
              )}
              <Button className="w-full" onClick={() => { setView("login"); setPassword(""); }}>
                Go to sign in
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
