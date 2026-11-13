import { Bookmark, BookmarkCheck, ChevronLeft, CreditCard, ExternalLink, Globe, Mail, MessageCircle, Phone, Plus, Utensils } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import type { Channel, PlaceCard, TripView } from "../../../../shared/records";
import { AddToTripSheet, type AddInitial } from "../../components/AddToTripSheet";
import { AppShell } from "../../components/AppShell";
import { Button } from "../../components/Button";
import { Stale } from "../../components/Stale";
import { StatusChip } from "../../components/StatusChip";
import { TripMealChip } from "../../components/PlaceRow";
import { VoiceInput } from "../../components/VoiceInput";
import { closedOn, hasReadableSlots, timesFor, tripMealFor, type MealSlot } from "../../data/availability";
import { cuisine, hours, isClosed, menu, notes, priceUsd, tierLabel } from "../../data/facts";
import { useFirstSlotReads, usePlace, useRefreshSlots, useToggleSave, useTravelMinutes } from "../../data/hooks";
import { shellTrip, useTripView } from "../../data/trip";
import { dateRange, dayLabel, dayOfMonth, time12, upcoming, weekday } from "../../lib/dates";
import { useNavigate } from "../../lib/router";
import { PEN_PER_USD } from "../wizard/draft";
import "./place.css";

export function PlaceDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { view: trip } = useTripView();
  const q = usePlace(id, trip?.trip.id);
  const p = q.data;
  const toggleSave = useToggleSave();
  const [add, setAdd] = useState<AddInitial | null>(null);
  const travel = useTravelMinutes(trip && p ? { trip: trip.trip.id, date: trip.trip.start_date, time: "20:00", places: [p.id] } : null);

  if (!p) {
    return (
      <AppShell trip={shellTrip(trip)}>
        <div className="empty muted">{q.error ? String(q.error) : "Loading…"}</div>
      </AppShell>
    );
  }

  const n = notes(p);
  const h = hours(p);
  const price = priceUsd(p);
  const mins = travel.data?.minutes[p.id];
  const area = trip?.areas.find((a) => a.id === p.area)?.name;
  const meal = trip ? tripMealFor(trip.meals, p.id) : null;
  const status = p.facts.status;

  return (
    <AppShell trip={shellTrip(trip)}>
      <div className="pd">
        <div className="pd-bar">
          <button type="button" className="round-btn" aria-label="Back" onClick={() => navigate(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" className={`round-btn${p.saved ? " saved" : ""}`} aria-pressed={p.saved} aria-label={p.saved ? "Remove from saved" : "Save"} onClick={() => toggleSave.mutate({ place: p.id, saved: !p.saved })}>
            {p.saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
          </button>
        </div>
        <div className="pd-cols">
          <div className="pd-main pd-head">
            <div className="label pd-kicker">
              {tierLabel(p)}
              {area ? ` · ${area}` : ""}
            </div>
            <h1 className="display pd-name">{p.name}</h1>
            <div className="muted pd-sub">{[n.chef, cuisine(p)].filter(Boolean).join(" · ")}</div>
            <div className="pd-chips">
              {status && (
                <StatusChip status={isClosed(p) ? "failed" : "confirmed"} size="sm">
                  {status.value === "temporarily_closed" ? "Temporarily closed" : isClosed(p) ? "Closed" : "Open"}
                </StatusChip>
              )}
              {status && <Stale at={status.checked_at} field="status" always />}
              {meal && <TripMealChip meal={meal} />}
              {n.accolades?.[0] && <span className="src-chip">{n.accolades[0].split(",")[0]}</span>}
            </div>
            <div className="pd-stats">
              <div>
                <div className="pd-stat num">{price ? `US$${price}` : "—"}</div>
                <div className="muted">
                  {price ? `S/${Math.round(price * PEN_PER_USD).toLocaleString("en-US")} pp ` : "Price not known "}
                  {p.facts.price_pp && <Stale at={p.facts.price_pp.checked_at} field="price_pp" compact />}
                </div>
              </div>
              <div>
                <div className="pd-stat">{h?.text.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)-(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/)?.[0] ?? "Hours"}</div>
                <div className="muted">{h?.closed_days.length ? `Closed ${h.closed_days.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ")}` : "Open all week"}</div>
              </div>
              <div>
                <div className="pd-stat num">{mins != null ? `${mins} min` : "—"}</div>
                <div className="muted">from {trip?.trip.base.name.split(" ").slice(-1)[0] ?? "hotel"}</div>
              </div>
            </div>
            {p.summary && <p className="pd-summary">{p.summary}</p>}
            <VoiceInput intent={{ screen: "place", place: p.id, ...(trip ? { trip: trip.trip.id } : {}) }} placeholder="Something changed? “They close at 4:30 now”" placeName={(x) => (x === p.id ? p.name : x)} />
          </div>
          <div className="pd-main pd-side">{trip && (p.slots.length > 0 || hasReadableSlots(p)) && <Availability place={p} trip={trip} onPick={setAdd} />}</div>
          <div className="pd-main pd-rest">
            <Booking place={p} />
            {h && (
              <section className="pd-sec">
                <div className="pd-sec-head label muted">
                  Hours <Stale at={h.fact.checked_at} field="hours" />
                </div>
                <div className="card pd-card">{h.text}</div>
              </section>
            )}
            <Menu place={p} />
            <Reviews place={p} />
            {p.links.length > 0 && (
              <section className="pd-sec">
                <div className="pd-sec-head label muted">Links</div>
                <div className="pd-links">
                  {p.links.map((l) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="src-chip">
                      {l.label} <ExternalLink size={12} />
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
        {trip && (
          <div className="pd-actions">
            <Button size="lg" icon={p.saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />} onClick={() => toggleSave.mutate({ place: p.id, saved: !p.saved })}>
              {p.saved ? "Saved" : "Save"}
            </Button>
            <Button size="lg" variant="primary" className="grow" icon={<Plus size={18} />} onClick={() => setAdd({})}>
              {meal ? "Change meal" : "Add to trip"}
            </Button>
          </div>
        )}
      </div>
      {trip && <AddToTripSheet open={add !== null} onClose={() => setAdd(null)} place={p} trip={trip} initial={add ?? undefined} meal={add && Object.keys(add).length === 0 ? meal : null} />}
    </AppShell>
  );
}

function pickFirst(place: PlaceCard, days: string[]): { date: string; slot: MealSlot } {
  const date = days.find((d) => timesFor(place, d, "dinner").times.length) ?? days.find((d) => timesFor(place, d, "lunch").times.length) ?? days[0]!;
  return { date, slot: timesFor(place, date, "dinner").times.length ? "dinner" : "lunch" };
}

function Availability({ place, trip, onPick }: { place: PlaceCard; trip: TripView; onPick: (a: AddInitial) => void }) {
  const days = dateRange(trip.trip.start_date, trip.trip.end_date);
  const [sel, setSel] = useState<{ date: string; slot: MealSlot }>(() => pickFirst(place, days));
  const refresh = useRefreshSlots();
  const first = useFirstSlotReads([place], upcoming(trip.trip.start_date, trip.trip.end_date, trip.city.tz, 14), trip.trip.party);
  const checking = first.has(place.id);
  const readCount = place.slots.length;
  useEffect(() => {
    // The first read just landed: move to the first day with tables.
    if (readCount === 0) return;
    setSel((cur) => (timesFor(place, cur.date, cur.slot).times.length ? cur : pickFirst(place, days)));
  }, [readCount]);
  const [pendingDates, setPending] = useState<string[]>([]);
  const recheck = (dates: string[]) => {
    setPending(dates);
    refresh.mutate({ place: place.id, dates, party: trip.trip.party }, { onSettled: () => setPending([]) });
  };
  const oldest = place.slots.reduce<string | null>((o, s) => (!o || s.checked_at < o ? s.checked_at : o), null);
  const t = timesFor(place, sel.date, sel.slot);
  const mealAt = (d: string, s: MealSlot) => trip.meals.find((m) => m.date === d && m.slot === s && m.status !== "skipped");
  const channel = place.channels.find((c) => c.type === "mesa247" || c.type === "meitre")?.type;

  const cell = (d: string, s: MealSlot) => {
    const x = timesFor(place, d, s);
    const m = mealAt(d, s);
    const closed = closedOn(place, d) || (!x.read && !x.times.length);
    const cls = ["av-cell", "num", x.times.length ? "open" : x.waitlist.length ? "wait" : closed ? "closed" : "none", m && "meal", sel.date === d && sel.slot === s && "sel"].filter(Boolean).join(" ");
    return (
      <button key={`${d}${s}`} type="button" className={cls} aria-label={`${dayLabel(d)} ${s}: ${x.times.length} open`} onClick={() => setSel({ date: d, slot: s })}>
        {m ? <Utensils size={13} /> : x.times.length ? x.times.length : x.waitlist.length ? "W" : ""}
      </button>
    );
  };

  return (
    <section className="pd-sec">
      <div className="pd-sec-head">
        <span className="label muted">Availability for {trip.trip.party}</span>
        <span className="muted pd-src">
          {channel === "meitre" ? "Meitre" : "Mesa 24/7"}{" "}
          {checking ? <span className="pd-checking">Checking…</span> : oldest && <Stale at={oldest} always onRecheck={() => recheck(days)} pending={pendingDates.length === days.length} />}
        </span>
      </div>
      <div className="card pd-card">
        <div className="av-grid" style={{ gridTemplateColumns: `22px repeat(${days.length}, 1fr)` }}>
          <span />
          {days.map((d) => (
            <span key={d} className={`av-day num${d === sel.date ? " sel" : ""}`}>
              <span>{weekday(d)[0]}</span>
              <b>{dayOfMonth(d)}</b>
            </span>
          ))}
          <span className="av-row-label" title="Lunch">
            L
          </span>
          {days.map((d) => cell(d, "lunch"))}
          <span className="av-row-label" title="Dinner">
            D
          </span>
          {days.map((d) => cell(d, "dinner"))}
        </div>
        <div className="av-legend muted">
          <span>
            <i className="open" /> open times
          </span>
          <span>
            <i className="wait" /> W waitlist
          </span>
          <span>
            <i className="closed" /> closed or none
          </span>
        </div>
        <div className="av-sel">
          <div className="pd-sec-head">
            <b>
              {dayLabel(sel.date)} · {sel.slot}
            </b>
            {t.checkedAt && <Stale at={t.checkedAt} onRecheck={() => recheck([sel.date])} pending={pendingDates.includes(sel.date) && pendingDates.length === 1} />}
          </div>
          <div className="add-times">
            {t.times.map((x) => (
              <button key={x} type="button" className="time-chip num" onClick={() => onPick({ date: sel.date, slot: sel.slot, time: x })}>
                {time12(x, { short: true })}
              </button>
            ))}
            {t.times.length === 0 && (
              <span className="muted">
                {checking && !t.read ? "Checking tables…" : t.waitlist.length ? `Waitlist for ${t.waitlist.map((x) => time12(x, { short: true })).join(", ")}` : closedOn(place, sel.date) ? "Closed this day" : "Nothing open"}
              </span>
            )}
            {t.times.length === 0 && t.waitlist.length > 0 && (
              <Button size="sm" onClick={() => onPick({ date: sel.date, slot: sel.slot, status: "waitlist" })}>
                Track waitlist
              </Button>
            )}
          </div>
          {t.times.length > 0 && <div className="muted pd-hint">Tap a time to add it. Open times can vanish within minutes.</div>}
        </div>
      </div>
    </section>
  );
}

const CHANNEL_ICON: Record<Channel["type"], typeof Globe> = {
  mesa247: Globe,
  meitre: Globe,
  whatsapp: MessageCircle,
  sms: MessageCircle,
  email: Mail,
  phone: Phone,
  web: Globe,
  walk_in: Utensils,
};

function channelRow(c: Channel): { title: string; sub: string; href?: string } {
  switch (c.type) {
    case "mesa247":
      return { title: "Mesa 24/7 online", sub: `${c.host}`, href: `https://${c.host}` };
    case "meitre":
      return { title: "Meitre online", sub: "Live hours per service" };
    case "whatsapp":
      return { title: "WhatsApp", sub: c.number, href: `https://wa.me/${c.number.replace(/\D/g, "")}` };
    case "sms":
      return { title: "SMS", sub: c.number, href: `sms:${c.number}` };
    case "email":
      return { title: "Email", sub: c.address, href: `mailto:${c.address}` };
    case "phone":
      return { title: "Phone", sub: c.number, href: `tel:${c.number}` };
    case "web":
      return { title: "Website", sub: c.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), href: c.url };
    case "walk_in":
      return { title: "Walk-in", sub: "No reservations; arrive at opening" };
  }
}

function Booking({ place }: { place: PlaceCard }) {
  const deposit = place.facts.deposit_policy?.value;
  const how = notes(place).how_to_book;
  return (
    <section className="pd-sec">
      <div className="pd-sec-head label muted">How booking works here</div>
      <div className="card pd-card pd-list">
        {how && <div className="pd-how">{how}</div>}
        <div className="pd-li">
          <span className="icon-tile">
            <CreditCard size={17} />
          </span>
          <div className="grow">
            <div className="pd-li-t">
              Deposit or card guarantee {typeof deposit !== "string" && <span className="status-chip tone-warn status-chip-sm">Not published</span>}
            </div>
            <div className="muted">{typeof deposit === "string" ? deposit : "We pay any hold from your credits; the restaurant never sees your card."}</div>
          </div>
        </div>
        {place.channels.map((c, i) => {
          const r = channelRow(c);
          const Icon = CHANNEL_ICON[c.type];
          const body = (
            <>
              <span className="icon-tile">
                <Icon size={17} />
              </span>
              <div className="grow">
                <div className="pd-li-t">{r.title}</div>
                <div className="muted trunc">{r.sub}</div>
              </div>
              {r.href && <ExternalLink size={14} className="muted" />}
            </>
          );
          return r.href ? (
            <a key={i} className="pd-li" href={r.href} target="_blank" rel="noreferrer">
              {body}
            </a>
          ) : (
            <div key={i} className="pd-li">
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Menu({ place }: { place: PlaceCard }) {
  const m = menu(place);
  const [all, setAll] = useState(false);
  if (!m || m.items.length === 0) return null;
  const items = all ? m.items : m.items.slice(0, 4);
  return (
    <section className="pd-sec">
      <div className="pd-sec-head">
        <span className="label muted">Menu{m.name ? ` · ${m.name}` : ""}</span>
        {place.facts.menu && <Stale at={place.facts.menu.checked_at} field="menu" />}
      </div>
      <div className="card pd-card pd-list">
        {items.map((it) => (
          <div key={it.name} className="pd-menu-item">
            <div className="pd-li-t">{it.name}</div>
            {it.description && <div className="muted">{it.description}</div>}
          </div>
        ))}
        {m.items.length > 4 && (
          <button type="button" className="pd-more" onClick={() => setAll(!all)}>
            {all ? "Less" : `${m.items.length - 4} more`}
          </button>
        )}
      </div>
    </section>
  );
}

const REVIEW_NAME: Record<string, string> = { google: "Google", tripadvisor: "Tripadvisor", reddit: "Reddit", critics: "Critics" };

function Reviews({ place }: { place: PlaceCard }) {
  const r = notes(place).reviews;
  const entries = Object.entries(r ?? {}).filter(([, v]) => v.summary);
  if (!entries.length) return null;
  return (
    <section className="pd-sec">
      <div className="pd-sec-head label muted">What people say</div>
      <div className="card pd-card pd-list">
        {entries.map(([k, v]) => (
          <div key={k} className="pd-review">
            <div className="pd-li-t">
              {REVIEW_NAME[k] ?? k}
              {v.rating != null && <span className="num muted"> · {v.rating}</span>}
              {v.count != null && <span className="num muted"> · {v.count.toLocaleString("en-US")} reviews</span>}
            </div>
            <div className="muted pd-review-text">{v.summary}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

