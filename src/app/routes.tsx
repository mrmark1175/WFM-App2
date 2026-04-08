import { createBrowserRouter } from "react-router-dom";
import { Home } from "./pages/Home";
import { MyAccount } from "./pages/MyAccount";
import { WFM } from "./pages/WFM";
import { Configuration } from "./pages/Configuration";
import { EmployeeRoster } from "./pages/EmployeeRoster";
import { CapacityPlanning } from "./pages/CapacityPlanning";
import { IntradayForecast } from "./pages/IntradayForecast";
import { InteractionArrival } from "./pages/InteractionArrival";
import { ArrivalAnalysis } from "./pages/ArrivalAnalysis";
import { TelephonyRawData } from "./pages/TelephonyRawData";
import { PerformanceAnalytics } from "./pages/PerformanceAnalytics";
import LongTermForecastingDemand from "./pages/LongTermForecasting_Demand";
import { ShrinkagePlanning } from "./pages/ShrinkagePlanning";
import { LOBManagement } from "./pages/LOBManagement";
import { LOBSettings } from "./pages/LOBSettings";
import { SchedulingHub } from "./pages/SchedulingHub";
import { AgentRoster } from "./pages/AgentRoster";
import { ShiftTemplates } from "./pages/ShiftTemplates";
import { LaborLawRules } from "./pages/LaborLawRules";
import { ScheduleEditor } from "./pages/ScheduleEditor";

export const router = createBrowserRouter([
  { path: "/",                            Component: Home },
  { path: "/my-account",                 Component: MyAccount },
  { path: "/wfm",                         Component: WFM },
  { path: "/wfm/roster",                 Component: EmployeeRoster },
  { path: "/wfm/long-term-forecasting-demand", Component: LongTermForecastingDemand },
  { path: "/wfm/capacity",               Component: CapacityPlanning },
  { path: "/wfm/shrinkage",              Component: ShrinkagePlanning },
  { path: "/wfm/intraday",               Component: IntradayForecast },
  { path: "/wfm/interaction-arrival",    Component: InteractionArrival },
  { path: "/wfm/arrival-analysis",       Component: ArrivalAnalysis },
  { path: "/wfm/telephony-raw",          Component: TelephonyRawData },
  { path: "/wfm/performance-analytics",  Component: PerformanceAnalytics },
  { path: "/configuration",              Component: Configuration },
  { path: "/configuration/lob-management", Component: LOBManagement },
  { path: "/configuration/lob-settings",  Component: LOBSettings },
  { path: "/scheduling",                  Component: SchedulingHub },
  { path: "/scheduling/agents",           Component: AgentRoster },
  { path: "/scheduling/shifts",           Component: ShiftTemplates },
  { path: "/scheduling/labor-laws",       Component: LaborLawRules },
  { path: "/scheduling/schedule",         Component: ScheduleEditor },
  { path: "*",                            Component: Home },
]);
