import { ArrowUp, Mic, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { Change, InputContext, InterpretResult } from "../../../shared/actions.js";
import type { Anchor, Fact, Meal, Save, Trip } from "../../../shared/records";
import { useInterpret, useUndo } from "../data/hooks";
import { dayLabel, time12 } from "../lib/dates";
import { useRecorder } from "../voice/index.js";
import { useToast } from "./Toast";

export interface VoiceInputProps {
  /** Where the input happens; sent as the interpretation context. */
  intent: InputContext;
  onChanges?: (changes: Change[]) => void;
  placeholder?: string;
  /** Names for place ids in the confirmation toast. */
  placeName?: (id: string) => string;
  areaName?: (id: string) => string;
}

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

/**
 * Free-form input: type, or hold the mic. The result shows as the changed records in place
 * plus a toast with Undo; how the input was read is never shown.
 */
export function VoiceInput({ intent, onChanges, placeholder = "Say or type a plan, a tip, a correction", placeName = (x) => x, areaName = (x) => x }: VoiceInputProps) {
  const [text, setText] = useState("");
  const interpret = useInterpret();
  const undo = useUndo();
  const toast = useToast();

  const done = (r: InterpretResult) => {
    onChanges?.(r.changes);
    if (!r.changes.length || !r.undo) {
      toast({ text: "Nothing to change. Try naming a day, a place or an area." });
      return;
    }
    toast({
      text: describeChanges(r.changes, placeName, areaName),
      action: { label: "Undo", run: () => undo.mutateAsync({ undo: r.undo, changes: r.changes }).then(() => onChanges?.([])) },
    });
  };

  const rec = useRecorder({ context: intent, onResult: (r) => done(r) });
  useEffect(() => {
    if (rec.error) toast({ text: rec.error });
  }, [rec.error, toast]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || interpret.isPending) return;
    try {
      const r = await interpret.mutateAsync({ text: t, context: intent });
      setText("");
      done(r);
    } catch (err) {
      toast({ text: err instanceof Error ? err.message : "Could not read that" });
    }
  };

  const recording = rec.state === "recording" || rec.state === "starting";
  const busy = rec.state === "uploading" || interpret.isPending;
  return (
    <form className={`voice${recording ? " recording" : ""}`} onSubmit={submit}>
      {recording ? (
        <span className="voice-live num" aria-live="polite">
          <i className="voice-dot" /> {clock(rec.elapsedMs)} / {clock(rec.maxMs)} · release to send
        </span>
      ) : (
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={busy ? "Working…" : placeholder} aria-label="Type a plan, tip or correction" enterKeyHint="send" disabled={busy} />
      )}
      {recording && (
        <button type="button" className="voice-btn cancel" aria-label="Cancel recording" onClick={rec.cancel}>
          <X size={18} />
        </button>
      )}
      {text.trim() && !recording ? (
        <button type="submit" className="voice-btn send" aria-label="Send" disabled={busy}>
          <ArrowUp size={20} />
        </button>
      ) : (
        <button
          type="button"
          className="voice-btn mic"
          aria-label={rec.supported ? "Hold to talk" : "Recording is not supported in this browser"}
          title={rec.supported ? "Hold to talk" : "Recording is not supported in this browser"}
          disabled={!rec.supported || busy}
          {...rec.bind}
        >
          <Mic size={20} />
        </button>
      )}
    </form>
  );
}

const hm = (t: string | null) => (t ? time12(t).replace(":00", "") : null);

export function describeChanges(changes: Change[], placeName: (id: string) => string, areaName: (id: string) => string): string {
  const parts = changes.map((c) => {
    const verb = c.op === "created" ? "Added" : c.op === "updated" ? "Updated" : "Removed";
    switch (c.kind) {
      case "anchor": {
        const a = c.record as Anchor;
        const where = a.area ? areaName(a.area) : a.place ? placeName(a.place) : (a.text ?? "a plan");
        const when = [a.start_time && a.end_time ? `${hm(a.start_time)} to ${hm(a.end_time)}` : hm(a.start_time)].filter(Boolean).join("");
        return `${verb} ${where}, ${dayLabel(a.date).slice(0, 3)}${when ? ` ${when}` : ""}`;
      }
      case "save":
        return c.op === "deleted" ? `Removed ${placeName((c.record as Save).place)} from saved` : `Saved ${placeName((c.record as Save).place)}`;
      case "fact": {
        const f = c.record as Fact;
        return `Noted ${f.field.replace("_", " ")} for ${placeName(f.place)}, visible to you`;
      }
      case "meal": {
        const m = c.record as Meal;
        return `${verb} ${placeName(m.place)} on ${dayLabel(m.date)}`;
      }
      case "trip":
        return `Updated the trip${(c.record as Partial<Trip>).base ? " base" : ""}`;
    }
  });
  return parts.join(" · ");
}
