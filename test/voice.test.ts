import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FileDatabase } from "../lib/db.js";
import type { Auth } from "../lib/nexus.js";
import { audioFileName } from "../lib/transcribe.js";
import { handleVoice, MAX_AUDIO_BYTES } from "../lib/voice.js";
import { addUser, personalDataInInteractions, seededDb } from "./helpers.js";

let database: FileDatabase;
let max: Auth;

beforeAll(async () => {
  database = await seededDb();
  max = await addUser(database, "max@example.com");
});

afterEach(() => vi.unstubAllGlobals());

function voiceRequest(audio: Blob | null, context: unknown = { screen: "anchors" }) {
  const form = new FormData();
  if (audio) form.set("audio", audio, "voice.webm");
  form.set("context", typeof context === "string" ? context : JSON.stringify(context));
  return new Request("http://localhost/api/voice", { method: "POST", body: form });
}

const env = { OPENAI_API_KEY: "sk-test" };
const clip = () => new Blob([new Uint8Array([26, 69, 223, 163, 1, 2, 3])], { type: "audio/webm" });

function stubOpenAI(text: string, status = 200) {
  const calls: { url: string; form: FormData }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, form: init.body as FormData });
      if (status !== 200) return new Response("nope", { status });
      return Response.json({
        text,
        usage: { type: "duration", seconds: 4 },
      });
    }),
  );
  return calls;
}

describe("POST /api/voice", () => {
  it("stores the clip, transcribes it and keeps the transcript out of interaction.request", async () => {
    const calls = stubOpenAI(" el viernes estamos en Barranco, ten to six ");
    const interpret = vi.fn(async () => ({ changes: [], undo: "" }));
    const res = await handleVoice(voiceRequest(clip(), { screen: "anchors", date: "2026-11-20" }), max, { env, interpret });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ transcript: "el viernes estamos en Barranco, ten to six", changes: [], undo: "" });
    expect(interpret).toHaveBeenCalledWith("el viernes estamos en Barranco, ten to six", { screen: "anchors", date: "2026-11-20" }, max, {
      media: expect.any(String),
    });

    expect(calls[0]!.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(calls[0]!.form.get("model")).toBe("gpt-transcribe");
    expect(String(calls[0]!.form.get("prompt"))).toContain("Barranco");
    expect((calls[0]!.form.get("file") as File).name).toBe("voice.webm");

    const media = await database.run((s) => s.prepare("SELECT owner, kind, mime, bytes FROM media").all());
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ owner: max.actor.kind === "person" ? max.actor.id : "", kind: "voice", mime: "audio/webm" });
    expect((media[0]!.bytes as Uint8Array).length).toBe(7);

    const ix = await database.run((s) => s.prepare("SELECT * FROM interaction WHERE kind = 'transcribe'").all());
    expect(ix).toHaveLength(1);
    expect(ix[0]).toMatchObject({ channel: "openai", outcome: "ok", fallback: "live" });
    expect(ix[0]!.cost_usd).toBeCloseTo((4 / 60) * 0.0045);
    expect(String(ix[0]!.request)).not.toMatch(/viernes|Barranco/);
    expect(JSON.parse(String(ix[0]!.request))).toMatchObject({ city: "lima", model: "gpt-transcribe", mime: "audio/webm" });
    const priv = await database.run((s) => s.prepare("SELECT * FROM interaction_private WHERE interaction = ?").get(ix[0]!.id as string));
    expect(String(priv!.payload)).toContain("el viernes");
    expect(priv!.media).toBe((await database.run((s) => s.prepare("SELECT id FROM media").get()))!.id);
    expect(await personalDataInInteractions(database)).toEqual([]);
  });

  it("rejects missing audio, bad context, big clips and signed-out callers", async () => {
    stubOpenAI("x");
    expect((await handleVoice(voiceRequest(null), max, { env })).status).toBe(400);
    expect((await handleVoice(voiceRequest(clip(), "{not json"), max, { env })).status).toBe(400);
    expect((await handleVoice(voiceRequest(clip(), { trip: 3 }), max, { env })).status).toBe(400);
    const big = new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: "audio/webm" });
    expect((await handleVoice(voiceRequest(big), max, { env })).status).toBe(413);
    const text = new Blob(["hi"], { type: "text/plain" });
    expect((await handleVoice(voiceRequest(text), max, { env })).status).toBe(400);
    expect((await handleVoice(voiceRequest(clip()), null, { env })).status).toBe(401);
  });

  it("logs a failed transcription and answers 502", async () => {
    stubOpenAI("", 500);
    const res = await handleVoice(voiceRequest(clip()), max, { env });
    expect(res.status).toBe(502);
    const ix = await database.run((s) => s.prepare("SELECT outcome, error FROM interaction WHERE kind = 'transcribe' ORDER BY at DESC LIMIT 1").get());
    expect(ix).toMatchObject({ outcome: "error" });
  });

  it("skips interpretation for silence", async () => {
    stubOpenAI("   ");
    const interpret = vi.fn();
    const res = await handleVoice(voiceRequest(clip()), max, { env, interpret });
    expect(await res.json()).toEqual({ transcript: "", changes: [], undo: "" });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("names files so OpenAI reads the container", () => {
    expect(audioFileName("audio/webm;codecs=opus")).toBe("voice.webm");
    expect(audioFileName("audio/mp4")).toBe("voice.m4a");
    expect(audioFileName("audio/aac")).toBe("voice.m4a");
    expect(audioFileName("audio/ogg")).toBe("voice.ogg");
  });
});
