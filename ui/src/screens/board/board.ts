import type { Meal, PlaceCard, TripView } from "../../../../shared/records";
import type { Output } from "../../api.js";
import type { CellStatus } from "../../components/StatusChip";
import { closedOn, timesFor, type MealSlot } from "../../data/availability";
import { priceUsd } from "../../data/facts";
import { dateRange, isSunday, minutesOf } from "../../lib/dates";

export interface Cell {
  date: string;
  slot: MealSlot;
  status: CellStatus;
  meal: Meal | null;
  place: PlaceCard | null;
  /** More meals in the same cell (rare: a backup next to a waitlist). */
  extra: Meal[];
  /** Places with open times for this service, when the cell is open. */
  openPlaces: PlaceCard[];
  /** Oldest slot read behind openPlaces. */
  checkedAt: string | null;
  /** The meal overlaps a plan this far away (anchors.conflicts). */
  conflict: { minutes: number; label: string; estimated: boolean } | null;
}

export type Conflicts = Output<"anchors.conflicts">;

export interface Row {
  date: string;
  lunch: Cell;
  dinner: Cell;
  /** Taxi minutes from the lunch place to the dinner place (travel.minutes), when both are known. */
  hop: number | null;
  /** The hop is a distance estimate because the Routes API wasn't available. */
  hopEstimated: boolean;
  /** Reserve-ahead places closed that day, for the closures marker. */
  closures: number;
}

/** A taxi ride this long between lunch and dinner gets flagged. */
export const FAR_HOP_MIN = 40;

const STATUS_RANK: Record<Meal["status"], number> = { confirmed: 0, requested: 1, waitlist: 2, want: 3, failed: 4, skipped: 5 };

function anchorLabel(view: TripView, id: string): string {
  const a = view.anchors.find((x) => x.id === id);
  return view.areas.find((x) => x.id === a?.area)?.name ?? a?.text ?? "a plan";
}

function cell(view: TripView, places: PlaceCard[], date: string, slot: MealSlot, conflicts: Conflicts): Cell {
  const meals = view.meals
    .filter((m) => m.date === date && (m.slot === slot || (m.slot === "other" && m.time && (minutesOf(m.time) < 17 * 60 ? "lunch" : "dinner") === slot)) && m.status !== "skipped")
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  const meal = meals[0] ?? null;
  const byId = (id: string) => view.places.find((p) => p.id === id) ?? places.find((p) => p.id === id) ?? null;
  // A failed meal leaves the slot open, so it still gets options.
  const isOpen = !meal || meal.status === "failed";
  const openPlaces = isOpen ? places.filter((p) => !closedOn(p, date) && timesFor(p, date, slot).times.length > 0) : [];
  const reads = openPlaces.map((p) => timesFor(p, date, slot).checkedAt).filter((x): x is string => !!x);
  return {
    date,
    slot,
    status: meal ? meal.status : "open",
    meal,
    place: meal ? byId(meal.place) : null,
    extra: meals.slice(1),
    openPlaces,
    checkedAt: reads.sort()[0] ?? null,
    conflict: (() => {
      const c = meal ? conflicts.find((x) => x.meal === meal.id) : undefined;
      return c ? { minutes: c.minutes, label: anchorLabel(view, c.anchor), estimated: c.estimated } : null;
    })(),
  };
}

export function buildBoard(view: TripView, places: PlaceCard[], conflicts: Conflicts = []): Row[] {
  return dateRange(view.trip.start_date, view.trip.end_date).map((date) => {
    const lunch = cell(view, places, date, "lunch", conflicts);
    const dinner = cell(view, places, date, "dinner", conflicts);
    const closures = places.filter((p) => p.kind === "reserve_ahead" && closedOn(p, date)).length;
    return { date, lunch, dinner, hop: null, hopEstimated: false, closures };
  });
}

/** A lunch-to-dinner ride to ask travel.minutes for: leave `from` at `time` for `to`. */
export interface HopQuery {
  date: string;
  from: string;
  to: string;
  time: string;
}

const LEAVE_BEFORE_DINNER_MIN = 30;

/** Days whose lunch and dinner are at two different places with coordinates. */
export function hopQueries(rows: Row[]): HopQuery[] {
  return rows.flatMap((r) => {
    const a = r.lunch.meal && r.lunch.status !== "failed" ? r.lunch.place : null;
    const b = r.dinner.meal && r.dinner.status !== "failed" ? r.dinner.place : null;
    if (a?.lat == null || b?.lat == null || a.id === b.id) return [];
    const dinner = minutesOf(r.dinner.meal?.time ?? "20:00");
    const leave = Math.max(0, dinner - LEAVE_BEFORE_DINNER_MIN);
    const time = `${String(Math.floor(leave / 60)).padStart(2, "0")}:${String(leave % 60).padStart(2, "0")}`;
    return [{ date: r.date, from: a.id, to: b.id, time }];
  });
}

export function withHops(rows: Row[], hops: Record<string, { minutes: number | null; estimated: boolean } | undefined>): Row[] {
  return rows.map((r) => {
    const h = hops[r.date];
    return h ? { ...r, hop: h.minutes, hopEstimated: h.estimated } : r;
  });
}

/** Sundays and any day where at least three book-ahead places are closed. */
export const showClosures = (r: Row) => r.closures >= 3 || (isSunday(r.date) && r.closures > 0);

export function tally(rows: Row[]): Partial<Record<CellStatus, number>> {
  const t: Partial<Record<CellStatus, number>> = {};
  for (const r of rows) for (const c of [r.lunch, r.dinner]) t[c.status] = (t[c.status] ?? 0) + 1;
  return t;
}

export interface Spend {
  confirmed: number;
  planned: number;
  budget: number | null;
  tastings: number;
  tastingsWanted: number | null;
}

/** Per-person food spend from price facts: booked meals, and everything on the board. */
export function spend(view: TripView): Spend {
  let confirmed = 0;
  let planned = 0;
  let tastings = 0;
  for (const m of view.meals) {
    if (m.status === "skipped" || m.status === "failed") continue;
    const p = view.places.find((x) => x.id === m.place);
    const usd = p ? (priceUsd(p) ?? 0) : 0;
    planned += usd;
    if (m.status === "confirmed") confirmed += usd;
    if (p?.kind === "reserve_ahead") tastings += 1;
  }
  return { confirmed, planned, budget: view.trip.budget?.per_person ?? null, tastings, tastingsWanted: view.trip.appetite?.tastings ?? null };
}
