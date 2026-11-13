import { BedDouble, CalendarDays, Link2, Mic, Plane, Plus, RefreshCw, Trash2, Utensils } from "lucide-react";
import { useState } from "react";
import type { Anchor, TripView } from "../../../../shared/records";
import { AppShell } from "../../components/AppShell";
import { Button } from "../../components/Button";
import { PlaceMap, type MapPoint } from "../../components/PlaceMap";
import { STATUS_TONE } from "../../components/StatusChip";
import { VoiceInput } from "../../components/VoiceInput";
import type { Change } from "../../../../shared/actions.js";
import { useAddIcs, useAnchors, useCalendarLinks, useCalendarSync, useRemoveAnchor, useRemoveIcs } from "../../data/hooks";
import { useToast } from "../../components/Toast";
import { formatAge } from "../../../../shared/freshness.js";
import { shellTrip, tripKicker, useTripView } from "../../data/trip";
import { dateRange, dayLabel, time12 } from "../../lib/dates";
import { Link } from "../../lib/router";
import "../discover/discover.css";
import "../saved/saved.css";
import "./where.css";

const hm = (t: string | null) => (t ? time12(t).replace(":00", "") : "");

function anchorPoint(a: Anchor, view: TripView): MapPoint | null {
  const area = view.areas.find((x) => x.id === a.area);
  const lat = a.lat ?? area?.lat ?? null;
  const lng = a.lng ?? area?.lng ?? null;
  if (lat === null || lng === null) return null;
  return { id: a.id, lat, lng, label: area?.name ?? a.text ?? "Plan", kind: "anchor" };
}

/** Where you'll be: per day, the anchors that move the travel-time origin away from the hotel. */
export function Where() {
  const { view } = useTripView();
  const anchors = useAnchors(view?.trip.id ?? null);
  const remove = useRemoveAnchor();
  const [fresh, setFresh] = useState<string[]>([]);
  const [day, setDay] = useState<string | null>(null);

  if (!view) {
    return (
      <AppShell>
        <div className="empty muted">Loading…</div>
      </AppShell>
    );
  }
  const days = dateRange(view.trip.start_date, view.trip.end_date);
  const list = anchors.data ?? view.anchors;
  const onChanges = (changes: Change[]) => {
    const created = changes.filter((c) => c.kind === "anchor").map((c) => c.record as Anchor);
    setFresh(created.map((a) => a.id));
    if (created[0]) setDay(created[0].date);
  };
  const areaName = (id: string | null) => view.areas.find((a) => a.id === id)?.name ?? null;
  const shown = day ?? days.find((d) => list.some((a) => a.date === d)) ?? days[0]!;
  const points: MapPoint[] = [
    { id: "base", lat: view.trip.base.lat, lng: view.trip.base.lng, label: view.trip.base.name, kind: "base" },
    ...list.filter((a) => a.date === shown).flatMap((a) => anchorPoint(a, view) ?? []),
  ];

  return (
    <AppShell trip={shellTrip(view)}>
      <div className="disc">
        <div className="disc-main">
          <header className="screen-head">
            <div className="label muted">{tripKicker(view)}</div>
            <h1 className="display screen-title">Where you'll be</h1>
            <p className="muted saved-sub">Travel times start here. Without a plan, from {view.trip.base.name}.</p>
          </header>
          <div className="where-input">
            <VoiceInput intent={{ screen: "where", trip: view.trip.id, date: shown }} placeholder="“Friday we'll be in Barranco, ten to six”" onChanges={onChanges} areaName={(id) => areaName(id) ?? id} />
          </div>
          <Calendars trip={view.trip.id} />
          <div className="where-days">
            {days.map((d) => {
              const items = list.filter((a) => a.date === d).sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
              const meals = view.meals.filter((m) => m.date === d && m.status !== "skipped");
              return (
                <section key={d} className={`where-day${d === shown ? " on" : ""}`} onClick={() => setDay(d)}>
                  <h2 className="where-day-title">
                    {dayLabel(d)}
                    {items.length > 0 && <span className="count num">{items.length}</span>}
                  </h2>
                  <div className="where-tl">
                    {items.length === 0 && (
                      <div className="where-row base muted">
                        <span className="where-time" />
                        <BedDouble size={15} />
                        <span>From {view.trip.base.name}</span>
                      </div>
                    )}
                    {items.map((a) => (
                      <div key={a.id} className={`where-row anchor${fresh.includes(a.id) ? " flash" : ""}`}>
                        <span className="where-time num">
                          {hm(a.start_time)}
                          {a.end_time ? `–${hm(a.end_time)}` : ""}
                        </span>
                        {a.source === "calendar" ? /flight|airport/i.test(a.text ?? "") ? <Plane size={15} /> : <CalendarDays size={15} /> : <Mic size={15} />}
                        <span className="grow">
                          <b>{areaName(a.area) ?? a.text ?? "Plan"}</b>
                          {a.text && areaName(a.area) && <span className="muted where-quote">“{a.text}”</span>}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          aria-label="Remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            remove.mutate({ id: a.id });
                          }}
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    ))}
                    {meals.map((m) => (
                      <Link key={m.id} to={`/place/${m.place}`} className="where-row meal muted">
                        <span className="where-time num">{m.time ? hm(m.time) : m.slot}</span>
                        <Utensils size={15} className={`tone-text-${STATUS_TONE[m.status]}`} />
                        <span className="grow trunc">{view.places.find((p) => p.id === m.place)?.name ?? m.place}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        <div className="disc-map">
          <PlaceMap places={view.places.filter((p) => view.meals.some((m) => m.place === p.id && m.date === shown))} points={points} areas={view.areas} center={view.trip.base} />
        </div>
      </div>
    </AppShell>
  );
}

/** Google Calendar from sign-in plus pasted ICS feeds; synced into calendar anchors on open. */
function Calendars({ trip }: { trip: string }) {
  const links = useCalendarLinks();
  const sync = useCalendarSync(trip);
  const addIcs = useAddIcs();
  const removeIcs = useRemoveIcs();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const google = links.data?.find((l) => l.provider === "google");
  const feeds = links.data?.filter((l) => l.provider === "ics") ?? [];
  const synced = (at: string | null) => (at ? `synced ${formatAge(Date.now() - Date.parse(at))} ago` : "not synced yet");
  return (
    <div className="where-cal card">
      <div className="where-cal-row">
        <span className="icon-tile">
          <CalendarDays size={18} />
        </span>
        <div className="grow">
          <b>Google Calendar</b>
          <div className="muted">{google ? `${google.ref} · ${synced(google.last_sync)}` : "Events with a place become plans; flights become airport stops."}</div>
        </div>
        {google ? (
          <Button size="sm" iconOnly aria-label="Sync now" disabled={sync.isPending} onClick={() => sync.mutate({ trip, force: true })}>
            <RefreshCw size={15} />
          </Button>
        ) : (
          <a className="btn btn-sm" href={`/api/auth/login?next=${encodeURIComponent("/where")}`}>
            Connect
          </a>
        )}
      </div>
      {feeds.map((f) => (
        <div key={f.ref} className="where-cal-row">
          <span className="icon-tile">
            <Link2 size={17} />
          </span>
          <div className="grow trunc">
            <b>{new URL(f.ref).hostname}</b>
            <div className="muted">ICS feed · {synced(f.last_sync)}</div>
          </div>
          <Button size="sm" variant="ghost" iconOnly aria-label="Remove feed" onClick={() => removeIcs.mutate({ url: f.ref })}>
            <Trash2 size={15} />
          </Button>
        </div>
      ))}
      {adding ? (
        <form
          className="where-ics"
          onSubmit={(e) => {
            e.preventDefault();
            addIcs.mutate(
              { url: url.trim() },
              {
                onSuccess: () => {
                  setUrl("");
                  setAdding(false);
                },
                onError: (err) => toast({ text: err.message }),
              },
            );
          }}
        >
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="webcal:// or https:// link from Apple or Outlook" inputMode="url" />
          <Button type="submit" size="sm" variant="primary" disabled={!url.trim() || addIcs.isPending}>
            Add
          </Button>
        </form>
      ) : (
        <button type="button" className="where-add-ics" onClick={() => setAdding(true)}>
          <Plus size={15} /> Add a calendar link (Apple, Outlook)
        </button>
      )}
    </div>
  );
}
