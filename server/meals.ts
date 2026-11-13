import { z } from "zod";
import { db, mutation, person, sql, toolError } from "../lib/nexus.js";
import { Meal } from "../shared/records.js";
import { MealRow } from "./tables.js";

/** Creates a meal, or replaces the one with `id`. */
export const set = mutation({
  input: Meal.omit({ updated_at: true }).extend({
    id: z.string().optional(),
    time: Meal.shape.time.default(null),
    channel: Meal.shape.channel.default(null),
    note: Meal.shape.note.default(null),
  }),
  async handler(m, context): Promise<Meal> {
    const me = person(context);
    const id = m.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const [{ rows }] = await db.execute(sql(MealRow)`
      INSERT INTO meal (id, trip, place, date, slot, time, status, channel, note, updated_at)
      SELECT ${id}, ${m.trip}, ${m.place}, ${m.date}, ${m.slot}, ${m.time}, ${m.status}, ${m.channel}, ${m.note}, ${now}
      WHERE EXISTS (SELECT 1 FROM trip WHERE id = ${m.trip} AND owner = ${me.id})
        AND EXISTS (SELECT 1 FROM place WHERE id = ${m.place})
      ON CONFLICT (id) DO UPDATE SET
        trip = excluded.trip, place = excluded.place, date = excluded.date, slot = excluded.slot,
        time = excluded.time, status = excluded.status, channel = excluded.channel, note = excluded.note,
        updated_at = excluded.updated_at
      WHERE meal.trip IN (SELECT id FROM trip WHERE owner = ${me.id})
      RETURNING *`);
    const meal = rows[0];
    if (!meal) throw toolError("not_found", `No trip ${m.trip}, place ${m.place} or meal ${id} of yours`);
    return meal;
  },
});

export const remove = mutation({
  input: z.object({ id: z.string() }),
  async handler({ id }, context): Promise<{ ok: true }> {
    const me = person(context);
    await db.execute(sql`DELETE FROM meal WHERE id = ${id} AND trip IN (SELECT id FROM trip WHERE owner = ${me.id})`);
    return { ok: true };
  },
});
