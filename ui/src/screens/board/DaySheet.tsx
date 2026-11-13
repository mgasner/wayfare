import { Car, Check, ChevronRight, MapPin, Moon, RefreshCw, Sun, Trash2, TriangleExclamationPoint, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Meal, PlaceCard, TripView } from "../../../../shared/records";
import { AddToTripSheet } from "../../components/AddToTripSheet";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { Stale } from "../../components/Stale";
import { STATUS_LABEL, STATUS_TONE } from "../../components/StatusChip";
import { SwipePager } from "../../components/SwipePager";
import { mealHour, timesFor } from "../../data/availability";
import { hours, kindLabel, priceUsd } from "../../data/facts";
import { useRefreshSlots, useRemoveMeal, useSetMeal, useTravelMinutes } from "../../data/hooks";
import { dayLabel, dayOfMonth, time12, weekday } from "../../lib/dates";
import { Link } from "../../lib/router";
import { FAR_HOP_MIN, type Cell, type Row } from "./board";

export function DaySheet({ view, rows, day, onDay }: { view: TripView; rows: Row[]; day: string | null; onDay: (d: string | null) => void }) {
  const index = Math.max(0, rows.findIndex((r) => r.date === day));
  const row = rows[index];
  return (
    <Sheet open={!!day && !!row} onClose={() => onDay(null)} label={row ? dayLabel(row.date) : "Day"} height="tall">
      {row && (
        <div className="day-sheet">
          <div className="day-head">
            <h2 className="display">{dayLabel(row.date)}</h2>
            <span className="status-chip tone-open">Day {index + 1}</span>
            <button type="button" className="round-btn" aria-label="Close" onClick={() => onDay(null)}>
              <X size={18} />
            </button>
          </div>
          <div className="day-strip">
            {rows.map((r) => (
              <button key={r.date} type="button" className={`day-pip${r.date === row.date ? " on" : ""}`} onClick={() => onDay(r.date)} aria-label={dayLabel(r.date)}>
                <span className="num">{dayOfMonth(r.date)}</span>
                <span className="pips">
                  <i className={`pip pip-${STATUS_TONE[r.lunch.status]}`} />
                  <i className={`pip pip-${STATUS_TONE[r.dinner.status]}`} />
                </span>
              </button>
            ))}
          </div>
          <SwipePager index={index} onIndexChange={(i) => onDay(rows[i]!.date)} label="Trip days" className="day-pager">
            {rows.map((r, i) => (Math.abs(i - index) <= 1 ? <DayView key={r.date} view={view} row={r} /> : <div key={r.date} />))}
          </SwipePager>
          <div className="muted day-hint">Swipe sideways for {rows[index + 1] ? `${weekday(rows[index + 1]!.date)} ${dayOfMonth(rows[index + 1]!.date)}` : "the day before"} · drag down to close</div>
        </div>
      )}
    </Sheet>
  );
}

function DayView({ view, row }: { view: TripView; row: Row }) {
  const anchors = view.anchors.filter((a) => a.date === row.date).sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
  const areaName = (id: string | null) => view.areas.find((a) => a.id === id)?.name ?? null;
  return (
    <div className="day-view">
      {anchors.map((a) => (
        <div key={a.id} className="tl-anchor">
          <span className="tl-time num">{a.start_time ? time12(a.start_time).replace(":00", "") : ""}</span>
          <span className="tl-anchor-body">
            <MapPin size={14} />
            <span>
              <b>{areaName(a.area) ?? a.text ?? "Plan"}</b>
              {a.start_time && a.end_time ? ` until ${time12(a.end_time).replace(":00", "")}` : ""}
              {a.source === "calendar" ? " · calendar" : ""}
            </span>
          </span>
        </div>
      ))}
      <Slot view={view} cell={row.lunch} />
      {row.hop !== null && (
        <div className={`tl-hop${row.hop >= FAR_HOP_MIN ? " far" : ""}`}>
          <Car size={15} /> {row.hop} min between lunch and dinner{row.hop >= FAR_HOP_MIN ? ", a long ride" : ""}
        </div>
      )}
      <Slot view={view} cell={row.dinner} />
      <Link to={`/discover?day=${row.date}&meal=dinner`} className="day-more">
        More places for {weekday(row.date)} <ChevronRight size={16} />
      </Link>
    </div>
  );
}

function Slot({ view, cell }: { view: TripView; cell: Cell }) {
  const time = cell.meal?.time ?? mealHour(cell.slot);
  return (
    <div className="tl-item">
      <span className="tl-time num">
        {cell.slot === "lunch" ? <Sun size={14} /> : <Moon size={14} />}
        {cell.meal?.time ? time12(cell.meal.time) : ""}
      </span>
      <div className="tl-body">{cell.meal && cell.status !== "failed" ? <MealCard view={view} cell={cell} /> : <OpenCard view={view} cell={cell} time={time} />}</div>
    </div>
  );
}

const STATUS_ACTIONS: Meal["status"][] = ["confirmed", "requested", "waitlist", "failed"];

function MealCard({ view, cell }: { view: TripView; cell: Cell }) {
  const meal = cell.meal!;
  const place = cell.place;
  const setMeal = useSetMeal();
  const remove = useRemoveMeal();
  const [edit, setEdit] = useState(false);
  const travel = useTravelMinutes({ trip: view.trip.id, date: cell.date, time: meal.time ?? mealHour(cell.slot), places: [meal.place] });
  const mins = travel.data?.minutes[meal.place];
  const h = place ? hours(place) : null;
  const set = (status: Meal["status"]) => {
    const { updated_at: _u, ...rest } = meal;
    setMeal.mutate({ ...rest, status });
  };
  return (
    <div className={`meal-card tone-bar-${STATUS_TONE[cell.status]}`}>
      <div className="meal-card-top">
        <Link to={`/place/${meal.place}`} className="meal-name">
          {place?.name ?? meal.place}
        </Link>
        <span className={`status-chip status-chip-sm tone-${STATUS_TONE[cell.status]}`}>{STATUS_LABEL[cell.status]}</span>
      </div>
      <div className="muted meal-meta">
        {[view.areas.find((a) => a.id === place?.area)?.name, mins != null ? `${mins} min from where you'll be` : null, place ? kindLabel(place.kind) : null].filter(Boolean).join(" · ")}
      </div>
      {h && (
        <div className="muted meal-meta">
          {h.text.split(/[.;]/)[0]} <Stale at={h.fact.checked_at} field="hours" />
        </div>
      )}
      {meal.note && <div className="meal-note">{meal.note}</div>}
      {cell.conflict && (
        <div className="meal-conflict">
          <TriangleExclamationPoint size={14} /> Overlaps {cell.conflict.label}, {cell.conflict.estimated ? "about " : ""}
          {cell.conflict.minutes} min away
        </div>
      )}
      <div className="meal-actions">
        {STATUS_ACTIONS.filter((s) => s !== meal.status).map((s) => (
          <Button key={s} size="sm" variant={s === "confirmed" ? "primary" : "outline"} icon={s === "confirmed" ? <Check size={14} /> : undefined} onClick={() => set(s)} disabled={setMeal.isPending}>
            {s === "confirmed" ? "Mark booked" : STATUS_LABEL[s]}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
          Change
        </Button>
        <Button size="sm" variant="ghost" iconOnly aria-label="Remove meal" onClick={() => remove.mutate({ id: meal.id })}>
          <Trash2 size={15} />
        </Button>
      </div>
      {place && <AddToTripSheet open={edit} onClose={() => setEdit(false)} place={place} trip={view} meal={meal} />}
    </div>
  );
}

function OpenCard({ view, cell, time }: { view: TripView; cell: Cell; time: string }) {
  const travel = useTravelMinutes({ trip: view.trip.id, date: cell.date, time, places: cell.openPlaces.map((p) => p.id) });
  const mins = travel.data?.minutes ?? {};
  const options = [...cell.openPlaces].sort((a, b) => (mins[a.id] ?? 999) - (mins[b.id] ?? 999)).slice(0, 3);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => setPick(options[0]?.id ?? null), [options[0]?.id]);
  const chosen = options.find((p) => p.id === pick) ?? null;
  const firstTime = (p: PlaceCard) => timesFor(p, cell.date, cell.slot).times.find((t) => t >= time) ?? timesFor(p, cell.date, cell.slot).times[0] ?? null;
  const setMeal = useSetMeal();
  const refresh = useRefreshSlots();
  const [refreshing, setRefreshing] = useState(false);
  const recheck = async () => {
    setRefreshing(true);
    await Promise.all(options.map((p) => refresh.mutateAsync({ place: p.id, dates: [cell.date], party: view.trip.party }))).finally(() => setRefreshing(false));
  };
  const add = () => {
    if (!chosen) return;
    setMeal.mutate({ trip: view.trip.id, place: chosen.id, date: cell.date, slot: cell.slot, time: firstTime(chosen), status: "want", channel: chosen.channels[0]?.type ?? null, note: null });
  };
  return (
    <div className="open-card">
      <div className="open-card-top">
        <b>
          {cell.slot === "lunch" ? "Lunch" : "Dinner"} is open{cell.status === "failed" && cell.place ? ` (${cell.place.name} failed)` : ""}
        </b>
        {cell.checkedAt && <Stale at={cell.checkedAt} label="slots" pending={refreshing} />}
      </div>
      {options.length === 0 ? (
        <div className="muted">No live tables. Walk-ins and saved places work here.</div>
      ) : (
        <>
          <div className="open-options">
            {options.map((p) => {
              const t = timesFor(p, cell.date, cell.slot);
              const ft = firstTime(p);
              const price = priceUsd(p);
              return (
                <button key={p.id} type="button" className={`open-opt${p.id === pick ? " on" : ""}`} onClick={() => setPick(p.id)}>
                  <b className="trunc">{p.name}</b>
                  <b className="num">{ft ? time12(ft, { short: true }) : ""}</b>
                  <span className="muted">
                    {t.times.length} times{mins[p.id] != null ? ` · ${mins[p.id]} min` : ""}
                    {price ? ` · US$${price}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="open-actions">
            <Button variant="accent" className="grow" disabled={!chosen || setMeal.isPending} onClick={add}>
              {chosen && firstTime(chosen) ? `Add ${time12(firstTime(chosen)!)}` : "Add"}
            </Button>
            <Button icon={<RefreshCw size={15} />} onClick={recheck} disabled={refreshing}>
              Recheck
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
