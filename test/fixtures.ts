import { vi } from "vitest";
import type { FileDatabase } from "../lib/db.js";
import type { Auth } from "../lib/nexus.js";
import { callAs } from "./helpers.js";

// Nov 20 2026 is a Friday, Nov 21 a Saturday.
export const limaTrip = {
  city: "lima",
  start_date: "2026-11-18",
  end_date: "2026-11-23",
  party: 2,
  base: { name: "Hotel in Miraflores", lat: -12.1219, lng: -77.0302 },
};

export async function createTrip(auth: Auth): Promise<{ id: string }> {
  const { status, body } = await callAs(auth, "trips.create", limaTrip);
  if (status !== 200) throw new Error(`trips.create ${status}: ${JSON.stringify(body)}`);
  return body;
}

/** Places the seed data doesn't have yet, curated and not. */
export async function addPlaces(database: FileDatabase): Promise<void> {
  const rows: [string, string, string, string | null, number, number, number][] = [
    ["tia-grimanesa", "Anticuchos Tía Grimanesa", "miraflores", "informal", 1, -12.1105, -77.0281],
    ["rafael", "Rafael", "miraflores", "reserve_ahead", 1, -12.1193, -77.0359],
    ["ov-grimanesa-bar", "Bar Grimaldi", "miraflores", null, 0, -12.12, -77.03],
    ["ov-la-mar-market", "Mercado La Mar", "barranco", null, 0, -12.15, -77.02],
    ["maido", "Maido", "miraflores", "reserve_ahead", 1, -12.1253, -77.0302],
  ];
  await database.run((s) => {
    const insert = s.prepare(
      "INSERT OR IGNORE INTO place (id, city, area, name, kind, curated, lat, lng) VALUES (?, 'lima', ?, ?, ?, ?, ?, ?)",
    );
    for (const [id, name, area, kind, curated, lat, lng] of rows) insert.run(id, area, name, kind, curated, lat, lng);
  });
}

/** Stubs fetch so the model "calls" apply with `actions`; returns the request bodies it saw. */
export function stubModel(actions: unknown[] | (() => unknown[]), options: { status?: number } = {}) {
  const bodies: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (!String(url).endsWith("/chat/completions")) throw new Error(`unexpected fetch ${url}`);
      bodies.push(JSON.parse(String(init.body)));
      if (options.status) return new Response("upstream error", { status: options.status });
      const list = typeof actions === "function" ? actions() : actions;
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "apply", arguments: JSON.stringify({ actions: list }) } }] } }],
        usage: { prompt_tokens: 1000, completion_tokens: 100, cost: 0.004 },
      });
    }),
  );
  return bodies;
}
