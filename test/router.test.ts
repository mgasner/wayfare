import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Auth, mutation, query, toolError } from "../lib/nexus.js";
import { route } from "../lib/router.js";

const modules = {
  greet: {
    hello: query({
      input: z.object({ name: z.string().default("world") }),
      handler: async ({ name }, { auth }) => ({ text: `hello ${name}`, actor: auth?.actor ?? null }),
    }),
    shout: mutation({
      input: z.object({ text: z.string() }),
      handler: async ({ text }) => ({ text: text.toUpperCase() }),
    }),
    missing: query({
      input: z.object({}),
      handler: async () => {
        throw toolError("not_found", "nothing here");
      },
    }),
    typed: query({
      input: z.object({}),
      output: z.object({ n: z.number() }),
      handler: async () => ({ n: "one" }) as unknown as { n: number },
    }),
    helper: 42,
  },
};

const person = Auth.create({ kind: "person", id: "u1", name: "Max", email: "max@example.com" });
const call = (path: string, init?: RequestInit) =>
  route(new Request(`http://localhost${path}`, init), modules, async () => person);

describe("route", () => {
  it("serves a query as GET with ?input=", async () => {
    const res = await call(`/api/greet/hello?input=${encodeURIComponent(JSON.stringify({ name: "Lima" }))}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "hello Lima", actor: person.actor });
  });

  it("treats a missing input as {}", async () => {
    expect(await (await call("/api/greet/hello")).json()).toMatchObject({ text: "hello world" });
  });

  it("serves a mutation as POST with a JSON body", async () => {
    const res = await call("/api/greet/shout", { method: "POST", body: JSON.stringify({ text: "hola" }) });
    expect(await res.json()).toEqual({ text: "HOLA" });
  });

  it("reads the rewrite's file and export parameters", async () => {
    const res = await call("/api/route?file=greet&export=hello");
    expect(res.status).toBe(200);
  });

  it("answers 400 on input that does not parse", async () => {
    const res = await call("/api/greet/shout", { method: "POST", body: JSON.stringify({ text: 3 }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_input" } });
    expect((await call("/api/greet/hello?input=%7B")).status).toBe(400);
  });

  it("answers 405 on the wrong method", async () => {
    const res = await call("/api/greet/shout");
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("answers 404 for unknown files, exports and non-entrypoints", async () => {
    for (const path of ["/api/nope/hello", "/api/greet/nope", "/api/greet/helper", "/api/greet/constructor", "/api/x"]) {
      expect((await call(path)).status).toBe(404);
    }
  });

  it("maps tool errors to statuses", async () => {
    const res = await call("/api/greet/missing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "nothing here" } });
  });

  it("checks results against output", async () => {
    expect((await call("/api/greet/typed")).status).toBe(500);
  });
});
