import {
  Banknote,
  BedDouble,
  CalendarDays,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  Globe,
  Hand,
  IdCard,
  Leaf,
  Lock,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  Sparkles,
  TriangleExclamationPoint,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Area, PlaceCard } from "../../../../shared/records";
import { Button, Chip } from "../../components/Button";
import { Segmented, Stepper, Toggle } from "../../components/Controls";
import { Stale } from "../../components/Stale";
import { PagerDots, SwipePager } from "../../components/SwipePager";
import { useToast } from "../../components/Toast";
import { hours, priceUsd } from "../../data/facts";
import { estimateMinutes, isWalk } from "../../data/geo";
import {
  useCity,
  useClearPassport,
  useCreateTrip,
  useCurrentTripId,
  useMe,
  usePlaces,
  useSetPassport,
  useStayMinutes,
  useStaySearch,
  useTrip,
  useUpdateTrip,
} from "../../data/hooks";
import { dayLabel, dayOfMonth, isSunday, monthLong, rangeLabel, toDate, weeksOfMonth } from "../../lib/dates";
import { useLocation, useNavigate } from "../../lib/router";
import { ThemeGlyph, ThemeStrip } from "../../theme/motifs";
import { useTheme } from "../../theme/themes";
import {
  BUDGET_MAX,
  BUDGET_MIN,
  casual,
  clampAppetite,
  fromTrip,
  isComplete,
  LIMA_DEFAULTS,
  mealSlots,
  money,
  pickDate,
  sundays,
  toTripInput,
  tripDays,
  type Draft,
} from "./draft";
import "./wizard.css";

const PAGES = ["Trip basics", "Where you sleep", "Appetite", "Budget and diet", "Booking profile", "Summary"] as const;
const DRAFT_KEY = "dp-wizard-draft";

type SetDraft = (f: (d: Draft) => Draft) => void;
interface PageProps {
  d: Draft;
  set: SetDraft;
  places: PlaceCard[];
  areas: Area[];
  cityName: string;
  /** Taxi minutes from the base to each area (stays.minutes), once loaded. */
  stayMinutes: Record<string, number | null> | undefined;
}

function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) return { ...LIMA_DEFAULTS, ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {}
  return LIMA_DEFAULTS;
}

/** New trip as six swipeable pages; `edit` reuses it to change the current trip. */
export function Wizard({ edit = false }: { edit?: boolean }) {
  const { query } = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [tripId, setTripId] = useCurrentTripId();
  const existing = useTrip(edit ? tripId : null);
  const [d, setD] = useState<Draft>(loadDraft);
  const [page, setPage] = useState(() => Math.min(5, Math.max(0, Number(query.get("step") ?? 1) - 1)));
  const city = useCity(d.city);
  const places = usePlaces({ city: d.city });
  const stayMinutes = useStayMinutes(d.city, d.base);
  const create = useCreateTrip();
  const update = useUpdateTrip();
  const { theme } = useTheme();

  useEffect(() => {
    if (edit && existing.data) setD(fromTrip(existing.data.trip));
  }, [edit, existing.data]);
  useEffect(() => {
    if (!edit) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  }, [d, edit]);

  const set: SetDraft = useCallback((f) => setD((cur) => f(cur)), []);
  const go = useCallback(
    (i: number) => {
      setPage(i);
      navigate(`${edit ? "/trip/edit" : "/new"}?step=${i + 1}`, { replace: true });
    },
    [edit, navigate],
  );

  const cityName = city.data?.city.name ?? "Lima";
  const props: PageProps = { d, set, places: places.data ?? [], areas: city.data?.areas ?? [], cityName, stayMinutes: stayMinutes.data?.minutes };
  const busy = create.isPending || update.isPending;

  const finish = async () => {
    if (!isComplete(d)) {
      go(0);
      return;
    }
    try {
      if (edit && tripId) {
        await update.mutateAsync({ id: tripId, ...toTripInput(d) });
        navigate("/trip");
      } else {
        const trip = await create.mutateAsync(toTripInput(d));
        setTripId(trip.id);
        sessionStorage.removeItem(DRAFT_KEY);
        navigate("/discover");
      }
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "Could not save the trip" });
    }
  };

  const last = page === PAGES.length - 1;
  return (
    <div className="wiz">
      <header className="wiz-head">
        <button type="button" className="round-btn" aria-label={page === 0 ? "Close" : "Back"} onClick={() => (page === 0 ? navigate(edit ? "/trip" : "/") : go(page - 1))}>
          {page === 0 ? <X size={18} /> : <ChevronLeft size={18} />}
        </button>
        <div className="wiz-title">
          <div>{edit ? "Edit trip" : "New trip"}</div>
          <div className="muted num">
            {cityName} · {page + 1} of {PAGES.length}
          </div>
        </div>
        {last ? (
          <span className="wiz-right muted">{edit ? "" : "Draft"}</span>
        ) : (
          <button type="button" className="wiz-right accent-link" onClick={() => go(PAGES.length - 1)}>
            Summary
          </button>
        )}
      </header>

      <div className={`wiz-body${last ? " last" : ""}`}>
        <aside className="wiz-side" aria-label="Setup">
          <SummaryLines {...props} onOpen={go} active={page} compact />
        </aside>
        <SwipePager index={page} onIndexChange={go} label="Trip setup pages" className="wiz-pager">
          <Card>
            <TripBasics {...props} />
          </Card>
          <Card>
            <Stay {...props} />
          </Card>
          <Card>
            <Appetite {...props} />
          </Card>
          <Card>
            <BudgetDiet {...props} />
          </Card>
          <Card>
            <BookingProfile {...props} />
          </Card>
          <Card strip>
            <Summary {...props} onOpen={go} />
          </Card>
        </SwipePager>
      </div>

      <footer className="wiz-foot">
        <div className="wiz-progress">
          <span className="label muted num">
            Step {page + 1} of {PAGES.length}
          </span>
          <PagerDots count={PAGES.length} index={page} onPick={go} />
          <span className="muted wiz-swipe">
            <Hand size={14} /> Swipe
          </span>
        </div>
        {last ? (
          <>
            <Button variant="accent" size="lg" block icon={<Sparkles size={18} />} disabled={busy || !isComplete(d)} onClick={finish}>
              {edit ? "Save changes" : theme.copy.buildCta(cityName)}
            </Button>
            <SlotsFooter places={places.data ?? []} />
          </>
        ) : (
          <div className="wiz-buttons">
            {page === 0 ? (
              <Button size="lg" onClick={() => navigate(edit ? "/trip" : "/")}>
                Cancel
              </Button>
            ) : (
              <Button size="lg" icon={<ChevronLeft size={18} />} onClick={() => go(page - 1)}>
                Back
              </Button>
            )}
            <Button variant="primary" size="lg" className="grow" disabled={page === 0 && !isComplete(d)} onClick={() => go(page + 1)}>
              Next: {PAGES[page + 1]} <ChevronRight size={18} />
            </Button>
          </div>
        )}
      </footer>
    </div>
  );
}

function Card({ children, strip }: { children: ReactNode; strip?: boolean }) {
  return (
    <div className="wiz-card-wrap">
      <section className="wiz-card">
        {strip && <ThemeStrip className="wiz-strip" />}
        <div className="wiz-card-body">{children}</div>
      </section>
    </div>
  );
}

function Kicker({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="label wiz-kicker">
      {icon}
      {children}
    </div>
  );
}

function SlotsFooter({ places }: { places: PlaceCard[] }) {
  const newest = places.flatMap((p) => p.slots.map((s) => s.checked_at)).sort().at(-1);
  return (
    <div className="wiz-slots label muted num">
      {places.length} researched places
      {newest && (
        <>
          {" · "}
          <Stale at={newest} label="slots" />
        </>
      )}
    </div>
  );
}

// ---------- 1. Trip basics ----------

function TripBasics({ d, set, places, cityName }: PageProps) {
  const [month, setMonth] = useState(d.start_date ?? LIMA_DEFAULTS.start_date!);
  const weeks = weeksOfMonth(month);
  const closedSunday = places.filter((p) => p.kind === "reserve_ahead" && hours(p)?.closed_days.includes(0)).map((p) => p.name);
  const days = tripDays(d);
  const inRange = (iso: string) => !!d.start_date && !!d.end_date && iso >= d.start_date && iso <= d.end_date;
  const shift = (n: number) => {
    const m = toDate(month);
    setMonth(new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + n, 1, 12)).toISOString().slice(0, 10));
  };
  return (
    <>
      <Kicker icon={<Globe size={15} />}>Trip basics</Kicker>
      <h2 className="display wiz-h">{d.start_date && d.end_date ? `${cityName}, ${dayLabel(d.start_date).slice(4)} to ${dayOfMonth(d.end_date)}, for ${d.party === 2 ? "two" : d.party}` : `${cityName}: pick your dates`}</h2>
      <div className="wiz-row card wiz-city">
        <span className="icon-tile">
          <Globe size={18} />
        </span>
        <div className="grow">
          <div className="wiz-strong">{cityName}, Peru</div>
          <div className="muted">Mesa 24/7, Meitre, WhatsApp, walk-in</div>
        </div>
        <span className="status-chip tone-ok status-chip-sm">
          <Check size={12} /> Guide
        </span>
      </div>
      <div className="cal">
        <div className="cal-head">
          <span className="wiz-strong">
            {monthLong(month)} {toDate(month).getUTCFullYear()}
          </span>
          <span className="row">
            <button type="button" className="round-btn sm" aria-label="Previous month" onClick={() => shift(-1)}>
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="round-btn sm" aria-label="Next month" onClick={() => shift(1)}>
              <ChevronRight size={16} />
            </button>
          </span>
        </div>
        <div className="cal-grid">
          {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
            <span key={i} className="cal-wd muted">
              {w}
            </span>
          ))}
          {weeks.flat().map((iso) => {
            const out = toDate(iso).getUTCMonth() !== toDate(month).getUTCMonth();
            const edge = iso === d.start_date || iso === d.end_date;
            const cls = ["cal-day", "num", out && "out", inRange(iso) && "in", edge && "edge", iso === d.start_date && "start", iso === d.end_date && "end", isSunday(iso) && inRange(iso) && closedSunday.length > 0 && "sun"]
              .filter(Boolean)
              .join(" ");
            return (
              <button key={iso} type="button" className={cls} aria-pressed={edge} aria-label={dayLabel(iso)} onClick={() => set((x) => pickDate(x, iso))}>
                <span>{dayOfMonth(iso)}</span>
              </button>
            );
          })}
        </div>
        <div className="wiz-strong num">{days ? `${days} days · ${mealSlots(d)} meal slots` : "Tap the last day"}</div>
        {sundays(d).length > 0 && closedSunday.length > 0 && (
          <div className="muted wiz-small">
            <span className="dot-amber" /> Sundays: {listNames(closedSunday)} {closedSunday.length === 1 ? "is" : "are"} closed
          </div>
        )}
      </div>
      <div className="wiz-row card">
        <span className="icon-tile">
          <Users size={18} />
        </span>
        <div className="grow">
          <div className="muted wiz-small">Party</div>
          <div className="wiz-strong">{d.party === 1 ? "1 person" : `${d.party} people`}</div>
        </div>
        <Stepper label="people" value={d.party} min={1} max={12} onChange={(party) => set((x) => ({ ...x, party }))} />
      </div>
    </>
  );
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// ---------- 2. Where you sleep ----------

function Stay({ d, set, areas, stayMinutes }: PageProps) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const found = useStaySearch(d.city, q);
  const nights = Math.max(0, tripDays(d) - 1);
  const hits = q.trim().length >= 2 ? (found.data?.results ?? []) : [];
  return (
    <>
      <Kicker icon={<BedDouble size={15} />}>Where you sleep</Kicker>
      <h2 className="display wiz-h">Staying at {d.base.name}?</h2>
      <p className="muted wiz-sub">Travel time from here shapes every ranking.</p>
      <div className="row wrap">
        <Chip on={!editing} icon={!editing ? <Check size={15} /> : undefined} onClick={() => setEditing(false)}>
          Yes, all {nights} nights
        </Chip>
        <Chip on={editing} onClick={() => setEditing(true)}>
          Somewhere else
        </Chip>
      </div>
      {editing && (
        <div className="field stay-search">
          <label className="stay-input">
            <Search size={16} className="muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hotel name or address" aria-label="Hotel or address" autoComplete="off" />
          </label>
          {hits.length > 0 && (
            <ul className="stay-hits" aria-label="Matches">
              {hits.map((h) => (
                <li key={`${h.name}|${h.lat}|${h.lng}`}>
                  <button
                    type="button"
                    onClick={() => {
                      set((x) => ({ ...x, base: { name: h.name, lat: h.lat, lng: h.lng } }));
                      setQ("");
                      setEditing(false);
                    }}
                  >
                    <MapPin size={16} />
                    <span className="grow">
                      <b>{h.name}</b>
                      {h.address && <span className="muted wiz-small">{h.address}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && !found.isFetching && found.data && !hits.length && <span className="muted wiz-small">No match in this city. Try the street address.</span>}
        </div>
      )}
      <RingMap base={d.base} areas={areas} minutes={stayMinutes} />
      <div className="note">
        <Car size={16} />
        <span>Taxi times are typical for the day. Centro is fine on foot by day; take a taxi back after dark.</span>
      </div>
    </>
  );
}

const KM_PER_DEG = 111.32;

/** Areas placed at their real bearing and distance from the base, with 15/30/45 min rings. */
function RingMap({ base, areas, minutes }: { base: { lat: number; lng: number }; areas: Area[]; minutes: Record<string, number | null> | undefined }) {
  const W = 320;
  const H = 316;
  const cos = Math.cos((base.lat * Math.PI) / 180);
  const km = (lat: number, lng: number) => [(lng - base.lng) * cos * KM_PER_DEG, (base.lat - lat) * KM_PER_DEG] as const;
  // Fit the base and every area, leaving room on the right for labels; at most 19 px per km.
  const pts = [[0, 0] as const, ...areas.filter((a) => a.lat !== null && a.lng !== null).map((a) => km(a.lat!, a.lng!))];
  const [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  const [y0, y1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  const pad = { l: 24, r: 96, t: 28, b: 36 };
  const scale = Math.min(19, (W - pad.l - pad.r) / Math.max(x1 - x0, 0.1), (H - pad.t - pad.b) / Math.max(y1 - y0, 0.1));
  const ox = pad.l - x0 * scale + (W - pad.l - pad.r - (x1 - x0) * scale) / 2;
  const oy = pad.t - y0 * scale + (H - pad.t - pad.b - (y1 - y0) * scale) / 2;
  const xy = (lat: number, lng: number) => {
    const [x, y] = km(lat, lng);
    return [ox + x * scale, oy + y * scale] as const;
  };
  const coast: [number, number][] = [
    [-12.04, -77.16],
    [-12.075, -77.11],
    [-12.095, -77.075],
    [-12.12, -77.045],
    [-12.145, -77.027],
    [-12.17, -77.03],
    [-12.2, -77.03],
  ];
  const coastPts = coast.map(([la, ln]) => xy(la, ln).join(",")).join(" ");
  const rings = [15, 30, 45].map((m) => ({ m, r: ((m - 8) / 3.2) * scale }));
  return (
    <div className="ring-map">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Travel time from where you sleep">
        <polygon points={`${coastPts} -50,${H + 50} -50,-50`} className="ring-sea" />
        <polyline points={coastPts} className="ring-coast" />
        <text x={18} y={H - 28} className="ring-sea-label">
          Pacific
        </text>
        {rings.map(({ m, r }) => (
          <g key={m}>
            <circle cx={ox} cy={oy} r={r} className="ring" />
            <text x={ox - r * 0.42} y={oy + r * 0.9 + 12} textAnchor="middle" className="ring-label">
              {m} min
            </text>
          </g>
        ))}
        <rect x={ox - 13} y={oy - 13} width={26} height={26} rx={7} className="ring-hotel" />
        <path d={`M${ox - 6} ${oy + 5} v-9 h12 v9 M${ox - 6} ${oy} h12`} className="ring-hotel-glyph" />
        {labelAreas(areas, base, minutes, xy, W, rings.map(({ r }) => ({ x: ox - r * 0.42, y: oy + r * 0.9 + 12 }))).map(({ a, x, y, mins, walk, left, dy }) => {
          const tone = mins <= 15 ? "near" : mins <= 30 ? "mid" : mins <= 40 ? "far" : "farthest";
          const tx = left ? x - 10 : x + 10;
          return (
            <g key={a.id} className={`ring-area ${tone}`}>
              <circle cx={x} cy={y} r={6} />
              <text x={tx} y={y - 1 + dy} textAnchor={left ? "end" : "start"} className="ring-name">
                {a.name}
              </text>
              <text x={tx} y={y + 13 + dy} textAnchor={left ? "end" : "start"} className="ring-min">
                {walk ? `${mins} min walk` : `${mins} min taxi`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Puts each label right of its dot, flipping left or nudging down when it would overlap. */
function labelAreas(
  areas: Area[],
  base: { lat: number; lng: number },
  minutes: Record<string, number | null> | undefined,
  xy: (lat: number, lng: number) => readonly [number, number], W: number, obstacles: { x: number; y: number }[]) {
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const hit = (b: { x0: number; x1: number; y0: number; y1: number }) => placed.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
  // The hotel tile is an obstacle too.
  const [hx, hy] = xy(base.lat, base.lng);
  placed.push({ x0: hx - 15, x1: hx + 15, y0: hy - 15, y1: hy + 15 });
  for (const o of obstacles) placed.push({ x0: o.x - 22, x1: o.x + 22, y0: o.y - 10, y1: o.y + 3 });
  return areas
    .filter((a) => a.lat !== null && a.lng !== null)
    .map((a) => {
      const [x, y] = xy(a.lat!, a.lng!);
      return { a, x, y, ...areaTime(base, a, minutes) };
    })
    .sort((p, q) => p.y - q.y)
    .map((p) => {
      const w = Math.max(p.a.name.length * 7, 72) + 12;
      const box = (left: boolean, dy: number) => ({ x0: left ? p.x - w : p.x, x1: left ? p.x : p.x + w, y0: p.y - 12 + dy, y1: p.y + 17 + dy });
      const options: [boolean, number][] = [
        [p.x + w > W, 0],
        [p.x + w <= W, 0],
        [p.x + w > W, 22],
        [p.x + w <= W, 22],
        [p.x + w > W, -22],
        [p.x + w <= W, 34],
        [p.x + w > W, 34],
        [p.x + w <= W, -34],
      ];
      const [left, dy] = options.find(([l, d]) => !hit(box(l, d))) ?? options[0]!;
      placed.push(box(left, dy));
      return { ...p, left, dy };
    });
}

/** On foot under 1.5 km (our estimate), else the taxi minutes from stays.minutes, estimated until they load. */
function areaTime(base: { lat: number; lng: number }, a: Area, minutes: Record<string, number | null> | undefined): { mins: number; walk: boolean } {
  const pt = { lat: a.lat!, lng: a.lng! };
  if (isWalk(base, pt)) return { mins: estimateMinutes(base, pt), walk: true };
  return { mins: minutes?.[a.id] ?? estimateMinutes(base, pt), walk: false };
}

// ---------- 3. Appetite ----------

function SlotStrip({ d }: { d: Draft }) {
  const total = mealSlots(d);
  return (
    <div className="slot-strip" aria-label={`${d.tastings} tastings, ${d.sit_down} sit-down, ${casual(d)} casual`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < d.tastings ? "t" : i < d.tastings + d.sit_down ? "s" : "c"} />
      ))}
    </div>
  );
}

function Appetite({ d, set }: PageProps) {
  const slots = mealSlots(d);
  const upd = (p: Partial<Draft>) => set((x) => clampAppetite({ ...x, ...p }));
  return (
    <>
      <Kicker icon={<UtensilsCrossed size={15} />}>Appetite</Kicker>
      <h2 className="display wiz-h">How big do you want to eat?</h2>
      <p className="muted wiz-sub">You have {slots} meal slots. Pick the big ones; casual places fill the rest.</p>
      <SlotStrip d={d} />
      <div className="between muted wiz-small num">
        <span>
          {d.tastings} tastings + {d.sit_down} sit-down
        </span>
        <span>{casual(d)} casual</span>
      </div>
      <div className="wiz-list">
        <div className="wiz-li">
          <i className="sw t" />
          <div className="grow">
            <div className="wiz-strong">Big tasting menus</div>
            <div className="muted wiz-small">3 hours, S/700 to S/1,630 pp</div>
          </div>
          <Stepper label="tastings" value={d.tastings} max={slots - d.sit_down} onChange={(tastings) => upd({ tastings })} />
        </div>
        <div className="wiz-li">
          <i className="sw s" />
          <div className="grow">
            <div className="wiz-strong">Nice sit-down meals</div>
            <div className="muted wiz-small">À la carte, booked, S/150 to S/250 pp</div>
          </div>
          <Stepper label="sit-down meals" value={d.sit_down} max={slots - d.tastings} onChange={(sit_down) => upd({ sit_down })} />
        </div>
        <div className="wiz-li">
          <i className="sw c" />
          <div className="grow">
            <div className="wiz-strong">Casual and walk-in</div>
            <div className="muted wiz-small">Cevicherías, chifas, anticuchos</div>
          </div>
          <span className="pill num">{casual(d)} · the rest</span>
        </div>
      </div>
      <div className="wiz-li wiz-li-end">
        <div className="grow">
          <div className="wiz-strong">Lunch is the main meal</div>
          <div className="muted wiz-small">Cevicherías close by 5 PM, so tastings go to lunch first.</div>
        </div>
        <Toggle label="Lunch is the main meal" on={d.lunch_main} onChange={(lunch_main) => upd({ lunch_main })} />
      </div>
    </>
  );
}

// ---------- 4. Budget and diet ----------

const DIETS = ["Vegetarian", "Pescatarian", "Shellfish allergy", "Fish allergy", "Celiac", "No alcohol"];

function BudgetDiet({ d, set, places }: PageProps) {
  const [other, setOther] = useState("");
  const [adding, setAdding] = useState(false);
  const tastingPrice = useMemo(() => {
    const prices = places
      .filter((p) => p.kind === "reserve_ahead")
      .map(priceUsd)
      .filter((x): x is number => x !== null)
      .sort((a, b) => a - b);
    return prices.length ? prices[Math.floor(prices.length / 2)]! : null;
  }, [places]);
  const tastingsCost = tastingPrice !== null ? tastingPrice * d.tastings : null;
  const pct = (v: number) => ((Math.min(v, BUDGET_MAX) - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) * 100;
  const toggle = (x: string) => set((cur) => ({ ...cur, diet: cur.diet.includes(x) ? cur.diet.filter((y) => y !== x) : [...cur.diet, x] }));
  const custom = d.diet.filter((x) => !DIETS.includes(x));
  return (
    <>
      <Kicker icon={<Banknote size={15} />}>Budget and diet</Kicker>
      <h2 className="display wiz-h">What you'll spend, and what you won't eat</h2>
      <div className="muted wiz-small">Food per person, whole trip</div>
      <div className="between">
        <div className="budget-num num">
          {money(d.budget_usd, d.currency)}
          {d.budget_usd >= BUDGET_MAX ? "+" : ""}
        </div>
        <Segmented
          label="Currency"
          value={d.currency}
          options={[
            { value: "USD", label: "USD" },
            { value: "PEN", label: "PEN" },
          ]}
          onChange={(currency) => set((x) => ({ ...x, currency }))}
        />
      </div>
      <div className="budget-slider" style={{ ["--pct" as string]: `${pct(d.budget_usd)}%` }}>
        <input
          type="range"
          min={BUDGET_MIN}
          max={BUDGET_MAX}
          step={50}
          value={d.budget_usd}
          aria-label="Budget per person"
          onChange={(e) => set((x) => ({ ...x, budget_usd: Number(e.target.value) }))}
        />
        {tastingsCost !== null && <span className="budget-tick" style={{ left: `${pct(tastingsCost)}%` }} />}
      </div>
      <div className="between muted wiz-small num">
        <span>{money(BUDGET_MIN, d.currency)}</span>
        <span>{money(BUDGET_MAX, d.currency)}+</span>
      </div>
      {tastingsCost !== null && (
        <div className="muted wiz-small num budget-note">
          {d.tastings} tastings at a typical {money(tastingPrice!, d.currency)}: about {money(tastingsCost, d.currency)} pp
        </div>
      )}
      <div className="muted wiz-small" style={{ marginTop: 6 }}>
        Dietary needs{d.party > 1 ? `, ${d.party === 2 ? "both" : "all"} of you` : ""}
      </div>
      <div className="row wrap">
        <Chip on={d.diet.length === 0} icon={d.diet.length === 0 ? <Check size={15} /> : undefined} onClick={() => set((x) => ({ ...x, diet: [] }))}>
          None
        </Chip>
        {[...DIETS, ...custom].map((x) => (
          <Chip key={x} on={d.diet.includes(x)} icon={d.diet.includes(x) ? <Check size={15} /> : undefined} onClick={() => toggle(x)}>
            {x}
          </Chip>
        ))}
        {adding ? (
          <form
            className="chip-input"
            onSubmit={(e) => {
              e.preventDefault();
              if (other.trim()) toggle(other.trim());
              setOther("");
              setAdding(false);
            }}
          >
            <input autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. no pork" onBlur={() => setAdding(false)} />
          </form>
        ) : (
          <Chip icon={<Plus size={15} />} onClick={() => setAdding(true)}>
            Other
          </Chip>
        )}
      </div>
      <div className="note wiz-push">
        <TriangleExclamationPoint size={16} />
        <span>We flag places that can't adapt, like Piedra's single daily seafood menu.</span>
      </div>
    </>
  );
}

// ---------- 5. Booking profile ----------

const PASSPORT_RE = /^[A-Z0-9]{6,12}$/;
const cleanPassport = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();

function BookingProfile({ d, set }: PageProps) {
  const [passport, setPassport] = useState("");
  const [open, setOpen] = useState(false);
  const me = useMe();
  const save = useSetPassport();
  const clear = useClearPassport();
  const toast = useToast();
  const onFile = me.data?.passport_on_file ?? false;
  const valid = PASSPORT_RE.test(cleanPassport(passport));
  return (
    <>
      <Kicker icon={<IdCard size={15} />}>Booking profile</Kicker>
      <h2 className="display wiz-h">What restaurants will ask you for</h2>
      <p className="muted wiz-sub">Saved to your account and reused in every city.</p>
      <div className="wiz-list">
        <div className="wiz-li">
          <span className="icon-tile">
            <IdCard size={18} />
          </span>
          <div className="grow">
            <div className="wiz-strong">Passport number</div>
            <div className="muted wiz-small">
              {onFile ? (
                <span className="row on-file">
                  <Lock size={12} /> On file
                </span>
              ) : (
                "Optional. Needed by some booking forms."
              )}
            </div>
          </div>
          {onFile ? (
            <Button size="sm" disabled={clear.isPending} onClick={() => clear.mutate(undefined, { onError: () => toast({ text: "Could not remove the passport" }) })}>
              Remove
            </Button>
          ) : (
            <Button size="sm" onClick={() => setOpen(true)}>
              Add
            </Button>
          )}
        </div>
        {open && !onFile && (
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid) return;
              save.mutate(
                { number: cleanPassport(passport) },
                {
                  onSuccess: () => {
                    setPassport("");
                    setOpen(false);
                  },
                  onError: () => toast({ text: "Could not save the passport" }),
                },
              );
            }}
          >
            <input
              autoFocus
              value={passport}
              onChange={(e) => setPassport(e.target.value.toUpperCase())}
              placeholder="Passport number"
              aria-label="Passport number"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
            />
            <Button type="submit" size="sm" variant="primary" disabled={!valid || save.isPending}>
              Save
            </Button>
          </form>
        )}
        <div className="wiz-li">
          <span className="icon-tile">
            <Wallet size={18} />
          </span>
          <div className="grow">
            <div className="wiz-strong num">Credits · {me.data ? usd(me.data.credits_usd) : "…"}</div>
            <div className="muted wiz-small">We pay deposits and card holds with our cards and take them from your credits.</div>
          </div>
          <div className="credits-btn">
            <Button size="sm" disabled>
              Add credits
            </Button>
            <span className="muted">Coming soon</span>
          </div>
        </div>
        <div className="wiz-li">
          <span className="icon-tile wa">
            <MessageCircle size={18} />
          </span>
          <div className="grow">
            <div className="wiz-strong">WhatsApp fallback</div>
            <div className="muted wiz-small">We draft the message in Spanish. You send it from your phone.</div>
          </div>
          <Toggle label="WhatsApp fallback" on={d.whatsapp_fallback} onChange={(whatsapp_fallback) => set((x) => ({ ...x, whatsapp_fallback }))} />
        </div>
      </div>
      <div className="muted wiz-small wiz-push row">
        <Lock size={14} /> Shared with a restaurant only when you confirm a booking.
      </div>
    </>
  );
}

// ---------- 6. Summary ----------

const usd = (n: number) => `US$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function bookingLine(d: Draft, me: { passport_on_file: boolean; credits_usd: number } | undefined): { main: string; sub: string; warn: boolean } {
  const credits = me?.credits_usd ?? 0;
  const missing = [!me?.passport_on_file && "passport not added", credits <= 0 && "no credits yet"].filter(Boolean) as string[];
  return {
    main: d.whatsapp_fallback ? "WhatsApp fallback on" : "WhatsApp fallback off",
    sub: missing.length ? missing.join(" · ").replace(/^./, (c) => c.toUpperCase()) : `Passport on file · ${usd(credits)} credits`,
    warn: missing.length > 0,
  };
}

function SummaryLines({ d, areas, stayMinutes, onOpen, active, compact }: PageProps & { onOpen: (i: number) => void; active?: number; compact?: boolean }) {
  const far = areas
    .filter((a) => a.lat !== null && a.lng !== null)
    .map((a) => ({ a, m: areaTime(d.base, a, stayMinutes).mins }))
    .sort((x, y) => y.m - x.m)[0];
  const me = useMe();
  const b = bookingLine(d, me.data ?? undefined);
  const lines: { page: number; icon: ReactNode; k: string; v: string; sub?: ReactNode; warn?: boolean }[] = [
    {
      page: 0,
      icon: <CalendarDays size={18} />,
      k: "When",
      v: d.start_date && d.end_date ? rangeLabel(d.start_date, d.end_date) : "Pick dates",
      sub: `${tripDays(d)} days · ${mealSlots(d)} meal slots · ${sundays(d).length} Sunday${sundays(d).length === 1 ? "" : "s"}`,
    },
    { page: 0, icon: <Users size={18} />, k: "Party", v: d.party === 1 ? "1 person" : `${d.party} people` },
    { page: 1, icon: <BedDouble size={18} />, k: "Staying", v: d.base.name, sub: far ? `${far.a.name} ${far.m} min by taxi` : undefined },
    {
      page: 2,
      icon: <UtensilsCrossed size={18} />,
      k: "Appetite",
      v: `${d.tastings} tastings, ${d.sit_down} sit-down, ${casual(d)} casual`,
      sub: compact ? undefined : <SlotStrip d={d} />,
    },
    { page: 3, icon: <Banknote size={18} />, k: "Budget", v: `${money(d.budget_usd, d.currency)} per person`, sub: d.lunch_main ? "Lunch first" : undefined },
    { page: 3, icon: <Leaf size={18} />, k: "Dietary", v: d.diet.length ? d.diet.join(", ") : "No restrictions" },
    { page: 4, icon: <IdCard size={18} />, k: "Booking", v: b.main, sub: b.sub, warn: b.warn },
  ];
  return (
    <div className={`sum-lines${compact ? " compact" : ""}`}>
      {lines.map((l) => (
        <button key={l.k} type="button" className={`sum-line${active === l.page ? " on" : ""}`} onClick={() => onOpen(l.page)}>
          <span className="icon-tile">{l.icon}</span>
          <span className="grow">
            <span className="label sum-k">{l.k}</span>
            <span className="sum-v">{l.v}</span>
            {l.sub && <span className={`sum-sub${l.warn ? " warn" : ""}`}>{l.sub}</span>}
          </span>
          <ChevronRight size={18} className="muted" />
        </button>
      ))}
    </div>
  );
}

function Summary(props: PageProps & { onOpen: (i: number) => void }) {
  const { theme } = useTheme();
  const { d, cityName } = props;
  return (
    <>
      <Kicker icon={<ThemeGlyph size={15} />}>{theme.copy.summaryKicker}</Kicker>
      <h2 className="display wiz-h">{theme.copy.summaryTitle(cityName, tripDays(d), d.party)}</h2>
      <p className="muted wiz-sub">{theme.copy.summaryHint}</p>
      <SummaryLines {...props} />
    </>
  );
}

