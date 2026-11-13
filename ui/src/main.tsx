import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router";

function Shell() {
  return (
    <main>
      <Outlet />
    </main>
  );
}

function Home() {
  return <h1>Dining planner</h1>;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [{ index: true, element: <Home /> }],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
