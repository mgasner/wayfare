# Dining planner Phase 1: implementation plan

Phase 1 builds the foundations from the [design report](https://app.indent.com/reports/01a1d1ad-057e-7119-83cb-5adf0c6b435c): an app on Vercel with one SQLite file in a Cloudflare R2 bucket, accounts, a place store filled by an agent research pass, voice and text input, the anchor timeline, and the first four screens. It runs three weeks, Mon Nov 16 to Fri Dec 4, with four agents working in parallel stacks after a two-day foundation. Booking, watches, the itinerary builder, nudges, maps on the ground, CI and observability come in later phases.

**Done when** Max signs in on his phone and his laptop, sets up the Lima trip with the wizard, sees the same trip board on both, adds anchors and saves by voice, and Indent answers questions about the app's data and third-party failures from a session. Partner access moved to the sharing pass, so the earlier "two people on two phones" criterion now reads as one account on two devices.

## How the feedback changed the plan

| Feedback | In Phase 1 |
|---|---|
| Start with SQLite, kept simple | One SQLite file per environment in a Cloudflare R2 bucket: `prod.db` and `dev.db` |
| Delay CI, Sentry, PostHog, Datadog | None of them. Agents run tests in their sandboxes before each PR; Indent code review runs on every PR |
| Fall back gracefully and log every third-party call | `attempt()` and the interaction log are the first shared code; the Mesa 24/7 port is their first user |
| Redact personal data, screenshots included | Personal fields go to a separate table by type; screenshot redaction arrives with screenshot input in Phase 2 |
| Audio first | One hold-to-talk component behind every free-form input |
| Free-form input, no "Read as" | Input produces the changed thing (an anchor, a save) with Undo. No parse display |
| Hints and calendars | Anchors from spoken or typed hints, Google Calendar and ICS feeds |
| Clock icon for stale data | Every volatile fact has `checked_at` and a freshness window; one `<Stale>` component |
| Swipeable wizard, condensed, city-themed, mobile everywhere | The v2 sketches below; theme as tokens; every screen built mobile first, desktop as a wider layout |
| Research at go-live, refreshed, plus learning from users | City data lives in the repo and changes by PR; user-reported facts are stored per user and promoted after confirmation |
| Link to and summarize third-party sources | Places store our summaries and outbound links to reviews, guides and menus |
| User-chosen refresh cadence, paid | Cadence is a trip field with one default; pricing comes later |
| Agentic parts on Indent; SDK proposals as an output | Server code written in the nexus-sdk shapes, a friction log, and a first SDK proposal at the end of week 3 |
| Agent visibility is per feature | Phase 1's only agent surface is input interpretation; results show as objects |

## Screens

From the v2 sketches. Decisions on theme and board approach are at the end.

![New trip as a 6-page swipe flow](assets/a-wizard-filmstrip.png)

![Three light Lima themes](assets/b-themes-overview.png)

| Mobile board: whole trip | Mobile board: one day |
|---|---|
| ![Grid](assets/c-board-2a-grid.png) | ![Day zoom](assets/c-board-2b-grid-day-zoom.png) |

Phase 1 screens:
- **New trip wizard**: the six pages above, ending on the summary. "Build my shortlist" opens Discover filtered to the trip.
- **Discover**: list and MapLibre map, filters for meal, day, kind and travel time from the anchor at that hour, live slots with the clock icon.
- **Restaurant detail**: our summary, links out, hours, channels, slots by day, save and add-to-trip.
- **Trip board**: the grid and day sheet on mobile, the board from `plan/04-trip-board` on desktop. Meal status is set by hand in Phase 1 ("Mark booked"). The "Fill gaps" button stays hidden until Phase 2.5.
- **Want to visit**: saves, grouped by area.
- **Where you'll be**: the anchor timeline per day, with a mic button and calendar connection.

## Architecture

### Where the code runs

The app's users are travelers outside Indent's organization, and the nexus-sdk spec serves an app only to people and bots in the organization, inside Indent's UI slots. neo's `indent app` CLI has `dev`, `types`, `db` and `build` and no deploy, and `indent app dev` has no workflows or triggers yet. So Phase 1 runs on Vercel, and the code is shaped so it can move:

- `server/` holds entrypoints written as nexus-sdk `query` and `mutation` calls with zod `input` and `output`, tables declared with `table()`, and SQL through `db.execute(sql\`…\`)`. A local module `lib/nexus.ts` implements those signatures, copied from `sdk/index.d.ts` at nexus-sdk `629ba78`, over the SQLite file. Moving to the SDK is an import change plus whatever the friction log records.
- `server/` uses only what the SDK's server runtime has: `fetch`, `crypto.randomUUID`, `URL`, `TextEncoder`, no Node modules and no timers. A test bundles `server/` for a browser target and fails on any Node import. The SQLite engine sits behind `db.execute` in `lib/`, outside `server/`.
- `api/` is the Vercel adapter: one function routes `/api/<file>/<export>` to `server/<file>.ts`, GET for queries and POST for mutations, the same convention as the SDK's HTTP section. It also hosts the parts that need Node: auth, multipart audio upload, and cron entry points.
- Deterministic jobs (slot refresh) run on Vercel Cron. Agentic jobs (city research, fact refresh, promoting user facts) run as Indent sessions and automations with prompts checked into `agents/`, calling the app through an agent API. They move to SDK workflows when the runtime has them.

### Stack

| Part | Choice |
|---|---|
| Language and build | TypeScript, pnpm, Vite and React 19 (the toolchain nexus-sdk apps use), installable PWA |
| Hosting | Vercel project in team `indent`, git-connected, preview per PR |
| Database | A SQLite file in R2. Each function instance caches it in `/tmp` and revalidates with a conditional GET. A mutation applies its statements, then PUTs the file with `If-Match` on the ETag it read; R2 checks that atomically, and a 412 means another write landed first, so the function downloads again and replays. Previews and local use `dev.db` |
| Auth | Better Auth with Google sign-in, tables in the same file; the same OAuth grant asks for read-only Calendar |
| Maps | MapLibre GL JS with OpenFreeMap tiles; Google place IDs for linking out |
| Places | Overture Maps (stored base layer), Google Places API (New) for IDs and live lookups, Routes API for travel times |
| Models | Claude through Vercel AI Gateway for interpretation and research, so Indent can read usage from Vercel; OpenAI `gpt-4o-transcribe` for audio |
| Validation | zod 4, shared by server, UI and agent prompts |

### Repo layout

```
dining-planner/
  api/route.ts            Vercel adapter: routing, auth, context.auth
  api/voice.ts            multipart audio upload
  api/cron/slots.ts       Vercel Cron entry
  server/                 nexus-shaped entrypoints (runtime-safe)
    trips.ts places.ts anchors.ts saves.ts meals.ts input.ts agent.ts
    tables.ts             table() declarations
    adapters/mesa247.ts adapters/meitre.ts adapters/google.ts
  lib/nexus.ts            query, mutation, table, sql, db over the SQLite file in R2
  lib/attempt.ts          fallback ladder and interaction log
  shared/                 zod schemas: records, research output, actions
  ui/                     React app, theme tokens, components
  db/migrations/*.sql     forward-only migrations
  data/cities/lima/       city.json, areas.json, places/<id>.json
  agents/                 prompts and output schemas for Indent sessions
  bin/sql bin/migrate bin/seed bin/load-overture
  docs/queries.md         saved analytics queries
```

## Data

### Tables

Only the records Phase 1 uses. Watch, Nudge and Map tables arrive with their phases. Better Auth adds its own `user`, `session`, `account` and `verification` tables.

```sql
create table city (
  id text primary key,                 -- 'lima'
  name text not null, country text not null, tz text not null, currency text not null,
  languages text not null,             -- json ["es"]
  bbox text not null,                  -- json [w,s,e,n]
  config text not null                 -- json: platforms, messaging apps, closures, release norms, card notes
);
create table area (
  id text primary key, city text not null references city,
  name text not null, lat real, lng real, polygon text,   -- geojson
  brief text, stops text not null default '[]'            -- json: walks, bars, shops, parks with links
);
create table place (
  id text primary key, city text not null references city, area text references area,
  name text not null,
  kind text check (kind in ('reserve_ahead','bookable','walk_in','informal')),  -- null: uncurated Overture row
  google_place_id text unique, overture_id text unique,
  lat real, lng real,                  -- Overture or OSM; Google coordinates are not stored
  channels text not null default '[]', -- json [{type:'mesa247',host,local_id},{type:'whatsapp',number}]
  summary text, links text not null default '[]',
  curated integer not null default 0
);
create table fact (
  place text not null references place,
  field text not null,                 -- status | hours | price_pp | menu | deposit_policy | closures
  value text not null,                 -- json
  source text not null,                -- research | overture | live:mesa247 | user:<user id>
  checked_at text not null,
  primary key (place, field, source)
);
create table slot_read (
  place text not null references place, date text not null, party integer not null,
  service text not null default '',
  times text not null, waitlist text not null default '[]',   -- json ["13:00", ...]
  checked_at text not null, interaction text not null,
  primary key (place, date, party, service)
);
create table trip (
  id text primary key, owner text not null, city text not null references city,
  start_date text not null, end_date text not null, party integer not null,
  base text not null,                  -- json {name, lat, lng}
  appetite text, budget text, diet text, booking text,       -- json, from the wizard
  refresh text not null default 'standard'
);
create table anchor (
  id text primary key, trip text not null references trip,
  date text not null, start_time text, end_time text,
  area text references area, place text, lat real, lng real,
  source text not null check (source in ('hint','calendar')),
  text text, calendar_event text
);
create table meal (
  id text primary key, trip text not null references trip, place text not null references place,
  date text not null, slot text not null check (slot in ('lunch','dinner','other')), time text,
  status text not null check (status in ('want','requested','confirmed','waitlist','failed','skipped')),
  channel text, note text, updated_at text not null
);
create table save (
  owner text not null, place text not null references place,
  source text, note text, notify_nearby integer not null default 0, created_at text not null,
  primary key (owner, place)
);
create table interaction (
  id text primary key, parent text, at text not null, owner text,
  place text, channel text not null,   -- mesa247 | google.places | google.routes | openai | gateway | gcal
  kind text not null,                  -- slots.read | place.lookup | route.matrix | transcribe | interpret
  outcome text not null check (outcome in ('ok','empty','error','timeout','blocked')),
  error text, latency_ms integer, cost_usd real,
  fallback text,                       -- which ladder step produced the value
  request text                         -- json, no personal fields
);
create table interaction_private (
  interaction text primary key references interaction, owner text not null,
  payload text not null, media text
);
create table media (
  id text primary key, owner text not null, kind text not null, mime text not null,
  bytes blob not null, created_at text not null
);
create table calendar_link (
  owner text not null, provider text not null check (provider in ('google','ics')),
  ref text not null, last_sync text, primary key (owner, provider, ref)
);
```

Lima as rows (IDs from the one-off app; hours and slots illustrative):

```
place  { id: "la-mar-cebicheria", city: "lima", area: "miraflores", kind: "walk_in", curated: 1,
         google_place_id: "ChIJ…", overture_id: "08f…", lat: -12.1133, lng: -77.0453,
         channels: [{type: "walk_in"}], links: [{label: "Reddit thread", url: "…"}] }
fact   { place: "la-mar-cebicheria", field: "hours", value: {"mon-sun": "12:00-17:00"},
         source: "research", checked_at: "2026-11-12T22:41Z" }
fact   { place: "la-mar-cebicheria", field: "hours", value: {"mon-sun": "12:00-16:30"},
         source: "user:max", checked_at: "2026-11-20T15:02Z" }     -- Max said "they close at 4:30 now"
slot_read { place: "rafael", date: "2026-11-21", party: 2, times: ["20:00","20:15"],
            checked_at: "2026-11-21T01:30Z", interaction: "ix_…" }
anchor { trip: "lima-nov-2026", date: "2026-11-20", start_time: "10:00", end_time: "18:00",
         area: "barranco", source: "hint", text: "Friday we'll be in Barranco, ten to six" }
```

### Freshness and the clock icon

`shared/freshness.ts` defines a window per field: slots 15 minutes, waitlist 15 minutes, hours 7 days, price and menu 30 days, status 30 days. A fact older than its window renders `<Stale at={checked_at}/>`, the amber clock with an age. Tapping it on a slot runs a live read. When several sources disagree, the UI shows the newest, and a user's own reports always show to that user.

### Curated data and learning from users

- Research output is files in `data/cities/<city>/`, validated by the zod schemas in `shared/research.ts`. A research run opens a PR, Max reviews it, and on merge the Vercel build runs `bin/migrate` and `bin/seed` against the environment's database. Seeding upserts by place ID and never deletes; a closed place gets `status: closed` and stays as a hidden row.
- Volatile facts (slots, live hours) go to the database directly and never touch the repo.
- A user's spoken or typed correction becomes a `fact` with `source: user:<id>`. It shows to that user at once. A weekly Indent automation reviews user facts: a fact confirmed by a live read, a second user or a web check goes into the city data by PR; the rest expire after 30 days. In Phase 1 Max is the only user, so this path gets exercised with his own corrections during the trip.

## Shared code

### `attempt()` and the interaction log

Every third-party call goes through one function. Each ladder step that runs writes one `interaction` row, linked by `parent`, and the result says which step produced the value.

```ts
const slots = await attempt(
  { kind: "slots.read", channel: "mesa247", place: p.id, owner },
  [
    ["live", () => mesa247.read(p, date, party)],
    ["last_good", () => lastSlotRead(p.id, date, party)],   // returns checked_at for the clock
    ["unknown", () => ({ times: null, link: widgetUrl(p) })],
  ],
);
// slots.value, slots.step ("live" | "last_good" | "unknown"), slots.checkedAt
```

- The request and response types split into `public` and `private` parts. Names, phone numbers, emails, passport numbers, message text and transcripts only fit in `private`, which goes to `interaction_private`. A test fails if a string field in `interaction.request` matches a phone, email or passport pattern.
- Model calls record tokens and `cost_usd` from the gateway response. Google calls record the SKU so cost can be computed later.
- Timeouts are per adapter (Mesa 8 s, Google 5 s, transcription 30 s) and come from `fetch` `signal`, since the SDK runtime has no timers.

### Voice and free-form input

- `<VoiceInput intent=… />` is hold-to-talk with a 60-second cap, recording with `MediaRecorder` (WebM/Opus on Android and desktop, MP4/AAC on iOS Safari). Release uploads to `api/voice.ts`, which stores the clip in `media` and transcribes it. A text field next to the mic sends typed input down the same path.
- `server/input.ts` `interpret` takes the text plus context (screen, trip, day, place in view) and returns typed actions from `shared/actions.ts`: `add_anchor`, `add_save`, `add_fact`, `set_meal`, `update_trip`. The server applies them in one transaction and returns the changed records.
- The UI shows the changed record in place (the anchor on the timeline, the save in the list) with an Undo toast. Ambiguity resolves to the most likely reading, and Undo plus a retry is the correction path.
- Spanish and English in one clip is a test case from day one ("el viernes estamos en Barranco, ten to six").

### Anchors and travel time

- `whereAt(trip, datetime)` returns the anchor covering that time, else the nearest earlier anchor on the same day, else the trip base.
- Google Calendar sync reads events in the trip's dates for the signed-in user on open and every 6 hours. Events with a location become `calendar` anchors after geocoding; flights become anchors at the airport. Apple and other calendars connect by pasting an ICS URL.
- A meal whose time overlaps an anchor more than 20 minutes' travel away gets a conflict marker on the board.
- Travel minutes come from the Routes API matrix for the places on screen, from `whereAt` at the meal's time. Each call is an interaction; results cache in memory for the request only.

## Agent work on Indent

| Job | Runs as | Writes through |
|---|---|---|
| City research pass | Indent session started from `agents/city-research.md`, five subagents by segment plus one for city config | A PR to `data/cities/<city>/` |
| Fact refresh for curated places | Indent automation, monthly; weekly for places on an active trip | Agent API `places.recordFacts` |
| User-fact promotion | Indent automation, weekly | A PR, and `facts.expire` |
| Slot refresh | Vercel Cron every 15 minutes, places on trips in the next 14 days | Direct, through `attempt()` |

The research pass segments match what worked in Lima: tasting menus and reserve-ahead; bookable mid-range; walk-in classics (cevicherías, chifas, anticuchos); informal places and markets; areas with briefs and local color. A sixth agent writes the city config: platforms and how to read them, messaging apps, closure days, release norms, card behavior. Each place resolves to a Google place ID and the nearest Overture record by name within 150 m. Review summaries quote and link Reddit, TripAdvisor and guides without storing their text.

The agent API is `server/agent.ts`, entrypoints with `output` schemas so they match what the SDK exposes to agents as `apps["dining-planner"].agent.*`. On Vercel they take a bearer token stored as an Indent secret.

### Operating it from Indent

- One R2 token, stored as an Indent secret and as a Vercel env var. Any Indent session can download the file with it and run `sqlite3`. Writes from Indent go through the agent API, whose token is the second secret.
- `bin/sql "<query>"` downloads the current file and runs the query locally. `docs/queries.md` holds the saved queries: failure rate by channel and day, how often each ladder step produced the value, stale facts per city, model and API cost per city, voice inputs that were undone.
- Deploys, function logs and AI Gateway usage through the Vercel integration.
- An Indent memory package for the repo with how to migrate, seed, query and run a research pass.

### SDK track

- Friction log at `drafts/dining-planner-friction.md` in nexus-sdk, in the format of the existing gmail-triage and ramp-chase logs: numbered entries, each with the app feature, the gap, and before/after code.
- Entries known now:
  1. No callers outside the organization, so a consumer app cannot be served.
  2. UI renders only in Indent's slots; there is no standalone public site.
  3. No deploy in neo's `indent app` CLI.
  4. `indent app dev` runs no workflows or triggers, so scheduled agent jobs can't run on the platform.
  5. `@indent-com/nexus-sdk` isn't published to a registry, so a repo outside nexus-sdk can't install it.
  6. `fetch` takes string bodies only, so the server can't send audio to a transcription API as multipart.
- Each Friday an agent swaps `lib/nexus.ts` for the real SDK in a scratch branch, runs `server/` under `indent app dev`, and logs what breaks.
- Week 3 ends with an RFC draft in nexus-sdk (`pnpm new-rfc`) proposing public apps: callers outside the organization with their own auth, standalone hosting, and binary request bodies.

## Schedule

| Week | Dates | Work |
|---|---|---|
| 0 | Fri Nov 13 to Sun Nov 15 | Prerequisites below. Scaffold PR opened. |
| 1 | Mon Nov 16 to Fri Nov 20 | Mon and Tue: foundation stack (A1 to A4). Wed: stacks B, C, D start on the merged schema; D starts Monday on fixtures. Fri: Overture loaded for Lima, Mesa adapter on `attempt()`, wizard and theme tokens in a preview. |
| 2 | Mon Nov 23 to Fri Nov 27 | Lima research PR reviewed and merged. Voice input and `interpret`, hints to anchors, Google Calendar. Discover and detail on real data. Thanksgiving Thu Nov 26: agents keep working, reviews slow. |
| 3 | Mon Nov 30 to Fri Dec 4 | Trip board mobile and desktop, Want to visit, Where you'll be. ICS feeds, conflicts, user-fact promotion job. SDK RFC draft. Acceptance run and a demo write-up. |

Max is in Lima until Nov 23, so week 1 reviews happen on his phone against preview URLs. His real trip gets loaded as the first trip, with Piedra confirmed, Central requested, Otôto pending and the Maido watch noted on the meal.

## Work split

Four stacks, one agent each. Each stack is a sequence of PRs on its own base; B, C and D branch from `main` after A2 merges.

**A. Foundation** (one agent, Mon Nov 16 to Tue Nov 17)
- A1: scaffold, PWA shell, Vercel adapter and router, `lib/nexus.ts` with tests, the runtime-import test.
- A2: migrations for every table above, `bin/migrate`, `bin/seed`, build hook choosing the database by `VERCEL_ENV`.
- A3: Better Auth with Google sign-in, `context.auth`, sign-in screen.
- A4: `attempt()`, interaction tables and the personal-field test, `bin/sql`, `docs/queries.md`.

**B. Places and cities** (one agent)
- B1: `freshness.ts`, place and fact queries, places entrypoints, the agent API.
- B2: `bin/load-overture` (DuckDB over Overture's S3 release, city bbox, eat-and-drink categories).
- B3: Mesa 24/7 and Meitre adapters on `attempt()`, cron refresh, live read from the clock icon.
- B4: research prompts and schemas in `agents/`, then the Lima run and its data PR.
- B5: user facts and the promotion automation.

**C. Input and anchors** (one agent)
- C1: `<VoiceInput>`, `api/voice.ts`, `media`, transcription.
- C2: `interpret`, the action set, apply and Undo.
- C3: anchors, `whereAt`, Routes matrix, conflict markers.
- C4: Google Calendar sync and ICS feeds.

**D. Screens** (one agent)
- D1: theme tokens for the chosen theme, `<Stale>`, status chips, bottom tabs, layout breakpoints.
- D2: the wizard.
- D3: Discover and restaurant detail with MapLibre.
- D4: trip board, mobile and desktop.
- D5: Want to visit and Where you'll be.

Every agent prompt includes the org's papercut rule and Max's one-PR-per-change preference. Indent code review is the correctness review; I hold the plan, review the stacks against it, and post progress in this report's comments.

## Acceptance tests

Run on production at the end of week 3, each recorded in the demo write-up.

1. Sign in with Google on a phone, create the Lima trip with the wizard, and see the same board on a laptop within 5 seconds of focusing the tab.
2. Lima has at least 27 curated reservation places and 20 walk-in or informal places, each with a Google place ID, Overture or OSM coordinates, a summary, links and channels. Ámaz, Statera and La Picantería exist with status closed and appear nowhere in the UI.
3. Discover for Sat Nov 21 dinner shows live Mesa 24/7 slots. With Mesa blocked by an environment flag, it shows the last good slots with a clock and age, and `interaction` rows show `fallback = last_good`.
4. Saying "el viernes estamos en Barranco, ten to six" on the Where you'll be screen creates the Friday anchor, and Friday's travel minutes on the board start from Barranco.
5. A Google Calendar event "Flight LIM-SFO" at 9 PM on Nov 23 becomes an airport anchor, and a 7 PM dinner in Barranco that day shows a conflict.
6. Saying "a friend says Tía Grimanesa for anticuchos, after five" creates a save matched to the curated place, with the note.
7. Saying "La Mar closes at 4:30 now" on La Mar's page creates a user fact that Max sees immediately and nobody else does.
8. From an Indent session: "what share of slot reads fell back this week, by restaurant", "which Lima facts are stale", and "what did Lima cost in model and API calls", each answered from the SQLite file.
9. No row in `interaction` contains a name, phone number, email, passport number or transcript.
10. The friction log has at least eight entries and the RFC draft is open in nexus-sdk.

## Prerequisites from Max

By Mon Nov 16, so foundation work isn't blocked:
- Approve the repo name `indent-com/dining-planner`, or give another; create it if Indent's GitHub App can't.
- A Cloudflare R2 bucket and an R2 API token with read and write access to it. I'll send the secret card for the token.
- In Google Cloud: a project with the OAuth consent screen in testing mode and the Calendar read-only scope, three OAuth clients (local, preview, production, per the org's environment-separation convention), and a Maps Platform key with Places API (New) and Routes, restricted by referrer and server IP.
- An OpenAI key for transcription, as an Indent secret and a Vercel env var.

## Decisions for you

- **Theme**: Fachada, Garúa or Chancay. I'd build Garúa first. Its greys leave the green, amber, red and blue status colors readable, and Fachada's magenta and ochre compete with them. Theme tokens make the others a later swap.
- **Mobile board**: the grid with a day sheet (2a and 2b above), or the day pager. I'd build the grid: the whole trip fits on one screen, and the day sheet covers what the pager shows.
- **Partner access**: Phase 1 is one account per trip. Adding a second member to a trip is about two days of work if you want your partner on it during week 3.
- **Google verification**: testing mode allows 100 users and shows an unverified-app warning. Verification for the Calendar scope takes weeks; start it in week 3 if users beyond the team are near.

## Risks

- The `lib/nexus.ts` shim can drift from the SDK. It's pinned to nexus-sdk `629ba78`, and the Friday swap test catches drift.
- iOS Safari audio: MediaRecorder support and the MP4 container need testing on a real iPhone in week 2.
- One file means every write replaces the whole database. That's fine at one user and a slot refresh every 15 minutes. When writes start colliding (412 retries show up in the interaction log), move to Cloudflare D1, which is SQLite with the same schema.
- The bucket stays private even though the place data isn't: the file also holds login sessions, Google Calendar tokens and voice clips, and a public file would let anyone sign in as Max.
- Overture coverage in Lima is unmeasured. The research pass fills gaps with OSM coordinates, and B2 reports how many curated places had no Overture match.
