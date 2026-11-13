// Real API calls; run with REAL_API=1 pnpm vitest run test/real.test.ts
import { beforeAll, describe, expect, it } from "vitest";
import type { FileDatabase } from "../lib/db.js";
import type { Auth } from "../lib/nexus.js";
import { handleVoice } from "../lib/voice.js";
import { interpretText } from "../server/input.js";
import { addPlaces, createTrip } from "./fixtures.js";
import { addUser, callAs, seededDb } from "./helpers.js";

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
  let trip: string;

  beforeAll(async () => {
    database = await seededDb();
    max = await addUser(database, "max@example.com");
    await addPlaces(database);
    trip = (await createTrip(max)).id;
  });

  async function interpret(text: string, context: Record<string, unknown>) {
    const res = await callAs(max, "input.interpret", { text, context });
    console.log(JSON.stringify({ text, status: res.status, changes: res.body.changes }));
    expect(res.status).toBe(200);
    return res.body.changes as { kind: string; op: string; record: any }[];
  }

  it("el viernes estamos en Barranco, ten to six", { timeout: 60_000 }, async () => {
    const changes = await interpret("el viernes estamos en Barranco, ten to six", { screen: "anchors", trip });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "anchor", record: { date: "2026-11-20", start_time: "10:00", end_time: "18:00", area: "barranco" } });
  });

  it("a friend says Tía Grimanesa for anticuchos, after five", { timeout: 60_000 }, async () => {
    const changes = await interpret("a friend says Tía Grimanesa for anticuchos, after five", { screen: "saves", trip });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "save", record: { place: "tia-grimanesa" } });
    expect(changes[0]!.record.note).toMatch(/anticucho/i);
    expect(changes[0]!.record.note).toMatch(/5|five|17/i);
  });

  it("La Mar closes at 4:30 now", { timeout: 60_000 }, async () => {
    const changes = await interpret("La Mar closes at 4:30 now", { screen: "place", trip, place: "la-mar-cebicheria" });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "fact", record: { place: "la-mar-cebicheria", field: "hours", value: { closes: "16:30" } } });
    expect(changes[0]!.record.value.text).toMatch(/16:30|4:30/);
  });

  it("dinner at Rafael Saturday 8pm booked", { timeout: 60_000 }, async () => {
    const changes = await interpret("dinner at Rafael Saturday 8pm booked", { screen: "board", trip });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "meal", record: { place: "rafael", date: "2026-11-21", slot: "dinner", time: "20:00", status: "confirmed" } });
  });

  it("transcribes mixed Spanish and English and interprets it", { timeout: 60_000 }, async () => {
    const form = new FormData();
    const clip = wav([
      await speak("El viernes estamos en Barranco,", "A native speaker from Lima, Peru, speaking Spanish."),
      await speak("ten to six.", "An American speaking English, casually."),
    ]);
    form.set("audio", clip, "clip.wav");
    form.set("context", JSON.stringify({ screen: "anchors", trip }));
    const res = await handleVoice(new Request("http://localhost/api/voice", { method: "POST", body: form }), max, {
      env: process.env,
      interpret: interpretText,
    });
    const body = (await res.json()) as { transcript: string; changes: { kind: string; record: any }[] };
    console.log(JSON.stringify(body));
    expect(res.status).toBe(200);
    expect(body.transcript.toLowerCase()).toMatch(/viernes.*barranco.*(ten|10) to (six|6)/);
    expect(body.changes[0]).toMatchObject({ kind: "anchor", record: { date: "2026-11-20", area: "barranco" } });
  });
});
