import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { SQLInputValue } from "node:sqlite";
import type { z } from "zod";
import { AreasFile, CityFile, PlaceFile } from "../shared/research.js";
import type { Database } from "./db.js";

export type CityData = { city: CityFile; areas: z.output<typeof AreasFile>; places: PlaceFile[] };

function parse<S extends z.ZodType>(schema: S, path: string): z.output<S> {
  const result = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`${path} does not match shared/research.ts:\n${issues}`);
  }
  return result.data;
}

/** Reads and checks data/cities/<city>/. */
export function readCity(dir: string): CityData {
  const id = basename(dir);
  const city = parse(CityFile, join(dir, "city.json"));
  if (city.id !== id) throw new Error(`${dir}/city.json: id ${city.id} should be ${id}`);
  const areas = existsSync(join(dir, "areas.json")) ? parse(AreasFile, join(dir, "areas.json")) : [];
  const areaIds = new Set(areas.map((a) => a.id));
  const placesDir = join(dir, "places");
  const places = (existsSync(placesDir) ? readdirSync(placesDir) : [])
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const place = parse(PlaceFile, join(placesDir, f));
      if (`${place.id}.json` !== f) throw new Error(`${placesDir}/${f}: id ${place.id} should match the file name`);
      if (place.area !== null && !areaIds.has(place.area)) throw new Error(`${placesDir}/${f}: area ${place.area} is not in areas.json`);
      const fields = place.facts.map((x) => x.field);
      const repeated = fields.find((x, i) => fields.indexOf(x) !== i);
      if (repeated) throw new Error(`${placesDir}/${f}: fact ${repeated} appears twice`);
      return place;
    });
  return { city, areas, places };
}

const upsertCity = `
  INSERT INTO city (id, name, country, tz, currency, languages, bbox, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET name = excluded.name, country = excluded.country, tz = excluded.tz,
    currency = excluded.currency, languages = excluded.languages, bbox = excluded.bbox, config = excluded.config
  WHERE (city.name, city.country, city.tz, city.currency, city.languages, city.bbox, city.config)
    IS NOT (excluded.name, excluded.country, excluded.tz, excluded.currency, excluded.languages, excluded.bbox, excluded.config)`;

const upsertArea = `
  INSERT INTO area (id, city, name, lat, lng, polygon, brief, stops) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET city = excluded.city, name = excluded.name, lat = excluded.lat, lng = excluded.lng,
    polygon = excluded.polygon, brief = excluded.brief, stops = excluded.stops
  WHERE (area.city, area.name, area.lat, area.lng, area.polygon, area.brief, area.stops)
    IS NOT (excluded.city, excluded.name, excluded.lat, excluded.lng, excluded.polygon, excluded.brief, excluded.stops)`;

const upsertPlace = `
  INSERT INTO place (id, city, area, name, kind, google_place_id, overture_id, lat, lng, channels, summary, links, curated)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT (id) DO UPDATE SET city = excluded.city, area = excluded.area, name = excluded.name, kind = excluded.kind,
    google_place_id = excluded.google_place_id, overture_id = excluded.overture_id, lat = excluded.lat, lng = excluded.lng,
    channels = excluded.channels, summary = excluded.summary, links = excluded.links, curated = 1
  WHERE (place.city, place.area, place.name, place.kind, place.google_place_id, place.overture_id, place.lat, place.lng,
         place.channels, place.summary, place.links, place.curated)
    IS NOT (excluded.city, excluded.area, excluded.name, excluded.kind, excluded.google_place_id, excluded.overture_id,
         excluded.lat, excluded.lng, excluded.channels, excluded.summary, excluded.links, 1)`;

const upsertFact = `
  INSERT INTO fact (place, field, value, source, checked_at) VALUES (?, ?, ?, 'research', ?)
  ON CONFLICT (place, field, source) DO UPDATE SET value = excluded.value, checked_at = excluded.checked_at
  WHERE (fact.value, fact.checked_at) IS NOT (excluded.value, excluded.checked_at)`;

/** Upserts cities from data/cities/; never deletes. Returns how many rows changed. */
export async function seed(database: Database, citiesDir: string, only?: string[]): Promise<{ cities: string[]; changes: number }> {
  const ids = (only?.length ? only : readdirSync(citiesDir).filter((d) => existsSync(join(citiesDir, d, "city.json")))).sort();
  const data = ids.map((id) => readCity(join(citiesDir, id)));
  const changes = await database.run((sqlite) => {
    let n = 0;
    const run = (text: string, ...params: unknown[]) => {
      n += Number(sqlite.prepare(text).run(...(params as SQLInputValue[])).changes);
    };
    const j = (v: unknown) => JSON.stringify(v);
    for (const { city, areas, places } of data) {
      run(upsertCity, city.id, city.name, city.country, city.tz, city.currency, j(city.languages), j(city.bbox), j(city.config));
      for (const a of areas) {
        run(upsertArea, a.id, city.id, a.name, a.lat, a.lng, a.polygon === null ? null : j(a.polygon), a.brief, j(a.stops));
      }
      for (const p of places) {
        run(upsertPlace, p.id, city.id, p.area, p.name, p.kind, p.google_place_id, p.overture_id, p.lat, p.lng,
          j(p.channels), p.summary, j(p.links));
        for (const f of p.facts) run(upsertFact, p.id, f.field, j(f.value), f.checked_at);
      }
    }
    return n;
  });
  return { cities: ids, changes };
}
