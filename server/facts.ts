import { z } from "zod";
import { db, mutation, person, sql, toolError, type Statement } from "../lib/nexus.js";
import { parseFactValue } from "../shared/facts.js";
import { FactField, type Fact } from "../shared/records.js";
import { FactRow } from "./tables.js";

/**
 * The write for what a user said about a place ("La Mar closes at 4:30 now"): a fact with source
 * `user:<id>`, which only its author sees until the weekly promotion job moves it into the city data
 * or it expires. input.interpret commits it in its own transaction; reportFact runs it alone.
 */
export function reportFactStatement(userId: string, place: string, field: FactField, value: unknown, at = new Date().toISOString()): Statement<Fact> {
  const parsed = parseFactValue(field, value);
  if (!parsed.ok) throw toolError("invalid_input", parsed.message);
  return sql(FactRow)`
    INSERT INTO fact (place, field, value, source, checked_at)
    SELECT ${place}, ${field}, ${JSON.stringify(parsed.value)}, ${`user:${userId}`}, ${at}
    WHERE EXISTS (SELECT 1 FROM place WHERE id = ${place})
    ON CONFLICT (place, field, source) DO UPDATE SET value = excluded.value, checked_at = excluded.checked_at
    RETURNING *`;
}

export async function reportFact(userId: string, place: string, field: FactField, value: unknown): Promise<{ fact: Fact; op: "created" | "updated" }> {
  const write = reportFactStatement(userId, place, field, value);
  const [existing, written] = await db.execute(
    sql(z.object({ n: z.number() }))`SELECT count(*) AS n FROM fact WHERE place = ${place} AND field = ${field} AND source = ${`user:${userId}`}`,
    write,
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
