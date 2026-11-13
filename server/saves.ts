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

/** Saves a place; saving it again keeps the first save's time and replaces the note or source given. */
export const add = mutation({
  input: z.object({ place: z.string(), note: z.string().optional(), source: z.string().optional() }),
  async handler({ place, note, source }, context): Promise<Save> {
    const me = person(context);
    const now = new Date().toISOString();
    const [{ rows }] = await db.execute(sql(SaveRow)`
      INSERT INTO save (owner, place, source, note, created_at)
      SELECT ${me.id}, ${place}, ${source ?? null}, ${note ?? null}, ${now}
      WHERE EXISTS (SELECT 1 FROM place WHERE id = ${place})
      ON CONFLICT (owner, place) DO UPDATE SET
        note = coalesce(excluded.note, save.note), source = coalesce(excluded.source, save.source)
      RETURNING *`);
    const save = rows[0];
    if (!save) throw toolError("not_found", `No place ${place}`);
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
