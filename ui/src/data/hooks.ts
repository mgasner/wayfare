import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient, type QueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Change } from "../../../shared/actions.js";
import type { PlaceCard, SlotRead } from "../../../shared/records";
import type { Input as In, Name, Output as Out } from "../api.js";
import { firstReadTargets } from "./availability";
import { api } from "./client";

const key = <N extends Name>(name: N, input?: In<N>) => (input === undefined ? [name] : [name, input]);

function useApi<N extends Name>(name: N, input: In<N> | null, opts: Partial<UseQueryOptions<Out<N>>> = {}) {
  return useQuery<Out<N>>({
    queryKey: key(name, input ?? undefined),
    queryFn: () => api(name, input!),
    enabled: input !== null && (opts.enabled ?? true),
    ...opts,
  });
}

const invalidate = (qc: QueryClient, ...names: Name[]) => Promise.all(names.map((n) => qc.invalidateQueries({ queryKey: [n] })));

// ---------- queries ----------

export const useMe = () => useApi("me.get", {});
export const useTrips = () => useApi("trips.list", {});
export const useTrip = (id: string | null) => useApi("trips.get", id ? { id } : null);
export const useCity = (id: string | null) => useApi("cities.get", id ? { id } : null, { staleTime: Infinity });
// places.search returns 50 by default; screens filter and count client-side, so ask for the city.
export const usePlaces = (input: In<"places.search"> | null) => useApi("places.search", input && { limit: 500, ...input }, { placeholderData: keepPreviousData });
export const usePlace = (id: string | null, trip?: string) => useApi("places.get", id ? { id, ...(trip ? { trip } : {}) } : null);
export const useSaves = (city?: string) => useApi("saves.list", city ? { city } : {});
export const useAnchors = (trip: string | null) => useApi("anchors.list", trip ? { trip } : null);
export const useConflicts = (trip: string | null) => useApi("anchors.conflicts", trip ? { trip } : null);
export const useWhereAt = (input: In<"anchors.whereAt"> | null) => useApi("anchors.whereAt", input);
export const useTravelMinutes = (input: In<"travel.minutes"> | null) =>
  useApi("travel.minutes", input && input.places.length ? input : null, { placeholderData: keepPreviousData });

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Hotels or addresses matching `q` in a city, looked up 300 ms after typing stops. */
export function useStaySearch(city: string, q: string) {
  const term = useDebounced(q.trim(), 300);
  return useApi("stays.search", term.length >= 2 ? { city, q: term, limit: 5 } : null, { staleTime: 10 * 60_000, placeholderData: keepPreviousData });
}

/** Taxi minutes from where you sleep to each area of the city. */
export const useStayMinutes = (city: string, at: { lat: number; lng: number } | null) =>
  useApi("stays.minutes", at ? { city, lat: at.lat, lng: at.lng } : null, { staleTime: 60 * 60_000, placeholderData: keepPreviousData });

/** Lunch-to-dinner rides, one travel.minutes call per day, keyed by date. */
export function useTravelHops(trip: string | null, hops: { date: string; from: string; to: string; time: string }[]) {
  return useQueries({
    queries: hops.map(({ date, from, to, time }) => {
      const input: In<"travel.minutes"> = { trip: trip ?? "", date, time, places: [to], from: { place: from } };
      return { queryKey: key("travel.minutes", input), queryFn: () => api("travel.minutes", input), enabled: !!trip, staleTime: 10 * 60_000 };
    }),
    combine: (results) =>
      Object.fromEntries(
        hops.flatMap((h, i) => {
          const r = results[i]?.data;
          return r ? [[h.date, { minutes: r.minutes[h.to] ?? null, estimated: r.estimated }]] : [];
        }),
      ),
  });
}

const TRIP_KEY = "dp-current-trip";

/** The trip the app is showing: the last one opened, else the newest. */
export function useCurrentTripId(): [string | null, (id: string) => void] {
  const trips = useTrips();
  const [chosen, setChosen] = useState<string | null>(() => localStorage.getItem(TRIP_KEY));
  useEffect(() => {
    if (!trips.data) return;
    if (!chosen || !trips.data.some((t) => t.id === chosen)) setChosen(trips.data[0]?.id ?? null);
  }, [trips.data, chosen]);
  const set = (id: string) => {
    localStorage.setItem(TRIP_KEY, id);
    setChosen(id);
  };
  const valid = chosen && trips.data?.some((t) => t.id === chosen) ? chosen : (trips.data?.[0]?.id ?? null);
  return [valid, set];
}

// ---------- mutations ----------

export function useCreateTrip() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: In<"trips.create">) => api("trips.create", input), onSuccess: () => invalidate(qc, "trips.list") });
}

export function useUpdateTrip() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: In<"trips.update">) => api("trips.update", input), onSuccess: () => invalidate(qc, "trips.list", "trips.get") });
}

/** Sends the passport number to user_private; the app only ever reads back whether one is on file. */
export function useSetPassport() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: In<"me.setPassport">) => api("me.setPassport", input), onSuccess: () => invalidate(qc, "me.get") });
}

export function useClearPassport() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api("me.clearPassport", {}), onSuccess: () => invalidate(qc, "me.get") });
}

export function useSetMeal() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: In<"meals.set">) => api("meals.set", input), onSuccess: () => invalidate(qc, "trips.get", "anchors.conflicts") });
}

export function useRemoveMeal() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: In<"meals.remove">) => api("meals.remove", input), onSuccess: () => invalidate(qc, "trips.get", "anchors.conflicts") });
}

export function useToggleSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ place, saved, note, source }: { place: string; saved: boolean; note?: string; source?: string }) =>
      saved ? api("saves.add", { place, ...(note ? { note } : {}), ...(source ? { source } : {}) }) : api("saves.remove", { place }),
    onSuccess: () => invalidate(qc, "saves.list", "places.search", "places.get", "trips.get"),
  });
}

/** Edits a save's note or nearby flag, showing the change before the server answers. */
export function useUpdateSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: In<"saves.update">) => api("saves.update", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["saves.list"] });
      const before = qc.getQueriesData<Out<"saves.list">>({ queryKey: ["saves.list"] });
      qc.setQueriesData<Out<"saves.list">>({ queryKey: ["saves.list"] }, (list) =>
        list?.map((x) =>
          x.save.place !== input.place
            ? x
            : {
                ...x,
                save: {
                  ...x.save,
                  ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
                  ...(input.notify_nearby !== undefined ? { notify_nearby: input.notify_nearby } : {}),
                },
              },
        ),
      );
      return { before };
    },
    onError: (_e, _input, ctx) => ctx?.before.forEach(([k, v]) => qc.setQueryData(k, v)),
    onSettled: () => invalidate(qc, "saves.list"),
  });
}

function mergeReads(qc: QueryClient, place: string, reads: SlotRead[]) {
  const merge = (c: PlaceCard): PlaceCard => (c.id !== place ? c : { ...c, slots: mergeSlots(c.slots, reads) });
  qc.setQueriesData<PlaceCard>({ queryKey: ["places.get"] }, (c) => (c ? merge(c) : c));
  qc.setQueriesData<PlaceCard[]>({ queryKey: ["places.search"] }, (cs) => cs?.map(merge));
  qc.setQueriesData<Out<"trips.get">>({ queryKey: ["trips.get"] }, (v) => (v ? { ...v, places: v.places.map(merge) } : v));
}

/** Live slot read; merges the fresh reads into every cached card for that place. */
export function useRefreshSlots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: In<"places.refreshSlots">) => api("places.refreshSlots", input),
    onSuccess: (reads, { place }) => mergeReads(qc, place, reads),
  });
}


// First reads run two at a time, once per place, party and dates in this tab; the server also caps a person's live reads.
const FIRST_READS_AT_ONCE = 2;
const firstReadsAsked = new Set<string>();
let firstReadsRunning = 0;
const firstReadsWaiting: (() => void)[] = [];

async function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  if (firstReadsRunning >= FIRST_READS_AT_ONCE) await new Promise<void>((r) => firstReadsWaiting.push(r));
  firstReadsRunning++;
  try {
    return await fn();
  } finally {
    firstReadsRunning--;
    firstReadsWaiting.shift()?.();
  }
}

/**
 * A first live read for readable places shown with no read on any of `dates`, at most `max` of them.
 * Returns the ids being checked now.
 */
export function useFirstSlotReads(places: PlaceCard[], dates: string[], party: number | null, max = 12): ReadonlySet<string> {
  const qc = useQueryClient();
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
  const dateKey = dates.join(",");
  const need = firstReadTargets(places, dates, max).join(",");
  useEffect(() => {
    if (!party || !dateKey || !need) return;
    const ds = dateKey.split(",");
    for (const id of need.split(",")) {
      const k = `${id}|${party}|${dateKey}`;
      if (firstReadsAsked.has(k)) continue;
      firstReadsAsked.add(k);
      setChecking((s) => new Set(s).add(id));
      void oneAtATime(() => api("places.refreshSlots", { place: id, dates: ds, party }))
        .then((reads) => mergeReads(qc, id, reads))
        .catch(() => {})
        .finally(() =>
          setChecking((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          }),
        );
    }
  }, [need, dateKey, party, qc]);
  return checking;
}

export function mergeSlots(cur: SlotRead[], reads: SlotRead[]): SlotRead[] {
  const k = (s: SlotRead) => `${s.date}|${s.service}`;
  const fresh = new Map(reads.map((r) => [k(r), r]));
  const kept = cur.filter((s) => !fresh.has(k(s)));
  return [...kept, ...reads].sort((a, b) => a.date.localeCompare(b.date));
}

export function useAddAnchor() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: In<"anchors.add">) => api("anchors.add", input), onSuccess: () => invalidate(qc, "anchors.list", "trips.get", "travel.minutes", "anchors.whereAt", "anchors.conflicts") });
}

export function useRemoveAnchor() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: In<"anchors.remove">) => api("anchors.remove", input), onSuccess: () => invalidate(qc, "anchors.list", "trips.get", "travel.minutes", "anchors.whereAt", "anchors.conflicts") });
}

const INVALIDATES: Record<Change["kind"], Name[]> = {
  anchor: ["anchors.list", "trips.get", "travel.minutes", "anchors.whereAt", "anchors.conflicts"],
  save: ["saves.list", "places.search", "places.get"],
  fact: ["places.search", "places.get", "trips.get"],
  meal: ["trips.get", "anchors.conflicts"],
  trip: ["trips.list", "trips.get"],
};

export function invalidateChanges(qc: QueryClient, changes: Change[]) {
  const names = new Set(changes.flatMap((c) => INVALIDATES[c.kind]));
  return invalidate(qc, ...names);
}

/** Free-form input; the caller shows the changes with an Undo toast. */
export function useInterpret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: In<"input.interpret">) => api("input.interpret", input),
    onSuccess: (r) => invalidateChanges(qc, r.changes),
  });
}

export function useUndo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ undo }: { undo: string; changes: Change[] }) => api("input.undo", { undo }),
    onSuccess: (_r, { changes }) => invalidateChanges(qc, changes),
  });
}

// ---------- calendars ----------

export const useCalendarLinks = () => useApi("calendar.links", {});

/** Syncs calendars into anchors once per mount; the server skips links synced in the last 10 minutes. */
export function useCalendarSync(trip: string | null) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (input: In<"calendar.sync">) => api("calendar.sync", input),
    onSuccess: (r) => (r.created || r.updated || r.deleted ? invalidate(qc, "anchors.list", "trips.get", "calendar.links", "anchors.conflicts", "travel.minutes") : invalidate(qc, "calendar.links")),
  });
  const { mutate } = m;
  useEffect(() => {
    if (trip) mutate({ trip });
  }, [trip, mutate]);
  return m;
}

export function useAddIcs() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: In<"calendar.addIcs">) => api("calendar.addIcs", input), onSuccess: () => invalidate(qc, "calendar.links", "anchors.list", "trips.get", "anchors.conflicts") });
}

export function useRemoveIcs() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: In<"calendar.removeIcs">) => api("calendar.removeIcs", input), onSuccess: () => invalidate(qc, "calendar.links", "anchors.list", "trips.get", "anchors.conflicts") });
}
