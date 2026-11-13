import { useLocation as useRRLocation, useNavigate as useRRNavigate } from "react-router";

export { Link } from "react-router";

/** Path plus parsed query, the shape screens read. */
export function useLocation() {
  const loc = useRRLocation();
  return { path: loc.pathname, query: new URLSearchParams(loc.search), href: loc.pathname + loc.search };
}

export function useNavigate() {
  const nav = useRRNavigate();
  return (to: string | number, opts: { replace?: boolean } = {}) => {
    if (typeof to === "number") void nav(to);
    else void nav(to, opts);
  };
}
