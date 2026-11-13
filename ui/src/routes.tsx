import type { RouteObject } from "react-router";
import { Gallery } from "./screens/Gallery";

/** Screen routes, mounted under the root layout (AppProviders). */
export const routes: RouteObject[] = [
  { index: true, element: <Gallery /> },
  { path: "dev/gallery", element: <Gallery /> },
];
