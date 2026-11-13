import { z } from "zod";
import { attempt, blocked, empty } from "../lib/attempt.js";
import { db, sql, type Statement } from "../lib/nexus.js";
import type { Channel, SlotRead } from "../shared/records.js";
import { meitre, type Meitre } from "./adapters/meitre.js";
import { mesa247, widgetUrl, type Mesa247 } from "./adapters/mesa247.js";
import { isBlocked, type ServiceRead } from "./adapters/slots.js";
import { PlaceRow, SlotReadRow } from "./tables.js";

export const MESA_TIMEOUT_MS = 8_000;
/** A read this recent is returned as is, so a double tap doesn't call the platform twice. */
export const REUSE_MS = 60_000;

type Readable = { channel: Mesa247; adapter: typeof mesa247 } | { channel: Meitre; adapter: typeof meitre };

/** The place's first channel with readable slots: Mesa 24/7, then Meitre. */
export function readableChannel(channels: Channel[]): Readable | null {
  const mesa = channels.find((c): c is Mesa247 => c.type === "mesa247");
  if (mesa) return { channel: mesa, adapter: mesa247 };
  const m = channels.find((c): c is Meitre => c.type === "meitre");
  return m ? { channel: m, adapter: meitre } : null;
}

/** Where a person books when we have no slots to show. */
export function bookingLink(channels: Channel[]): string | null {
  const mesa = channels.find((c): c is Mesa247 => c.type === "mesa247");
  if (mesa) return widgetUrl(mesa);
  const web = channels.find((c) => c.type === "web");
  return web?.type === "web" ? web.url : null;
}

export type DateResult = { date: string; step: "live" | "last_good" | "unknown" | "recent"; reads: SlotRead[]; link: string | null };

/**
 * Reads slots for each date through the ladder live → last_good → unknown and stores live reads in
 * slot_read. One attempt (and its interaction rows) per date.
 */
export async function refreshPlaceSlots(
  placeId: string,
  dates: string[],
  party: number,
  owner: string | null,
  now = Date.now(),
): Promise<DateResult[]> {
  const [places, existing] = await db.execute(
    sql(PlaceRow)`SELECT * FROM place WHERE id = ${placeId}`,
    sql(SlotReadRow)`SELECT * FROM slot_read WHERE place = ${placeId} AND party = ${party}
                     AND date IN (SELECT value FROM json_each(${JSON.stringify(dates)})) ORDER BY date, service`,
  );
  const place = places.rows[0];
  if (!place) return [];
  const readable = readableChannel(place.channels);
  const link = bookingLink(place.channels);
  const stored = new Map<string, SlotRead[]>();
  for (const r of existing.rows) stored.set(r.date, [...(stored.get(r.date) ?? []), r]);
  if (!readable) return dates.map((date) => ({ date, step: "unknown", reads: stored.get(date) ?? [], link }));

  const results = await Promise.all(
    [...new Set(dates)].map(async (date): Promise<DateResult> => {
      const prior = stored.get(date) ?? [];
      const recent = (at: string) => now - Date.parse(at) >= 0 && now - Date.parse(at) < REUSE_MS;
      if (prior.length && prior.every((r) => recent(r.checked_at))) {
        return { date, step: "recent", reads: prior, link };
      }
      const { channel, adapter } = readable;
      const got = await attempt(
        {
          kind: "slots.read",
          channel: adapter.channel,
          place: place.id,
          owner,
          request: { public: adapter.request(channel as never, date, party) },
          timeoutMs: MESA_TIMEOUT_MS,
        },
        [
          [
            "live",
            async (ctx) => {
              if (isBlocked(adapter.channel)) throw blocked(`${adapter.channel} is switched off by BLOCK_CHANNELS`);
              return { reads: await adapter.read(channel as never, date, party, ctx.signal) as ServiceRead[] };
            },
          ],
          [
            "last_good",
            (ctx) => {
              if (!prior.length) return empty;
              ctx.checkedAt(prior.reduce((o, r) => (r.checked_at < o ? r.checked_at : o), prior[0]!.checked_at));
              return { reads: prior as ServiceRead[] };
            },
          ],
          ["unknown", () => ({ reads: [] as ServiceRead[] })],
        ] as const,
      );
      const step = got.step as DateResult["step"];
      if (step !== "live") return { date, step, reads: step === "last_good" ? prior : [], link };
      const reads: SlotRead[] = got.value.reads.map((r) => ({
        place: place.id,
        date,
        party,
        service: r.service,
        times: r.times,
        waitlist: r.waitlist,
        checked_at: got.checkedAt,
        interaction: got.interaction,
      }));
      return { date, step, reads, link };
    }),
  );

  const writes: Statement<never>[] = results
    .filter((r) => r.step === "live")
    .flatMap((r) =>
      r.reads.map(
        (s) => sql`INSERT INTO slot_read (place, date, party, service, times, waitlist, checked_at, interaction)
                   VALUES (${s.place}, ${s.date}, ${s.party}, ${s.service}, ${JSON.stringify(s.times)}, ${JSON.stringify(s.waitlist)}, ${s.checked_at}, ${s.interaction})
                   ON CONFLICT (place, date, party, service) DO UPDATE SET times = excluded.times, waitlist = excluded.waitlist,
                     checked_at = excluded.checked_at, interaction = excluded.interaction`,
      ),
    );
  if (writes.length) await db.execute(...writes);
  return results.sort((a, b) => a.date.localeCompare(b.date));
}

export type SlotTarget = { place: string; party: number; dates: string[] };

const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * What the cron refreshes: for each trip overlapping the next `days` days (from each city's local `today`),
 * the readable places with a meal on it or saved by its owner in its city, over the trip's remaining dates.
 */
export async function slotTargets(today: (tz: string) => string, days = 14): Promise<SlotTarget[]> {
  const [trips] = await db.execute(
    sql(z.object({ id: z.string(), owner: z.string(), city: z.string(), tz: z.string(), start_date: z.string(), end_date: z.string(), party: z.number() }))`
      SELECT trip.id, trip.owner, trip.city, city.tz, trip.start_date, trip.end_date, trip.party
      FROM trip JOIN city ON city.id = trip.city
      WHERE trip.end_date >= date('now', '-1 day') ORDER BY trip.id`,
  );
  const byKey = new Map<string, SlotTarget>();
  for (const t of trips.rows) {
    const from = today(t.tz);
    const to = addDays(from, days - 1);
    const start = t.start_date > from ? t.start_date : from;
    const end = t.end_date < to ? t.end_date : to;
    if (start > end) continue;
    const dates: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
    const [places] = await db.execute(
      sql(z.object({ id: z.string(), channels: z.string() }))`
        SELECT place.id, place.channels FROM place WHERE place.id IN (
          SELECT place FROM meal WHERE trip = ${t.id}
          UNION SELECT save.place FROM save JOIN place p ON p.id = save.place WHERE save.owner = ${t.owner} AND p.city = ${t.city})`,
    );
    for (const p of places.rows) {
      const channels = JSON.parse(p.channels) as Channel[];
      if (!readableChannel(channels)) continue;
      const key = `${p.id}\0${t.party}`;
      const target = byKey.get(key) ?? { place: p.id, party: t.party, dates: [] };
      target.dates = [...new Set([...target.dates, ...dates])].sort();
      byKey.set(key, target);
    }
  }
  return [...byKey.values()].sort((a, b) => a.place.localeCompare(b.place) || a.party - b.party);
}
