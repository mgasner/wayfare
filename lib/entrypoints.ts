import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

/** Reads `export const x = query(` and `mutation(` from server/*.ts without running them, as the SDK's build does. */
export function scanEntrypoints(serverDir: string): Record<string, "query" | "mutation"> {
  const kinds: Record<string, "query" | "mutation"> = {};
  for (const name of readdirSync(serverDir).sort()) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name.endsWith(".d.ts")) continue;
    const file = basename(name, ".ts");
    const source = readFileSync(join(serverDir, name), "utf8");
    for (const m of source.matchAll(/^export const (\w+)\s*=\s*(query|mutation)\s*\(/gm)) {
      kinds[`${file}.${m[1]}`] = m[2] as "query" | "mutation";
    }
  }
  return kinds;
}
