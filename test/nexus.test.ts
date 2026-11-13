import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { db, isToolError, setDriver, sql } from "../lib/nexus.js";
import { openSqlite, runStatements, transaction } from "../lib/sqlite.js";

describe("sql", () => {
  it("binds each value as a parameter", () => {
    const name = "x'); DROP TABLE t; --";
    expect(sql`SELECT * FROM t WHERE a = ${name} AND b = ${2}`).toEqual({
      sql: "SELECT * FROM t WHERE a = ? AND b = ?",
      params: [name, 2],
    });
  });

  it("carries the row schema", () => {
    const Row = z.object({ a: z.number() });
    expect(sql(Row)`SELECT 1 AS a`.row).toBe(Row);
  });
});

describe("db.execute", () => {
  beforeEach(() => {
    const sqlite = openSqlite(":memory:");
    sqlite.exec("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL, flag INTEGER NOT NULL DEFAULT 0)");
    setDriver({ execute: async (statements) => transaction(sqlite, () => runStatements(sqlite, statements)) });
  });
  afterEach(() => setDriver(undefined));

  it("returns rows and changes per statement", async () => {
    const Row = z.object({ id: z.string(), n: z.number() });
    const [ins, sel] = await db.execute(
      sql`INSERT INTO t (id, n) VALUES (${"a"}, ${1}), (${"b"}, ${2})`,
      sql(Row)`SELECT id, n FROM t ORDER BY id`,
    );
    expect(ins.changes).toBe(2);
    expect(sel).toEqual({ rows: [{ id: "a", n: 1 }, { id: "b", n: 2 }], changes: 0 });
  });

  it("binds booleans as 1 or 0", async () => {
    await db.execute(sql`INSERT INTO t (id, n, flag) VALUES (${"a"}, ${1}, ${true})`);
    const [{ rows }] = await db.execute(sql(z.object({ flag: z.number() }))`SELECT flag FROM t`);
    expect(rows).toEqual([{ flag: 1 }]);
  });

  it("runs statements as one transaction", async () => {
    await expect(
      db.execute(sql`INSERT INTO t (id, n) VALUES (${"a"}, ${1})`, sql`INSERT INTO t (id, n) VALUES (${"a"}, ${2})`),
    ).rejects.toSatisfy((e) => isToolError(e, "sqlite_error"));
    const [{ rows }] = await db.execute(sql(z.object({ c: z.number() }))`SELECT count(*) AS c FROM t`);
    expect(rows).toEqual([{ c: 0 }]);
  });

  it("fails with row_mismatch naming the column", async () => {
    await db.execute(sql`INSERT INTO t (id, n) VALUES (${"a"}, ${1})`);
    await expect(db.execute(sql(z.object({ n: z.string() }))`SELECT n FROM t`)).rejects.toSatisfy(
      (e) => isToolError(e, "row_mismatch") && e.message.includes("n"),
    );
  });

  it("refuses schema changes and transaction control", async () => {
    for (const text of ["CREATE TABLE x (a)", "  pragma foreign_keys = off", "BEGIN", "drop table t"]) {
      const statement = { sql: text, params: [] };
      await expect(db.execute(statement)).rejects.toSatisfy((e) => isToolError(e, "not_allowed"));
    }
  });
});
