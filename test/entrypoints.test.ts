import { resolve } from "node:path";
import { expect, it } from "vitest";
import { scanEntrypoints } from "../lib/entrypoints.js";
import { isEntrypoint } from "../lib/nexus.js";
import { modules } from "../server/index.js";

it("registers every entrypoint the build scan finds, with the same kind", () => {
  const registered: Record<string, string> = {};
  for (const [file, exports] of Object.entries(modules as Record<string, Record<string, unknown>>)) {
    for (const [name, value] of Object.entries(exports)) {
      if (isEntrypoint(value)) registered[`${file}.${name}`] = value.kind;
    }
  }
  expect(registered).toEqual(scanEntrypoints(resolve(import.meta.dirname, "../server")));
});
