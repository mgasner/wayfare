import { Clock, RefreshCw } from "lucide-react";
import { ageMs, formatAge, isStale, type FreshnessField } from "../../../shared/freshness";
import { useNow } from "../lib/time";

export interface StaleProps {
  /** checked_at of the value next to this marker. */
  at: string;
  /** Which freshness window applies. Defaults to slots. */
  field?: FreshnessField;
  /** Text before the age, e.g. "slots" -> "slots 2 h ago". */
  label?: string;
  /** "2 h" instead of "2 h ago", for grid cells. */
  compact?: boolean;
  /** Show the age even while the value is fresh. */
  always?: boolean;
  /** Makes the marker a button that runs a live read. */
  onRecheck?: () => void;
  pending?: boolean;
  now?: number;
}

/** The amber clock with an age, shown next to a value older than its freshness window. */
export function Stale({ at, field = "slots", label, compact, always, onRecheck, pending, now: nowProp }: StaleProps) {
  const ticking = useNow();
  const now = nowProp ?? ticking;
  const stale = isStale(field, at, now);
  if (!stale && !always && !pending) return null;
  const age = formatAge(ageMs(at, now));
  const text = `${label ? `${label} ` : ""}${compact ? age.replace(" min", "m") : `${age} ago`}`;
  const title = `Checked ${new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  const icon = pending ? <RefreshCw className="stale-spin" size={12} strokeWidth={2.2} aria-hidden /> : <Clock size={12} strokeWidth={2.2} aria-hidden />;
  const cls = `stale${stale ? "" : " stale-fresh"}${compact ? " stale-compact" : ""}`;
  if (onRecheck) {
    return (
      <button
        type="button"
        className={`${cls} stale-btn`}
        title={`${title}. Tap to recheck.`}
        aria-label={`${text}. Recheck`}
        disabled={pending}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onRecheck();
        }}
      >
        {icon}
        <span>{pending ? "checking" : text}</span>
      </button>
    );
  }
  return (
    <span className={cls} title={title}>
      {icon}
      <span>{text}</span>
    </span>
  );
}
