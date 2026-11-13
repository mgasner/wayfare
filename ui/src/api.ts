import kinds from "virtual:entrypoints";
import type { Mutation, Query } from "../../lib/nexus.js";
import type { modules } from "../../server/index.js";

type Modules = typeof modules;
type Callable = Query<never, unknown> | Mutation<never, unknown>;

/** Every entrypoint as "file.export", such as "trips.get". */
export type Name = {
  [F in keyof Modules & string]: {
    [E in keyof Modules[F] & string]: Modules[F][E] extends Callable ? `${F}.${E}` : never;
  }[keyof Modules[F] & string];
}[keyof Modules & string];

type At<N> = N extends `${infer F extends keyof Modules & string}.${infer E}`
  ? E extends keyof Modules[F]
    ? Modules[F][E]
    : never
  : never;

export type Input<N extends Name> = At<N> extends (input: infer I) => Promise<unknown> ? I : never;
export type Output<N extends Name> = At<N> extends (input: never) => Promise<infer O> ? O : never;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Calls a server entrypoint: queries as GET with ?input=, mutations as POST. */
export async function call<N extends Name>(
  name: N,
  ...[input]: {} extends Input<N> ? [input?: Input<N>] : [input: Input<N>]
): Promise<Output<N>> {
  const kind = kinds[name];
  if (!kind) throw new ApiError(404, "not_found", `No entrypoint ${name}`);
  const path = `/api/${String(name).replace(".", "/")}`;
  const body = JSON.stringify(input ?? {});
  const res =
    kind === "query"
      ? await fetch(`${path}?input=${encodeURIComponent(body)}`, { credentials: "same-origin" })
      : await fetch(path, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body,
        });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (data as { error?: { code?: string; message?: string; issues?: unknown } } | null)?.error;
    throw new ApiError(res.status, error?.code ?? "error", error?.message ?? res.statusText, error?.issues);
  }
  return data as Output<N>;
}
