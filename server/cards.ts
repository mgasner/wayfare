import { z } from "zod";
import { db, sql } from "../lib/nexus.js";
import { FactField, type FactView, type PlaceCard } from "../shared/records.js";
import { FactRow, PlaceRow, SlotReadRow } from "./tables.js";

export type CardOptions = {
  /** Slot reads for this party between `from` and `to`; none without a party. */
  slots?: { party: number; from: string; to: string };
};

/**
 * Places as cards for `viewer` (an app_user id, or null when signed out), in the order of `ids`.
 * Facts reduce to the newest per field among sources the viewer may see: shared ones and their own.
 */
export async function placeCards(ids: string[], viewer: string | null, options: CardOptions = {}): Promise<PlaceCard[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const list = JSON.stringify(unique);
  const own = viewer ? `user:${viewer}` : null;
  const slots = options.slots;
  const [places, facts, reads, saved] = await db.execute(
    sql(PlaceRow)`SELECT * FROM place WHERE id IN (SELECT value FROM json_each(${list}))`,
    sql(FactRow)`
      SELECT * FROM fact
      WHERE place IN (SELECT value FROM json_each(${list}))
        AND (source NOT LIKE 'user:%' OR source = ${own})
        AND field IN (SELECT value FROM json_each(${JSON.stringify(FactField.options)}))`,
    sql(SlotReadRow)`
      SELECT * FROM slot_read
      WHERE place IN (SELECT value FROM json_each(${list}))
        AND party = ${slots?.party ?? -1} AND date BETWEEN ${slots?.from ?? ""} AND ${slots?.to ?? ""}
      ORDER BY date, service`,
    sql(z.object({ place: z.string() }))`
      SELECT place FROM save WHERE owner = ${viewer} AND place IN (SELECT value FROM json_each(${list}))`,
  );

  const newest = new Map<string, Partial<Record<FactField, FactView>>>();
  for (const f of facts.rows) {
    const byField = newest.get(f.place) ?? {};
    const current = byField[f.field];
    if (!current || f.checked_at > current.checked_at) {
      byField[f.field] = { value: f.value, source: f.source, checked_at: f.checked_at };
    }
    newest.set(f.place, byField);
  }
  const savedSet = new Set(saved.rows.map((r) => r.place));
  const byId = new Map(places.rows.map((p) => [p.id, p]));

  return unique.flatMap((id) => {
    const place = byId.get(id);
    if (!place) return [];
    return [
      {
        ...place,
        facts: newest.get(id) ?? {},
        slots: reads.rows.filter((r) => r.place === id),
        saved: savedSet.has(id),
      },
    ];
  });
}
