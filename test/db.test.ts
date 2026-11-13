import { describe, expect, it, vi } from "vitest";
import { inRequest, MAX_TRIES, SyncedDatabase } from "../lib/db.js";
import { isToolError } from "../lib/nexus.js";
import { MemoryStore } from "../lib/store.js";
import { tempPath } from "./helpers.js";

const count = (db: SyncedDatabase) => db.run((s) => (s.prepare("SELECT count(*) AS n FROM t").get() as { n: number }).n);
const insert = (db: SyncedDatabase, id: string) => db.run((s) => s.prepare("INSERT INTO t (id) VALUES (?)").run(id));

async function pair() {
  const store = new MemoryStore();
  const logA = vi.fn();
  const a = new SyncedDatabase(store, tempPath("a.db"), logA);
  const b = new SyncedDatabase(store, tempPath("b.db"), vi.fn());
  await a.run((s) => {
    s.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
    s.prepare("INSERT INTO t (id) VALUES ('first')").run();
  });
  return { store, a, b, logA };
}

describe("SyncedDatabase", () => {
  it("creates the stored file on the first write", async () => {
    const { store } = await pair();
    expect(store.etag).toBe('"v1"');
  });

  it("replays a write after a conflict, keeping both writes", async () => {
    const { store, a, b, logA } = await pair();
    await inRequest(async () => {
      await count(a); // a revalidates for this request and holds v1
      await inRequest(() => insert(b, "from-b")); // another instance writes v2
      await insert(a, "from-a"); // a PUTs If-Match v1: 412, re-download v2, replay
    });
    expect(logA).toHaveBeenCalledTimes(1);
    expect(logA.mock.calls[0]![0]).toMatchObject({ event: "db.conflict", attempt: 1 });
    expect(store.etag).toBe('"v3"');
    const fresh = new SyncedDatabase(store, tempPath("c.db"));
    const ids = await fresh.run((s) => s.prepare("SELECT id FROM t ORDER BY id").all().map((r) => r.id));
    expect(ids).toEqual(["first", "from-a", "from-b"]);
  });

  it("gives up after five conflicts", async () => {
    const { store, a } = await pair();
    const put = vi.spyOn(store, "put").mockResolvedValue({ status: "conflict" });
    await expect(insert(a, "x")).rejects.toSatisfy((e) => isToolError(e, "unavailable"));
    expect(put).toHaveBeenCalledTimes(MAX_TRIES);
  });

  it("does not upload a transaction that changed nothing", async () => {
    const { store, a } = await pair();
    const put = vi.spyOn(store, "put");
    expect(await count(a)).toBe(1);
    await a.run((s) => s.prepare("UPDATE t SET id = id WHERE id = 'missing'").run());
    expect(put).not.toHaveBeenCalled();
  });

  it("revalidates at most once per request, with If-None-Match", async () => {
    const { store, a, b } = await pair();
    const get = vi.spyOn(store, "get");
    await inRequest(async () => {
      await count(a);
      await count(a);
      await insert(a, "x");
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenLastCalledWith('"v1"');
    await expect(get.mock.results[0]!.value).resolves.toEqual({ status: "not_modified" });

    await insert(b, "y");
    await inRequest(() => count(a));
    expect(get).toHaveBeenCalledTimes(3);
    expect(await inRequest(() => count(a))).toBe(3);
  });

  it("drops its copy when an upload fails, so the next call re-downloads", async () => {
    const { store, a } = await pair();
    vi.spyOn(store, "put").mockRejectedValueOnce(new Error("network"));
    await expect(insert(a, "lost")).rejects.toThrow("network");
    expect(await count(a)).toBe(1);
  });

  it("rolls back and uploads nothing when the transaction throws", async () => {
    const { store, a } = await pair();
    const put = vi.spyOn(store, "put");
    await expect(insert(a, "first")).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
    expect(await count(a)).toBe(1);
  });
});
