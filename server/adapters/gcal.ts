import { z } from "zod";
import { attempt } from "../../lib/attempt.js";
import { env } from "../../lib/env.js";

/** An instant, or a date for all-day events. */
export type When = { instant: Date } | { date: string };
export type CalEvent = { id: string; summary: string; location: string; start: When; end: When | null };

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const Token = z.object({ access_token: z.string() });
const EventTime = z.object({ dateTime: z.string().optional(), date: z.string().optional() });
const Events = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        status: z.string().optional(),
        summary: z.string().optional(),
        location: z.string().optional(),
        start: EventTime.optional(),
        end: EventTime.optional(),
        attendees: z.array(z.object({ self: z.boolean().optional(), responseStatus: z.string().optional() })).optional(),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
});

function when(t: z.infer<typeof EventTime> | undefined): When | null {
  if (t?.dateTime) return { instant: new Date(t.dateTime) };
  if (t?.date) return { date: t.date };
  return null;
}

async function accessToken(refreshToken: string, signal: AbortSignal): Promise<string> {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }).toString(),
    signal,
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Token.parse(await res.json()).access_token;
}

/** Events on the primary calendar between `from` and `to`, skipping cancelled and declined ones. */
export async function readGoogle(
  refreshToken: string,
  range: { from: Date; to: Date },
  options: { owner: string; city: string },
): Promise<CalEvent[]> {
  const result = await attempt(
    {
      kind: "calendar.read",
      channel: "gcal",
      owner: options.owner,
      request: { public: { city: options.city, calendar: "primary" } },
      timeoutMs: 8_000,
    },
    [
      [
        "live",
        async (ctx) => {
          const token = await accessToken(refreshToken, ctx.signal);
          const events: CalEvent[] = [];
          let page: string | undefined;
          for (let i = 0; i < 5; i++) {
            const url = new URL(EVENTS_URL);
            url.search = new URLSearchParams({
              timeMin: range.from.toISOString(),
              timeMax: range.to.toISOString(),
              singleEvents: "true",
              orderBy: "startTime",
              maxResults: "250",
              fields: "items(id,status,summary,location,start,end,attendees(self,responseStatus)),nextPageToken",
              ...(page ? { pageToken: page } : {}),
            }).toString();
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: ctx.signal });
            if (!res.ok) throw new Error(`events ${res.status}: ${(await res.text()).slice(0, 200)}`);
            const body = Events.parse(await res.json());
            for (const e of body.items) {
              const start = when(e.start);
              const declined = e.attendees?.some((a) => a.self && a.responseStatus === "declined");
              if (!start || e.status === "cancelled" || declined) continue;
              events.push({ id: e.id, summary: e.summary ?? "", location: e.location ?? "", start, end: when(e.end) });
            }
            page = body.nextPageToken;
            if (!page) break;
          }
          ctx.note({ events: events.length });
          return events;
        },
      ],
    ],
  );
  return result.value;
}
