import type { Meal, PlaceCard } from "../../../shared/records";
import { dateRange, dayOfMonth, monthShort, serviceOf, time12, toDate, weekday } from "../lib/dates";
import { hours, slotsByDay } from "./facts";

export type MealSlot = "lunch" | "dinner";
export type Tone = "ok" | "warn" | "danger" | "muted";

/** "Nov 17", "Nov 17 and 19", "Nov 14, 18, 19 and 21" (dates sorted, one month name per month). */
export function shortDates(dates: string[]): string {
  const sorted = [...dates].sort();
  const parts: string[] = [];
  let month = "";
  for (const d of sorted) {
    const m = monthShort(d);
    parts.push(m === month ? String(dayOfMonth(d)) : `${m} ${dayOfMonth(d)}`);
    month = m;
  }
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

export function closedOn(p: PlaceCard, date: string): boolean {
  return hours(p)?.closed_days.includes(toDate(date).getUTCDay()) ?? false;
}

export interface Times {
  times: string[];
  waitlist: string[];
  checkedAt: string | null;
  /** True when we have a slot read for that date at all. */
  read: boolean;
}

export function timesFor(p: PlaceCard, date: string, meal: MealSlot): Times {
  const d = slotsByDay(p).get(date);
  if (!d) return { times: [], waitlist: [], checkedAt: null, read: false };
  return { times: d[meal], waitlist: meal === "lunch" ? d.waitLunch : d.waitDinner, checkedAt: d.read.checked_at, read: true };
}

export const hasSlotData = (p: PlaceCard) => p.slots.length > 0;

export interface Summary {
  tone: Tone;
  text: string;
}

/** One line for a list row: when the place has open tables during the trip. */
export function availabilitySummary(p: PlaceCard, start: string, end: string, meal?: MealSlot): Summary {
  if (!hasSlotData(p)) {
    const h = hours(p);
    const first = h?.text.replace(/^Hours[^:]*:\s*/i, "").split(/[.;(]/)[0]?.trim();
    return { tone: "muted", text: first ? first : "No live availability; ask by message" };
  }
  const days = dateRange(start, end);
  const open = (m: MealSlot) => days.filter((d) => timesFor(p, d, m).times.length > 0);
  const wait = (m: MealSlot) => days.filter((d) => timesFor(p, d, m).waitlist.length > 0);
  const lunch = open("lunch");
  const dinner = open("dinner");
  const describe = (label: string, ds: string[]) => (ds.length === 0 ? null : ds.length > 3 ? `${label} ${ds.length} days` : `${label} ${shortDates(ds)}`);
  const wanted: [string, string[]][] = meal === "lunch" ? [["Lunch", lunch]] : meal === "dinner" ? [["Dinner", dinner]] : [["Lunch", lunch], ["dinner", dinner]];
  const bits = wanted.map(([l, ds]) => describe(l, ds)).filter(Boolean) as string[];
  // A first read covers a few days; don't call the rest closed.
  const unread = days.filter((d) => !timesFor(p, d, "lunch").read).length;
  const checked = unread ? ` · ${days.length - unread} of ${days.length} days read` : "";
  if (bits.length === 0) {
    const w = meal ? wait(meal) : [...new Set([...wait("lunch"), ...wait("dinner")])];
    if (w.length) return { tone: "danger", text: `Fully booked. Waitlist on ${w.length} day${w.length === 1 ? "" : "s"}${checked}` };
    return unread ? { tone: "muted", text: `Nothing open${checked}` } : { tone: "danger", text: "Nothing open on your dates" };
  }
  const text = bits.map((b, i) => (i === 0 ? b.charAt(0).toUpperCase() + b.slice(1) : b)).join(", ");
  const total = (meal === "dinner" ? 0 : lunch.length) + (meal === "lunch" ? 0 : dinner.length);
  const only = !unread && total <= 3 && !meal && lunch.length + dinner.length <= 4;
  return { tone: total <= 3 ? "warn" : "ok", text: only ? `Open only ${shortDates([...new Set([...lunch, ...dinner])])}` : `${text}${checked}` };
}

/** The meal that ties a place to the trip, if any: confirmed first, then the most recent. */
export function tripMealFor(meals: Meal[], place: string): Meal | null {
  const mine = meals.filter((m) => m.place === place && m.status !== "skipped");
  return mine.find((m) => m.status === "confirmed") ?? mine.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

/** "Fri 3 PM", "Mon dinner". */
export function mealWhen(m: Pick<Meal, "date" | "time" | "slot">): string {
  if (!m.time) return `${weekday(m.date)} ${m.slot}`;
  return `${weekday(m.date)} ${time12(m.time).replace(":00", "")}`;
}

/** Default hour for travel estimates and whereAt when a meal has no time yet. */
export const mealHour = (meal: MealSlot | undefined) => (meal === "lunch" ? "13:00" : "20:00");

export const slotOfTime = (t: string): MealSlot => serviceOf(t);

/** Places with a channel we can read slots from (Mesa 24/7, Meitre). */
export const hasReadableSlots = (p: PlaceCard) => p.channels.some((c) => c.type === "mesa247" || c.type === "meitre");

/** Which of the places shown get a first live read: readable, no read on any of `dates`, at most `max`, in order. */
export function firstReadTargets(places: PlaceCard[], dates: string[], max: number): string[] {
  if (!dates.length) return [];
  return places
    .filter((p) => hasReadableSlots(p) && !p.slots.some((s) => dates.includes(s.date)))
    .slice(0, max)
    .map((p) => p.id);
}

/** A trip meal in one lunch or dinner slot: at `place`, or at another place that already takes the slot. */
export interface SlotMeals {
  own: Meal | null;
  other: { meal: Meal; name: string } | null;
}

/** Meals that count for a slot: skipped and failed ones leave it free; "other" meals go by their time. */
export function slotMeals(meals: Meal[], places: Pick<PlaceCard, "id" | "name">[], place: string, date: string, slot: MealSlot): SlotMeals {
  const inSlot = meals.filter(
    (m) => m.date === date && m.status !== "skipped" && m.status !== "failed" && (m.slot === slot || (m.slot === "other" && !!m.time && serviceOf(m.time) === slot)),
  );
  const own = inSlot.find((m) => m.place === place) ?? null;
  const theirs = inSlot.find((m) => m.place !== place);
  return {
    own,
    other: theirs ? { meal: theirs, name: places.find((p) => p.id === theirs.place)?.name ?? theirs.place } : null,
  };
}
