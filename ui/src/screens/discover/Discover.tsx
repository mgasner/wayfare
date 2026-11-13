import { CalendarDays, Car, MapPin, Search, Utensils, X } from "lucide-react";
import { useMemo } from "react";
import type { PlaceCard, PlaceKind } from "../../../../shared/records";
import { AppShell } from "../../components/AppShell";
import { Chip } from "../../components/Button";
import { Segmented } from "../../components/Controls";
import { FilterChip } from "../../components/FilterChip";
import { PlaceMap, type MapPoint } from "../../components/PlaceMap";
import { PlaceRow } from "../../components/PlaceRow";
import { availabilitySummary, closedOn, mealHour, timesFor, tripMealFor, type MealSlot } from "../../data/availability";
import { isWalkInKind, kindLabel } from "../../data/facts";
import { isWalk } from "../../data/geo";
import { usePlaces, useToggleSave, useTravelMinutes } from "../../data/hooks";
import { shellTrip, tripKicker, useTripView } from "../../data/trip";
import { dateRange, dayOfMonth, weekday } from "../../lib/dates";
import { useLocation, useNavigate } from "../../lib/router";
import "./discover.css";

const KINDS: PlaceKind[] = ["reserve_ahead", "bookable", "walk_in", "informal"];
const TRAVEL = ["any", "15", "30", "45"] as const;

interface Filters {
  q: string;
  kinds: PlaceKind[];
  meal: "any" | MealSlot;
  day: string;
  area: string;
  max: (typeof TRAVEL)[number];
  view: "list" | "map";
  sel: string;
}

function readFilters(query: URLSearchParams): Filters {
  const meal = query.get("meal");
  const max = query.get("max");
  return {
    q: query.get("q") ?? "",
    kinds: (query.get("kinds") ?? "").split(",").filter((k): k is PlaceKind => (KINDS as string[]).includes(k)),
    meal: meal === "lunch" || meal === "dinner" ? meal : "any",
    day: query.get("day") ?? "any",
    area: query.get("area") ?? "any",
    max: (TRAVEL as readonly string[]).includes(max ?? "") ? (max as Filters["max"]) : "any",
    view: query.get("view") === "map" ? "map" : "list",
    sel: query.get("sel") ?? "",
  };
}

function writeFilters(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.kinds.length) p.set("kinds", f.kinds.join(","));
  if (f.meal !== "any") p.set("meal", f.meal);
  if (f.day !== "any") p.set("day", f.day);
  if (f.area !== "any") p.set("area", f.area);
  if (f.max !== "any") p.set("max", f.max);
  if (f.view === "map") p.set("view", "map");
  if (f.sel) p.set("sel", f.sel);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function Discover() {
  const { query } = useLocation();
  const navigate = useNavigate();
  const f = readFilters(query);
  const set = (patch: Partial<Filters>) => navigate(`/discover${writeFilters({ ...f, ...patch })}`, { replace: true });

  const { view: trip } = useTripView();
  const city = trip?.city.id ?? "lima";
  const base = { city, ...(trip ? { trip: trip.trip.id } : {}), ...(f.area !== "any" ? { area: f.area } : {}), ...(f.q ? { q: f.q } : {}) };
  const all = usePlaces(base);
  const filteredByKind = usePlaces(f.kinds.length ? { ...base, kinds: f.kinds } : base);
  const places = filteredByKind.data ?? [];
  const toggleSave = useToggleSave();

  const day = f.day !== "any" ? f.day : null;
  const meal = f.meal !== "any" ? f.meal : undefined;
  const travel = useTravelMinutes(trip ? { trip: trip.trip.id, date: day ?? trip.trip.start_date, time: mealHour(meal), places: places.map((p) => p.id) } : null);
  const minutes = travel.data?.minutes ?? {};

  const visible = useMemo(() => {
    return places.filter((p) => {
      if (f.max !== "any") {
        const m = minutes[p.id];
        if (m == null || m > Number(f.max)) return false;
      }
      if (day) {
        if (closedOn(p, day)) return false;
        if (p.slots.length && meal) {
          const t = timesFor(p, day, meal);
          if (t.read && t.times.length === 0 && t.waitlist.length === 0) return false;
        }
      }
      return true;
    });
  }, [places, minutes, f.max, day, meal]);

  const counts = useMemo(() => Object.fromEntries(KINDS.map((k) => [k, (all.data ?? []).filter((p) => p.kind === k).length])) as Record<PlaceKind, number>, [all.data]);
  const areaName = (id: string | null) => trip?.areas.find((a) => a.id === id)?.name ?? "";
  const days = trip ? dateRange(trip.trip.start_date, trip.trip.end_date) : [];
  const status = Object.fromEntries((trip?.meals ?? []).map((m) => [m.place, m.status]));
  const points: MapPoint[] = trip ? [{ id: "base", lat: trip.trip.base.lat, lng: trip.trip.base.lng, label: trip.trip.base.name, kind: "base" }] : [];
  const bookAhead = visible.filter((p) => p.kind === "reserve_ahead" || p.kind === "bookable");
  const walkIns = visible.filter((p) => isWalkInKind(p.kind));
  const uncurated = visible.filter((p) => p.kind === null);
  const selected = visible.find((p) => p.id === f.sel) ?? null;

  const row = (p: PlaceCard) => (
    <PlaceRow
      key={p.id}
      place={p}
      areaName={areaName(p.area)}
      minutes={minutes[p.id]}
      walk={trip && p.lat !== null && p.lng !== null ? isWalk(trip.trip.base, { lat: p.lat, lng: p.lng }) && !day : false}
      meal={trip ? tripMealFor(trip.meals, p.id) : null}
      summary={trip ? availabilitySummary(p, trip.trip.start_date, trip.trip.end_date, meal) : undefined}
      times={day && meal && p.slots.length ? timesFor(p, day, meal) : null}
      onToggleSave={() => toggleSave.mutate({ place: p.id, saved: !p.saved })}
      selected={p.id === f.sel}
    />
  );

  return (
    <AppShell trip={shellTrip(trip)} counts={{ discover: all.data?.length ?? 0 }}>
      <div className={`disc view-${f.view}`}>
        <div className="disc-main">
          <header className="screen-head">
            <div className="label muted">{trip ? tripKicker(trip) : "Lima"}</div>
            <div className="screen-title-row">
              <h1 className="display screen-title">Discover</h1>
              <Segmented
                label="View"
                value={f.view}
                onChange={(view) => set({ view })}
                options={[
                  { value: "list", label: "List" },
                  { value: "map", label: "Map" },
                ]}
              />
            </div>
          </header>
          <div className="disc-search">
            <Search size={18} className="muted" />
            <input type="search" placeholder={`Search ${all.data?.length ?? ""} places, dishes, areas`} value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search places" />
            {f.q && (
              <button type="button" aria-label="Clear search" onClick={() => set({ q: "" })}>
                <X size={16} />
              </button>
            )}
          </div>
          <div className="chip-row">
            <Chip on={f.kinds.length === 0} onClick={() => set({ kinds: [] })}>
              All
            </Chip>
            {KINDS.filter((k) => counts[k] > 0).map((k) => (
              <Chip key={k} on={f.kinds.includes(k)} onClick={() => set({ kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k] })}>
                <span className={`dot kind-dot-${k}`} />
                {kindLabel(k)} <span className="num chip-count">{counts[k]}</span>
              </Chip>
            ))}
          </div>
          <div className="chip-row">
            <FilterChip
              label="Meal"
              icon={<Utensils size={14} />}
              value={f.meal}
              onChange={(v) => set({ meal: v })}
              options={[
                { value: "any", label: "Any meal" },
                { value: "lunch", label: "Lunch" },
                { value: "dinner", label: "Dinner" },
              ]}
            />
            <FilterChip
              label="Day"
              icon={<CalendarDays size={14} />}
              grid
              value={f.day}
              onChange={(v) => set({ day: v, ...(v !== "any" && f.meal === "any" ? { meal: "dinner" as const } : {}) })}
              options={[{ value: "any", label: "Any day" }, ...days.map((d) => ({ value: d, label: `${weekday(d)} ${dayOfMonth(d)}`, sub: trip?.meals.some((m) => m.date === d) ? "has a meal" : undefined }))]}
            />
            <FilterChip
              label="Area"
              icon={<MapPin size={14} />}
              value={f.area}
              onChange={(v) => set({ area: v })}
              options={[{ value: "any", label: "Any area" }, ...(trip?.areas ?? []).map((a) => ({ value: a.id, label: a.name }))]}
            />
            <FilterChip
              label="Travel time"
              icon={<Car size={14} />}
              value={f.max}
              onChange={(v) => set({ max: v })}
              options={[
                { value: "any", label: "Any distance" },
                { value: "15", label: "Under 15 min" },
                { value: "30", label: "Under 30 min" },
                { value: "45", label: "Under 45 min" },
              ]}
            />
          </div>
          {f.max !== "any" || day ? (
            <div className="disc-from muted">
              {day ? `${weekday(day)} ${dayOfMonth(day)} ${meal ?? ""}` : "Any day"}
              {" · travel from "}
              {travel.data?.from.label ?? trip?.trip.base.name ?? "the hotel"}
              {travel.data?.estimated ? " · times estimated" : ""}
            </div>
          ) : null}

          <div className="disc-list">
            {all.isLoading && <div className="empty muted">Loading places…</div>}
            {!all.isLoading && visible.length === 0 && <div className="empty muted">Nothing matches. Clear a filter.</div>}
            {bookAhead.length > 0 && (
              <section>
                <h2 className="disc-group">
                  <CalendarDays size={18} /> Reservations <span className="count num">{bookAhead.length}</span>
                </h2>
                <p className="muted disc-group-sub">Need a reservation. Slots read live; the clock marks old reads.</p>
                <div className="card disc-card">{bookAhead.map(row)}</div>
              </section>
            )}
            {walkIns.length > 0 && (
              <section>
                <h2 className="disc-group">
                  <Utensils size={18} /> Walk-in <span className="count num">{walkIns.length}</span>
                </h2>
                <p className="muted disc-group-sub">No booking flow. Go at opening or before the line.</p>
                <div className="card disc-card">{walkIns.map(row)}</div>
              </section>
            )}
            {uncurated.length > 0 && (
              <section>
                <h2 className="disc-group">
                  <Search size={18} /> Other matches <span className="count num">{uncurated.length}</span>
                </h2>
                <p className="muted disc-group-sub">From the map data; not researched yet.</p>
                <div className="card disc-card">{uncurated.map(row)}</div>
              </section>
            )}
          </div>
        </div>
        <div className="disc-map">
          <PlaceMap places={visible} points={points} status={status} selected={f.sel || null} onSelect={(id) => set({ sel: id === f.sel ? "" : id })} center={trip?.trip.base} areas={trip?.areas} />
          {selected && (
            <div className="disc-map-card card">
              <PlaceRow
                place={selected}
                areaName={areaName(selected.area)}
                minutes={minutes[selected.id]}
                meal={trip ? tripMealFor(trip.meals, selected.id) : null}
                summary={trip ? availabilitySummary(selected, trip.trip.start_date, trip.trip.end_date, meal) : undefined}
                onToggleSave={() => toggleSave.mutate({ place: selected.id, saved: !selected.saved })}
              />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
