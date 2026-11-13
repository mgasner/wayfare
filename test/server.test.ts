import { beforeEach, describe, expect, it } from "vitest";
import type { FileDatabase } from "../lib/db.js";
import type { Auth } from "../lib/nexus.js";
import { addUser, callAs, seededDb } from "./helpers.js";

let database: FileDatabase;
let max: Auth;
let other: Auth;

const trip = {
  city: "lima",
  start_date: "2026-11-18",
  end_date: "2026-11-23",
  party: 2,
  base: { name: "Hotel", lat: -12.12, lng: -77.03 },
};

beforeEach(async () => {
  database = await seededDb();
  max = await addUser(database, "max@example.com");
  other = await addUser(database, "other@example.com");
});

describe("me.get", () => {
  it("returns the signed-in user, or null", async () => {
    expect((await callAs(null, "me.get")).body).toBeNull();
    expect((await callAs(max, "me.get")).body).toMatchObject({ email: "max@example.com", name: "max", picture: null });
  });
});

describe("trips", () => {
  it("needs a signed-in user", async () => {
    expect((await callAs(null, "trips.list")).status).toBe(401);
  });

  it("creates, lists and gets a trip", async () => {
    const created = await callAs(max, "trips.create", trip);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ ...trip, owner: max.actor.kind === "person" && max.actor.id, refresh: "standard", appetite: null });
    expect((await callAs(max, "trips.list")).body).toHaveLength(1);
    expect((await callAs(other, "trips.list")).body).toEqual([]);

    const view = await callAs(max, "trips.get", { id: created.body.id });
    expect(view.status).toBe(200);
    expect(view.body.city.id).toBe("lima");
    expect(view.body.city.bbox).toHaveLength(4);
    expect(view.body.areas.map((a: { id: string }) => a.id)).toContain("barranco");
    expect(view.body).toMatchObject({ meals: [], anchors: [], places: [] });
  });

  it("hides other people's trips", async () => {
    const { body } = await callAs(max, "trips.create", trip);
    expect((await callAs(other, "trips.get", { id: body.id })).status).toBe(404);
    expect((await callAs(other, "trips.update", { id: body.id, party: 4 })).status).toBe(404);
  });

  it("rejects unknown cities and reversed dates", async () => {
    expect((await callAs(max, "trips.create", { ...trip, city: "atlantis" })).status).toBe(400);
    expect((await callAs(max, "trips.create", { ...trip, end_date: "2026-11-01" })).status).toBe(400);
  });

  it("updates only the fields given", async () => {
    const { body } = await callAs(max, "trips.create", { ...trip, diet: ["no shellfish"] });
    const updated = await callAs(max, "trips.update", {
      id: body.id,
      party: 3,
      budget: { per_person: 120, currency: "USD" },
    });
    expect(updated.body).toMatchObject({ party: 3, budget: { per_person: 120, currency: "USD" }, diet: ["no shellfish"] });
    expect((await callAs(max, "trips.update", { id: body.id, diet: null })).body.diet).toBeNull();
    const booking = { passport_on_file: true, credits_usd: 50, whatsapp_fallback: false };
    expect((await callAs(max, "trips.update", { id: body.id, booking })).body.booking).toEqual(booking);
    expect((await callAs(max, "trips.update", { id: body.id, booking: { ...booking, card_on_file: true } })).body.booking).toEqual(booking);
    expect((await callAs(max, "trips.update", { id: body.id, start_date: "2026-12-30" })).status).toBe(400);
  });
});

describe("meals", () => {
  it("sets, replaces and removes a meal on your own trip", async () => {
    const { body: t } = await callAs(max, "trips.create", trip);
    const meal = { trip: t.id, place: "central", date: "2026-11-20", slot: "dinner", status: "requested" };
    const created = await callAs(max, "meals.set", meal);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ ...meal, time: null, note: null });

    const replaced = await callAs(max, "meals.set", { ...meal, id: created.body.id, status: "confirmed", time: "20:00" });
    expect(replaced.body).toMatchObject({ id: created.body.id, status: "confirmed", time: "20:00" });

    const view = await callAs(max, "trips.get", { id: t.id });
    expect(view.body.meals).toHaveLength(1);
    expect(view.body.places.map((p: { id: string }) => p.id)).toEqual(["central"]);
    expect(view.body.places[0].facts.status).toMatchObject({ value: "open", source: "research" });

    expect((await callAs(max, "meals.remove", { id: created.body.id })).body).toEqual({ ok: true });
    expect((await callAs(max, "trips.get", { id: t.id })).body.meals).toEqual([]);
  });

  it("refuses other people's trips and meals, and unknown places", async () => {
    const { body: t } = await callAs(max, "trips.create", trip);
    const meal = { trip: t.id, place: "central", date: "2026-11-20", slot: "dinner", status: "want" };
    const { body: m } = await callAs(max, "meals.set", meal);
    expect((await callAs(other, "meals.set", meal)).status).toBe(404);
    expect((await callAs(max, "meals.set", { ...meal, place: "nowhere" })).status).toBe(404);

    const { body: theirs } = await callAs(other, "trips.create", trip);
    expect((await callAs(other, "meals.set", { ...meal, trip: theirs.id, id: m.id })).status).toBe(404);
    await callAs(other, "meals.remove", { id: m.id });
    expect((await callAs(max, "trips.get", { id: t.id })).body.meals).toHaveLength(1);
  });
});

describe("saves", () => {
  it("adds, lists with place cards, and removes", async () => {
    const added = await callAs(max, "saves.add", { place: "isolina", note: "friend says the lamb", source: "hint" });
    expect(added.body).toMatchObject({ place: "isolina", note: "friend says the lamb", notify_nearby: false });
    const again = await callAs(max, "saves.add", { place: "isolina" });
    expect(again.body.note).toBe("friend says the lamb");

    const list = await callAs(max, "saves.list", { city: "lima" });
    expect(list.body).toHaveLength(1);
    expect(list.body[0].place).toMatchObject({ id: "isolina", saved: true, curated: true, channels: [{ type: "walk_in" }] });
    expect((await callAs(max, "saves.list", { city: "cusco" })).body).toEqual([]);
    expect((await callAs(other, "saves.list")).body).toEqual([]);

    expect((await callAs(max, "saves.add", { place: "nowhere" })).status).toBe(404);
    await callAs(max, "saves.remove", { place: "isolina" });
    expect((await callAs(max, "saves.list")).body).toEqual([]);
  });

  it("shows a user's own facts only to them, newest per field", async () => {
    const id = max.actor.kind === "person" ? max.actor.id : "";
    await database.run((s) =>
      s
        .prepare("INSERT INTO fact (place, field, value, source, checked_at) VALUES ('la-mar-cebicheria', 'hours', ?, ?, ?)")
        .run(JSON.stringify({ "mon-sun": "12:00-16:30" }), `user:${id}`, "2026-11-20T15:02:00Z"),
    );
    await callAs(max, "saves.add", { place: "la-mar-cebicheria" });
    await callAs(other, "saves.add", { place: "la-mar-cebicheria" });
    const mine = (await callAs(max, "saves.list")).body[0].place.facts.hours;
    const theirs = (await callAs(other, "saves.list")).body[0].place.facts.hours;
    expect(mine).toMatchObject({ value: { "mon-sun": "12:00-16:30" }, source: `user:${id}` });
    expect(theirs).toMatchObject({ value: { text: "Daily 12:00-17:00", closed_days: [] }, source: "research" });
  });
});
