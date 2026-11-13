import { describe, expect, it, vi } from "vitest";
import type { VoiceResult } from "../../../shared/actions.js";
import { isSafari, MAX_MS, pickMime, Recorder, type RecorderDeps, uploadVoice } from "./recorder.js";

function fakes(options: { supported?: string[]; safari?: boolean; deny?: boolean } = {}) {
  let clock = 0;
  const timers: { fn: () => void; at: number }[] = [];
  const tracks = { stopped: 0 };
  const uploads: Blob[] = [];
  let permission: () => void = () => {};
  let gate = Promise.resolve();
  const recorders: { mimeType: string; started: boolean }[] = [];
  const deps: RecorderDeps = {
    async getUserMedia() {
      await gate;
      if (options.deny) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      return { getTracks: () => [{ stop: () => void tracks.stopped++ }] } as unknown as MediaStream;
    },
    createRecorder(_stream, mimeType) {
      const r = {
        mimeType: mimeType ?? "",
        started: false,
        ondataavailable: null as ((e: { data: Blob }) => void) | null,
        onstop: null as (() => void) | null,
        start() {
          r.started = true;
        },
        stop() {
          r.ondataavailable?.({ data: new Blob(["abc"], { type: r.mimeType }) });
          r.onstop?.();
        },
      };
      recorders.push(r);
      return r;
    },
    isTypeSupported: (t) => (options.supported ?? ["audio/webm;codecs=opus", "audio/mp4"]).includes(t),
    async upload(audio) {
      uploads.push(audio);
      return { transcript: "hola", changes: [], undo: "u1" };
    },
    now: () => clock,
    setTimeout(fn, ms) {
      const t = { fn, at: clock + ms };
      timers.push(t);
      return t;
    },
    clearTimeout(h) {
      const i = timers.indexOf(h as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
    safari: options.safari ?? false,
  };
  return {
    deps,
    tracks,
    uploads,
    recorders,
    advance(ms: number) {
      clock += ms;
      for (const t of timers.filter((t) => t.at <= clock)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    },
    holdPermission() {
      gate = new Promise((r) => (permission = r));
    },
    grant: () => permission(),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const context = { screen: "anchors", trip: "t1" };

describe("Recorder", () => {
  it("records while held and uploads on release", async () => {
    const f = fakes();
    const results: VoiceResult[] = [];
    const r = new Recorder(f.deps, (x) => results.push(x));
    await r.start(context);
    expect(r.current.state).toBe("recording");
    expect(f.recorders[0]!.mimeType).toBe("audio/webm;codecs=opus");
    f.advance(2000);
    r.stop();
    await flush();
    expect(f.uploads).toHaveLength(1);
    expect(f.uploads[0]!.type).toBe("audio/webm");
    expect(results).toEqual([{ transcript: "hola", changes: [], undo: "u1" }]);
    expect(r.current.state).toBe("idle");
    expect(f.tracks.stopped).toBe(1);
  });

  it("stops by itself at 60 seconds", async () => {
    const f = fakes();
    const r = new Recorder(f.deps, () => {});
    await r.start(context);
    f.advance(MAX_MS);
    await flush();
    expect(f.uploads).toHaveLength(1);
    r.stop();
    await flush();
    expect(f.uploads).toHaveLength(1);
  });

  it("drops taps and releases during the permission prompt", async () => {
    const f = fakes();
    const r = new Recorder(f.deps, () => {});
    await r.start(context);
    f.advance(100);
    r.stop();
    await flush();
    expect(f.uploads).toHaveLength(0);
    expect(r.current.state).toBe("idle");

    f.holdPermission();
    const started = r.start(context);
    r.stop();
    f.grant();
    await started;
    expect(f.recorders).toHaveLength(1);
    expect(r.current.state).toBe("idle");
    expect(f.tracks.stopped).toBe(2);
  });

  it("reports a denied microphone", async () => {
    const f = fakes({ deny: true });
    const r = new Recorder(f.deps, () => {});
    await r.start(context);
    expect(r.current).toMatchObject({ state: "error", error: "Microphone access is off" });
    r.cancel();
    expect(r.current.state).toBe("idle");
  });

  it("records MP4/AAC on Safari", async () => {
    const f = fakes({ safari: true, supported: ["audio/mp4", "audio/webm;codecs=opus"] });
    const r = new Recorder(f.deps, () => {});
    await r.start(context);
    expect(f.recorders[0]!.mimeType).toBe("audio/mp4");
  });
});

describe("pickMime and isSafari", () => {
  it("prefers WebM/Opus except on Safari", () => {
    const all = (t: string) => ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"].includes(t);
    expect(pickMime(all, false)).toBe("audio/webm;codecs=opus");
    expect(pickMime(all, true)).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(pickMime(() => false, false)).toBeUndefined();
  });

  it("tells Safari from Chrome", () => {
    const ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1";
    const iosChrome = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0 Mobile/15E148 Safari/604.1";
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15";
    const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36";
    const android = "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36";
    expect([ios, iosChrome, mac, chrome, android].map(isSafari)).toEqual([true, true, true, false, false]);
  });
});

describe("uploadVoice", () => {
  it("posts multipart audio and context and surfaces server errors", async () => {
    const seen: FormData[] = [];
    const ok = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(init!.body as FormData);
      return Response.json({ transcript: "x", changes: [], undo: "" });
    });
    await uploadVoice(new Blob(["a"], { type: "audio/mp4" }), context, ok as typeof fetch);
    expect((seen[0]!.get("audio") as File).name).toBe("voice.m4a");
    expect(JSON.parse(String(seen[0]!.get("context")))).toEqual(context);

    const bad = vi.fn(async () => Response.json({ error: { code: "too_large", message: "Audio is over 60 seconds" } }, { status: 413 }));
    await expect(uploadVoice(new Blob(["a"]), context, bad as typeof fetch)).rejects.toThrow("Audio is over 60 seconds");
  });
});
