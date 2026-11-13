import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin, type ViteDevServer } from "vite";
import { defineConfig } from "vitest/config";
import { scanEntrypoints } from "./lib/entrypoints.js";

const root = import.meta.dirname;
const virtualId = "virtual:entrypoints";

/** `virtual:entrypoints`: each entrypoint's kind, so ui/src/api.ts knows GET from POST without importing server code. */
function entrypoints(): Plugin {
  return {
    name: "entrypoints",
    resolveId: (id) => (id === virtualId ? "\0" + virtualId : undefined),
    load(id) {
      if (id !== "\0" + virtualId) return;
      this.addWatchFile(resolve(root, "server"));
      return `export default ${JSON.stringify(scanEntrypoints(resolve(root, "server")))};`;
    },
    handleHotUpdate({ file, server }) {
      if (!file.startsWith(resolve(root, "server"))) return;
      const mod = server.moduleGraph.getModuleById("\0" + virtualId);
      if (mod) server.moduleGraph.invalidateModule(mod);
    },
  };
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
  return new Request(new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`), { method: req.method, headers, body });
}

async function send(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  for (const [k, v] of response.headers) {
    if (k !== "set-cookie") res.setHeader(k, v);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("set-cookie", cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** Serves api/ the way Vercel does: a file at the path first, then the /api/:file/:export rewrite. */
function api(): Plugin {
  return {
    name: "api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();
        const direct = resolve(root, `.${url.pathname.replace(/\/$/, "")}.ts`);
        const file = direct.startsWith(resolve(root, "api")) && existsSync(direct) ? direct : resolve(root, "api/route.ts");
        try {
          const mod = await server.ssrLoadModule(file);
          const handler = mod[req.method ?? "GET"] as ((r: Request) => Promise<Response>) | undefined;
          if (!handler) {
            res.statusCode = 405;
            return res.end();
          }
          await send(res, await handler(await toRequest(req)));
        } catch (error) {
          server.ssrFixStacktrace(error as Error);
          next(error);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The API runs in this process during `pnpm dev`, so it reads .env the way Vercel sets env vars.
  if (mode !== "test") {
    for (const [k, v] of Object.entries(loadEnv(mode, root, ""))) process.env[k] ??= v;
  }
  return {
    root: resolve(root, "ui"),
    publicDir: resolve(root, "ui/public"),
    envDir: root,
    plugins: [react(), entrypoints(), api()],
    server: { port: Number(process.env.PORT ?? 5173), fs: { allow: [root] } },
    build: { outDir: resolve(root, "dist"), emptyOutDir: true },
    test: {
      root,
      include: ["**/*.test.ts"],
      exclude: ["node_modules/**", "dist/**"],
    },
  };
});
