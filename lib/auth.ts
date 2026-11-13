import { z } from "zod";
import { attempt } from "./attempt.js";
import { databaseFromEnv, driverFor } from "./db.js";
import { authorizeUrl, googleEnv, idClaims, pkce, TOKEN_URL, tokenRequest, TokenResponse } from "./google.js";
import { Auth, db, setDriver, sql } from "./nexus.js";
import { cookie, readCookie, SESSION_COOKIE, SESSION_DAYS, sessionToken, sessionUser, sign, verify } from "./session.js";

const OAUTH_COOKIE = "dp_oauth";
const OAUTH_PATH = "/api/auth";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

let driverReady = false;

/** Installs the environment's database as the db driver, once per process. */
export function ensureDriver(): void {
  if (driverReady) return;
  setDriver(driverFor(databaseFromEnv()));
  driverReady = true;
}

const Person = z.object({ id: z.string(), name: z.string(), email: z.string() });

/** The session cookie's user; locally, DEV_USER when there is no session. */
export async function authenticate(request: Request, env: NodeJS.ProcessEnv = process.env): Promise<Auth | null> {
  const token = readCookie(request, SESSION_COOKIE);
  const uid = token && env.SESSION_SECRET ? sessionUser(token, env) : null;
  if (uid) {
    const [{ rows }] = await db.execute(sql(Person)`SELECT id, name, email FROM app_user WHERE id = ${uid}`);
    if (rows[0]) return Auth.create({ kind: "person", ...rows[0] });
  }
  // VERCEL is set in every Vercel build and function, so the bypass only works off Vercel.
  if (env.DEV_USER && !env.VERCEL) return devAuth(env.DEV_USER);
  return null;
}

/** The DEV_USER bypass: signs in as `email`, creating the app_user on first use. */
export async function devAuth(email: string): Promise<Auth> {
  const name = email.split("@")[0] ?? email;
  const [, { rows }] = await db.execute(
    sql`INSERT INTO app_user (id, email, name, created_at) VALUES (${crypto.randomUUID()}, ${email}, ${name}, ${new Date().toISOString()})
        ON CONFLICT (email) DO NOTHING`,
    sql(Person)`SELECT id, name, email FROM app_user WHERE email = ${email}`,
  );
  const user = rows[0];
  if (!user) throw new Error(`Could not create app_user ${email}`);
  return Auth.create({ kind: "person", ...user });
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

/** Only same-site paths, so `next` cannot send someone elsewhere. */
function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

function failed(reason: string, next = "/"): Response {
  const url = new URL(next, "http://x");
  url.searchParams.set("auth_error", reason);
  return redirect(url.pathname + url.search);
}

/** GET /api/auth/login?next=/path[&consent=1] */
export async function login(request: Request, env: NodeJS.ProcessEnv = process.env): Promise<Response> {
  const url = new URL(request.url);
  const g = googleEnv(request, env);
  const state = crypto.randomUUID();
  const { verifier, challenge } = pkce();
  const next = safeNext(url.searchParams.get("next"));
  // Google sends a refresh token only on consent; the callback asks again when the stored one is missing.
  const consent = url.searchParams.get("consent") === "1";
  const flow = sign({ state, verifier, next, consent, exp: Date.now() + 600_000 }, env);
  const target = new URL(authorizeUrl(g, state, challenge));
  if (consent) target.searchParams.set("prompt", "consent");
  return redirect(target.toString(), [cookie(request, OAUTH_COOKIE, flow, { maxAge: 600, path: OAUTH_PATH })]);
}

const Flow = z.object({ state: z.string(), verifier: z.string(), next: z.string(), consent: z.boolean(), exp: z.number() });

/** GET /api/auth/callback?code=…&state=… */
export async function callback(request: Request, env: NodeJS.ProcessEnv = process.env): Promise<Response> {
  const url = new URL(request.url);
  const clear = cookie(request, OAUTH_COOKIE, "", { maxAge: 0, path: OAUTH_PATH });
  const raw = readCookie(request, OAUTH_COOKIE);
  const flow = Flow.safeParse(raw ? verify(raw, env) : null);
  if (!flow.success || flow.data.exp < Date.now() || flow.data.state !== url.searchParams.get("state")) {
    return failed("state");
  }
  const { next, verifier, consent } = flow.data;
  const error = url.searchParams.get("error");
  if (error) return failed(error.replace(/[^\w]/g, ""), next);
  const code = url.searchParams.get("code");
  if (!code) return failed("code", next);

  const g = googleEnv(request, env);
  let tokens: TokenResponse;
  try {
    ({ value: tokens } = await attempt({ kind: "token.exchange", channel: "google.oauth", timeoutMs: 10_000 }, [
      [
        "live",
        async ({ signal }) => {
          const res = await fetch(TOKEN_URL, { ...tokenRequest(g, code, verifier), signal });
          if (!res.ok) throw new Error(`Token endpoint answered ${res.status}`);
          return TokenResponse.parse(await res.json());
        },
      ],
    ]));
  } catch {
    return failed("token", next);
  }
  const claims = idClaims(tokens.id_token, g);
  const now = new Date().toISOString();
  const name = claims.name ?? claims.email.split("@")[0] ?? claims.email;
  const calendar = tokens.scope.split(" ").includes(CALENDAR_SCOPE);
  const credentials = JSON.stringify({ refresh_token: tokens.refresh_token ?? null, scope: tokens.scope, sub: claims.sub });

  const [, user, link] = await db.execute(
    sql`INSERT INTO app_user (id, email, name, picture, created_at)
        VALUES (${crypto.randomUUID()}, ${claims.email}, ${name}, ${claims.picture ?? null}, ${now})
        ON CONFLICT (email) DO UPDATE SET name = excluded.name, picture = excluded.picture
        WHERE (app_user.name, app_user.picture) IS NOT (excluded.name, excluded.picture)`,
    sql(z.object({ id: z.string() }))`SELECT id FROM app_user WHERE email = ${claims.email}`,
    sql(z.object({ has_refresh: z.number() }))`
      INSERT INTO calendar_link (owner, provider, ref, credentials)
      SELECT id, 'google', ${claims.email}, ${credentials} FROM app_user WHERE email = ${claims.email} AND ${calendar}
      ON CONFLICT (owner, provider, ref) DO UPDATE SET credentials = CASE
        WHEN json_extract(excluded.credentials, '$.refresh_token') IS NULL
        THEN json_set(calendar_link.credentials, '$.scope', json_extract(excluded.credentials, '$.scope'))
        ELSE excluded.credentials END
      RETURNING json_extract(credentials, '$.refresh_token') IS NOT NULL AS has_refresh`,
  );
  const uid = user.rows[0]?.id;
  if (!uid) throw new Error(`Could not create app_user ${claims.email}`);
  const session = cookie(request, SESSION_COOKIE, sessionToken(uid, env), { maxAge: SESSION_DAYS * 86_400 });
  if (calendar && !link.rows[0]?.has_refresh && !consent) {
    return redirect(`/api/auth/login?consent=1&next=${encodeURIComponent(next)}`, [clear, session]);
  }
  return redirect(next, [clear, session]);
}

/** POST (or GET) /api/auth/logout */
export async function logout(request: Request): Promise<Response> {
  return redirect("/", [cookie(request, SESSION_COOKIE, "", { maxAge: 0 })]);
}
