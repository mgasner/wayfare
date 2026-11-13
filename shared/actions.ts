import { z } from "zod";
import { FactValues } from "./facts.js";
import { Budget, FactField, HHMM, IsoDate, MealStatus } from "./records.js";

/** Where the person was when they spoke or typed. */
export const InputContext = z.object({
  screen: z.string(),
  trip: z.string().optional(),
  date: IsoDate.optional(),
  place: z.string().optional(),
  /** The speaker's local date on their device; weekdays resolve from it. */
  today: IsoDate.optional(),
});
export type InputContext = z.infer<typeof InputContext>;

export const Change = z.object({
  kind: z.enum(["anchor", "save", "fact", "meal", "trip"]),
  op: z.enum(["created", "updated", "deleted"]),
  record: z.unknown(),
});
export type Change = z.infer<typeof Change>;

/** `undo` is "" when nothing changed. */
export const InterpretResult = z.object({ changes: z.array(Change), undo: z.string() });
export type InterpretResult = z.infer<typeof InterpretResult>;

/** What POST /api/voice returns. */
export const VoiceResult = InterpretResult.extend({ transcript: z.string() });
export type VoiceResult = z.infer<typeof VoiceResult>;

// What interpretation produces. The model fills these; the server resolves names and applies them.

export const PlaceMention = z.object({
  id: z.string().nullable().describe("The id from known_places when the mention is one of them, else null"),
  name: z.string().describe("The name as the person said it, spelled correctly"),
});
export type PlaceMention = z.infer<typeof PlaceMention>;

const text = z.string().describe("The words from the input this action comes from");

export const AddAnchor = z.object({
  type: z.literal("add_anchor"),
  date: IsoDate,
  start_time: HHMM.nullable(),
  end_time: HHMM.nullable(),
  area: z.string().nullable().describe("An area id from areas"),
  place: PlaceMention.nullable().describe("A specific place they'll be at, if any"),
  text,
});

export const AddSave = z.object({
  type: z.literal("add_save"),
  place: PlaceMention,
  area: z.string().nullable().describe("An area id, if said, for a place not in known_places"),
  note: z.string().nullable().describe("What to remember: dishes, timing, who suggested it. Short, in the person's language"),
  source: z.string().nullable().describe("Who or what recommended it: friend, Reddit, a guide"),
});

const factPlace = PlaceMention.nullable().describe("null means the place in view");

/** One variant per field, so the model sees each field's value shape. */
export const AddFact = z.union(
  FactField.options.map((field) =>
    z.object({
      type: z.literal("add_fact"),
      place: factPlace,
      field: z.literal(field),
      value: (FactValues[field] as z.ZodType).describe("The whole new value; keep the parts of the current one that didn't change"),
    }),
  ) as unknown as [z.ZodObject<{ type: z.ZodLiteral<"add_fact">; place: typeof factPlace; field: z.ZodLiteral<FactField>; value: z.ZodType }>],
);

export const SetMeal = z.object({
  type: z.literal("set_meal"),
  place: PlaceMention,
  date: IsoDate,
  slot: z.enum(["lunch", "dinner", "other"]),
  time: HHMM.nullable(),
  status: MealStatus.describe("booked or reserved is confirmed; asked for a table is requested; would like to go is want"),
  note: z.string().nullable(),
});

export const UpdateTrip = z.object({
  type: z.literal("update_trip"),
  start_date: IsoDate.nullable(),
  end_date: IsoDate.nullable(),
  party: z.number().int().min(1).max(20).nullable(),
  budget: Budget.nullable(),
  diet: z.array(z.string()).nullable(),
});

export const Action = z.union([AddAnchor, AddSave, AddFact, SetMeal, UpdateTrip]);
export type Action = z.infer<typeof Action>;

export const Interpretation = z.object({ actions: z.array(Action) });
export type Interpretation = z.infer<typeof Interpretation>;
