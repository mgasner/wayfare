import type { RouteObject } from "react-router";
import { DataCheck } from "./screens/DataCheck";
import { Gallery } from "./screens/Gallery";
import { Wizard } from "./screens/wizard/Wizard";
import { Discover } from "./screens/discover/Discover";
import { PlaceDetail } from "./screens/place/PlaceDetail";

/** Screen routes, mounted under the root layout (AppProviders). */
export const routes: RouteObject[] = [
  { index: true, element: <Gallery /> },
  { path: "new", element: <Wizard /> },
  { path: "discover", element: <Discover /> },
  { path: "place/:id", element: <PlaceDetail /> },
  { path: "trip/edit", element: <Wizard edit /> },
  { path: "dev/gallery", element: <Gallery /> },
  { path: "dev/data", element: <DataCheck /> },
];
