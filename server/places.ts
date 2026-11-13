import { z } from "zod";
import { db, mutation, query, sql, toolError, type Context, type Statement, type Value } from "../lib/nexus.js";
import { IsoDate, PlaceKind, type PlaceCard, type SlotRead } from "../shared/records.js";
import { placeCards, type CardOptions } from "./cards.js";
import { refreshPlaceSlots } from "./slots.js";

const accents: [string, string][] = [
  ["á", "a"], ["é", "e"], ["í", "i"], ["ó", "o"], ["ú", "u"], ["ü", "u"], ["ñ", "n"], ["ô", "o"], ["è", "e"], ["à", "a"],
];

/** SQLite's lower() folds only ASCII, so accented letters are replaced in both cases by hand. */
function foldSql(expr: string): string {
  let out = `lower(${expr})`;
  for (const [from, to] of accents) {
    out = `replace(replace(${out}, '${from}', '${to}'), '${from.toUpperCase()}', '${to}')`;
  }
  return out;
}

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function likePattern(q: string): string {
  return `%${fold(q).trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function viewerId(context: Context): string | null {
  const actor = context.auth?.actor;
  return actor?.kind === "person" ? actor.id : null;
}

/** Slot options for a trip the viewer owns: its party, over its dates or one `date`. */
async function tripSlots(trip: string | undefined, viewer: string | null, date?: string): Promise<CardOptions> {
  if (!trip) return {};
  if (!viewer) throw toolError("no_user", "Sign in to see a trip's slots");
  const [{ rows }] = await db.execute(
    sql(z.object({ party: z.number(), start_date: z.string(), end_date: z.string(), city: z.string() }))`
      SELECT party, start_date, end_date, city FROM trip WHERE id = ${trip} AND owner = ${viewer}`,
  );
  const t = rows[0];
  if (!t) throw toolError("not_found", `No trip ${trip}`);
  return { slots: { party: t.party, from: date ?? t.start_date, to: date ?? t.end_date } };
}

const kindOrder = `CASE place.kind WHEN 'reserve_ahead' THEN 0 WHEN 'bookable' THEN 1 WHEN 'walk_in' THEN 2 WHEN 'informal' THEN 3 ELSE 4 END`;

/**
 * Places in a city as cards. Without `q`, curated places only; with `q`, Overture rows too, matched by name
 * ignoring case and accents. Places whose newest visible status is `closed` never appear.
 */
export const search = query({
  input: z.object({
    city: z.string(),
    trip: z.string().optional(),
    kinds: z.array(PlaceKind).optional(),
    area: z.string().optional(),
    q: z.string().optional(),
    date: IsoDate.optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  async handler({ city, trip, kinds, area, q, date, limit }, context): Promise<PlaceCard[]> {
    const viewer = viewerId(context);
    const options = await tripSlots(trip, viewer, date);
    const own = viewer ? `user:${viewer}` : null;
    const where = [
      "place.city = ?",
      "(place.created_by IS NULL OR place.created_by = ?)",
      `coalesce((
        SELECT json_extract(f.value, '$') FROM fact f
        WHERE f.place = place.id AND f.field = 'status' AND (f.source NOT LIKE 'user:%' OR f.source = ?)
        ORDER BY f.checked_at DESC LIMIT 1), 'open') <> 'closed'`,
    ];
    const params: Value[] = [city, viewer, own];
    const query = q?.trim();
    if (query) {
      where.push(`${foldSql("place.name")} LIKE ? ESCAPE '\\'`);
      params.push(likePattern(query));
    } else {
      where.push("place.curated = 1");
    }
    if (kinds?.length) {
      where.push("place.kind IN (SELECT value FROM json_each(?))");
      params.push(JSON.stringify(kinds));
    }
    if (area) {
      where.push("place.area = ?");
      params.push(area);
    }
    const statement: Statement<{ id: string }> = {
      sql: `SELECT place.id AS id FROM place WHERE ${where.join(" AND ")}
            ORDER BY place.curated DESC, ${kindOrder}, place.name LIMIT ?`,
      params: [...params, limit ?? 50],
      row: z.object({ id: z.string() }),
    };
    const [{ rows }] = await db.execute(statement);
    return placeCards(rows.map((r) => r.id), viewer, options);
  },
});

/** One place as a card, with the trip's slots when `trip` is given. Closed places are returned too. */
export const get = query({
  input: z.object({ id: z.string(), trip: z.string().optional() }),
  async handler({ id, trip }, context): Promise<PlaceCard> {
    const viewer = viewerId(context);
    const [card] = await placeCards([id], viewer, await tripSlots(trip, viewer));
    if (!card) throw toolError("not_found", `No place ${id}`);
    return card;
  },
});

/**
 * Reads slots live for a place (the clock icon's tap), falling back to the last good read per date.
 * Dates the ladder couldn't answer have no read in the result; dates read in the last minute aren't read again.
 */
export const refreshSlots = mutation({
  input: z.object({ place: z.string(), dates: z.array(IsoDate).min(1).max(14), party: z.number().int().min(1).max(20) }),
  async handler({ place, dates, party }, context): Promise<SlotRead[]> {
    const actor = context.auth?.actor;
    if (actor?.kind !== "person" && actor?.kind !== "indent") throw toolError("no_user", "Sign in to read slots");
    const viewer = actor.kind === "person" ? actor.id : null;
    const [{ rows }] = await db.execute(sql(z.object({ id: z.string() }))`
      SELECT id FROM place WHERE id = ${place} AND (created_by IS NULL OR created_by = ${viewer} OR ${actor.kind === "indent"})`);
    if (!rows.length) throw toolError("not_found", `No place ${place}`);
    const results = await refreshPlaceSlots(place, dates, party, actor.kind === "person" ? actor.id : null);
    return results.flatMap((r) => r.reads);
  },
});
