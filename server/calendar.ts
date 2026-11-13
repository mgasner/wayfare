import { z } from "zod";
import { db, mutation, person, query, sql, toolError } from "../lib/nexus.js";
import { normalizeFeedUrl } from "./adapters/ics.js";
import { linkKey, syncCalendars, type SyncResult } from "./calsync.js";

export type CalendarLink = { provider: "google" | "ics"; ref: string; last_sync: string | null };

const LinkRow = z.object({ provider: z.enum(["google", "ics"]), ref: z.string(), last_sync: z.string().nullable() });

/** The signed-in person's calendars: Google from sign-in, ICS feeds they added. */
export const links = query({
  input: z.object({}),
  async handler(_, context): Promise<CalendarLink[]> {
    const me = person(context);
    const [{ rows }] = await db.execute(sql(LinkRow)`
      SELECT provider, ref, last_sync FROM calendar_link WHERE owner = ${me.id} ORDER BY provider, ref`);
    return rows;
  },
});

/** Reads calendars into calendar anchors. The UI calls it on open; links synced in the last 10 minutes wait unless `force`. */
export const sync = mutation({
  input: z.object({ trip: z.string().optional(), force: z.boolean().default(false) }),
  async handler({ trip, force }, context): Promise<SyncResult> {
    const me = person(context);
    return syncCalendars(me.id, { trip, force });
  },
});

const FeedUrl = z
  .string()
  .transform(normalizeFeedUrl)
  .pipe(z.url({ protocol: /^https$/, hostname: z.regexes.domain }));

/** Adds an ICS feed (https or webcal) and syncs it. */
export const addIcs = mutation({
  input: z.object({ url: FeedUrl }),
  async handler({ url }, context): Promise<SyncResult> {
    const me = person(context);
    await db.execute(sql`
      INSERT INTO calendar_link (owner, provider, ref) VALUES (${me.id}, 'ics', ${url})
      ON CONFLICT (owner, provider, ref) DO NOTHING`);
    const result = await syncCalendars(me.id, { force: true });
    const feed = result.links.find((l) => l.provider === "ics" && l.ref === url);
    if (feed && !feed.ok) {
      await db.execute(sql`DELETE FROM calendar_link WHERE owner = ${me.id} AND provider = 'ics' AND ref = ${url}`);
      throw toolError("invalid_input", `Could not read that calendar: ${feed.error ?? "unknown error"}`);
    }
    return result;
  },
});

/** Removes an ICS feed and the anchors it made. */
export const removeIcs = mutation({
  input: z.object({ url: z.string() }),
  async handler({ url }, context): Promise<{ ok: true }> {
    const me = person(context);
    const ref = normalizeFeedUrl(url);
    await db.execute(
      sql`DELETE FROM anchor WHERE source = 'calendar' AND calendar_event LIKE ${`${linkKey("ics", ref)}:%`}
          AND trip IN (SELECT id FROM trip WHERE owner = ${me.id})`,
      sql`DELETE FROM calendar_link WHERE owner = ${me.id} AND provider = 'ics' AND ref = ${ref}`,
    );
    return { ok: true };
  },
});
