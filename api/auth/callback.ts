import { callback, ensureDriver } from "../../lib/auth.js";
import { serveInRequest } from "../../lib/db.js";

export function GET(request: Request): Promise<Response> {
  ensureDriver();
  return serveInRequest(() => callback(request));
}
