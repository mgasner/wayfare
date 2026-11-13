import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { toolError, type Driver } from "./nexus.js";
import { openSqlite, runStatements, totalChanges, transaction } from "./sqlite.js";
import { R2Store, type BlobStore } from "./store.js";

/** The environment's SQLite file. `run` is one transaction; a write may run `fn` again after a conflict. */
export type Database = {
  run<T>(fn: (db: DatabaseSync) => T): Promise<T>;
  close(): void;
};

export const MAX_TRIES = 5;

const requestScope = new AsyncLocalStorage<{ revalidated: boolean }>();

/** Runs `fn` as one request: the stored file is revalidated at most once inside it. */
export function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return requestScope.run({ revalidated: false }, fn);
}

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
}

/** A plain local file, for local dev and tests. */
export class FileDatabase implements Database {
  private sqlite: DatabaseSync | null = null;
  private mutex = new Mutex();
  constructor(readonly path: string) {}

  run<T>(fn: (db: DatabaseSync) => T): Promise<T> {
    return this.mutex.run(async () => {
      if (!this.sqlite) {
        mkdirSync(dirname(this.path), { recursive: true });
        this.sqlite = openSqlite(this.path);
      }
      const sqlite = this.sqlite;
      return transaction(sqlite, () => fn(sqlite));
    });
  }

  close() {
    this.sqlite?.close();
    this.sqlite = null;
  }
}

/** A copy of the stored file in `path`, uploaded with If-Match after each write. */
export class SyncedDatabase implements Database {
  private sqlite: DatabaseSync | null = null;
  private etag: string | null = null;
  private mutex = new Mutex();

  constructor(
    readonly store: BlobStore,
    readonly path: string,
    private log: (event: Record<string, unknown>) => void = (e) => console.warn(JSON.stringify(e)),
  ) {}

  run<T>(fn: (db: DatabaseSync) => T): Promise<T> {
    return this.mutex.run(async () => {
      const scope = requestScope.getStore();
      if (!scope?.revalidated || !this.sqlite) {
        await this.revalidate();
        if (scope) scope.revalidated = true;
      }
      for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        const sqlite = this.open();
        const before = totalChanges(sqlite);
        const result = transaction(sqlite, () => fn(sqlite));
        if (totalChanges(sqlite) === before) return result;
        let put;
        try {
          put = await this.store.put(readFileSync(this.path), this.etag);
        } catch (error) {
          this.discard();
          throw error;
        }
        if (put.status === "ok") {
          this.etag = put.etag;
          return result;
        }
        this.log({ event: "db.conflict", store: this.store.name, attempt, etag: this.etag });
        await this.revalidate(true);
      }
      this.discard();
      throw toolError("unavailable", `Gave up writing ${this.store.name} after ${MAX_TRIES} conflicts`);
    });
  }

  close() {
    this.sqlite?.close();
    this.sqlite = null;
  }

  private open(): DatabaseSync {
    if (!this.sqlite) {
      mkdirSync(dirname(this.path), { recursive: true });
      this.sqlite = openSqlite(this.path);
    }
    return this.sqlite;
  }

  private async revalidate(force = false) {
    const cached = !force && this.etag && existsSync(this.path) ? this.etag : undefined;
    const got = await this.store.get(cached);
    if (got.status === "not_modified") return;
    this.close();
    rmSync(`${this.path}-journal`, { force: true });
    mkdirSync(dirname(this.path), { recursive: true });
    if (got.status === "missing") {
      rmSync(this.path, { force: true });
      this.etag = null;
    } else {
      writeFileSync(this.path, got.body);
      this.etag = got.etag;
    }
  }

  private discard() {
    this.close();
    rmSync(this.path, { force: true });
    this.etag = null;
  }
}

export function driverFor(database: Database): Driver {
  return { execute: (statements) => database.run((sqlite) => runStatements(sqlite, statements)) };
}

export function dbKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.DB_KEY ?? (env.VERCEL_ENV === "production" ? "prod.db" : "dev.db");
}

export function r2StoreFromEnv(env: NodeJS.ProcessEnv = process.env): R2Store {
  const need = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`Set DB_FILE for a local file, or ${name} for R2`);
    return value;
  };
  return new R2Store({
    accountId: need("R2_ACCOUNT_ID"),
    bucket: need("R2_BUCKET"),
    accessKeyId: need("R2_ACCESS_KEY_ID"),
    secretAccessKey: need("R2_SECRET_ACCESS_KEY"),
    key: dbKey(env),
  });
}

export function databaseFromEnv(env: NodeJS.ProcessEnv = process.env): Database {
  if (env.DB_FILE) return new FileDatabase(env.DB_FILE);
  return new SyncedDatabase(r2StoreFromEnv(env), `/tmp/dining-planner/${dbKey(env)}`);
}
