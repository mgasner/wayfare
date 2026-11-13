import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileDatabase } from "../lib/db.js";
import { migrate } from "../lib/migrate.js";
import { seed } from "../lib/seed.js";
import { tables } from "../server/tables.js";
import { fixtureCities, root, tempPath } from "./helpers.js";

const migrations = join(root, "db/migrations");

function copyCities(): string {
  const dir = mkdtempSync(join(tmpdir(), "dp-cities-"));
  cpSync(fixtureCities, dir, { recursive: true });
  return dir;
}

describe("migrate", () => {
  it("applies each migration once", async () => {
    const database = new FileDatabase(tempPath());
    expect(await migrate(database, migrations)).toContain("0001_init.sql");
    expect(await migrate(database, migrations)).toEqual([]);
  });

  it("creates the columns server/tables.ts declares", async () => {
    const database = new FileDatabase(tempPath());
    await migrate(database, migrations);
    for (const t of tables) {
      const columns = await database.run((s) => s.prepare(`PRAGMA table_info(${t.name})`).all().map((c) => c.name));
      expect(columns, t.name).toEqual(Object.keys(t.row.shape));
    }
  });
});

describe("seed", () => {
  it("loads the Lima fixture as curated places with research facts, and repeats as a no-op", async () => {
    const database = new FileDatabase(tempPath());
    await migrate(database, migrations);
    const first = await seed(database, fixtureCities);
    expect(first.cities).toEqual(["lima"]);
    expect(first.changes).toBeGreaterThan(0);
    expect((await seed(database, fixtureCities)).changes).toBe(0);
    const places = await database.run((s) => s.prepare("SELECT id, curated FROM place ORDER BY id").all());
    expect(places.length).toBeGreaterThanOrEqual(3);
    expect(places.every((p) => p.curated === 1)).toBe(true);
    const sources = await database.run((s) => s.prepare("SELECT DISTINCT source FROM fact").all().map((r) => r.source));
    expect(sources).toEqual(["research"]);
  });

  it("updates changed places and never deletes", async () => {
    const dir = copyCities();
    const database = new FileDatabase(tempPath());
    await migrate(database, migrations);
    await seed(database, dir);
    await database.run((s) =>
      s.prepare("INSERT INTO fact (place, field, value, source, checked_at) VALUES ('isolina', 'hours', '\"12-16\"', 'user:u1', 'x')").run(),
    );
    rmSync(join(dir, "lima/places/central.json"));
    writeFileSync(
      join(dir, "lima/places/isolina.json"),
      JSON.stringify({ id: "isolina", name: "Isolina Taberna", kind: "walk_in", area: "barranco" }),
    );
    await seed(database, dir);
    const rows = await database.run((s) => s.prepare("SELECT id, name FROM place ORDER BY id").all());
    expect(rows.map((r) => r.id)).toContain("central");
    expect(rows.find((r) => r.id === "isolina")?.name).toBe("Isolina Taberna");
    const facts = await database.run((s) => s.prepare("SELECT source FROM fact WHERE place = 'isolina' ORDER BY source").all());
    expect(facts.map((f) => f.source)).toEqual(["research", "user:u1"]);
  });

  it("names the file and field of a bad record", async () => {
    const dir = copyCities();
    writeFileSync(join(dir, "lima/places/bad.json"), JSON.stringify({ id: "bad", name: "Bad", kind: "fancy" }));
    const database = new FileDatabase(tempPath());
    await migrate(database, migrations);
    await expect(seed(database, dir)).rejects.toThrow(/bad\.json[\s\S]*kind/);
  });
});
