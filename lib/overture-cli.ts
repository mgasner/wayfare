// bin/load-overture <city> [--release <name>] [--min-confidence 0.5] [--no-files]
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { databaseFromEnv, dbKey } from "./db.js";
import { latestRelease, loadOverture, readOverture, writeMatchesToFiles } from "./overture.js";

const root = resolve(import.meta.dirname, "..");
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    release: { type: "string" },
    "min-confidence": { type: "string", default: "0.5" },
    "no-files": { type: "boolean", default: false },
  },
});

try {
  const city = positionals[0];
  if (!city) throw new Error("usage: bin/load-overture <city> [--release <name>] [--min-confidence 0.5] [--no-files]");
  const database = databaseFromEnv();
  const row = await database.run((s) => s.prepare("SELECT bbox FROM city WHERE id = ?").get(city) as { bbox: string } | undefined);
  if (!row) throw new Error(`No city ${city}; run bin/seed first`);
  const bbox = JSON.parse(row.bbox) as [number, number, number, number];
  const release = values.release ?? (await latestRelease());
  const minConfidence = Number(values["min-confidence"]);
  console.log(`Overture ${release}, bbox ${bbox.join(",")}, confidence >= ${minConfidence}`);
  const rows = await readOverture(release, bbox, minConfidence);
  const stats = await database.run((s) => loadOverture(s, city, rows));
  const placesDir = resolve(root, "data/cities", city, "places");
  const files = values["no-files"] || !existsSync(placesDir) ? [] : writeMatchesToFiles(placesDir, stats.matched, rows);
  const where = process.env.DB_FILE ?? `r2 ${dbKey()}`;
  console.log(`${where}: ${stats.overture} Overture places read, ${stats.inserted} inserted and ${stats.updated} updated as uncurated`);
  console.log(`Curated: ${stats.matched.length} of ${stats.curated} matched (${stats.curatedWithCoords} have coordinates), ${stats.absorbed} uncurated duplicates absorbed`);
  for (const m of stats.matched) console.log(`  ${m.id} -> ${m.overture_name} (${m.similarity}, ${m.meters} m)`);
  if (stats.unmatched.length) console.log(`Unmatched: ${stats.unmatched.join(", ")}`);
  if (files.length) console.log(`Updated ${files.length} place files with overture_id and coordinates`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
