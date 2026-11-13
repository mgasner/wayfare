// Name and distance matching between curated places and Overture records.

const generic = new Set([
  "restaurante", "restaurant", "rest", "bar", "the", "el", "la", "los", "las", "de", "del", "y", "and", "lima", "peru", "peruana", "peruano",
]);

export function normalizeName(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !generic.has(t));
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const padded = ` ${s} `;
  for (let i = 0; i < padded.length - 1; i++) {
    const g = padded.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  const x = bigrams(a);
  const y = bigrams(b);
  let common = 0;
  let total = 0;
  for (const [g, n] of x) {
    common += Math.min(n, y.get(g) ?? 0);
    total += n;
  }
  for (const n of y.values()) total += n;
  return (2 * common) / total;
}

/**
 * 0 to 1. Generic words (restaurante, bar, la, ...) are dropped first, so "Central Restaurante" and
 * "Central" match fully; when every token of the shorter name is in the longer one, that counts as a match.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = normalizeName(a);
  const tb = normalizeName(b);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const longSet = new Set(long);
  if (short.every((t) => longSet.has(t))) return Math.max(0.9, dice(ta.join(" "), tb.join(" ")));
  const joined = dice(ta.join(" "), tb.join(" "));
  const compact = dice(ta.join(""), tb.join(""));
  return Math.max(joined, compact);
}

export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export type Candidate = { id: string; name: string; lat: number; lng: number };
export type Match = { candidate: Candidate; similarity: number; meters: number };

export const MATCH_RADIUS_M = 150;
export const MIN_SIMILARITY = 0.6;

/** The most similar candidate within `radius` meters, nearer first on ties; null below `minSimilarity`. */
export function bestMatch(
  place: { name: string; lat: number; lng: number },
  candidates: Candidate[],
  radius = MATCH_RADIUS_M,
  minSimilarity = MIN_SIMILARITY,
): Match | null {
  let best: Match | null = null;
  for (const c of candidates) {
    const meters = metersBetween(place, c);
    if (meters > radius) continue;
    const similarity = nameSimilarity(place.name, c.name);
    if (similarity < minSimilarity) continue;
    if (!best || similarity > best.similarity + 1e-9 || (Math.abs(similarity - best.similarity) <= 1e-9 && meters < best.meters)) {
      best = { candidate: c, similarity, meters };
    }
  }
  return best;
}
