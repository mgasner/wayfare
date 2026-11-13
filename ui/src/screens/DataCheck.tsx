import { AppShell } from "../components/AppShell";
import { Stale } from "../components/Stale";
import { StatusChip } from "../components/StatusChip";
import { FIXTURES } from "../data/client";
import { slotsCheckedAt } from "../data/facts";
import { useCurrentTripId, useMe, usePlaces, useSaves, useTrip } from "../data/hooks";
import { dayLabel, time12 } from "../lib/dates";
import "./gallery.css";

/** /dev/data: what the data hooks return, to check a backend (fixtures or real) at a glance. */
export function DataCheck() {
  const me = useMe();
  const [tripId] = useCurrentTripId();
  const trip = useTrip(tripId);
  const places = usePlaces(trip.data ? { city: trip.data.trip.city, trip: trip.data.trip.id } : null);
  const saves = useSaves(trip.data?.trip.city);
  const err = [me, trip, places, saves].find((q) => q.error)?.error;
  const name = (id: string) => trip.data?.places.find((p) => p.id === id)?.name ?? id;
  return (
    <AppShell>
      <header className="g-head">
        <div className="label g-kicker">Data · {FIXTURES ? "fixtures" : "server"}</div>
        <h1 className="display g-title">{me.data?.name ?? "…"}</h1>
        {err && <p style={{ color: "var(--danger)" }}>{String(err)}</p>}
      </header>
      {trip.data && (
        <section className="g-sec">
          <div className="label muted">
            Trip {trip.data.trip.id} · {trip.data.trip.start_date} to {trip.data.trip.end_date} · party {trip.data.trip.party}
          </div>
          <div className="card g-list">
            {trip.data.meals.map((m) => (
              <div key={m.id} className="g-li">
                <span className="grow">
                  <b>{name(m.place)}</b>
                  <div className="muted">
                    {dayLabel(m.date)} · {m.slot}
                    {m.time ? ` · ${time12(m.time)}` : ""}
                  </div>
                </span>
                <StatusChip status={m.status} size="sm" />
              </div>
            ))}
          </div>
          <div className="label muted">
            {trip.data.anchors.length} anchors · {saves.data?.length ?? 0} saves · {places.data?.length ?? 0} places
          </div>
          <div className="card g-list">
            {places.data?.slice(0, 6).map((p) => {
              const at = slotsCheckedAt(p);
              return (
                <div key={p.id} className="g-li">
                  <span className="grow">{p.name}</span>
                  <span className="muted">{p.kind}</span>
                  {at && <Stale at={at} compact />}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </AppShell>
  );
}
