// Real API calls; run with REAL_API=1 pnpm vitest run test/real.test.ts
import { beforeAll, describe, expect, it } from "vitest";
import type { FileDatabase } from "../lib/db.js";
import type { Auth } from "../lib/nexus.js";
import { handleVoice } from "../lib/voice.js";
import { addUser, seededDb } from "./helpers.js";

const real = !!process.env.REAL_API;

async function speak(text: string, instructions: string): Promise<Uint8Array> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: text, instructions, response_format: "pcm" }),
  });
  if (!res.ok) throw new Error(`speech ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** One WAV clip from 24 kHz 16-bit mono PCM parts, so each language is spoken as written. */
function wav(parts: Uint8Array[]): Blob {
  const size = parts.reduce((n, p) => n + p.length, 0);
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => header.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  header.setUint32(4, 36 + size, true);
  ascii(8, "WAVEfmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, 24_000, true);
  header.setUint32(28, 48_000, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  ascii(36, "data");
  header.setUint32(40, size, true);
  return new Blob([header.buffer, ...parts.map((p) => p.slice().buffer)], { type: "audio/wav" });
}

describe.skipIf(!real)("real APIs", () => {
  let database: FileDatabase;
  let max: Auth;

  beforeAll(async () => {
    database = await seededDb();
    max = await addUser(database, "max@example.com");
  });

  it("transcribes mixed Spanish and English", { timeout: 60_000 }, async () => {
    const form = new FormData();
    const clip = wav([
      await speak("El viernes estamos en Barranco,", "A native speaker from Lima, Peru, speaking Spanish."),
      await speak("ten to six.", "An American speaking English, casually."),
    ]);
    form.set("audio", clip, "clip.wav");
    form.set("context", JSON.stringify({ screen: "anchors" }));
    const res = await handleVoice(new Request("http://localhost/api/voice", { method: "POST", body: form }), max, { env: process.env });
    const body = (await res.json()) as { transcript: string };
    console.log(JSON.stringify(body));
    expect(res.status).toBe(200);
    expect(body.transcript.toLowerCase()).toMatch(/viernes.*barranco.*(ten|10) to (six|6)/);
  });
});
