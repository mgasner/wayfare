import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attempt, blocked, empty, personalKinds } from "../lib/attempt.js";
import type { FileDatabase } from "../lib/db.js";
import { isToolError } from "../lib/nexus.js";
import { PASSPORTS } from "./fixtures.js";
import { addUser, personalDataInInteractions, seededDb } from "./helpers.js";

let database: FileDatabase;
let owner: string;

beforeEach(async () => {
  database = await seededDb();
  const auth = await addUser(database, "max@example.com");
  owner = auth.actor.kind === "person" ? auth.actor.id : "";
});

const interactions = () => database.run((s) => s.prepare("SELECT * FROM interaction ORDER BY at, rowid").all());
const privates = () => database.run((s) => s.prepare("SELECT * FROM interaction_private").all());

describe("attempt", () => {
  it("falls down the ladder, one linked row per step tried", async () => {
    const result = await attempt(
      { kind: "slots.read", channel: "mesa247", place: "central", owner, request: { public: { date: "2026-11-21", party: 2 } } },
      [
        ["live", () => {
          throw new Error("Mesa answered 500");
        }],
        ["last_good", (ctx) => {
          ctx.checkedAt("2026-11-21T01:30:00Z");
          return { times: ["20:00", "20:15"] };
        }],
        ["unknown", () => ({ times: null })],
      ],
    );
    expect(result).toMatchObject({ value: { times: ["20:00", "20:15"] }, step: "last_good", checkedAt: "2026-11-21T01:30:00Z" });

    const rows = await interactions();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: result.interaction, parent: null, fallback: "live", outcome: "error", error: "Mesa answered 500" });
    expect(rows[1]).toMatchObject({ parent: result.interaction, fallback: "last_good", outcome: "ok", error: null });
    expect(rows.every((r) => r.channel === "mesa247" && r.kind === "slots.read" && r.place === "central" && r.owner === owner)).toBe(true);
    expect(JSON.parse(rows[0]!.request as string)).toEqual({ date: "2026-11-21", party: 2 });
    expect(typeof rows[0]!.latency_ms).toBe("number");
  });

  it("moves on from an empty step and a blocked one", async () => {
    const result = await attempt({ kind: "slots.read", channel: "mesa247" }, [
      ["live", () => {
        throw blocked("MESA_BLOCKED is set");
      }],
      ["last_good", () => empty],
      ["unknown", () => "no data"],
    ]);
    expect(result.step).toBe("unknown");
    expect((await interactions()).map((r) => [r.fallback, r.outcome])).toEqual([
      ["live", "blocked"],
      ["last_good", "empty"],
      ["unknown", "ok"],
    ]);
  });

  it("times out a fetch through ctx.signal", async () => {
    const server = createServer(() => {}); // never answers
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      const result = await attempt({ kind: "slots.read", channel: "mesa247", timeoutMs: 50 }, [
        ["live", async ({ signal }) => (await fetch(`http://127.0.0.1:${port}/`, { signal })).text()],
        ["unknown", () => "fallback"],
      ]);
      expect(result.step).toBe("unknown");
      const [live] = await interactions();
      expect(live).toMatchObject({ outcome: "timeout" });
      expect(live!.latency_ms as number).toBeGreaterThanOrEqual(40);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("records cost and notes publicly and personal data privately", async () => {
    await attempt(
      {
        kind: "transcribe",
        channel: "openai",
        owner,
        request: { public: { model: "gpt-4o-transcribe", seconds: 6 }, private: { media: "m1" } },
      },
      [
        ["live", (ctx) => {
          ctx.cost(0.0036);
          ctx.note({ sku: "audio.transcribe" });
          ctx.privately({ transcript: "el viernes estamos en Barranco, ten to six" });
          return "ok";
        }],
      ],
    );
    const [row] = await interactions();
    expect(row).toMatchObject({ cost_usd: 0.0036, outcome: "ok" });
    expect(JSON.parse(row!.request as string)).toEqual({ model: "gpt-4o-transcribe", seconds: 6, sku: "audio.transcribe" });
    const [priv] = await privates();
    expect(priv).toMatchObject({ interaction: row!.id, owner });
    expect(JSON.parse(priv!.payload as string)).toEqual({ media: "m1", transcript: "el viernes estamos en Barranco, ten to six" });
  });

  it("links a step's media row in interaction_private", async () => {
    await attempt({ kind: "transcribe", channel: "openai", owner }, [
      ["live", (ctx) => {
        ctx.media("clip-1");
        throw new Error("upstream 500");
      }],
      ["retry", (ctx) => {
        ctx.media("clip-1");
        ctx.privately({ transcript: "hola" });
        return "hola";
      }],
    ]);
    const rows = await interactions();
    const privs = await privates();
    expect(privs.map((p) => [p.interaction, p.media, JSON.parse(p.payload as string)])).toEqual([
      [rows[0]!.id, "clip-1", {}],
      [rows[1]!.id, "clip-1", { transcript: "hola" }],
    ]);
    await expect(attempt({ kind: "x", channel: "y" }, [["live", (ctx) => (ctx.media("m"), 1)]])).rejects.toThrow();
  });

  it("refuses private data without an owner", async () => {
    await expect(
      attempt({ kind: "x", channel: "y", request: { private: { phone: "+51 987 654 321" } } }, [["live", () => 1]]),
    ).rejects.toThrow(/needs an owner/);
  });

  it("logs every step and throws unavailable when none produce a value", async () => {
    await expect(
      attempt({ kind: "place.lookup", channel: "google.places" }, [
        ["live", () => {
          throw new Error("down");
        }],
        ["cache", () => empty],
      ]),
    ).rejects.toSatisfy((e) => isToolError(e, "unavailable"));
    expect(await interactions()).toHaveLength(2);
  });

  it("returns the value even when the log write fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    database.close();
    await database.run((s) => s.exec("DROP TABLE interaction_private; DROP TABLE interaction"));
    const result = await attempt({ kind: "x", channel: "y" }, [["live", () => 42]]);
    expect(result.value).toBe(42);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("personal data in interaction.request", () => {
  it("detects phones, emails and passport numbers, not dates, times or ids", () => {
    for (const text of ["+51 987 654 321", "987654321", "(01) 242-8515", "+1 (510) 495-4557", "call 987-654-321 after 5"]) {
      expect(personalKinds(text), text).toContain("phone");
    }
    expect(personalKinds("reservas@centralrestaurante.com.pe")).toContain("email");
    for (const p of PASSPORTS) {
      expect(personalKinds(p), p).not.toEqual([]);
      expect(personalKinds(`passport ${p}`), p).not.toEqual([]);
    }
    expect(personalKinds("passport X1234567")).toContain("passport");
    expect(personalKinds("AB1234567")).toContain("passport");
    for (const text of [
      "2026-11-21",
      "20:00",
      "2026-11-21T01:30:00Z",
      "2026-11-21T01:30:00.123+00:00",
      "c513bd81-fb00-4081-a807-19348bf66159",
      "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "08f2a100d2a3c69e0f8b7a6c5d4e3f21",
      "12345",
      "120.50",
      "Mesa 24/7",
      "lunch 12:00-17:00",
      "-12.1133,-77.0453",
    ]) {
      expect(personalKinds(text), text).toEqual([]);
    }
  });

  it("never reads an id as a phone number", () => {
    for (let i = 0; i < 20_000; i++) {
      const id = crypto.randomUUID();
      expect(personalKinds(id), id).toEqual([]);
      expect(personalKinds(`trip ${id} on 2026-11-21`), id).toEqual([]);
      expect(personalKinds(id.toUpperCase()), id).toEqual([]);
      expect(personalKinds(id.replace(/-/g, "")), id).toEqual([]);
    }
    for (const id of ["g1a2b3c4d:f1", "el-chinito-52894e5f", "01HZX3K9M2Q8R7T6V5W4Y3Z2A1", "ov-08f2a1-4533-9463-815", "LA2470-20261123"]) {
      expect(personalKinds(id), id).toEqual([]);
    }
    expect(personalKinds("call +51 987 654 321, trip 52894e5f-f9aa-4533-9463-81575c475ffd")).toEqual(["phone"]);
  });

  it("no string in any interaction.request row looks personal", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spec = { kind: "slots.read", channel: "mesa247", owner } as const;
    await attempt({ ...spec, request: { public: { date: "2026-11-21", party: 2, place: "central" } } }, [["live", () => 1]]);
    // A careless caller: the email and phone are redacted before the row is written.
    await attempt(
      { ...spec, request: { public: { contact: "max@example.com", nested: [{ whatsapp: "+51 987 654 321" }] } } },
      [["live", (ctx) => {
        ctx.note({ guest: "passport X1234567" });
        throw new Error("Mesa rejected max@example.com");
      }], ["unknown", () => 1]],
    );
    expect(await personalDataInInteractions(database)).toEqual([]);
    const errors = (await interactions()).map((r) => r.error).filter(Boolean);
    expect(errors).toEqual(["[redacted email]"]);
    expect(warn).toHaveBeenCalledTimes(5); // contact and whatsapp on both rows, the passport note on one
    warn.mockRestore();
  });
});
