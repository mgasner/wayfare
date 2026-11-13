import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router";
import { AppProviders } from "./AppProviders.js";
import { call, type Output } from "./api.js";
import { routes } from "./routes.js";
import { SignIn } from "./SignIn.js";

type Me = Output<"me.get">;

function Shell() {
  const [me, setMe] = useState<Me | undefined>(undefined);
  useEffect(() => {
    call("me.get").then(setMe, () => setMe(null));
  }, []);
  if (me === undefined) return null;
  if (me === null) return <SignIn />;
  return <Outlet context={me} />;
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
