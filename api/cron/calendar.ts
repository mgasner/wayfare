// Vercel Cron, every 6 hours: Google Calendar and ICS feeds into calendar anchors.
import { ensureDriver } from "../../lib/auth.js";
import { cronAllowed, syncAllCalendars } from "../../lib/cron.js";
import { serveInRequest } from "../../lib/db.js";
import { publicFetcher } from "../../lib/public-fetch.js";
import { setFeedFetcher } from "../../server/adapters/ics.js";

const feeds = publicFetcher();

export async function GET(request: Request): Promise<Response> {
  if (!cronAllowed(request)) return Response.json({ error: { code: "no_user", message: "Cron only" } }, { status: 401 });
  ensureDriver();
  setFeedFetcher(feeds);
  return serveInRequest(async () => {
    const { owners, failed, results } = await syncAllCalendars();
    const links = results.flatMap((r) => r.links);
    const summary = {
      owners,
      failed,
      links: links.length,
      linkErrors: links.filter((l) => !l.ok).length,
      created: results.reduce((n, r) => n + r.created, 0),
      updated: results.reduce((n, r) => n + r.updated, 0),
      deleted: results.reduce((n, r) => n + r.deleted, 0),
    };
    console.log(JSON.stringify({ event: "cron.calendar", ...summary }));
    return Response.json(summary);
  });
}
