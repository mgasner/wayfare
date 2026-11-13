import { Car, Clock, Hand, Moon, Pencil, Plus, Sun, TriangleExclamationPoint, Utensils } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { Stale } from "../../components/Stale";
import { STATUS_TONE, StatusTally } from "../../components/StatusChip";
import { mealWhen } from "../../data/availability";
import { useConflicts, usePlaces } from "../../data/hooks";
import { shellTrip, tripKicker, useTripView } from "../../data/trip";
import { dayOfMonth, time12, weekday } from "../../lib/dates";
import { Link, useLocation, useNavigate } from "../../lib/router";
import { buildBoard, FAR_HOP_MIN, showClosures, spend, tally, type Cell, type Row } from "./board";
import { DaySheet } from "./DaySheet";
import "./board.css";

export function Board() {
  const { view, isLoading } = useTripView();
  const places = usePlaces(view ? { city: view.city.id, trip: view.trip.id } : null);
  const conflicts = useConflicts(view?.trip.id ?? null);
  const rows = useMemo(() => (view ? buildBoard(view, places.data ?? [], conflicts.data ?? []) : []), [view, places.data, conflicts.data]);
  const { query } = useLocation();
  const navigate = useNavigate();
  const day = query.get("day");
  const open = (d: string | null) => navigate(d ? `/trip?day=${d}` : "/trip", { replace: !!day && !!d });

  if (!view) {
    return (
      <AppShell>
        <div className="empty">
          {isLoading ? (
            <span className="muted">Loading…</span>
          ) : (
            <>
              <h1 className="display screen-title">No trip yet</h1>
              <p className="muted">Set up dates, hotel and appetite in six short pages.</p>
              <Link to="/new" className="btn btn-primary btn-lg" style={{ marginTop: 16 }}>
                <Plus size={18} /> New trip
              </Link>
            </>
          )}
        </div>
      </AppShell>
    );
  }

  const t = tally(rows);
  const s = spend(view);
  return (
    <AppShell trip={shellTrip(view)}>
      <div className="board">
        <header className="board-head">
          <div className="label muted">{tripKicker(view)}</div>
          <div className="board-title-row">
            <h1 className="display screen-title">{view.city.name} meal board</h1>
            <Link to="/trip/edit?step=6" className="btn btn-sm btn-ghost">
              <Pencil size={14} /> Trip
            </Link>
          </div>
          <StatusTally counts={t} />
          <div className="board-spend muted num">
            {s.tastingsWanted !== null && (
              <span>
                Big tastings{" "}
                <b>
                  {s.tastings} of {s.tastingsWanted}
                </b>
              </span>
            )}
            <span>
              Spend <b>US${s.confirmed.toLocaleString("en-US")}</b> booked · about US${s.planned.toLocaleString("en-US")} on board
              {s.budget ? ` · budget US$${s.budget.toLocaleString("en-US")} pp` : ""}
            </span>
            {s.budget ? (
              <span className="board-bar" aria-hidden>
                <i style={{ width: `${Math.min(100, (s.confirmed / s.budget) * 100)}%` }} className="ok" />
                <i style={{ width: `${Math.min(100, ((s.planned - s.confirmed) / s.budget) * 100)}%` }} className="warn" />
              </span>
            ) : null}
          </div>
        </header>

        <MobileGrid rows={rows} onOpen={open} />
        <DesktopBoard rows={rows} onOpen={open} />

        <div className="board-foot muted">
          <Hand size={14} /> Tap a day to zoom in.
          <span className="stale">
            <Clock size={12} strokeWidth={2.2} /> 2 h
          </span>
          = slots last read 2 h ago.
        </div>
      </div>
      <DaySheet view={view} rows={rows} day={day} onDay={open} />
    </AppShell>
  );
}

function cellLine(c: Cell): string {
  if (!c.meal) return "";
  if (c.meal.time) return time12(c.meal.time);
  return c.meal.status === "waitlist" ? `Waitlist, ${c.slot}` : c.slot;
}

function GridCell({ c }: { c: Cell }) {
  if (!c.meal || c.status === "failed") {
    const n = c.openPlaces.length;
    return (
      <span className={`gcell open${c.status === "failed" ? " failed-open" : ""}`}>
        <b>{c.status === "failed" ? `${c.place?.name ?? "Failed"}` : "Open"}</b>
        <span className="gsub">
          {c.status === "failed" ? "Failed · " : ""}
          {n ? `${n} with tables` : "Walk-ins"}
          {c.checkedAt && n > 0 ? <Stale at={c.checkedAt} compact /> : null}
        </span>
      </span>
    );
  }
  return (
    <span className={`gcell tone-cell-${STATUS_TONE[c.status]}`}>
      <b className="trunc">{c.place?.name ?? c.meal.place}</b>
      <span className="gsub trunc">
        {c.conflict && <TriangleExclamationPoint size={12} className="gconflict" aria-label={`${c.conflict.minutes} min from ${c.conflict.label}`} />}
        {cellLine(c)}
        {c.extra.length ? ` +${c.extra.length}` : ""}
      </span>
    </span>
  );
}

function Hop({ r }: { r: Row }) {
  if (r.hop === null) return <span className="ghop muted">·</span>;
  return (
    <span className={`ghop num${r.hop >= FAR_HOP_MIN ? " far" : ""}`}>
      <Car size={14} />
      {r.hop}m
    </span>
  );
}

function MobileGrid({ rows, onOpen }: { rows: Row[]; onOpen: (d: string) => void }) {
  return (
    <div className="grid-m" role="table" aria-label="Meals by day">
      <div className="grid-m-head" role="row">
        <span />
        <span className="label muted">
          <Sun size={14} /> Lunch
        </span>
        <span />
        <span className="label muted">
          <Moon size={14} /> Dinner
        </span>
      </div>
      {rows.map((r) => (
        <button key={r.date} type="button" className="grid-m-row" role="row" onClick={() => onOpen(r.date)} aria-label={`${weekday(r.date)} ${dayOfMonth(r.date)}`}>
          <span className="gday">
            <span className="muted">{weekday(r.date)}</span>
            <b className="num">{dayOfMonth(r.date)}</b>
            {showClosures(r) && (
              <span className="gclosed">
                <TriangleExclamationPoint size={11} /> closures
              </span>
            )}
          </span>
          <GridCell c={r.lunch} />
          <Hop r={r} />
          <GridCell c={r.dinner} />
        </button>
      ))}
    </div>
  );
}

function BoardCell({ c, onOpen }: { c: Cell; onOpen: () => void }) {
  if (!c.meal || c.status === "failed") {
    return (
      <button type="button" className={`bcell open${c.status === "failed" ? " failed-open" : ""}`} onClick={onOpen}>
        <span className="label muted">{c.status === "failed" ? "Failed" : "Open"}</span>
        {c.status === "failed" && <b>{c.place?.name}</b>}
        {c.openPlaces.length ? (
          <span className="bsug">
            <b className="num">{c.openPlaces.length} with tables</b>
            {c.checkedAt && <Stale at={c.checkedAt} compact />}
          </span>
        ) : (
          <span className="muted bsmall">Walk-in or decide that day</span>
        )}
      </button>
    );
  }
  const area = c.place?.area ? c.place.area.replace(/-/g, " ") : "";
  return (
    <button type="button" className={`bcell filled tone-bar-${STATUS_TONE[c.status]}`} onClick={onOpen}>
      <b className="bname">{c.place?.name ?? c.meal.place}</b>
      <span className="btime num">{c.meal.time ? time12(c.meal.time) : mealWhen(c.meal)}</span>
      <span className="muted bsmall bcap">{area}</span>
      {c.meal.note && <span className="muted bsmall">{c.meal.note}</span>}
      {c.conflict && (
        <span className="bconflict bsmall">
          <TriangleExclamationPoint size={12} /> {c.conflict.minutes} min from {c.conflict.label}
        </span>
      )}
      <span className={`bstatus tone-text-${STATUS_TONE[c.status]}`}>
        <Utensils size={12} /> {c.status === "confirmed" ? "Booked" : c.status === "want" ? "Want" : c.status[0]!.toUpperCase() + c.status.slice(1)}
      </span>
    </button>
  );
}

function DesktopBoard({ rows, onOpen }: { rows: Row[]; onOpen: (d: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="board-d" style={{ gridTemplateColumns: `72px repeat(${rows.length}, minmax(0, 1fr))` }} onMouseLeave={() => setHover(null)}>
      <span />
      {rows.map((r, i) => (
        <button key={r.date} type="button" className={`bday${hover === r.date ? " hover" : ""}`} onClick={() => onOpen(r.date)} onMouseEnter={() => setHover(r.date)}>
          <span className="muted">{weekday(r.date)}</span>
          <b className="num">{dayOfMonth(r.date)}</b>
          <span className="bday-note">{showClosures(r) ? "Many closed" : i === 0 ? "Arrive" : i === rows.length - 1 ? "Last day" : ""}</span>
        </button>
      ))}
      <span className="label muted brow">
        <Sun size={14} /> Lunch
      </span>
      {rows.map((r) => (
        <div key={r.date} onMouseEnter={() => setHover(r.date)}>
          <BoardCell c={r.lunch} onOpen={() => onOpen(r.date)} />
        </div>
      ))}
      <span />
      {rows.map((r) => (
        <span key={r.date} className="bhop">
          <Hop r={r} />
        </span>
      ))}
      <span className="label muted brow">
        <Moon size={14} /> Dinner
      </span>
      {rows.map((r) => (
        <div key={r.date} onMouseEnter={() => setHover(r.date)}>
          <BoardCell c={r.dinner} onOpen={() => onOpen(r.date)} />
        </div>
      ))}
      <div className="board-legend muted" style={{ gridColumn: `1 / span ${rows.length + 1}` }}>
        <span className="lg ok">Booked</span>
        <span className="lg warn">Requested</span>
        <span className="lg info">Waitlist</span>
        <span className="lg casual">Want</span>
        <span className="lg danger">Failed</span>
        <span className="grow" />
        <span>Hops are taxi estimates between lunch and dinner.</span>
      </div>
    </div>
  );
}

