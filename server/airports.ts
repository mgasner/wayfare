// Airports a flight event can name. `city` is set for cities the app covers, so a departure from
// there becomes an anchor at the airport.
export type Airport = { name: string; country: string; city?: string; lat?: number; lng?: number };

export const airports: Record<string, Airport> = {
  LIM: { name: "Jorge Chávez Airport (LIM)", country: "PE", city: "lima", lat: -12.0219, lng: -77.1143 },
  CUZ: { name: "Cusco Airport (CUZ)", country: "PE" },
  AQP: { name: "Arequipa Airport (AQP)", country: "PE" },
  IQT: { name: "Iquitos Airport (IQT)", country: "PE" },
  PIU: { name: "Piura Airport (PIU)", country: "PE" },
  TRU: { name: "Trujillo Airport (TRU)", country: "PE" },
  JUL: { name: "Juliaca Airport (JUL)", country: "PE" },
  PEM: { name: "Puerto Maldonado Airport (PEM)", country: "PE" },
  TPP: { name: "Tarapoto Airport (TPP)", country: "PE" },
  BOG: { name: "Bogotá (BOG)", country: "CO" },
  SCL: { name: "Santiago (SCL)", country: "CL" },
  EZE: { name: "Buenos Aires (EZE)", country: "AR" },
  GRU: { name: "São Paulo (GRU)", country: "BR" },
  UIO: { name: "Quito (UIO)", country: "EC" },
  PTY: { name: "Panama City (PTY)", country: "PA" },
  MEX: { name: "Mexico City (MEX)", country: "MX" },
  MAD: { name: "Madrid (MAD)", country: "ES" },
  SFO: { name: "San Francisco (SFO)", country: "US" },
  LAX: { name: "Los Angeles (LAX)", country: "US" },
  JFK: { name: "New York JFK", country: "US" },
  EWR: { name: "Newark (EWR)", country: "US" },
  MIA: { name: "Miami (MIA)", country: "US" },
  IAH: { name: "Houston (IAH)", country: "US" },
  ATL: { name: "Atlanta (ATL)", country: "US" },
  DFW: { name: "Dallas (DFW)", country: "US" },
  FLL: { name: "Fort Lauderdale (FLL)", country: "US" },
  ORD: { name: "Chicago (ORD)", country: "US" },
  SEA: { name: "Seattle (SEA)", country: "US" },
  BOS: { name: "Boston (BOS)", country: "US" },
};

export type Flight = { from: string | null; to: string | null };

const pair = /\b([A-Z]{3})\s*(?:-|–|—|→|>|to)\s*([A-Z]{3})\b/;
const flightWord = /\b(flight|flug|vuelo|vol)\b/i;
const flightNumber = /\b[A-Z][A-Z0-9]\s?\d{2,4}\b/;

/** Origin and destination codes of a flight event, or null when it isn't one. */
export function parseFlight(summary: string, location: string): Flight | null {
  const text = `${summary} ${location}`;
  const p = pair.exec(text);
  if (p && airports[p[1]!] && airports[p[2]!]) return { from: p[1]!, to: p[2]! };
  if (!flightWord.test(summary) && !flightNumber.test(summary)) return null;
  // "Flight to San Francisco (LA 2470)" with location "Lima LIM": the location is where it leaves from.
  const inLocation = [...location.matchAll(/\b([A-Z]{3})\b/g)].map((m) => m[1]!).find((c) => airports[c]);
  const inSummary = [...summary.matchAll(/\b([A-Z]{3})\b/g)].map((m) => m[1]!).filter((c) => airports[c]);
  if (inLocation) return { from: inLocation, to: inSummary.find((c) => c !== inLocation) ?? null };
  if (inSummary.length) return { from: inSummary[0]!, to: inSummary[1] ?? null };
  return null;
}
