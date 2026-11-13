import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileDatabase } from "../lib/db.js";
import { migrate } from "../lib/migrate.js";
import type { Auth } from "../lib/nexus.js";
import { seed } from "../lib/seed.js";
import { parse as parseMeitre, searchUrl as meitreUrl } from "../server/adapters/meitre.js";
import { parse as parseMesa, searchUrl as mesaUrl } from "../server/adapters/mesa247.js";
import { setBlockedChannels } from "../server/adapters/slots.js";
import { LIVE_READS_PER_MINUTE, slotTargets } from "../server/slots.js";
import { addUser, callAs, fixtureCities, personalDataInInteractions, root, seededDb, tempPath } from "./helpers.js";

const fixture = (name: string) => JSON.parse(readFileSync(join(root, "test/fixtures/slots", name), "utf8")) as unknown;

const mesaChannel = { type: "mesa247", host: "central.mesa247.pe", slug: "central", local_id: 11, consumption_id: 3019 } as const;
const meitreChannel = { type: "meitre", venue_id: 117 } as const;

/** Serves recorded responses by URL; anything else is a 500. Counts calls. */
function fakeFetch(routes: Record<string, unknown | (() => Response)>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const hit = routes[url];
    if (hit === undefined) return new Response("nope", { status: 500 });
    return typeof hit === "function" ? (hit as () => Response)() : Response.json(hit);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setBlockedChannels([]);
});

describe("Mesa 24/7 adapter", () => {
  it("builds the widget search URL", () => {
    expect(mesaUrl(mesaChannel, "2026-11-21", 2)).toBe(
      "https://central.mesa247.pe/reservas/_api/v2cal/search?language=es&country_code=PE&local_id=11&type_reservation=widget&paxs=2&date=2026-11-21&response=hours&from=gateway&type_consumption_id=3019",
    );
  });

  it("reads available times, then waitlist times", () => {
    expect(parseMesa(fixture("mesa-central-2026-11-21.json"))).toEqual([{ service: "", times: ["12:45", "13:00", "13:15"], waitlist: [] }]);
    expect(parseMesa(fixture("mesa-central-waitlist-synthetic.json"))).toEqual([
      { service: "", times: ["12:45", "13:00", "13:15", "13:30"], waitlist: ["19:15", "19:30", "19:45", "20:00", "20:15", "20:30"] },
    ]);
    expect(parseMesa(fixture("mesa-central-2026-11-22.json"))).toEqual([{ service: "", times: [], waitlist: [] }]);
    expect(() => parseMesa({ error: "x" })).toThrow(/no locals/);
  });
});

describe("Meitre adapter", () => {
  it("reads the center day per service, taken slots as waitlist when the list is open", () => {
    expect(meitreUrl(meitreChannel, "2026-11-21", 2, "dinner")).toBe("https://api.meitre.com/api/search-all-hours/117/2/2026-11-21/dinner/117");
    expect(parseMeitre(fixture("meitre-cosme-2026-11-21-lunch.json"), "lunch")).toEqual({
      service: "lunch",
      times: ["12:30", "13:00", "13:15", "13:30", "13:45", "14:00", "15:00"],
      waitlist: [],
    });
    expect(parseMeitre(fixture("meitre-cosme-2026-11-21-dinner.json"), "dinner")).toEqual({
      service: "dinner",
      times: [],
      waitlist: ["19:00", "19:30", "19:45", "20:00", "20:30", "20:45", "21:00"],
    });
  });
});

describe("places.refreshSlots", () => {
  let database: FileDatabase;
  let max: Auth;
  beforeEach(async () => {
    database = await seededDb();
    max = await addUser(database, "max@example.com");
    await database.run((s) => {
      const place = s.prepare("INSERT INTO place (id, city, name, kind, curated, channels) VALUES (?, 'lima', ?, 'reserve_ahead', 1, ?)");
      place.run("mesa-place", "Mesa Place", JSON.stringify([mesaChannel]));
      place.run("meitre-place", "Meitre Place", JSON.stringify([meitreChannel, { type: "web", url: "https://cosme.meitre.com/" }]));
    });
  });

  const interactions = () =>
    database.run((s) => s.prepare("SELECT id, parent, owner, place, channel, kind, outcome, fallback, request FROM interaction ORDER BY at, rowid").all());

  it("reads Mesa live, stores the reads and logs one interaction per date", async () => {
    const calls = fakeFetch({
      [mesaUrl(mesaChannel, "2026-11-21", 2)]: fixture("mesa-central-2026-11-21.json"),
      [mesaUrl(mesaChannel, "2026-11-22", 2)]: fixture("mesa-central-2026-11-22.json"),
    });
    const res = await callAs(max, "places.refreshSlots", { place: "mesa-place", dates: ["2026-11-21", "2026-11-22"], party: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject([
      { place: "mesa-place", date: "2026-11-21", party: 2, service: "", times: ["12:45", "13:00", "13:15"], waitlist: [] },
      { date: "2026-11-22", times: [], waitlist: [] },
    ]);
    expect(calls[0]!.headers.referer).toBe("https://central.mesa247.pe/reservas/central");
    const log = await interactions();
    expect(log).toHaveLength(2);
    expect(log.every((r) => r.outcome === "ok" && r.fallback === "live" && r.channel === "mesa247" && r.kind === "slots.read")).toBe(true);
    expect(JSON.parse(String(log[0]!.request))).toMatchObject({ host: "central.mesa247.pe", local_id: 11, party: 2 });
    expect(await personalDataInInteractions(database)).toEqual([]);
    const stored = await database.run((s) => s.prepare("SELECT date, times, interaction FROM slot_read ORDER BY date").all());
    expect(stored.map((r) => r.interaction).sort()).toEqual(log.map((r) => r.id).sort());

    // A second tap within a minute doesn't call Mesa again.
    await callAs(max, "places.refreshSlots", { place: "mesa-place", dates: ["2026-11-21"], party: 2 });
    expect(calls).toHaveLength(2);
  });

  it("caps live reads per person per minute, then answers from the last good read", async () => {
    const dates = Array.from({ length: 70 }, (_, i) => new Date(Date.UTC(2026, 11, 1 + i)).toISOString().slice(0, 10));
    const calls = fakeFetch(Object.fromEntries(dates.map((d) => [mesaUrl(mesaChannel, d, 2), fixture("mesa-central-2026-11-21.json")])));
    for (let i = 0; i < 70; i += 14) {
      expect((await callAs(max, "places.refreshSlots", { place: "mesa-place", dates: dates.slice(i, i + 14), party: 2 })).status).toBe(200);
    }
    expect(calls).toHaveLength(LIVE_READS_PER_MINUTE);
    const over = await database.run((s) => s.prepare("SELECT count(*) AS n FROM interaction WHERE fallback = 'live' AND outcome = 'blocked'").get());
    expect(over).toEqual({ n: 70 - LIVE_READS_PER_MINUTE });
    const other = await addUser(database, "other@example.com");
    await callAs(other, "places.refreshSlots", { place: "mesa-place", dates: ["2027-03-01"], party: 2 });
    expect(calls).toHaveLength(LIVE_READS_PER_MINUTE + 1);
  });

  it("falls back to the last good read when Mesa is blocked, with its old checked_at", async () => {
    await database.run((s) =>
      s.prepare("INSERT INTO slot_read VALUES ('mesa-place', '2026-11-21', 2, '', '[\"20:00\"]', '[]', '2026-11-01T10:00:00Z', 'ix-old')").run(),
    );
    setBlockedChannels(["mesa247"]);
    const calls = fakeFetch({});
    const res = await callAs(max, "places.refreshSlots", { place: "mesa-place", dates: ["2026-11-21", "2026-11-23"], party: 2 });
    expect(calls).toHaveLength(0);
    expect(res.body).toEqual([
      { place: "mesa-place", date: "2026-11-21", party: 2, service: "", times: ["20:00"], waitlist: [], checked_at: "2026-11-01T10:00:00Z", interaction: "ix-old" },
    ]);
    const log = await interactions();
    const byFallback = (step: string) => log.filter((r) => r.fallback === step).map((r) => r.outcome);
    expect(byFallback("live")).toEqual(["blocked", "blocked"]);
    expect(byFallback("last_good").sort()).toEqual(["empty", "ok"]);
    expect(byFallback("unknown")).toEqual(["ok"]);
    expect(log.filter((r) => r.parent === null)).toHaveLength(2);
    expect(await personalDataInInteractions(database)).toEqual([]);
  });

  it("logs an upstream error and falls through", async () => {
    fakeFetch({});
    const res = await callAs(max, "places.refreshSlots", { place: "mesa-place", dates: ["2026-11-21"], party: 2 });
    expect(res.body).toEqual([]);
    const log = await interactions();
    expect(log.map((r) => [r.fallback, r.outcome])).toEqual([
      ["live", "error"],
      ["last_good", "empty"],
      ["unknown", "ok"],
    ]);
  });

  it("reads Meitre per service", async () => {
    fakeFetch({
      [meitreUrl(meitreChannel, "2026-11-21", 2, "lunch")]: fixture("meitre-cosme-2026-11-21-lunch.json"),
      [meitreUrl(meitreChannel, "2026-11-21", 2, "dinner")]: fixture("meitre-cosme-2026-11-21-dinner.json"),
    });
    const res = await callAs(max, "places.refreshSlots", { place: "meitre-place", dates: ["2026-11-21"], party: 2 });
    expect(res.body.map((r: { service: string; times: string[]; waitlist: string[] }) => [r.service, r.times.length, r.waitlist.length])).toEqual([
      ["lunch", 7, 0],
      ["dinner", 0, 7],
    ]);
  });

  it("needs a signed-in caller and a known place; places without a readable channel return stored reads only", async () => {
    expect((await callAs(null, "places.refreshSlots", { place: "mesa-place", dates: ["2026-11-21"], party: 2 })).status).toBe(401);
    expect((await callAs(max, "places.refreshSlots", { place: "nope", dates: ["2026-11-21"], party: 2 })).status).toBe(404);
    const calls = fakeFetch({});
    expect((await callAs(max, "places.refreshSlots", { place: "central", dates: ["2026-11-21"], party: 2 })).body).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("slot refresh targets and cron", () => {
  async function tripWithPlaces(database: FileDatabase, owner: string) {
    await database.run((s) => {
      s.prepare("INSERT INTO place (id, city, name, kind, curated, channels) VALUES ('mesa-place', 'lima', 'Mesa Place', 'bookable', 1, ?)").run(
        JSON.stringify([mesaChannel]),
      );
      s.prepare(
        "INSERT INTO trip (id, owner, city, start_date, end_date, party, base, created_at) VALUES ('t1', ?, 'lima', '2026-11-20', '2026-11-23', 2, '{}', 'x')",
      ).run(owner);
      s.prepare("INSERT INTO trip (id, owner, city, start_date, end_date, party, base, created_at) VALUES ('t2', ?, 'lima', '2027-03-01', '2027-03-03', 4, '{}', 'x')").run(owner);
      s.prepare("INSERT INTO meal (id, trip, place, date, slot, status, updated_at) VALUES ('m1', 't1', 'mesa-place', '2026-11-21', 'dinner', 'want', 'x')").run();
      s.prepare("INSERT INTO save (owner, place, created_at) VALUES (?, 'central', 'x'), (?, 'mesa-place', 'x')").run(owner, owner);
    });
  }

  it("covers readable places on trips in the next 14 days, from the city's today", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-21T12:00:00Z"), toFake: ["Date"] });
    try {
      const database = await seededDb();
      const max = await addUser(database, "max@example.com");
      await tripWithPlaces(database, max.actor.kind === "person" ? max.actor.id : "");
      expect(await slotTargets(() => "2026-11-21")).toEqual([{ place: "mesa-place", party: 2, dates: ["2026-11-21", "2026-11-22", "2026-11-23"] }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("api/cron/slots needs CRON_SECRET and refreshes the targets", async () => {
    const path = tempPath();
    const database = new FileDatabase(path);
    await migrate(database, join(root, "db/migrations"));
    await seed(database, fixtureCities);
    const max = await addUser(database, "max@example.com");
    await tripWithPlaces(database, max.actor.kind === "person" ? max.actor.id : "");
    database.close();
    vi.stubEnv("WAYFARE_ENV", "local");
    vi.stubEnv("DB_FILE", path);
    vi.stubEnv("CRON_SECRET", "s3cret");
    const { GET, localDate } = await import("../api/cron/slots.js");
    expect(localDate("America/Lima", new Date("2026-11-21T03:00:00Z"))).toBe("2026-11-20");
    expect((await GET(new Request("http://localhost/api/cron/slots"))).status).toBe(401);
    const routes: Record<string, unknown> = {};
    for (let d = 0; d < 14; d++) {
      const date = new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
      routes[mesaUrl(mesaChannel, date, 2)] = fixture("mesa-central-2026-11-21.json");
    }
    fakeFetch(routes);
    const res = await GET(new Request("http://localhost/api/cron/slots", { headers: { Authorization: "Bearer s3cret" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ places: expect.any(Number) });
  });
});
