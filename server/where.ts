import { z } from "zod";
import { db, sql, toolError } from "../lib/nexus.js";
import type { Anchor, Meal, Trip } from "../shared/records.js";
import { AnchorRow, MealRow, TripRow } from "./tables.js";
import { toMinutes } from "./time.js";

export type WhereAt = { lat: number; lng: number; label: string; anchor: string | null };

type Spot = { name: string; lat: number | null; lng: number | null };

export type TripPlaces = {
  trip: Trip;
  tz: string;
  anchors: Anchor[];
  meals: Meal[];
  areas: Map<string, Spot>;
  places: Map<string, Spot>;
};

const SpotRow = z.object({ id: z.string(), name: z.string(), lat: z.number().nullable(), lng: z.number().nullable() });

/** A trip of `owner` with its anchors, meals, and the areas and places they name. */
export async function loadTrip(id: string, owner: string): Promise<TripPlaces> {
  const [trips, cities, anchors, meals, areas, places] = await db.execute(
    sql(TripRow)`SELECT * FROM trip WHERE id = ${id} AND owner = ${owner}`,
    sql(z.object({ tz: z.string() }))`SELECT city.tz FROM city JOIN trip ON trip.city = city.id WHERE trip.id = ${id}`,
    sql(AnchorRow)`SELECT * FROM anchor WHERE trip = ${id} ORDER BY date, start_time`,
    sql(MealRow)`SELECT * FROM meal WHERE trip = ${id} ORDER BY date, slot, time`,
    sql(SpotRow)`SELECT area.id, area.name, area.lat, area.lng FROM area JOIN trip ON trip.city = area.city WHERE trip.id = ${id}`,
    sql(SpotRow)`
      SELECT id, name, lat, lng FROM place
      WHERE id IN (SELECT place FROM anchor WHERE trip = ${id}) OR id IN (SELECT place FROM meal WHERE trip = ${id})`,
  );
  const trip = trips.rows[0];
  if (!trip) throw toolError("not_found", `No trip ${id}`);
  return {
    trip,
    tz: cities.rows[0]?.tz ?? "UTC",
    anchors: anchors.rows,
    meals: meals.rows,
    areas: new Map(areas.rows.map((a) => [a.id, a])),
    places: new Map(places.rows.map((p) => [p.id, p])),
  };
}

/** Where an anchor puts you: its own point, else its place's, else its area's. */
export function locate(anchor: Anchor, t: TripPlaces): Omit<WhereAt, "anchor"> | null {
  const place = anchor.place ? t.places.get(anchor.place) : undefined;
  const area = anchor.area ? t.areas.get(anchor.area) : undefined;
  const label = place?.name ?? area?.name ?? anchor.text ?? "Anchor";
  for (const p of [anchor, place, area]) {
    if (p && p.lat !== null && p.lng !== null) return { lat: p.lat, lng: p.lng, label };
  }
  return null;
}

/**
 * Minutes after midnight an anchor covers. No times is the whole day; only a start is that moment
 * (and then "the nearest earlier anchor" until another one starts); only an end runs from midnight.
 */
export function span(a: Pick<Anchor, "start_time" | "end_time">): [number, number] {
  const start = a.start_time ? toMinutes(a.start_time) : 0;
  const end = a.end_time ? toMinutes(a.end_time) : a.start_time ? start : 24 * 60 - 1;
  return [start, Math.max(start, end)];
}

/** The anchor covering `time` on `date`, else the nearest earlier one that day, else the trip's base. */
export function whereAt(t: TripPlaces, date: string, time: string): WhereAt {
  const at = toMinutes(time);
  const located = t.anchors
    .filter((a) => a.date === date)
    .flatMap((a) => {
      const where = locate(a, t);
      return where ? [{ a, where, span: span(a) }] : [];
    });
  const covering = located
    .filter((x) => x.span[0] <= at && at <= x.span[1])
    // The most specific: latest start, then shortest.
    .sort((x, y) => y.span[0] - x.span[0] || x.span[1] - x.span[0] - (y.span[1] - y.span[0]))[0];
  const earlier = located.filter((x) => x.span[1] < at).sort((x, y) => y.span[1] - x.span[1] || y.span[0] - x.span[0])[0];
  const hit = covering ?? earlier;
  if (hit) return { ...hit.where, anchor: hit.a.id };
  const base = t.trip.base;
  return { lat: base.lat, lng: base.lng, label: base.name, anchor: null };
}

const MEAL_DEFAULTS = { lunch: { time: "13:00", minutes: 90 }, dinner: { time: "20:00", minutes: 120 }, other: { time: null, minutes: 60 } };

/** Minutes after midnight a meal takes, from its time or its slot's usual time; null if neither. */
export function mealSpan(m: Pick<Meal, "time" | "slot">): [number, number] | null {
  const d = MEAL_DEFAULTS[m.slot];
  const time = m.time ?? d.time;
  if (!time) return null;
  const start = toMinutes(time);
  return [start, start + d.minutes];
}
