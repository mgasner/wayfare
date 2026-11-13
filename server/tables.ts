import { z } from "zod";
import { table } from "../lib/nexus.js";
import { Anchor, Area, City, Fact, Meal, Place, Save, SlotRead, Trip, User } from "../shared/records.js";

// Columns as stored (db/migrations), declared with table(). JSON columns are strings.

const text = z.string();
const maybeText = z.string().nullable();
const real = z.number().nullable();
const int = z.number().int();

export const city = table(
  "city",
  z.object({ id: text, name: text, country: text, tz: text, currency: text, languages: text, bbox: text, config: text }),
  { key: ["id"] },
);

export const area = table(
  "area",
  z.object({ id: text, city: text, name: text, lat: real, lng: real, polygon: maybeText, brief: maybeText, stops: text.default("[]") }),
  { key: ["id"] },
);

export const place = table(
  "place",
  z.object({
    id: text,
    city: text,
    area: maybeText,
    name: text,
    kind: maybeText,
    google_place_id: maybeText,
    overture_id: maybeText,
    lat: real,
    lng: real,
    channels: text.default("[]"),
    summary: maybeText,
    links: text.default("[]"),
    curated: int.default(0),
  }),
  { key: ["id"] },
);

export const fact = table(
  "fact",
  z.object({ place: text, field: text, value: text, source: text, checked_at: text }),
  { key: ["place", "field", "source"] },
);

export const slotRead = table(
  "slot_read",
  z.object({
    place: text,
    date: text,
    party: int,
    service: text.default(""),
    times: text,
    waitlist: text.default("[]"),
    checked_at: text,
    interaction: text,
  }),
  { key: ["place", "date", "party", "service"] },
);

export const appUser = table(
  "app_user",
  z.object({ id: text, email: text, name: text, picture: maybeText, created_at: text }),
  { key: ["id"], people: ["email", "name", "picture"] },
);

export const trip = table(
  "trip",
  z.object({
    id: text,
    owner: text,
    city: text,
    start_date: text,
    end_date: text,
    party: int,
    base: text,
    appetite: maybeText,
    budget: maybeText,
    diet: maybeText,
    booking: maybeText,
    refresh: text.default("standard"),
    created_at: text,
  }),
  { key: ["id"] },
);

export const anchor = table(
  "anchor",
  z.object({
    id: text,
    trip: text,
    date: text,
    start_time: maybeText,
    end_time: maybeText,
    area: maybeText,
    place: maybeText,
    lat: real,
    lng: real,
    source: text,
    text: maybeText,
    calendar_event: maybeText,
  }),
  { key: ["id"] },
);

export const meal = table(
  "meal",
  z.object({
    id: text,
    trip: text,
    place: text,
    date: text,
    slot: text,
    time: maybeText,
    status: text,
    channel: maybeText,
    note: maybeText,
    updated_at: text,
  }),
  { key: ["id"] },
);

export const save = table(
  "save",
  z.object({
    owner: text,
    place: text,
    source: maybeText,
    note: maybeText,
    notify_nearby: int.default(0),
    created_at: text,
  }),
  { key: ["owner", "place"] },
);

export const interaction = table(
  "interaction",
  z.object({
    id: text,
    parent: maybeText,
    at: text,
    owner: maybeText,
    place: maybeText,
    channel: text,
    kind: text,
    outcome: text,
    error: maybeText,
    latency_ms: int.nullable(),
    cost_usd: real,
    fallback: maybeText,
    request: maybeText,
  }),
  { key: ["id"] },
);

export const interactionPrivate = table(
  "interaction_private",
  z.object({ interaction: text, owner: text, payload: text, media: maybeText }),
  { key: ["interaction"], people: ["payload", "media"] },
);

export const media = table(
  "media",
  z.object({ id: text, owner: text, kind: text, mime: text, bytes: z.instanceof(Uint8Array), created_at: text }),
  { key: ["id"], people: ["bytes"] },
);

export const calendarLink = table(
  "calendar_link",
  z.object({ owner: text, provider: text, ref: text, credentials: maybeText, last_sync: maybeText }),
  { key: ["owner", "provider", "ref"], people: ["credentials"] },
);

export const inputUndo = table(
  "input_undo",
  z.object({ id: text, owner: text, created_at: text, interaction: maybeText, media: maybeText, ops: text, undone_at: maybeText }),
  { key: ["id"], people: ["ops"] },
);

export const userPrivate = table(
  "user_private",
  z.object({ owner: text, passport: maybeText, updated_at: text }),
  { key: ["owner"], people: ["passport"] },
);

export const creditLedger = table(
  "credit_ledger",
  z.object({ id: text, owner: text, amount_cents: int, kind: text, ref: maybeText, created_at: text }),
  { key: ["id"] },
);

export const tables = [
  city,
  area,
  place,
  fact,
  slotRead,
  appUser,
  trip,
  anchor,
  meal,
  save,
  interaction,
  interactionPrivate,
  media,
  calendarLink,
  inputUndo,
  userPrivate,
  creditLedger,
];

// Rows read as the records in shared/records.ts: JSON columns parsed, integer flags as booleans.

function json<T extends z.ZodType>(schema: T) {
  return z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "not JSON" });
        return z.NEVER;
      }
    })
    .pipe(schema);
}

const flag = z.number().int().transform((n) => n !== 0);

export const CityRow = City.extend({
  languages: json(City.shape.languages),
  bbox: json(City.shape.bbox),
  config: json(City.shape.config),
});

export const AreaRow = Area.extend({
  polygon: json(z.unknown()).nullable(),
  stops: json(Area.shape.stops),
});

export const PlaceRow = Place.extend({
  channels: json(Place.shape.channels),
  links: json(Place.shape.links),
  curated: flag,
});

export const FactRow = Fact.extend({ value: json(z.unknown()) });

export const SlotReadRow = SlotRead.extend({
  times: json(SlotRead.shape.times),
  waitlist: json(SlotRead.shape.waitlist),
});

export const UserRow = User;

export const TripRow = Trip.extend({
  base: json(Trip.shape.base),
  appetite: json(Trip.shape.appetite.unwrap()).nullable(),
  budget: json(Trip.shape.budget.unwrap()).nullable(),
  diet: json(Trip.shape.diet.unwrap()).nullable(),
  booking: json(Trip.shape.booking.unwrap()).nullable(),
});

export const AnchorRow = Anchor;
export const MealRow = Meal;
export const SaveRow = Save.extend({ notify_nearby: flag });
