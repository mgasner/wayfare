import { z } from "zod";
import { db, mutation, person, query, sql, toolError, type Statement, type Value } from "../lib/nexus.js";
import { Trip, type TripView } from "../shared/records.js";
import { placeCards } from "./cards.js";
import { AnchorRow, AreaRow, CityRow, MealRow, TripRow } from "./tables.js";

const Fields = Trip.omit({ id: true, owner: true, created_at: true });
const jsonColumns = new Set(["base", "appetite", "budget", "diet", "booking"]);

function column(key: string, value: unknown): Value {
  if (value === null) return null;
  return jsonColumns.has(key) ? JSON.stringify(value) : (value as Value);
}

/** The signed-in user's trips, soonest first. */
export const list = query({
  input: z.object({}),
  async handler(_, context): Promise<Trip[]> {
    const me = person(context);
    const [{ rows }] = await db.execute(sql(TripRow)`SELECT * FROM trip WHERE owner = ${me.id} ORDER BY start_date, created_at`);
    return rows;
  },
});

/** A trip with its city, areas, meals, anchors and the places its meals name. */
export const get = query({
  input: z.object({ id: z.string() }),
  async handler({ id }, context): Promise<TripView> {
    const me = person(context);
    const [trips, cities, areas, meals, anchors] = await db.execute(
      sql(TripRow)`SELECT * FROM trip WHERE id = ${id} AND owner = ${me.id}`,
      sql(CityRow)`SELECT city.* FROM city JOIN trip ON trip.city = city.id WHERE trip.id = ${id} AND trip.owner = ${me.id}`,
      sql(AreaRow)`SELECT area.* FROM area JOIN trip ON trip.city = area.city WHERE trip.id = ${id} AND trip.owner = ${me.id} ORDER BY area.name`,
      sql(MealRow)`SELECT meal.* FROM meal JOIN trip ON trip.id = meal.trip WHERE trip.id = ${id} AND trip.owner = ${me.id} ORDER BY meal.date, meal.slot, meal.time`,
      sql(AnchorRow)`SELECT anchor.* FROM anchor JOIN trip ON trip.id = anchor.trip WHERE trip.id = ${id} AND trip.owner = ${me.id} ORDER BY anchor.date, anchor.start_time`,
    );
    const trip = trips.rows[0];
    const city = cities.rows[0];
    if (!trip || !city) throw toolError("not_found", `No trip ${id}`);
    const places = await placeCards(
      meals.rows.map((m) => m.place),
      me.id,
      { slots: { party: trip.party, from: trip.start_date, to: trip.end_date } },
    );
    return { trip, city, areas: areas.rows, meals: meals.rows, anchors: anchors.rows, places };
  },
});

export const create = mutation({
  input: Fields.extend({
    appetite: Fields.shape.appetite.default(null),
    budget: Fields.shape.budget.default(null),
    diet: Fields.shape.diet.default(null),
    booking: Fields.shape.booking.default(null),
    refresh: Fields.shape.refresh.default("standard"),
  }).refine((t) => t.start_date <= t.end_date, { message: "start_date is after end_date", path: ["end_date"] }),
  async handler(t, context): Promise<Trip> {
    const me = person(context);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const [{ rows }] = await db.execute(sql(TripRow)`
      INSERT INTO trip (id, owner, city, start_date, end_date, party, base, appetite, budget, diet, booking, refresh, created_at)
      SELECT ${id}, ${me.id}, ${t.city}, ${t.start_date}, ${t.end_date}, ${t.party}, ${column("base", t.base)},
             ${column("appetite", t.appetite)}, ${column("budget", t.budget)}, ${column("diet", t.diet)},
             ${column("booking", t.booking)}, ${t.refresh}, ${now}
      WHERE EXISTS (SELECT 1 FROM city WHERE id = ${t.city})
      RETURNING *`);
    const trip = rows[0];
    if (!trip) throw toolError("invalid_input", `No city ${t.city}`);
    return trip;
  },
});

/** Changes the fields given; the rest stay. */
export const update = mutation({
  input: Fields.partial().extend({ id: z.string() }),
  async handler({ id, ...patch }, context): Promise<Trip> {
    const me = person(context);
    const keys = Object.keys(patch).filter((k) => k in Fields.shape) as (keyof typeof patch)[];
    if (patch.city !== undefined) throw toolError("invalid_input", "A trip's city does not change");
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const update: Statement<z.output<typeof TripRow>> = {
      // Dates are checked in the statement so a concurrent change to the other date cannot slip past.
      sql: `UPDATE trip SET ${sets || "id = id"} WHERE id = ? AND owner = ?
            AND coalesce(?, start_date) <= coalesce(?, end_date) RETURNING *`,
      params: [...keys.map((k) => column(k, patch[k])), id, me.id, patch.start_date ?? null, patch.end_date ?? null],
      row: TripRow,
    };
    const [updated, existing] = await db.execute(
      update,
      sql(z.object({ id: z.string() }))`SELECT id FROM trip WHERE id = ${id} AND owner = ${me.id}`,
    );
    const trip = updated.rows[0];
    if (trip) return trip;
    if (existing.rows.length) throw toolError("invalid_input", "start_date is after end_date");
    throw toolError("not_found", `No trip ${id}`);
  },
});
