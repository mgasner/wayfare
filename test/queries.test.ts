import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { FileDatabase } from "../lib/db.js";
import { root, seededDb } from "./helpers.js";
import { sampleData } from "./sample-data.js";

const doc = readFileSync(join(root, "docs/queries.md"), "utf8");
const queries = [...doc.matchAll(/^## (.+)\n[\s\S]*?```sql\n([\s\S]*?)```/gm)].map((m) => ({ title: m[1]!, sql: m[2]! }));

let database: FileDatabase;
const run = (sql: string) => database.run((s) => s.prepare(sql).all());
const query = (title: string) => {
  const q = queries.find((x) => x.title === title);
  if (!q) throw new Error(`No query "${title}" in docs/queries.md`);
  return run(q.sql);
};

beforeAll(async () => {
  database = await seededDb();
  await sampleData(database);
});

describe("docs/queries.md", () => {
  it("has the plan's queries", () => {
    expect(queries.map((q) => q.title)).toEqual(
      expect.arrayContaining([
        "Failure rate by channel and day",
        "Which ladder step produced the value",
        "Slot reads that fell back this week, by restaurant",
        "Stale facts per city",
        "Which Lima facts are stale",
        "Model and API cost per city",
      ]),
    );
  });

  it.each(queries.map((q) => [q.title, q.sql]))("%s runs", async (_, sql) => {
    await expect(run(sql)).resolves.toBeInstanceOf(Array);
  });

  it("counts failures by channel", async () => {
    const [mesa] = (await query("Failure rate by channel and day")).filter((r) => r.channel === "mesa247");
    expect(mesa).toMatchObject({ calls: 9, errors: 1, timeouts: 1, blocked: 1, empty: 1, failure_pct: 33.3 });
  });

  it("says which step produced each value", async () => {
    const rows = (await query("Which ladder step produced the value")).filter((r) => r.channel === "mesa247");
    expect(rows.map((r) => [r.step, r.attempts])).toEqual([["last_good", 2], ["live", 2], ["unknown", 1]]);
  });

  it("finds this week's fallbacks by restaurant", async () => {
    const rows = await query("Slot reads that fell back this week, by restaurant");
    expect(rows).toEqual([
      { place: "isolina", name: "Isolina", reads: 1, fell_back: 1, fell_back_pct: 100, last_good: 1, no_value: 0 },
      { place: "central", name: "Central", reads: 4, fell_back: 2, fell_back_pct: 50, last_good: 1, no_value: 0 },
    ]);
  });

  it("finds stale facts", async () => {
    expect(await query("Stale facts per city")).toEqual([{ city: "lima", field: "hours", stale: 1, oldest: "2026-10-01T00:00:00Z" }]);
    expect(await query("Which Lima facts are stale")).toMatchObject([{ id: "la-mar-cebicheria", field: "hours", window_days: 7 }]);
  });

  it("adds up cost per city", async () => {
    const rows = await query("Model and API cost per city");
    expect(rows.find((r) => r.channel === "gateway")).toMatchObject({ city: "lima", calls: 1, cost_usd: 0.0021, unpriced: 0 });
    expect(rows.find((r) => r.channel === "google.places")).toMatchObject({ city: "lima", calls: 1, unpriced: 1 });
  });
});
