import { createBrowserRouter } from "react-router-dom"; 
import { Home } from "./pages/Home";
import { MyAccount } from "./pages/MyAccount";
import { WFM } from "./pages/WFM";
import { Configuration } from "./pages/Configuration";
import { EmployeeRoster } from "./pages/EmployeeRoster"; 
// 1. Add the new import here
import { WorkforcePlanning } from "./pages/WorkforcePlanning"; 

export const router = createBrowserRouter([
  { 
    path: "/", 
    Component: Home 
  },
  { 
    path: "/my-account", 
    Component: MyAccount 
  },
  { 
    path: "/wfm", 
    Component: WFM 
  },
  { 
    path: "/wfm/roster", 
    Component: EmployeeRoster 
  },
  // 2. Add the planning route here
  { 
    path: "/wfm/planning", 
    Component: WorkforcePlanning 
  },
  { 
    path: "/configuration", 
    Component: Configuration 
  },
  { 
    path: "*", 
    Component: Home 
  },
]);