import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDatabase } from "../lib/db.js";
import { setEnv } from "../lib/env.js";
import type { Auth } from "../lib/nexus.js";
import { estimateMinutes, haversineKm } from "../server/adapters/routes.js";
import { wallClock, zonedInstant } from "../server/time.js";
import { addPlaces, createTrip, limaTrip, stubModel } from "./fixtures.js";
import { addUser, callAs, personalDataInInteractions, seededDb } from "./helpers.js";

let database: FileDatabase;
let max: Auth;
let other: Auth;
let trip: string;
const all = (q: string) => database.run((s) => s.prepare(q).all());
const LIM = { lat: -12.0219, lng: -77.1143 };

beforeEach(async () => {
  setEnv({});
  database = await seededDb();
  max = await addUser(database, "max@example.com");
  other = await addUser(database, "other@example.com");
  await addPlaces(database);
  trip = (await createTrip(max)).id;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => setEnv(undefined));

const add = (input: Record<string, unknown>, as = max) => callAs(as, "anchors.add", { trip, ...input });

describe("anchors", () => {
  it("adds, lists and removes", async () => {
    const a = await add({ date: "2026-11-20", start_time: "10:00", end_time: "18:00", area: "barranco", text: "Barranco" });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ trip, source: "hint", place: null, lat: null, calendar_event: null });
    await add({ date: "2026-11-19", area: "miraflores" });
    const listed = await callAs(max, "anchors.list", { trip });
    expect(listed.body.map((x: { date: string }) => x.date)).toEqual(["2026-11-19", "2026-11-20"]);
    expect((await callAs(other, "anchors.list", { trip })).body).toEqual([]);

    await callAs(other, "anchors.remove", { id: a.body.id });
    expect((await callAs(max, "anchors.list", { trip })).body).toHaveLength(2);
    await callAs(max, "anchors.remove", { id: a.body.id });
    expect((await callAs(max, "anchors.list", { trip })).body).toHaveLength(1);
  });

  it("rejects dates outside the trip, unknown areas, reversed times and other people's trips", async () => {
    expect((await add({ date: "2026-12-01" })).status).toBe(400);
    expect((await add({ date: "2026-11-20", area: "atlantis" })).status).toBe(400);
    expect((await add({ date: "2026-11-20", start_time: "18:00", end_time: "10:00" })).status).toBe(400);
    expect((await add({ date: "2026-11-20", lat: -12.1 })).status).toBe(400);
    expect((await add({ date: "2026-11-20" }, other)).status).toBe(404);
  });
});

describe("anchors.whereAt", () => {
  const at = (date: string, time: string) => callAs(max, "anchors.whereAt", { trip, date, time }).then((r) => r.body);

  it("covering anchor, else the nearest earlier that day, else the base", async () => {
    const barranco = (await add({ date: "2026-11-20", start_time: "10:00", end_time: "18:00", area: "barranco" })).body;
    const museum = (await add({ date: "2026-11-20", start_time: "12:00", end_time: "13:00", lat: -12.0864, lng: -77.0711, text: "Museo Larco" })).body;
    const rafael = (await add({ date: "2026-11-21", start_time: "15:00", place: "rafael" })).body;

    expect(await at("2026-11-20", "09:00")).toEqual({ lat: limaTrip.base.lat, lng: limaTrip.base.lng, label: limaTrip.base.name, anchor: null });
    expect(await at("2026-11-20", "10:30")).toMatchObject({ label: "Barranco", anchor: barranco.id, lat: -12.1491 });
    expect(await at("2026-11-20", "12:30")).toMatchObject({ label: "Museo Larco", anchor: museum.id, lat: -12.0864 });
    expect(await at("2026-11-20", "21:00")).toMatchObject({ label: "Barranco", anchor: barranco.id });
    expect(await at("2026-11-21", "14:00")).toMatchObject({ anchor: null });
    expect(await at("2026-11-21", "19:00")).toMatchObject({ label: "Rafael", anchor: rafael.id, lat: -12.1193 });
    expect(await at("2026-11-22", "12:00")).toMatchObject({ anchor: null });
  });

  it("treats an anchor with no times as the whole day", async () => {
    const day = (await add({ date: "2026-11-22", area: "san-isidro" })).body;
    expect(await at("2026-11-22", "00:00")).toMatchObject({ anchor: day.id });
    expect(await at("2026-11-22", "23:30")).toMatchObject({ anchor: day.id });
  });
});

function stubRoutes(minutes: (o: number, d: number) => number | null, status = 200) {
  const bodies: any[] = [];
  const headers: Headers[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix");
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      headers.push(new Headers(init.headers));
      if (status !== 200) return new Response("denied", { status });
      return Response.json(
        body.origins.flatMap((_: unknown, o: number) =>
          body.destinations.map((_: unknown, d: number) => {
            const m = minutes(o, d);
            return m === null
              ? { originIndex: o, destinationIndex: d, condition: "ROUTE_NOT_FOUND" }
              : { originIndex: o, destinationIndex: d, duration: `${m * 60}s`, condition: "ROUTE_EXISTS" };
          }),
        ),
      );
    }),
  );
  return { bodies, headers };
}

describe("travel.minutes", () => {
  const ask = (input: Record<string, unknown>) =>
    callAs(max, "travel.minutes", { trip, date: "2026-11-20", time: "13:00", ...input }).then((r) => r.body);

  it("estimates from distance without GOOGLE_MAPS_KEY, from the Friday anchor", async () => {
    stubModel([{ type: "add_anchor", date: "2026-11-20", start_time: "10:00", end_time: "18:00", area: "barranco", place: null, text: "x" }]);
    setEnv({ AI_GATEWAY_API_KEY: "k" });
    await callAs(max, "input.interpret", { text: "el viernes estamos en Barranco, ten to six", context: { screen: "anchors", trip } });
    vi.unstubAllGlobals();

    const r = await ask({ places: ["central", "maido", "nowhere"] });
    expect(r.from).toMatchObject({ label: "Barranco" });
    expect(r.estimated).toBe(true);
    expect(r.minutes.nowhere).toBeNull();
    expect(r.minutes.central).toBeLessThan(r.minutes.maido);
    expect(r.minutes.central).toBeLessThanOrEqual(5);
    const ix = await all("SELECT channel, kind, outcome, fallback, request FROM interaction WHERE kind = 'route.matrix'");
    expect(ix).toEqual([expect.objectContaining({ channel: "google.routes", outcome: "ok", fallback: "estimate" })]);
    expect(JSON.parse(String(ix[0]!.request))).toMatchObject({ city: "lima", origins: 1, destinations: 2 });
  });

  it("uses the Routes API when GOOGLE_MAPS_KEY is set", async () => {
    setEnv({ GOOGLE_MAPS_KEY: "maps-key" });
    const { bodies, headers } = stubRoutes((_, d) => [7, 25][d] ?? null);
    const r = await ask({ places: ["central", "maido"] });
    expect(r).toMatchObject({ estimated: false, minutes: { central: 7, maido: 25 }, from: { anchor: null, label: limaTrip.base.name } });
    expect(headers[0]!.get("x-goog-api-key")).toBe("maps-key");
    expect(headers[0]!.get("x-goog-fieldmask")).toContain("duration");
    expect(bodies[0].origins[0].waypoint.location.latLng).toEqual({ latitude: limaTrip.base.lat, longitude: limaTrip.base.lng });
    expect(bodies[0].travelMode).toBe("DRIVE");
    expect(await personalDataInInteractions(database)).toEqual([]);
  });

  it("starts from a place instead of the anchors when given one", async () => {
    setEnv({ GOOGLE_MAPS_KEY: "maps-key" });
    const { bodies } = stubRoutes(() => 9);
    const r = await ask({ places: ["maido"], from: { place: "rafael" } });
    expect(r).toMatchObject({ estimated: false, minutes: { maido: 9 }, from: { label: "Rafael", anchor: null, lat: -12.1193, lng: -77.0359 } });
    expect(bodies[0].origins[0].waypoint.location.latLng).toEqual({ latitude: -12.1193, longitude: -77.0359 });
  });

  it("starts from coordinates when given them", async () => {
    const r = await ask({ places: ["maido"], from: { lat: -12.1253, lng: -77.0302, label: "Lunch" } });
    expect(r).toMatchObject({ estimated: true, from: { label: "Lunch", anchor: null } });
    expect(r.minutes.maido).toBeLessThanOrEqual(4);
  });

  it("rejects an origin place that isn't in the trip's city", async () => {
    const r = await callAs(max, "travel.minutes", { trip, date: "2026-11-20", time: "13:00", places: ["maido"], from: { place: "nowhere" } });
    expect(r.status).toBe(404);
  });

  it("falls back to the estimate when the Routes API fails", async () => {
    setEnv({ GOOGLE_MAPS_KEY: "maps-key" });
    stubRoutes(() => 1, 403);
    const r = await ask({ places: ["central"] });
    expect(r.estimated).toBe(true);
    const ix = await all("SELECT outcome, fallback FROM interaction WHERE kind = 'route.matrix' ORDER BY at, fallback DESC");
    expect(ix).toEqual([
      { outcome: "error", fallback: "live" },
      { outcome: "ok", fallback: "estimate" },
    ]);
  });
});

describe("anchors.conflicts", () => {
  it("flags a dinner during an anchor more than 20 minutes away", async () => {
    const flight = (
      await add({ date: "2026-11-23", start_time: "18:00", end_time: "21:00", lat: LIM.lat, lng: LIM.lng, source: "calendar", text: "Flight LIM-SFO", calendar_event: "gcal:x:1" })
    ).body;
    await add({ date: "2026-11-20", start_time: "10:00", end_time: "18:00", area: "barranco" });
    const dinner = (await callAs(max, "meals.set", { trip, place: "central", date: "2026-11-23", slot: "dinner", time: "19:00", status: "confirmed" })).body;
    await callAs(max, "meals.set", { trip, place: "la-mar-cebicheria", date: "2026-11-23", slot: "lunch", time: "13:00", status: "want" });
    await callAs(max, "meals.set", { trip, place: "isolina", date: "2026-11-20", slot: "lunch", time: "13:00", status: "want" });

    const { body } = await callAs(max, "anchors.conflicts", { trip });
    expect(body).toEqual([{ meal: dinner.id, anchor: flight.id, minutes: expect.any(Number), estimated: true }]);
    expect(body[0].minutes).toBeGreaterThan(20);
  });

  it("uses the slot's usual time for a meal without one, and skips skipped meals", async () => {
    await add({ date: "2026-11-21", start_time: "19:00", end_time: "22:00", lat: LIM.lat, lng: LIM.lng });
    const want = (await callAs(max, "meals.set", { trip, place: "maido", date: "2026-11-21", slot: "dinner", status: "want" })).body;
    await callAs(max, "meals.set", { trip, place: "central", date: "2026-11-21", slot: "dinner", status: "skipped" });
    const { body } = await callAs(max, "anchors.conflicts", { trip });
    expect(body.map((c: { meal: string }) => c.meal)).toEqual([want.id]);
  });
});

describe("time and distance", () => {
  it("converts Lima wall-clock times", () => {
    expect(zonedInstant("2026-11-23", "21:00", "America/Lima").toISOString()).toBe("2026-11-24T02:00:00.000Z");
    expect(wallClock(new Date("2026-11-24T02:00:00Z"), "America/Lima")).toEqual({ date: "2026-11-23", time: "21:00" });
  });

  it("estimates Lima taxi minutes", () => {
    const barranco = { lat: -12.1491, lng: -77.0218 };
    expect(haversineKm(LIM, barranco)).toBeGreaterThan(15);
    expect(estimateMinutes(LIM, barranco, "lima")).toBeGreaterThan(60);
    expect(estimateMinutes(barranco, barranco, "lima")).toBe(3);
  });
});
