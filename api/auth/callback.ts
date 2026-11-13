import { callback, ensureDriver } from "../../lib/auth.js";
import { inRequest } from "../../lib/db.js";

export function GET(request: Request): Promise<Response> {
  ensureDriver();
  return inRequest(() => callback(request));
}
