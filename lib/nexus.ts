// Local stand-in for @indent-com/nexus-sdk, signatures from sdk/index.d.ts at 629ba78.
// Runs in the server runtime's subset: no Node modules. The SQLite engine is a Driver
// that the Node adapter installs with setDriver.
import type { z } from "zod";

export type EntrypointSpec<I extends z.ZodObject, O> = {
  input: I;
  output?: z.ZodType<O>;
  handler(input: z.output<I>, context: Context): Promise<O>;
};

export type Query<I, O> = ((input: I) => Promise<O>) & { readonly kind: "query" };
export type Mutation<I, O> = ((input: I) => Promise<O>) & { readonly kind: "mutation" };

const specKey = Symbol.for("nexus.entrypoint");

type AnySpec = EntrypointSpec<z.ZodObject, unknown>;
export type Entrypoint = { readonly kind: "query" | "mutation"; readonly [specKey]: AnySpec };

function entrypoint<I extends z.ZodObject, O>(kind: "query" | "mutation", spec: EntrypointSpec<I, O>) {
  const call = () => {
    throw new Error("Call entrypoints over HTTP, through ui/src/api.ts");
  };
  return Object.assign(call, { kind, [specKey]: spec });
}

/** A read: GET, with stored results. */
export function query<I extends z.ZodObject, O>(spec: EntrypointSpec<I, O>): Query<z.input<I>, O> {
  return entrypoint("query", spec) as unknown as Query<z.input<I>, O>;
}

/** A change: POST, always live. */
export function mutation<I extends z.ZodObject, O>(spec: EntrypointSpec<I, O>): Mutation<z.input<I>, O> {
  return entrypoint("mutation", spec) as unknown as Mutation<z.input<I>, O>;
}

export function isEntrypoint(value: unknown): value is Entrypoint {
  return typeof value === "function" && specKey in value;
}

export function entrypointSpec(e: Entrypoint): AnySpec {
  return e[specKey];
}

/** A person, a bot, or Indent itself. */
export type Actor =
  | { kind: "person"; id: string; name: string; email: string }
  | { kind: "bot"; id: string; name: string }
  | { kind: "indent"; staff?: string };

const authToken = Symbol("auth");

/** Who a call or run is for. Only the adapter makes one. */
export class Auth {
  readonly actor: Actor;
  private constructor(token: symbol, actor: Actor) {
    if (token !== authToken) throw new Error("Auth is made by the adapter");
    this.actor = actor;
  }
  /** @internal */
  static create(actor: Actor): Auth {
    return new Auth(authToken, actor);
  }
}

// The SDK always has a caller; this app also serves signed-out visitors, so auth can be null.
export type Context = { auth: Auth | null };

export type ToolErrorCode =
  | "invalid_input"
  | "not_allowed"
  | "no_user"
  | "not_found"
  | "unavailable"
  | "timeout"
  | "sqlite_error"
  | "row_mismatch"
  | "too_large";

export type ToolError = Error & { name: "ToolError"; code: ToolErrorCode };

export function toolError(code: ToolErrorCode, message: string, options?: { cause?: unknown }): ToolError {
  const error = new Error(message, options) as ToolError;
  error.name = "ToolError";
  error.code = code;
  return error;
}

export function isToolError(error: unknown, code?: ToolErrorCode): error is ToolError {
  return error instanceof Error && error.name === "ToolError" && (code === undefined || (error as ToolError).code === code);
}

/** The signed-in person, or `no_user`. */
export function person(context: Context): Extract<Actor, { kind: "person" }> {
  const actor = context.auth?.actor;
  if (actor?.kind !== "person") throw toolError("no_user", "Sign in first");
  return actor;
}

/** A value a statement binds. */
export type Value = string | number | boolean | null;

/** SQL, its parameters, and the schema of its rows. */
export type Statement<Row> = { sql: string; params: Value[]; row?: z.ZodType<Row> };
export type Result<Row> = { rows: Row[]; changes: number };
export type Results<S> = { [K in keyof S]: S[K] extends Statement<infer Row> ? Result<Row> : never };

function build(strings: TemplateStringsArray, values: Value[]): { sql: string; params: Value[] } {
  let text = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) text += "?" + (strings[i + 1] ?? "");
  return { sql: text, params: values };
}

/** A statement. Each `${value}` is a bound parameter, never spliced in. */
export function sql(strings: TemplateStringsArray, ...values: Value[]): Statement<never>;
/** A statement whose rows are parsed with `row`, as in `sql(Row)\`SELECT …\``. */
export function sql<R extends z.ZodObject>(
  row: R,
): (strings: TemplateStringsArray, ...values: Value[]) => Statement<z.output<R>>;
export function sql(first: TemplateStringsArray | z.ZodObject, ...values: Value[]): unknown {
  if (Array.isArray(first)) return build(first as TemplateStringsArray, values);
  const row = first as z.ZodObject;
  return (strings: TemplateStringsArray, ...vals: Value[]) => ({ ...build(strings, vals), row });
}

/** What runs statements: the Node adapter's SQLite file, or a test's. */
export type Driver = {
  execute(statements: { sql: string; params: Value[] }[]): Promise<Result<unknown>[]>;
};

let driver: Driver | undefined;

export function setDriver(next: Driver | undefined): void {
  driver = next;
}

const forbidden = /^\s*(create|drop|alter|pragma|attach|detach|begin|commit|end|rollback|savepoint|release|vacuum|reindex)\b/i;

/** The app's SQLite database. */
export const db = {
  /** Runs statements as one transaction; results come back in order. */
  async execute<S extends Statement<unknown>[]>(...statements: S): Promise<Results<S>> {
    if (!driver) throw toolError("unavailable", "No database driver installed");
    for (const s of statements) {
      if (forbidden.test(s.sql)) throw toolError("not_allowed", `Statement not allowed: ${s.sql.trim().split("\n")[0]}`);
    }
    const params = statements.map((s) => ({
      sql: s.sql,
      params: s.params.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)),
    }));
    const results = await driver.execute(params);
    return results.map((result, i) => {
      const row = statements[i]?.row;
      if (!row) return result;
      return {
        changes: result.changes,
        rows: result.rows.map((r) => {
          const parsed = row.safeParse(r);
          if (parsed.success) return parsed.data;
          const issue = parsed.error.issues[0];
          throw toolError("row_mismatch", `Row does not match at ${issue?.path.join(".") ?? "?"}: ${issue?.message ?? ""}`);
        }),
      };
    }) as Results<S>;
  },
};

/** A table, declared once: its row schema is its columns. */
export function table<R extends z.ZodObject>(
  name: string,
  row: R,
  options?: TableOptions<z.output<R>>,
): Table<R> {
  return { name, row, key: options?.key ?? [], people: options?.people ?? [] };
}

export type TableOptions<Row> = {
  key?: (keyof Row & string)[];
  people?: (keyof Row & string)[];
};

export type Table<R extends z.ZodObject = z.ZodObject> = {
  name: string;
  row: R;
  key: string[];
  people: string[];
};
