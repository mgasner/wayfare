import { beforeEach, describe, expect, it } from "vitest";
import { agentAuth } from "../lib/agent-auth.js";
import type { FileDatabase } from "../lib/db.js";
import { Auth } from "../lib/nexus.js";
import { addUser, callAs, seededDb } from "./helpers.js";

let database: FileDatabase;
let max: Auth;
let other: Auth;
const agent = Auth.create({ kind: "indent" });
const idOf = (a: Auth) => (a.actor.kind === "person" ? a.actor.id : "");

const config = { platforms: [], messaging: [], closures: "", release_norms: "", card_notes: "" };

/** A small city of its own, so these tests don't depend on data/cities. */
async function testCity(db: FileDatabase) {
  await db.run((s) => {
    s.prepare("INSERT INTO city VALUES ('tv', 'Testville', 'PE', 'America/Lima', 'PEN', '[\"es\"]', '[0,0,1,1]', ?)").run(JSON.stringify(config));
    s.prepare("INSERT INTO area (id, city, name, brief) VALUES ('tv-north', 'tv', 'North', 'Up top'), ('tv-south', 'tv', 'South', null)").run();
    const place = s.prepare(
      "INSERT INTO place (id, city, area, name, kind, curated, channels, overture_id) VALUES (?, 'tv', ?, ?, ?, ?, ?, ?)",
    );
    place.run("tasting", "tv-north", "Tasting Room", "reserve_ahead", 1, JSON.stringify([{ type: "mesa247", host: "x.mesa247.pe", slug: "x", local_id: 1 }]), null);
    place.run("cevi", "tv-south", "Cevichería Ñaña", "walk_in", 1, JSON.stringify([{ type: "walk_in" }]), null);
    place.run("gone", "tv-south", "Gone Place", "bookable", 1, "[]", null);
    place.run("ov-1", null, "Cebichería del Barrio", null, 0, "[]", "ov-1");
    const fact = s.prepare("INSERT INTO fact (place, field, value, source, checked_at) VALUES (?, ?, ?, ?, ?)");
    fact.run("gone", "status", '"open"', "live:mesa247", "2026-01-01T00:00:00Z");
    fact.run("gone", "status", '"closed"', "research", "2026-11-01T00:00:00Z");
    fact.run("tasting", "status", '"open"', "research", new Date().toISOString());
    fact.run("tasting", "hours", JSON.stringify({ text: "Tue-Sat dinner", closed_days: [0, 1] }), "research", "2026-01-01T00:00:00Z");
  });
}

beforeEach(async () => {
  database = await seededDb();
  max = await addUser(database, "max@example.com");
  other = await addUser(database, "other@example.com");
  await testCity(database);
});

describe("cities.get", () => {
  it("returns the city and its areas, or 404", async () => {
    const res = await callAs(null, "cities.get", { id: "tv" });
    expect(res.status).toBe(200);
    expect(res.body.city).toMatchObject({ id: "tv", languages: ["es"], bbox: [0, 0, 1, 1], config });
    expect(res.body.areas.map((a: { id: string }) => a.id)).toEqual(["tv-north", "tv-south"]);
    expect(res.body.areas[0]).toMatchObject({ brief: "Up top", stops: [] });
    expect((await callAs(null, "cities.get", { id: "nowhere" })).status).toBe(404);
  });
});

describe("places.search", () => {
  it("lists curated, not-closed places, reserve-ahead first", async () => {
    const { body } = await callAs(null, "places.search", { city: "tv" });
    expect(body.map((p: { id: string }) => p.id)).toEqual(["tasting", "cevi"]);
    expect(body[0]).toMatchObject({ curated: true, saved: false, slots: [], channels: [{ type: "mesa247" }] });
    expect(body[0].facts.hours.value).toEqual({ text: "Tue-Sat dinner", closed_days: [0, 1] });
  });

  it("filters by kind and area", async () => {
    const kinds = await callAs(null, "places.search", { city: "tv", kinds: ["walk_in", "informal"] });
    expect(kinds.body.map((p: { id: string }) => p.id)).toEqual(["cevi"]);
    const area = await callAs(null, "places.search", { city: "tv", area: "tv-north" });
    expect(area.body.map((p: { id: string }) => p.id)).toEqual(["tasting"]);
  });

  it("matches names ignoring case and accents, including Overture rows", async () => {
    const { body } = await callAs(null, "places.search", { city: "tv", q: "CEBICHERIA" });
    expect(body.map((p: { id: string }) => p.id)).toEqual(["ov-1"]);
    const nana = await callAs(null, "places.search", { city: "tv", q: "nana" });
    expect(nana.body.map((p: { id: string }) => p.id)).toEqual(["cevi"]);
    const pct = await callAs(null, "places.search", { city: "tv", q: "%" });
    expect(pct.body).toEqual([]);
  });

  it("hides a place the viewer reported closed, from them only", async () => {
    await database.run((s) =>
      s.prepare("INSERT INTO fact VALUES ('cevi', 'status', '\"closed\"', ?, ?)").run(`user:${idOf(max)}`, new Date().toISOString()),
    );
    expect((await callAs(max, "places.search", { city: "tv" })).body.map((p: { id: string }) => p.id)).toEqual(["tasting"]);
    expect((await callAs(other, "places.search", { city: "tv" })).body.map((p: { id: string }) => p.id)).toEqual(["tasting", "cevi"]);
  });

  it("adds slots for the trip's party and dates, and needs the trip to be the viewer's", async () => {
    const trip = (
      await callAs(max, "trips.create", { city: "tv", start_date: "2026-11-20", end_date: "2026-11-22", party: 2, base: { name: "H", lat: 0, lng: 0 } })
    ).body;
    await database.run((s) => {
      const read = s.prepare("INSERT INTO slot_read VALUES ('tasting', ?, ?, '', ?, '[]', '2026-11-19T00:00:00Z', 'ix')");
      read.run("2026-11-21", 2, '["20:00"]');
      read.run("2026-11-22", 2, '["21:00"]');
      read.run("2026-11-21", 4, '["19:00"]');
      read.run("2026-11-25", 2, '["19:00"]');
    });
    const all = (await callAs(max, "places.search", { city: "tv", trip: trip.id })).body[0];
    expect(all.slots.map((r: { date: string }) => r.date)).toEqual(["2026-11-21", "2026-11-22"]);
    const day = (await callAs(max, "places.search", { city: "tv", trip: trip.id, date: "2026-11-21" })).body[0];
    expect(day.slots).toMatchObject([{ date: "2026-11-21", party: 2, times: ["20:00"] }]);
    expect((await callAs(other, "places.search", { city: "tv", trip: trip.id })).status).toBe(404);
    expect((await callAs(null, "places.search", { city: "tv", trip: trip.id })).status).toBe(401);
  });

  it("caps results at limit", async () => {
    expect((await callAs(null, "places.search", { city: "tv", limit: 1 })).body).toHaveLength(1);
    expect((await callAs(null, "places.search", { city: "tv", limit: 0 })).status).toBe(400);
  });
});

describe("places.get", () => {
  it("returns one card, closed ones included, or 404", async () => {
    expect((await callAs(null, "places.get", { id: "tasting" })).body).toMatchObject({ id: "tasting", name: "Tasting Room" });
    expect((await callAs(null, "places.get", { id: "gone" })).body.facts.status.value).toBe("closed");
    expect((await callAs(null, "places.get", { id: "nope" })).status).toBe(404);
  });
});

describe("agent API", () => {
  it("only serves Indent agents", async () => {
    expect((await callAs(null, "agent.listStale", { city: "tv" })).status).toBe(401);
    expect((await callAs(max, "agent.listStale", { city: "tv" })).status).toBe(403);
    expect((await callAs(agent, "agent.listStale", { city: "tv" })).status).toBe(200);
  });

  it("turns a bearer token into the indent actor and rejects a wrong one", () => {
    const req = (h?: string) => new Request("http://x/api/agent/listStale", h ? { headers: { Authorization: h } } : {});
    expect(agentAuth(req(), "secret")).toBeNull();
    expect(agentAuth(req("Bearer secret"), "secret")?.actor).toEqual({ kind: "indent" });
    expect(() => agentAuth(req("Bearer wrong"), "secret")).toThrow(/agent token/);
    expect(() => agentAuth(req("Bearer secret"), undefined)).toThrow(/agent token/);
  });

  it("records shared facts, checking values and skipping unknown places", async () => {
    const res = await callAs(agent, "agent.recordFacts", {
      facts: [
        { place: "cevi", field: "hours", value: { text: "Lunch only", closed_days: [] }, checked_at: "2026-11-13T00:00:00Z" },
        { place: "cevi", field: "status", value: "open" },
        { place: "nope", field: "status", value: "open" },
      ],
    });
    expect(res.body).toEqual({ written: 2, unchanged: 0, unknown_places: ["nope"] });
    const again = await callAs(agent, "agent.recordFacts", {
      facts: [{ place: "cevi", field: "hours", value: { text: "Lunch only" }, checked_at: "2026-11-13T00:00:00Z" }],
    });
    expect(again.body).toEqual({ written: 0, unchanged: 1, unknown_places: [] });
    const card = (await callAs(null, "places.get", { id: "cevi" })).body;
    expect(card.facts.hours).toEqual({ value: { text: "Lunch only", closed_days: [] }, source: "research", checked_at: "2026-11-13T00:00:00Z" });

    const bad = await callAs(agent, "agent.recordFacts", { facts: [{ place: "cevi", field: "status", value: "maybe" }] });
    expect(bad.status).toBe(400);
    const userSource = await callAs(agent, "agent.recordFacts", { facts: [{ place: "cevi", field: "status", value: "open", source: "user:x" }] });
    expect(userSource.status).toBe(400);
  });

  it("lists curated open places with missing or old facts, trip places first", async () => {
    const res = await callAs(agent, "agent.listStale", { city: "tv", fields: ["status", "hours"] });
    expect(res.body.places).toEqual([
      { id: "cevi", name: "Cevichería Ñaña", kind: "walk_in", area: "tv-south", on_trip: false, stale: [{ field: "status", checked_at: null }, { field: "hours", checked_at: null }] },
      { id: "tasting", name: "Tasting Room", kind: "reserve_ahead", area: "tv-north", on_trip: false, stale: [{ field: "hours", checked_at: "2026-01-01T00:00:00Z" }] },
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const trip = (await callAs(max, "trips.create", { city: "tv", start_date: today, end_date: today, party: 2, base: { name: "H", lat: 0, lng: 0 } })).body;
    await callAs(max, "meals.set", { trip: trip.id, place: "tasting", date: today, slot: "dinner", status: "want" });
    const onTrip = await callAs(agent, "agent.listStale", { city: "tv", fields: ["status", "hours"], only_on_trip: true });
    expect(onTrip.body.places.map((p: { id: string; on_trip: boolean }) => [p.id, p.on_trip])).toEqual([["tasting", true]]);
    const strict = await callAs(agent, "agent.listStale", { city: "tv", fields: ["status"], older_than_days: 0 });
    expect(strict.body.places.map((p: { id: string }) => p.id)).toEqual(["tasting", "cevi"]);
  });

  it("expires named facts and old user facts, never research by age", async () => {
    await database.run((s) => {
      const fact = s.prepare("INSERT INTO fact VALUES (?, ?, ?, ?, ?)");
      fact.run("cevi", "hours", '{"text":"old"}', "user:u1", "2026-01-01T00:00:00Z");
      fact.run("cevi", "hours", '{"text":"new"}', "user:u2", "2026-11-12T00:00:00Z");
    });
    const res = await callAs(agent, "agent.expireFacts", {
      facts: [{ place: "tasting", field: "hours", source: "research" }],
      user_facts_before: "2026-06-01T00:00:00Z",
    });
    expect(res.body).toEqual({ deleted: 2 });
    const left = await database.run((s) => s.prepare("SELECT place, field, source FROM fact WHERE place IN ('cevi', 'tasting') ORDER BY place, field").all());
    expect(left).toEqual([
      { place: "cevi", field: "hours", source: "user:u2" },
      { place: "tasting", field: "status", source: "research" },
    ]);
    expect((await callAs(agent, "agent.expireFacts", {})).status).toBe(400);
  });
});
