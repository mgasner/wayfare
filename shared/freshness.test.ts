import { describe, expect, it } from "vitest";
import { formatAge, isStale } from "./freshness.js";

const now = Date.parse("2026-11-13T00:45:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;

describe("isStale", () => {
  it("uses 15 minutes for slots and waitlists", () => {
    expect(isStale("slots", ago(15 * MIN), now)).toBe(false);
    expect(isStale("slots", ago(15 * MIN + 1), now)).toBe(true);
    expect(isStale("waitlist", ago(16 * MIN), now)).toBe(true);
  });

  it("uses 7 days for hours and 30 days for price, menu and status", () => {
    expect(isStale("hours", ago(6 * DAY), now)).toBe(false);
    expect(isStale("hours", ago(8 * DAY), now)).toBe(true);
    for (const f of ["price_pp", "menu", "status"] as const) {
      expect(isStale(f, ago(29 * DAY), now)).toBe(false);
      expect(isStale(f, ago(31 * DAY), now)).toBe(true);
    }
  });

  it("never marks fields without a window", () => {
    expect(isStale("cuisine", ago(400 * DAY), now)).toBe(false);
  });

  it("treats an unreadable timestamp as stale", () => {
    expect(isStale("slots", "not a date", now)).toBe(true);
  });
});

describe("formatAge", () => {
  it("picks the largest whole unit", () => {
    expect(formatAge(20_000)).toBe("1 min");
    expect(formatAge(59 * MIN)).toBe("59 min");
    expect(formatAge(2 * 60 * MIN + 59 * MIN)).toBe("2 h");
    expect(formatAge(23 * 60 * MIN)).toBe("23 h");
    expect(formatAge(30 * 60 * MIN)).toBe("1 d");
    expect(formatAge(8 * DAY + 3 * 60 * MIN)).toBe("8 d");
  });
});
