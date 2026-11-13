// Every third-party call goes through attempt(): a ladder of named steps, tried in order until
// one produces a value, with one `interaction` row per step tried. Runs in the server runtime.
import { db, sql, toolError, type Statement } from "./nexus.js";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type Outcome = "ok" | "empty" | "error" | "timeout" | "blocked";

/** Names the call. `request.public` goes to interaction.request; `request.private` to interaction_private. */
export type AttemptSpec = {
  kind: string; // slots.read | place.lookup | route.matrix | transcribe | interpret | ...
  channel: string; // mesa247 | google.places | google.routes | openai | gateway | gcal | ...
  place?: string | null;
  owner?: string | null; // app_user id; required for private payloads
  request?: { public?: { [key: string]: Json }; private?: { [key: string]: Json } };
  /** Per step, through `ctx.signal`. Mesa 8 s, Google 5 s, transcription 30 s. */
  timeoutMs?: number;
};

export type StepContext = {
  /** Pass to fetch: aborts after the attempt's timeoutMs. */
  signal: AbortSignal;
  /** Cost of this step, such as a model call's price from the gateway response. */
  cost(usd: number): void;
  /** Public fields for this step's row, such as a Google SKU or token counts. */
  note(fields: { [key: string]: Json }): void;
  /** Personal data this step saw or returned, such as a transcript. */
  privately(fields: { [key: string]: Json }): void;
  /** When the value was true, for a value read from storage; default: now. */
  checkedAt(at: string): void;
};

const EMPTY = Symbol("empty");
export type Empty = typeof EMPTY;
/** A step's way of saying it has no value, so the next step runs. */
export const empty: Empty = EMPTY;

export class StepFailure extends Error {
  constructor(
    readonly outcome: "error" | "blocked" | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "StepFailure";
  }
}

/** Throw from a step when the provider refused us (403, captcha, an environment flag). */
export function blocked(message: string): StepFailure {
  return new StepFailure("blocked", message);
}

export type Step<T> = readonly [name: string, run: (ctx: StepContext) => T | Empty | Promise<T | Empty>];

export type Attempted<T> = {
  value: T;
  step: string;
  checkedAt: string;
  /** The first step's interaction row; the others name it as `parent`. */
  interaction: string;
};

// Strings in interaction.request that look like personal data. Dates and times are removed
// first so they do not read as phone numbers.
const datesAndTimes = /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?|\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
export const personalPatterns: Record<string, RegExp> = {
  email: /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/i,
  phone: /(?<![\w.])\+?\(?\d[\d\s().-]{5,}\d(?![\w])/,
  passport: /(?<![\w])[A-Z]{1,2}\d{6,9}(?![\w])/,
};

// UUIDs are never personal. Other tokens that mix letters and digits (hashes, slugs, place ids) are
// ids whose digit groups are not phone numbers; passports mix them too, so only the phone check skips those.
const uuids = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ids = /[\w-]*(?:[A-Za-z][\w-]*\d|\d[\w-]*[A-Za-z])[\w-]*/g;

/** Which kinds of personal data `text` seems to hold. */
export function personalKinds(text: string): string[] {
  const stripped = text.replace(datesAndTimes, " ").replace(uuids, " ");
  const withoutIds = stripped.replace(ids, " ");
  return Object.entries(personalPatterns).flatMap(([kind, re]) => {
    const match = re.exec(kind === "phone" ? withoutIds : stripped);
    if (!match) return [];
    if (kind === "phone") {
      const digits = match[0].replace(/\D/g, "").length;
      if (digits < 7 || digits > 15) return [];
    }
    return [kind];
  });
}

/** Every string in `value`, with its JSON path. */
export function strings(value: unknown, path = "$"): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`));
  return [];
}

/** Replaces strings that look personal, so a mistake in a caller never reaches analytics. */
function redact(value: { [key: string]: Json }, onFind: (path: string, kinds: string[]) => void): { [key: string]: Json } {
  const walk = (v: Json, path: string): Json => {
    if (typeof v === "string") {
      const kinds = personalKinds(v);
      if (!kinds.length) return v;
      onFind(path, kinds);
      return `[redacted ${kinds.join(",")}]`;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, `${path}.${k}`)]));
    return v;
  };
  return walk(value, "$") as { [key: string]: Json };
}

function classify(error: unknown): { outcome: Exclude<Outcome, "ok" | "empty">; message: string } {
  if (error instanceof StepFailure) return { outcome: error.outcome, message: error.message };
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "TimeoutError" || (name === "AbortError" && /timeout|timed out/i.test(message))) {
    return { outcome: "timeout", message };
  }
  return { outcome: "error", message };
}

type Row = {
  id: string;
  parent: string | null;
  at: string;
  step: string;
  outcome: Outcome;
  error: string | null;
  latency: number;
  cost: number | null;
  notes: { [key: string]: Json };
  private: { [key: string]: Json };
};

/**
 * Runs `steps` in order until one returns a value, logging one interaction row per step tried.
 * A step that throws or returns `empty` hands over to the next. Throws `unavailable` if none produce a value.
 */
export async function attempt<R extends readonly unknown[]>(
  spec: AttemptSpec,
  steps: readonly [...{ [K in keyof R]: Step<R[K]> }],
): Promise<Attempted<Exclude<R[number], Empty>>> {
  type T = Exclude<R[number], Empty>;
  if (steps.length === 0) throw new Error("attempt needs at least one step");
  const hasPrivate = Object.keys(spec.request?.private ?? {}).length > 0;
  if (hasPrivate && !spec.owner) throw new Error(`${spec.channel} ${spec.kind}: a private payload needs an owner`);

  const rows: Row[] = [];
  let produced: { value: T; step: string; checkedAt: string } | null = null;

  for (const [name, run] of steps) {
    const startedAt = new Date();
    const row: Row = {
      id: crypto.randomUUID(),
      parent: rows[0]?.id ?? null,
      at: startedAt.toISOString(),
      step: name,
      outcome: "ok",
      error: null,
      latency: 0,
      cost: null,
      notes: {},
      private: {},
    };
    let checkedAt = startedAt.toISOString();
    const ctx: StepContext = {
      signal: AbortSignal.timeout(spec.timeoutMs ?? 10_000),
      cost: (usd) => {
        row.cost = (row.cost ?? 0) + usd;
      },
      note: (fields) => Object.assign(row.notes, fields),
      privately: (fields) => {
        if (!spec.owner) throw new Error(`${spec.channel} ${spec.kind}: a private payload needs an owner`);
        Object.assign(row.private, fields);
      },
      checkedAt: (at) => {
        checkedAt = at;
      },
    };
    try {
      const value = await run(ctx);
      if (value === EMPTY) row.outcome = "empty";
      else produced = { value: value as T, step: name, checkedAt };
    } catch (error) {
      const { outcome, message } = classify(error);
      row.outcome = outcome;
      const kinds = personalKinds(message);
      row.error = kinds.length ? `[redacted ${kinds.join(",")}]` : message.slice(0, 500);
    }
    row.latency = Date.now() - startedAt.getTime();
    rows.push(row);
    if (produced) break;
  }

  try {
    await db.execute(...rows.flatMap((row) => statements(spec, row, rows[0]!.id)));
  } catch (error) {
    // A value already fetched is worth more than its log row.
    console.error(JSON.stringify({ event: "interaction.write_failed", channel: spec.channel, kind: spec.kind, error: String(error) }));
  }
  if (!produced) {
    throw toolError("unavailable", `${spec.channel} ${spec.kind}: no step produced a value (${rows.map((r) => `${r.step} ${r.outcome}`).join(", ")})`);
  }
  return { ...produced, interaction: rows[0]!.id };
}

function statements(spec: AttemptSpec, row: Row, root: string): Statement<never>[] {
  const request = redact({ ...spec.request?.public, ...row.notes }, (path, kinds) =>
    console.warn(JSON.stringify({ event: "interaction.redacted", channel: spec.channel, kind: spec.kind, path, kinds })),
  );
  const out = [
    sql`INSERT INTO interaction (id, parent, at, owner, place, channel, kind, outcome, error, latency_ms, cost_usd, fallback, request)
        VALUES (${row.id}, ${row.parent}, ${row.at}, ${spec.owner ?? null}, ${spec.place ?? null}, ${spec.channel}, ${spec.kind},
                ${row.outcome}, ${row.error}, ${row.latency}, ${row.cost}, ${row.step},
                ${Object.keys(request).length ? JSON.stringify(request) : null})`,
  ];
  const payload = row.id === root ? { ...spec.request?.private, ...row.private } : row.private;
  if (Object.keys(payload).length) {
    out.push(sql`INSERT INTO interaction_private (interaction, owner, payload) VALUES (${row.id}, ${spec.owner ?? null}, ${JSON.stringify(payload)})`);
  }
  return out;
}
