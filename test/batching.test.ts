import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDatabase } from "../lib/auth.js";
import { FileDatabase, inRequest, SyncedDatabase } from "../lib/db.js";
import { migrate } from "../lib/migrate.js";
import { isToolError } from "../lib/nexus.js";
import { seed } from "../lib/seed.js";
import { MemoryStore } from "../lib/store.js";
import { setBlockedChannels } from "../server/adapters/slots.js";
import { root, tempPath } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setBlockedChannels([]);
});

const ids = (db: SyncedDatabase) => db.run((s) => s.prepare("SELECT id FROM t ORDER BY rowid").all().map((r) => r.id));
const insert = (db: SyncedDatabase, id: string) => db.run((s) => s.prepare("INSERT INTO t (id) VALUES (?)").run(id));

async function setup() {
  const store = new MemoryStore();
  const log = vi.fn();
  const a = new SyncedDatabase(store, tempPath("a.db"), log);
  const b = new SyncedDatabase(store, tempPath("b.db"), vi.fn());
  await a.run((s) => s.exec("CREATE TABLE t (id TEXT PRIMARY KEY); INSERT INTO t VALUES ('first')"));
  const put = vi.spyOn(store, "put");
  return { store, a, b, log, put };
}

/** What the store holds now, read through a fresh instance. */
const stored = (store: MemoryStore) => ids(new SyncedDatabase(store, tempPath("check.db")));

describe("write batching", () => {
  it("uploads a request's writes once, at the end", async () => {
    const { store, a, put } = await setup();
    await inRequest(async () => {
      await insert(a, "x");
      await insert(a, "y");
      expect(await ids(a)).toEqual(["first", "x", "y"]); // reads see the request's own writes
      expect(put).not.toHaveBeenCalled();
      await insert(a, "z");
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(await stored(store)).toEqual(["first", "x", "y", "z"]);
  });

  it("uploads nothing for a request that only reads", async () => {
    const { a, put } = await setup();
    await inRequest(() => ids(a));
    expect(put).not.toHaveBeenCalled();
  });

  it("on a 412, downloads again and replays the request's writes in order", async () => {
    const { store, a, b, log, put } = await setup();
    await inRequest(async () => {
      await insert(a, "x");
      await a.run((s) => s.prepare("UPDATE t SET id = 'x2' WHERE id = 'x'").run());
      await inRequest(() => insert(b, "from-b")); // another instance uploads first
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatchObject({ event: "db.conflict", attempt: 1, replaying: 2 });
    expect(put).toHaveBeenCalledTimes(3); // b's, a's 412, a's retry
    expect(await stored(store)).toEqual(["first", "from-b", "x2"]);
  });

  it("fails the request, and keeps the other writer's file, when a write no longer applies", async () => {
    const { store, a, b } = await setup();
    await expect(
      inRequest(async () => {
        await insert(a, "same");
        await inRequest(() => insert(b, "same"));
      }),
    ).rejects.toSatisfy((e) => isToolError(e, "unavailable"));
    expect(await stored(store)).toEqual(["first", "same"]);
    expect(await ids(a)).toEqual(["first", "same"]);
  });

  it("uploads writes made before the request threw", async () => {
    const { store, a } = await setup();
    await expect(
      inRequest(async () => {
        await insert(a, "kept");
        throw new Error("handler failed later");
      }),
    ).rejects.toThrow("handler failed later");
    expect(await stored(store)).toEqual(["first", "kept"]);
  });

  it("replays another request's pending writes when it revalidates onto a newer file", async () => {
    const { store, a, b, put } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = inRequest(async () => {
      await insert(a, "r1");
      await gate; // r1 is applied locally and not uploaded yet
    });
    await inRequest(() => insert(b, "from-b"));
    const second = inRequest(() => insert(a, "r2")); // revalidates, takes from-b, replays r1
    await second;
    release();
    await first;
    expect(await stored(store)).toEqual(["first", "from-b", "r1", "r2"]);
    expect(put.mock.calls.length).toBe(2); // b's, and one from a carrying r1 and r2
  });

  it("fails a concurrent request whose write was dropped by another request's failed replay", async () => {
    const { store, a, b } = await setup();
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    let releaseB!: () => void;
    const gateB = new Promise<void>((r) => (releaseB = r));
    const reqA = inRequest(async () => {
      await insert(a, "dup");
      await gateA;
    });
    const reqB = inRequest(async () => {
      await insert(a, "from-B");
      await gateB;
    });
    await inRequest(() => insert(b, "dup"));
    releaseA();
    await expect(reqA).rejects.toThrow();
    releaseB();
    await expect(reqB).rejects.toSatisfy((e) => isToolError(e, "unavailable"));
    const check = new SyncedDatabase(store, tempPath("check.db"));
    expect(await ids(check)).toEqual(["first", "dup"]);
  });

  it("fails a concurrent request whose write was dropped by another request's PUT network error", async () => {
    const { store, a, put } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const reqB = inRequest(async () => {
      await insert(a, "from-B");
      await gate;
    });
    put.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(inRequest(() => insert(a, "from-A"))).rejects.toThrow("ECONNRESET");
    release();
    await expect(reqB).rejects.toSatisfy((e) => isToolError(e, "unavailable"));
    expect(await ids(new SyncedDatabase(store, tempPath("check.db")))).toEqual(["first"]);
  });

  it("refuses further writes from a request whose earlier writes were dropped, so none of it lands", async () => {
    const { store, a, put } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const reqB = inRequest(async () => {
      await insert(a, "B1");
      await gate;
      await insert(a, "B2");
    });
    put.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(inRequest(() => insert(a, "from-A"))).rejects.toThrow("ECONNRESET");
    release();
    await expect(reqB).rejects.toSatisfy((e) => isToolError(e, "unavailable"));
    expect(await ids(new SyncedDatabase(store, tempPath("check.db")))).toEqual(["first"]);
  });

  it("gives up after five conflicts", async () => {
    const { a, put } = await setup();
    put.mockResolvedValue({ status: "conflict" });
    await expect(inRequest(() => insert(a, "x"))).rejects.toSatisfy((e) => isToolError(e, "unavailable"));
    expect(put).toHaveBeenCalledTimes(5);
  });
});

describe("slot cron on R2", () => {
  const fixture = (name: string) => readFileSync(join(root, "test/fixtures/slots", name), "utf8");

  it("refreshes every saved Lima place in one run with a single PUT", async () => {
    // The seeded Lima data, one trip over the next 4 days saving every place with readable slots.
    const local = tempPath("lima.db");
    const file = new FileDatabase(local);
    await migrate(file, join(root, "db/migrations"));
    await seed(file, join(root, "data/cities"));
    const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    const readable = await file.run((s) => {
      s.prepare("INSERT INTO app_user (id, email, name, created_at) VALUES ('u1', 'max@example.com', 'max', 'x')").run();
      s.prepare("INSERT INTO trip (id, owner, city, start_date, end_date, party, base, created_at) VALUES ('t1', 'u1', 'lima', ?, ?, 2, '{}', 'x')").run(day(0), day(3));
      const ids = s
        .prepare(`SELECT id FROM place WHERE curated = 1 AND EXISTS (SELECT 1 FROM json_each(channels) WHERE json_extract(value, '$.type') IN ('mesa247', 'meitre'))`)
        .all()
        .map((r) => r.id as string);
      for (const id of ids) s.prepare("INSERT INTO save (owner, place, created_at) VALUES ('u1', ?, 'x')").run(id);
      return ids;
    });
    file.close();

    const store = new MemoryStore();
    await store.put(readFileSync(local), null);
    const put = vi.spyOn(store, "put");
    installDatabase(new SyncedDatabase(store, tempPath("r2-copy.db")));
    vi.stubEnv("CRON_SECRET", "s3cret");
    const mesa = fixture("mesa-central-2026-11-21.json");
    const meitre = { lunch: fixture("meitre-cosme-2026-11-21-lunch.json"), dinner: fixture("meitre-cosme-2026-11-21-dinner.json") };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes("meitre.com")) return new Response(u.includes("/lunch/") ? meitre.lunch : meitre.dinner);
        return new Response(mesa);
      }),
    );

    const { GET } = await import("../api/cron/slots.js");
    const res = await GET(new Request("http://localhost/api/cron/slots", { headers: { Authorization: "Bearer s3cret" } }));
    const summary = (await res.json()) as { places: number; dates: number; steps: Record<string, number> };

    expect(readable.length).toBeGreaterThan(5);
    expect(summary.places).toBe(readable.length);
    expect(summary.steps.live).toBe(summary.dates);
    expect(put).toHaveBeenCalledTimes(1);
    const check = new SyncedDatabase(store, tempPath("after.db"));
    const counts = await check.run((s) => s.prepare("SELECT (SELECT count(*) FROM interaction) AS interactions, (SELECT count(DISTINCT place) FROM slot_read) AS places").get());
    expect(counts).toEqual({ interactions: summary.dates, places: readable.length });
  });
});
