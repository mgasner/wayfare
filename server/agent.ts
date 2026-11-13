import { z } from "zod";
import { db, mutation, query, sql, toolError, type Context, type Statement } from "../lib/nexus.js";
import { parseFactValue, SharedSource } from "../shared/facts.js";
import { FRESHNESS_MS } from "../shared/freshness.js";
import { FactField, Instant, PlaceKind } from "../shared/records.js";
import { placesOnUpcomingTrips } from "./active.js";

// The agent API: what Indent sessions and automations call, with a bearer token (AGENT_TOKEN)
// that api/route.ts turns into an `indent` actor. Every entrypoint here declares `output`,
// since the SDK only exposes those to agents.

function requireAgent(context: Context): void {
  const kind = context.auth?.actor.kind;
  if (!kind) throw toolError("no_user", "The agent API takes a bearer token");
  if (kind !== "indent") throw toolError("not_allowed", "The agent API is for Indent agents");
}

const DAY_MS = 86_400_000;

const FactInput = z.object({
  place: z.string(),
  field: FactField,
  value: z.unknown(),
  source: SharedSource.default("research"),
  checked_at: Instant.optional(),
});

/** Writes shared facts (research or live), replacing the same place, field and source. Unknown places are skipped. */
export const recordFacts = mutation({
  input: z.object({ facts: z.array(FactInput).min(1).max(500) }),
  output: z.object({ written: z.number().int(), unchanged: z.number().int(), unknown_places: z.array(z.string()) }),
  async handler({ facts }, context) {
    requireAgent(context);
    const now = new Date().toISOString();
    const values = facts.map((f, i) => {
      const parsed = parseFactValue(f.field, f.value);
      if (!parsed.ok) throw toolError("invalid_input", `facts.${i}.value: ${parsed.message}`);
      return parsed.value;
    });
    const ids = JSON.stringify([...new Set(facts.map((f) => f.place))]);
    const [known, ...writes] = await db.execute(
      sql(z.object({ id: z.string() }))`SELECT id FROM place WHERE id IN (SELECT value FROM json_each(${ids}))`,
      ...facts.map((f, i) =>
        sql`INSERT INTO fact (place, field, value, source, checked_at)
            SELECT ${f.place}, ${f.field}, ${JSON.stringify(values[i])}, ${f.source}, ${f.checked_at ?? now}
            WHERE EXISTS (SELECT 1 FROM place WHERE id = ${f.place})
            ON CONFLICT (place, field, source) DO UPDATE SET value = excluded.value, checked_at = excluded.checked_at
            WHERE (fact.value, fact.checked_at) IS NOT (excluded.value, excluded.checked_at)`,
      ),
    );
    const present = new Set(known.rows.map((r) => r.id));
    const unknown = [...new Set(facts.map((f) => f.place).filter((p) => !present.has(p)))];
    const written = writes.reduce((n, w) => n + (w.changes > 0 ? 1 : 0), 0);
    const attempted = facts.filter((f) => present.has(f.place)).length;
    return { written, unchanged: attempted - written, unknown_places: unknown };
  },
});

const StaleField = z.object({ field: FactField, checked_at: Instant.nullable() });

/**
 * Curated, open places in a city whose shared facts are missing or past their window (or older than
 * `older_than_days`), for the fact-refresh automation. `on_trip` marks places on a trip in the next 14 days.
 */
export const listStale = query({
  input: z.object({
    city: z.string(),
    fields: z.array(FactField).optional(),
    older_than_days: z.number().min(0).optional(),
    only_on_trip: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  output: z.object({
    checked_at: Instant,
    places: z.array(
      z.object({ id: z.string(), name: z.string(), kind: PlaceKind.nullable(), area: z.string().nullable(), on_trip: z.boolean(), stale: z.array(StaleField) }),
    ),
  }),
  async handler({ city, fields, older_than_days, only_on_trip, limit }, context) {
    requireAgent(context);
    const now = Date.now();
    const wanted = fields ?? (["status", "hours", "price_pp", "menu"] as const);
    const windowFor = (f: FactField) =>
      older_than_days !== undefined ? older_than_days * DAY_MS : ((FRESHNESS_MS as Partial<Record<FactField, number>>)[f] ?? null);
    const [places, newest] = await db.execute(
      sql(z.object({ id: z.string(), name: z.string(), kind: PlaceKind.nullable(), area: z.string().nullable() }))`
        SELECT id, name, kind, area FROM place
        WHERE city = ${city} AND curated = 1
          AND coalesce((SELECT json_extract(f.value, '$') FROM fact f
                        WHERE f.place = place.id AND f.field = 'status' AND f.source NOT LIKE 'user:%'
                        ORDER BY f.checked_at DESC LIMIT 1), 'open') <> 'closed'
        ORDER BY id`,
      sql(z.object({ place: z.string(), field: z.string(), checked_at: z.string() }))`
        SELECT fact.place, fact.field, max(fact.checked_at) AS checked_at FROM fact JOIN place ON place.id = fact.place
        WHERE place.city = ${city} AND place.curated = 1 AND fact.source NOT LIKE 'user:%'
        GROUP BY fact.place, fact.field`,
    );
    const onTrip = new Set(await placesOnUpcomingTrips({ now, days: 14, city }));
    const checked = new Map(newest.rows.map((r) => [`${r.place}\0${r.field}`, r.checked_at]));
    const out = places.rows.flatMap((p) => {
      if (only_on_trip && !onTrip.has(p.id)) return [];
      const stale = wanted.flatMap((field): { field: FactField; checked_at: string | null }[] => {
        const at = checked.get(`${p.id}\0${field}`) ?? null;
        if (at === null) return [{ field, checked_at: null }];
        const window = windowFor(field);
        const t = Date.parse(at);
        return window !== null && (Number.isNaN(t) || now - t > window) ? [{ field, checked_at: at }] : [];
      });
      return stale.length ? [{ ...p, on_trip: onTrip.has(p.id), stale }] : [];
    });
    out.sort((a, b) => Number(b.on_trip) - Number(a.on_trip));
    return { checked_at: new Date(now).toISOString(), places: out.slice(0, limit ?? 200) };
  },
});

/**
 * Deletes facts: exact rows by place, field and source, and/or every user-reported fact checked before
 * `user_facts_before`. Research facts are only removed by name, never by age.
 */
export const expireFacts = mutation({
  input: z
    .object({
      facts: z.array(z.object({ place: z.string(), field: FactField, source: z.string() })).max(500).optional(),
      user_facts_before: Instant.optional(),
    })
    .refine((v) => v.facts?.length || v.user_facts_before, "Give facts or user_facts_before"),
  output: z.object({ deleted: z.number().int() }),
  async handler({ facts, user_facts_before }, context) {
    requireAgent(context);
    const statements: Statement<never>[] = (facts ?? []).map(
      (f) => sql`DELETE FROM fact WHERE place = ${f.place} AND field = ${f.field} AND source = ${f.source}`,
    );
    if (user_facts_before) {
      statements.push(sql`DELETE FROM fact WHERE source LIKE 'user:%' AND checked_at < ${user_facts_before}`);
    }
    const results = await db.execute(...statements);
    return { deleted: results.reduce((n, r) => n + r.changes, 0) };
  },
});
