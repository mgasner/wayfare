import { z } from "zod";
import { db, person, query, sql, toolError } from "../lib/nexus.js";
import { HHMM, IsoDate, LatLng } from "../shared/records.js";
import { travelMatrix } from "./adapters/routes.js";
import { zonedInstant } from "./time.js";
import { loadTrip, whereAt, type TripPlaces, type WhereAt } from "./where.js";

export type Travel = {
  /** Driving minutes per place id; null when the place has no coordinates or no route. */
  minutes: Record<string, number | null>;
  /** True when the Routes API was unavailable and minutes are a distance estimate. */
  estimated: boolean;
  from: WhereAt;
};

const Point = z.object({ id: z.string(), name: z.string(), lat: z.number().nullable(), lng: z.number().nullable() });

/** An origin other than the anchors: a place in the trip's city, or a point. */
export const From = z.union([z.object({ place: z.string() }), LatLng.extend({ label: z.string().optional() })]);

async function origin(t: TripPlaces, from: z.output<typeof From> | undefined, date: string, time: string): Promise<WhereAt> {
  if (!from) return whereAt(t, date, time);
  if (!("place" in from)) return { lat: from.lat, lng: from.lng, label: from.label ?? "Pin", anchor: null };
  const [{ rows }] = await db.execute(sql(Point)`SELECT id, name, lat, lng FROM place WHERE id = ${from.place} AND city = ${t.trip.city}`);
  const p = rows[0];
  if (!p) throw toolError("not_found", `No place ${from.place} in ${t.trip.city}`);
  if (p.lat === null || p.lng === null) throw toolError("invalid_input", `${p.name} has no coordinates`);
  return { lat: p.lat, lng: p.lng, label: p.name, anchor: null };
}

/** Minutes to each place from `from`, else from where the trip's anchors put you at `date` `time`. */
export const minutes = query({
  input: z.object({ trip: z.string(), date: IsoDate, time: HHMM, places: z.array(z.string()).max(100), from: From.optional() }),
  async handler({ trip, date, time, places, from: given }, context): Promise<Travel> {
    const me = person(context);
    const t = await loadTrip(trip, me.id);
    const from = await origin(t, given, date, time);
    const ids = [...new Set(places)];
    const [{ rows }] = await db.execute(sql(Point)`
      SELECT id, name, lat, lng FROM place WHERE id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`);
    const known = rows.filter((r) => r.lat !== null && r.lng !== null);
    const result: Record<string, number | null> = Object.fromEntries(ids.map((id) => [id, null]));
    if (!known.length) return { minutes: result, estimated: false, from };
    const matrix = await travelMatrix(
      [{ lat: from.lat, lng: from.lng }],
      known.map((p) => ({ lat: p.lat!, lng: p.lng! })),
      { city: t.trip.city, departure: zonedInstant(date, time, t.tz), owner: me.id },
    );
    known.forEach((p, i) => (result[p.id] = matrix.minutes[0]?.[i] ?? null));
    return { minutes: result, estimated: matrix.estimated, from };
  },
});
