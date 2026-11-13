import type { RouteObject } from "react-router";
import { DataCheck } from "./screens/DataCheck";
import { Gallery } from "./screens/Gallery";
import { Wizard } from "./screens/wizard/Wizard";
import { Discover } from "./screens/discover/Discover";
import { PlaceDetail } from "./screens/place/PlaceDetail";
import { Board } from "./screens/board/Board";
import { Maps } from "./screens/maps/Maps";
import { Saved } from "./screens/saved/Saved";
import { Where } from "./screens/where/Where";

/** Screen routes, mounted under the root layout (AppProviders). */
export const routes: RouteObject[] = [
  { index: true, element: <Board /> },
  { path: "trip", element: <Board /> },
  { path: "new", element: <Wizard /> },
  { path: "discover", element: <Discover /> },
  { path: "place/:id", element: <PlaceDetail /> },
  { path: "saved", element: <Saved /> },
  { path: "where", element: <Where /> },
  { path: "maps", element: <Maps /> },
  { path: "trip/edit", element: <Wizard edit /> },
  { path: "dev/gallery", element: <Gallery /> },
  { path: "dev/data", element: <DataCheck /> },
];
