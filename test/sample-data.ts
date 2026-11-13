import { attempt, blocked, empty } from "../lib/attempt.js";
import type { FileDatabase } from "../lib/db.js";

const fail = (outcome: "timeout" | "error") => () => {
  throw outcome === "timeout" ? Object.assign(new Error("timed out"), { name: "TimeoutError" }) : new Error("500");
};

/** Sample interactions and one stale fact, as the queries expect to find them. */
export async function sampleData(database: FileDatabase) {
  const slots = (place: string) => ({ kind: "slots.read", channel: "mesa247", place, request: { public: { date: "2026-11-21", party: 2 } } });
  await attempt(slots("central"), [["live", () => ["20:00"]]]);
  await attempt(slots("central"), [["live", () => ["20:15"]]]);
  await attempt(slots("central"), [["live", fail("error")], ["last_good", () => ["20:00"]]]);
  await attempt(slots("central"), [["live", () => { throw blocked("MESA_BLOCKED"); }], ["last_good", () => empty], ["unknown", () => null]]);
  await attempt(slots("isolina"), [["live", fail("timeout")], ["last_good", () => ["13:00"]]]);
  await attempt({ kind: "interpret", channel: "gateway", request: { public: { city: "lima", model: "claude" } } }, [
    ["live", (ctx) => { ctx.cost(0.0021); return "ok"; }],
  ]);
  await attempt({ kind: "place.lookup", channel: "google.places", place: "la-mar-cebicheria", request: { public: { sku: "places.details.essentials" } } }, [
    ["live", () => "ChIJ"],
  ]);
  // Steps that read our own data under a provider's channel: no call, no cost.
  await attempt({ kind: "route.matrix", channel: "google.routes", request: { public: { city: "lima" } } }, [["estimate", () => [[12]]]]);
  await attempt({ kind: "place.lookup", channel: "google.places", place: "isolina", request: { public: { city: "lima" } } }, [
    ["known", () => "isolina"],
  ]);
  await attempt({ kind: "place.lookup", channel: "google.places", request: { public: { city: "lima" } } }, [
    ["known", () => empty],
    ["google", fail("error")],
    ["area", () => "barranco"],
  ]);
  await database.run((s) =>
    s.prepare("UPDATE fact SET checked_at = '2026-10-01T00:00:00Z' WHERE place = 'la-mar-cebicheria' AND field = 'hours'").run(),
  );
}
