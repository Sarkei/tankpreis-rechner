/**
 * Orts- und Streckensuche über OpenStreetMap.
 *
 * Suche: Photon (photon.komoot.io) – kennt Gebäude, Schulen, Bahnhöfe, Läden,
 *        Firmen und Adressen und lässt sich auf die eigene PLZ ausrichten.
 *        Fällt auf Nominatim zurück, wenn Photon nichts findet.
 * Strecke: OSRM (router.project-osrm.org), Fahrstrecke in km.
 *
 * Beide Dienste sind öffentlich: eigener User-Agent, höchstens eine Suche pro
 * Sekunde, Ergebnisse 24 Stunden im Speicher.
 */

const USER_AGENT = "MitFahr.io/2.0 (privates Projekt; Kontakt: nagraszust@gmail.com)";

const PHOTON = "https://photon.komoot.io/api/";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const ZIPPO = "https://api.zippopotam.us/de";

const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
const ROUTE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Place {
  label: string;
  lat: number;
  lon: number;
  /** Art des Treffers, z. B. "Schule", "Bahnhof", "Supermarkt" */
  category?: string | null;
}

const searchCache = new Map<string, { at: number; results: Place[] }>();
const routeCache = new Map<string, { at: number; km: number }>();
const plzCache = new Map<string, { at: number; coords: { lat: number; lon: number } | null }>();

let lastSearchCall = 0;

function roundKm(meters: number): number {
  return Math.round((meters / 1000) * 10) / 10;
}

async function throttle(): Promise<void> {
  const wait = 1000 - (Date.now() - lastSearchCall);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastSearchCall = Date.now();
}

const CATEGORIES: Record<string, string> = {
  "amenity/school": "Schule",
  "amenity/university": "Hochschule",
  "amenity/college": "Hochschule",
  "amenity/kindergarten": "Kindergarten",
  "amenity/hospital": "Krankenhaus",
  "amenity/clinic": "Klinik",
  "amenity/doctors": "Arzt",
  "amenity/dentist": "Zahnarzt",
  "amenity/pharmacy": "Apotheke",
  "amenity/restaurant": "Restaurant",
  "amenity/fast_food": "Imbiss",
  "amenity/cafe": "Café",
  "amenity/pub": "Kneipe",
  "amenity/bar": "Bar",
  "amenity/biergarten": "Biergarten",
  "amenity/fuel": "Tankstelle",
  "amenity/bank": "Bank",
  "amenity/atm": "Geldautomat",
  "amenity/townhall": "Rathaus",
  "amenity/police": "Polizei",
  "amenity/fire_station": "Feuerwehr",
  "amenity/library": "Bibliothek",
  "amenity/place_of_worship": "Kirche",
  "amenity/parking": "Parkplatz",
  "amenity/bus_station": "Busbahnhof",
  "amenity/marketplace": "Marktplatz",
  "amenity/community_centre": "Gemeindezentrum",
  "amenity/veterinary": "Tierarzt",
  "railway/station": "Bahnhof",
  "railway/halt": "Bahnhalt",
  "railway/platform": "Bahnsteig",
  "railway/tram_stop": "Haltestelle",
  "highway/bus_stop": "Haltestelle",
  "building/train_station": "Bahnhof",
  "building/school": "Schule",
  "building/university": "Hochschule",
  "building/commercial": "Gebäude",
  "building/industrial": "Betrieb",
  "building/office": "Büro",
  "building/retail": "Geschäft",
  "building/church": "Kirche",
  "shop/supermarket": "Supermarkt",
  "shop/convenience": "Kiosk",
  "shop/bakery": "Bäckerei",
  "shop/butcher": "Metzgerei",
  "shop/clothes": "Bekleidung",
  "shop/doityourself": "Baumarkt",
  "shop/electronics": "Elektronik",
  "shop/car_repair": "Werkstatt",
  "shop/hairdresser": "Friseur",
  "shop/books": "Buchhandlung",
  "shop/beverages": "Getränkemarkt",
  "leisure/sports_centre": "Sportzentrum",
  "leisure/fitness_centre": "Fitnessstudio",
  "leisure/pitch": "Sportplatz",
  "leisure/park": "Park",
  "leisure/swimming_pool": "Schwimmbad",
  "tourism/hotel": "Hotel",
  "tourism/guest_house": "Pension",
  "tourism/museum": "Museum",
  "office/company": "Firma",
  "office/government": "Behörde",
  "office/estate_agent": "Makler",
  "craft/*": "Betrieb",
  "landuse/construction": "Baustelle",
  "landuse/industrial": "Gewerbe",
  "landuse/residential": "Wohngebiet",
};

function categoryOf(key?: string, value?: string): string | null {
  if (!key) return null;
  if (value && CATEGORIES[`${key}/${value}`]) return CATEGORIES[`${key}/${value}`];
  if (CATEGORIES[`${key}/*`]) return CATEGORIES[`${key}/*`];
  if (key === "shop" && value) return "Geschäft";
  if (key === "office" && value) return "Büro";
  return null;
}

/** Koordinaten einer PLZ (für die lokale Gewichtung der Suche), 24 h gecacht. */
async function plzCoords(plz: string): Promise<{ lat: number; lon: number } | null> {
  const cached = plzCache.get(plz);
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.coords;

  let coords: { lat: number; lon: number } | null = null;
  try {
    const res = await fetch(`${ZIPPO}/${encodeURIComponent(plz)}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = (await res.json()) as { places?: { latitude?: string; longitude?: string }[] };
      const place = data.places?.[0];
      if (place?.latitude && place?.longitude) {
        coords = { lat: Number(place.latitude), lon: Number(place.longitude) };
      }
    }
  } catch {
    coords = null;
  }
  plzCache.set(plz, { at: Date.now(), coords });
  return coords;
}

async function searchPhoton(query: string, bias: { lat: number; lon: number } | null): Promise<Place[]> {
  const params = new URLSearchParams({ q: query, lang: "de", limit: "8" });
  if (bias) {
    params.set("lat", String(bias.lat));
    params.set("lon", String(bias.lon));
    params.set("zoom", "12");
  }

  const res = await fetch(`${PHOTON}?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Ortssuche antwortete mit HTTP ${res.status}`);

  const data = (await res.json()) as {
    features?: {
      geometry?: { coordinates?: [number, number] };
      properties?: {
        name?: string;
        street?: string;
        housenumber?: string;
        postcode?: string;
        city?: string;
        osm_key?: string;
        osm_value?: string;
      };
    }[];
  };

  const places: Place[] = [];
  for (const feature of data.features ?? []) {
    const props = feature.properties ?? {};
    const coords = feature.geometry?.coordinates;
    if (!coords) continue;

    const street = [props.street, props.housenumber].filter(Boolean).join(" ");
    const name = (props.name ?? "").trim();
    const parts = [name, street, props.city ?? props.postcode ?? ""].filter(
      (part) => part && part.trim().length > 0
    );
    const label = [...new Set(parts)].join(", ");
    if (!label) continue;

    places.push({
      label,
      lat: Number(coords[1]),
      lon: Number(coords[0]),
      category: categoryOf(props.osm_key, props.osm_value),
    });
  }
  return places;
}

async function searchNominatim(query: string): Promise<Place[]> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=jsonv2&limit=6&addressdetails=0&countrycodes=de`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Accept-Language": "de" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Ortssuche antwortete mit HTTP ${res.status}`);

  const data = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
  return (Array.isArray(data) ? data : [])
    .map((item) => ({
      label: String(item.display_name ?? "").trim(),
      lat: Number(item.lat),
      lon: Number(item.lon),
      category: null,
    }))
    .filter((place) => place.label.length > 0 && Number.isFinite(place.lat) && Number.isFinite(place.lon));
}


const ROMAN: Record<string, string> = { "1": "I", "2": "II", "3": "III" };
const ARABIC: Record<string, string> = { I: "1", II: "2", III: "3" };

/**
 * Suchvarianten: OSM führt Schulen als "Berufsschule I", getippt wird aber
 * "Berufsschule 1". Deshalb zusätzlich die Schreibweise mit getauschten
 * Ziffern abfragen (römisch <-> arabisch).
 */
function queryVariants(query: string): string[] {
  const variants = [query];
  const toRoman = query.replace(/\b([123])\b/g, (match) => ROMAN[match] ?? match);
  if (toRoman !== query) variants.push(toRoman);
  const toArabic = query.replace(/\b(III|II|I)\b/g, (match) => ARABIC[match] ?? match);
  if (toArabic !== query && !variants.includes(toArabic)) variants.push(toArabic);
  return variants.slice(0, 2);
}

function mergeUnique(groups: Place[][]): Place[] {
  const seen = new Set<string>();
  const merged: Place[] = [];
  for (const group of groups) {
    for (const place of group) {
      const key = `${place.lat.toFixed(4)}|${place.lon.toFixed(4)}|${place.label.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(place);
    }
  }
  return merged.slice(0, 10);
}

export async function searchPlaces(query: string, plz?: string): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const cacheKey = `${plz ?? ""}|${q.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.results;

  const bias = plz && /^\d{5}$/.test(plz) ? await plzCoords(plz) : null;

  await throttle();
  const variants = queryVariants(q);
  const groups = await Promise.all(
    variants.map((variant) => searchPhoton(variant, bias).catch(() => [] as Place[]))
  );
  let results = mergeUnique(groups);

  if (results.length === 0) {
    await throttle();
    results = await searchNominatim(q);
  }

  searchCache.set(cacheKey, { at: Date.now(), results });
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
