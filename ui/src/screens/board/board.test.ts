import { beforeAll, describe, expect, it } from "vitest";
import type { PlaceCard, TripView } from "../../../../shared/records";
import { fixtureTransport, resetFixtures } from "../../data/fixtures/backend";
import { buildBoard, FAR_HOP_MIN, showClosures, spend, tally } from "./board";

let view: TripView;
let places: PlaceCard[];

beforeAll(async () => {
  resetFixtures();
  view = (await fixtureTransport("trips.get", { id: "lima-nov-2026" })) as TripView;
  places = (await fixtureTransport("places.search", { city: "lima", trip: "lima-nov-2026" })) as PlaceCard[];
});

describe("trip board grid", () => {
  it("lays out 11 days of lunch and dinner with the four real meals", () => {
    const rows = buildBoard(view, places);
    expect(rows).toHaveLength(11);
    const at = (d: string) => rows.find((r) => r.date === d)!;
    expect(at("2026-11-13").lunch).toMatchObject({ status: "confirmed", place: { id: "piedra-cocina-libre" } });
    expect(at("2026-11-16").dinner).toMatchObject({ status: "requested", place: { id: "central" } });
    expect(at("2026-11-19").dinner.status).toBe("waitlist");
    expect(at("2026-11-20").dinner).toMatchObject({ status: "requested", place: { id: "ototo-lima" } });
    expect(tally(rows)).toEqual({ confirmed: 1, requested: 2, waitlist: 1, open: 18 });
  });

  it("offers open places for open cells and none for filled ones", () => {
    const rows = buildBoard(view, places);
    const mon = rows.find((r) => r.date === "2026-11-16")!;
    expect(mon.dinner.openPlaces).toHaveLength(0);
    expect(mon.lunch.openPlaces.map((p) => p.id)).toContain("central");
    expect(mon.lunch.openPlaces.map((p) => p.id)).not.toContain("kjolle"); // closed Mondays
    expect(mon.lunch.checkedAt).not.toBeNull();
  });

  it("marks Sundays with closures", () => {
    const rows = buildBoard(view, places);
    expect(rows.filter(showClosures).map((r) => r.date)).toEqual(["2026-11-15", "2026-11-22"]);
  });

  it("measures the hop between lunch and dinner places", () => {
    const withLunch: TripView = {
      ...view,
      meals: [...view.meals, { ...view.meals[0]!, id: "m_walok", place: "wa-lok-barrio-chino", date: "2026-11-16", slot: "lunch", time: "14:30", status: "want" }],
      places: [...view.places, places.find((p) => p.id === "wa-lok-barrio-chino")!],
    };
    const mon = buildBoard(withLunch, places).find((r) => r.date === "2026-11-16")!;
    expect(mon.hop).toBeGreaterThanOrEqual(FAR_HOP_MIN);
  });

  it("marks meals that overlap a far-away plan", () => {
    const rows = buildBoard(view, places, [{ meal: "m_ototo", anchor: "a_barranco_fri", minutes: 34, estimated: true }]);
    const fri = rows.find((r) => r.date === "2026-11-20")!;
    expect(fri.dinner.conflict).toEqual({ minutes: 34, label: "Barranco", estimated: true });
    expect(fri.lunch.conflict).toBeNull();
  });

  it("adds up spend per person against the budget", () => {
    expect(spend(view)).toEqual({ confirmed: 65, planned: 65 + 479 + 380 + 59, budget: 1800, tastings: 3, tastingsWanted: 3 });
  });
});
