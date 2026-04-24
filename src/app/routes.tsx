import { createBrowserRouter } from "react-router-dom";
import { Home } from "./pages/Home";

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
    path: "/wfm",
    lazy: () => lazyLoad(async () => { const { WFM } = await import("./pages/WFM"); return { Component: WFM }; }),
  },
  {
    path: "/wfm/long-term-forecasting-demand",
    lazy: () => lazyLoad(async () => { const mod = await import("./pages/LongTermForecasting_Demand"); return { Component: mod.default }; }),
  },
  {
    path: "/wfm/capacity",
    lazy: () => lazyLoad(async () => { const { CapacityPlanning } = await import("./pages/CapacityPlanning"); return { Component: CapacityPlanning }; }),
  },
  {
    path: "/wfm/shrinkage",
    lazy: () => lazyLoad(async () => { const { ShrinkagePlanning } = await import("./pages/ShrinkagePlanning"); return { Component: ShrinkagePlanning }; }),
  },
  {
    path: "/wfm/intraday",
    lazy: () => lazyLoad(async () => { const { IntradayForecast } = await import("./pages/IntradayForecast"); return { Component: IntradayForecast }; }),
  },
  {
    path: "/configuration",
    lazy: () => lazyLoad(async () => { const { Configuration } = await import("./pages/Configuration"); return { Component: Configuration }; }),
  },
  {
    path: "/configuration/lob-management",
    lazy: () => lazyLoad(async () => { const { LOBManagement } = await import("./pages/LOBManagement"); return { Component: LOBManagement }; }),
  },
  {
    path: "/configuration/lob-settings",
    lazy: () => lazyLoad(async () => { const { LOBSettings } = await import("./pages/LOBSettings"); return { Component: LOBSettings }; }),
  },
  {
    path: "/configuration/ai-settings",
    lazy: () => lazyLoad(async () => { const { AISettings } = await import("./pages/AISettings"); return { Component: AISettings }; }),
  },
  {
    path: "/scheduling",
    lazy: () => lazyLoad(async () => { const { SchedulingHub } = await import("./pages/SchedulingHub"); return { Component: SchedulingHub }; }),
  },
  {
    path: "/scheduling/agents",
    lazy: () => lazyLoad(async () => { const { AgentRoster } = await import("./pages/AgentRoster"); return { Component: AgentRoster }; }),
  },
  {
    path: "/scheduling/shifts",
    lazy: () => lazyLoad(async () => { const { ShiftTemplates } = await import("./pages/ShiftTemplates"); return { Component: ShiftTemplates }; }),
  },
  {
    path: "/scheduling/labor-laws",
    lazy: () => lazyLoad(async () => { const { LaborLawRules } = await import("./pages/LaborLawRules"); return { Component: LaborLawRules }; }),
  },
  {
    path: "/scheduling/schedule",
    lazy: () => lazyLoad(async () => { const { ScheduleEditor } = await import("./pages/ScheduleEditor"); return { Component: ScheduleEditor }; }),
  },
  {
    path: "/scheduling/scheduler-rules",
    lazy: () => lazyLoad(async () => { const { SchedulerRules } = await import("./pages/SchedulerRules"); return { Component: SchedulerRules }; }),
  },
  {
    path: "/help/auto-scheduler",
    lazy: () => lazyLoad(async () => { const { HelpAutoScheduler } = await import("./pages/HelpAutoScheduler"); return { Component: HelpAutoScheduler }; }),
  },
]);
