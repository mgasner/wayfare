import { beforeEach, describe, expect, it } from "vitest";
import { parseFactValue } from "../../../../shared/facts.js";
import type { Anchor, FactField, PlaceCard, Save } from "../../../../shared/records";
import { fixtureTransport, resetFixtures } from "./backend";

const call = (name: string, input: unknown) => fixtureTransport(name, input) as Promise<any>;

beforeEach(() => resetFixtures());

describe("fixtures backend", () => {
  it("serves the real Lima trip with its four meals", async () => {
    const view = await call("trips.get", { id: "lima-nov-2026" });
    expect(view.trip.start_date).toBe("2026-11-13");
    expect(view.trip.booking).toEqual({ whatsapp_fallback: true });
    expect((await call("me.get", {})).credits_usd).toBe(150);
    expect(view.meals.map((m: { place: string; status: string }) => `${m.place}:${m.status}`).sort()).toEqual([
      "central:requested",
      "maido:waitlist",
      "ototo-lima:requested",
      "piedra-cocina-libre:confirmed",
    ]);
    expect(view.places).toHaveLength(4);
  });

  it("writes fact values in the shapes of shared/facts.ts", async () => {
    const all = (await call("places.search", { city: "lima" })) as PlaceCard[];
    const bad = all.flatMap((p) =>
      Object.entries(p.facts).flatMap(([field, f]) => {
        const r = parseFactValue(field as FactField, f!.value);
        return r.ok ? [] : [`${p.id}: ${r.message}`];
      }),
    );
    expect(bad).toEqual([]);
  });

  it("filters places by kind and area", async () => {
    const all = await call("places.search", { city: "lima" });
    expect(all).toHaveLength(27);
    const barranco = await call("places.search", { city: "lima", area: "barranco", kinds: ["reserve_ahead"] });
    expect(barranco.map((p: { id: string }) => p.id)).toContain("central");
    expect(barranco.every((p: { area: string }) => p.area === "barranco")).toBe(true);
  });

  it("starts travel from the anchor covering the time, else the hotel", async () => {
    const atHotel = await call("anchors.whereAt", { trip: "lima-nov-2026", date: "2026-11-20", time: "09:00" });
    expect(atHotel.anchor).toBeNull();
    const inBarranco = await call("anchors.whereAt", { trip: "lima-nov-2026", date: "2026-11-20", time: "13:00" });
    expect(inBarranco.anchor).toBe("a_barranco_fri");
    const mins = await call("travel.minutes", { trip: "lima-nov-2026", date: "2026-11-20", time: "13:00", places: ["central", "wa-lok-barrio-chino"] });
    expect(mins.minutes.central).toBeLessThan(15);
    expect(mins.minutes["wa-lok-barrio-chino"]).toBeGreaterThan(35);
    expect(mins.from).toMatchObject({ label: "Barranco", anchor: "a_barranco_fri" });
  });

  it("flags a meal far from the plan it overlaps", async () => {
    expect(await call("anchors.conflicts", { trip: "lima-nov-2026" })).toEqual([]);
    await call("meals.set", { trip: "lima-nov-2026", place: "wa-lok-barrio-chino", date: "2026-11-20", slot: "lunch", time: "13:00", status: "want" });
    const [c] = await call("anchors.conflicts", { trip: "lima-nov-2026" });
    expect(c).toMatchObject({ anchor: "a_barranco_fri", estimated: true });
    expect(c.minutes).toBeGreaterThan(20);
  });

  it("turns a spoken area hint into an anchor that Undo removes", async () => {
    const r = await call("input.interpret", { text: "el sábado estamos en Miraflores, ten to six", context: { screen: "where", trip: "lima-nov-2026", today: "2026-11-13" } });
    expect(r.changes).toHaveLength(1);
    const a = r.changes[0].record as Anchor;
    expect([a.date, a.area, a.start_time, a.end_time]).toEqual(["2026-11-14", "miraflores", "10:00", "18:00"]);
    await call("input.undo", { undo: r.undo });
    const anchors = await call("anchors.list", { trip: "lima-nov-2026" });
    expect(anchors.some((x: Anchor) => x.id === a.id)).toBe(false);
  });

  it("reads a bare weekday said on that weekday as next week's, unless it says today", async () => {
    const ctx = { screen: "where", trip: "lima-nov-2026", today: "2026-11-13" }; // a Friday
    const next = await call("input.interpret", { text: "el viernes estamos en Barranco", context: ctx });
    expect((next.changes[0].record as Anchor).date).toBe("2026-11-20");
    const today = await call("input.interpret", { text: "hoy viernes estamos en Barranco", context: ctx });
    expect((today.changes[0].record as Anchor).date).toBe("2026-11-13");
  });

  it("turns a friend's tip into a save with the note", async () => {
    await call("saves.remove", { place: "anticuchos-grimanesa-lima" });
    const r = await call("input.interpret", { text: "a friend says Tía Grimanesa for anticuchos, after five", context: { screen: "saved" } });
    const s = r.changes[0].record as Save;
    expect([s.place, s.source]).toEqual(["anticuchos-grimanesa-lima", "friend"]);
  });

  it("records a spoken hours correction as the user's own fact", async () => {
    await call("input.interpret", { text: "La Mar closes at 4:30 now", context: { screen: "place", place: "la-mar-cebicheria" } });
    const p = await call("places.get", { id: "la-mar-cebicheria" });
    expect(p.facts.hours.source).toBe("user:u_max");
    expect(p.facts.hours.value.closes).toBe("16:30");
  });
});

describe("fixtures without slot reads", () => {
  it("starts with no reads and keeps what places.refreshSlots reads", async () => {
    resetFixtures();
    const { setNoSeedReads } = await import("./backend");
    setNoSeedReads(true);
    expect((await call("places.get", { id: "central" })).slots).toEqual([]);
    const reads = await call("places.refreshSlots", { place: "central", dates: ["2026-11-16"], party: 2 });
    expect(reads).toHaveLength(1);
    expect((await call("places.get", { id: "central" })).slots.map((s: { date: string }) => s.date)).toEqual(["2026-11-16"]);
    setNoSeedReads(false);
  });
});
