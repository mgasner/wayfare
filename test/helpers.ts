import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FileDatabase, driverFor } from "../lib/db.js";
import { migrate } from "../lib/migrate.js";
import { Auth, setDriver } from "../lib/nexus.js";
import { route } from "../lib/router.js";
import { seed } from "../lib/seed.js";
import { modules } from "../server/index.js";

export const root = resolve(import.meta.dirname, "..");
/** A small Lima (Central, Isolina, La Mar) that tests can rely on while data/cities changes by research PR. */
export const fixtureCities = join(root, "test/fixtures/cities");

export function tempPath(name = "test.db"): string {
  return join(mkdtempSync(join(tmpdir(), "dp-test-")), name);
}

/** A migrated, seeded local file installed as the db driver. */
export async function seededDb(): Promise<FileDatabase> {
  const database = new FileDatabase(tempPath());
  await migrate(database, join(root, "db/migrations"));
  await seed(database, fixtureCities);
  setDriver(driverFor(database));
  return database;
}

export async function addUser(database: FileDatabase, email: string): Promise<Auth> {
  const id = crypto.randomUUID();
  const name = email.split("@")[0]!;
  await database.run((s) =>
    s.prepare("INSERT INTO app_user (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(id, email, name, new Date().toISOString()),
  );
  return Auth.create({ kind: "person", id, name, email });
}

/** Calls `/api/<file>/<export>` through the router, as `auth`. Returns status and parsed body. */
export async function callAs(auth: Auth | null, name: string, input: unknown = {}, method?: "GET" | "POST") {
  const [file, fn] = name.split(".");
  const value = (modules as Record<string, Record<string, { kind?: string }>>)[file!]?.[fn!];
  const verb = method ?? (value?.kind === "mutation" ? "POST" : "GET");
  const url = `http://localhost/api/${file}/${fn}` + (verb === "GET" ? `?input=${encodeURIComponent(JSON.stringify(input))}` : "");
  const res = await route(
    new Request(url, verb === "POST" ? { method: "POST", body: JSON.stringify(input) } : {}),
    modules,
    async () => auth,
  );
  return { status: res.status, body: (await res.json()) as any };
}

/** Strings in interaction.request that look like a phone number, email or passport number. */
export async function personalDataInInteractions(database: FileDatabase): Promise<string[]> {
  const { personalKinds, strings } = await import("../lib/attempt.js");
  const rows = await database.run((s) => s.prepare("SELECT id, request FROM interaction WHERE request IS NOT NULL").all());
  return rows.flatMap((r) =>
    strings(JSON.parse(r.request as string)).flatMap(({ path, text }) =>
      personalKinds(text).map((kind) => `${r.id} ${path}: ${kind} in ${JSON.stringify(text)}`),
    ),
  );
}
