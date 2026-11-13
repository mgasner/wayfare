import { z } from "zod";
import { db, sql } from "../lib/nexus.js";

export type Candidate = { id: string; name: string; area: string | null; curated: boolean };

// Words that name the kind of place rather than the place.
const generic = new Set([
  "restaurante", "restaurant", "cebicheria", "cevicheria", "picanteria", "chifa", "bar", "cafe", "the", "el", "la", "los", "las",
  "de", "del", "y", "and",
]);

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  const all = normalize(s).split(" ").filter(Boolean);
  const specific = all.filter((t) => !generic.has(t));
  return specific.length ? specific : all;
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j]!;
      row[j] = next;
    }
  }
  return row[b.length]!;
}

function similar(a: string, b: string): number {
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);
}

/** 0 to 1: how well `candidate` matches what was said, weighted toward covering every word said. */
export function nameScore(mention: string, candidate: string): number {
  const said = tokens(mention);
  const named = tokens(candidate);
  if (!said.length || !named.length) return 0;
  const best = (t: string, pool: string[]) => Math.max(...pool.map((u) => similar(t, u)));
  const recall = said.reduce((n, t) => n + best(t, named), 0) / said.length;
  const precision = named.reduce((n, t) => n + best(t, said), 0) / named.length;
  return 0.75 * recall + 0.25 * precision;
}

const THRESHOLD = 0.8;

/** The best match for a spoken name, curated places first. */
export function bestMatch(mention: string, candidates: Candidate[]): Candidate | null {
  let best: { c: Candidate; score: number } | null = null;
  for (const c of candidates) {
    const score = nameScore(mention, c.name) + (c.curated ? 0.05 : 0);
    if (!best || score > best.score) best = { c, score };
  }
  return best && best.score >= THRESHOLD ? best.c : null;
}

/** A LIKE pattern that also matches accented vowels: "tia" finds "Tía". */
function likePattern(token: string): string {
  return `%${token.replace(/[aeiou]/g, "_")}%`;
}

const CandidateRow = z.object({ id: z.string(), name: z.string(), area: z.string().nullable(), curated: z.number() });

/** Places in `city` that could be `mentions`: every curated one, plus uncurated rows sharing a word. */
export async function candidates(city: string, mentions: string[]): Promise<Candidate[]> {
  const words = [...new Set(mentions.flatMap(tokens).filter((t) => t.length >= 3))].slice(0, 12);
  const [{ rows }] = await db.execute(sql(CandidateRow)`
    SELECT id, name, area, curated FROM place
    WHERE city = ${city} AND (
      curated = 1 OR EXISTS (SELECT 1 FROM json_each(${JSON.stringify(words.map(likePattern))}) WHERE place.name LIKE value)
    )
    ORDER BY curated DESC
    LIMIT 500`);
  return rows.map((r) => ({ ...r, curated: r.curated === 1 }));
}
