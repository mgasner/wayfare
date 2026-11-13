import { agentAuth } from "../lib/agent-auth.js";
import { authenticate, ensureDriver } from "../lib/auth.js";
import { serveInRequest } from "../lib/db.js";
import { route } from "../lib/router.js";
import { publicFetcher } from "../lib/public-fetch.js";
import { setFeedFetcher } from "../server/adapters/ics.js";
import { blockedChannelsFromEnv, setBlockedChannels } from "../server/adapters/slots.js";
import { modules } from "../server/index.js";

const feeds = publicFetcher();

async function handle(request: Request): Promise<Response> {
  ensureDriver();
  setBlockedChannels(blockedChannelsFromEnv(process.env.BLOCK_CHANNELS));
  setFeedFetcher(feeds);
  return serveInRequest(() => route(request, modules, async (r) => agentAuth(r) ?? authenticate(r)));
}

export const GET = handle;
export const POST = handle;
