import { RouterProvider } from "react-router";
import { router } from "../routes"; // Path to your routes.tsx

export default function App() {
  return <RouterProvider router={router} />;
}
