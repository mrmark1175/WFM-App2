import { createBrowserRouter } from "react-router-dom";
import { Home } from "./pages/Home";

export const router = createBrowserRouter([
  { path: "/",                            Component: Home },
  { path: "*",                            Component: Home },
  {
    path: "/my-account",
    lazy: async () => { const { MyAccount } = await import("./pages/MyAccount"); return { Component: MyAccount }; },
  },
  {
    path: "/wfm",
    lazy: async () => { const { WFM } = await import("./pages/WFM"); return { Component: WFM }; },
  },
  {
    path: "/wfm/roster",
    lazy: async () => { const { EmployeeRoster } = await import("./pages/EmployeeRoster"); return { Component: EmployeeRoster }; },
  },
  {
    path: "/wfm/long-term-forecasting-demand",
    lazy: async () => { const mod = await import("./pages/LongTermForecasting_Demand"); return { Component: mod.default }; },
  },
  {
    path: "/wfm/capacity",
    lazy: async () => { const { CapacityPlanning } = await import("./pages/CapacityPlanning"); return { Component: CapacityPlanning }; },
  },
  {
    path: "/wfm/shrinkage",
    lazy: async () => { const { ShrinkagePlanning } = await import("./pages/ShrinkagePlanning"); return { Component: ShrinkagePlanning }; },
  },
  {
    path: "/wfm/intraday",
    lazy: async () => { const { IntradayForecast } = await import("./pages/IntradayForecast"); return { Component: IntradayForecast }; },
  },
  {
    path: "/wfm/interaction-arrival",
    lazy: async () => { const { InteractionArrival } = await import("./pages/InteractionArrival"); return { Component: InteractionArrival }; },
  },
  {
    path: "/wfm/arrival-analysis",
    lazy: async () => { const { ArrivalAnalysis } = await import("./pages/ArrivalAnalysis"); return { Component: ArrivalAnalysis }; },
  },
  {
    path: "/wfm/telephony-raw",
    lazy: async () => { const { TelephonyRawData } = await import("./pages/TelephonyRawData"); return { Component: TelephonyRawData }; },
  },
  {
    path: "/wfm/performance-analytics",
    lazy: async () => { const { PerformanceAnalytics } = await import("./pages/PerformanceAnalytics"); return { Component: PerformanceAnalytics }; },
  },
  {
    path: "/configuration",
    lazy: async () => { const { Configuration } = await import("./pages/Configuration"); return { Component: Configuration }; },
  },
  {
    path: "/configuration/lob-management",
    lazy: async () => { const { LOBManagement } = await import("./pages/LOBManagement"); return { Component: LOBManagement }; },
  },
  {
    path: "/configuration/lob-settings",
    lazy: async () => { const { LOBSettings } = await import("./pages/LOBSettings"); return { Component: LOBSettings }; },
  },
  {
    path: "/scheduling",
    lazy: async () => { const { SchedulingHub } = await import("./pages/SchedulingHub"); return { Component: SchedulingHub }; },
  },
  {
    path: "/scheduling/agents",
    lazy: async () => { const { AgentRoster } = await import("./pages/AgentRoster"); return { Component: AgentRoster }; },
  },
  {
    path: "/scheduling/shifts",
    lazy: async () => { const { ShiftTemplates } = await import("./pages/ShiftTemplates"); return { Component: ShiftTemplates }; },
  },
  {
    path: "/scheduling/labor-laws",
    lazy: async () => { const { LaborLawRules } = await import("./pages/LaborLawRules"); return { Component: LaborLawRules }; },
  },
  {
    path: "/scheduling/schedule",
    lazy: async () => { const { ScheduleEditor } = await import("./pages/ScheduleEditor"); return { Component: ScheduleEditor }; },
  },
]);
