import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const THEMES = ["garua", "fachada", "chancay"] as const;
export type ThemeId = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeId = "garua";

/** Copy that changes with the theme's voice. Everything else is theme-neutral. */
export interface ThemeCopy {
  summaryKicker: string;
  summaryTitle: (city: string, days: number, party: number) => string;
  summaryHint: string;
  buildCta: (city: string) => string;
  pickKicker: string;
  fallbacks: string;
}

export interface Theme {
  id: ThemeId;
  label: string;
  swatches: string[];
  copy: ThemeCopy;
}

const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

export const THEME_INFO: Record<ThemeId, Theme> = {
  garua: {
    id: "garua",
    label: "Garúa",
    swatches: ["#e9ecec", "#2e5b68", "#24343b", "#b9a184", "#7f8f78"],
    copy: {
      summaryKicker: "Setup complete",
      summaryTitle: (c, d, p) => `${c}. ${d} days. ${people(p)}.`,
      summaryHint: "Tap a line to edit it.",
      buildCta: () => "Build the shortlist",
      pickKicker: "Best fit",
      fallbacks: "Fallbacks",
    },
  },
  fachada: {
    id: "fachada",
    label: "Fachada",
    swatches: ["#fbf5ec", "#b5266d", "#23486e", "#e2a83a", "#5f9a82"],
    copy: {
      summaryKicker: "Ready when you are",
      summaryTitle: (c, _d, p) => (p === 2 ? `${c}, for the two of you` : `${c}, for ${people(p)}`),
      summaryHint: "Tap anything to change it.",
      buildCta: (c) => `Find our ${c} tables`,
      pickKicker: "Worth the ride",
      fallbacks: "Also lovely",
    },
  },
  chancay: {
    id: "chancay",
    label: "Chancay",
    swatches: ["#f2e9d8", "#a33b22", "#2a1c12", "#b77a1c", "#8a7a4a"],
    copy: {
      summaryKicker: "7 lines to check",
      summaryTitle: (c) => `${c} trip, set up`,
      summaryHint: "Each line opens its own page.",
      buildCta: () => "Build the shortlist",
      pickKicker: "The pick",
      fallbacks: "Backups",
    },
  },
};

const STORAGE_KEY = "dp-theme";

function initialTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const fromUrl = new URLSearchParams(window.location.search).get("theme");
  const saved = fromUrl ?? window.localStorage.getItem(STORAGE_KEY);
  return (THEMES as readonly string[]).includes(saved ?? "") ? (saved as ThemeId) : DEFAULT_THEME;
}

const ThemeContext = createContext<{ theme: Theme; setTheme: (id: ThemeId) => void }>({
  theme: THEME_INFO[DEFAULT_THEME],
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<ThemeId>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = id;
  }, [id]);
  const value = useMemo(
    () => ({
      theme: THEME_INFO[id],
      setTheme: (next: ThemeId) => {
        window.localStorage.setItem(STORAGE_KEY, next);
        setId(next);
      },
    }),
    [id],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
