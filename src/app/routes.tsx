import { createBrowserRouter } from "react-router-dom"; 
import { Home } from "./pages/Home";
import { MyAccount } from "./pages/MyAccount";
import { WFM } from "./pages/WFM";
import { Configuration } from "./pages/Configuration";
import { EmployeeRoster } from "./pages/EmployeeRoster"; 
import { Forecasting } from "./pages/Forecasting";

export const router = createBrowserRouter([
  { path: "/", Component: Home },
  { path: "/my-account", Component: MyAccount },
  { path: "/wfm", Component: WFM },
  { path: "/wfm/roster", Component: EmployeeRoster },
  { path: "/wfm/forecasting", Component: Forecasting },
  { path: "/configuration", Component: Configuration },
  { path: "*", Component: Home },
]);