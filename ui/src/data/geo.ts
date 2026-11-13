export interface LatLng {
  lat: number;
  lng: number;
}

export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Rough door-to-door minutes for Lima: walking under 1.5 km, else taxi. Fitted to the research
 * estimates from Gran Hotel Bolívar (Barrio Chino 14 min on foot, Barranco 40 to 45 by taxi).
 * Only for fixtures and the wizard's ring before a trip exists; the server uses the Routes API.
 */
export function estimateMinutes(a: LatLng, b: LatLng): number {
  const km = distanceKm(a, b);
  if (km < 1.5) return Math.max(3, Math.round(km * 12.5));
  return Math.round(km * 3.2 + 8);
}

export const isWalk = (a: LatLng, b: LatLng) => distanceKm(a, b) < 1.5;
