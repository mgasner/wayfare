import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { FileDatabase } from "../lib/db.js";
import { bestMatch, metersBetween, nameSimilarity } from "../lib/match.js";
import { latestRelease, loadOverture, writeMatchesToFiles, type OvertureRow } from "../lib/overture.js";
import { seed } from "../lib/seed.js";
import { addUser, fixtureCities, root, seededDb } from "./helpers.js";

describe("matching", () => {
  it("scores names ignoring accents, case and generic words", () => {
    expect(nameSimilarity("Central", "Central Restaurante")).toBeGreaterThanOrEqual(0.9);
    expect(nameSimilarity("Astrid y Gastón", "Astrid & Gaston")).toBeGreaterThanOrEqual(0.9);
    expect(nameSimilarity("Anticuchos de la Tía Grimanesa", "Anticuchos Grimanesa")).toBeGreaterThanOrEqual(0.9);
    expect(nameSimilarity("Central", "Kjolle")).toBeLessThan(0.3);
    expect(nameSimilarity("Restaurante", "Bar")).toBe(0);
  });

  it("takes the most similar candidate within 150 m", () => {
    const at = { lat: -12.1527, lng: -77.0225 };
    const candidates = [
      { id: "k", name: "Kjolle", lat: -12.15279, lng: -77.02256 },
      { id: "c", name: "Central Restaurante", lat: -12.15276, lng: -77.02254 },
      { id: "far", name: "Central", lat: -12.16, lng: -77.0225 },
    ];
    expect(metersBetween(at, candidates[2]!)).toBeGreaterThan(150);
    expect(bestMatch({ name: "Central", ...at }, candidates)?.candidate.id).toBe("c");
    expect(bestMatch({ name: "Mérito", ...at }, candidates)).toBeNull();
  });
});

describe("latestRelease", () => {
  it("picks the newest release prefix", async () => {
    const xml = ["2026-09-23.0", "2026-10-21.0", "2026-09-23.1", "2026-10-21.10", "2026-10-21.9"]
      .map((r) => `<CommonPrefixes><Prefix>release/${r}/</Prefix></CommonPrefixes>`)
      .join("");
    const fake = (async () => new Response(`<ListBucketResult><Prefix>release/</Prefix>${xml}</ListBucketResult>`)) as unknown as typeof fetch;
    expect(await latestRelease(fake)).toBe("2026-10-21.10");
  });
});

const rows: OvertureRow[] = [
  { id: "ov-central", name: "Central Restaurante", lat: -12.1498557, lng: -77.0222449, category: "peruvian_restaurant", confidence: 0.99 },
  { id: "ov-isolina", name: "Isolina", lat: -12.1463259, lng: -77.020816, category: "peruvian_restaurant", confidence: 0.99 },
  { id: "ov-cafe", name: "Café de la Esquina", lat: -12.12, lng: -77.03, category: "cafe", confidence: 0.8 },
];

describe("loadOverture", () => {
  let database: FileDatabase;
  beforeEach(async () => {
    database = await seededDb();
  });

  const curated = () =>
    database.run((s) => s.prepare("SELECT id, overture_id, lat, lng FROM place WHERE curated = 1 ORDER BY id").all());

  it("matches curated places, upserts the rest as uncurated, and repeats as a no-op", async () => {
    const stats = await database.run((s) => loadOverture(s, "lima", rows));
    expect(stats.matched.map((m) => [m.id, m.overture_id])).toEqual([
      ["central", "ov-central"],
      ["isolina", "ov-isolina"],
    ]);
    expect(stats.unmatched).toEqual(["la-mar-cebicheria"]);
    expect(stats.inserted).toBe(1);
    expect(await curated()).toContainEqual({ id: "central", overture_id: "ov-central", lat: -12.1498557, lng: -77.0222449 });
    const uncurated = await database.run((s) => s.prepare("SELECT id, kind, curated, overture_id FROM place WHERE curated = 0").all());
    expect(uncurated).toEqual([{ id: "ov-ov-cafe", kind: null, curated: 0, overture_id: "ov-cafe" }]);

    const again = await database.run((s) => loadOverture(s, "lima", rows));
    expect([again.inserted, again.updated, again.matched.length]).toEqual([0, 0, 2]);
  });

  it("never overwrites a curated row with Overture data", async () => {
    await database.run((s) => loadOverture(s, "lima", [{ ...rows[2]!, id: "x", name: "Isolina", lat: -12.1462, lng: -77.0207 }]));
    const isolina = await database.run((s) => s.prepare("SELECT name, curated FROM place WHERE id = 'isolina'").get());
    expect(isolina).toEqual({ name: "Isolina", curated: 1 });
  });

  it("absorbs an uncurated row, with its saves, when a curated place takes its Overture id", async () => {
    await database.run((s) => loadOverture(s, "lima", [{ ...rows[2]!, id: "lamar", name: "Some Other Name", lat: -12.1133, lng: -77.0453 }]));
    const user = await addUser(database, "u@example.com");
    const uid = user.actor.kind === "person" ? user.actor.id : "";
    await database.run((s) =>
      s.prepare("INSERT INTO save (owner, place, created_at) VALUES (?, 'ov-lamar', '2026-11-13T00:00:00Z')").run(uid),
    );
    const dir = mkdtempSync(join(tmpdir(), "dp-cities-"));
    const { cpSync } = await import("node:fs");
    cpSync(fixtureCities, dir, { recursive: true });
    const file = join(dir, "lima/places/la-mar-cebicheria.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), overture_id: "lamar" }));
    await seed(database, dir);
    const places = await database.run((s) => s.prepare("SELECT id FROM place WHERE overture_id = 'lamar'").all());
    expect(places).toEqual([{ id: "la-mar-cebicheria" }]);
    const saves = await database.run((s) => s.prepare("SELECT place FROM save").all());
    expect(saves).toEqual([{ place: "la-mar-cebicheria" }]);
  });

  it("writes matches into the place files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dp-places-"));
    writeFileSync(join(dir, "central.json"), JSON.stringify({ id: "central", name: "Central", lat: -12.15, lng: -77.02 }, null, 2) + "\n");
    const changed = writeMatchesToFiles(dir, [{ id: "central", overture_id: "ov-central", overture_name: "Central Restaurante", similarity: 1, meters: 3 }], rows);
    expect(changed).toEqual(["central"]);
    expect(JSON.parse(readFileSync(join(dir, "central.json"), "utf8"))).toMatchObject({ overture_id: "ov-central", lat: -12.1498557 });
    expect(writeMatchesToFiles(dir, [{ id: "central", overture_id: "ov-central", overture_name: "", similarity: 1, meters: 3 }], rows)).toEqual([]);
  });
});
