import { z } from "zod";
import { Area, Channel, City, FactField, Instant, Link, Place, PlaceKind, Stop } from "./records.js";

// Files under data/cities/<city>/, written by the research pass and loaded by bin/seed.

/** city.json */
export const CityFile = City;
export type CityFile = z.infer<typeof CityFile>;

/** areas.json: the city comes from the directory. */
export const AreaFile = Area.omit({ city: true }).extend({
  lat: Area.shape.lat.default(null),
  lng: Area.shape.lng.default(null),
  polygon: Area.shape.polygon.default(null),
  brief: Area.shape.brief.default(null),
  stops: z.array(Stop).default([]),
});
export const AreasFile = z.array(AreaFile);
export type AreaFile = z.infer<typeof AreaFile>;

/** A fact from research; stored with source `research`. */
export const ResearchFact = z.object({ field: FactField, value: z.unknown(), checked_at: Instant });
export type ResearchFact = z.infer<typeof ResearchFact>;

/** places/<id>.json: the city comes from the directory, and every seeded place is curated. */
export const PlaceFile = Place.omit({ city: true, curated: true }).extend({
  kind: PlaceKind,
  area: Place.shape.area.default(null),
  google_place_id: Place.shape.google_place_id.default(null),
  overture_id: Place.shape.overture_id.default(null),
  lat: Place.shape.lat.default(null),
  lng: Place.shape.lng.default(null),
  channels: z.array(Channel).default([]),
  summary: Place.shape.summary.default(null),
  links: z.array(Link).default([]),
  facts: z.array(ResearchFact).default([]),
});
export type PlaceFile = z.infer<typeof PlaceFile>;
