import { route } from "../lib/router.js";
import { modules } from "../server/index.js";

async function handle(request: Request): Promise<Response> {
  return route(request, modules, async () => null);
}

export const GET = handle;
export const POST = handle;
