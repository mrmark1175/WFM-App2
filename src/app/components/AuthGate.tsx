import React, { useEffect, useState } from "react";
import { apiUrl } from "../lib/api";
import { LoginPage } from "../pages/Login";

type AuthStatus = "checking" | "authenticated" | "unauthenticated";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");

  useEffect(() => {
    fetch(apiUrl("/api/auth/status"), { credentials: "include" })
      .then(r => r.json())
      .then(d => setStatus(d.authenticated ? "authenticated" : "unauthenticated"))
      .catch(() => setStatus("unauthenticated"));
  }, []);

  if (status === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <LoginPage onLogin={() => setStatus("authenticated")} />;
  }

  return <>{children}</>;
}
