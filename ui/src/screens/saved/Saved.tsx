import { Bookmark } from "lucide-react";
import { useMemo, useState } from "react";
import type { Save } from "../../../../shared/records";
import { AppShell } from "../../components/AppShell";
import { PlaceMap, type MapPoint } from "../../components/PlaceMap";
import { PlaceRow } from "../../components/PlaceRow";
import { VoiceInput } from "../../components/VoiceInput";
import type { Change } from "../../../../shared/actions.js";
import { availabilitySummary, tripMealFor } from "../../data/availability";
import { usePlaces, useSaves, useToggleSave, useTravelMinutes } from "../../data/hooks";
import { shellTrip, tripKicker, useTripView } from "../../data/trip";
import { Link } from "../../lib/router";
import "../discover/discover.css";
import "./saved.css";

/** Want to visit: every save, grouped by area so a day in one area shows what's near. */
export function Saved() {
  const { view: trip } = useTripView();
  const city = trip?.city.id;
  const saves = useSaves(city);
  const all = usePlaces(city ? { city } : null);
  const toggle = useToggleSave();
  const [fresh, setFresh] = useState<string[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const items = saves.data ?? [];
  const travel = useTravelMinutes(trip ? { trip: trip.trip.id, date: trip.trip.start_date, time: "13:00", places: items.map((x) => x.place.id) } : null);

  const groups = useMemo(() => {
    const byArea = new Map<string, typeof items>();
    for (const it of items) {
      const k = it.place.area ?? "elsewhere";
      byArea.set(k, [...(byArea.get(k) ?? []), it]);
    }
    const order = trip?.areas.map((a) => a.id) ?? [];
    return [...byArea.entries()].sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  }, [items, trip?.areas]);

  const areaOf = (id: string) => trip?.areas.find((a) => a.id === id);
  const onChanges = (changes: Change[]) => setFresh(changes.filter((c) => c.kind === "save").map((c) => (c.record as Save).place));
  const points: MapPoint[] = trip ? [{ id: "base", lat: trip.trip.base.lat, lng: trip.trip.base.lng, label: trip.trip.base.name, kind: "base" }] : [];

  return (
    <AppShell trip={shellTrip(trip)} counts={{ saved: items.length }}>
      <div className="disc">
        <div className="disc-main">
          <header className="screen-head">
            <div className="label muted">{trip ? tripKicker(trip) : ""}</div>
            <h1 className="display screen-title">Want to visit</h1>
            <p className="muted saved-sub">Walk-ins, tips and someday places, by area. No booking flow.</p>
          </header>
          <div className="saved-input">
            <VoiceInput
              intent={{ screen: "saved", ...(trip ? { trip: trip.trip.id } : {}) }}
              placeholder="“A friend says Tía Grimanesa, after five”"
              onChanges={onChanges}
              placeName={(id) => all.data?.find((p) => p.id === id)?.name ?? id}
            />
          </div>
          {saves.isLoading && <div className="empty muted">Loading…</div>}
          {!saves.isLoading && items.length === 0 && (
            <div className="empty muted">
              <Bookmark size={20} />
              <p>
                Nothing saved yet. Say a tip above, or save places from <Link to="/discover">Discover</Link>.
              </p>
            </div>
          )}
          {groups.map(([area, list]) => {
            const a = areaOf(area);
            return (
              <section key={area}>
                <h2 className="disc-group">
                  {a?.name ?? "Elsewhere"} <span className="count num">{list.length}</span>
                </h2>
                {a?.brief && <p className="muted disc-group-sub">{a.brief}</p>}
                <div className="card disc-card">
                  {list.map(({ save, place }) => (
                    <div key={place.id} className={fresh.includes(place.id) ? "flash" : undefined} onMouseEnter={() => setSel(place.id)}>
                      <PlaceRow
                        place={place}
                        areaName={a?.name}
                        minutes={travel.data?.minutes[place.id]}
                        meal={trip ? tripMealFor(trip.meals, place.id) : null}
                        summary={trip ? availabilitySummary(place, trip.trip.start_date, trip.trip.end_date) : undefined}
                        note={save.note}
                        selected={sel === place.id}
                        onToggleSave={() => toggle.mutate({ place: place.id, saved: false })}
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        <div className="disc-map">
          <PlaceMap places={items.map((x) => x.place)} points={points} selected={sel} onSelect={setSel} areas={trip?.areas} center={trip?.trip.base} />
        </div>
      </div>
    </AppShell>
  );
}
