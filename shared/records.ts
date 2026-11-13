import { z } from "zod";

// Records as the server returns them: JSON columns parsed, integer flags as booleans.
// Column names match db/migrations exactly.

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const HHMM = z.string().regex(/^\d{2}:\d{2}$/);
export const Instant = z.string(); // ISO 8601 UTC

export const LatLng = z.object({ lat: z.number(), lng: z.number() });

export const Channel = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mesa247"), host: z.string(), slug: z.string(), local_id: z.number().int(), consumption_id: z.number().int().optional() }),
  z.object({ type: z.literal("meitre"), venue_id: z.number().int() }),
  z.object({ type: z.literal("whatsapp"), number: z.string() }),
  z.object({ type: z.literal("sms"), number: z.string() }),
  z.object({ type: z.literal("email"), address: z.string() }),
  z.object({ type: z.literal("phone"), number: z.string() }),
  z.object({ type: z.literal("web"), url: z.string() }),
  z.object({ type: z.literal("walk_in") }),
]);
export type Channel = z.infer<typeof Channel>;

export const Link = z.object({ label: z.string(), url: z.string() });

export const CityConfig = z.object({
  platforms: z.array(z.object({ name: z.string(), notes: z.string() })),
  messaging: z.array(z.string()), // whatsapp, sms, line, kakaotalk
  closures: z.string(), // free text, e.g. "Most fine dining closes Sunday dinner and Monday"
  release_norms: z.string(),
  card_notes: z.string(),
  tipping: z.string().optional(),
});

export const City = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  tz: z.string(),
  currency: z.string(),
  languages: z.array(z.string()),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), // w, s, e, n
  config: CityConfig,
});
export type City = z.infer<typeof City>;

export const Stop = z.object({ name: z.string(), kind: z.string(), note: z.string(), lat: z.number().optional(), lng: z.number().optional(), url: z.string().optional() });

export const Area = z.object({
  id: z.string(),
  city: z.string(),
  name: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  polygon: z.unknown().nullable(), // GeoJSON Polygon
  brief: z.string().nullable(),
  stops: z.array(Stop),
});
export type Area = z.infer<typeof Area>;

export const PlaceKind = z.enum(["reserve_ahead", "bookable", "walk_in", "informal"]);
export type PlaceKind = z.infer<typeof PlaceKind>;

export const Place = z.object({
  id: z.string(),
  city: z.string(),
  area: z.string().nullable(),
  name: z.string(),
  kind: PlaceKind.nullable(), // null: uncurated Overture row
  google_place_id: z.string().nullable(),
  overture_id: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  channels: z.array(Channel),
  summary: z.string().nullable(),
  links: z.array(Link),
  curated: z.boolean(),
});
export type Place = z.infer<typeof Place>;

export const FactField = z.enum(["status", "hours", "price_pp", "menu", "deposit_policy", "closures", "cuisine", "dishes", "dress", "notes"]);
export type FactField = z.infer<typeof FactField>;

export const Fact = z.object({
  place: z.string(),
  field: FactField,
  value: z.unknown(),
  source: z.string(), // research | overture | live:<channel> | user:<user id>
  checked_at: Instant,
});
export type Fact = z.infer<typeof Fact>;

export const SlotRead = z.object({
  place: z.string(),
  date: IsoDate,
  party: z.number().int(),
  service: z.string(),
  times: z.array(HHMM),
  waitlist: z.array(HHMM),
  checked_at: Instant,
  interaction: z.string(),
});
export type SlotRead = z.infer<typeof SlotRead>;

export const User = z.object({ id: z.string(), email: z.string(), name: z.string(), picture: z.string().nullable() });
export type User = z.infer<typeof User>;

export const Base = z.object({ name: z.string(), lat: z.number(), lng: z.number() });
export const Appetite = z.object({ tastings: z.number().int(), sit_down: z.number().int(), lunch_main: z.boolean() });
export const Budget = z.object({ per_person: z.number(), currency: z.string() });
export const Diet = z.array(z.string());
export const BookingProfile = z.object({ passport_on_file: z.boolean(), card_on_file: z.boolean(), whatsapp_fallback: z.boolean() });

export const Trip = z.object({
  id: z.string(),
  owner: z.string(),
  city: z.string(),
  start_date: IsoDate,
  end_date: IsoDate,
  party: z.number().int(),
  base: Base,
  appetite: Appetite.nullable(),
  budget: Budget.nullable(),
  diet: Diet.nullable(),
  booking: BookingProfile.nullable(),
  refresh: z.string(),
  created_at: Instant,
});
export type Trip = z.infer<typeof Trip>;

export const Anchor = z.object({
  id: z.string(),
  trip: z.string(),
  date: IsoDate,
  start_time: HHMM.nullable(),
  end_time: HHMM.nullable(),
  area: z.string().nullable(),
  place: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  source: z.enum(["hint", "calendar"]),
  text: z.string().nullable(),
  calendar_event: z.string().nullable(),
});
export type Anchor = z.infer<typeof Anchor>;

export const MealStatus = z.enum(["want", "requested", "confirmed", "waitlist", "failed", "skipped"]);
export const Meal = z.object({
  id: z.string(),
  trip: z.string(),
  place: z.string(),
  date: IsoDate,
  slot: z.enum(["lunch", "dinner", "other"]),
  time: HHMM.nullable(),
  status: MealStatus,
  channel: z.string().nullable(),
  note: z.string().nullable(),
  updated_at: Instant,
});
export type Meal = z.infer<typeof Meal>;

export const Save = z.object({
  owner: z.string(),
  place: z.string(),
  source: z.string().nullable(),
  note: z.string().nullable(),
  notify_nearby: z.boolean(),
  created_at: Instant,
});
export type Save = z.infer<typeof Save>;

// Views the UI reads. Facts are reduced to the newest value per field that the viewer may see.

export const FactView = z.object({ value: z.unknown(), source: z.string(), checked_at: Instant });
export type FactView = z.infer<typeof FactView>;

export const PlaceCard = Place.extend({
  facts: z.partialRecord(FactField, FactView),
  slots: z.array(SlotRead), // latest read per date for the trip's party
  saved: z.boolean(),
});
export type PlaceCard = z.infer<typeof PlaceCard>;

export const TripView = z.object({
  trip: Trip,
  city: City,
  areas: z.array(Area),
  meals: z.array(Meal),
  anchors: z.array(Anchor),
  places: z.array(PlaceCard), // every place referenced by meals
});
export type TripView = z.infer<typeof TripView>;
