import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const GOOGLE_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.readonly"];
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleEnv = { clientId: string; clientSecret: string; redirectUri: string };

export function googleEnv(request: Request, env: NodeJS.ProcessEnv = process.env): GoogleEnv {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  const origin = (env.APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  return { clientId, clientSecret, redirectUri: `${origin}/api/auth/callback` };
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authorizeUrl(g: GoogleEnv, state: string, challenge: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: g.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export const TokenResponse = z.object({
  access_token: z.string(),
  id_token: z.string(),
  expires_in: z.number(),
  scope: z.string(),
  refresh_token: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponse>;

export function tokenRequest(g: GoogleEnv, code: string, verifier: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: g.clientId,
      client_secret: g.clientSecret,
      redirect_uri: g.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }).toString(),
  };
}

export const IdClaims = z.object({
  iss: z.enum(["https://accounts.google.com", "accounts.google.com"]),
  aud: z.string(),
  sub: z.string(),
  email: z.string(),
  email_verified: z.boolean(),
  name: z.string().optional(),
  picture: z.string().optional(),
  exp: z.number(),
});
export type IdClaims = z.infer<typeof IdClaims>;

/**
 * Claims of an ID token that came straight from Google's token endpoint over TLS, which
 * OpenID Connect Core 3.1.3.7 lets a client trust without checking the signature.
 */
export function idClaims(idToken: string, g: GoogleEnv, now = Date.now()): IdClaims {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("Malformed ID token");
  const claims = IdClaims.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (claims.aud !== g.clientId) throw new Error("ID token is for another client");
  if (claims.exp * 1000 < now) throw new Error("ID token expired");
  if (!claims.email_verified) throw new Error("Google account email is not verified");
  return claims;
}
