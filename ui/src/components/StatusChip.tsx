import type { Meal } from "../../../shared/records";

export type MealStatus = Meal["status"];
export type CellStatus = MealStatus | "open";

/** Tone per status. The same tones color board cells, chips and map pin rings. */
export const STATUS_TONE: Record<CellStatus, "ok" | "warn" | "info" | "danger" | "casual" | "muted" | "open"> = {
  confirmed: "ok",
  requested: "warn",
  waitlist: "info",
  failed: "danger",
  want: "casual",
  skipped: "muted",
  open: "open",
};

export const STATUS_LABEL: Record<CellStatus, string> = {
  confirmed: "Booked",
  requested: "Requested",
  waitlist: "Waitlist",
  failed: "Failed",
  want: "Want",
  skipped: "Skipped",
  open: "Open",
};

export function StatusChip({ status, children, size = "md" }: { status: CellStatus; children?: React.ReactNode; size?: "sm" | "md" }) {
  return <span className={`status-chip tone-${STATUS_TONE[status]} status-chip-${size}`}>{children ?? STATUS_LABEL[status]}</span>;
}

/** "3 booked · 2 pending · 1 waitlist · 7 open" as chips. */
export function StatusTally({ counts }: { counts: Partial<Record<CellStatus, number>> }) {
  const order: [CellStatus, string][] = [
    ["confirmed", "booked"],
    ["requested", "requested"],
    ["waitlist", "waitlist"],
    ["failed", "failed"],
    ["want", "want"],
    ["open", "open"],
  ];
  return (
    <div className="status-tally">
      {order
        .filter(([s]) => (counts[s] ?? 0) > 0)
        .map(([s, word]) => (
          <StatusChip key={s} status={s}>
            <span className="num">{counts[s]}</span> {word}
          </StatusChip>
        ))}
    </div>
  );
}
