import { z } from "zod";
import { db, person, query, sql } from "../lib/nexus.js";
import { HHMM, IsoDate } from "../shared/records.js";
import { travelMatrix } from "./adapters/routes.js";
import { zonedInstant } from "./time.js";
import { loadTrip, whereAt, type WhereAt } from "./where.js";

export type Travel = {
  /** Driving minutes per place id; null when the place has no coordinates or no route. */
  minutes: Record<string, number | null>;
  /** True when the Routes API was unavailable and minutes are a distance estimate. */
  estimated: boolean;
  from: WhereAt;
};

const Point = z.object({ id: z.string(), lat: z.number().nullable(), lng: z.number().nullable() });

/** Minutes to each place from where the trip's anchors put you at `date` `time`. */
export const minutes = query({
  input: z.object({ trip: z.string(), date: IsoDate, time: HHMM, places: z.array(z.string()).max(100) }),
  async handler({ trip, date, time, places }, context): Promise<Travel> {
    const me = person(context);
    const t = await loadTrip(trip, me.id);
    const from = whereAt(t, date, time);
    const ids = [...new Set(places)];
    const [{ rows }] = await db.execute(sql(Point)`
      SELECT id, lat, lng FROM place WHERE id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`);
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
