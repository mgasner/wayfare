import { createHmac, timingSafeEqual } from "node:crypto";

// A session is an HMAC-signed cookie holding the app_user id; there is no session table,
// so signing out clears the cookie and rotating SESSION_SECRET signs everyone out.

export const SESSION_COOKIE = "dp_session";
export const SESSION_DAYS = 30;

function secret(env: NodeJS.ProcessEnv): string {
  const value = env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return value;
}

function mac(value: string, env: NodeJS.ProcessEnv): string {
  return createHmac("sha256", secret(env)).update(value).digest("base64url");
}

/** `payload.signature`, both base64url. */
export function sign(payload: object, env: NodeJS.ProcessEnv = process.env): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body, env)}`;
}

export function verify(token: string, env: NodeJS.ProcessEnv = process.env): unknown {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(body, env));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function sessionToken(userId: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()): string {
  return sign({ uid: userId, exp: now + SESSION_DAYS * 86_400_000 }, env);
}

/** The user id in a valid, unexpired session token. */
export function sessionUser(token: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()): string | null {
  const payload = verify(token, env) as { uid?: unknown; exp?: unknown } | null;
  if (typeof payload?.uid !== "string" || typeof payload.exp !== "number" || payload.exp < now) return null;
  return payload.uid;
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function cookie(
  request: Request,
  name: string,
  value: string,
  options: { maxAge: number; path?: string },
): string {
  const https = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const secure = https ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=${options.path ?? "/"}; Max-Age=${options.maxAge}; HttpOnly; SameSite=Lax${secure}`;
}
