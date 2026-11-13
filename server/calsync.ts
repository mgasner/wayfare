import { z } from "zod";
import { db, isToolError, sql, toolError, type Statement } from "../lib/nexus.js";
import type { Anchor } from "../shared/records.js";
import { readGoogle, type CalEvent } from "./adapters/gcal.js";
import { geocode, type CityAreas } from "./adapters/geocode.js";
import { readIcs } from "./adapters/ics.js";
import { airports, parseFlight } from "./airports.js";
import { AnchorRow, TripRow } from "./tables.js";
import { fromMinutes, toMinutes, wallClock, zonedInstant } from "./time.js";

export type LinkResult = { provider: "google" | "ics"; ref: string; ok: boolean; events: number; error: string | null };
export type SyncResult = { links: LinkResult[]; created: number; updated: number; deleted: number };

/** Links synced more recently than this are skipped unless forced. */
const FRESH_MS = 10 * 60_000;
/** Longer timed events (a hotel stay, a "Lima" block) say little about where you are at a given hour. */
const MAX_EVENT_HOURS = 12;

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** The prefix of calendar_event for anchors from one link. */
export function linkKey(provider: string, ref: string): string {
  return `${provider === "google" ? "g" : "i"}${fnv(ref)}`;
}

const Link = z.object({ provider: z.enum(["google", "ics"]), ref: z.string(), credentials: z.string().nullable(), last_sync: z.string().nullable() });
const TripCity = TripRow.extend({ tz: z.string(), bbox: z.string() });
const AreaRow = z.object({ id: z.string(), city: z.string(), name: z.string(), lat: z.number().nullable(), lng: z.number().nullable() });

type Wanted = Pick<Anchor, "date" | "start_time" | "end_time" | "text"> & {
  location: string;
  point: { lat: number; lng: number } | null;
};

/** Where a calendar event puts you during a trip, or null when it doesn't say. */
export function eventAnchor(e: CalEvent, trip: { city: string; start_date: string; end_date: string }, tz: string): Wanted | null {
  const inTrip = (d: string) => d >= trip.start_date && d <= trip.end_date;
  const flight = parseFlight(e.summary, e.location);
  if (flight) {
    const from = flight.from ? airports[flight.from] : undefined;
    const to = flight.to ? airports[flight.to] : undefined;
    if (from?.city === trip.city && from.lat !== undefined && from.lng !== undefined && "instant" in e.start) {
      const local = wallClock(e.start.instant, tz);
      // Domestic flights board in less time than international ones; an unknown destination counts as international.
      const lead = to && to.country === from.country ? 120 : 180;
      const end = toMinutes(local.time);
      return { date: local.date, start_time: fromMinutes(end - lead), end_time: local.time, text: e.summary, location: from.name, point: { lat: from.lat, lng: from.lng } };
    }
    if (to?.city === trip.city && to.lat !== undefined && to.lng !== undefined && e.end && "instant" in e.end) {
      const local = wallClock(e.end.instant, tz);
      const start = toMinutes(local.time);
      return { date: local.date, start_time: local.time, end_time: fromMinutes(start + 60), text: e.summary, location: to.name, point: { lat: to.lat, lng: to.lng } };
    }
    return null;
  }
  if (!e.location.trim() || !("instant" in e.start)) return null;
  const endAt = e.end && "instant" in e.end ? e.end.instant : e.start.instant;
  if (endAt.getTime() - e.start.instant.getTime() > MAX_EVENT_HOURS * 3_600_000) return null;
  const start = wallClock(e.start.instant, tz);
  const end = wallClock(endAt, tz);
  if (!inTrip(start.date)) return null;
  return {
    date: start.date,
    start_time: start.time,
    end_time: end.date === start.date ? end.time : "23:59",
    text: e.summary || e.location,
    location: e.location.trim(),
    point: null,
  };
}

const anchorText = (w: Wanted) => (w.location && w.location !== w.text ? `${w.text} · ${w.location}` : w.text);

/** Reads the owner's calendars for their current and upcoming trips and replaces those trips' calendar anchors. */
export async function syncCalendars(owner: string, options: { trip?: string; force?: boolean } = {}): Promise<SyncResult> {
  const today = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const [links, trips] = await db.execute(
    sql(Link)`SELECT provider, ref, credentials, last_sync FROM calendar_link WHERE owner = ${owner} ORDER BY provider, ref`,
    options.trip
      ? sql(TripCity)`SELECT trip.*, city.tz, city.bbox FROM trip JOIN city ON city.id = trip.city WHERE trip.id = ${options.trip} AND trip.owner = ${owner}`
      : sql(TripCity)`SELECT trip.*, city.tz, city.bbox FROM trip JOIN city ON city.id = trip.city WHERE trip.owner = ${owner} AND trip.end_date >= ${today}`,
  );
  if (options.trip && !trips.rows.length) throw toolError("not_found", `No trip ${options.trip}`);
  const result: SyncResult = { links: [], created: 0, updated: 0, deleted: 0 };
  const now = Date.now();
  const due = links.rows.filter((l) => options.force || !l.last_sync || now - Date.parse(l.last_sync) > FRESH_MS);
  if (!due.length || !trips.rows.length) return result;

  const first = trips.rows[0]!;
  const from = new Date(Math.min(...trips.rows.map((t) => zonedInstant(t.start_date, "00:00", t.tz).getTime())));
  const to = new Date(Math.max(...trips.rows.map((t) => zonedInstant(t.end_date, "23:59", t.tz).getTime())) + 60_000);

  const read = new Map<string, CalEvent[]>();
  for (const link of due) {
    try {
      let events: CalEvent[];
      if (link.provider === "google") {
        const token = link.credentials ? (JSON.parse(link.credentials) as { refresh_token?: string | null }).refresh_token : null;
        if (!token) throw toolError("not_allowed", "Calendar access was not granted; sign in again to allow it");
        events = await readGoogle(token, { from, to }, { owner, city: first.city });
      } else {
        events = await readIcs(link.ref, { owner, city: first.city, tz: first.tz });
      }
      read.set(linkKey(link.provider, link.ref), events);
      result.links.push({ provider: link.provider, ref: link.ref, ok: true, events: events.length, error: null });
    } catch (error) {
      const message = isToolError(error) || error instanceof Error ? error.message : String(error);
      result.links.push({ provider: link.provider, ref: link.ref, ok: false, events: 0, error: message.slice(0, 200) });
    }
  }
  if (!read.size) return result;

  const cities = [...new Set(trips.rows.map((t) => t.city))];
  const [areas, existing] = await db.execute(
    sql(AreaRow)`SELECT id, city, name, lat, lng FROM area WHERE city IN (SELECT value FROM json_each(${JSON.stringify(cities)}))`,
    sql(AnchorRow)`
      SELECT anchor.* FROM anchor JOIN trip ON trip.id = anchor.trip
      WHERE trip.owner = ${owner} AND anchor.source = 'calendar'
        AND anchor.trip IN (SELECT value FROM json_each(${JSON.stringify(trips.rows.map((t) => t.id))}))`,
  );

  const writes: Statement<never>[] = [];
  const stamp = new Date().toISOString();
  for (const trip of trips.rows) {
    const cityAreas: CityAreas = areas.rows.filter((a) => a.city === trip.city);
    const bbox = JSON.parse(trip.bbox) as [number, number, number, number];
    const mine = existing.rows.filter((a) => a.trip === trip.id);
    const byEvent = new Map(mine.map((a) => [a.calendar_event ?? "", a]));
    const seen = new Set<string>();

    for (const [key, events] of read) {
      for (const e of events) {
        const wanted = eventAnchor(e, trip, trip.tz);
        if (!wanted || wanted.date < trip.start_date || wanted.date > trip.end_date) continue;
        const ref = `${key}:${e.id}`;
        if (seen.has(ref)) continue;
        seen.add(ref);
        const text = anchorText(wanted);
        const prior = byEvent.get(ref);
        const same = prior && prior.text === text;
        if (same && prior.date === wanted.date && prior.start_time === wanted.start_time && prior.end_time === wanted.end_time) continue;

        let at: { lat: number | null; lng: number | null; place: string | null; area: string | null };
        if (same) at = prior;
        else if (wanted.point) at = { ...wanted.point, place: null, area: null };
        else at = (await geocode(wanted.location, { owner, city: trip.city, bbox, areas: cityAreas })) ?? { lat: null, lng: null, place: null, area: null };

        if (prior) {
          result.updated++;
          writes.push(sql`
            UPDATE anchor SET date = ${wanted.date}, start_time = ${wanted.start_time}, end_time = ${wanted.end_time}, text = ${text},
              lat = ${at.lat}, lng = ${at.lng}, place = ${at.place}, area = ${at.area}
            WHERE id = ${prior.id}`);
        } else {
          result.created++;
          writes.push(sql`
            INSERT INTO anchor (id, trip, date, start_time, end_time, area, place, lat, lng, source, text, calendar_event)
            VALUES (${crypto.randomUUID()}, ${trip.id}, ${wanted.date}, ${wanted.start_time}, ${wanted.end_time}, ${at.area}, ${at.place},
                    ${at.lat}, ${at.lng}, 'calendar', ${text}, ${ref})`);
        }
      }
    }
    for (const a of mine) {
      const key = a.calendar_event?.split(":")[0] ?? "";
      if (read.has(key) && !seen.has(a.calendar_event ?? "")) {
        result.deleted++;
        writes.push(sql`DELETE FROM anchor WHERE id = ${a.id}`);
      }
    }
  }
  for (const link of due) {
    if (read.has(linkKey(link.provider, link.ref))) {
      writes.push(sql`UPDATE calendar_link SET last_sync = ${stamp} WHERE owner = ${owner} AND provider = ${link.provider} AND ref = ${link.ref}`);
    }
  }
  await db.execute(...writes);
  return result;
}
