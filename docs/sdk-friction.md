# Dining planner: SDK friction log, round 1

Against nexus-sdk `629ba78` (`sdk/index.d.ts`, `spec/38-apps.md`, `spec/39-state.md`, `spec/30-sql.md`). Each item names the app feature, the gap, and the fix. `lib/nexus.ts` implements the SDK's signatures; where it differs, the item says how. The plan's six known gaps (no callers outside the organization, no standalone site, no deploy, no workflows in `indent app dev`, no published package, string-only `fetch` bodies) are not repeated here.

### 1. Signed-out callers have no `auth` (missing case)

`me.get` answers `User | null` so the UI knows to show Sign in, and a public place page would serve anyone. `Context` is `{ auth: Auth }`, and the spec says Indent authenticates every caller, so there is no way to say "nobody is signed in". `lib/nexus.ts` widens it to `Auth | null`, and handlers that need a person call `person(context)`, which throws `no_user`. Code written against the wider type still compiles against the SDK.

```ts nocheck
// SDK: every call has an actor
export type Context = { auth: Auth };
// before (lib/nexus.ts)
export type Context = { auth: Auth | null };
export const get = query({
  input: z.object({}),
  async handler(_, { auth }) {
    if (auth?.actor.kind !== "person") return null;
    // ...
  },
});
// after: an actor for an anonymous caller, and the check as a method
type Actor = ... | { kind: "anonymous" };
const me = auth.person(); // throws no_user unless a person is signed in
```

### 2. Outside Indent's build, the UI cannot tell a query from a mutation (missing tool)

In the SDK the UI imports entrypoints from `server/` and calls them (`useCall(trips.get, { id })`); the build swaps each import for a stub that makes the HTTP call (`spec/40-ui.md`). On Vite and Vercel there is no swap. `ui/src/api.ts` calls `call("trips.get", input)` with types from `import type` of the server modules, which erase `kind`, so at runtime it cannot pick GET or POST, and importing the modules for real would bundle server code into the UI. The app scans `server/*.ts` for `export const x = query(` in a Vite plugin (`virtual:entrypoints`), the same reading the SDK's build does, and a test checks the scan against the registry.

```ts nocheck
// before: vite.config.ts scans server/, and ui/src/api.ts looks the kind up
import kinds from "virtual:entrypoints"; // { "trips.get": "query", ... }
const res = kinds[name] === "query" ? await fetch(`${path}?input=${q}`) : await fetch(path, { method: "POST", body });
// after: the build's stub swap published as a Vite plugin, so the SDK's UI code runs unchanged
import { nexus } from "@indent-com/nexus-sdk/vite";
export default defineConfig({ plugins: [react(), nexus({ server: "server", baseUrl: "/api" })] });
// ui: import { get } from "../server/trips"; useCall(get, { id })
```

### 3. An app with its own sign-in cannot make an `Auth` (missing call)

The app signs people in with Google (`lib/auth.ts`) and keeps their id in a signed cookie. `Auth` has a private constructor, "Only Indent makes one". `lib/nexus.ts` adds `Auth.create(actor)` for the adapter, so the app's own users reach handlers as `{ kind: "person", id, name, email }`, with an `app_user` id that Indent does not know. Public apps (the plan's RFC) need the adapter half of this: a way to hand the runtime a verified identity from the app's own provider.

```ts nocheck
// before (lib/nexus.ts)
static create(actor: Actor): Auth;
return route(request, modules, async () => Auth.create({ kind: "person", ...user }));
// after: an app declares its identity provider and the runtime makes the Auth
export default app({ auth: { provider: "google", scopes: ["calendar.readonly"] } });
```

### 4. Partial updates need a hand-built `Statement` (missing helper)

`trips.update` changes only the fields given. `sql` binds values but cannot splice a column list, so the handler builds `{ sql, params, row }` by hand from a whitelist of keys. That works because `Statement` is a plain type, but every partial update in every app repeats it and the column names are unchecked.

```ts nocheck
// before (server/trips.ts)
const sets = keys.map((k) => `${k} = ?`).join(", ");
const update: Statement<Trip> = { sql: `UPDATE trip SET ${sets} WHERE id = ? AND owner = ?`, params: [...values, id, me.id], row: TripRow };
// after: a typed update from the table declaration
await db.execute(trips.update({ id, owner: me.id }, patch)); // columns checked against the row schema
```

### 5. JSON columns need a second schema to read (clunky)

Tables store lists and objects as JSON strings, and enum and boolean columns as text and integers. `server/tables.ts` declares each table's columns with `table()`, then a second row schema per table that parses JSON, maps 0/1 to booleans and pipes into the record type the UI uses. That is two schemas per table kept in step by a test.

```ts nocheck
// before (server/tables.ts)
export const trip = table("trip", z.object({ base: z.string(), appetite: z.string().nullable(), ... }));
export const TripRow = Trip.extend({ base: json(Base), appetite: json(Appetite).nullable(), ... });
// after: table() maps object, array and boolean fields to TEXT and INTEGER and parses them on read
export const trip = table("trip", Trip, { key: ["id"] });
const [{ rows }] = await db.execute(sql(trip)`SELECT * FROM trip WHERE id = ${id}`); // rows: Trip[]
```

### 6. Timeouts rest on `AbortSignal.timeout`, which the runtime does not list (unclear)

Every third-party call goes through `attempt()` with a per-adapter timeout (Mesa 8 s, Google 5 s, transcription 30 s). With no timers, the only timeout is a `fetch` signal from `AbortSignal.timeout`. The runtime's Has list names neither `AbortSignal` nor a `signal` option on `fetch`. If they are missing, a slow provider holds the call until its 30-second limit and the fallback ladder never runs.

```ts nocheck
// lib/attempt.ts, per step
const ctx = { signal: AbortSignal.timeout(spec.timeoutMs ?? 10_000), ... };
await fetch(url, { signal: ctx.signal });
// fix: list AbortSignal.timeout and fetch's signal in spec/38-apps.md#server-runtime, or take a timeout on fetch
await fetch(url, { timeout: 8_000 });
```
