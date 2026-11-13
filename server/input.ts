import { z } from "zod";
import { callTool } from "../lib/model.js";
import { db, mutation, person, sql, toolError, type Auth, type Statement, type Table, type Value } from "../lib/nexus.js";
import { Action, InputContext, Interpretation, type Change, type InterpretResult } from "../shared/actions.js";
import { parseFactValue } from "../shared/facts.js";
import { FactField } from "../shared/records.js";
import { reportFactStatement } from "./facts.js";
import { bestMatch, candidates, type Candidate } from "./resolve.js";
import * as T from "./tables.js";

type Raw = Record<string, Value>;
type Kind = "anchor" | "save" | "fact" | "meal" | "trip" | "place";
type Op = { table: Kind; key: Raw; before: Raw | null };

const tableOf: Record<Kind, Table> = { anchor: T.anchor, save: T.save, fact: T.fact, meal: T.meal, trip: T.trip, place: T.place };
const recordOf = { anchor: T.AnchorRow, save: T.SaveRow, fact: T.FactRow, meal: T.MealRow, trip: T.TripRow } as const;

const SYSTEM = `You turn what a traveler says or types into changes to their dining trip plan. Call apply once with every change the input asks for, in the order said. Input often mixes Spanish and English.

- add_anchor: where they will be at a time. "el viernes estamos en Barranco, ten to six" is the Friday in trip_days, 10:00 to 18:00, area barranco. Times are 24-hour HH:MM, local. "X to Y" after a place or day is a range. Use null for times not said. A specific venue that is not a restaurant (a museum, a hotel) goes in text with place null.
- add_save: a place they want to try or were told about. Dishes, timing ("after five") and conditions go in note; who recommended it goes in source.
- add_fact: a correction about a place, such as hours, closures, prices or status. "closes at 4:30 now" changes the closing time in the current hours (text and closes) and keeps the rest; give the whole new value. Put place null for the place in view.
- set_meal: a meal at a place on a date. Booked, reserved or "we have a table" is confirmed; asked or requested is requested; "we'd like to go" is want. Slot is lunch before 16:00, dinner after, unless said.
- update_trip: changes to the trip's dates, party size, budget or diet.
- Dates must be within trip_days; resolve weekdays and "tomorrow" against today and trip_days.
- A bare weekday ("el viernes", "on Friday") is the next one after today, as listed in next_weekday, even when today is that weekday. It means today only when the input says so ("today", "hoy", "tonight", "esta noche").
- For a place in known_places, give its id. Otherwise id null and the name spelled the way the place spells it.
- When the input could mean several things, pick the most likely. When nothing in it changes the plan, return no actions.`;

const TripRaw = T.trip.row;
const PlaceBrief = z.object({ id: z.string(), name: z.string(), area: z.string().nullable(), kind: z.string().nullable(), city: z.string() });
const MealBrief = z.object({ place: z.string(), name: z.string(), date: z.string(), slot: z.string(), time: z.string().nullable(), status: z.string() });

function weekday(date: string): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(`${date}T12:00:00Z`).getUTCDay()]!;
}

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); out.length < 62; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > to) break;
    out.push(iso);
  }
  return out;
}

function localDate(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The speaker's today: their device's date when it is within a day of the city's (time zones differ),
 * else the city's.
 */
export function speakerToday(given: string | undefined, tz: string, at = new Date()): string {
  const city = localDate(tz, at);
  return given && [addDays(city, -1), city, addDays(city, 1)].includes(given) ? given : city;
}

/** Each weekday's next date strictly after `today`. */
export function nextWeekdays(today: string): Record<string, string> {
  return Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => addDays(today, n)).map((d) => [weekday(d), d]));
}

const WEEKDAY_WORDS: Record<string, RegExp> = {
  Sunday: /\b(sunday|domingo)\b/,
  Monday: /\b(monday|lunes)\b/,
  Tuesday: /\b(tuesday|martes)\b/,
  Wednesday: /\b(wednesday|miercoles)\b/,
  Thursday: /\b(thursday|jueves)\b/,
  Friday: /\b(friday|viernes)\b/,
  Saturday: /\b(saturday|sabado)\b/,
};
const TODAY_WORDS = /\b(today|tonight|this (morning|afternoon|evening)|hoy|esta (noche|tarde|manana))\b/;

/**
 * Backstop for the prompt rule: a date of today for input that names today's weekday without saying "today"
 * moves to the same weekday next week.
 */
export function bareWeekdayDate(date: string, text: string, today: string): string {
  if (date !== today) return date;
  const said = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (TODAY_WORDS.test(said)) return date;
  return WEEKDAY_WORDS[weekday(today)]!.test(said) ? addDays(today, 7) : date;
}

function slug(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

type Loaded = {
  owner: string;
  trip: z.output<typeof TripRaw> | null;
  city: string;
  tz: string;
  areas: { id: string; name: string }[];
  known: z.output<typeof PlaceBrief>[];
  view: (z.output<typeof PlaceBrief> & { facts: Record<string, unknown> }) | null;
  meals: z.output<typeof MealBrief>[];
};

async function load(owner: string, context: InputContext): Promise<Loaded> {
  const today = new Date().toISOString().slice(0, 10);
  const [trips, views] = await db.execute(
    context.trip
      ? sql(TripRaw)`SELECT * FROM trip WHERE id = ${context.trip} AND owner = ${owner}`
      : sql(TripRaw)`SELECT * FROM trip WHERE owner = ${owner} ORDER BY end_date < ${today}, abs(julianday(start_date) - julianday(${today})) LIMIT 1`,
    sql(PlaceBrief)`SELECT id, name, area, kind, city FROM place WHERE id = ${context.place ?? null} AND (created_by IS NULL OR created_by = ${owner})`,
  );
  const trip = trips.rows[0] ?? null;
  if (context.trip && !trip) throw toolError("not_found", `No trip ${context.trip}`);
  const viewed = views.rows[0] ?? null;
  const own = `user:${owner}`;
  const [cities, areas, known, facts, meals] = await db.execute(
    sql(z.object({ id: z.string(), tz: z.string() }))`
      SELECT id, tz FROM city WHERE id = coalesce(${trip?.city ?? viewed?.city ?? null}, (SELECT id FROM city ORDER BY id LIMIT 1))`,
    sql(z.object({ id: z.string(), name: z.string() }))`
      SELECT id, name FROM area WHERE city = coalesce(${trip?.city ?? viewed?.city ?? null}, (SELECT id FROM city ORDER BY id LIMIT 1)) ORDER BY name`,
    sql(PlaceBrief)`
      SELECT id, name, area, kind, city FROM place
      WHERE city = coalesce(${trip?.city ?? viewed?.city ?? null}, (SELECT id FROM city ORDER BY id LIMIT 1))
        AND (curated = 1 OR id IN (SELECT place FROM save WHERE owner = ${owner}) OR id IN (SELECT place FROM meal WHERE trip = ${trip?.id ?? null}))
      ORDER BY name`,
    sql(T.FactRow)`
      SELECT * FROM fact WHERE place = ${viewed?.id ?? null} AND (source NOT LIKE 'user:%' OR source = ${own})
        AND field IN (SELECT value FROM json_each(${JSON.stringify(FactField.options)}))
      ORDER BY checked_at`,
    sql(MealBrief)`
      SELECT meal.place, place.name, meal.date, meal.slot, meal.time, meal.status FROM meal JOIN place ON place.id = meal.place
      WHERE meal.trip = ${trip?.id ?? null} ORDER BY meal.date, meal.slot`,
  );
  const city = cities.rows[0];
  if (!city) throw toolError("not_found", "No city");
  const current: Record<string, unknown> = {};
  for (const f of facts.rows) current[f.field] = f.value;
  return {
    owner,
    trip,
    city: city.id,
    tz: city.tz,
    areas: areas.rows,
    known: known.rows,
    view: viewed ? { ...viewed, facts: current } : null,
    meals: meals.rows,
  };
}

function prompt(text: string, context: InputContext, l: Loaded): string {
  const trip = l.trip;
  const today = speakerToday(context.today, l.tz);
  const ctx = {
    today,
    today_weekday: weekday(today),
    city_time_zone: l.tz,
    next_weekday: nextWeekdays(today),
    screen: context.screen,
    date_in_view: context.date ?? null,
    trip: trip ? { start_date: trip.start_date, end_date: trip.end_date, party: trip.party, base: JSON.parse(trip.base).name } : null,
    trip_days: trip ? days(trip.start_date, trip.end_date).map((d) => ({ date: d, weekday: weekday(d) })) : [],
    areas: l.areas,
    known_places: l.known.map((p) => ({ id: p.id, name: p.name, area: p.area, kind: p.kind })),
    place_in_view: l.view ? { id: l.view.id, name: l.view.name, current_facts: l.view.facts } : null,
    meals: l.meals.map((m) => ({ place: m.place, name: m.name, date: m.date, slot: m.slot, time: m.time, status: m.status })),
  };
  return `Context:\n${JSON.stringify(ctx)}\n\nInput:\n${text}`;
}

const tool = (() => {
  const { $schema: _, ...parameters } = z.toJSONSchema(Interpretation, { io: "input" }) as Record<string, unknown>;
  return { name: "apply", description: "Apply these changes to the trip plan.", parameters };
})();

/** Each valid action; an invalid one is dropped rather than failing the rest. */
export function parseActions(args: unknown): Action[] {
  const list = z.object({ actions: z.array(z.unknown()) }).safeParse(args);
  if (!list.success) return [];
  return list.data.actions.flatMap((a) => {
    const parsed = Action.safeParse(a);
    return parsed.success ? [parsed.data] : [];
  });
}

type Plan =
  | { kind: "anchor"; row: Raw }
  | { kind: "place"; row: Raw }
  | { kind: "save"; place: string; note: string | null; source: string | null }
  | { kind: "fact"; place: string; field: FactField; value: unknown }
  | { kind: "meal"; place: string; date: string; slot: string; time: string | null; status: string; note: string | null }
  | { kind: "trip"; patch: Raw };

/** Turns actions into rows to write: places resolved, dates checked, unknown places created. */
async function plan(actions: Action[], l: Loaded, source: string | null): Promise<Plan[]> {
  const mentions = actions.flatMap((a) => ("place" in a && a.place ? [a.place.name] : []));
  const pool: Candidate[] = mentions.length ? await candidates(l.city, mentions, l.owner) : [];
  const ids = new Set([...pool.map((c) => c.id), ...l.known.map((k) => k.id)]);
  const areaIds = new Set(l.areas.map((a) => a.id));
  const created = new Map<string, string>();
  const plans: Plan[] = [];
  const trip = l.trip;
  const inTrip = (d: string) => !!trip && d >= trip.start_date && d <= trip.end_date;

  const resolve = (m: { id: string | null; name: string }, area: string | null, create: boolean): string | null => {
    if (m.id && ids.has(m.id)) return m.id;
    const match = bestMatch(m.name, pool);
    if (match) return match.id;
    if (!create) return null;
    const key = m.name.trim().toLowerCase();
    const existing = created.get(key);
    if (existing) return existing;
    const id = `${slug(m.name) || "place"}-${crypto.randomUUID().slice(0, 8)}`;
    created.set(key, id);
    plans.push({ kind: "place", row: { id, city: l.city, area: area && areaIds.has(area) ? area : null, name: m.name.trim(), curated: 0 } });
    return id;
  };

  for (const a of actions) {
    switch (a.type) {
      case "add_anchor": {
        if (!trip || !inTrip(a.date)) break;
        const place = a.place ? resolve(a.place, a.area, false) : null;
        plans.push({
          kind: "anchor",
          row: {
            id: crypto.randomUUID(),
            trip: trip.id,
            date: a.date,
            start_time: a.start_time,
            end_time: a.end_time && a.start_time && a.end_time < a.start_time ? null : a.end_time,
            area: a.area && areaIds.has(a.area) ? a.area : null,
            place,
            lat: null,
            lng: null,
            source: "hint",
            text: a.text,
            calendar_event: null,
          },
        });
        break;
      }
      case "add_save": {
        const place = resolve(a.place, a.area, true)!;
        plans.push({ kind: "save", place, note: a.note, source: a.source ?? source });
        break;
      }
      case "add_fact": {
        const place = a.place ? resolve(a.place, null, false) : (l.view?.id ?? null);
        if (!place || !parseFactValue(a.field, a.value).ok) break;
        plans.push({ kind: "fact", place, field: a.field, value: a.value });
        break;
      }
      case "set_meal": {
        if (!trip || !inTrip(a.date)) break;
        const place = resolve(a.place, null, true)!;
        plans.push({ kind: "meal", place, date: a.date, slot: a.slot, time: a.time, status: a.status, note: a.note });
        break;
      }
      case "update_trip": {
        if (!trip) break;
        const patch: Raw = {};
        if (a.start_date) patch.start_date = a.start_date;
        if (a.end_date) patch.end_date = a.end_date;
        if (a.party) patch.party = a.party;
        if (a.budget) patch.budget = JSON.stringify(a.budget);
        if (a.diet) patch.diet = JSON.stringify(a.diet);
        const start = (patch.start_date as string | undefined) ?? trip.start_date;
        const end = (patch.end_date as string | undefined) ?? trip.end_date;
        if (Object.keys(patch).length && start <= end) plans.push({ kind: "trip", patch });
        break;
      }
    }
  }
  return plans;
}

function columns(kind: Kind): string[] {
  return Object.keys(tableOf[kind].row.shape);
}

function where(kind: Kind, key: Raw): { sql: string; params: Value[] } {
  const cols = Object.keys(key);
  if (!cols.length || cols.some((c) => !columns(kind).includes(c))) throw toolError("invalid_input", `Bad key for ${kind}`);
  return { sql: cols.map((c) => `${c} = ?`).join(" AND "), params: cols.map((c) => key[c] ?? null) };
}

/** Applies `plans` in one transaction; returns what changed and the ops that undo it. */
async function apply(plans: Plan[], l: Loaded, origin: { interaction: string; media: string | null }): Promise<InterpretResult> {
  const owner = l.owner;
  const source = `user:${owner}`;
  const now = new Date().toISOString();

  const pre: Statement<unknown>[] = plans.map((p) => {
    switch (p.kind) {
      case "save":
        return sql(T.save.row)`SELECT * FROM save WHERE owner = ${owner} AND place = ${p.place}`;
      case "fact":
        return sql(T.fact.row)`SELECT * FROM fact WHERE place = ${p.place} AND field = ${p.field} AND source = ${source}`;
      case "meal":
        return sql(T.meal.row)`
          SELECT * FROM meal WHERE trip = ${l.trip!.id} AND place = ${p.place} AND date = ${p.date} ORDER BY updated_at DESC LIMIT 1`;
      case "trip":
        return sql(TripRaw)`SELECT * FROM trip WHERE id = ${l.trip!.id} AND owner = ${owner}`;
      default:
        return sql`SELECT 1 WHERE 0`;
    }
  });
  const before = pre.length ? ((await db.execute(...pre)) as { rows: Raw[] }[]).map((r) => r.rows[0] ?? null) : [];

  const ops: Op[] = [];
  const writes: { kind: Exclude<Kind, "place"> | null; existed: boolean; statement: Statement<unknown> }[] = [];
  plans.forEach((p, i) => {
    const prior = before[i] ?? null;
    switch (p.kind) {
      case "place": {
        const r = p.row;
        ops.push({ table: "place", key: { id: r.id! }, before: null });
        writes.push({
          kind: null,
          existed: false,
          statement: sql`INSERT INTO place (id, city, area, name, curated, created_by) VALUES (${r.id!}, ${r.city!}, ${r.area ?? null}, ${r.name!}, 0, ${owner})`,
        });
        break;
      }
      case "anchor": {
        const r = p.row;
        ops.push({ table: "anchor", key: { id: r.id! }, before: null });
        writes.push({
          kind: "anchor",
          existed: false,
          statement: sql(T.AnchorRow)`
            INSERT INTO anchor (id, trip, date, start_time, end_time, area, place, lat, lng, source, text, calendar_event)
            SELECT ${r.id!}, ${r.trip!}, ${r.date!}, ${r.start_time ?? null}, ${r.end_time ?? null}, ${r.area ?? null}, ${r.place ?? null},
                   NULL, NULL, 'hint', ${r.text ?? null}, NULL
            WHERE EXISTS (SELECT 1 FROM trip WHERE id = ${r.trip!} AND owner = ${owner})
            RETURNING *`,
        });
        break;
      }
      case "save": {
        ops.push({ table: "save", key: { owner, place: p.place }, before: prior });
        writes.push({
          kind: "save",
          existed: !!prior,
          statement: sql(T.SaveRow)`
            INSERT INTO save (owner, place, source, note, created_at) VALUES (${owner}, ${p.place}, ${p.source}, ${p.note}, ${now})
            ON CONFLICT (owner, place) DO UPDATE SET
              note = coalesce(excluded.note, save.note), source = coalesce(excluded.source, save.source)
            RETURNING *`,
        });
        break;
      }
      case "fact": {
        ops.push({ table: "fact", key: { place: p.place, field: p.field, source }, before: prior });
        writes.push({ kind: "fact", existed: !!prior, statement: reportFactStatement(owner, p.place, p.field, p.value, now) });
        break;
      }
      case "meal": {
        const id = (prior?.id as string | undefined) ?? crypto.randomUUID();
        const time = p.time ?? (prior?.time as string | null | undefined) ?? null;
        const note = p.note ?? (prior?.note as string | null | undefined) ?? null;
        const channel = (prior?.channel as string | null | undefined) ?? null;
        ops.push({ table: "meal", key: { id }, before: prior });
        writes.push({
          kind: "meal",
          existed: !!prior,
          statement: sql(T.MealRow)`
            INSERT INTO meal (id, trip, place, date, slot, time, status, channel, note, updated_at)
            SELECT ${id}, ${l.trip!.id}, ${p.place}, ${p.date}, ${p.slot}, ${time}, ${p.status}, ${channel}, ${note}, ${now}
            WHERE EXISTS (SELECT 1 FROM trip WHERE id = ${l.trip!.id} AND owner = ${owner})
            ON CONFLICT (id) DO UPDATE SET slot = excluded.slot, time = excluded.time, status = excluded.status,
              note = excluded.note, updated_at = excluded.updated_at
            RETURNING *`,
        });
        break;
      }
      case "trip": {
        if (!prior) break;
        const keys = Object.keys(p.patch).filter((k) => columns("trip").includes(k));
        ops.push({ table: "trip", key: { id: l.trip!.id }, before: prior });
        writes.push({
          kind: "trip",
          existed: true,
          statement: {
            sql: `UPDATE trip SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND owner = ? RETURNING *`,
            params: [...keys.map((k) => p.patch[k] ?? null), l.trip!.id, owner],
            row: T.TripRow,
          },
        });
        break;
      }
    }
  });
  if (!writes.length) return { changes: [], undo: "" };

  const undo = crypto.randomUUID();
  const results = (await db.execute(
    ...writes.map((w) => w.statement),
    sql`INSERT INTO input_undo (id, owner, created_at, interaction, media, ops)
        VALUES (${undo}, ${owner}, ${now}, ${origin.interaction}, ${origin.media}, ${JSON.stringify(ops)})`,
  )) as { rows: unknown[] }[];

  const changes: Change[] = writes.flatMap((w, i) => {
    const record = results[i]?.rows[0];
    if (!w.kind || !record) return [];
    return [{ kind: w.kind, op: w.existed ? "updated" : "created", record } satisfies Change];
  });
  return { changes, undo: changes.length ? undo : "" };
}

/** Interprets typed or transcribed text and applies it. Shared by input.interpret and /api/voice. */
export async function interpretText(
  text: string,
  context: InputContext,
  auth: Auth | null,
  options: { media?: string } = {},
): Promise<InterpretResult> {
  const me = person({ auth });
  const loaded = await load(me.id, context);
  const call = await callTool({
    kind: "interpret",
    owner: me.id,
    system: SYSTEM,
    user: prompt(text, context, loaded),
    tool,
    request: {
      city: loaded.city,
      screen: context.screen,
      trip: loaded.trip?.id ?? null,
      place: context.place ?? null,
      chars: text.length,
      voice: !!options.media,
    },
  }).catch((error: unknown) => {
    throw toolError("unavailable", "Could not interpret that", { cause: error });
  });
  const today = speakerToday(context.today, loaded.tz);
  const actions = parseActions(call.value).map((a) =>
    a.type === "add_anchor" || a.type === "set_meal" ? { ...a, date: bareWeekdayDate(a.date, text, today) } : a,
  );
  return apply(await plan(actions, loaded, null), loaded, { interaction: call.interaction, media: options.media ?? null });
}

export const interpret = mutation({
  input: z.object({ text: z.string().trim().min(1).max(4000), context: InputContext }),
  async handler({ text, context }, { auth }): Promise<InterpretResult> {
    return interpretText(text, context, auth);
  },
});

/** Reverts exactly what one interpretation changed. A second call is a no-op. */
export const undo = mutation({
  input: z.object({ undo: z.string() }),
  async handler({ undo: id }, context): Promise<{ ok: true }> {
    const me = person(context);
    if (!id) return { ok: true };
    const [{ rows }] = await db.execute(
      sql(z.object({ ops: z.string() }))`SELECT ops FROM input_undo WHERE id = ${id} AND owner = ${me.id} AND undone_at IS NULL`,
    );
    const row = rows[0];
    if (!row) return { ok: true };
    const ops = JSON.parse(row.ops) as Op[];
    const guard = { sql: "EXISTS (SELECT 1 FROM input_undo WHERE id = ? AND undone_at IS NULL)", params: [id] as Value[] };
    const statements: Statement<never>[] = ops.reverse().map((op) => {
      if (!(op.table in tableOf)) throw toolError("invalid_input", `Bad undo table ${op.table}`);
      const w = where(op.table, op.key);
      if (!op.before) {
        // A place this created stays if something written since refers to it.
        const unused = op.table === "place" ? " AND id NOT IN (SELECT place FROM save UNION SELECT place FROM meal UNION SELECT place FROM fact)" : "";
        return { sql: `DELETE FROM ${op.table} WHERE ${w.sql}${unused} AND ${guard.sql}`, params: [...w.params, ...guard.params] };
      }
      const cols = Object.keys(op.before).filter((c) => columns(op.table).includes(c) && !(c in op.key));
      return {
        sql: `UPDATE ${op.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${w.sql} AND ${guard.sql}`,
        params: [...cols.map((c) => op.before![c] ?? null), ...w.params, ...guard.params],
      };
    });
    await db.execute(...statements, sql`UPDATE input_undo SET undone_at = ${new Date().toISOString()} WHERE id = ${id} AND undone_at IS NULL`);
    return { ok: true };
  },
});
