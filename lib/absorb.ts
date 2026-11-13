import type { DatabaseSync } from "node:sqlite";

/**
 * Writes a curated place with `write`, taking over uncurated rows that hold the same `overture_id` or
 * `google_place_id`: their unique ids are released first, then whatever points at them moves to `into`
 * and they are deleted. Returns how many rows were absorbed. Call inside a transaction.
 */
export function absorbUncurated(
  sqlite: DatabaseSync,
  into: string,
  ids: { overtureId: string | null; googlePlaceId: string | null },
  write: () => void,
): number {
  const rows = sqlite
    .prepare(
      `SELECT id FROM place WHERE curated = 0 AND id <> ?
         AND ((? IS NOT NULL AND overture_id = ?) OR (? IS NOT NULL AND google_place_id = ?))`,
    )
    .all(into, ids.overtureId, ids.overtureId, ids.googlePlaceId, ids.googlePlaceId) as { id: string }[];
  const release = sqlite.prepare("UPDATE place SET overture_id = NULL, google_place_id = NULL WHERE id = ?");
  for (const { id } of rows) release.run(id);
  write();
  for (const { id } of rows) {
    for (const table of ["fact", "slot_read", "save", "meal"]) {
      // OR IGNORE keeps the curated place's row when both have one with the same key; the leftover is deleted.
      sqlite.prepare(`UPDATE OR IGNORE ${table} SET place = ? WHERE place = ?`).run(into, id);
      sqlite.prepare(`DELETE FROM ${table} WHERE place = ?`).run(id);
    }
    sqlite.prepare("UPDATE anchor SET place = ? WHERE place = ?").run(into, id);
    sqlite.prepare("UPDATE interaction SET place = ? WHERE place = ?").run(into, id);
    sqlite.prepare("DELETE FROM place WHERE id = ?").run(id);
  }
  return rows.length;
}
