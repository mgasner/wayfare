import { authenticate, ensureDriver } from "../lib/auth.js";
import { serveInRequest } from "../lib/db.js";
import { handleVoice } from "../lib/voice.js";

export async function POST(request: Request): Promise<Response> {
  ensureDriver();
  return serveInRequest(async () => handleVoice(request, await authenticate(request), { env: process.env }));
}
