import type { TripView } from "../../../shared/records";
import type { ShellTrip } from "../components/AppShell";
import { dayOfMonth, monthShort } from "../lib/dates";
import { useCurrentTripId, useTrip, useTrips } from "./hooks";

/** The current trip's view, plus its id (null until trips.list answers or when there is none). */
export function useTripView() {
  const trips = useTrips();
  const [id] = useCurrentTripId();
  const q = useTrip(id);
  return { id, view: q.data ?? null, isLoading: trips.isLoading || (!!id && q.isLoading), error: trips.error ?? q.error };
}

const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

export function tripDatesLabel(v: TripView): string {
  const { start_date: a, end_date: b } = v.trip;
  return monthShort(a) === monthShort(b) ? `${monthShort(a)} ${dayOfMonth(a)} to ${dayOfMonth(b)}` : `${monthShort(a)} ${dayOfMonth(a)} to ${monthShort(b)} ${dayOfMonth(b)}`;
}

/** "Lima · Nov 13 to 23 · 2 people" (screens render it uppercase in the label font). */
export const tripKicker = (v: TripView) => `${v.city.name} · ${tripDatesLabel(v)} · ${people(v.trip.party)}`;

export function shellTrip(v: TripView | null): ShellTrip | undefined {
  if (!v) return undefined;
  return { title: v.city.name, lines: [`${tripDatesLabel(v)} · ${people(v.trip.party)}`, v.trip.base.name] };
}
