import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/routes.tsx";
import { ThemeProvider } from "./app/components/ThemeProvider.tsx";
import { LOBProvider } from "./app/lib/lobContext.tsx";
import { AuthGate } from "./app/components/AuthGate.tsx";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="vite-ui-theme">
    <AuthGate>
      <LOBProvider>
        <RouterProvider router={router} />
      </LOBProvider>
    </AuthGate>
  </ThemeProvider>
);