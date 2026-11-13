import { afterEach, describe, expect, it, vi } from "vitest";
import { FileDatabase } from "../lib/db.js";
import { migrate } from "../lib/migrate.js";
import { root, tempPath } from "./helpers.js";

afterEach(() => vi.unstubAllEnvs());

describe("api/route.ts", () => {
  it("serves entrypoints from DB_FILE as DEV_USER", async () => {
    const path = tempPath();
    await migrate(new FileDatabase(path), `${root}/db/migrations`);
    vi.stubEnv("WAYFARE_ENV", "local");
    vi.stubEnv("DB_FILE", path);
    vi.stubEnv("DEV_USER", "dev@example.com");
    const { GET } = await import("../api/route.js");
    const res = await GET(new Request("http://localhost/api/route?file=me&export=get"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "dev@example.com", name: "dev" });
    const again = (await (await GET(new Request("http://localhost/api/me/get"))).json()) as { email: string };
    expect(again.email).toBe("dev@example.com");
  });
});
