import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router";
import { AppProviders } from "./AppProviders.js";
import { useMe } from "./data/hooks.js";
import { routes } from "./routes.js";
import { SignIn } from "./SignIn.js";

function Shell() {
  const me = useMe();
  if (me.isPending) return null;
  if (!me.data) return <SignIn />;
  return <Outlet context={me.data} />;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppProviders />,
    children: [{ element: <Shell />, children: routes }],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
