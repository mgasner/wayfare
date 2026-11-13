import { StepFailure } from "../../lib/attempt.js";
import type { Channel } from "../../shared/records.js";
import { getJson, HHMM, sortedUnique, type ServiceRead, type SlotAdapter } from "./slots.js";

export type Meitre = Extract<Channel, { type: "meitre" }>;

export const SERVICES = ["lunch", "dinner"] as const;

export function searchUrl(c: Meitre, date: string, party: number, service: string): string {
  const venue = encodeURIComponent(String(c.venue_id));
  return `https://api.meitre.com/api/search-all-hours/${venue}/${party}/${date}/${service}/${venue}`;
}

type Side = { closedNoResults?: boolean; slots?: { hour?: unknown; type?: unknown }[] | null };

/**
 * `center` is the requested day (`left` and `right` are its neighbors). A slot of type "No" is taken;
 * any other type ("traditional", "no_show" for a card guarantee) is bookable. Taken slots count as
 * waitlist times when the venue shows its waiting list.
 */
export function parse(body: unknown, service: string): ServiceRead {
  const b = body as { center?: Side; generalInfo?: { showWaitingList?: boolean | null } } | null;
  if (!b?.center) throw new StepFailure("error", "Meitre: no center in response");
  const slots = (b.center.slots ?? []).filter((s): s is { hour: string; type: unknown } => typeof s.hour === "string" && HHMM.test(s.hour));
  const taken = slots.filter((s) => s.type === "No").map((s) => s.hour);
  const open = slots.filter((s) => s.type !== "No").map((s) => s.hour);
  return { service, times: sortedUnique(open), waitlist: b.generalInfo?.showWaitingList ? sortedUnique(taken) : [] };
}

export const meitre: SlotAdapter<Meitre> = {
  channel: "meitre",
  request: (c, date, party) => ({ venue_id: c.venue_id, date, party, services: [...SERVICES] }),
  async read(c, date, party, signal) {
    return Promise.all(SERVICES.map(async (service) => parse(await getJson(searchUrl(c, date, party, service), {}, signal), service)));
  },
};
