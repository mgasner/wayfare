import { attempt } from "../../lib/attempt.js";
import { isToolError, toolError } from "../../lib/nexus.js";
import { zonedInstant } from "../time.js";
import type { CalEvent, When } from "./gcal.js";

function unescape(text: string): string {
  return text.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

type Prop = { name: string; params: Record<string, string>; value: string };

function parseLine(line: string): Prop | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [name, ...rest] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name!.toUpperCase(), params, value: line.slice(colon + 1) };
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function when(p: Prop, fallbackTz: string): When | null {
  const v = p.value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (date || p.params.VALUE === "DATE") {
    const d = date ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    return d ? { date: `${d[1]}-${d[2]}-${d[3]}` } : null;
  }
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!t) return null;
  const [, y, mo, d, h, mi, , z] = t;
  if (z) return { instant: new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!)) };
  // Floating times and zones Intl doesn't know (Windows names) read as the city's.
  const tz = p.params.TZID && validZone(p.params.TZID) ? p.params.TZID : fallbackTz;
  return { instant: zonedInstant(`${y}-${mo}-${d}`, `${h}:${mi}`, tz) };
}

/** VEVENTs of an iCalendar file. Recurring events contribute their first occurrence only. */
export function parseIcs(text: string, tz: string): CalEvent[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events: CalEvent[] = [];
  let current: Prop[] | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = [];
    else if (line === "END:VEVENT" && current) {
      const get = (name: string) => current!.find((p) => p.name === name);
      const uid = get("UID")?.value;
      const start = get("DTSTART");
      const status = get("STATUS")?.value.toUpperCase();
      const startAt = start ? when(start, tz) : null;
      if (uid && startAt && status !== "CANCELLED") {
        const end = get("DTEND");
        events.push({
          id: uid + (get("RECURRENCE-ID")?.value ?? ""),
          summary: unescape(get("SUMMARY")?.value ?? ""),
          location: unescape(get("LOCATION")?.value ?? ""),
          start: startAt,
          end: end ? when(end, tz) : null,
        });
      }
      current = null;
    } else if (current) {
      const p = parseLine(line);
      if (p) current.push(p);
    }
  }
  return events;
}

export function normalizeFeedUrl(url: string): string {
  return url.trim().replace(/^webcals?:\/\//i, "https://");
}

/** Fetches a user-given URL; the host's fetcher refuses non-public addresses and caps size and redirects. */
export type FeedFetcher = (url: URL, init: { signal: AbortSignal; accept: string }) => Promise<{ status: number; body: string }>;

// The runtime's fetch can't see which address a name resolves to, so the host injects a guarded one.
let feedFetcher: FeedFetcher | null = null;

export function setFeedFetcher(fetcher: FeedFetcher | null): void {
  feedFetcher = fetcher;
}

/** What the user sees for any feed failure; the reason stays in the interaction log. */
export const FEED_UNREADABLE = "Could not read that calendar";

/** Events in a published ICS feed. */
export async function readIcs(url: string, options: { owner: string; city: string; tz: string }): Promise<CalEvent[]> {
  const feed = new URL(normalizeFeedUrl(url));
  const fetcher = feedFetcher;
  if (!fetcher) throw toolError("unavailable", "ICS feeds are not available on this host");
  try {
    return await readWith(fetcher, feed, options);
  } catch (error) {
    if (isToolError(error, "unavailable")) throw toolError("unavailable", FEED_UNREADABLE);
    throw error;
  }
}

async function readWith(fetcher: FeedFetcher, feed: URL, options: { owner: string; city: string; tz: string }): Promise<CalEvent[]> {
  const result = await attempt(
    {
      kind: "calendar.read",
      channel: "ics",
      owner: options.owner,
      request: { public: { city: options.city, host: feed.host }, private: { url: feed.toString() } },
      timeoutMs: 8_000,
    },
    [
      [
        "live",
        async (ctx) => {
          const res = await fetcher(feed, { accept: "text/calendar", signal: ctx.signal });
          if (res.status < 200 || res.status >= 300) throw new Error(`ics ${res.status}`);
          const text = res.body;
          if (!text.includes("BEGIN:VCALENDAR")) throw new Error("not an iCalendar feed");
          const events = parseIcs(text, options.tz);
          ctx.note({ events: events.length, bytes: text.length });
          return events;
        },
      ],
    ],
  );
  return result.value;
}
