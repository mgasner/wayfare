import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDatabase } from "../lib/db.js";
import { setEnv } from "../lib/env.js";
import type { Auth } from "../lib/nexus.js";
import { addPlaces } from "./fixtures.js";
import { addUser, callAs, personalDataInInteractions, seededDb } from "./helpers.js";

let database: FileDatabase;
let max: Auth;
const all = (q: string) => database.run((s) => s.prepare(q).all());

beforeEach(async () => {
  setEnv({});
  database = await seededDb();
  max = await addUser(database, "max@example.com");
  await addPlaces(database);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => setEnv(undefined));

function stubPlaces(places: unknown[], status = 200) {
  const bodies: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
      bodies.push(JSON.parse(String(init.body)));
      return status === 200 ? Response.json({ places }) : new Response("denied", { status });
    }),
  );
  return bodies;
}

const bolivar = {
  id: "ChIJbolivar",
  displayName: { text: "Gran Hotel Bolívar" },
  formattedAddress: "Jr. de la Unión 958, Lima 15001, Peru",
  location: { latitude: -12.0507, longitude: -77.0352 },
};
const outside = { id: "ChIJcusco", displayName: { text: "Hotel Bolívar Cusco" }, location: { latitude: -13.52, longitude: -71.97 } };

describe("stays.search", () => {
  it("looks a hotel up with Google Places, inside the city's bbox", async () => {
    setEnv({ GOOGLE_MAPS_KEY: "maps-key" });
    const bodies = stubPlaces([bolivar, outside]);
    const { status, body } = await callAs(max, "stays.search", { city: "lima", q: "Gran Hotel Bolivar" });
    expect(status).toBe(200);
    expect(body).toEqual({
      source: "google",
      results: [{ name: "Gran Hotel Bolívar", address: bolivar.formattedAddress, lat: -12.0507, lng: -77.0352, google_place_id: "ChIJbolivar", place: null }],
    });
    expect(bodies[0]).toMatchObject({ textQuery: "Gran Hotel Bolivar", pageSize: 5 });
    expect(bodies[0].locationBias.rectangle.low).toEqual({ latitude: -12.3, longitude: -77.2 });

    const ix = await all("SELECT channel, kind, outcome, fallback, request FROM interaction");
    expect(ix).toEqual([expect.objectContaining({ channel: "google.places", kind: "place.lookup", outcome: "ok", fallback: "google" })]);
    expect(String(ix[0]!.request)).not.toContain("Bolivar");
    const priv = await all("SELECT payload FROM interaction_private");
    expect(JSON.parse(String(priv[0]!.payload))).toEqual({ query: "Gran Hotel Bolivar" });
    expect(await personalDataInInteractions(database)).toEqual([]);
  });

  it("falls back to our place table by name when Google fails", async () => {
    setEnv({ GOOGLE_MAPS_KEY: "maps-key" });
    stubPlaces([], 500);
    const { body } = await callAs(max, "stays.search", { city: "lima", q: "Rafael Miraflores" });
    expect(body.source).toBe("places");
    expect(body.results[0]).toMatchObject({ name: "Rafael", place: "rafael", lat: -12.1193, lng: -77.0359, address: null });
    const ix = await all("SELECT outcome, fallback FROM interaction ORDER BY at, fallback");
    expect(ix).toEqual([
      { outcome: "error", fallback: "google" },
      { outcome: "ok", fallback: "places" },
    ]);
  });

  it("uses the place table without GOOGLE_MAPS_KEY, and answers empty when nothing matches", async () => {
    expect((await callAs(max, "stays.search", { city: "lima", q: "Maido" })).body.results[0]).toMatchObject({ place: "maido" });
    expect((await callAs(max, "stays.search", { city: "lima", q: "Hotel Zzyzx Qwerty" })).body).toEqual({ results: [], source: "none" });
  });

  it("needs a signed-in user and a known city", async () => {
    expect((await callAs(null, "stays.search", { city: "lima", q: "Maido" })).status).toBe(401);
    expect((await callAs(max, "stays.search", { city: "atlantis", q: "Maido" })).status).toBe(404);
  });
});

describe("stays.minutes", () => {
  it("estimates taxi minutes to every area without GOOGLE_MAPS_KEY", async () => {
    const { body } = await callAs(max, "stays.minutes", { city: "lima", lat: -12.1219, lng: -77.0302 });
    expect(body.estimated).toBe(true);
    expect(Object.keys(body.minutes).sort()).toEqual(["barranco", "miraflores", "san-isidro"]);
    expect(body.minutes.miraflores).toBeLessThan(body.minutes.barranco);
  });

  it("asks the Routes API with the city's departure time when given", async () => {
    setEnv({ GOOGLE_MAPS_KEY: "maps-key" });
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const b = JSON.parse(String(init.body));
        bodies.push(b);
        return Response.json(b.destinations.map((_: unknown, d: number) => ({ originIndex: 0, destinationIndex: d, duration: `${(d + 1) * 600}s`, condition: "ROUTE_EXISTS" })));
      }),
    );
    const { body } = await callAs(max, "stays.minutes", { city: "lima", lat: -12.05, lng: -77.03, date: "2030-11-20", time: "19:00" });
    expect(body).toEqual({ estimated: false, minutes: { barranco: 10, miraflores: 20, "san-isidro": 30 } });
    expect(bodies[0].departureTime).toBe("2030-11-21T00:00:00.000Z");
    expect(bodies[0].origins[0].waypoint.location.latLng).toEqual({ latitude: -12.05, longitude: -77.03 });
  });

  it("wants date and time together", async () => {
    expect((await callAs(max, "stays.minutes", { city: "lima", lat: -12.05, lng: -77.03, date: "2030-11-20" })).status).toBe(400);
  });
});
