import { z } from "zod";
import { db, mutation, person, sql, toolError } from "../lib/nexus.js";
import { parseFactValue } from "../shared/facts.js";
import { FactField, type Fact } from "../shared/records.js";
import { FactRow } from "./tables.js";

/**
 * Stores what a user said about a place ("La Mar closes at 4:30 now") as a fact with source `user:<id>`.
 * Only its author sees it until the weekly promotion job moves it into the city data or it expires.
 * Exported for input.interpret, which applies a reported fact in its own transaction.
 */
export async function reportFact(userId: string, place: string, field: FactField, value: unknown): Promise<{ fact: Fact; op: "created" | "updated" }> {
  const parsed = parseFactValue(field, value);
  if (!parsed.ok) throw toolError("invalid_input", parsed.message);
  const source = `user:${userId}`;
  const [existing, written] = await db.execute(
    sql(z.object({ n: z.number() }))`SELECT count(*) AS n FROM fact WHERE place = ${place} AND field = ${field} AND source = ${source}`,
    sql(FactRow)`
      INSERT INTO fact (place, field, value, source, checked_at)
      SELECT ${place}, ${field}, ${JSON.stringify(parsed.value)}, ${source}, ${new Date().toISOString()}
      WHERE EXISTS (SELECT 1 FROM place WHERE id = ${place})
      ON CONFLICT (place, field, source) DO UPDATE SET value = excluded.value, checked_at = excluded.checked_at
      RETURNING *`,
  );
  const fact = written.rows[0];
  if (!fact) throw toolError("not_found", `No place ${place}`);
  return { fact, op: existing.rows[0]?.n ? "updated" : "created" };
}

/** Reports a fact about a place as the signed-in user. */
export const report = mutation({
  input: z.object({ place: z.string(), field: FactField, value: z.unknown() }),
  async handler({ place, field, value }, context): Promise<Fact> {
    const me = person(context);
    return (await reportFact(me.id, place, field, value)).fact;
  },
});

/** Withdraws the signed-in user's report on a place's field (Undo, or "never mind"). */
export const retract = mutation({
  input: z.object({ place: z.string(), field: FactField }),
  async handler({ place, field }, context): Promise<{ ok: true }> {
    const me = person(context);
    await db.execute(sql`DELETE FROM fact WHERE place = ${place} AND field = ${field} AND source = ${`user:${me.id}`}`);
    return { ok: true };
  },
});
