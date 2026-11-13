# Wayfare (dining planner): SDK friction log, round 1

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

### 7. Configuration is a global, not part of the call (missing case)

`BLOCK_CHANNELS` switches a booking platform off without a code change, so the slot ladder goes straight to `last_good` (acceptance test 3). The SDK's server code reads variables from `process.env` (`spec/43-deploying.md#env`), a global with no declared names or types, and `context` carries only `auth`. To keep `server/` testable without mutating `process.env`, the Node adapters parse the variable and push it into module state with `setBlockedChannels`, and each test resets it.

```ts nocheck
// before: api/route.ts and api/cron/slots.ts, on every call
setBlockedChannels(blockedChannelsFromEnv(process.env.BLOCK_CHANNELS));
// server/adapters/slots.ts
if (isBlocked(adapter.channel)) throw blocked(`${adapter.channel} is switched off by BLOCK_CHANNELS`);
// after: variables declared with a schema, read from the call's context, set per call in tests
export const config = env({ BLOCK_CHANNELS: z.string().default("").transform(list) });
async handler(input, { auth, env }) { if (env.BLOCK_CHANNELS.includes("mesa247")) ... }
```

### 8. No entrypoint can be for agents only (missing option)

`server/agent.ts` is the API Indent sessions and automations call to record facts and list places to refresh. In the SDK an entrypoint with `output` becomes a function agents call, but it is still served over HTTP to every person in the organization. Each of its four handlers starts with `requireAgent(context)`, which throws unless the actor is `indent`, and forgetting it in a fifth would open a write path to every signed-in user.

```ts nocheck
// before (server/agent.ts), in every handler
function requireAgent(context: Context) {
  if (context.auth?.actor.kind !== "indent") throw toolError("not_allowed", "The agent API is for Indent agents");
}
// after: who may call it is part of the declaration
export const recordFacts = mutation({ callers: ["agent"], input, output, handler });
```

### 9. `sql` cannot compose fragments (missing helper)

`places.search` has optional filters (kinds, area, a name query, curated only without one), so its `WHERE` is built as an array of strings and a parallel `params` array, then passed as a hand-built `Statement`. The same gap as item 4 from the other side: `sql` makes whole statements, with no way to nest one `sql` value in another or join a list of them, so every dynamic query gives up the template's binding safety.

```ts nocheck
// before (server/places.ts)
const where = ["place.city = ?"];
const params: Value[] = [city];
if (query) { where.push(`${foldSql("place.name")} LIKE ? ESCAPE '\\'`); params.push(likePattern(query)); }
const statement = { sql: `SELECT ... WHERE ${where.join(" AND ")}`, params, row: PlaceRow };
// after: fragments nest and join, and stay bound
const filters = [sql`place.city = ${city}`, query && sql`fold(place.name) LIKE ${likePattern(query)}`];
await db.execute(sql(PlaceRow)`SELECT ... WHERE ${sql.join(filters.filter(Boolean), " AND ")}`);
```

### 10. Case-insensitive search stops at ASCII (missing engine feature)

Lima's places have Spanish names: "Astrid y Gastón", "Ámaz", "Anticuchos de la Tía Grimanesa". SQLite's `lower()` and `NOCASE` fold only ASCII, so "gaston" does not find "Gastón" and "ámaz" does not find "Ámaz". `places.search` wraps the column in a chain of `replace()` calls, one per accented letter in both cases, and folds the query the same way in JavaScript. The runtime cannot register a SQL function or collation, and the engine has no ICU or unaccent, so there is no better fix inside an app.

```ts nocheck
// before (server/places.ts): lower(), then replace() for each of á é í ó ú ü ñ ô è à and their capitals
let out = `lower(${expr})`;
for (const [from, to] of accents) out = `replace(${out}, '${from}', '${to}')`;
// after: the engine folds Unicode, as a function or a collation
SELECT * FROM place WHERE fold(name) LIKE fold(${q});            // or: name LIKE ${q} COLLATE unicode_nocase
```

### 11. A call cannot batch its writes (missing call)

The slot cron reads 17 Lima places over 4 days: 68 `attempt()` calls, each writing its interaction rows, plus one `slot_read` write per place. Each `db.execute` is its own transaction, so that is 85 commits. On the shim each commit was a full upload of the file to R2, so the cron made 85 PUTs. The shim now holds a request's writes in the local copy and uploads once when the call ends, replaying them in order on a 412 (one PUT for the same run). The SDK's database commits server-side, so 85 commits are 85 round trips, and in a workflow run 85 recorded calls. Code that logs as it goes, like `attempt()`, cannot say "these rows can land with the call's other writes".

```ts nocheck
// before: every attempt() commits its log rows at once
await db.execute(...rows.flatMap(statements));
// after: rows that only need to land if the call finishes, committed with its last write
db.defer(...rows.flatMap(statements));       // or: a call-scoped transaction the runtime commits on return

### 12. A bound value cannot be binary (missing type)

`/api/voice` stores each clip in `media.bytes`, a `blob` column. `Value` is `string | number | boolean | null`, so `sql` cannot bind a `Uint8Array`. `lib/voice.ts` casts the bytes to `Value`, which works only because the local driver hands parameters to `node:sqlite` unchanged. Base64 in a text column would grow every clip by a third in a file that is uploaded whole on each write.

```ts nocheck
// before (lib/voice.ts)
sql`INSERT INTO media (id, owner, kind, mime, bytes, created_at) VALUES (${id}, ${owner}, 'voice', ${mime}, ${bytes as unknown as Value}, ${now})`;
// after
export type Value = string | number | boolean | null | Uint8Array;
```

### 13. Server code cannot read a secret by name, or ask whether one is set (missing call)

Interpretation calls the AI Gateway with a key; `travel.minutes` uses the Routes API when `GOOGLE_MAPS_KEY` exists and a distance estimate when it doesn't. Item 7 covers plain settings; keys are different because the spec attaches credentials at egress by host, which covers the first case if the gateway's host is registered, but gives code no way to branch on whether a credential exists. `lib/env.ts` reads `process.env` through `globalThis` when the host has one.

```ts nocheck
// before (lib/env.ts, server/adapters/routes.ts)
const key = env("GOOGLE_MAPS_KEY");
if (key) steps.push(["live", () => routes(key, ...)]);
// after: egress credentials, plus a presence check
if (secrets.has("google-maps")) steps.push(["live", () => fetch(ROUTES_URL, ...)]); // header added at egress
```

### 14. A transaction cannot read before it writes (missing case)

`input.interpret` applies every action in one `db.execute` and stores an undo record with each row's prior value. `db.execute` takes a fixed list of statements, so the prior rows are read in a separate call first; a write landing between the two makes the undo record stale. The same shape blocks "update this meal if its status is still X, else tell me what it is now" without encoding the check into each statement.

```ts nocheck
// before (server/input.ts)
const before = await db.execute(...reads);          // call 1
await db.execute(...writes(before), insertUndo);    // call 2
// after: an interactive transaction, retried as a whole on conflict
await db.transaction(async (tx) => {
  const before = await tx.execute(...reads);
  await tx.execute(...writes(before), insertUndo);
});
```

### 15. One entrypoint cannot call another inside its transaction (missing call)

Interpretation turns "La Mar closes at 4:30 now" into a user fact, which `facts.report` owns. Calling the entrypoint would commit separately from the anchor and save written alongside it, so `server/facts.ts` exports `reportFactStatement`, the write without the commit, and both paths use it. Each entrypoint another one composes needs that split by hand.

```ts nocheck
// before (server/facts.ts, server/input.ts)
export function reportFactStatement(userId, place, field, value, at): Statement<Fact> { ... }
writes.push(reportFactStatement(owner, place, field, value, now));
await db.execute(...writes, insertUndo);
// after: entrypoints run inside the caller's transaction
await db.transaction(async (tx) => { await facts.report.run(tx, { place, field, value }, context); ... });
```

### 16. `Intl` time zones are not listed in the runtime (unclear)

Anchors and meals are wall-clock times in the city (`America/Lima`); the Routes API wants an instant, and calendar events arrive as instants. `server/time.ts` converts with `Intl.DateTimeFormat({ timeZone })`, the only zone-aware API in a runtime with no Node modules. The runtime's Has list doesn't name `Intl`, and an isolate built without ICU data would turn every Lima time into UTC, five hours off, with no error.

```ts nocheck
// server/time.ts
new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", ... }).formatToParts(at);
// fix: list Intl with full ICU in spec/38-apps.md#server-runtime, or ship Temporal
Temporal.ZonedDateTime.from({ timeZone: "America/Lima", year: 2026, month: 11, day: 23, hour: 21 }).toInstant();
```

### 17. A column cannot be write-only (missing option)

The wizard stores the traveler's passport number for booking forms that ask for it. It lives in `user_private.passport`, and the UI must only ever learn whether one is on file. `table()`'s `people` option marks the column as personal, but nothing stops a handler from selecting it and returning it, or a later `SELECT *` from carrying it into a response; the guarantee is a test (`test/me.test.ts`) that scans every response and every other table for the number. The booking agent in Phase 2 needs the opposite half: one entrypoint that may read it, to fill a form.

```ts nocheck
// before (server/tables.ts): personal, but readable by any handler
export const userPrivate = table("user_private", z.object({ owner: text, passport: maybeText, updated_at: text }), { key: ["owner"], people: ["passport"] });
// after: written by anyone with the owner's auth, read only where declared, and never in an output schema
export const userPrivate = table("user_private", Row, { key: ["owner"], secret: { passport: { readBy: ["bookings.fillForm"] } } });
```
