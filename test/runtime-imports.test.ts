import { builtinModules } from "node:module";
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

function serverFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return serverFiles(path);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Bundles entry points for the SDK's server runtime and returns each Node built-in import as "importer -> module". */
async function nodeImports(entryPoints: string[] | { contents: string; resolveDir: string }): Promise<string[]> {
  const found: string[] = [];
  const flag: Plugin = {
    name: "flag-node-builtins",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith("node:") || builtins.has(args.path.split("/")[0]!)) {
          found.push(`${relative(root, args.importer) || "<stdin>"} -> ${args.path}`);
          return { path: args.path, external: true };
        }
        return undefined;
      });
    },
  };
  await build({
    ...(Array.isArray(entryPoints) ? { entryPoints } : { stdin: { ...entryPoints, loader: "ts" } }),
    bundle: true,
    write: false,
    outdir: "/tmp/runtime-imports",
    platform: "neutral",
    format: "esm",
    target: "es2022",
    mainFields: ["module", "main"],
    conditions: ["browser", "import", "default"],
    logLevel: "silent",
    plugins: [flag],
  });
  return found;
}

describe("server runtime", () => {
  it("bundles server/ and lib/attempt.ts with no Node built-ins", async () => {
    const files = [...serverFiles(join(root, "server")), join(root, "lib/attempt.ts")];
    expect(files.length).toBeGreaterThan(0);
    expect(await nodeImports(files)).toEqual([]);
  });

  it("catches a Node built-in reached through lib/", async () => {
    const found = await nodeImports({ contents: `import "./lib/sqlite.js";`, resolveDir: root });
    expect(found).toContain("lib/sqlite.ts -> node:sqlite");
  });
});
