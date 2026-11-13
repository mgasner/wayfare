import { z } from "zod";
import { syncCalendars, type SyncResult } from "../server/calsync.js";
import { db, sql } from "./nexus.js";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; with no secret set, nothing passes. */
export function cronAllowed(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Syncs every person with a calendar link and a current or upcoming trip. */
export async function syncAllCalendars(): Promise<{ owners: number; failed: number; results: SyncResult[] }> {
  const today = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const [{ rows }] = await db.execute(sql(z.object({ owner: z.string() }))`
    SELECT DISTINCT calendar_link.owner FROM calendar_link
    WHERE EXISTS (SELECT 1 FROM trip WHERE trip.owner = calendar_link.owner AND trip.end_date >= ${today})`);
  const results: SyncResult[] = [];
  let failed = 0;
  for (const { owner } of rows) {
    try {
      results.push(await syncCalendars(owner, { force: true }));
    } catch (error) {
      failed++;
      console.error(JSON.stringify({ event: "cron.calendar_failed", owner, error: String(error) }));
    }
  }
  return { owners: rows.length, failed, results };
}
