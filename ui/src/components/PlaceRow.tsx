import { Bookmark, BookmarkCheck } from "lucide-react";
import type { Meal, PlaceCard } from "../../../shared/records";
import type { Summary } from "../data/availability";
import { mealWhen } from "../data/availability";
import { hours, notes, primaryChannel, priceUsd, slotsCheckedAt, tierLabel } from "../data/facts";
import { time12 } from "../lib/dates";
import { Link } from "../lib/router";
import { Stale } from "./Stale";
import { STATUS_LABEL, StatusChip } from "./StatusChip";

const TIER_TONE: Record<string, string> = {
  "destination-tasting": "accent",
  "fine-dining": "warn",
  "upscale-a-la-carte": "info",
  "off-the-beaten-path": "casual",
};

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\s]/gu, "").split(/\s+/).filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚ]/.test(w));
  const w = words.filter((x) => !/^(la|el|de|del|restaurante|cocina)$/i.test(x));
  const pick = w.length >= 2 && w[0]!.length <= 3 ? w[0]![0]! + w[1]![0]! : (w[0] ?? name).slice(0, 2);
  return pick.charAt(0).toUpperCase() + pick.slice(1).toLowerCase();
}

export function PlaceAvatar({ place, size = 44 }: { place: PlaceCard; size?: number }) {
  const tone = TIER_TONE[notes(place).tier ?? ""] ?? (place.kind === "reserve_ahead" ? "accent" : place.kind === "bookable" ? "info" : "casual");
  return (
    <span className={`avatar avatar-${tone}`} style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden>
      {initials(place.name)}
    </span>
  );
}

export function TripMealChip({ meal }: { meal: Meal }) {
  const text = meal.status === "confirmed" ? mealWhen(meal) : `${STATUS_LABEL[meal.status]} ${mealWhen(meal).split(" ")[0]}`;
  return (
    <StatusChip status={meal.status} size="sm">
      {text}
    </StatusChip>
  );
}

export interface PlaceRowProps {
  place: PlaceCard;
  areaName?: string;
  minutes?: number | null;
  walk?: boolean;
  meal?: Meal | null;
  summary?: Summary;
  /** Times for the chosen day and meal, when a day filter is on. */
  times?: { times: string[]; waitlist: string[] } | null;
  note?: string | null;
  onToggleSave?: () => void;
  selected?: boolean;
  onHover?: () => void;
}

export function PlaceRow({ place, areaName, minutes, walk, meal, summary, times, note, onToggleSave, selected, onHover }: PlaceRowProps) {
  const price = priceUsd(place);
  const checked = slotsCheckedAt(place);
  const h = hours(place);
  const meta = [areaName, minutes != null ? `${minutes} min${walk ? " walk" : ""}` : null, price ? `US$${price} pp` : null, primaryChannel(place)].filter(Boolean).join(" · ");
  return (
    <div className={`place-row${selected ? " selected" : ""}`} onMouseEnter={onHover}>
      <Link to={`/place/${place.id}`} className="place-row-link">
        <PlaceAvatar place={place} />
        <div className="grow">
          <div className="place-row-top">
            <span className="label place-tier trunc">{tierLabel(place)}</span>
            {meal && <TripMealChip meal={meal} />}
          </div>
          <div className="place-name trunc">{place.name}</div>
          <div className="muted place-meta">{meta}</div>
          {times ? (
            <div className="place-times num">
              {times.times.slice(0, 5).map((t) => (
                <span key={t} className="time-chip">
                  {time12(t, { short: true })}
                </span>
              ))}
              {times.times.length > 5 && <span className="muted">+{times.times.length - 5}</span>}
              {times.times.length === 0 && times.waitlist.length > 0 && <span className="muted">Waitlist only</span>}
              {checked && <Stale at={checked} compact />}
            </div>
          ) : summary ? (
            <div className="place-avail">
              <span className={`dot tone-dot-${summary.tone}`} />
              <span className="trunc">{summary.text}</span>
              {checked ? <Stale at={checked} compact /> : h ? <Stale at={h.fact.checked_at} field="hours" compact /> : null}
            </div>
          ) : null}
          {note && <div className="place-note">“{note}”</div>}
        </div>
      </Link>
      {onToggleSave && (
        <button type="button" className={`save-btn${place.saved ? " on" : ""}`} aria-pressed={place.saved} aria-label={place.saved ? `Remove ${place.name} from saved` : `Save ${place.name}`} onClick={onToggleSave}>
          {place.saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
        </button>
      )}
    </div>
  );
}
