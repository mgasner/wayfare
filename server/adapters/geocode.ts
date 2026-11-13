import { z } from "zod";
import { attempt, empty } from "../../lib/attempt.js";
import { env } from "../../lib/env.js";
import { db, isToolError, sql } from "../../lib/nexus.js";
import { bestMatch, candidates, normalize } from "../resolve.js";

export type Geocoded = { lat: number; lng: number; place: string | null; area: string | null };
export type CityAreas = { id: string; name: string; lat: number | null; lng: number | null }[];

const Coords = z.object({ lat: z.number().nullable(), lng: z.number().nullable(), area: z.string().nullable() });
const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const Search = z.object({
  places: z.array(z.object({ id: z.string(), location: z.object({ latitude: z.number(), longitude: z.number() }) })).default([]),
});

/**
 * Coordinates for an event location: a known place by name, then Google Places text search,
 * then an area named in the address.
 */
export async function geocode(
  location: string,
  options: { owner: string; city: string; bbox: [number, number, number, number]; areas: CityAreas },
): Promise<Geocoded | null> {
  const name = location.split(/[,\n]/)[0]!.trim();
  const key = env("GOOGLE_MAPS_KEY");
  const [w, s, e, n] = options.bbox;
  try {
    const result = await attempt(
      {
        kind: "place.lookup",
        channel: "google.places",
        owner: options.owner,
        request: { public: { city: options.city, sku: "places.searchText Pro" }, private: { query: location } },
        timeoutMs: 5_000,
      },
      [
        [
          "known",
          async () => {
            const pool = await candidates(options.city, [name]);
            const match = bestMatch(name, pool);
            if (!match) return empty;
            const [{ rows }] = await db.execute(sql(Coords)`SELECT lat, lng, area FROM place WHERE id = ${match.id}`);
            const p = rows[0];
            return p && p.lat !== null && p.lng !== null ? { lat: p.lat, lng: p.lng, place: match.id, area: p.area } : empty;
          },
        ],
        [
          "google",
          async (ctx) => {
            if (!key) return empty;
            const res = await fetch(SEARCH_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.location" },
              body: JSON.stringify({
                textQuery: location,
                pageSize: 1,
                locationBias: { rectangle: { low: { latitude: s, longitude: w }, high: { latitude: n, longitude: e } } },
              }),
              signal: ctx.signal,
            });
            if (!res.ok) throw new Error(`places ${res.status}: ${(await res.text()).slice(0, 200)}`);
            const hit = Search.parse(await res.json()).places[0];
            if (!hit) return empty;
            const { latitude: lat, longitude: lng } = hit.location;
            if (lat < s || lat > n || lng < w || lng > e) return empty;
            return { lat, lng, place: null, area: null };
          },
        ],
        [
          "area",
          () => {
            const text = ` ${normalize(location)} `;
            const area = options.areas.find((a) => a.lat !== null && a.lng !== null && text.includes(` ${normalize(a.name)} `));
            return area ? { lat: area.lat!, lng: area.lng!, place: null, area: area.id } : empty;
          },
        ],
      ],
    );
    return result.value;
  } catch (error) {
    if (isToolError(error, "unavailable")) return null;
    throw error;
  }
}
