import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDatabase } from "../lib/db.js";
import { cronAllowed, syncAllCalendars } from "../lib/cron.js";
import { setEnv } from "../lib/env.js";
import type { Auth } from "../lib/nexus.js";
import { parseIcs, setFeedFetcher } from "../server/adapters/ics.js";
import { parseFlight } from "../server/airports.js";
import { eventAnchor } from "../server/calsync.js";
import { addPlaces, createTrip } from "./fixtures.js";
import { addUser, callAs, personalDataInInteractions, seededDb } from "./helpers.js";

let database: FileDatabase;
let max: Auth;
let trip: string;
const uid = (a: Auth) => (a.actor.kind === "person" ? a.actor.id : "");
const all = (q: string, ...p: string[]) => database.run((s) => s.prepare(q).all(...p));
const trip_ = { city: "lima", start_date: "2026-11-18", end_date: "2026-11-23" };

type GEvent = Record<string, unknown>;
const flight: GEvent = {
  id: "f1",
  summary: "Flight LIM-SFO",
  location: "",
  start: { dateTime: "2026-11-23T21:00:00-05:00" },
  end: { dateTime: "2026-11-24T05:40:00-08:00" },
};
const lunch: GEvent = {
  id: "l1",
  summary: "Lunch with Ana",
  location: "Central Restaurante, Av. Pedro de Osma 301, Barranco 15063, Peru",
  start: { dateTime: "2026-11-20T13:00:00-05:00" },
  end: { dateTime: "2026-11-20T15:00:00-05:00" },
};
const museum: GEvent = {
  id: "m1",
  summary: "Museo Larco",
  location: "Av. Simón Bolívar 1515, Pueblo Libre 15084",
  start: { dateTime: "2026-11-19T10:00:00-05:00" },
  end: { dateTime: "2026-11-19T12:30:00-05:00" },
};
const allDay: GEvent = { id: "a1", summary: "Lima", location: "Lima, Peru", start: { date: "2026-11-18" }, end: { date: "2026-11-24" } };
const declined: GEvent = { ...lunch, id: "d1", attendees: [{ self: true, responseStatus: "declined" }] };

function stubGoogle(events: () => GEvent[], options: { eventsStatus?: number; ics?: string } = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url.split("?")[0]!);
      if (url === "https://oauth2.googleapis.com/token") {
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        return Response.json({ access_token: "at", expires_in: 3600 });
      }
      if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
        if (options.eventsStatus) return new Response("nope", { status: options.eventsStatus });
        expect(new URL(url).searchParams.get("timeMin")).toBe("2026-11-18T05:00:00.000Z");
        return Response.json({ items: events() });
      }
      if (url === "https://places.googleapis.com/v1/places:searchText") {
        return Response.json({ places: [{ id: "ChIJlarco", location: { latitude: -12.0721, longitude: -77.0705 } }] });
      }
      if (url.startsWith("https://cal.example.com/")) {
        return options.ics ? new Response(options.ics, { headers: { "Content-Type": "text/calendar" } }) : new Response("<html>", { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return calls;
}

async function linkGoogle(credentials: unknown = { refresh_token: "rt", scope: "calendar.readonly", sub: "1" }) {
  await database.run((s) =>
    s.prepare("INSERT INTO calendar_link (owner, provider, ref, credentials) VALUES (?, 'google', ?, ?)").run(uid(max), "max@example.com", JSON.stringify(credentials)),
  );
}

beforeEach(async () => {
  setEnv({ GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret" });
  // The stubbed global fetch stands in for the host's guarded fetcher (test/ics-ssrf.test.ts).
  setFeedFetcher(async (url, { signal, accept }) => {
    const res = await fetch(url, { signal, headers: { Accept: accept } });
    return { status: res.status, body: await res.text() };
  });
  database = await seededDb();
  max = await addUser(database, "max@example.com");
  await addPlaces(database);
  trip = (await createTrip(max)).id;
});
afterEach(() => {
  vi.unstubAllGlobals();
  setFeedFetcher(null);
});
afterAll(() => setEnv(undefined));

describe("Google Calendar sync", () => {
  it("turns located events and flights into calendar anchors, and the flight conflicts with dinner", async () => {
    await linkGoogle();
    setEnv({ GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_MAPS_KEY: "k" });
    stubGoogle(() => [flight, lunch, museum, allDay, declined]);
    const res = await callAs(max, "calendar.sync", { trip });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      links: [{ provider: "google", ref: "max@example.com", ok: true, events: 4, error: null }],
      created: 3,
      updated: 0,
      deleted: 0,
    });
    const anchors = (await callAs(max, "anchors.list", { trip })).body;
    expect(anchors).toEqual([
      expect.objectContaining({ date: "2026-11-19", start_time: "10:00", end_time: "12:30", lat: -12.0721, place: null, source: "calendar" }),
      expect.objectContaining({ date: "2026-11-20", start_time: "13:00", end_time: "15:00", place: "central", area: "barranco", lat: -12.1497 }),
      expect.objectContaining({ date: "2026-11-23", start_time: "18:00", end_time: "21:00", lat: -12.0219, lng: -77.1143, text: "Flight LIM-SFO · Jorge Chávez Airport (LIM)" }),
    ]);
    expect(anchors[2].calendar_event).toMatch(/^g[0-9a-f]{8}:f1$/);

    const dinner = (await callAs(max, "meals.set", { trip, place: "central", date: "2026-11-23", slot: "dinner", time: "19:00", status: "confirmed" })).body;
    const conflicts = (await callAs(max, "anchors.conflicts", { trip })).body;
    expect(conflicts).toEqual([expect.objectContaining({ meal: dinner.id, anchor: anchors[2].id })]);
    expect(conflicts[0].minutes).toBeGreaterThan(20);

    expect(await personalDataInInteractions(database)).toEqual([]);
    const requests = (await all("SELECT request FROM interaction")).map((r) => String(r.request));
    expect(requests.join(" ")).not.toMatch(/Ana|Larco|Bolívar|Flight/);
    expect((await all("SELECT last_sync FROM calendar_link"))[0]!.last_sync).toBeTruthy();
  });

  it("leaves unchanged anchors alone, updates moved ones, deletes removed ones, and skips fresh links", async () => {
    await linkGoogle();
    let events = [flight, lunch];
    stubGoogle(() => events);
    await callAs(max, "calendar.sync", { trip });
    const before = (await callAs(max, "anchors.list", { trip })).body;

    expect((await callAs(max, "calendar.sync", { trip })).body).toMatchObject({ links: [], created: 0 });
    expect((await callAs(max, "calendar.sync", { trip, force: true })).body).toMatchObject({ created: 0, updated: 0, deleted: 0 });

    events = [{ ...lunch, start: { dateTime: "2026-11-20T14:00:00-05:00" } }];
    expect((await callAs(max, "calendar.sync", { trip, force: true })).body).toMatchObject({ created: 0, updated: 1, deleted: 1 });
    const after = (await callAs(max, "anchors.list", { trip })).body;
    expect(after).toEqual([expect.objectContaining({ id: before[0].id, start_time: "14:00", place: "central" })]);
  });

  it("keeps anchors when Google fails, and reports a missing refresh token", async () => {
    await linkGoogle();
    stubGoogle(() => [lunch]);
    await callAs(max, "calendar.sync", { trip });
    stubGoogle(() => [], { eventsStatus: 500 });
    const res = (await callAs(max, "calendar.sync", { trip, force: true })).body;
    expect(res.links[0]).toMatchObject({ ok: false });
    expect((await callAs(max, "anchors.list", { trip })).body).toHaveLength(1);

    await database.run((s) => s.prepare("UPDATE calendar_link SET credentials = ?").run(JSON.stringify({ refresh_token: null })));
    const missing = (await callAs(max, "calendar.sync", { trip, force: true })).body;
    expect(missing.links[0]).toMatchObject({ ok: false, error: expect.stringContaining("sign in again") });
  });

  it("runs from the cron for every owner with a link and an upcoming trip", async () => {
    await linkGoogle();
    stubGoogle(() => [lunch]);
    const out = await syncAllCalendars();
    expect(out).toMatchObject({ owners: 1, failed: 0 });
    expect(out.results[0]!.created).toBe(1);
    const ok = new Request("http://x/api/cron/calendar", { headers: { Authorization: "Bearer s3cret" } });
    expect(cronAllowed(ok, { CRON_SECRET: "s3cret" })).toBe(true);
    expect(cronAllowed(new Request("http://x"), { CRON_SECRET: "s3cret" })).toBe(false);
    expect(cronAllowed(new Request("http://x"), {})).toBe(false);
  });
});

const ics = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:abc@example.com",
  "SUMMARY:Pisco tasting\\, with friends",
  "LOCATION:Isolina\\, Av. San Martín 101\\, Barranco",
  "DTSTART;TZID=America/Lima:20261121T170000",
  "DTEND;TZID=America/Lima:20261121T183000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:flight@example.com",
  "SUMMARY:Flight to San Francisco (LA 2470)",
  "LOCATION:Lima LIM",
  "DTSTART:20261124T020000Z",
  "DTEND:20261124T134000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:gone@example.com",
  "STATUS:CANCELLED",
  "SUMMARY:Cancelled",
  "LOCATION:Miraflores",
  "DTSTART:20261120T150000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:windows@example.com",
  "SUMMARY:Long description that is fol",
  " ded across lines",
  "LOCATION:Parque Kennedy\\, Miraflores",
  "DTSTART;TZID=SA Pacific Standard Time:20261122T100000",
  "DTEND;TZID=SA Pacific Standard Time:20261122T110000",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("ICS feeds", () => {
  it("parses folded lines, escapes, zones and cancellations", () => {
    const events = parseIcs(ics, "America/Lima");
    expect(events.map((e) => e.id)).toEqual(["abc@example.com", "flight@example.com", "windows@example.com"]);
    expect(events[0]).toMatchObject({ summary: "Pisco tasting, with friends", location: "Isolina, Av. San Martín 101, Barranco" });
    expect(events[0]!.start).toEqual({ instant: new Date("2026-11-21T22:00:00Z") });
    expect(events[2]).toMatchObject({ summary: "Long description that is folded across lines", start: { instant: new Date("2026-11-22T15:00:00Z") } });
    expect(parseIcs("BEGIN:VEVENT\nUID:x\nDTSTART;VALUE=DATE:20261120\nEND:VEVENT", "UTC")[0]!.start).toEqual({ date: "2026-11-20" });
  });

  it("adds a webcal feed, syncs it, and removes it with its anchors", async () => {
    stubGoogle(() => [], { ics });
    const res = await callAs(max, "calendar.addIcs", { url: "webcal://cal.example.com/feed.ics" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ links: [{ provider: "ics", ref: "https://cal.example.com/feed.ics", ok: true, events: 3 }], created: 3 });
    const anchors = (await callAs(max, "anchors.list", { trip })).body;
    expect(anchors.map((a: { date: string; start_time: string; place: string | null; area: string | null }) => [a.date, a.start_time, a.place, a.area])).toEqual([
      ["2026-11-21", "17:00", "isolina", "barranco"],
      ["2026-11-22", "10:00", null, "miraflores"],
      ["2026-11-23", "18:00", null, null],
    ]);
    expect((await callAs(max, "calendar.links", {})).body).toEqual([{ provider: "ics", ref: "https://cal.example.com/feed.ics", last_sync: expect.any(String) }]);

    await callAs(max, "calendar.removeIcs", { url: "webcal://cal.example.com/feed.ics" });
    expect((await callAs(max, "anchors.list", { trip })).body).toEqual([]);
    expect((await callAs(max, "calendar.links", {})).body).toEqual([]);
  });

  it("rejects feeds that aren't iCalendar, and URLs that aren't public https", async () => {
    stubGoogle(() => []);
    const bad = await callAs(max, "calendar.addIcs", { url: "https://cal.example.com/not-a-feed" });
    expect(bad.status).toBe(400);
    expect((await callAs(max, "calendar.links", {})).body).toEqual([]);
    expect((await callAs(max, "calendar.addIcs", { url: "http://cal.example.com/a.ics" })).status).toBe(400);
    expect((await callAs(max, "calendar.addIcs", { url: "https://169.254.169.254/latest" })).status).toBe(400);
  });
});

describe("events to anchors", () => {
  const at = (iso: string) => ({ instant: new Date(iso) });
  it("puts departures at the airport before take-off and arrivals after landing", () => {
    expect(eventAnchor({ id: "1", summary: "Flight LIM-SFO", location: "", start: at("2026-11-24T02:00:00Z"), end: null }, trip_, "America/Lima")).toMatchObject({
      date: "2026-11-23",
      start_time: "18:00",
      end_time: "21:00",
    });
    expect(eventAnchor({ id: "2", summary: "Vuelo CUZ → LIM", location: "", start: at("2026-11-20T14:00:00Z"), end: at("2026-11-20T15:20:00Z") }, trip_, "America/Lima")).toMatchObject({
      date: "2026-11-20",
      start_time: "10:20",
      end_time: "11:20",
    });
    expect(eventAnchor({ id: "3", summary: "Flight LIM-CUZ", location: "", start: at("2026-11-21T13:00:00Z"), end: null }, trip_, "America/Lima")).toMatchObject({
      start_time: "06:00",
      end_time: "08:00",
    });
  });

  it("skips all-day, long and unlocated events", () => {
    expect(eventAnchor({ id: "1", summary: "Lima", location: "Lima", start: { date: "2026-11-20" }, end: null }, trip_, "America/Lima")).toBeNull();
    expect(eventAnchor({ id: "2", summary: "Hotel", location: "Miraflores", start: at("2026-11-20T20:00:00Z"), end: at("2026-11-22T15:00:00Z") }, trip_, "America/Lima")).toBeNull();
    expect(eventAnchor({ id: "3", summary: "Call", location: "", start: at("2026-11-20T20:00:00Z"), end: null }, trip_, "America/Lima")).toBeNull();
  });

  it("recognizes flights", () => {
    expect(parseFlight("Flight LIM-SFO", "")).toEqual({ from: "LIM", to: "SFO" });
    expect(parseFlight("Flight to San Francisco (LA 2470)", "Lima LIM")).toEqual({ from: "LIM", to: null });
    expect(parseFlight("AA 918 MIA to LIM", "")).toEqual({ from: "MIA", to: "LIM" });
    expect(parseFlight("Dinner at Central", "Barranco")).toBeNull();
    expect(parseFlight("Team sync 2030 planning", "")).toBeNull();
  });
});
