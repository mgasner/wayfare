import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "./db.js";

/** Applies db/migrations/*.sql not yet in _migrations, in name order, in one transaction. Returns their names. */
export async function migrate(database: Database, dir: string): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => /^\d+_[\w-]+\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
  return database.run((sqlite) => {
    sqlite.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    const done = new Set(sqlite.prepare("SELECT name FROM _migrations").all().map((r) => r.name as string));
    const insert = sqlite.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)");
    const applied: string[] = [];
    for (const { name, text } of files) {
      if (done.has(name)) continue;
      sqlite.exec(text);
      insert.run(name, new Date().toISOString());
      applied.push(name);
    }
    return applied;
  });
}
