// Wall-clock dates and times in a city's zone, with Intl only.

function offsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((wall - at.getTime()) / 60_000);
}

/** The instant of `date` `time` on the wall clock in `tz`. */
export function zonedInstant(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMinutes(tz, new Date(guess)) * 60_000;
  // A second pass settles instants near a DST change.
  return new Date(guess - offsetMinutes(tz, new Date(first)) * 60_000);
}

/** The wall-clock date and HH:MM of `at` in `tz`. */
export function wallClock(at: Date, tz: string): { date: string; time: string } {
  const local = new Date(at.getTime() + offsetMinutes(tz, at) * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

export function fromMinutes(n: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(n)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}
