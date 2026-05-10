import { createBrowserRouter } from "react-router-dom";
import React from "react";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Home } from "./pages/Home";
import type { UserRole } from "@/context/AuthContext";

const WFM_ROLES: UserRole[] = ["super_admin", "client_admin", "rta", "supervisor", "read_only"];
const ADMIN_ROLES: UserRole[] = ["super_admin", "client_admin"];
const RTM_ROLES: UserRole[] = ["super_admin", "client_admin", "rta", "supervisor"];
const AGENT_ROLES: UserRole[] = ["agent"];

function withRoles(Component: React.ComponentType, roles: UserRole[]) {
  return function GuardedRoute() {
    return (
      <ProtectedRoute roles={roles}>
        <Component />
      </ProtectedRoute>
    );
  };
}

/**
 * Wraps a lazy import so that a stale-chunk 404 (caused by a new deployment
 * changing the asset hash while the user's browser still has the old
 * index.html cached) triggers a single hard reload instead of a crash.
 * sessionStorage prevents an infinite reload loop if the error persists.
 */
async function lazyLoad<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isChunkError =
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("Importing a module script failed") ||
      msg.includes("error loading dynamically imported module");
    if (isChunkError && !sessionStorage.getItem("__chunk_reload__")) {
      sessionStorage.setItem("__chunk_reload__", "1");
      window.location.reload();
    }
    throw e;
  }
}

export const router = createBrowserRouter([
  { path: "/",                            Component: Home },
  { path: "*",                            Component: Home },
  {
    path: "/my-account",
    lazy: () => lazyLoad(async () => { const { MyAccount } = await import("./pages/MyAccount"); return { Component: MyAccount }; }),
  },
  {
    path: "/agent/today",
    lazy: () => lazyLoad(async () => { const { AgentSelfService } = await import("./pages/AgentSelfService"); return { Component: withRoles(AgentSelfService, AGENT_ROLES) }; }),
  },
  {
    path: "/wfm",
    lazy: () => lazyLoad(async () => { const { WFM } = await import("./pages/WFM"); return { Component: withRoles(WFM, WFM_ROLES) }; }),
  },
  {
    path: "/wfm/long-term-forecasting-demand",
    lazy: () => lazyLoad(async () => { const mod = await import("./pages/LongTermForecasting_Demand"); return { Component: withRoles(mod.default, WFM_ROLES) }; }),
  },
  {
    path: "/wfm/capacity",
    lazy: () => lazyLoad(async () => { const { CapacityPlanning } = await import("./pages/CapacityPlanning"); return { Component: withRoles(CapacityPlanning, WFM_ROLES) }; }),
  },
  {
    path: "/wfm/shrinkage",
    lazy: () => lazyLoad(async () => { const { ShrinkagePlanning } = await import("./pages/ShrinkagePlanning"); return { Component: withRoles(ShrinkagePlanning, WFM_ROLES) }; }),
  },
  {
    path: "/wfm/intraday",
    lazy: () => lazyLoad(async () => { const { IntradayForecast } = await import("./pages/IntradayForecast"); return { Component: withRoles(IntradayForecast, WFM_ROLES) }; }),
  },
  {
    path: "/wfm/intraday-v2",
    lazy: () => lazyLoad(async () => { const { IntradayForecastV2 } = await import("./pages/IntradayForecastV2"); return { Component: withRoles(IntradayForecastV2, WFM_ROLES) }; }),
  },
  {
    path: "/wfm/real-time-management",
    lazy: () => lazyLoad(async () => { const { RealTimeManagement } = await import("./pages/RealTimeManagement"); return { Component: withRoles(RealTimeManagement, RTM_ROLES) }; }),
  },
  {
    path: "/configuration",
    lazy: () => lazyLoad(async () => { const { Configuration } = await import("./pages/Configuration"); return { Component: withRoles(Configuration, ADMIN_ROLES) }; }),
  },
  {
    path: "/configuration/lob-management",
    lazy: () => lazyLoad(async () => { const { LOBManagement } = await import("./pages/LOBManagement"); return { Component: withRoles(LOBManagement, ADMIN_ROLES) }; }),
  },
  {
    path: "/configuration/lob-settings",
    lazy: () => lazyLoad(async () => { const { LOBSettings } = await import("./pages/LOBSettings"); return { Component: withRoles(LOBSettings, ADMIN_ROLES) }; }),
  },
  {
    path: "/configuration/ai-settings",
    lazy: () => lazyLoad(async () => { const { AISettings } = await import("./pages/AISettings"); return { Component: withRoles(AISettings, ADMIN_ROLES) }; }),
  },
  {
    path: "/scheduling",
    lazy: () => lazyLoad(async () => { const { SchedulingHub } = await import("./pages/SchedulingHub"); return { Component: withRoles(SchedulingHub, WFM_ROLES) }; }),
  },
  {
    path: "/scheduling/agents",
    lazy: () => lazyLoad(async () => { const { AgentRoster } = await import("./pages/AgentRoster"); return { Component: withRoles(AgentRoster, WFM_ROLES) }; }),
  },
  {
    path: "/scheduling/shifts",
    lazy: () => lazyLoad(async () => { const { ShiftTemplates } = await import("./pages/ShiftTemplates"); return { Component: withRoles(ShiftTemplates, WFM_ROLES) }; }),
  },
  {
    path: "/scheduling/labor-laws",
    lazy: () => lazyLoad(async () => { const { LaborLawRules } = await import("./pages/LaborLawRules"); return { Component: withRoles(LaborLawRules, WFM_ROLES) }; }),
  },
  {
    path: "/scheduling/schedule",
    lazy: () => lazyLoad(async () => { const { ScheduleEditor } = await import("./pages/ScheduleEditor"); return { Component: withRoles(ScheduleEditor, WFM_ROLES) }; }),
  },
  {
    path: "/scheduling/scheduler-rules",
    lazy: () => lazyLoad(async () => { const { SchedulerRules } = await import("./pages/SchedulerRules"); return { Component: withRoles(SchedulerRules, WFM_ROLES) }; }),
  },
  {
    path: "/help/auto-scheduler",
    lazy: () => lazyLoad(async () => { const { HelpAutoScheduler } = await import("./pages/HelpAutoScheduler"); return { Component: withRoles(HelpAutoScheduler, WFM_ROLES) }; }),
  },
  {
    path: "/admin/users",
    lazy: () => lazyLoad(async () => { const { UsersPage } = await import("./pages/admin/Users"); return { Component: withRoles(UsersPage, ADMIN_ROLES) }; }),
  },
]);
