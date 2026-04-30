import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/routes.tsx";
import { ThemeProvider } from "./app/components/ThemeProvider.tsx";
import { AuthProvider, useAuth } from "./context/AuthContext.tsx";
import { LOBProvider } from "./app/lib/lobContext.tsx";
import { WFMPageDataProvider } from "./app/lib/WFMPageDataContext.tsx";
import { WhatIfProvider } from "./app/lib/whatIfContext.tsx";
import { LoginPage } from "./app/pages/Login.tsx";
import "./styles/index.css";

function AppShell() {
  const { status } = useAuth();

  if (status === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <LoginPage />;
  }

  return (
    <LOBProvider>
      <WhatIfProvider>
        <WFMPageDataProvider>
          <RouterProvider router={router} />
        </WFMPageDataProvider>
      </WhatIfProvider>
    </LOBProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="vite-ui-theme">
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  </ThemeProvider>
);
