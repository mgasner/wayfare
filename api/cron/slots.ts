// Vercel Cron, every 15 minutes: live slot reads for places on trips in the next 14 days.
import { ensureDriver } from "../../lib/auth.js";
import { serveInRequest } from "../../lib/db.js";
import { blockedChannelsFromEnv, setBlockedChannels } from "../../server/adapters/slots.js";
import { refreshPlaceSlots, slotTargets } from "../../server/slots.js";

const CONCURRENCY = 4;

export function localDate(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: { code: "no_user", message: "Cron only" } }, { status: 401 });
  }
  ensureDriver();
  setBlockedChannels(blockedChannelsFromEnv(process.env.BLOCK_CHANNELS));
  return serveInRequest(async () => {
    const targets = await slotTargets((tz) => localDate(tz));
    const steps: Record<string, number> = {};
    const queue = [...targets];
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const results = await refreshPlaceSlots(t.place, t.dates, t.party, null).catch((error: unknown) => {
          console.error(JSON.stringify({ event: "cron.slots.failed", place: t.place, error: String(error) }));
          return [];
        });
        for (const r of results) steps[r.step] = (steps[r.step] ?? 0) + 1;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const summary = { places: targets.length, dates: targets.reduce((n, t) => n + t.dates.length, 0), steps };
    console.log(JSON.stringify({ event: "cron.slots", ...summary }));
    return Response.json(summary);
  });
}
