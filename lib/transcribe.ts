import { z } from "zod";
import { attempt } from "./attempt.js";

export type TranscribeEnv = { OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string; TRANSCRIBE_MODEL?: string };

const Usage = z.union([
  z.object({ type: z.literal("duration"), seconds: z.number() }),
  z.object({
    type: z.literal("tokens"),
    input_token_details: z.object({ text_tokens: z.number().default(0), audio_tokens: z.number().default(0) }).optional(),
    output_tokens: z.number().default(0),
  }),
]);
const Transcription = z.object({ text: z.string(), usage: Usage.optional() });

// List prices, Nov 2026: gpt-transcribe bills by duration, the gpt-4o models by token.
const PER_MINUTE: Record<string, number> = { "gpt-transcribe": 0.0045 };
const PER_TOKEN = { audio: 6e-6, text: 2.5e-6, output: 10e-6 };

function cost(model: string, usage: z.infer<typeof Usage>): number | null {
  if (usage.type === "duration") {
    const rate = PER_MINUTE[model];
    return rate === undefined ? null : (usage.seconds / 60) * rate;
  }
  const d = usage.input_token_details ?? { audio_tokens: 0, text_tokens: 0 };
  return d.audio_tokens * PER_TOKEN.audio + d.text_tokens * PER_TOKEN.text + usage.output_tokens * PER_TOKEN.output;
}

const extensions: [RegExp, string][] = [
  [/webm/, "webm"],
  [/mp4|m4a|aac/, "m4a"],
  [/ogg/, "ogg"],
  [/mpeg|mp3/, "mp3"],
  [/wav/, "wav"],
];

/** A file name whose extension OpenAI reads the container from. */
export function audioFileName(mime: string): string {
  const ext = extensions.find(([re]) => re.test(mime))?.[1] ?? "webm";
  return `voice.${ext}`;
}

export type TranscribeOptions = {
  owner: string;
  city: string;
  media: string;
  /** Names the model should spell right: areas, places. */
  vocabulary: string[];
  env: TranscribeEnv;
};

/**
 * Transcribes mixed Spanish and English speech. The transcript only goes to interaction_private.
 * This runs in lib/, not server/: the SDK's fetch takes string bodies only, so it can't send multipart audio.
 */
export async function transcribe(audio: Blob, options: TranscribeOptions): Promise<string> {
  const { env } = options;
  // gpt-4o-transcribe dropped the second language in 30 to 100% of code-switched test clips; gpt-transcribe in none.
  const model = env.TRANSCRIBE_MODEL ?? "gpt-transcribe";
  const base = (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  // The model reads the prompt as preceding speech; a code-switched example keeps both languages.
  const prompt =
    "Lima trip notes, in Spanish and English mixed: El sábado vamos a Maido, around eight. " +
    "Mañana lunch en Isolina, then the beach. Names: " +
    options.vocabulary.slice(0, 120).join(", ") +
    ".";

  const result = await attempt(
    {
      kind: "transcribe",
      channel: "openai",
      owner: options.owner,
      request: { public: { city: options.city, model, mime: audio.type, bytes: audio.size } },
      timeoutMs: 30_000,
    },
    [
      [
        "live",
        async (ctx) => {
          ctx.media(options.media);
          const key = env.OPENAI_API_KEY;
          if (!key) throw new Error("OPENAI_API_KEY is not set");
          const form = new FormData();
          form.set("file", audio, audioFileName(audio.type));
          form.set("model", model);
          form.set("prompt", prompt);
          form.set("response_format", "json");
          const res = await fetch(`${base}/audio/transcriptions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` },
            body: form,
            signal: ctx.signal,
          });
          if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
          const body = Transcription.parse(await res.json());
          const usd = body.usage ? cost(model, body.usage) : null;
          if (usd !== null) ctx.cost(usd);
          if (body.usage?.type === "duration") ctx.note({ seconds: body.usage.seconds });
          ctx.privately({ transcript: body.text });
          return body.text.trim();
        },
      ],
    ],
  );
  return result.value;
}
