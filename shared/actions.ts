import { z } from "zod";
import { IsoDate } from "./records.js";

/** Where the person was when they spoke or typed. */
export const InputContext = z.object({
  screen: z.string(),
  trip: z.string().optional(),
  date: IsoDate.optional(),
  place: z.string().optional(),
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
