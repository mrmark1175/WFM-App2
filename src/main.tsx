import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/routes.tsx";
import { ThemeProvider } from "./app/components/ThemeProvider.tsx";
import { LOBProvider } from "./app/lib/lobContext.tsx";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem={true} storageKey="vite-ui-theme">
    <LOBProvider>
      <RouterProvider router={router} />
    </LOBProvider>
  </ThemeProvider>
);