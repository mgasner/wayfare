import { agentAuth } from "../lib/agent-auth.js";
import { authenticate, ensureDriver } from "../lib/auth.js";
import { serveInRequest } from "../lib/db.js";
import { route } from "../lib/router.js";
import { blockedChannelsFromEnv, setBlockedChannels } from "../server/adapters/slots.js";
import { modules } from "../server/index.js";

async function handle(request: Request): Promise<Response> {
  ensureDriver();
  setBlockedChannels(blockedChannelsFromEnv(process.env.BLOCK_CHANNELS));
  return serveInRequest(() => route(request, modules, async (r) => agentAuth(r) ?? authenticate(r)));
}

export const GET = handle;
export const POST = handle;
