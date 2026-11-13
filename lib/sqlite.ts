import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { toolError, type Result, type Value } from "./nexus.js";

export function openSqlite(path: string, options: { readOnly?: boolean } = {}): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: options.readOnly ?? false });
  // Rollback journal, so the main file is complete after each commit and can be uploaded as is.
  if (!options.readOnly) db.exec("PRAGMA journal_mode = DELETE");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

/** Runs `fn` in one transaction; rolls back if it throws. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

export function totalChanges(db: DatabaseSync): number {
  const row = db.prepare("SELECT total_changes() AS n").get() as { n: number };
  return row.n;
}

/** Runs statements in order; call inside a transaction. `changes` comes from total_changes(). */
export function runStatements(db: DatabaseSync, statements: { sql: string; params: Value[] }[]): Result<unknown>[] {
  return statements.map((s) => {
    const before = totalChanges(db);
    let rows: unknown[];
    try {
      rows = db.prepare(s.sql).all(...(s.params as SQLInputValue[]));
    } catch (error) {
      throw toolError("sqlite_error", (error as Error).message, { cause: error });
    }
    return { rows: rows.map((r) => ({ ...(r as object) })), changes: totalChanges(db) - before };
  });
}
