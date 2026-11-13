import { StepFailure } from "../../lib/attempt.js";
import type { Channel } from "../../shared/records.js";
import { getJson, HHMM, sortedUnique, type ServiceRead, type SlotAdapter } from "./slots.js";

export type Mesa247 = Extract<Channel, { type: "mesa247" }>;

const host = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function widgetUrl(c: Mesa247): string {
  return `https://${c.host}/reservas/${encodeURIComponent(c.slug)}`;
}

export function searchUrl(c: Mesa247, date: string, party: number): string {
  if (!host.test(c.host)) throw new StepFailure("error", `Bad Mesa 24/7 host ${c.host}`);
  const q = new URLSearchParams({
    language: "es",
    country_code: "PE",
    local_id: String(c.local_id),
    type_reservation: "widget",
    paxs: String(party),
    date,
    response: "hours",
    from: "gateway",
  });
  if (c.consumption_id !== undefined) q.set("type_consumption_id", String(c.consumption_id));
  return `https://${c.host}/reservas/_api/v2cal/search?${q}`;
}

type Hour = { hour?: unknown; available?: unknown; waitlist?: unknown };

/** `available == "1"` is a bookable time; otherwise `waitlist == "1"` is a time you can wait-list for. */
export function parse(body: unknown): ServiceRead[] {
  const locals = (body as { locals?: { hours?: Hour[] }[] } | null)?.locals;
  if (!Array.isArray(locals)) throw new StepFailure("error", "Mesa 24/7: no locals in response");
  const hours = (locals[0]?.hours ?? []).filter((h): h is Hour & { hour: string } => typeof h.hour === "string" && HHMM.test(h.hour));
  const times = hours.filter((h) => String(h.available) === "1").map((h) => h.hour);
  const waitlist = hours.filter((h) => String(h.available) !== "1" && String(h.waitlist) === "1").map((h) => h.hour);
  return [{ service: "", times: sortedUnique(times), waitlist: sortedUnique(waitlist) }];
}

export const mesa247: SlotAdapter<Mesa247> = {
  channel: "mesa247",
  request: (c, date, party) => ({ host: c.host, local_id: c.local_id, date, party }),
  async read(c, date, party, signal) {
    return parse(await getJson(searchUrl(c, date, party), { Referer: widgetUrl(c) }, signal));
  },
};
