// bin/migrate, bin/seed and bin/sql. DB_FILE selects a local file; otherwise R2 with DB_KEY (default by VERCEL_ENV).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { databaseFromEnv, dbKey, r2StoreFromEnv } from "./db.js";
import { migrate } from "./migrate.js";
import { seed } from "./seed.js";
import { openSqlite } from "./sqlite.js";

const root = resolve(import.meta.dirname, "..");
// Values already in the environment win, as with Vite's loadEnv in pnpm dev.
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));
const where = () => (process.env.DB_FILE ? process.env.DB_FILE : `r2 ${dbKey()}`);

function cell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Uint8Array) return `<${v.byteLength} bytes>`;
  return String(v);
}

export function formatTable(columns: string[], rows: Record<string, unknown>[]): string {
  const cells = rows.map((r) => columns.map((c) => cell(r[c]).replace(/\n/g, "\\n")));
  const widths = columns.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i]!.length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i]!)).join(" | ").trimEnd();
  return [line(columns), widths.map((w) => "-".repeat(w)).join("-+-"), ...cells.map(line)].join("\n");
}

async function sqlCommand(args: string[]) {
  const asJson = args.includes("--json");
  const query = args.filter((a) => a !== "--json").join(" ");
  if (!query) throw new Error('Usage: bin/sql [--json] "<query>"');
  let path = process.env.DB_FILE;
  if (!path) {
    const got = await r2StoreFromEnv().get();
    if (got.status !== "ok") throw new Error(`No database at r2 ${dbKey()}`);
    path = `/tmp/wayfare/sql-${process.pid}-${dbKey()}`;
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, got.body);
  }
  const sqlite = openSqlite(path, { readOnly: true });
  const statement = sqlite.prepare(query);
  const rows = statement.all() as Record<string, unknown>[];
  if (asJson) return console.log(JSON.stringify(rows, null, 2));
  const columns = statement.columns().map((c) => c.name);
  console.log(formatTable(columns, rows));
  console.log(`(${rows.length} row${rows.length === 1 ? "" : "s"})`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "migrate") {
    const database = databaseFromEnv();
    const applied = await migrate(database, resolve(root, "db/migrations"));
    console.log(applied.length ? `${where()}: applied ${applied.join(", ")}` : `${where()}: up to date`);
  } else if (command === "seed") {
    const database = databaseFromEnv();
    const { cities, changes } = await seed(database, resolve(root, "data/cities"), args);
    console.log(`${where()}: seeded ${cities.join(", ") || "nothing"}, ${changes} rows changed`);
  } else if (command === "sql") {
    await sqlCommand(args);
  } else {
    throw new Error(`Unknown command ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
