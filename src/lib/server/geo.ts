/**
 * Orts- und Streckensuche über OpenStreetMap.
 * Nominatim (Adresssuche) und OSRM (Fahrstrecke) sind öffentliche Dienste mit
 * Fair-Use-Regeln: eigener User-Agent, höchstens eine Suche pro Sekunde,
 * Ergebnisse 24 Stunden im Speicher.
 */

const USER_AGENT = "MitFahr.io/2.0 (privates Projekt; Kontakt: nagraszust@gmail.com)";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";

const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
const ROUTE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Place {
  label: string;
  lat: number;
  lon: number;
}

const searchCache = new Map<string, { at: number; results: Place[] }>();
const routeCache = new Map<string, { at: number; km: number }>();

let lastNominatimCall = 0;

function roundKm(meters: number): number {
  return Math.round((meters / 1000) * 10) / 10;
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const cached = searchCache.get(q.toLowerCase());
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.results;

  // Fair-Use: mindestens 1 Sekunde Abstand zwischen zwei Nominatim-Aufrufen
  const wait = 1000 - (Date.now() - lastNominatimCall);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatimCall = Date.now();

  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=jsonv2&limit=6&addressdetails=0&countrycodes=de`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Accept-Language": "de" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Ortssuche antwortete mit HTTP ${res.status}`);

  const data = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
  const results: Place[] = (Array.isArray(data) ? data : [])
    .map((item) => ({
      label: String(item.display_name ?? "").trim(),
      lat: Number(item.lat),
      lon: Number(item.lon),
    }))
    .filter((place) => place.label.length > 0 && Number.isFinite(place.lat) && Number.isFinite(place.lon));

  searchCache.set(q.toLowerCase(), { at: Date.now(), results });
  return results;
}

export async function routeKm(from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<number> {
  const key = `${from.lat},${from.lon}|${to.lat},${to.lon}`;
  const cached = routeCache.get(key);
  if (cached && Date.now() - cached.at < ROUTE_TTL_MS) return cached.km;

  const url = `${OSRM}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Streckensuche antwortete mit HTTP ${res.status}`);

  const data = (await res.json()) as { code?: string; routes?: { distance?: number }[] };
  const distance = data.routes?.[0]?.distance;
  if (data.code !== "Ok" || typeof distance !== "number") {
    throw new Error("Keine Strecke gefunden");
  }

  const km = roundKm(distance);
  routeCache.set(key, { at: Date.now(), km });
  return km;
}
