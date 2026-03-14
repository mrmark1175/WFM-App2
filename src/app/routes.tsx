import { createBrowserRouter } from "react-router-dom"; 
import { Home } from "./pages/Home";
import { MyAccount } from "./pages/MyAccount";
import { WFM } from "./pages/WFM";
import { Configuration } from "./pages/Configuration";
import { EmployeeRoster } from "./pages/EmployeeRoster"; 
import { Forecasting } from "./pages/Forecasting";
import { CapacityPlanning } from "./pages/CapacityPlanning";
import { IntradayForecast } from "./pages/IntradayForecast";
import { InteractionArrival } from "./pages/InteractionArrival"; // ✅ ADD THIS

export const router = createBrowserRouter([
  { path: "/",                          Component: Home },
  { path: "/my-account",               Component: MyAccount },
  { path: "/wfm",                       Component: WFM },
  { path: "/wfm/roster",               Component: EmployeeRoster },
  { path: "/wfm/forecasting",          Component: Forecasting },
  { path: "/wfm/capacity",             Component: CapacityPlanning },
  { path: "/wfm/intraday",             Component: IntradayForecast },
  { path: "/wfm/interaction-arrival",  Component: InteractionArrival }, // ✅ ADD THIS
  { path: "/configuration",            Component: Configuration },
  { path: "*",                          Component: Home },
]);