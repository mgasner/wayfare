import type { Anchor, Area, City, Fact, FactView, Meal, PlaceCard, Save, SlotRead, Trip, TripView, User } from "../../../../shared/records";
import type { Change, InterpretResult } from "../../../../shared/actions.js";
import type { Input as In, Name, Output as Out } from "../../api.js";
import { estimateMinutes } from "../geo";
import lima from "./lima.json";

// An in-browser stand-in for the server, used when VITE_FIXTURES=1. It keeps the real Lima
// trip in localStorage so screens can be exercised end to end without an API.

type CardSeed = Omit<PlaceCard, "saved">;
const DATA = lima as unknown as { city: City; areas: Area[]; places: CardSeed[] };

// Hotels for stays.search, which Google answers on the server. Coordinates approximate.
const HOTELS = [
  { name: "Gran Hotel Bolívar", address: "Jr. de la Unión 958, Cercado de Lima", lat: -12.0507304, lng: -77.0351602 },
  { name: "Belmond Miraflores Park", address: "Av. Malecón de la Reserva 1035, Miraflores", lat: -12.1306, lng: -77.0306 },
  { name: "Hotel B", address: "Jr. San Martín 301, Barranco", lat: -12.1488, lng: -77.0215 },
  { name: "Casa Republica Barranco", address: "Av. San Martín 104, Barranco", lat: -12.1483, lng: -77.0213 },
  { name: "Country Club Lima Hotel", address: "Los Eucaliptos 590, San Isidro", lat: -12.0985, lng: -77.042 },
  { name: "JW Marriott Hotel Lima", address: "Malecón de la Reserva 615, Miraflores", lat: -12.1316, lng: -77.0297 },
];

const ME: User = { id: "u_max", email: "max@indent.com", name: "Max Gasner", picture: null };
const TRIP_ID = "lima-nov-2026";
const STORE_KEY = "dp-fixtures-v1";

interface State {
  trips: Trip[];
  meals: Meal[];
  anchors: Anchor[];
  saves: Save[];
  userFacts: Fact[];
  slotReads: SlotRead[];
  undo: Record<string, Change[]>;
  icsFeeds: string[];
}

const t0 = "2026-11-12T22:00:00Z";

function seed(): State {
  const meal = (id: string, place: string, date: string, slot: Meal["slot"], time: string | null, status: Meal["status"], channel: string | null, note: string | null): Meal => ({
    id,
    trip: TRIP_ID,
    place,
    date,
    slot,
    time,
    status,
    channel,
    note,
    updated_at: t0,
  });
  const save = (place: string, note: string | null, source: string | null): Save => ({ owner: ME.id, place, source, note, notify_nearby: true, created_at: t0 });
  return {
    trips: [
      {
        id: TRIP_ID,
        owner: ME.id,
        city: "lima",
        start_date: "2026-11-13",
        end_date: "2026-11-23",
        party: 2,
        base: { name: "Gran Hotel Bolívar", lat: -12.0507304, lng: -77.0351602 },
        appetite: { tastings: 3, sit_down: 5, lunch_main: true },
        budget: { per_person: 1800, currency: "USD" },
        diet: [],
        booking: { passport_on_file: false, credits_usd: 0, whatsapp_fallback: true },
        refresh: "standard",
        created_at: t0,
      },
    ],
    meals: [
      meal("m_piedra", "piedra-cocina-libre", "2026-11-13", "lunch", "15:00", "confirmed", "whatsapp", "Confirmed by WhatsApp"),
      meal("m_central", "central", "2026-11-16", "dinner", "20:00", "requested", "mesa247", null),
      meal("m_maido", "maido", "2026-11-19", "dinner", null, "waitlist", "mesa247", "Waitlist for dinner"),
      meal("m_ototo", "ototo-lima", "2026-11-20", "dinner", "20:00", "requested", "whatsapp", null),
    ],
    anchors: [
      {
        id: "a_barranco_fri",
        trip: TRIP_ID,
        date: "2026-11-20",
        start_time: "10:00",
        end_time: "18:00",
        area: "barranco",
        place: null,
        lat: null,
        lng: null,
        source: "hint",
        text: "Friday we'll be in Barranco, ten to six",
        calendar_event: null,
      },
      {
        id: "a_flight",
        trip: TRIP_ID,
        date: "2026-11-23",
        start_time: "21:00",
        end_time: null,
        area: null,
        place: null,
        lat: -12.0219,
        lng: -77.1143,
        source: "calendar",
        text: "Flight LIM-SFO",
        calendar_event: "gcal_fixture_flight",
      },
    ],
    saves: [
      save("anticuchos-grimanesa-lima", "A friend says go after five", "friend"),
      save("al-toke-pez", null, "reddit"),
      save("wa-lok-barrio-chino", null, null),
      save("antigua-taberna-queirolo", "Pisco after Museo Larco", null),
      save("la-mar-cebicheria", null, null),
      save("canta-rana-barranco", null, null),
    ],
    userFacts: [],
    slotReads: [],
    undo: {},
    icsFeeds: [],
  };
}

let state: State = load();

// ?reset-fixtures on any URL puts the seeded trip back, for screenshots and demos.
if (typeof location !== "undefined" && new URLSearchParams(location.search).has("reset-fixtures")) {
  state = seed();
  persist();
  localStorage.removeItem("dp-current-trip");
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...seed(), ...(JSON.parse(raw) as State) };
  } catch {}
  return seed();
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {}
}

/** Puts the fixtures back to the seeded Lima trip. */
export function resetFixtures() {
  state = seed();
  persist();
}

const now = () => new Date().toISOString();
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
const fail = (msg: string): never => {
  throw new Error(msg);
};

function card(seedCard: CardSeed): PlaceCard {
  const facts: Partial<Record<Fact["field"], FactView>> = { ...seedCard.facts };
  for (const f of state.userFacts.filter((x) => x.place === seedCard.id)) {
    const cur = facts[f.field];
    if (!cur || cur.checked_at < f.checked_at || f.source.startsWith("user:")) facts[f.field] = { value: f.value, source: f.source, checked_at: f.checked_at };
  }
  const slots = seedCard.slots.map((s) => state.slotReads.find((r) => r.place === s.place && r.date === s.date) ?? s);
  return { ...seedCard, facts, slots, saved: state.saves.some((s) => s.place === seedCard.id) };
}

const placeById = (id: string) => DATA.places.find((p) => p.id === id);
const tripById = (id: string) => state.trips.find((t) => t.id === id) ?? fail(`No trip ${id}`);

function anchorPoint(a: Anchor): { lat: number; lng: number; label: string } | null {
  if (a.lat !== null && a.lng !== null) return { lat: a.lat, lng: a.lng, label: a.text ?? "Anchor" };
  if (a.place) {
    const p = placeById(a.place);
    if (p?.lat != null && p.lng != null) return { lat: p.lat, lng: p.lng, label: p.name };
  }
  const area = DATA.areas.find((x) => x.id === a.area);
  if (area?.lat != null && area.lng != null) return { lat: area.lat, lng: area.lng, label: area.name };
  return null;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// Same rules as server/where.ts: no times is the whole day, a start alone is that moment.
function span(a: Pick<Anchor, "start_time" | "end_time">): [number, number] {
  const start = a.start_time ? toMin(a.start_time) : 0;
  const end = a.end_time ? toMin(a.end_time) : a.start_time ? start : 24 * 60 - 1;
  return [start, Math.max(start, end)];
}

function whereAt(trip: string, date: string, time: string): Out<"anchors.whereAt"> {
  const t = tripById(trip);
  const at = toMin(time);
  const located = state.anchors
    .filter((a) => a.trip === trip && a.date === date)
    .flatMap((a) => {
      const pt = anchorPoint(a);
      return pt ? [{ a, pt, span: span(a) }] : [];
    });
  const covering = located.filter((x) => x.span[0] <= at && at <= x.span[1]).sort((x, y) => y.span[0] - x.span[0])[0];
  const earlier = located.filter((x) => x.span[1] < at).sort((x, y) => y.span[1] - x.span[1])[0];
  const hit = covering ?? earlier;
  if (hit) return { ...hit.pt, anchor: hit.a.id };
  return { lat: t.base.lat, lng: t.base.lng, label: t.base.name, anchor: null };
}

const MEAL_SPAN = { lunch: ["13:00", 90], dinner: ["20:00", 120], other: [null, 60] } as const;

function conflicts(trip: string): Out<"anchors.conflicts"> {
  const out: Out<"anchors.conflicts"> = [];
  for (const meal of state.meals.filter((m) => m.trip === trip && m.status !== "skipped" && m.status !== "failed")) {
    const [deft, len] = MEAL_SPAN[meal.slot];
    const time = meal.time ?? deft;
    const p = placeById(meal.place);
    if (!time || p?.lat == null || p.lng == null) continue;
    const ms = [toMin(time), toMin(time) + len];
    let worst: Out<"anchors.conflicts">[number] | null = null;
    for (const a of state.anchors.filter((x) => x.trip === trip && x.date === meal.date)) {
      const [s, e] = span(a);
      const from = anchorPoint(a);
      if (!from || s > ms[1]! || ms[0]! > e) continue;
      const minutes = estimateMinutes(from, { lat: p.lat, lng: p.lng });
      if (minutes > 20 && (!worst || minutes > worst.minutes)) worst = { meal: meal.id, anchor: a.id, minutes, estimated: true };
    }
    if (worst) out.push(worst);
  }
  return out;
}

// ---------- input.interpret: a keyword stand-in for the model ----------

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const WEEKDAYS: [RegExp, number][] = [
  [/\b(sunday|domingo)\b/, 0],
  [/\b(monday|lunes)\b/, 1],
  [/\b(tuesday|martes)\b/, 2],
  [/\b(wednesday|miercoles)\b/, 3],
  [/\b(thursday|jueves)\b/, 4],
  [/\b(friday|viernes)\b/, 5],
  [/\b(saturday|sabado)\b/, 6],
];
const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, noon: 12 };

function hour(word: string, pm: boolean): string | null {
  const n = NUM[word] ?? Number(word.split(":")[0]);
  if (!Number.isFinite(n)) return null;
  const mm = word.includes(":") ? word.split(":")[1]! : "00";
  const h = pm && n < 12 ? n + 12 : n;
  return `${String(h).padStart(2, "0")}:${mm.padStart(2, "0")}`;
}

const TOK = `(\\d{1,2}(?::\\d\\d)?|${Object.keys(NUM).join("|")})`;
const RANGE = new RegExp(`\\b${TOK}\\s*(?:am|pm)?\\s*(?:to|-|until|hasta|a)\\s*${TOK}\\s*(am|pm)?\\b`);
const AFTER = new RegExp(`\\b(?:after|from|desde|despues de las)\\s+${TOK}\\s*(am|pm)?\\b`);
const numOf = (w: string) => NUM[w] ?? Number(w.split(":")[0]);

function parseTimes(s: string): { start: string | null; end: string | null } {
  const range = s.match(RANGE);
  if (range) {
    const a = hour(range[1]!, numOf(range[1]!) < 7);
    const b = hour(range[2]!, range[3] === "pm" || numOf(range[2]!) < 10);
    if (a && b) return { start: a, end: b };
  }
  const after = s.match(AFTER);
  if (after) return { start: hour(after[1]!, after[2] === "pm" || numOf(after[1]!) < 10), end: null };
  return { start: null, end: null };
}

const STOP = new Set(["la", "el", "de", "del", "los", "las", "restaurante", "cocina", "chifa", "anticuchos", "antigua", "taberna", "tia", "lima", "y"]);

/** A place is named when its first distinctive word appears as a whole word. */
function mentions(text: string, name: string): boolean {
  const n = norm(name).replace(/\(.*?\)/g, "");
  if (text.includes(n)) return true;
  const key = n.split(/[^a-z0-9]+/).find((w) => w.length > 2 && !STOP.has(w));
  return !!key && new RegExp(`\\b${key}\\b`).test(text);
}

function interpret({ text, context }: In<"input.interpret">): InterpretResult {
  const s = norm(text);
  const trip = context.trip ? state.trips.find((t) => t.id === context.trip) : state.trips[0];
  const changes: Change[] = [];

  const place = DATA.places.find((p) => mentions(s, p.name));
  const area = DATA.areas.find((a) => s.includes(norm(a.name)));

  if (place && /\b(clos|cierra)/.test(s)) {
    const m = s.match(new RegExp(`(?:clos\\w*|cierra\\w*)\\s+(?:at|a las)?\\s*${TOK}`));
    const closes = m ? hour(m[1]!, numOf(m[1]!) < 12) : null;
    const fact: Fact = { place: place.id, field: "hours", value: { text: `Closes ${closes ?? "earlier"} (your report)`, closes }, source: `user:${ME.id}`, checked_at: now() };
    state.userFacts.push(fact);
    changes.push({ kind: "fact", op: "created", record: fact });
  } else if (area && trip && !place) {
    const wd = WEEKDAYS.find(([re]) => re.test(s));
    let date = context.date ?? trip.start_date;
    if (wd) {
      for (let d = new Date(`${trip.start_date}T12:00:00Z`); d.toISOString().slice(0, 10) <= trip.end_date; d.setUTCDate(d.getUTCDate() + 1)) {
        if (d.getUTCDay() === wd[1]) {
          date = d.toISOString().slice(0, 10);
          break;
        }
      }
    }
    const { start, end } = parseTimes(s);
    const anchor: Anchor = { id: uid("a"), trip: trip.id, date, start_time: start, end_time: end, area: area.id, place: null, lat: null, lng: null, source: "hint", text, calendar_event: null };
    state.anchors.push(anchor);
    changes.push({ kind: "anchor", op: "created", record: anchor });
  } else if (place) {
    const prev = state.saves.find((x) => x.place === place.id);
    const note = text.trim();
    const save: Save = { owner: ME.id, place: place.id, source: /friend|amig/.test(s) ? "friend" : "voice", note, notify_nearby: true, created_at: prev?.created_at ?? now() };
    state.saves = state.saves.filter((x) => x.place !== place.id).concat(save);
    changes.push({ kind: "save", op: prev ? "updated" : "created", record: save });
  }

  const undo = uid("u");
  state.undo[undo] = changes;
  persist();
  return { changes, undo };
}

function undo({ undo: token }: In<"input.undo">): Out<"input.undo"> {
  for (const c of state.undo[token] ?? []) {
    if (c.kind === "anchor") state.anchors = state.anchors.filter((a) => a.id !== (c.record as Anchor).id);
    if (c.kind === "save") state.saves = state.saves.filter((x) => x.place !== (c.record as Save).place);
    if (c.kind === "fact") state.userFacts = state.userFacts.filter((f) => f !== c.record && f.checked_at !== (c.record as Fact).checked_at);
  }
  delete state.undo[token];
  persist();
  return { ok: true };
}

// ---------- entrypoints ----------

// Only the entrypoints the screens call; the agent, calendar and facts APIs have no fixture.
type Handlers = { [N in Name]?: (input: In<N>) => Out<N> | Promise<Out<N>> };

const handlers: Handlers = {
  "me.get": () => ME,
  "cities.get": ({ id }) => (id === "lima" ? { city: DATA.city, areas: DATA.areas } : fail(`No city ${id}`)),
  "places.search": ({ city, kinds, area, q, limit }) => {
    const nq = q ? norm(q) : null;
    return DATA.places
      .filter((p) => p.city === city)
      .filter((p) => !kinds?.length || (p.kind !== null && kinds.includes(p.kind)))
      .filter((p) => !area || p.area === area)
      .filter((p) => !nq || norm(`${p.name} ${p.area} ${String(p.facts.cuisine?.value ?? "")} ${p.summary ?? ""}`).includes(nq))
      .slice(0, limit ?? 200)
      .map(card);
  },
  "places.get": ({ id }) => card(placeById(id) ?? fail(`No place ${id}`)),
  "places.refreshSlots": async ({ place, dates, party }) => {
    await new Promise((r) => setTimeout(r, 900));
    const p = placeById(place) ?? fail(`No place ${place}`);
    const at = now();
    const reads = dates.map((date) => {
      const base = p.slots.find((s) => s.date === date);
      return { place, date, party, service: "", times: base?.times ?? [], waitlist: base?.waitlist ?? [], checked_at: at, interaction: uid("ix") };
    });
    state.slotReads = state.slotReads.filter((r) => !(r.place === place && dates.includes(r.date))).concat(reads);
    persist();
    return reads;
  },
  "trips.list": () => [...state.trips].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  "trips.get": ({ id }): TripView => {
    const trip = tripById(id);
    const meals = state.meals.filter((m) => m.trip === id);
    const ids = new Set(meals.map((m) => m.place));
    return {
      trip,
      city: DATA.city,
      areas: DATA.areas,
      meals,
      anchors: state.anchors.filter((a) => a.trip === id),
      places: DATA.places.filter((p) => ids.has(p.id)).map(card),
    };
  },
  "trips.create": (input) => {
    const trip: Trip = {
      ...input,
      appetite: input.appetite ?? null,
      budget: input.budget ?? null,
      diet: input.diet ?? null,
      booking: input.booking ?? null,
      refresh: input.refresh ?? "standard",
      id: uid("t"),
      owner: ME.id,
      created_at: now(),
    };
    state.trips.push(trip);
    persist();
    return trip;
  },
  "trips.update": ({ id, ...patch }) => {
    const trip = { ...tripById(id), ...patch };
    state.trips = state.trips.map((t) => (t.id === id ? trip : t));
    persist();
    return trip;
  },
  "meals.set": (input) => {
    const meal: Meal = { ...input, time: input.time ?? null, channel: input.channel ?? null, note: input.note ?? null, id: input.id ?? uid("m"), updated_at: now() };
    state.meals = state.meals.filter((m) => m.id !== meal.id).concat(meal);
    persist();
    return meal;
  },
  "meals.remove": ({ id }) => {
    state.meals = state.meals.filter((m) => m.id !== id);
    persist();
    return { ok: true };
  },
  "saves.list": ({ city }) =>
    state.saves
      .map((save) => ({ save, seed: placeById(save.place) }))
      .filter((x): x is { save: Save; seed: CardSeed } => !!x.seed && (!city || x.seed.city === city))
      .map(({ save, seed: s }) => ({ save, place: card(s) })),
  "saves.add": ({ place, note, source }) => {
    const prev = state.saves.find((x) => x.place === place);
    const save: Save = { owner: ME.id, place, note: note ?? prev?.note ?? null, source: source ?? prev?.source ?? null, notify_nearby: prev?.notify_nearby ?? false, created_at: prev?.created_at ?? now() };
    state.saves = state.saves.filter((x) => x.place !== place).concat(save);
    persist();
    return save;
  },
  "saves.remove": ({ place }) => {
    state.saves = state.saves.filter((x) => x.place !== place);
    persist();
    return { ok: true };
  },
  "anchors.list": ({ trip }) => state.anchors.filter((a) => a.trip === trip),
  "anchors.add": (input) => {
    const a: Anchor = {
      ...input,
      start_time: input.start_time ?? null,
      end_time: input.end_time ?? null,
      area: input.area ?? null,
      place: input.place ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      source: input.source ?? "hint",
      text: input.text ?? null,
      calendar_event: input.calendar_event ?? null,
      id: uid("a"),
    };
    state.anchors.push(a);
    persist();
    return a;
  },
  "anchors.remove": ({ id }) => {
    state.anchors = state.anchors.filter((a) => a.id !== id);
    persist();
    return { ok: true };
  },
  "anchors.whereAt": ({ trip, date, time }) => whereAt(trip, date, time),
  "anchors.conflicts": ({ trip }) => conflicts(trip),
  "travel.minutes": ({ trip, date, time, places, from: given }) => {
    const origin = given && "place" in given ? placeById(given.place) : null;
    if (given && "place" in given && origin?.lat == null) fail(`No coordinates for ${given.place}`);
    const from: Out<"travel.minutes">["from"] = !given
      ? whereAt(trip, date, time)
      : "place" in given
        ? { lat: origin!.lat!, lng: origin!.lng!, label: origin!.name, anchor: null }
        : { lat: given.lat, lng: given.lng, label: given.label ?? "Pin", anchor: null };
    const minutes = Object.fromEntries(
      places.map((id) => {
        const p = placeById(id);
        return [id, p?.lat != null && p.lng != null ? estimateMinutes(from, { lat: p.lat, lng: p.lng }) : null];
      }),
    );
    return { minutes, estimated: true, from };
  },
  "stays.search": ({ q, limit }) => {
    const nq = norm(q);
    const hotels = HOTELS.filter((h) => norm(`${h.name} ${h.address}`).includes(nq)).map((h) => ({ ...h, google_place_id: null, place: null }));
    const places = DATA.places
      .filter((p) => p.lat != null && p.lng != null && norm(p.name).includes(nq))
      .map((p) => ({ name: p.name, address: null, lat: p.lat!, lng: p.lng!, google_place_id: p.google_place_id, place: p.id }));
    const results = [...hotels, ...places].slice(0, limit ?? 5);
    return { results, source: hotels.length ? ("google" as const) : results.length ? ("places" as const) : ("none" as const) };
  },
  "stays.minutes": ({ lat, lng }) => ({
    minutes: Object.fromEntries(DATA.areas.map((a) => [a.id, a.lat != null && a.lng != null ? estimateMinutes({ lat, lng }, { lat: a.lat, lng: a.lng }) : null])),
    estimated: true,
  }),
  "calendar.links": () => [{ provider: "google", ref: ME.email, last_sync: t0 }, ...state.icsFeeds.map((ref) => ({ provider: "ics" as const, ref, last_sync: now() }))],
  "calendar.sync": () => ({ links: [], created: 0, updated: 0, deleted: 0 }),
  "calendar.addIcs": ({ url }) => {
    if (!/^(https|webcal):\/\//.test(url)) fail("Use an https or webcal link");
    state.icsFeeds = [...new Set([...state.icsFeeds, url.replace(/^webcal:/, "https:")])];
    persist();
    return { links: [], created: 0, updated: 0, deleted: 0 };
  },
  "calendar.removeIcs": ({ url }) => {
    state.icsFeeds = state.icsFeeds.filter((x) => x !== url);
    persist();
    return { ok: true };
  },
  "input.interpret": interpret,
  "input.undo": undo,
};

export function fixtureCall<N extends Name>(name: N, input: In<N>): Promise<Out<N>> {
  return fixtureTransport(name, input) as Promise<Out<N>>;
}

export async function fixtureTransport(name: string, input: unknown): Promise<unknown> {
  const h = handlers[name as Name] as ((i: unknown) => unknown) | undefined;
  if (!h) throw new Error(`No fixture for ${name}`);
  await new Promise((r) => setTimeout(r, 60));
  // Structured clone so callers can't mutate fixture state through returned objects.
  return structuredClone(await h(input));
}

