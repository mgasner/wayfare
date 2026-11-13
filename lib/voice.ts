import { z } from "zod";
import { InputContext, type InterpretResult, type VoiceResult } from "../shared/actions.js";
import { db, sql, type Auth, type Value } from "./nexus.js";
import { transcribe, type TranscribeEnv } from "./transcribe.js";

// 60 s at the recorder's 64 kbit/s is about 0.5 MB; Vercel caps request bodies at 4.5 MB.
export const MAX_AUDIO_BYTES = 4_000_000;

export type Interpret = (text: string, context: InputContext, auth: Auth) => Promise<InterpretResult>;

export type VoiceDeps = { env: TranscribeEnv; interpret?: Interpret };

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

const Names = z.object({ name: z.string() });

/** The context's city, and its area and curated place names so the transcript spells them right. */
async function vocabulary(context: InputContext): Promise<{ city: string; names: string[] }> {
  const [cities, names] = await db.execute(
    sql(z.object({ id: z.string() }))`
      SELECT coalesce(
        (SELECT city FROM trip WHERE id = ${context.trip ?? null}),
        (SELECT city FROM place WHERE id = ${context.place ?? null}),
        (SELECT id FROM city ORDER BY id LIMIT 1)) AS id`,
    sql(Names)`
      WITH c AS (
        SELECT coalesce(
          (SELECT city FROM trip WHERE id = ${context.trip ?? null}),
          (SELECT city FROM place WHERE id = ${context.place ?? null}),
          (SELECT id FROM city ORDER BY id LIMIT 1)) AS id
      )
      SELECT name FROM area WHERE city = (SELECT id FROM c)
      UNION ALL
      SELECT name FROM (SELECT name FROM place WHERE city = (SELECT id FROM c) AND curated = 1 ORDER BY name)`,
  );
  return { city: cities.rows[0]?.id ?? "", names: names.rows.map((r) => r.name) };
}

/** POST /api/voice: multipart `audio` and `context` (JSON). Stores the clip, transcribes it and interprets the text. */
export async function handleVoice(request: Request, auth: Auth | null, deps: VoiceDeps): Promise<Response> {
  if (auth?.actor.kind !== "person") return fail(401, "no_user", "Sign in first");
  const owner = auth.actor.id;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "invalid_input", "Send multipart/form-data with audio and context");
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return fail(400, "invalid_input", "No audio");
  if (audio.size > MAX_AUDIO_BYTES) return fail(413, "too_large", "Audio is over 60 seconds");
  const mime = audio.type || "application/octet-stream";
  if (!/^(audio|video)\//.test(mime)) return fail(400, "invalid_input", `Not audio: ${mime}`);

  let context: InputContext;
  try {
    const raw = form.get("context");
    context = InputContext.parse(typeof raw === "string" ? JSON.parse(raw) : {});
  } catch {
    return fail(400, "invalid_input", "context is not valid JSON");
  }

  const media = crypto.randomUUID();
  const bytes = new Uint8Array(await audio.arrayBuffer());
  // Value has no binary type; the SQLite driver binds a Uint8Array as a blob.
  await db.execute(sql`
    INSERT INTO media (id, owner, kind, mime, bytes, created_at)
    VALUES (${media}, ${owner}, 'voice', ${mime}, ${bytes as unknown as Value}, ${new Date().toISOString()})`);

  let transcript: string;
  try {
    const { city, names } = await vocabulary(context);
    transcript = await transcribe(audio, { owner, city, media, vocabulary: names, env: deps.env });
  } catch (error) {
    console.error(JSON.stringify({ event: "voice.transcribe_failed", media, error: String(error) }));
    return fail(502, "unavailable", "Could not transcribe the recording");
  }

  const empty: VoiceResult = { transcript, changes: [], undo: "" };
  if (!transcript || !deps.interpret) return Response.json(empty);
  const result = await deps.interpret(transcript, context, auth);
  return Response.json({ transcript, ...result } satisfies VoiceResult);
}
