import { z } from "zod";
import { db, mutation, person, query, sql, toolError } from "../lib/nexus.js";
import { Anchor, HHMM, IsoDate } from "../shared/records.js";
import { travelMatrix, type Point } from "./adapters/routes.js";
import { AnchorRow } from "./tables.js";
import { zonedInstant, fromMinutes } from "./time.js";
import { loadTrip, locate, mealSpan, span, whereAt as where, type WhereAt } from "./where.js";

/** A meal more than this many minutes from where an overlapping anchor puts you is a conflict. */
const CONFLICT_MINUTES = 20;

/** A meal that overlaps `anchor`, `minutes` away from it. */
export type Conflict = { meal: string; anchor: string; minutes: number; estimated: boolean };

export const list = query({
  input: z.object({ trip: z.string() }),
  async handler({ trip }, context): Promise<Anchor[]> {
    const me = person(context);
    const [{ rows }] = await db.execute(sql(AnchorRow)`
      SELECT anchor.* FROM anchor JOIN trip ON trip.id = anchor.trip
      WHERE trip.id = ${trip} AND trip.owner = ${me.id}
      ORDER BY anchor.date, coalesce(anchor.start_time, ''), anchor.end_time`);
    return rows;
  },
});

export const add = mutation({
  input: Anchor.omit({ id: true })
    .extend({
      start_time: HHMM.nullable().default(null),
      end_time: HHMM.nullable().default(null),
      area: z.string().nullable().default(null),
      place: z.string().nullable().default(null),
      lat: z.number().nullable().default(null),
      lng: z.number().nullable().default(null),
      source: Anchor.shape.source.default("hint"),
      text: z.string().nullable().default(null),
      calendar_event: z.string().nullable().default(null),
    })
    .refine((a) => !a.start_time || !a.end_time || a.start_time <= a.end_time, { message: "end_time is before start_time", path: ["end_time"] })
    .refine((a) => (a.lat === null) === (a.lng === null), { message: "lat and lng go together", path: ["lng"] }),
  async handler(a, context): Promise<Anchor> {
    const me = person(context);
    const id = crypto.randomUUID();
    const [inserted, trips] = await db.execute(
      sql(AnchorRow)`
        INSERT INTO anchor (id, trip, date, start_time, end_time, area, place, lat, lng, source, text, calendar_event)
        SELECT ${id}, trip.id, ${a.date}, ${a.start_time}, ${a.end_time}, ${a.area}, ${a.place}, ${a.lat}, ${a.lng}, ${a.source}, ${a.text}, ${a.calendar_event}
        FROM trip
        WHERE trip.id = ${a.trip} AND trip.owner = ${me.id} AND ${a.date} BETWEEN trip.start_date AND trip.end_date
          AND (${a.area} IS NULL OR EXISTS (SELECT 1 FROM area WHERE area.id = ${a.area} AND area.city = trip.city))
          AND (${a.place} IS NULL OR EXISTS (SELECT 1 FROM place WHERE place.id = ${a.place} AND place.city = trip.city))
        RETURNING *`,
      sql(z.object({ id: z.string() }))`SELECT id FROM trip WHERE id = ${a.trip} AND owner = ${me.id}`,
    );
    const anchor = inserted.rows[0];
    if (anchor) return anchor;
    if (trips.rows.length) throw toolError("invalid_input", "Date outside the trip, or an area or place not in its city");
    throw toolError("not_found", `No trip ${a.trip}`);
  },
});

export const remove = mutation({
  input: z.object({ id: z.string() }),
  async handler({ id }, context): Promise<{ ok: true }> {
    const me = person(context);
    await db.execute(sql`DELETE FROM anchor WHERE id = ${id} AND trip IN (SELECT id FROM trip WHERE owner = ${me.id})`);
    return { ok: true };
  },
});

export const whereAt = query({
  input: z.object({ trip: z.string(), date: IsoDate, time: HHMM }),
  async handler({ trip, date, time }, context): Promise<WhereAt> {
    const me = person(context);
    return where(await loadTrip(trip, me.id), date, time);
  },
});

/** Meals whose time overlaps an anchor more than CONFLICT_MINUTES away; the farthest anchor per meal. */
export const conflicts = query({
  input: z.object({ trip: z.string() }),
  async handler({ trip: id }, context): Promise<Conflict[]> {
    const me = person(context);
    const t = await loadTrip(id, me.id);
    const out: Conflict[] = [];
    const dates = [...new Set(t.meals.map((m) => m.date))];
    for (const date of dates) {
      const pairs = t.meals
        .filter((m) => m.date === date && m.status !== "skipped" && m.status !== "failed")
        .flatMap((meal) => {
          const ms = mealSpan(meal);
          const at = t.places.get(meal.place);
          if (!ms || !at || at.lat === null || at.lng === null) return [];
          return t.anchors
            .filter((a) => a.date === date)
            .flatMap((anchor) => {
              const [s, e] = span(anchor);
              const from = locate(anchor, t);
              return from && s <= ms[1] && ms[0] <= e ? [{ meal, anchor, from, to: { lat: at.lat!, lng: at.lng! }, start: ms[0] }] : [];
            });
        });
      if (!pairs.length) continue;
      const origins = [...new Map(pairs.map((p) => [p.anchor.id, p.from])).entries()];
      const destinations = [...new Map(pairs.map((p) => [p.meal.place, p.to])).entries()];
      const first = Math.min(...pairs.map((p) => p.start));
      const matrix = await travelMatrix(
        origins.map(([, o]) => o as Point),
        destinations.map(([, d]) => d),
        { city: t.trip.city, departure: zonedInstant(date, fromMinutes(first), t.tz), owner: me.id },
      );
      const worst = new Map<string, Conflict>();
      for (const p of pairs) {
        const minutes = matrix.minutes[origins.findIndex(([k]) => k === p.anchor.id)]?.[destinations.findIndex(([k]) => k === p.meal.place)];
        if (minutes === null || minutes === undefined || minutes <= CONFLICT_MINUTES) continue;
        const current = worst.get(p.meal.id);
        if (!current || minutes > current.minutes) {
          worst.set(p.meal.id, { meal: p.meal.id, anchor: p.anchor.id, minutes, estimated: matrix.estimated });
        }
      }
      out.push(...worst.values());
    }
    return out;
  },
});
