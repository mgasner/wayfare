import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDatabase } from "../lib/db.js";
import { setEnv } from "../lib/env.js";
import type { Auth } from "../lib/nexus.js";
import { bestMatch, nameScore } from "../server/resolve.js";
import { placeCards } from "../server/cards.js";
import { addPlaces, createTrip, stubModel } from "./fixtures.js";
import { addUser, callAs, personalDataInInteractions, seededDb } from "./helpers.js";

let database: FileDatabase;
let max: Auth;
let other: Auth;
let trip: string;
const id = (a: Auth) => (a.actor.kind === "person" ? a.actor.id : "");
const all = (q: string, ...p: (string | number | null)[]) => database.run((s) => s.prepare(q).all(...p));

beforeEach(async () => {
  setEnv({ AI_GATEWAY_API_KEY: "test-key" });
  database = await seededDb();
  max = await addUser(database, "max@example.com");
  other = await addUser(database, "other@example.com");
  await addPlaces(database);
  trip = (await createTrip(max)).id;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => setEnv(undefined));

const anchor = {
  type: "add_anchor",
  date: "2026-11-20",
  start_time: "10:00",
  end_time: "18:00",
  area: "barranco",
  place: null,
  text: "el viernes estamos en Barranco, ten to six",
};

describe("input.interpret", () => {
  it("creates an anchor and sends the model the trip's days, areas and places", async () => {
    const bodies = stubModel([anchor]);
    const res = await callAs(max, "input.interpret", { text: anchor.text, context: { screen: "anchors", trip } });
    expect(res.status).toBe(200);
    expect(res.body.changes).toEqual([
      {
        kind: "anchor",
        op: "created",
        record: expect.objectContaining({ trip, date: "2026-11-20", start_time: "10:00", end_time: "18:00", area: "barranco", source: "hint" }),
      },
    ]);
    expect(res.body.undo).toMatch(/[0-9a-f-]{36}/);

    const body = bodies[0];
    expect(body.model).toBe("anthropic/claude-sonnet-5.5");
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "apply" } });
    const user = body.messages[1].content as string;
    expect(user).toContain('{"date":"2026-11-20","weekday":"Friday"}');
    expect(user).toContain('"id":"barranco"');
    expect(user).toContain('"id":"tia-grimanesa"');
    expect(user).not.toContain("ov-grimanesa-bar");
    expect(user).toContain(anchor.text);

    const ix = await all("SELECT * FROM interaction WHERE kind = 'interpret'");
    expect(ix).toHaveLength(1);
    expect(ix[0]).toMatchObject({ channel: "gateway", outcome: "ok", cost_usd: 0.004 });
    expect(String(ix[0]!.request)).not.toMatch(/viernes|Barranco/i);
    expect(JSON.parse(String(ix[0]!.request))).toMatchObject({ city: "lima", screen: "anchors", trip, voice: false });
    const priv = await all("SELECT payload FROM interaction_private WHERE interaction = ?", ix[0]!.id as string);
    expect(String(priv[0]!.payload)).toContain("viernes");
    expect(await personalDataInInteractions(database)).toEqual([]);
    expect(await all("SELECT interaction, media, undone_at FROM input_undo")).toEqual([{ interaction: ix[0]!.id, media: null, undone_at: null }]);
  });

  it("matches a save to the curated place by a fuzzy name, with the note", async () => {
    stubModel([{ type: "add_save", place: { id: null, name: "Tia Grimanesa" }, area: null, note: "anticuchos, after five", source: "friend" }]);
    const res = await callAs(max, "input.interpret", { text: "a friend says Tía Grimanesa for anticuchos, after five", context: { screen: "saves" } });
    expect(res.status).toBe(200);
    expect(res.body.changes).toEqual([
      { kind: "save", op: "created", record: expect.objectContaining({ place: "tia-grimanesa", note: "anticuchos, after five", source: "friend" }) },
    ]);
  });

  it("creates an uncurated place for a name it can't match, and undo removes it", async () => {
    stubModel([{ type: "add_save", place: { id: null, name: "El Chinito" }, area: "barranco", note: "sanguches", source: null }]);
    const res = await callAs(max, "input.interpret", { text: "El Chinito for sanguches", context: { screen: "saves" } });
    const place = res.body.changes[0].record.place as string;
    expect(place).toMatch(/^el-chinito-/);
    expect(await all("SELECT name, area, curated, kind, created_by FROM place WHERE id = ?", place)).toEqual([
      { name: "El Chinito", area: "barranco", curated: 0, kind: null, created_by: id(max) },
    ]);
    await callAs(max, "input.undo", { undo: res.body.undo });
    expect(await all("SELECT id FROM place WHERE id = ?", place)).toEqual([]);
    expect(await all("SELECT * FROM save")).toEqual([]);
  });

  it("keeps a place made from one person's words private to them", async () => {
    stubModel([{ type: "add_save", place: { id: null, name: "Casa de Rosa Huamán" }, area: null, note: "her ají de gallina", source: "Rosa" }]);
    const res = await callAs(max, "input.interpret", { text: "save Casa de Rosa Huamán, her ají de gallina", context: { screen: "saves" } });
    expect(res.status).toBe(200);
    const created = res.body.changes[0].record.place as string;
    const names = (r: { body: { name: string }[] }) => r.body.map((p) => p.name);

    expect(names(await callAs(max, "places.search", { city: "lima", q: "rosa" }))).toContain("Casa de Rosa Huamán");
    expect((await callAs(max, "places.get", { id: created })).status).toBe(200);
    expect((await callAs(max, "saves.list", {})).body.map((s: { place: { id: string } }) => s.place.id)).toEqual([created]);

    expect(names(await callAs(other, "places.search", { city: "lima", q: "rosa" }))).not.toContain("Casa de Rosa Huamán");
    expect(names(await callAs(null, "places.search", { city: "lima", q: "rosa" }))).not.toContain("Casa de Rosa Huamán");
    expect((await callAs(other, "places.get", { id: created })).status).toBe(404);
    expect((await callAs(null, "places.get", { id: created })).status).toBe(404);
    for (const [name, input] of [
      ["saves.add", { place: created }],
      ["meals.set", { trip, place: created, date: "2026-11-20", slot: "lunch", status: "want" }],
      ["facts.report", { place: created, field: "cuisine", value: "criolla" }],
      ["places.refreshSlots", { place: created, dates: ["2026-11-20"], party: 2 }],
    ] as const) {
      expect((await callAs(other, name, input)).status, name).toBe(404);
    }

    // Another person naming the same place gets a place of their own, not Max's.
    stubModel([{ type: "add_save", place: { id: null, name: "Casa de Rosa Huamán" }, area: null, note: null, source: null }]);
    const theirs = await callAs(other, "input.interpret", { text: "save Casa de Rosa Huamán", context: { screen: "saves" } });
    expect(theirs.body.changes[0].record.place).not.toBe(created);

    await callAs(max, "input.undo", { undo: res.body.undo });
    expect(await all("SELECT id FROM place WHERE id = ?", created)).toEqual([]);
  });

  it("records a user fact on the place in view that only its author sees", async () => {
    stubModel([{ type: "add_fact", place: null, field: "hours", value: { text: "Daily 12:00-16:30", closed_days: [], closes: "16:30" } }]);
    const res = await callAs(max, "input.interpret", {
      text: "La Mar closes at 4:30 now",
      context: { screen: "place", place: "la-mar-cebicheria" },
    });
    expect(res.body.changes).toEqual([
      {
        kind: "fact",
        op: "created",
        record: expect.objectContaining({ place: "la-mar-cebicheria", field: "hours", value: { text: "Daily 12:00-16:30", closed_days: [], closes: "16:30" }, source: `user:${id(max)}` }),
      },
    ]);
    const [mine] = await placeCards(["la-mar-cebicheria"], id(max));
    const [theirs] = await placeCards(["la-mar-cebicheria"], id(other));
    expect(mine!.facts.hours?.value).toMatchObject({ closes: "16:30" });
    expect(theirs!.facts.hours?.value).toEqual({ text: "Daily 12:00-17:00", closed_days: [] });
  });

  it("sets a meal, then updates the same meal", async () => {
    stubModel([{ type: "set_meal", place: { id: "rafael", name: "Rafael" }, date: "2026-11-21", slot: "dinner", time: "20:00", status: "confirmed", note: null }]);
    const first = await callAs(max, "input.interpret", { text: "dinner at Rafael Saturday 8pm booked", context: { screen: "board", trip } });
    expect(first.body.changes).toEqual([
      { kind: "meal", op: "created", record: expect.objectContaining({ place: "rafael", date: "2026-11-21", slot: "dinner", time: "20:00", status: "confirmed" }) },
    ]);
    stubModel([{ type: "set_meal", place: { id: null, name: "Rafael" }, date: "2026-11-21", slot: "dinner", time: "20:30", status: "confirmed", note: null }]);
    const second = await callAs(max, "input.interpret", { text: "Rafael moved to 8:30", context: { screen: "board", trip } });
    expect(second.body.changes[0]).toMatchObject({ kind: "meal", op: "updated", record: { id: first.body.changes[0].record.id, time: "20:30" } });

    await callAs(max, "input.undo", { undo: second.body.undo });
    expect(await all("SELECT time, status FROM meal")).toEqual([{ time: "20:00", status: "confirmed" }]);
  });

  it("updates the trip and undo restores it", async () => {
    stubModel([{ type: "update_trip", start_date: null, end_date: null, party: 3, budget: null, diet: ["no pork"] }]);
    const res = await callAs(max, "input.interpret", { text: "we're three now, and no pork", context: { screen: "board", trip } });
    expect(res.body.changes[0]).toMatchObject({ kind: "trip", op: "updated", record: { party: 3, diet: ["no pork"] } });
    await callAs(max, "input.undo", { undo: res.body.undo });
    expect((await callAs(max, "trips.get", { id: trip })).body.trip).toMatchObject({ party: 2, diet: null });
  });

  it("applies several actions together and undoes exactly those", async () => {
    await callAs(max, "saves.add", { place: "central", note: "keep me" });
    stubModel([
      anchor,
      { type: "add_save", place: { id: "maido", name: "Maido" }, area: null, note: null, source: null },
      { type: "add_save", place: { id: "central", name: "Central" }, area: null, note: "ask for the bar", source: null },
    ]);
    const res = await callAs(max, "input.interpret", { text: "…", context: { screen: "anchors", trip } });
    expect(res.body.changes.map((c: { kind: string; op: string }) => `${c.kind}:${c.op}`)).toEqual(["anchor:created", "save:created", "save:updated"]);

    expect((await callAs(other, "input.undo", { undo: res.body.undo })).status).toBe(200);
    expect(await all("SELECT count(*) AS n FROM anchor")).toEqual([{ n: 1 }]);

    await callAs(max, "input.undo", { undo: res.body.undo });
    expect(await all("SELECT count(*) AS n FROM anchor")).toEqual([{ n: 0 }]);
    expect((await all("SELECT undone_at FROM input_undo"))[0]!.undone_at).toBeTruthy();
    expect(await all("SELECT place, note FROM save")).toEqual([{ place: "central", note: "keep me" }]);

    await callAs(max, "saves.add", { place: "maido" });
    await callAs(max, "input.undo", { undo: res.body.undo });
    expect(await all("SELECT place FROM save ORDER BY place")).toEqual([{ place: "central" }, { place: "maido" }]);
  });

  it("drops invalid actions and dates outside the trip", async () => {
    stubModel([
      { ...anchor, date: "2026-12-20" },
      { type: "add_anchor", date: "Friday" },
      { type: "teleport" },
      { type: "add_fact", place: null, field: "hours", value: "12-4" },
      { type: "add_fact", place: { id: "central", name: "Central" }, field: "hours", value: "12-4" },
    ]);
    const res = await callAs(max, "input.interpret", { text: "…", context: { screen: "anchors", trip } });
    expect(res.body).toEqual({ changes: [], undo: "" });
    expect((await callAs(max, "input.undo", { undo: "" })).status).toBe(200);
  });

  it("answers 503 when the model fails, and logs the failure", async () => {
    stubModel([], { status: 529 });
    const res = await callAs(max, "input.interpret", { text: "hola", context: { screen: "anchors" } });
    expect(res.status).toBe(503);
    expect(await all("SELECT outcome FROM interaction WHERE kind = 'interpret'")).toEqual([{ outcome: "error" }]);
  });

  it("rejects other people's trips and signed-out callers", async () => {
    stubModel([anchor]);
    expect((await callAs(other, "input.interpret", { text: "x", context: { screen: "anchors", trip } })).status).toBe(404);
    expect((await callAs(null, "input.interpret", { text: "x", context: { screen: "anchors" } })).status).toBe(401);
  });
});

describe("place names", () => {
  const pool = [
    { id: "tia-grimanesa", name: "Anticuchos Tía Grimanesa", area: null, curated: true },
    { id: "ov", name: "Grimanesa", area: null, curated: false },
    { id: "la-mar", name: "La Mar Cebichería", area: null, curated: true },
    { id: "mercado", name: "Mercado La Mar", area: null, curated: false },
    { id: "rafael", name: "Rafael", area: null, curated: true },
  ];
  it("matches accents, generic words and small misspellings, curated first", () => {
    expect(bestMatch("Tia Grimanesa", pool)?.id).toBe("tia-grimanesa");
    expect(bestMatch("la mar", pool)?.id).toBe("la-mar");
    expect(bestMatch("Rafel", pool)?.id).toBe("rafael");
    expect(bestMatch("Astrid y Gastón", pool)).toBeNull();
    expect(nameScore("Central", "Central Restaurante")).toBe(1);
  });
});
