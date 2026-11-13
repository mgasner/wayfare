import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { absorbUncurated } from "./absorb.js";
import { bestMatch, type Candidate, type Match } from "./match.js";

export const BUCKET = "overturemaps-us-west-2";

const round7 = (x: number) => Math.round(x * 1e7) / 1e7;

export type OvertureRow = Candidate & { category: string | null; confidence: number };

/** The newest `release/<date>.<n>/` in Overture's public bucket. */
export async function latestRelease(fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = `https://${BUCKET}.s3.us-west-2.amazonaws.com/?list-type=2&prefix=release/&delimiter=/`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Listing ${url}: HTTP ${res.status}`);
  const releases = [...(await res.text()).matchAll(/<Prefix>release\/(\d{4}-\d{2}-\d{2}\.\d+)\/<\/Prefix>/g)].map((m) => m[1]!);
  if (!releases.length) throw new Error("No Overture releases listed");
  return releases.sort((a, b) => a.localeCompare(b, "en", { numeric: true })).at(-1)!;
}

/** Eat-and-drink places (and food markets) in `bbox` from one release, read anonymously with DuckDB. */
export async function readOverture(release: string, bbox: [number, number, number, number], minConfidence: number): Promise<OvertureRow[]> {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    // The bucket is public; an empty-key secret stops DuckDB from signing with AWS_* credentials in the environment.
    await connection.run(`INSTALL httpfs; LOAD httpfs;
      CREATE SECRET overture (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2', SCOPE 's3://${BUCKET}')`);
    const [w, s, e, n] = bbox;
    const reader = await connection.runAndReadAll(
      `SELECT id, names.primary AS name, bbox.ymin AS lat, bbox.xmin AS lng, taxonomy.primary AS category, confidence
       FROM read_parquet('s3://${BUCKET}/release/${release}/theme=places/type=place/*', hive_partitioning = 1)
       WHERE bbox.xmin BETWEEN $w AND $e AND bbox.ymin BETWEEN $s AND $n
         AND names.primary IS NOT NULL AND confidence >= $min
         AND (taxonomy.hierarchy[1] = 'food_and_drink' OR taxonomy.primary = 'farmers_market')
       ORDER BY id`,
      { w, s, e, n, min: minConfidence },
    );
    return reader.getRowObjectsJS().map((r) => ({
      id: String(r.id),
      name: String(r.name),
      lat: round7(Number(r.lat)),
      lng: round7(Number(r.lng)),
      category: r.category == null ? null : String(r.category),
      confidence: Number(r.confidence),
    }));
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

export type LoadStats = {
  overture: number;
  inserted: number;
  updated: number;
  curated: number;
  curatedWithCoords: number;
  matched: { id: string; overture_id: string; overture_name: string; similarity: number; meters: number }[];
  unmatched: string[];
  absorbed: number;
};

/** Buckets candidates by ~0.01° cells so each curated place compares against its neighbors only. */
function grid(rows: OvertureRow[]) {
  const cell = (lat: number, lng: number) => `${Math.floor(lat * 100)},${Math.floor(lng * 100)}`;
  const cells = new Map<string, OvertureRow[]>();
  for (const r of rows) {
    const k = cell(r.lat, r.lng);
    const list = cells.get(k);
    if (list) list.push(r);
    else cells.set(k, [r]);
  }
  return (lat: number, lng: number) => {
    const out: OvertureRow[] = [];
    const [a, b] = [Math.floor(lat * 100), Math.floor(lng * 100)];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(cells.get(`${a + i},${b + j}`) ?? []));
    return out;
  };
}

/**
 * Matches curated places to Overture by name within 150 m (taking Overture's coordinates and id), then
 * upserts every other row as an uncurated place (`ov-<id>`, kind null). Curated rows are never overwritten
 * by uncurated data, and nothing is deleted. Call inside a transaction.
 */
export function loadOverture(sqlite: DatabaseSync, city: string, rows: OvertureRow[]): LoadStats {
  const curated = sqlite
    .prepare("SELECT id, name, lat, lng, overture_id FROM place WHERE city = ? AND curated = 1 ORDER BY id")
    .all(city) as { id: string; name: string; lat: number | null; lng: number | null; overture_id: string | null }[];
  const near = grid(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Best curated place per Overture id, so two curated places never claim one record.
  const claims = new Map<string, { place: string } & Match>();
  for (const p of curated) {
    if (p.lat === null || p.lng === null) continue;
    const kept = p.overture_id ? byId.get(p.overture_id) : undefined;
    const match: Match | null = kept
      ? { candidate: kept, similarity: 1, meters: 0 }
      : bestMatch({ name: p.name, lat: p.lat, lng: p.lng }, near(p.lat, p.lng));
    if (!match) continue;
    const prior = claims.get(match.candidate.id);
    if (!prior || match.similarity > prior.similarity) claims.set(match.candidate.id, { place: p.id, ...match });
  }

  const stats: LoadStats = {
    overture: rows.length,
    inserted: 0,
    updated: 0,
    curated: curated.length,
    curatedWithCoords: curated.filter((p) => p.lat !== null && p.lng !== null).length,
    matched: [],
    unmatched: [],
    absorbed: 0,
  };
  const setMatch = sqlite.prepare("UPDATE place SET overture_id = ?, lat = ?, lng = ? WHERE id = ?");
  for (const [overtureId, m] of claims) {
    const c = m.candidate;
    stats.absorbed += absorbUncurated(sqlite, m.place, { overtureId, googlePlaceId: null }, () => setMatch.run(overtureId, c.lat, c.lng, m.place));
    stats.matched.push({ id: m.place, overture_id: overtureId, overture_name: c.name, similarity: Math.round(m.similarity * 100) / 100, meters: Math.round(m.meters) });
  }
  const matchedPlaces = new Set([...claims.values()].map((m) => m.place));
  stats.unmatched = curated.filter((p) => !matchedPlaces.has(p.id)).map((p) => p.id);
  stats.matched.sort((a, b) => a.id.localeCompare(b.id));

  const heldByCurated = new Set(
    (sqlite.prepare("SELECT overture_id FROM place WHERE curated = 1 AND overture_id IS NOT NULL").all() as { overture_id: string }[]).map((r) => r.overture_id),
  );
  const upsert = sqlite.prepare(`
    INSERT INTO place (id, city, name, overture_id, lat, lng, curated) VALUES (?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, lat = excluded.lat, lng = excluded.lng
    WHERE place.curated = 0 AND (place.name, place.lat, place.lng) IS NOT (excluded.name, excluded.lat, excluded.lng)`);
  const exists = sqlite.prepare("SELECT 1 FROM place WHERE id = ?");
  for (const r of rows) {
    if (heldByCurated.has(r.id)) continue;
    const id = `ov-${r.id}`;
    const had = exists.get(id) !== undefined;
    const changes = Number(upsert.run(id, city, r.name, r.id, r.lat, r.lng).changes);
    if (changes && had) stats.updated++;
    else if (changes) stats.inserted++;
  }
  return stats;
}

/** Writes matched overture_id and coordinates into data/cities/<city>/places/<id>.json, so bin/seed keeps them. */
export function writeMatchesToFiles(placesDir: string, matched: LoadStats["matched"], rows: OvertureRow[]): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const changed: string[] = [];
  for (const m of matched) {
    const path = join(placesDir, `${m.id}.json`);
    const row = byId.get(m.overture_id);
    if (!existsSync(path) || !row) continue;
    const before = readFileSync(path, "utf8");
    const data = JSON.parse(before) as Record<string, unknown>;
    data.overture_id = m.overture_id;
    data.lat = row.lat;
    data.lng = row.lng;
    const after = JSON.stringify(data, null, 2) + "\n";
    if (after !== before) {
      writeFileSync(path, after);
      changed.push(m.id);
    }
  }
  return changed;
}
