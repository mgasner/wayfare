import type { FactField } from "./records.js";

// How long a volatile value stays trustworthy. Past this, the UI shows <Stale> and the
// refresh jobs treat the value as due. Fields not listed here never go stale.
export const FRESHNESS_MS = {
  slots: 15 * 60_000,
  waitlist: 15 * 60_000,
  hours: 7 * 86_400_000,
  price_pp: 30 * 86_400_000,
  menu: 30 * 86_400_000,
  status: 30 * 86_400_000,
} as const satisfies Partial<Record<FactField | "slots" | "waitlist", number>>;

export type FreshnessKey = keyof typeof FRESHNESS_MS;
export type FreshnessField = FactField | "slots" | "waitlist";

export function freshnessWindow(field: FreshnessField): number | null {
  return (FRESHNESS_MS as Partial<Record<FreshnessField, number>>)[field] ?? null;
}

export function ageMs(checkedAt: string, now: number): number {
  return Math.max(0, now - Date.parse(checkedAt));
}

export function isStale(field: FreshnessField, checkedAt: string, now: number): boolean {
  const window = freshnessWindow(field);
  if (window === null) return false;
  const t = Date.parse(checkedAt);
  if (Number.isNaN(t)) return true;
  return now - t > window;
}

/** "4 min", "2 h", "8 d": the largest whole unit, floored, so "2 h" never means 1 h 31 min. */
export function formatAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
