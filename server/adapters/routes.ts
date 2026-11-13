import { z } from "zod";
import { attempt, type Step } from "../../lib/attempt.js";
import { env } from "../../lib/env.js";

export type Point = { lat: number; lng: number };
export type Matrix = { minutes: (number | null)[][]; estimated: boolean };

const ENDPOINT = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const MAX_ELEMENTS = 600;

// Door-to-door taxi speed in traffic, km/h, for the estimate when the Routes API isn't available.
const TAXI_KMH: Record<string, number> = { lima: 18 };
const DETOUR = 1.3;
const PICKUP_MINUTES = 3;

export function haversineKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function estimateMinutes(a: Point, b: Point, city: string): number {
  const km = haversineKm(a, b) * DETOUR;
  return Math.round(PICKUP_MINUTES + (km / (TAXI_KMH[city] ?? 25)) * 60);
}

const Element = z.object({
  originIndex: z.number().int().default(0),
  destinationIndex: z.number().int().default(0),
  duration: z.string().optional(),
  condition: z.string().optional(),
});

const waypoint = (p: Point) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });

async function routesMatrix(
  key: string,
  origins: Point[],
  destinations: Point[],
  future: Date | null,
  signal: AbortSignal,
): Promise<(number | null)[][]> {
  const minutes = origins.map(() => destinations.map((): number | null => null));
  const per = Math.max(1, Math.floor(MAX_ELEMENTS / origins.length));
  for (let start = 0; start < destinations.length; start += per) {
    const chunk = destinations.slice(start, start + per);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,condition",
      },
      body: JSON.stringify({
        origins: origins.map(waypoint),
        destinations: chunk.map(waypoint),
        travelMode: "DRIVE",
        routingPreference: future ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE",
        ...(future ? { departureTime: future.toISOString() } : {}),
      }),
      signal,
    });
    if (!res.ok) throw new Error(`routes ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const elements = z.array(Element).parse(await res.json());
    for (const e of elements) {
      if (e.condition !== "ROUTE_EXISTS" || !e.duration) continue;
      const row = minutes[e.originIndex];
      if (row && start + e.destinationIndex < destinations.length) row[start + e.destinationIndex] = Math.round(parseFloat(e.duration) / 60);
    }
  }
  return minutes;
}

/** Driving minutes from each origin to each destination, through attempt(): Routes API, else a distance estimate. */
export async function travelMatrix(
  origins: Point[],
  destinations: Point[],
  options: { city: string; departure: Date | null; owner: string | null },
): Promise<Matrix> {
  if (!origins.length || !destinations.length) return { minutes: origins.map(() => []), estimated: false };
  const key = env("GOOGLE_MAPS_KEY");
  // The API only takes a departure time in the future; past times get traffic-unaware durations.
  const future = options.departure && options.departure.getTime() > Date.now() + 60_000 ? options.departure : null;
  const estimate: Step<Matrix> = [
    "estimate",
    () => ({ minutes: origins.map((o) => destinations.map((d) => estimateMinutes(o, d, options.city))), estimated: true }),
  ];
  const steps: Step<Matrix>[] = key
    ? [["live", async (ctx) => ({ minutes: await routesMatrix(key, origins, destinations, future, ctx.signal), estimated: false })]]
    : [];
  const result = await attempt(
    {
      kind: "route.matrix",
      channel: "google.routes",
      owner: options.owner,
      request: {
        public: {
          city: options.city,
          origins: origins.length,
          destinations: destinations.length,
          mode: "DRIVE",
          sku: future ? "ComputeRouteMatrix Pro" : "ComputeRouteMatrix Essentials",
        },
      },
      timeoutMs: 5_000,
    },
    [...steps, estimate],
  );
  return result.value;
}
