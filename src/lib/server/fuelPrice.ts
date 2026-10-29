import { pool } from "./db.ts";
import { round3, type FuelPriceState, type FuelTypeKey } from "../calc.ts";

export type { FuelPriceState, FuelTypeKey };
import { FUEL_TYPE_LABELS, getSettings } from "./settings.ts";

/**
 * Holt die aktuellen Spritpreise von clever-tanken.de (Daten der MTS-K).
 * clever-tanken liefert die Liste serverseitig gerendert – ein normaler
 * HTTP-Aufruf mit Browser-User-Agent genügt, kein API-Key nötig.
 */

const CLEVER_TANKEN_BASE = "https://www.clever-tanken.de/tankstelle_liste";

/** Spritsorten-Codes von clever-tanken.de (geprüft 2026-10) */
const FUEL_TYPE_CODES: Record<FuelTypeKey, number> = {
  diesel: 3,
  e10: 5,
  superplus: 6,
};

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const CACHE_TTL_MS = Number(process.env.FUEL_PRICE_TTL_HOURS ?? 6) * 60 * 60 * 1000;

interface CachedPrice {
  price: number | null;
  fuelType: string;
  plz: string;
  source: string;
  stations: number | null;
  fetchedAt: Date;
  error: string | null;
}

let memoryCache: CachedPrice | null = null;

function parsePrices(html: string): number[] {
  const prices: number[] = [];
  const re = /price-text price[^"]*">\s*([0-9])\.([0-9]{2})<sup>([0-9])<\/sup>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const value = Number(`${match[1]}.${match[2]}${match[3]}`);
    if (value > 0.2 && value < 5) prices.push(value);
  }
  return prices.sort((a, b) => a - b);
}

async function scrapePrices(plz: string, fuelType: FuelTypeKey): Promise<{ price: number; stations: number }> {
  const url = `${CLEVER_TANKEN_BASE}?ort=${encodeURIComponent(plz)}&spritsorte=${FUEL_TYPE_CODES[fuelType]}&r=10`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "de-DE,de;q=0.9",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`clever-tanken antwortete mit HTTP ${res.status}`);

  const html = await res.text();
  const prices = parsePrices(html);
  if (prices.length === 0) {
    throw new Error("Keine Tankstellen für diese PLZ gefunden");
  }

  // Durchschnitt der fünf günstigsten Tankstellen im 10-km-Umkreis
  const cheapest = prices.slice(0, Math.min(5, prices.length));
  const avg = cheapest.reduce((sum, p) => sum + p, 0) / cheapest.length;
  return { price: round3(avg), stations: prices.length };
}

async function loadCacheFromDb(): Promise<CachedPrice | null> {
  const { rows } = await pool.query(
    `SELECT price, fuel_type, plz, source, stations, fetched_at, error FROM mf_fuel_price_cache WHERE id = 1`
  );
  const row = rows[0];
  if (!row) return null;
  return {
    price: row.price === null ? null : Number(row.price),
    fuelType: row.fuel_type,
    plz: row.plz,
    source: row.source,
    stations: row.stations === null ? null : Number(row.stations),
    fetchedAt: new Date(row.fetched_at),
    error: row.error,
  };
}

async function storeCache(entry: CachedPrice): Promise<void> {
  memoryCache = entry;
  await pool.query(
    `INSERT INTO mf_fuel_price_cache (id, price, fuel_type, plz, source, stations, fetched_at, error)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       price = EXCLUDED.price,
       fuel_type = EXCLUDED.fuel_type,
       plz = EXCLUDED.plz,
       source = EXCLUDED.source,
       stations = EXCLUDED.stations,
       fetched_at = EXCLUDED.fetched_at,
       error = EXCLUDED.error`,
    [entry.price, entry.fuelType, entry.plz, entry.source, entry.stations, entry.fetchedAt, entry.error]
  );
}

function toState(settings: { plz: string; fuelType: FuelTypeKey }, cache: CachedPrice | null, stale: boolean): FuelPriceState {
  return {
    price: cache?.price ?? null,
    source: cache?.price ? (stale ? "cache" : "clever-tanken") : "none",
    fuelType: settings.fuelType,
    fuelLabel: FUEL_TYPE_LABELS[settings.fuelType],
    plz: settings.plz,
    fetchedAt: cache?.fetchedAt ? cache.fetchedAt.toISOString() : null,
    stale,
    stations: cache?.stations ?? null,
    error: cache?.error ?? null,
  };
}

/** Aktueller Spritpreis inkl. Cache. force = true ignoriert den 6-h-Cache. */
export async function getFuelPrice(force = false): Promise<FuelPriceState> {
  const settings = await getSettings();

  if (settings.priceMode === "manual" && settings.manualPrice) {
    return {
      price: settings.manualPrice,
      source: "manual",
      fuelType: settings.fuelType,
      fuelLabel: FUEL_TYPE_LABELS[settings.fuelType],
      plz: settings.plz,
      fetchedAt: null,
      stale: false,
      stations: null,
      error: null,
    };
  }

  let cache = memoryCache ?? (await loadCacheFromDb());
  const matchesSettings =
    cache !== null && cache.plz === settings.plz && cache.fuelType === settings.fuelType;
  const age = cache ? Date.now() - cache.fetchedAt.getTime() : Infinity;

  if (cache && matchesSettings && !force && age < CACHE_TTL_MS && cache.price) {
    return toState(settings, cache, false);
  }

  try {
    const { price, stations } = await scrapePrices(settings.plz, settings.fuelType);
    cache = {
      price,
      fuelType: settings.fuelType,
      plz: settings.plz,
      source: "clever-tanken",
      stations,
      fetchedAt: new Date(),
      error: null,
    };
    await storeCache(cache);
    return toState(settings, cache, false);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    const fallback = matchesSettings ? cache : null;
    if (fallback) {
      return toState(settings, { ...fallback, error: message }, true);
    }
    return {
      price: null,
      source: "none",
      fuelType: settings.fuelType,
      fuelLabel: FUEL_TYPE_LABELS[settings.fuelType],
      plz: settings.plz,
      fetchedAt: null,
      stale: true,
      stations: null,
      error: message,
    };
  }
}

/** Preis, mit dem eine neue Fahrt gerechnet wird – null wenn keiner verfügbar. */
export async function resolveTripPrice(): Promise<number | null> {
  const state = await getFuelPrice(false);
  return state.price;
}
