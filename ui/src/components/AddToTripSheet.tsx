import { useEffect, useState } from "react";
import type { Meal, PlaceCard, TripView } from "../../../shared/records";
import { slotOfTime, timesFor, type MealSlot } from "../data/availability";
import { useSetMeal } from "../data/hooks";
import { dateRange, dayLabel, dayOfMonth, time12, weekday } from "../lib/dates";
import { Button } from "./Button";
import { Segmented } from "./Controls";
import { Sheet } from "./Sheet";
import { STATUS_LABEL } from "./StatusChip";
import { useToast } from "./Toast";

export interface AddInitial {
  date?: string;
  slot?: MealSlot;
  time?: string | null;
  status?: Meal["status"];
}

const STATUSES: Meal["status"][] = ["want", "requested", "waitlist", "confirmed"];

/** Pick day, meal, time and status, then meals.set. Also edits an existing meal. */
export function AddToTripSheet({ open, onClose, place, trip, initial, meal }: { open: boolean; onClose: () => void; place: PlaceCard; trip: TripView; initial?: AddInitial; meal?: Meal | null }) {
  const days = dateRange(trip.trip.start_date, trip.trip.end_date);
  const [date, setDate] = useState(days[0]!);
  const [slot, setSlot] = useState<MealSlot>("dinner");
  const [time, setTime] = useState<string | null>(null);
  const [status, setStatus] = useState<Meal["status"]>("want");
  const setMeal = useSetMeal();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setDate(meal?.date ?? initial?.date ?? days[0]!);
    setSlot(meal ? (meal.slot === "lunch" ? "lunch" : "dinner") : (initial?.slot ?? (initial?.time ? slotOfTime(initial.time) : "dinner")));
    setTime(meal?.time ?? initial?.time ?? null);
    setStatus(meal?.status ?? initial?.status ?? "want");
    // Reset only when the sheet opens.
  }, [open]);

  const t = timesFor(place, date, slot);
  const other = trip.meals.find((m) => m.date === date && m.slot === slot && m.place !== place.id && m.status !== "skipped");
  const otherName = other ? (trip.places.find((p) => p.id === other.place)?.name ?? "another place") : null;

  const save = async () => {
    await setMeal.mutateAsync({
      ...(meal ? { id: meal.id } : {}),
      trip: trip.trip.id,
      place: place.id,
      date,
      slot,
      time,
      status,
      channel: meal?.channel ?? place.channels[0]?.type ?? null,
      note: meal?.note ?? null,
    });
    toast({ text: `${place.name}: ${STATUS_LABEL[status].toLowerCase()}, ${dayLabel(date)} ${time ? time12(time) : slot}` });
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} label={`Add ${place.name} to the trip`}>
      <div className="add-sheet">
        <div className="display add-title">{meal ? "Change meal" : "Add to trip"}</div>
        <div className="muted">{place.name}</div>
        <div className="add-days">
          {days.map((d) => {
            const has = trip.meals.some((m) => m.date === d && m.slot === slot && m.status !== "skipped");
            return (
              <button key={d} type="button" className={`add-day${d === date ? " on" : ""}`} onClick={() => setDate(d)}>
                <span className="muted">{weekday(d)}</span>
                <span className="num">{dayOfMonth(d)}</span>
                {has && <i />}
              </button>
            );
          })}
        </div>
        <Segmented
          label="Meal"
          value={slot}
          onChange={(v) => {
            setSlot(v);
            setTime(null);
          }}
          options={[
            { value: "lunch", label: "Lunch" },
            { value: "dinner", label: "Dinner" },
          ]}
        />
        <div className="add-times">
          <button type="button" className={`time-chip${time === null ? " on" : ""}`} onClick={() => setTime(null)}>
            Any time
          </button>
          {t.times.map((x) => (
            <button key={x} type="button" className={`time-chip num${time === x ? " on" : ""}`} onClick={() => setTime(x)}>
              {time12(x, { short: true })}
            </button>
          ))}
          {t.times.length === 0 && t.waitlist.length > 0 && <span className="muted">Waitlist only</span>}
        </div>
        <div className="label muted">Status</div>
        <Segmented label="Status" value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: s === "confirmed" ? "Booked" : STATUS_LABEL[s] }))} />
        {otherName && (
          <div className="note">
            <span>
              You already have {otherName} for {weekday(date)} {slot}.
            </span>
          </div>
        )}
        <Button variant="primary" size="lg" block disabled={setMeal.isPending} onClick={save}>
          {meal ? "Save" : `Add ${weekday(date)} ${time ? time12(time) : slot}`}
        </Button>
      </div>
    </Sheet>
  );
}
