import { z } from "zod";
import { FactField, HHMM } from "./records.js";

// Value shapes per fact field, as the research pass, the agent API and user reports write them,
// and as ui/src/data/facts.ts reads them.

export const PlaceStatus = z.enum(["open", "closed", "temporarily_closed"]);

export const HoursValue = z.object({
  text: z.string(),
  /** 0 = Sunday. */
  closed_days: z.array(z.number().int().min(0).max(6)).default([]),
  closes: HHMM.optional(),
});

export const PriceValue = z.object({ usd: z.number().nullable(), text: z.string() });

export const MenuValue = z.object({
  name: z.string().optional(),
  items: z.array(z.object({ name: z.string(), description: z.string().nullable().optional(), price: z.string().nullable().optional() })),
  as_of: z.string().optional(),
  source_url: z.string().optional(),
});

export const Review = z.object({ rating: z.number().nullable(), count: z.number().int().nullable(), summary: z.string().nullable() });

export const NotesValue = z.object({
  tier: z.string().optional(),
  format: z.string().optional(),
  pros: z.array(z.string()).optional(),
  cons: z.array(z.string()).optional(),
  accolades: z.array(z.string()).optional(),
  chef: z.string().nullable().optional(),
  how_to_book: z.string().nullable().optional(),
  reviews: z.record(z.string(), Review).optional(),
});

export const FactValues = {
  status: PlaceStatus,
  hours: HoursValue,
  price_pp: PriceValue,
  menu: MenuValue,
  deposit_policy: z.string(),
  closures: z.string(),
  cuisine: z.string(),
  dishes: z.array(z.string()),
  dress: z.string(),
  notes: NotesValue,
} as const satisfies Record<FactField, z.ZodType>;

/** Checks `value` against its field's shape; returns the parsed value or the first issue. */
export function parseFactValue(field: FactField, value: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  const parsed = (FactValues[field] as z.ZodType).safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, message: `${field}${issue?.path.length ? "." + issue.path.join(".") : ""}: ${issue?.message ?? "invalid"}` };
}

/** Sources a shared (non-user) fact can have. */
export const SharedSource = z.string().regex(/^(research|overture|live:[a-z0-9.]+)$/);
