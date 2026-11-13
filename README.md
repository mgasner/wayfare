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
bin/load-overture lima # Overture eat-and-drink places as uncurated rows; matches curated ones
```

The database is one SQLite file per environment in R2 (`prod.db`, `dev.db`; `DB_KEY` defaults by `VERCEL_ENV`), or a local file with `DB_FILE`. Each function instance keeps a copy in `/tmp`, revalidates it once per request, and uploads it with `If-Match` after each write; on a conflict it downloads again and replays the write, up to 5 times. Vercel builds run `bin/migrate` and `bin/seed` first (`pnpm vercel-build`).

- Schema changes: a new `db/migrations/NNNN_name.sql`, plus the columns in `server/tables.ts` (a test compares them).
- City data: `data/cities/<city>/{city.json,areas.json,places/<id>.json}`, shaped by `shared/research.ts`. Seeding upserts and never deletes.
- Sign-in: Google OAuth in `api/auth/{login,callback,logout}.ts`; the session is an HMAC-signed cookie with the user id (no session table). The refresh token for Calendar is in `calendar_link.credentials` (`{refresh_token, scope, sub}`, provider `google`, ref = email). Off Vercel, `DEV_USER` signs in requests that have no session.

- `server/<file>.ts` exports `query(...)` and `mutation(...)` from `lib/nexus.ts`, served at `/api/<file>/<export>`. Add each new file to `server/index.ts`.
- `server/` runs in the nexus-sdk server runtime's subset; `test/runtime-imports.test.ts` fails on any Node built-in it reaches.
- Relative imports end in `.js` (Node ESM on Vercel), even for `.ts` files.
- `ui/src/api.ts`: `call("trips.get", { id })`, typed from the server modules.
- Third-party calls go through `attempt()` (`lib/attempt.ts`): one `interaction` row per ladder step, `request.public` to `interaction.request` (strings that look like a phone, email or passport number are redacted), `request.private` and `ctx.privately()` to `interaction_private`. `docs/queries.md` has the saved queries; a test runs each one.
- `docs/sdk-friction.md`: where `lib/nexus.ts` differs from nexus-sdk, and why.
- `bin/load-overture <city>` reads the latest Overture release (DuckDB, anonymous S3) inside the city's bbox, upserts eat-and-drink places as uncurated rows (`ov-<overture id>`), and matches curated places by name within 150 m, writing the match's `overture_id` and coordinates into the DB and into `data/cities/<city>/places/*.json` (`--no-files` to skip). Seeding a curated place absorbs any uncurated row with the same Overture or Google id.
- Slots: `server/adapters/mesa247.ts` and `meitre.ts` read through `attempt()` (live → last_good → unknown); `api/cron/slots.ts` runs every 15 minutes (vercel.json) for places with meals or saves on trips in the next 14 days, authorized by `CRON_SECRET`. `BLOCK_CHANNELS=mesa247` makes live reads fail as blocked, to exercise the fallback.
