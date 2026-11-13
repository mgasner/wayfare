import { describe, expect, it } from "vitest";
import { databaseFromEnv, dbKey, FileDatabase, SyncedDatabase, wayfareEnv } from "../lib/db.js";

const r2 = { R2_ACCOUNT_ID: "a", R2_BUCKET: "b", R2_ACCESS_KEY_ID: "c", R2_SECRET_ACCESS_KEY: "d" };

describe("WAYFARE_ENV", () => {
  it("is required, and only three values count", () => {
    expect(() => wayfareEnv({})).toThrow(/Set WAYFARE_ENV/);
    expect(() => wayfareEnv({ WAYFARE_ENV: "prod" })).toThrow(/Set WAYFARE_ENV/);
    for (const v of ["production", "preview", "local"] as const) expect(wayfareEnv({ WAYFARE_ENV: v })).toBe(v);
  });

  it("chooses the database key, not VERCEL_ENV", () => {
    expect(dbKey({ WAYFARE_ENV: "production" })).toBe("prod.db");
    expect(dbKey({ WAYFARE_ENV: "preview", VERCEL_ENV: "production" })).toBe("dev.db");
    expect(dbKey({ WAYFARE_ENV: "local" })).toBe("dev.db");
    expect(dbKey({ WAYFARE_ENV: "preview", DB_KEY: "pr-12.db" })).toBe("pr-12.db");
    // Production on Vercel with system variables hidden used to fall through to dev.db.
    expect(() => dbKey({ VERCEL: "1" })).toThrow(/Set WAYFARE_ENV/);
  });

  it("opens no database without it, and a local file only when local", () => {
    expect(() => databaseFromEnv({ ...r2 })).toThrow(/Set WAYFARE_ENV/);
    expect(() => databaseFromEnv({ DB_FILE: "/tmp/x.db" })).toThrow(/Set WAYFARE_ENV/);
    expect(() => databaseFromEnv({ WAYFARE_ENV: "production", DB_FILE: "/tmp/x.db", ...r2 })).toThrow(/DB_FILE is for WAYFARE_ENV=local/);
    expect(databaseFromEnv({ WAYFARE_ENV: "local", DB_FILE: "/tmp/x.db" })).toBeInstanceOf(FileDatabase);
    const prod = databaseFromEnv({ WAYFARE_ENV: "production", ...r2 }) as SyncedDatabase;
    expect(prod).toBeInstanceOf(SyncedDatabase);
    expect(prod.path).toBe("/tmp/wayfare/prod.db");
  });
});
