import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router";
import { call, type Output } from "./api.js";
import { SignIn } from "./SignIn.js";

type Me = Output<"me.get">;

function Shell() {
  const [me, setMe] = useState<Me | undefined>(undefined);
  useEffect(() => {
    call("me.get").then(setMe, () => setMe(null));
  }, []);
  if (me === undefined) return null;
  if (me === null) return <SignIn />;
  return (
    <main>
      <Outlet context={me} />
    </main>
  );
}

function Home() {
  return <h1>Wayfare</h1>;
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
