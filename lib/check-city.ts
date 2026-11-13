// bin/check-city <city>: validates data/cities/<city>/ the way bin/seed does, then prints coverage and gaps.
import { resolve } from "node:path";
import { readCity, type CityData } from "./seed.js";

export type CityReport = {
  places: number;
  byKind: Record<string, number>;
  closed: string[];
  missing: { google_place_id: string[]; overture_id: string[]; coordinates: string[]; summary: string[]; links: string[]; channels: string[] };
  areasWithoutStops: string[];
};

const statusOf = (p: CityData["places"][number]) => p.facts.find((f) => f.field === "status")?.value;

export function report(data: CityData): CityReport {
  const open = data.places.filter((p) => statusOf(p) !== "closed");
  const byKind: Record<string, number> = {};
  for (const p of open) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  const ids = (pred: (p: CityData["places"][number]) => boolean) => open.filter(pred).map((p) => p.id);
  return {
    places: data.places.length,
    byKind,
    closed: data.places.filter((p) => statusOf(p) === "closed").map((p) => p.id),
    missing: {
      google_place_id: ids((p) => !p.google_place_id),
      overture_id: ids((p) => !p.overture_id),
      coordinates: ids((p) => p.lat === null || p.lng === null),
      summary: ids((p) => !p.summary),
      links: ids((p) => p.links.length === 0),
      channels: ids((p) => p.channels.length === 0),
    },
    areasWithoutStops: data.areas.filter((a) => a.stops.length === 0).map((a) => a.id),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const city = process.argv[2];
  if (!city) {
    console.error("usage: bin/check-city <city>");
    process.exit(1);
  }
  try {
    const r = report(readCity(resolve(import.meta.dirname, "..", "data/cities", city)));
    console.log(`${city}: ${r.places} places; open by kind ${JSON.stringify(r.byKind)}; closed ${r.closed.join(", ") || "none"}`);
    for (const [field, list] of Object.entries(r.missing)) if (list.length) console.log(`  no ${field} (${list.length}): ${list.join(", ")}`);
    if (r.areasWithoutStops.length) console.log(`  areas without stops: ${r.areasWithoutStops.join(", ")}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
