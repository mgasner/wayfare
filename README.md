# dining-planner

A city dining planner, piloted on Lima. Plan: https://app.indent.com/reports/01a1d244-d12d-7998-a0e6-0439927ce1b1

```sh
pnpm install
cp .env.example .env   # DB_FILE=./local.db, DEV_USER=<your email>
pnpm db:setup          # bin/migrate && bin/seed
pnpm dev               # Vite and the API on one port (PORT, default 5173)
pnpm typecheck
pnpm test
bin/sql "select id, name, kind from place"   # add --json for JSON
```

The database is one SQLite file per environment in R2 (`prod.db`, `dev.db`; `DB_KEY` defaults by `VERCEL_ENV`), or a local file with `DB_FILE`. Each function instance keeps a copy in `/tmp`, revalidates it once per request, and uploads it with `If-Match` after each write; on a conflict it downloads again and replays the write, up to 5 times. Vercel builds run `bin/migrate` and `bin/seed` first (`pnpm vercel-build`).

- Schema changes: a new `db/migrations/NNNN_name.sql`, plus the columns in `server/tables.ts` (a test compares them).
- City data: `data/cities/<city>/{city.json,areas.json,places/<id>.json}`, shaped by `shared/research.ts`. Seeding upserts and never deletes.
- Sign-in: Google OAuth in `api/auth/{login,callback,logout}.ts`; the session is an HMAC-signed cookie with the user id (no session table). The refresh token for Calendar is in `calendar_link.credentials` (`{refresh_token, scope, sub}`, provider `google`, ref = email). Off Vercel, `DEV_USER` signs in requests that have no session.

- `server/<file>.ts` exports `query(...)` and `mutation(...)` from `lib/nexus.ts`, served at `/api/<file>/<export>`. Add each new file to `server/index.ts`.
- `server/` runs in the nexus-sdk server runtime's subset; `test/runtime-imports.test.ts` fails on any Node built-in it reaches.
- Relative imports end in `.js` (Node ESM on Vercel), even for `.ts` files.
- `ui/src/api.ts`: `call("trips.get", { id })`, typed from the server modules.
