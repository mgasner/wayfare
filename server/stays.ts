import { z } from "zod";
import { attempt, empty } from "../lib/attempt.js";
import { env } from "../lib/env.js";
import { db, isToolError, person, query, sql, toolError } from "../lib/nexus.js";
import { HHMM, IsoDate, type City } from "../shared/records.js";
import { travelMatrix } from "./adapters/routes.js";
import { candidates, nameScore } from "./resolve.js";
import { CityRow } from "./tables.js";
import { zonedInstant } from "./time.js";

// Where a traveler sleeps, before a trip exists: a hotel or address looked up in a city,
// and taxi minutes from it to the city's areas.

export type StayHit = {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  google_place_id: string | null;
  /** Our place id, when the hit came from the place table. */
  place: string | null;
};

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const Search = z.object({
  places: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.object({ text: z.string() }).optional(),
        formattedAddress: z.string().optional(),
        location: z.object({ latitude: z.number(), longitude: z.number() }),
      }),
    )
    .default([]),
});
const Coords = z.object({ id: z.string(), name: z.string(), lat: z.number().nullable(), lng: z.number().nullable(), google_place_id: z.string().nullable() });

/** Below this nameScore a place-table row is not offered. */
const NAME_THRESHOLD = 0.6;

async function loadCity(id: string): Promise<City> {
  const [{ rows }] = await db.execute(sql(CityRow)`SELECT * FROM city WHERE id = ${id}`);
  const city = rows[0];
  if (!city) throw toolError("not_found", `No city ${id}`);
  return city;
}

const inside = ([w, s, e, n]: City["bbox"], lat: number, lng: number) => lat >= s && lat <= n && lng >= w && lng <= e;

/** A hotel or address in `city`: Google Places text search, else our place table (curated and Overture) by name. */
export const search = query({
  input: z.object({ city: z.string(), q: z.string().trim().min(2).max(200), limit: z.number().int().min(1).max(10).default(5) }),
  async handler({ city: cityId, q, limit }, context): Promise<{ results: StayHit[]; source: "google" | "places" | "none" }> {
    const me = person(context);
    const city = await loadCity(cityId);
    const [w, s, e, n] = city.bbox;
    const key = env("GOOGLE_MAPS_KEY");
    try {
      const result = await attempt(
        {
          kind: "place.lookup",
          channel: "google.places",
          owner: me.id,
          request: { public: { city: city.id, purpose: "stay", sku: "places.searchText Pro" }, private: { query: q } },
          timeoutMs: 5_000,
        },
        [
          [
            "google",
            async (ctx) => {
              if (!key) return empty;
              const res = await fetch(SEARCH_URL, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Goog-Api-Key": key,
                  "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
                },
                body: JSON.stringify({
                  textQuery: q,
                  pageSize: limit,
                  locationBias: { rectangle: { low: { latitude: s, longitude: w }, high: { latitude: n, longitude: e } } },
                }),
                signal: ctx.signal,
              });
              if (!res.ok) throw new Error(`places ${res.status}: ${(await res.text()).slice(0, 200)}`);
              const hits = Search.parse(await res.json())
                .places.filter((p) => inside(city.bbox, p.location.latitude, p.location.longitude))
                .map(
                  (p): StayHit => ({
                    name: p.displayName?.text ?? p.formattedAddress ?? q,
                    address: p.formattedAddress ?? null,
                    lat: p.location.latitude,
                    lng: p.location.longitude,
                    google_place_id: p.id,
                    place: null,
                  }),
                );
              ctx.note({ results: hits.length });
              return hits.length ? { results: hits, source: "google" as const } : empty;
            },
          ],
          [
            "places",
            async () => {
              const pool = await candidates(city.id, [q]);
              const ranked = pool
                .map((c) => ({ c, score: nameScore(q, c.name) }))
                .filter((x) => x.score >= NAME_THRESHOLD)
                .sort((a, b) => b.score - a.score)
                .slice(0, limit * 2);
              if (!ranked.length) return empty;
              const [{ rows }] = await db.execute(sql(Coords)`
                SELECT id, name, lat, lng, google_place_id FROM place
                WHERE id IN (SELECT value FROM json_each(${JSON.stringify(ranked.map((x) => x.c.id))}))`);
              const byId = new Map(rows.map((r) => [r.id, r]));
              const hits = ranked.flatMap(({ c }): StayHit[] => {
                const r = byId.get(c.id);
                return r && r.lat !== null && r.lng !== null
                  ? [{ name: r.name, address: null, lat: r.lat, lng: r.lng, google_place_id: r.google_place_id, place: r.id }]
                  : [];
              });
              return hits.length ? { results: hits.slice(0, limit), source: "places" as const } : empty;
            },
          ],
        ],
      );
      return result.value;
    } catch (error) {
      if (isToolError(error, "unavailable")) return { results: [], source: "none" };
      throw error;
    }
  },
});

/** Taxi minutes from a point to each of the city's areas; departing at `date` `time` in the city when given. */
export const minutes = query({
  input: z
    .object({ city: z.string(), lat: z.number(), lng: z.number(), date: IsoDate.optional(), time: HHMM.optional() })
    .refine((x) => !x.date === !x.time, { message: "date and time go together", path: ["time"] }),
  async handler({ city: cityId, lat, lng, date, time }, context): Promise<{ minutes: Record<string, number | null>; estimated: boolean }> {
    const me = person(context);
    const city = await loadCity(cityId);
    const Area = z.object({ id: z.string(), lat: z.number().nullable(), lng: z.number().nullable() });
    const [{ rows }] = await db.execute(sql(Area)`SELECT id, lat, lng FROM area WHERE city = ${city.id} ORDER BY id`);
    const result: Record<string, number | null> = Object.fromEntries(rows.map((a) => [a.id, null]));
    const known = rows.filter((a) => a.lat !== null && a.lng !== null);
    if (!known.length) return { minutes: result, estimated: false };
    const matrix = await travelMatrix(
      [{ lat, lng }],
      known.map((a) => ({ lat: a.lat!, lng: a.lng! })),
      { city: city.id, departure: date && time ? zonedInstant(date, time, city.tz) : null, owner: me.id },
    );
    known.forEach((a, i) => (result[a.id] = matrix.minutes[0]?.[i] ?? null));
    return { minutes: result, estimated: matrix.estimated };
  },
});
