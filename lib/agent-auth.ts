import { createHash, timingSafeEqual } from "node:crypto";
import { Auth, toolError } from "./nexus.js";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * `Authorization: Bearer <AGENT_TOKEN>` signs the call in as Indent itself, for server/agent.ts.
 * No header returns null so other sign-in paths run; a wrong or unconfigured token is a 401.
 */
export function agentAuth(request: Request, token: string | undefined = process.env.AGENT_TOKEN): Auth | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match || !token || !timingSafeEqual(digest(match[1]!), digest(token))) {
    throw toolError("no_user", "Bad agent token");
  }
  return Auth.create({ kind: "indent" });
}
