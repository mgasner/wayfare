import { Bookmark, CalendarDays, Map as MapIcon, MapPin, Search, Utensils } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "../lib/router";

export type TabId = "trip" | "discover" | "maps" | "saved" | "where";

export const TABS: { id: TabId; label: string; desktopLabel: string; to: string; icon: typeof Search }[] = [
  { id: "trip", label: "Trip", desktopLabel: "Board", to: "/trip", icon: CalendarDays },
  { id: "discover", label: "Discover", desktopLabel: "Discover", to: "/discover", icon: Search },
  { id: "maps", label: "Maps", desktopLabel: "Maps", to: "/maps", icon: MapIcon },
  { id: "saved", label: "Saved", desktopLabel: "Want to visit", to: "/saved", icon: Bookmark },
  { id: "where", label: "Where", desktopLabel: "Where you'll be", to: "/where", icon: MapPin },
];

export function tabForPath(path: string): TabId | null {
  if (path === "/" || path.startsWith("/trip")) return "trip";
  if (path.startsWith("/discover") || path.startsWith("/place")) return "discover";
  if (path.startsWith("/maps")) return "maps";
  if (path.startsWith("/saved")) return "saved";
  if (path.startsWith("/where")) return "where";
  return null;
}

/** Bottom tabs on phones. Hidden at >= 1024px, where the sidebar takes over. */
export function TabBar({ badges }: { badges?: Partial<Record<TabId, number>> }) {
  const { path } = useLocation();
  const active = tabForPath(path);
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <Link key={t.id} to={t.to} className={`tab${active === t.id ? " on" : ""}`} aria-current={active === t.id ? "page" : undefined}>
          <t.icon size={24} strokeWidth={1.7} aria-hidden />
          <span>{t.label}</span>
          {badges?.[t.id] ? <i className="tab-badge num">{badges[t.id]}</i> : null}
        </Link>
      ))}
    </nav>
  );
}

export interface ShellTrip {
  title: string;
  lines: string[];
}

/**
 * Page layout: content plus bottom tabs on phones; a sidebar with the trip card and
 * navigation on desktop. `bare` pages (the wizard) skip both.
 */
export function AppShell({ children, trip, counts, footer, bare }: { children: ReactNode; trip?: ShellTrip; counts?: Partial<Record<TabId, number>>; footer?: ReactNode; bare?: boolean }) {
  const { path } = useLocation();
  const active = tabForPath(path);
  if (bare) return <div className="shell-bare">{children}</div>;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/trip" className="sidebar-brand">
          <span className="sidebar-logo">
            <Utensils size={16} aria-hidden />
          </span>
          <span className="display">Wayfare</span>
        </Link>
        {trip && (
          <div className="sidebar-trip card">
            <div className="sidebar-trip-title">{trip.title}</div>
            {trip.lines.map((l) => (
              <div key={l} className="muted">
                {l}
              </div>
            ))}
          </div>
        )}
        <nav className="sidebar-nav" aria-label="Main">
          {TABS.map((t) => (
            <Link key={t.id} to={t.to} className={`sidebar-link${active === t.id ? " on" : ""}`} aria-current={active === t.id ? "page" : undefined}>
              <t.icon size={18} strokeWidth={1.8} aria-hidden />
              <span className="grow">{t.desktopLabel}</span>
              {counts?.[t.id] ? <span className="num sidebar-count">{counts[t.id]}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">{footer}</div>
      </aside>
      <main className="shell-main">{children}</main>
      <TabBar />
    </div>
  );
}
