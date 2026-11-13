import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate, callback, login, logout } from "../lib/auth.js";
import type { FileDatabase } from "../lib/db.js";
import { TOKEN_URL } from "../lib/google.js";
import { sessionToken, sessionUser, sign, verify } from "../lib/session.js";
import { seededDb } from "./helpers.js";

const env = {
  SESSION_SECRET: "s".repeat(40),
  GOOGLE_CLIENT_ID: "client-1",
  GOOGLE_CLIENT_SECRET: "shh",
  APP_URL: "https://app.example.com",
} as NodeJS.ProcessEnv;

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims: object) =>
  `${b64({ alg: "RS256" })}.${b64({
    iss: "https://accounts.google.com",
    aud: "client-1",
    sub: "g-1",
    email: "max@example.com",
    email_verified: true,
    name: "Max G",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })}.sig`;

const fullScope = "openid email profile https://www.googleapis.com/auth/calendar.readonly";

function cookiesOf(res: Response): Record<string, string> {
  return Object.fromEntries(
    res.headers.getSetCookie().map((c) => {
      const [pair] = c.split(";");
      const [k, ...v] = pair!.split("=");
      return [k!, decodeURIComponent(v.join("="))];
    }),
  );
}

/** Runs login, then the callback Google would send, with the token endpoint answering `tokens`. */
async function signIn(tokens: object, loginQuery = "next=%2Ftrips%2F1") {
  const start = await login(new Request(`https://app.example.com/api/auth/login?${loginQuery}`), env);
  const google = new URL(start.headers.get("Location")!);
  const flow = cookiesOf(start).dp_oauth!;
  const fetchMock = vi.fn(async () => Response.json({ access_token: "at", expires_in: 3599, id_token: idToken({}), scope: fullScope, ...tokens }));
  vi.stubGlobal("fetch", fetchMock);
  const res = await callback(
    new Request(`https://app.example.com/api/auth/callback?code=c1&state=${google.searchParams.get("state")}`, {
      headers: { cookie: `dp_oauth=${encodeURIComponent(flow)}` },
    }),
    env,
  );
  return { google, res, fetchMock };
}

let database: FileDatabase;
beforeEach(async () => {
  database = await seededDb();
});
afterEach(() => vi.unstubAllGlobals());

describe("session tokens", () => {
  it("round-trips and rejects tampering and expiry", () => {
    const token = sessionToken("u1", env);
    expect(sessionUser(token, env)).toBe("u1");
    const [body, sig] = token.split(".");
    expect(sessionUser(`${b64({ uid: "u2", exp: Date.now() + 1e6 })}.${sig}`, env)).toBeNull();
    expect(sessionUser(`${body}.${sig}x`, env)).toBeNull();
    expect(sessionUser(token, { ...env, SESSION_SECRET: "t".repeat(40) })).toBeNull();
    expect(sessionUser(token, env, Date.now() + 31 * 86_400_000)).toBeNull();
    expect(verify(sign({ a: 1 }, env), env)).toEqual({ a: 1 });
  });
});

describe("login", () => {
  it("redirects to Google with offline access, the calendar scope and PKCE", async () => {
    const res = await login(new Request("https://app.example.com/api/auth/login?next=//evil.com"), env);
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("Location")!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "client-1",
      redirect_uri: "https://app.example.com/api/auth/callback",
      response_type: "code",
      scope: fullScope,
      access_type: "offline",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("prompt")).toBeNull();
    const cookie = res.headers.getSetCookie()[0]!;
    expect(cookie).toMatch(/^dp_oauth=.*Path=\/api\/auth; Max-Age=600; HttpOnly; SameSite=Lax; Secure$/);
    expect((verify(cookiesOf(res).dp_oauth!, env) as { next: string }).next).toBe("/");
  });
});

describe("callback", () => {
  it("creates the user, stores the refresh token, and signs in", async () => {
    const { res, fetchMock } = await signIn({ refresh_token: "rt-1" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/trips/1");
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe(TOKEN_URL);
    const body = new URLSearchParams(call[1].body as string);
    expect(body.get("code")).toBe("c1");
    expect(body.get("code_verifier")).toMatch(/^[\w-]{43}$/);

    const user = await database.run((s) => s.prepare("SELECT * FROM app_user WHERE email = 'max@example.com'").get());
    expect(user).toMatchObject({ name: "Max G" });
    const link = await database.run((s) => s.prepare("SELECT * FROM calendar_link").get());
    expect(link).toMatchObject({ owner: user!.id, provider: "google", ref: "max@example.com" });
    expect(JSON.parse(link!.credentials as string)).toMatchObject({ refresh_token: "rt-1", scope: fullScope });

    const session = cookiesOf(res).dp_session!;
    const auth = await authenticate(new Request("https://app.example.com/api/me/get", { headers: { cookie: `dp_session=${session}` } }), env);
    expect(auth?.actor).toEqual({ kind: "person", id: user!.id, name: "Max G", email: "max@example.com" });

    const logged = await database.run((s) => s.prepare("SELECT channel, kind, outcome, request FROM interaction").all());
    expect(logged).toEqual([{ channel: "google.oauth", kind: "token.exchange", outcome: "ok", request: null }]);
  });

  it("sends the user back with auth_error=token when the exchange fails", async () => {
    const start = await login(new Request("https://app.example.com/api/auth/login"), env);
    const state = new URL(start.headers.get("Location")!).searchParams.get("state");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    const res = await callback(
      new Request(`https://app.example.com/api/auth/callback?code=c&state=${state}`, {
        headers: { cookie: `dp_oauth=${encodeURIComponent(cookiesOf(start).dp_oauth!)}` },
      }),
      env,
    );
    expect(res.headers.get("Location")).toBe("/?auth_error=token");
    const logged = await database.run((s) => s.prepare("SELECT outcome, error FROM interaction").get());
    expect(logged).toEqual({ outcome: "error", error: "Token endpoint answered 400" });
  });

  it("keeps the stored refresh token when Google sends none", async () => {
    await signIn({ refresh_token: "rt-1" });
    const { res } = await signIn({});
    expect(res.headers.get("Location")).toBe("/trips/1");
    const link = await database.run((s) => s.prepare("SELECT credentials FROM calendar_link").get());
    expect(JSON.parse(link!.credentials as string).refresh_token).toBe("rt-1");
    expect(await database.run((s) => s.prepare("SELECT count(*) AS n FROM app_user").get())).toEqual({ n: 1 });
  });

  it("asks for consent once when there is no refresh token", async () => {
    const first = await signIn({});
    expect(first.res.headers.get("Location")).toBe("/api/auth/login?consent=1&next=%2Ftrips%2F1");
    const second = await signIn({}, "consent=1&next=%2Ftrips%2F1");
    expect(second.google.searchParams.get("prompt")).toBe("consent");
    expect(second.res.headers.get("Location")).toBe("/trips/1");
  });

  it("signs in without a calendar link when the calendar scope is declined", async () => {
    const { res } = await signIn({ scope: "openid email profile" });
    expect(res.headers.get("Location")).toBe("/trips/1");
    expect(await database.run((s) => s.prepare("SELECT count(*) AS n FROM calendar_link").get())).toEqual({ n: 0 });
  });

  it("refuses a state that does not match the cookie", async () => {
    const start = await login(new Request("https://app.example.com/api/auth/login"), env);
    const res = await callback(
      new Request("https://app.example.com/api/auth/callback?code=c&state=forged", {
        headers: { cookie: `dp_oauth=${encodeURIComponent(cookiesOf(start).dp_oauth!)}` },
      }),
      env,
    );
    expect(res.headers.get("Location")).toBe("/?auth_error=state");
    expect(res.headers.getSetCookie().some((c) => c.startsWith("dp_session="))).toBe(false);
  });

  it("refuses an ID token for another client", async () => {
    await expect(signIn({ id_token: idToken({ aud: "someone-else" }) })).rejects.toThrow(/another client/);
  });
});

describe("authenticate", () => {
  it("uses DEV_USER only off Vercel", async () => {
    const plain = new Request("http://localhost/api/me/get");
    expect((await authenticate(plain, { DEV_USER: "dev@example.com" }))?.actor).toMatchObject({ email: "dev@example.com" });
    expect(await authenticate(plain, { DEV_USER: "dev@example.com", VERCEL: "1" })).toBeNull();
    expect(await authenticate(plain, {})).toBeNull();
  });

  it("logout clears the session cookie", async () => {
    const res = await logout(new Request("https://app.example.com/api/auth/logout", { method: "POST" }));
    expect(res.headers.getSetCookie()[0]).toMatch(/^dp_session=; Path=\/; Max-Age=0/);
  });
});
