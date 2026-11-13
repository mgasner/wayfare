import { describe, expect, it } from "vitest";
import type { PlaceCard, SlotRead } from "../../../shared/records";
import { availabilitySummary, closedOn, firstReadTargets, mealWhen, shortDates, timesFor } from "./availability";

const read = (date: string, times: string[], waitlist: string[] = []): SlotRead => ({ place: "p", date, party: 2, service: "", times, waitlist, checked_at: "2026-11-13T00:12:00Z", interaction: "ix" });

const place = (slots: SlotRead[], closed: number[] = []): PlaceCard => ({
  id: "p",
  city: "lima",
  area: "barranco",
  name: "P",
  kind: "reserve_ahead",
  google_place_id: null,
  overture_id: null,
  lat: null,
  lng: null,
  channels: [],
  summary: null,
  links: [],
  curated: true,
  facts: { hours: { value: { text: "Tue-Sat. Lunch 12:45-14:00", closed_days: closed }, source: "research", checked_at: "2026-11-12T12:00:00Z" } },
  slots,
  saved: false,
});

describe("shortDates", () => {
  it("names the month once", () => {
    expect(shortDates(["2026-11-19", "2026-11-17"])).toBe("Nov 17 and 19");
    expect(shortDates(["2026-11-14", "2026-11-18", "2026-11-19", "2026-11-21"])).toBe("Nov 14, 18, 19 and 21");
    expect(shortDates(["2026-11-30", "2026-12-01"])).toBe("Nov 30 and Dec 1");
  });
});

describe("availability", () => {
  const p = place([
    read("2026-11-16", ["12:45", "13:00", "19:30"]),
    read("2026-11-17", ["13:00"], ["20:00"]),
    read("2026-11-18", ["12:45"]),
    read("2026-11-19", ["13:00", "20:00"]),
    read("2026-11-20", [], ["13:00", "20:00"]),
  ]);

  it("splits slot reads into lunch and dinner", () => {
    expect(timesFor(p, "2026-11-16", "dinner").times).toEqual(["19:30"]);
    expect(timesFor(p, "2026-11-17", "dinner")).toMatchObject({ times: [], waitlist: ["20:00"], read: true });
    expect(timesFor(p, "2026-11-22", "lunch").read).toBe(false);
  });

  it("summarizes the trip in one line", () => {
    expect(availabilitySummary(p, "2026-11-16", "2026-11-20")).toEqual({ tone: "ok", text: "Lunch 4 days, dinner Nov 16 and 19" });
    expect(availabilitySummary(p, "2026-11-16", "2026-11-20", "dinner")).toEqual({ tone: "warn", text: "Dinner Nov 16 and 19" });
    // Days without a read are not called closed.
    expect(availabilitySummary(p, "2026-11-13", "2026-11-23")).toEqual({ tone: "ok", text: "Lunch 4 days, dinner Nov 16 and 19 · 5 of 11 days read" });
    expect(availabilitySummary(place([read("2026-11-21", ["20:00"])]), "2026-11-21", "2026-11-23")).toEqual({ tone: "warn", text: "Dinner Nov 21 · 1 of 3 days read" });
    expect(availabilitySummary(place([read("2026-11-21", [])]), "2026-11-21", "2026-11-23")).toEqual({ tone: "muted", text: "Nothing open · 1 of 3 days read" });
    expect(availabilitySummary(p, "2026-11-20", "2026-11-20")).toEqual({ tone: "danger", text: "Fully booked. Waitlist on 1 day" });
  });

  it("falls back to hours for places without slot reads", () => {
    expect(availabilitySummary(place([]), "2026-11-13", "2026-11-23")).toEqual({ tone: "muted", text: "Tue-Sat" });
  });

  it("knows closed weekdays", () => {
    expect(closedOn(place([], [0, 1]), "2026-11-15")).toBe(true);
    expect(closedOn(place([], [0, 1]), "2026-11-17")).toBe(false);
  });

  it("formats a meal's time", () => {
    expect(mealWhen({ date: "2026-11-13", time: "15:00", slot: "lunch" })).toBe("Fri 3 PM");
    expect(mealWhen({ date: "2026-11-19", time: null, slot: "dinner" })).toBe("Thu dinner");
  });
});

describe("first slot reads", () => {
  const mesa = { type: "mesa247", host: "x.mesa247.pe", slug: "x", local_id: 1 } as const;
  const at = (id: string, channels: PlaceCard["channels"], slots: SlotRead[] = []): PlaceCard => ({ ...place(slots), id, channels });

  it("reads readable places with no read on the dates shown, at most max, in list order", () => {
    const places = [
      at("walk-in", [{ type: "walk_in" }]),
      at("read-already", [mesa], [read("2026-11-21", ["20:00"])]),
      at("read-other-day", [mesa], [read("2026-11-14", ["20:00"])]),
      at("never-read", [{ type: "meitre", venue_id: 1 }]),
      at("never-read-2", [mesa]),
    ];
    expect(firstReadTargets(places, ["2026-11-21"], 12)).toEqual(["read-other-day", "never-read", "never-read-2"]);
    expect(firstReadTargets(places, ["2026-11-21"], 2)).toEqual(["read-other-day", "never-read"]);
    expect(firstReadTargets(places, [], 12)).toEqual([]);
  });
});
