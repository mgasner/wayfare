# Contracts between workstreams

Plan: https://app.indent.com/reports/01a1d244-d12d-7998-a0e6-0439927ce1b1 (local copy: `docs/plan.md`).

- Schema: `db/migrations/0001_init.sql`. Add columns or tables only with a new numbered migration.
- Record shapes: `shared/records.ts`. The server returns these; the UI imports their types.
- Entrypoints: `server/<file>.ts` exports `query(...)` or `mutation(...)` from `lib/nexus.ts`, served at `/api/<file>/<export>` (GET with the input as JSON in `?input=`, POST with a JSON body). The UI calls them through `ui/src/api.ts`.

| Entrypoint | Kind | Input | Output | Owner |
|---|---|---|---|---|
| `me.get` | query | `{}` | `User \| null` | A |
| `cities.get` | query | `{ id }` | `{ city: City, areas: Area[] }` | B |
| `places.search` | query | `{ city, trip?, kinds?, area?, q?, date?, limit? }` | `PlaceCard[]` | B |
| `places.get` | query | `{ id, trip? }` | `PlaceCard` | B |
| `places.refreshSlots` | mutation | `{ place, dates, party }` | `SlotRead[]` | B |
| `trips.list` | query | `{}` | `Trip[]` | A |
| `trips.get` | query | `{ id }` | `TripView` | A |
| `trips.create` | mutation | Trip fields minus id, owner, created_at | `Trip` | A |
| `trips.update` | mutation | `{ id, ...partial }` | `Trip` | A |
| `meals.set` | mutation | Meal minus updated_at, `id` optional | `Meal` | A |
| `meals.remove` | mutation | `{ id }` | `{ ok: true }` | A |
| `saves.list` | query | `{ city? }` | `{ save: Save, place: PlaceCard }[]` | A |
| `saves.add` / `saves.remove` | mutation | `{ place, note?, source? }` / `{ place }` | `Save` / `{ ok: true }` | A |
| `anchors.list` | query | `{ trip }` | `Anchor[]` | C |
| `anchors.add` / `anchors.remove` | mutation | Anchor minus id / `{ id }` | `Anchor` / `{ ok: true }` | C |
| `anchors.whereAt` | query | `{ trip, date, time }` | `{ lat, lng, label, anchor: string \| null }` | C |
| `travel.minutes` | query | `{ trip, date, time, places: string[] }` | `Record<string, number \| null>` | C |
| `input.interpret` | mutation | `{ text, context: { screen, trip?, date?, place? } }` | `{ changes: Change[], undo: string }` | C |
| `input.undo` | mutation | `{ undo }` | `{ ok: true }` | C |
| `calendar.*` | | see C's PR | | C |
| `agent.recordFacts` | mutation | `{ facts: { place, field, value, source?, checked_at? }[] }` (source `research` \| `overture` \| `live:<channel>`) | `{ written, unchanged, unknown_places }` | B |
| `agent.listStale` | query | `{ city, fields?, older_than_days?, only_on_trip?, limit? }` | `{ checked_at, places: { id, name, kind, area, on_trip, stale: { field, checked_at \| null }[] }[] }` | B |
| `agent.expireFacts` | mutation | `{ facts?: { place, field, source }[], user_facts_before? }` | `{ deleted }` | B |

`agent.*` takes `Authorization: Bearer $AGENT_TOKEN` and runs as the `indent` actor. Fact values per field: `shared/facts.ts`.

`Change` is `{ kind: "anchor" | "save" | "fact" | "meal" | "trip", op: "created" | "updated" | "deleted", record: unknown }`.

Voice upload: `POST /api/voice` (multipart: `audio`, `context` JSON) returns the same `{ text, changes, undo }` as `input.interpret` plus the transcript. Owner C.

## Rules for every stack

- `server/` runs in the nexus-sdk server runtime's subset: `fetch`, `URL`, `TextEncoder`, `crypto.randomUUID`, no Node modules, no timers. Node-only code lives in `lib/` or `api/`.
- Every third-party call goes through `attempt()` from `lib/attempt.ts`.
- Personal data (names, phone numbers, emails, passport numbers, message text, transcripts) never goes in `interaction.request`; it goes in the private part.
- Commits: author and committer `Max Gasner <max@indent.com>`.
- One branch per PR, stacked within a workstream.
