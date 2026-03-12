import { createRoot } from "react-dom/client";
// Change "react-router" to "react-router-dom" below
import { RouterProvider } from "react-router-dom"; 
import { router } from "./app/routes.tsx";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
);