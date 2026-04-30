import React, { createContext, useContext, useEffect, useState } from "react";
import { apiUrl } from "@/app/lib/api";

export type UserRole = "super_admin" | "client_admin" | "supervisor" | "read_only";

export interface AuthUser {
  id: number;
  email: string;
  full_name: string | null;
  role: UserRole;
  organization_id: number;
}

interface AuthContextValue {
  user: AuthUser | null;
  status: "checking" | "authenticated" | "unauthenticated";
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("checking");

  useEffect(() => {
    fetch(apiUrl("/api/auth/me"), { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.id) {
          setUser(data as AuthUser);
          setStatus("authenticated");
        } else {
          setStatus("unauthenticated");
        }
      })
      .catch(() => setStatus("unauthenticated"));
  }, []);

  async function login(email: string, password: string) {
    const res = await fetch(apiUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    setUser(data.user as AuthUser);
    setStatus("authenticated");
  }

  async function logout() {
    await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include" });
    setUser(null);
    setStatus("unauthenticated");
  }

  function hasRole(...roles: UserRole[]) {
    return !!user && roles.includes(user.role);
  }

  return (
    <AuthContext.Provider value={{ user, status, login, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
