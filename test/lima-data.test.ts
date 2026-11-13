import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CityResearch } from "../agents/city-research.schema.js";
import { report } from "../lib/check-city.js";
import { FileDatabase, driverFor } from "../lib/db.js";
import { migrate } from "../lib/migrate.js";
import { setDriver } from "../lib/nexus.js";
import { readCity, seed } from "../lib/seed.js";
import { callAs, root, tempPath } from "./helpers.js";

const dir = join(root, "data/cities/lima");

describe("data/cities/lima", () => {
  const data = readCity(dir);
  const r = report(data);

  it("matches the research schema", () => {
    expect(CityResearch.safeParse(data).success).toBe(true);
  });

  it("has the curated set: the first 27, at least 20 more walk-in or informal places, and the known closures", () => {
    for (const id of ["central", "maido", "cosme", "la-mar-cebicheria", "wa-lok-barrio-chino", "canta-rana-barranco"]) {
      expect(data.places.map((p) => p.id)).toContain(id);
    }
    const walkIn = (r.byKind.walk_in ?? 0) + (r.byKind.informal ?? 0);
    expect(walkIn).toBeGreaterThanOrEqual(26);
    expect(data.places.length - r.closed.length).toBeGreaterThanOrEqual(47);
    expect(r.closed.sort()).toEqual(["amaz", "la-picanteria", "statera"]);
  });

  it("gives every open place coordinates, a summary, links and channels", () => {
    expect(r.missing.coordinates).toEqual([]);
    expect(r.missing.summary).toEqual([]);
    expect(r.missing.links).toEqual([]);
    expect(r.missing.channels).toEqual([]);
  });

  it("has briefs and stops for the main areas", () => {
    for (const id of ["barranco", "miraflores", "centro", "san-isidro", "barrio-chino"]) {
      const area = data.areas.find((a) => a.id === id);
      expect(area?.brief, id).toBeTruthy();
      expect(area?.stops.length, id).toBeGreaterThanOrEqual(2);
    }
  });

  it("seeds cleanly and keeps closed places out of search", async () => {
    const database = new FileDatabase(tempPath());
    await migrate(database, join(root, "db/migrations"));
    await seed(database, join(root, "data/cities"));
    setDriver(driverFor(database));
    expect((await seed(database, join(root, "data/cities"))).changes).toBe(0);
    const { body } = await callAs(null, "places.search", { city: "lima", limit: 500 });
    const ids = body.map((p: { id: string }) => p.id);
    expect(ids).toHaveLength(data.places.length - 3);
    for (const closed of ["amaz", "statera", "la-picanteria"]) expect(ids).not.toContain(closed);
  });
});
