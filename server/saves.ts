import { z } from "zod";
import { db, mutation, person, query, sql, toolError } from "../lib/nexus.js";
import type { PlaceCard, Save } from "../shared/records.js";
import { placeCards } from "./cards.js";
import { SaveRow } from "./tables.js";

/** The signed-in user's saves, newest first, optionally in one city. */
export const list = query({
  input: z.object({ city: z.string().optional() }),
  async handler({ city }, context): Promise<{ save: Save; place: PlaceCard }[]> {
    const me = person(context);
    const [{ rows }] = await db.execute(sql(SaveRow)`
      SELECT save.* FROM save JOIN place ON place.id = save.place
      WHERE save.owner = ${me.id} AND (${city ?? null} IS NULL OR place.city = ${city ?? null})
      ORDER BY save.created_at DESC`);
    const cards = new Map((await placeCards(rows.map((s) => s.place), me.id)).map((c) => [c.id, c]));
    return rows.flatMap((save) => {
      const place = cards.get(save.place);
      return place ? [{ save, place }] : [];
    });
  },
});

/** Saves a place; saving it again keeps the first save's time and replaces the note, source or nearby flag given. */
export const add = mutation({
  input: z.object({ place: z.string(), note: z.string().optional(), source: z.string().optional(), notify_nearby: z.boolean().optional() }),
  async handler({ place, note, source, notify_nearby }, context): Promise<Save> {
    const me = person(context);
    const now = new Date().toISOString();
    const nearby = notify_nearby === undefined ? null : notify_nearby ? 1 : 0;
    const [{ rows }] = await db.execute(sql(SaveRow)`
      INSERT INTO save (owner, place, source, note, notify_nearby, created_at)
      SELECT ${me.id}, ${place}, ${source ?? null}, ${note ?? null}, coalesce(${nearby}, 0), ${now}
      WHERE EXISTS (SELECT 1 FROM place WHERE id = ${place})
      ON CONFLICT (owner, place) DO UPDATE SET
        note = coalesce(excluded.note, save.note), source = coalesce(excluded.source, save.source),
        notify_nearby = coalesce(${nearby}, save.notify_nearby)
      RETURNING *`);
    const save = rows[0];
    if (!save) throw toolError("not_found", `No place ${place}`);
    return save;
  },
});

/** Changes a save's note (null or blank clears it) or nearby flag; fields not given stay. */
export const update = mutation({
  input: z.object({
    place: z.string(),
    note: z.string().max(500).nullable().optional(),
    notify_nearby: z.boolean().optional(),
  }),
  async handler({ place, note, notify_nearby }, context): Promise<Save> {
    const me = person(context);
    const setNote = note !== undefined;
    const text = note?.trim() ? note.trim() : null;
    const nearby = notify_nearby === undefined ? null : notify_nearby ? 1 : 0;
    const [{ rows }] = await db.execute(sql(SaveRow)`
      UPDATE save SET
        note = CASE WHEN ${setNote} THEN ${text} ELSE note END,
        notify_nearby = coalesce(${nearby}, notify_nearby)
      WHERE owner = ${me.id} AND place = ${place}
      RETURNING *`);
    const save = rows[0];
    if (!save) throw toolError("not_found", `No save for ${place}`);
    return save;
  },
});

export const remove = mutation({
  input: z.object({ place: z.string() }),
  async handler({ place }, context): Promise<{ ok: true }> {
    const me = person(context);
    await db.execute(sql`DELETE FROM save WHERE owner = ${me.id} AND place = ${place}`);
    return { ok: true };
  },
});
