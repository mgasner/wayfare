// Builds lima.json, the fixtures backend's city data, from the one-off Lima app's research file.
// usage: node ui/src/data/fixtures/build-lima.mjs /home/user/lima/app/restaurants.json
import fs from "node:fs";
import path from "node:path";

const src = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = path.join(path.dirname(new URL(import.meta.url).pathname), "lima.json");

const AREAS = [
  { id: "centro", name: "Centro", lat: -12.0464, lng: -77.0365, brief: "Historic center around Plaza San Martín and the hotel. Barrio Chino is a walk away." },
  { id: "pueblo-libre", name: "Pueblo Libre", lat: -12.0742, lng: -77.0637, brief: "Old tabernas and Museo Larco, a short taxi from Centro." },
  { id: "san-isidro", name: "San Isidro", lat: -12.0977, lng: -77.0365, brief: "Business district with chifas, nikkei and quiet dinner rooms." },
  { id: "surquillo", name: "Surquillo", lat: -12.1129, lng: -77.0213, brief: "Market streets next to Miraflores; Piedra and Otôto." },
  { id: "miraflores", name: "Miraflores", lat: -12.1211, lng: -77.0297, brief: "Cevicherías, Maido and Mayta, the cliff-top Malecón." },
  { id: "barranco", name: "Barranco", lat: -12.1491, lng: -77.0213, brief: "Central, Kjolle and Mérito; walkable, best for a half day." },
];

function areaOf(n) {
  const s = n.toLowerCase();
  if (s.includes("barrio chino") || s.includes("cercado")) return "centro";
  if (s.includes("pueblo libre")) return "pueblo-libre";
  if (s.includes("san isidro")) return "san-isidro";
  if (s.includes("surquillo") && !s.includes("moved")) return "surquillo";
  if (s.includes("miraflores")) return "miraflores";
  if (s.includes("barranco")) return "barranco";
  throw new Error(`no area for ${n}`);
}

function kindOf(r) {
  if (r.tier === "destination-tasting" || r.tier === "fine-dining") return "reserve_ahead";
  const st = r.availability.status;
  if (st === "unchecked-walk-in") return /counter|walk-in only|first-come/i.test(`${r.format} ${r.reservation.platform}`) ? "informal" : "walk_in";
  return "bookable";
}

const PHONE = /\+?\(?\d[\d ()-]{6,}\d/g;
function channelsOf(r) {
  const ch = [];
  if (r.mesa) ch.push({ type: "mesa247", host: r.mesa.host, slug: r.mesa.slug, local_id: r.mesa.lid, ...(r.mesa.tc ? { consumption_id: r.mesa.tc } : {}) });
  const blob = JSON.stringify(r);
  const meitre = blob.match(/search-all-hours\/(\d+)\//);
  if (meitre) ch.push({ type: "meitre", venue_id: Number(meitre[1]) });
  const contacts = r.reservation.contacts ?? "";
  for (const part of contacts.split(/;/)) {
    const nums = part.match(PHONE) ?? [];
    for (const n of nums.slice(0, 1)) {
      const number = n.replace(/[^\d+]/g, "").replace(/^(\d)/, "+51$1");
      if (/whatsapp/i.test(part)) ch.push({ type: "whatsapp", number });
      else ch.push({ type: "phone", number });
    }
    const email = part.match(/[\w.+-]+@[\w.-]+\.\w+/);
    if (email) ch.push({ type: "email", address: email[0] });
  }
  if (r.reservation.url) ch.push({ type: "web", url: r.reservation.url });
  if (/walk-in/i.test(`${r.reservation.platform} ${r.availability.status}`)) ch.push({ type: "walk_in" });
  const seen = new Set();
  return ch.filter((c) => {
    const k = JSON.stringify(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function closedDays(services) {
  const s = (services ?? "").toLowerCase();
  const days = new Set();
  if (/closed sun|sundays closed|closed sundays|mon-sat\.? |mon-sat lunch|tue-sat/.test(s) && !/sun \d|sun lunch|sun 1/.test(s)) days.add(0);
  if (/closed mon|monday closed|tue-sat|tue-sun/.test(s)) days.add(1);
  return [...days];
}

function links(r) {
  const out = [];
  if (r.website) out.push({ label: "Website", url: r.website });
  if (r.reservation.url && r.reservation.url !== r.website) out.push({ label: "Book online", url: r.reservation.url });
  if (r.instagram) out.push({ label: "Instagram", url: r.instagram });
  if (r.google_maps_url) out.push({ label: "Google Maps", url: r.google_maps_url });
  const rv = r.reviews ?? {};
  const name = { reddit: "Reddit", tripadvisor: "Tripadvisor", google: "Google", critics: "Critics" };
  for (const [k, v] of Object.entries(rv)) {
    for (const url of (v?.links ?? []).slice(0, 2)) {
      let host = "";
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch {}
      out.push({ label: k === "critics" ? host : (name[k] ?? k), url });
    }
  }
  return out;
}

function reviewSummary(r) {
  const rv = r.reviews ?? {};
  const out = {};
  for (const [k, v] of Object.entries(rv)) {
    if (!v) continue;
    out[k] = { rating: v.rating ?? null, count: v.count ?? null, summary: v.summary ?? null };
  }
  return out;
}

const iso = (s) => (s && s.length === 10 ? `${s}T12:00:00Z` : s);

const places = src.map((r) => {
  const checked = iso(r.availability.checked_at) ?? "2026-11-12T12:00:00Z";
  const facts = {
    status: { value: "open", source: "research", checked_at: checked },
    hours: { value: { text: r.services, closed_days: closedDays(r.services) }, source: "research", checked_at: checked },
    price_pp: {
      value: { usd: r.price?.per_person_usd_estimate ?? null, text: r.price?.summary ?? "" },
      source: "research",
      checked_at: checked,
    },
    cuisine: { value: r.cuisine, source: "research", checked_at: checked },
    notes: { value: { tier: r.tier, format: r.format, pros: r.pros, cons: r.cons, accolades: r.accolades, chef: r.chef, reviews: reviewSummary(r), how_to_book: r.reservation.how_to_book_notes, release_window: r.reservation.release_window, availability: r.availability.notes }, source: "research", checked_at: checked },
  };
  if (r.menu) facts.menu = { value: { name: r.menu.name, items: (r.menu.items ?? []).slice(0, 12).map((i) => ({ name: i.name, description: i.description ?? null, price: i.price ?? null })) }, source: "research", checked_at: checked };
  if (r.reservation.deposit_policy) facts.deposit_policy = { value: r.reservation.deposit_policy, source: "research", checked_at: checked };
  if (r.dress_code) facts.dress = { value: r.dress_code, source: "research", checked_at: checked };

  const waitlist = r.availability.waitlist ?? {};
  const dates = new Set([...(r.availability.slots ?? []).map((s) => s.date), ...Object.keys(waitlist), ...(r.availability.dates_checked_no_availability ?? [])]);
  const slots = r.availability.status.startsWith("checked")
    ? [...dates].sort().map((date) => ({
        place: r.id,
        date,
        party: 2,
        service: "",
        times: (r.availability.slots ?? []).find((s) => s.date === date)?.times ?? [],
        waitlist: waitlist[date] ?? [],
        checked_at: checked,
        interaction: `ix_fixture_${r.id}_${date}`,
      }))
    : [];

  return {
    id: r.id,
    city: "lima",
    area: areaOf(r.neighborhood),
    name: r.name,
    kind: kindOf(r),
    google_place_id: null,
    overture_id: null,
    lat: r.lat,
    lng: r.lng,
    channels: channelsOf(r),
    summary: r.verdict ?? null,
    links: links(r),
    curated: true,
    facts,
    slots,
  };
});

const city = {
  id: "lima",
  name: "Lima",
  country: "Peru",
  tz: "America/Lima",
  currency: "PEN",
  languages: ["es"],
  bbox: [-77.2, -12.3, -76.85, -11.9],
  config: {
    platforms: [
      { name: "Mesa 24/7", notes: "Most reservation places. Live slots per date and party; US cards often declined on the card hold." },
      { name: "Meitre", notes: "Cosme. JSON API with hours per service." },
      { name: "WhatsApp", notes: "The fallback for every place; staff reply in Spanish." },
      { name: "Walk-in", notes: "Cevicherías, anticucheras and chifas; arrive at opening." },
    ],
    messaging: ["whatsapp"],
    closures: "Most fine dining closes Sunday, some Sunday dinner and Monday.",
    release_norms: "Mesa 24/7 calendars open months ahead; fine dining sells out 1 to 3 weeks out.",
    card_notes: "US cards may be declined on zero-dollar verification holds.",
    tipping: "10% is usual; service is sometimes included.",
  },
};

const areas = AREAS.map((a) => ({ ...a, city: "lima", polygon: null, stops: [] }));
fs.writeFileSync(out, JSON.stringify({ city, areas, places }) + "\n");
console.log(`wrote ${places.length} places to ${out}`);
if (process.env.VERBOSE) for (const p of places) console.log(p.id.padEnd(28), p.kind.padEnd(14), p.area.padEnd(13), JSON.stringify(p.facts.hours.value.closed_days), p.channels.map((c) => c.type).join(","), p.slots.length);
