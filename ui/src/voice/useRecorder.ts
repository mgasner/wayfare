import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { InputContext, VoiceResult } from "../../../shared/actions.js";
import { browserDeps, MAX_MS, Recorder, recordingSupported, type RecorderDeps, type RecorderState } from "./recorder.js";

export type UseRecorderOptions = {
  /** Read at press time, so it can follow the screen. */
  context: InputContext;
  onResult(result: VoiceResult): void;
  deps?: RecorderDeps;
};

export type UseRecorder = {
  state: RecorderState;
  error: string | null;
  elapsedMs: number;
  maxMs: number;
  supported: boolean;
  start(): void;
  stop(): void;
  cancel(): void;
  /** Spread on the mic button for hold-to-talk by pointer, Space or Enter. */
  bind: {
    onPointerDown(e: { preventDefault(): void; currentTarget: Element; pointerId: number }): void;
    onPointerUp(): void;
    onPointerCancel(): void;
    onContextMenu(e: { preventDefault(): void }): void;
    onKeyDown(e: { key: string; repeat: boolean; preventDefault(): void }): void;
    onKeyUp(e: { key: string }): void;
  };
};

export function useRecorder({ context, onResult, deps }: UseRecorderOptions): UseRecorder {
  const latest = useRef({ context, onResult });
  latest.current = { context, onResult };

  const [recorder] = useState(() => new Recorder(deps ?? browserDeps(), (r) => latest.current.onResult(r)));
  useEffect(() => () => recorder.cancel(), [recorder]);

  const snapshot = useSyncExternalStore(
    (l) => recorder.subscribe(l),
    () => recorder.current,
  );

  const [now, setNow] = useState(0);
  useEffect(() => {
    if (snapshot.state !== "recording") return;
    let frame = requestAnimationFrame(function tick() {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot.state]);

  const start = () => void recorder.start(latest.current.context);
  const stop = () => recorder.stop();
  const cancel = () => recorder.cancel();
  const holdKey = (key: string) => key === " " || key === "Enter";

  return {
    state: snapshot.state,
    error: snapshot.error,
    elapsedMs: snapshot.startedAt === null ? 0 : Math.min(MAX_MS, Math.max(0, now - snapshot.startedAt)),
    maxMs: MAX_MS,
    supported: deps !== undefined || recordingSupported(),
    start,
    stop,
    cancel,
    bind: {
      onPointerDown(e) {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start();
      },
      onPointerUp: stop,
      onPointerCancel: cancel,
      onContextMenu: (e) => e.preventDefault(),
      onKeyDown(e) {
        if (!holdKey(e.key) || e.repeat) return;
        e.preventDefault();
        start();
      },
      onKeyUp(e) {
        if (holdKey(e.key)) stop();
      },
    },
  };
}
