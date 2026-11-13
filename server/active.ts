import { z } from "zod";
import { db, sql } from "../lib/nexus.js";

const DAY_MS = 86_400_000;

export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Places with a meal, or saved by the trip's owner, on a trip that overlaps the next `days` days.
 * The window starts a day back so a trip's last evening still counts in time zones behind UTC.
 */
export async function placesOnUpcomingTrips(options: { now: number; days: number; city?: string }): Promise<string[]> {
  const from = isoDate(options.now - DAY_MS);
  const to = isoDate(options.now + options.days * DAY_MS);
  const city = options.city ?? null;
  const [{ rows }] = await db.execute(sql(z.object({ place: z.string() }))`
    SELECT meal.place AS place FROM meal JOIN trip ON trip.id = meal.trip
    WHERE trip.end_date >= ${from} AND trip.start_date <= ${to} AND (${city} IS NULL OR trip.city = ${city})
    UNION
    SELECT save.place AS place FROM save
    JOIN trip ON trip.owner = save.owner
    JOIN place ON place.id = save.place AND place.city = trip.city
    WHERE trip.end_date >= ${from} AND trip.start_date <= ${to} AND (${city} IS NULL OR trip.city = ${city})
    ORDER BY place`);
  return rows.map((r) => r.place);
}
