import type { Json } from "../../lib/attempt.js";
import { blocked, StepFailure } from "../../lib/attempt.js";
import type { Channel } from "../../shared/records.js";

/** One service's times from a booking platform; `service` is "" when the platform reads the whole day at once. */
export type ServiceRead = { service: string; times: string[]; waitlist: string[] };

export type SlotAdapter<C extends Channel> = {
  channel: C["type"];
  /** What goes in interaction.request: no personal data, only the venue and the query. */
  request(c: C, date: string, party: number): { [key: string]: Json };
  read(c: C, date: string, party: number, signal: AbortSignal): Promise<ServiceRead[]>;
};

// Set by the Node adapters from BLOCK_CHANNELS, so a channel can be switched off without a deploy of code.
let blockedChannels = new Set<string>();

export function setBlockedChannels(channels: Iterable<string>): void {
  blockedChannels = new Set(channels);
}

export function isBlocked(channel: string): boolean {
  return blockedChannels.has(channel);
}

export function blockedChannelsFromEnv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** GETs JSON; 403 and 429 count as blocked, other non-2xx as errors. */
export async function getJson(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (dining-planner)", Accept: "application/json", ...headers }, signal });
  if (res.status === 403 || res.status === 429) throw blocked(`HTTP ${res.status}`);
  if (!res.ok) throw new StepFailure("error", `HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StepFailure(/captcha|cloudflare/i.test(text) ? "blocked" : "error", `Not JSON: ${text.slice(0, 80)}`);
  }
}

export const sortedUnique = (xs: string[]) => [...new Set(xs)].sort();

export const HHMM = /^\d{2}:\d{2}$/;
