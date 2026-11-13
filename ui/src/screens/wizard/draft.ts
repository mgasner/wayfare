import type { Trip } from "../../../../shared/records";
import type { Input } from "../../api.js";

type TripInput = Input<"trips.create">;
import { dateRange, daysBetween, isSunday } from "../../lib/dates";

export interface Draft {
  city: string;
  start_date: string | null;
  end_date: string | null;
  party: number;
  base: { name: string; lat: number; lng: number };
  tastings: number;
  sit_down: number;
  lunch_main: boolean;
  budget_usd: number;
  currency: "USD" | "PEN";
  diet: string[];
  whatsapp_fallback: boolean;
}

/** Lima pilot defaults: the real trip, so a new trip opens already filled in. */
export const LIMA_DEFAULTS: Draft = {
  city: "lima",
  start_date: "2026-11-13",
  end_date: "2026-11-23",
  party: 2,
  base: { name: "Gran Hotel Bolívar", lat: -12.0507304, lng: -77.0351602 },
  tastings: 3,
  sit_down: 5,
  lunch_main: true,
  budget_usd: 1800,
  currency: "USD",
  diet: [],
  whatsapp_fallback: true,
};

/** Soles per dollar, from Mesa 24/7 prices next to their USD estimates (S/1,630 ≈ US$479). */
export const PEN_PER_USD = 3.4;

export const BUDGET_MIN = 500;
export const BUDGET_MAX = 3000;

export function tripDays(d: Pick<Draft, "start_date" | "end_date">): number {
  return d.start_date && d.end_date ? daysBetween(d.start_date, d.end_date) + 1 : 0;
}

export const mealSlots = (d: Pick<Draft, "start_date" | "end_date">) => tripDays(d) * 2;

export function sundays(d: Pick<Draft, "start_date" | "end_date">): string[] {
  return d.start_date && d.end_date ? dateRange(d.start_date, d.end_date).filter(isSunday) : [];
}

/** Casual meals fill whatever the big ones leave. */
export const casual = (d: Draft) => Math.max(0, mealSlots(d) - d.tastings - d.sit_down);

/** Keeps tastings + sit-down within the trip's slots after the dates or a stepper change. */
export function clampAppetite(d: Draft): Draft {
  const slots = mealSlots(d);
  const tastings = Math.min(d.tastings, slots);
  return { ...d, tastings, sit_down: Math.min(d.sit_down, slots - tastings) };
}

/** Tap on a calendar day: first tap starts a range, second tap ends it (or restarts if earlier). */
export function pickDate(d: Draft, iso: string): Draft {
  if (!d.start_date || d.end_date || iso < d.start_date) return { ...d, start_date: iso, end_date: null };
  if (daysBetween(d.start_date, iso) > 30) return { ...d, start_date: iso, end_date: null };
  return clampAppetite({ ...d, end_date: iso });
}

export const isComplete = (d: Draft) => !!d.start_date && !!d.end_date && d.party > 0 && d.base.name.trim().length > 0;

export function toTripInput(d: Draft): TripInput {
  if (!d.start_date || !d.end_date) throw new Error("Pick the trip dates first");
  return {
    city: d.city,
    start_date: d.start_date,
    end_date: d.end_date,
    party: d.party,
    base: d.base,
    appetite: { tastings: d.tastings, sit_down: d.sit_down, lunch_main: d.lunch_main },
    budget: { per_person: d.budget_usd, currency: "USD" },
    diet: d.diet,
    booking: { whatsapp_fallback: d.whatsapp_fallback },
    refresh: "standard",
  };
}

export function fromTrip(t: Trip): Draft {
  return {
    ...LIMA_DEFAULTS,
    city: t.city,
    start_date: t.start_date,
    end_date: t.end_date,
    party: t.party,
    base: t.base,
    tastings: t.appetite?.tastings ?? LIMA_DEFAULTS.tastings,
    sit_down: t.appetite?.sit_down ?? LIMA_DEFAULTS.sit_down,
    lunch_main: t.appetite?.lunch_main ?? LIMA_DEFAULTS.lunch_main,
    budget_usd: t.budget?.per_person ?? LIMA_DEFAULTS.budget_usd,
    diet: t.diet ?? [],
    whatsapp_fallback: t.booking?.whatsapp_fallback ?? true,
  };
}

export function money(usd: number, currency: "USD" | "PEN"): string {
  return currency === "USD" ? `US$${Math.round(usd).toLocaleString("en-US")}` : `S/${Math.round(usd * PEN_PER_USD).toLocaleString("en-US")}`;
}
