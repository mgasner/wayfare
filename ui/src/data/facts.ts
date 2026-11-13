import type { FactView, PlaceCard, PlaceKind, SlotRead } from "../../../shared/records";
import { serviceOf } from "../lib/dates";

import type { z } from "zod";
import type { HoursValue, MenuValue, NotesValue, PriceValue } from "../../../shared/facts.js";

// Readers for the fact value shapes in shared/facts.ts. The server validates writes against
// them; these still tolerate a missing or malformed value so one bad row can't break a screen.

export type Hours = z.infer<typeof HoursValue>;
export type Notes = z.infer<typeof NotesValue>;
export type MenuFact = z.infer<typeof MenuValue>;
type Price = z.infer<typeof PriceValue>;

export function hours(p: PlaceCard): (Hours & { fact: FactView }) | null {
  const f = p.facts.hours;
  const v = f?.value as Partial<Hours> | null | undefined;
  if (!f || !v || typeof v !== "object") return null;
  return { text: v.text ?? "", closed_days: v.closed_days ?? [], ...(v.closes ? { closes: v.closes } : {}), fact: f };
}

export function priceUsd(p: PlaceCard): number | null {
  return (p.facts.price_pp?.value as Partial<Price> | undefined)?.usd ?? null;
}

/** "closed" and "temporarily_closed" both mean no table. */
export const isClosed = (p: PlaceCard) => typeof p.facts.status?.value === "string" && p.facts.status.value !== "open";

export function cuisine(p: PlaceCard): string | null {
  const v = p.facts.cuisine?.value;
  return typeof v === "string" ? v : null;
}

export function notes(p: PlaceCard): Notes {
  const v = p.facts.notes?.value;
  return v && typeof v === "object" ? (v as Notes) : {};
}

export function menu(p: PlaceCard): MenuFact | null {
  const v = p.facts.menu?.value as MenuFact | null | undefined;
  return v && Array.isArray(v.items) ? v : null;
}

const TIER_LABEL: Record<string, string> = {
  "destination-tasting": "Destination tasting",
  "fine-dining": "Fine dining",
  "upscale-a-la-carte": "Upscale à la carte",
  "off-the-beaten-path": "Off the beaten path",
};

const KIND_LABEL: Record<PlaceKind, string> = {
  reserve_ahead: "Book ahead",
  bookable: "Bookable",
  walk_in: "Walk-in",
  informal: "Informal",
};

export const kindLabel = (k: PlaceKind | null) => (k ? KIND_LABEL[k] : "Uncurated");

/** "Destination tasting" from research notes, else the booking kind. */
export const tierLabel = (p: PlaceCard) => TIER_LABEL[notes(p).tier ?? ""] ?? kindLabel(p.kind);

export const isWalkInKind = (k: PlaceKind | null) => k === "walk_in" || k === "informal";

const CHANNEL_LABEL: Record<string, string> = { mesa247: "Mesa 24/7", meitre: "Meitre", whatsapp: "WhatsApp", sms: "SMS", email: "Email", phone: "Phone", web: "Website", walk_in: "Walk-in" };

/** How you'd book it: the first online channel, else WhatsApp, else walk-in. */
export function primaryChannel(p: PlaceCard): string {
  const order = ["mesa247", "meitre", "whatsapp", "walk_in", "phone", "email", "web"];
  const types = p.channels.map((c) => c.type as string);
  const t = order.find((o) => types.includes(o));
  return t ? CHANNEL_LABEL[t]! : "—";
}

export const channelLabel = (t: string) => CHANNEL_LABEL[t] ?? t;

export interface DaySlots {
  date: string;
  lunch: string[];
  dinner: string[];
  waitLunch: string[];
  waitDinner: string[];
  read: SlotRead;
}

export function slotsByDay(p: PlaceCard): Map<string, DaySlots> {
  const m = new Map<string, DaySlots>();
  for (const s of p.slots) {
    const d = m.get(s.date) ?? { date: s.date, lunch: [], dinner: [], waitLunch: [], waitDinner: [], read: s };
    for (const t of s.times) d[serviceOf(t)].push(t);
    for (const t of s.waitlist) (serviceOf(t) === "lunch" ? d.waitLunch : d.waitDinner).push(t);
    if (s.checked_at < d.read.checked_at) d.read = s;
    m.set(s.date, d);
  }
  return m;
}

/** Oldest checked_at among the place's slot reads: what the clock should show. */
export function slotsCheckedAt(p: PlaceCard): string | null {
  return p.slots.reduce<string | null>((o, s) => (!o || s.checked_at < o ? s.checked_at : o), null);
}
