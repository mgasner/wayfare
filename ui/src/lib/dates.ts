// Trip dates are IsoDate strings in the city's local calendar and times are local HH:MM,
// so all date math here stays on naive calendar dates (UTC noon) and never touches a timezone.

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const toDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
export const toIso = (d: Date) => d.toISOString().slice(0, 10);

/** Today's date in a time zone, as YYYY-MM-DD. */
export const todayIn = (tz: string, now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: tz });

/** Trip dates from today on, at most `n`. */
export const upcoming = (start: string, end: string, tz: string, n: number, now = new Date()) =>
  dateRange(start, end)
    .filter((d) => d >= todayIn(tz, now))
    .slice(0, n);

export function addDays(iso: string, n: number): string {
  return toIso(new Date(toDate(iso).getTime() + n * DAY));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
}

/** Inclusive list of dates from start to end. */
export function dateRange(start: string, end: string): string[] {
  const n = daysBetween(start, end);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
}

export const weekday = (iso: string) => WEEKDAYS[toDate(iso).getUTCDay()]!;
export const dayOfMonth = (iso: string) => toDate(iso).getUTCDate();
export const isSunday = (iso: string) => toDate(iso).getUTCDay() === 0;
export const monthShort = (iso: string) => MONTHS[toDate(iso).getUTCMonth()]!;
export const monthLong = (iso: string) => MONTHS_LONG[toDate(iso).getUTCMonth()]!;

/** "Fri Nov 13" */
export const dayLabel = (iso: string) => `${weekday(iso)} ${monthShort(iso)} ${dayOfMonth(iso)}`;

/** "Fri Nov 13 to Mon Nov 23" */
export const rangeLabel = (a: string, b: string) => `${dayLabel(a)} to ${dayLabel(b)}`;

/** "15:00" -> "3:00 PM"; short drops ":00" and the suffix: "3", "7:30". */
export function time12(hhmm: string, opts: { short?: boolean } = {}): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const h12 = ((h + 11) % 12) + 1;
  const mm = String(m).padStart(2, "0");
  if (opts.short) return `${h12}:${mm}`;
  return `${h12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** Lunch before 5 PM, dinner from 5 PM. */
export const serviceOf = (hhmm: string): "lunch" | "dinner" => (minutesOf(hhmm) < 17 * 60 ? "lunch" : "dinner");

export function weeksOfMonth(iso: string): string[][] {
  const d = toDate(iso);
  const first = toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12)));
  const mondayOffset = (toDate(first).getUTCDay() + 6) % 7;
  let cur = addDays(first, -mondayOffset);
  const month = d.getUTCMonth();
  const weeks: string[][] = [];
  while (weeks.length < 6) {
    const week = Array.from({ length: 7 }, (_, i) => addDays(cur, i));
    if (weeks.length > 0 && toDate(week[0]!).getUTCMonth() !== month) break;
    weeks.push(week);
    cur = addDays(cur, 7);
  }
  return weeks;
}
