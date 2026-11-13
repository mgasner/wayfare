import { Bell, BellOff, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import type { PlaceCard, Save } from "../../../../shared/records";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { useUpdateSave } from "../../data/hooks";

/** Under a saved place: the nearby alert toggle and the note editor. */
export function SaveOptions({ save, place }: { save: Save; place: PlaceCard }) {
  const update = useUpdateSave();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const fail = () => toast({ text: `Could not update ${place.name}` });
  return (
    <div className="save-opts">
      <button
        type="button"
        className={`save-opt${save.notify_nearby ? " on" : ""}`}
        aria-pressed={save.notify_nearby}
        aria-label={`Tell me when I'm near ${place.name}`}
        onClick={() => update.mutate({ place: place.id, notify_nearby: !save.notify_nearby }, { onError: fail })}
      >
        {save.notify_nearby ? <Bell size={14} /> : <BellOff size={14} />}
        {save.notify_nearby ? "Nearby alert on" : "Nearby alert off"}
      </button>
      <button type="button" className="save-opt" onClick={() => setEditing(true)} aria-label={`${save.note ? "Edit" : "Add"} note for ${place.name}`}>
        <Pencil size={14} />
        {save.note ? "Edit note" : "Add note"}
      </button>
      <NoteSheet open={editing} onClose={() => setEditing(false)} save={save} place={place} onSave={(note) => update.mutate({ place: place.id, note }, { onError: fail })} />
    </div>
  );
}

function NoteSheet({ open, onClose, save, place, onSave }: { open: boolean; onClose: () => void; save: Save; place: PlaceCard; onSave: (note: string | null) => void }) {
  const [text, setText] = useState(save.note ?? "");
  useEffect(() => {
    if (open) setText(save.note ?? "");
  }, [open, save.note]);
  const submit = (note: string | null) => {
    onSave(note);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} label={`Note for ${place.name}`}>
      <form
        className="note-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text.trim() || null);
        }}
      >
        <div className="display add-title">Note</div>
        <div className="muted">{place.name}</div>
        <textarea autoFocus value={text} maxLength={500} rows={4} onChange={(e) => setText(e.target.value)} placeholder="Who told you, what to order, when to go" aria-label="Note" />
        <div className="row note-sheet-actions">
          {save.note && (
            <Button size="lg" onClick={() => submit(null)}>
              Clear
            </Button>
          )}
          <Button type="submit" variant="primary" size="lg" className="grow">
            Save note
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
