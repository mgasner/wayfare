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
  /** Uploads writes held for the request; a no-op for a local file. */
  flush(): Promise<void>;
  close(): void;
};

export const MAX_TRIES = 5;

type Scope = { revalidated: Set<Database>; written: Set<Database> };
const requestScope = new AsyncLocalStorage<Scope>();

/**
 * Runs `fn` as one request, cron run or bin invocation: the stored file is revalidated at most
 * once, writes apply to the local copy, and the file is uploaded once when `fn` settles.
 * A failed upload rejects, even if `fn` succeeded.
 */
export async function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  const scope: Scope = { revalidated: new Set(), written: new Set() };
  let result: T;
  try {
    result = await requestScope.run(scope, fn);
  } finally {
    // Writes already applied are uploaded even when fn throws, as they were when each execute uploaded.
    for (const database of scope.written) await database.flush();
  }
  return result;
}

/** inRequest for an HTTP handler: a failed upload answers 503, since the handler's answer did not stick. */
export async function serveInRequest(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await inRequest(fn);
  } catch (error) {
    console.error(error);
    return Response.json({ error: { code: "unavailable", message: "Could not save; try again" } }, { status: 503 });
  }
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

  async flush() {}

  close() {
    this.sqlite?.close();
    this.sqlite = null;
  }
}

/**
 * A copy of the stored file in `path`. Writes in a request apply locally and are kept in order;
 * `flush` uploads the file with If-Match on the ETag it was read at. On a 412 it downloads the
 * file again and replays the kept writes, each in its own transaction, up to MAX_TRIES uploads.
 * Outside a request, each write uploads at once.
 */
export class SyncedDatabase implements Database {
  private sqlite: DatabaseSync | null = null;
  private etag: string | null = null;
  private mutex = new Mutex();
  /** Writes applied locally and not yet uploaded, from every request on this instance. */
  private pending: ((db: DatabaseSync) => unknown)[] = [];

  constructor(
    readonly store: BlobStore,
    readonly path: string,
    private log: (event: Record<string, unknown>) => void = (e) => console.warn(JSON.stringify(e)),
  ) {}

  run<T>(fn: (db: DatabaseSync) => T): Promise<T> {
    const scope = requestScope.getStore();
    const result = this.mutex.run(async () => {
      if (!scope?.revalidated.has(this) || !this.sqlite) {
        await this.revalidate();
        scope?.revalidated.add(this);
      }
      const sqlite = this.open();
      const before = totalChanges(sqlite);
      const value = transaction(sqlite, () => fn(sqlite));
      if (totalChanges(sqlite) !== before) {
        this.pending.push(fn);
        scope?.written.add(this);
      }
      return value;
    });
    return scope ? result : result.then(async (value) => (await this.flush(), value));
  }

  flush(): Promise<void> {
    return this.mutex.run(async () => {
      for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        if (this.pending.length === 0) return;
        let put;
        try {
          put = await this.store.put(readFileSync(this.path), this.etag);
        } catch (error) {
          this.discard();
          throw error;
        }
        if (put.status === "ok") {
          this.etag = put.etag;
          this.pending = [];
          return;
        }
        this.log({ event: "db.conflict", store: this.store.name, attempt, etag: this.etag, replaying: this.pending.length });
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

  /** Takes the stored file if it changed, then replays writes not yet uploaded on top of it. */
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
    if (this.pending.length === 0) return;
    const sqlite = this.open();
    try {
      for (const fn of this.pending) transaction(sqlite, () => fn(sqlite));
    } catch (error) {
      this.log({ event: "db.replay_failed", store: this.store.name, error: String(error) });
      this.discard();
      throw toolError("unavailable", `A write no longer applies to ${this.store.name}: ${String(error)}`, { cause: error });
    }
  }

  private discard() {
    this.close();
    rmSync(this.path, { force: true });
    this.etag = null;
    this.pending = [];
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
  return new SyncedDatabase(r2StoreFromEnv(env), `/tmp/wayfare/${dbKey(env)}`);
}
