import type { RouteObject } from "react-router";
import { DataCheck } from "./screens/DataCheck";
import { Gallery } from "./screens/Gallery";

/** Screen routes, mounted under the root layout (AppProviders). */
export const routes: RouteObject[] = [
  { index: true, element: <Gallery /> },
  { path: "dev/gallery", element: <Gallery /> },
  { path: "dev/data", element: <DataCheck /> },
];
