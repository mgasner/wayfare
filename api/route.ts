import { devAuth } from "../lib/auth.js";
import { databaseFromEnv, driverFor, inRequest } from "../lib/db.js";
import { setDriver } from "../lib/nexus.js";
import { route } from "../lib/router.js";
import { modules } from "../server/index.js";

let ready = false;

async function handle(request: Request): Promise<Response> {
  if (!ready) {
    setDriver(driverFor(databaseFromEnv()));
    ready = true;
  }
  return inRequest(() =>
    route(request, modules, async () => {
      const email = process.env.DEV_USER;
      return email ? devAuth(email) : null;
    }),
  );
}

export const GET = handle;
export const POST = handle;
