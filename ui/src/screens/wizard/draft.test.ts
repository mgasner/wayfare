import { describe, expect, it } from "vitest";
import { casual, clampAppetite, LIMA_DEFAULTS, mealSlots, pickDate, sundays, toTripInput, type Draft } from "./draft";

describe("wizard draft", () => {
  it("counts the Lima trip as 11 days, 22 slots, 2 Sundays, 14 casual", () => {
    expect(mealSlots(LIMA_DEFAULTS)).toBe(22);
    expect(sundays(LIMA_DEFAULTS)).toEqual(["2026-11-15", "2026-11-22"]);
    expect(casual(LIMA_DEFAULTS)).toBe(14);
  });

  it("picks a range with two taps and restarts on an earlier tap", () => {
    let d: Draft = { ...LIMA_DEFAULTS, start_date: null, end_date: null };
    d = pickDate(d, "2026-11-13");
    expect([d.start_date, d.end_date]).toEqual(["2026-11-13", null]);
    d = pickDate(d, "2026-11-16");
    expect([d.start_date, d.end_date]).toEqual(["2026-11-13", "2026-11-16"]);
    d = pickDate(d, "2026-11-10");
    expect([d.start_date, d.end_date]).toEqual(["2026-11-10", null]);
    d = pickDate(d, "2026-11-08");
    expect([d.start_date, d.end_date]).toEqual(["2026-11-08", null]);
  });

  it("shrinks big meals to fit a shorter trip", () => {
    const short = clampAppetite({ ...LIMA_DEFAULTS, end_date: "2026-11-15", tastings: 3, sit_down: 5 });
    expect([mealSlots(short), short.tastings, short.sit_down, casual(short)]).toEqual([6, 3, 3, 0]);
  });

  it("builds trips.create input with credits instead of a card", () => {
    const t = toTripInput(LIMA_DEFAULTS);
    expect(t.booking).toEqual({ passport_on_file: false, credits_usd: 0, whatsapp_fallback: true });
    expect(t.appetite).toEqual({ tastings: 3, sit_down: 5, lunch_main: true });
    expect(t.budget).toEqual({ per_person: 1800, currency: "USD" });
  });
});
