# dining-planner

A city dining planner, piloted on Lima. Plan: https://app.indent.com/reports/01a1d244-d12d-7998-a0e6-0439927ce1b1

```sh
pnpm install
pnpm dev         # Vite and the API on one port (PORT, default 5173)
pnpm typecheck
pnpm test
```

- `server/<file>.ts` exports `query(...)` and `mutation(...)` from `lib/nexus.ts`, served at `/api/<file>/<export>`. Add each new file to `server/index.ts`.
- `server/` runs in the nexus-sdk server runtime's subset; `test/runtime-imports.test.ts` fails on any Node built-in it reaches.
- Relative imports end in `.js` (Node ESM on Vercel), even for `.ts` files.
- `ui/src/api.ts`: `call("trips.get", { id })`, typed from the server modules.
