import { beforeEach, describe, expect, it } from "vitest";
import type { FileDatabase } from "../lib/db.js";
import { Auth } from "../lib/nexus.js";
import { addUser, callAs, seededDb } from "./helpers.js";

let database: FileDatabase;
let max: Auth;
let other: Auth;
const agent = Auth.create({ kind: "indent" });
const idOf = (a: Auth) => (a.actor.kind === "person" ? a.actor.id : "");
const closesEarly = { text: "Closes 16:30 now", closed_days: [], closes: "16:30" };

beforeEach(async () => {
  database = await seededDb();
  max = await addUser(database, "max@example.com");
  other = await addUser(database, "other@example.com");
});

describe("facts.report", () => {
  it("stores a user fact that only its author sees", async () => {
    const res = await callAs(max, "facts.report", { place: "la-mar-cebicheria", field: "hours", value: { text: "Closes 16:30 now", closes: "16:30" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ place: "la-mar-cebicheria", field: "hours", value: closesEarly, source: `user:${idOf(max)}` });

    const mine = (await callAs(max, "places.get", { id: "la-mar-cebicheria" })).body.facts.hours;
    const theirs = (await callAs(other, "places.get", { id: "la-mar-cebicheria" })).body.facts.hours;
    const anon = (await callAs(null, "places.get", { id: "la-mar-cebicheria" })).body.facts.hours;
    expect(mine).toMatchObject({ value: closesEarly, source: `user:${idOf(max)}` });
    expect(theirs.source).toBe("research");
    expect(anon.source).toBe("research");
  });

  it("keeps showing the author's report over a newer shared fact", async () => {
    await callAs(max, "facts.report", { place: "la-mar-cebicheria", field: "hours", value: closesEarly });
    await callAs(agent, "agent.recordFacts", {
      facts: [{ place: "la-mar-cebicheria", field: "hours", value: { text: "Daily 12:00-17:00" }, checked_at: "2099-01-01T00:00:00Z" }],
    });
    expect((await callAs(max, "places.get", { id: "la-mar-cebicheria" })).body.facts.hours.source).toBe(`user:${idOf(max)}`);
  });

  it("replaces the author's earlier report, and can be retracted", async () => {
    await callAs(max, "facts.report", { place: "isolina", field: "status", value: "temporarily_closed" });
    await callAs(max, "facts.report", { place: "isolina", field: "status", value: "closed" });
    const rows = await database.run((s) => s.prepare("SELECT value FROM fact WHERE place = 'isolina' AND source LIKE 'user:%'").all());
    expect(rows).toEqual([{ value: '"closed"' }]);
    expect((await callAs(max, "places.search", { city: "lima" })).body.map((p: { id: string }) => p.id)).not.toContain("isolina");
    expect((await callAs(other, "places.search", { city: "lima" })).body.map((p: { id: string }) => p.id)).toContain("isolina");

    await callAs(max, "facts.retract", { place: "isolina", field: "status" });
    expect((await callAs(max, "places.search", { city: "lima" })).body.map((p: { id: string }) => p.id)).toContain("isolina");
  });

  it("checks the value's shape, the place and the caller", async () => {
    expect((await callAs(max, "facts.report", { place: "isolina", field: "status", value: "gone" })).status).toBe(400);
    expect((await callAs(max, "facts.report", { place: "isolina", field: "hours", value: { closes: "16:30" } })).status).toBe(400);
    expect((await callAs(max, "facts.report", { place: "nowhere", field: "status", value: "closed" })).status).toBe(404);
    expect((await callAs(null, "facts.report", { place: "isolina", field: "status", value: "closed" })).status).toBe(401);
  });
});

describe("agent.listUserFacts", () => {
  it("lists user facts with the shared fact and agreeing reporters, for agents only", async () => {
    await callAs(max, "facts.report", { place: "la-mar-cebicheria", field: "hours", value: closesEarly });
    await callAs(other, "facts.report", { place: "la-mar-cebicheria", field: "hours", value: closesEarly });
    await callAs(other, "facts.report", { place: "central", field: "dress", value: "Smart casual" });

    expect((await callAs(max, "agent.listUserFacts", {})).status).toBe(403);
    const { body } = await callAs(agent, "agent.listUserFacts", { city: "lima" });
    expect(body.facts).toHaveLength(3);
    const lamar = body.facts.filter((f: { place: string }) => f.place === "la-mar-cebicheria");
    expect(lamar.map((f: { agreeing_reporters: number }) => f.agreeing_reporters)).toEqual([1, 1]);
    expect(lamar[0]).toMatchObject({ place_name: "La Mar Cebichería", city: "lima", field: "hours", value: closesEarly, shared: { source: "research" } });
    const dress = body.facts.find((f: { field: string }) => f.field === "dress");
    expect(dress).toMatchObject({ shared: null, agreeing_reporters: 0, source: `user:${idOf(other)}` });
    expect(JSON.stringify(body)).not.toMatch(/example\.com/);
  });

  it("promotion: once the research fact lands, expiring the user facts leaves the shared one for everyone", async () => {
    await callAs(max, "facts.report", { place: "la-mar-cebicheria", field: "hours", value: closesEarly });
    await callAs(agent, "agent.recordFacts", { facts: [{ place: "la-mar-cebicheria", field: "hours", value: closesEarly }] });
    const expired = await callAs(agent, "agent.expireFacts", {
      facts: [{ place: "la-mar-cebicheria", field: "hours", source: `user:${idOf(max)}` }],
    });
    expect(expired.body).toEqual({ deleted: 1 });
    expect((await callAs(other, "places.get", { id: "la-mar-cebicheria" })).body.facts.hours).toMatchObject({ value: closesEarly, source: "research" });
  });
});
