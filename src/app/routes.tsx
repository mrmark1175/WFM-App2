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
  { path: "*",                            Component: Home },
]);
