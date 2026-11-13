import { Map as MapIcon } from "lucide-react";
import { AppShell } from "../../components/AppShell";
import { PlaceMap, type MapPoint } from "../../components/PlaceMap";
import { useSaves } from "../../data/hooks";
import { shellTrip, tripKicker, useTripView } from "../../data/trip";
import "../discover/discover.css";
import "./maps.css";

/** Placeholder until the maps phase: the trip's meals and saves on one map. */
export function Maps() {
  const { view } = useTripView();
  const saves = useSaves(view?.city.id);
  const places = [...(view?.places ?? []), ...(saves.data ?? []).map((s) => s.place).filter((p) => !view?.places.some((x) => x.id === p.id))];
  const status = Object.fromEntries((view?.meals ?? []).map((m) => [m.place, m.status]));
  const points: MapPoint[] = view ? [{ id: "base", lat: view.trip.base.lat, lng: view.trip.base.lng, label: view.trip.base.name, kind: "base" }] : [];
  return (
    <AppShell trip={shellTrip(view)}>
      <div className="maps">
        <header className="screen-head">
          <div className="label muted">{view ? tripKicker(view) : ""}</div>
          <h1 className="display screen-title">Maps</h1>
        </header>
        <div className="maps-note card">
          <MapIcon size={18} />
          <span>Day maps, area maps and food crawls come later. For now: your meals and saves.</span>
        </div>
        <div className="maps-map">
          <PlaceMap places={places} points={points} status={status} areas={view?.areas} center={view?.trip.base} />
        </div>
      </div>
    </AppShell>
  );
}
