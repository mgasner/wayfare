import type { InputContext, VoiceResult } from "../../../shared/actions.js";

export const MAX_MS = 60_000;
/** Shorter holds are taps on the mic, not speech. */
export const MIN_MS = 400;
const BITS_PER_SECOND = 64_000;

export type RecorderState = "idle" | "starting" | "recording" | "uploading" | "error";

export type Snapshot = { state: RecorderState; startedAt: number | null; error: string | null };

type MediaRecorderLike = {
  readonly mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(): void;
  stop(): void;
};

export type RecorderDeps = {
  getUserMedia(): Promise<MediaStream>;
  createRecorder(stream: MediaStream, mimeType: string | undefined): MediaRecorderLike;
  isTypeSupported(type: string): boolean;
  upload(audio: Blob, context: InputContext): Promise<VoiceResult>;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** iOS and desktop Safari, which get MP4/AAC. */
  safari: boolean;
};

/** The container to record: WebM/Opus where it works, MP4/AAC on Safari, else the browser's default. */
export function pickMime(isTypeSupported: (t: string) => boolean, safari: boolean): string | undefined {
  // Safari's WebM recording is recent and has shipped bugs; its MP4/AAC path is the long-standing one.
  const order = safari
    ? ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return order.find((t) => isTypeSupported(t));
}

export function isSafari(userAgent: string): boolean {
  return /iP(hone|ad|od)/.test(userAgent) || (/Safari\//.test(userAgent) && !/Chrome|Chromium|Android|CriOS|FxiOS|Edg/.test(userAgent));
}

/** Hold-to-talk: `start` on press, `stop` on release. Stops by itself at MAX_MS and uploads. */
export class Recorder {
  private snapshot: Snapshot = { state: "idle", startedAt: null, error: null };
  private listeners = new Set<(s: Snapshot) => void>();
  private stream: MediaStream | null = null;
  private recorder: MediaRecorderLike | null = null;
  private chunks: Blob[] = [];
  private cap: unknown = null;
  private released = false;
  private discard = false;
  private context: InputContext = { screen: "" };

  constructor(
    private deps: RecorderDeps,
    private onResult: (result: VoiceResult) => void,
  ) {}

  get current(): Snapshot {
    return this.snapshot;
  }

  subscribe(listener: (s: Snapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const l of this.listeners) l(this.snapshot);
  }

  async start(context: InputContext): Promise<void> {
    if (this.snapshot.state === "starting" || this.snapshot.state === "recording" || this.snapshot.state === "uploading") return;
    this.context = context;
    this.released = false;
    this.discard = false;
    this.chunks = [];
    this.set({ state: "starting", startedAt: null, error: null });
    let stream: MediaStream;
    try {
      stream = await this.deps.getUserMedia();
    } catch (error) {
      this.set({ state: "error", error: error instanceof Error && error.name === "NotAllowedError" ? "Microphone access is off" : "No microphone" });
      return;
    }
    // Released while the permission prompt was up: nothing was said.
    if (this.released) {
      stopTracks(stream);
      this.set({ state: "idle" });
      return;
    }
    this.stream = stream;
    const mime = pickMime(this.deps.isTypeSupported, this.deps.safari);
    let recorder: MediaRecorderLike;
    try {
      recorder = this.deps.createRecorder(stream, mime);
    } catch {
      this.release();
      this.set({ state: "error", error: "This browser can't record audio" });
      return;
    }
    this.recorder = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    recorder.onstop = () => void this.finish(recorder.mimeType || mime || "audio/webm");
    recorder.start();
    this.set({ state: "recording", startedAt: this.deps.now() });
    this.cap = this.deps.setTimeout(() => this.stop(), MAX_MS);
  }

  /** Release: uploads what was said, or drops a tap. */
  stop(): void {
    this.released = true;
    if (this.snapshot.state !== "recording" || !this.recorder) return;
    const held = this.deps.now() - (this.snapshot.startedAt ?? 0);
    if (held < MIN_MS) this.discard = true;
    this.recorder.stop();
  }

  cancel(): void {
    this.released = true;
    this.discard = true;
    if (this.recorder && this.snapshot.state === "recording") this.recorder.stop();
    else if (this.snapshot.state === "error") this.set({ state: "idle", error: null });
  }

  private release() {
    if (this.cap !== null) this.deps.clearTimeout(this.cap);
    this.cap = null;
    if (this.stream) stopTracks(this.stream);
    this.stream = null;
    this.recorder = null;
  }

  private async finish(mime: string) {
    this.release();
    const audio = new Blob(this.chunks, { type: mime.split(";")[0] });
    this.chunks = [];
    if (this.discard || audio.size === 0) {
      this.set({ state: "idle", startedAt: null });
      return;
    }
    this.set({ state: "uploading", startedAt: null });
    try {
      const result = await this.deps.upload(audio, this.context);
      this.set({ state: "idle" });
      this.onResult(result);
    } catch (error) {
      this.set({ state: "error", error: error instanceof Error ? error.message : "Upload failed" });
    }
  }
}

function stopTracks(stream: MediaStream) {
  for (const t of stream.getTracks()) t.stop();
}

/** POSTs a clip to /api/voice. */
export async function uploadVoice(audio: Blob, context: InputContext, fetchImpl: typeof fetch = fetch): Promise<VoiceResult> {
  const form = new FormData();
  const ext = /mp4|aac/.test(audio.type) ? "m4a" : /ogg/.test(audio.type) ? "ogg" : "webm";
  form.set("audio", audio, `voice.${ext}`);
  form.set("context", JSON.stringify(context));
  const res = await fetchImpl("/api/voice", { method: "POST", body: form, credentials: "same-origin" });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? `Upload failed (${res.status})`);
  }
  return data as VoiceResult;
}

/** The browser's implementations. */
export function browserDeps(): RecorderDeps {
  return {
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }),
    createRecorder: (stream, mimeType) =>
      new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: BITS_PER_SECOND }) as unknown as MediaRecorderLike,
    isTypeSupported: (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
    upload: (audio, context) => uploadVoice(audio, context),
    now: () => performance.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (h) => window.clearTimeout(h as number),
    safari: isSafari(navigator.userAgent),
  };
}

export function recordingSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}
