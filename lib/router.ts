// Serves `/api/<file>/<export>` like the SDK's HTTP section. No Node modules, so it also runs under Vite.
import { entrypointSpec, isEntrypoint, isToolError, type Auth, type ToolErrorCode } from "./nexus.js";

export type Modules = Record<string, Record<string, unknown>>;

const statusFor: Record<ToolErrorCode, number> = {
  invalid_input: 400,
  no_user: 401,
  not_allowed: 403,
  not_found: 404,
  too_large: 413,
  unavailable: 503,
  timeout: 504,
  sqlite_error: 500,
  row_mismatch: 500,
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json(status, { error: { code, message, ...extra } });
}

/** `/api/trips/get`, or the rewrite's `/api/route?file=trips&export=get`. */
export function target(url: URL): { file: string; name: string } | null {
  const file = url.searchParams.get("file");
  const name = url.searchParams.get("export");
  if (file && name) return { file, name };
  const match = /^\/api\/([\w-]+)\/([\w-]+)\/?$/.exec(url.pathname);
  return match ? { file: match[1]!, name: match[2]! } : null;
}

export async function route(
  request: Request,
  modules: Modules,
  authenticate: (request: Request) => Promise<Auth | null>,
): Promise<Response> {
  const url = new URL(request.url);
  const at = target(url);
  const value = at && Object.hasOwn(modules, at.file) ? modules[at.file]?.[at.name] : undefined;
  if (!at || !isEntrypoint(value)) return fail(404, "not_found", `No entrypoint at ${url.pathname}`);

  const method = value.kind === "query" ? "GET" : "POST";
  if (request.method !== method) {
    return json(405, { error: { code: "method_not_allowed", message: `${at.file}.${at.name} takes ${method}` } }, { Allow: method });
  }

  let raw: unknown;
  try {
    if (method === "GET") {
      const input = url.searchParams.get("input");
      raw = input === null ? {} : JSON.parse(input);
    } else {
      const text = await request.text();
      raw = text.trim() === "" ? {} : JSON.parse(text);
    }
  } catch {
    return fail(400, "invalid_input", "Input is not JSON");
  }

  const spec = entrypointSpec(value);
  const parsed = spec.input.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid_input", "Input does not match", { issues: parsed.error.issues });

  try {
    const auth = await authenticate(request);
    const result = await spec.handler(parsed.data, { auth });
    if (spec.output) {
      const out = spec.output.safeParse(result);
      if (!out.success) {
        console.error(JSON.stringify({ event: "api.output_mismatch", entrypoint: `${at.file}.${at.name}`, issues: out.error.issues }));
        return fail(500, "output_mismatch", "Result does not match the output schema");
      }
      return json(200, out.data);
    }
    return json(200, result);
  } catch (error) {
    if (isToolError(error)) {
      if (statusFor[error.code] >= 500) console.error(error);
      return fail(statusFor[error.code] ?? 500, error.code, error.message);
    }
    console.error(error);
    return fail(500, "error", error instanceof Error ? error.message : String(error));
  }
}
