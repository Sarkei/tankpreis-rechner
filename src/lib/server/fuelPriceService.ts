import type { Pool } from "pg";

const TANKERKOENIG_BASE = "https://creativecommons.tankerkoenig.de/json";

type FuelType = "BENZIN" | "DIESEL" | "ELEKTRO" | "HYBRID";

interface TankStation {
  diesel?: number;
  e5?: number;
  e10?: number;
}

interface RegionalPrices {
  BENZIN?: number;
  DIESEL?: number;
  HYBRID?: number;
}

const plzCoordCache = new Map<string, { lat: number; lng: number }>();
const priceCache = new Map<string, { prices: RegionalPrices; at: number }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function fuelFieldForType(ft: FuelType): keyof TankStation | null {
  if (ft === "DIESEL") return "diesel";
  if (ft === "BENZIN" || ft === "HYBRID") return "e5";
  return null;
}

function medianCheapest(values: number[], take = 5): number | null {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const slice = sorted.slice(0, Math.min(take, sorted.length));
  const sum = slice.reduce((a, b) => a + b, 0);
  return Math.round((sum / slice.length) * 1000) / 1000;
}

async function plzToCoords(plz: string): Promise<{ lat: number; lng: number } | null> {
  const key = plz.trim();
  const cached = plzCoordCache.get(key);
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.zippopotam.us/de/${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      places?: { latitude: string; longitude: string }[];
    };
    const place = data.places?.[0];
    if (!place) return null;
    const coords = {
      lat: parseFloat(place.latitude),
      lng: parseFloat(place.longitude),
    };
    plzCoordCache.set(key, coords);
    return coords;
  } catch {
    return null;
  }
}

async function fetchRegionalPrices(
  plz: string,
  apiKey: string
): Promise<RegionalPrices | null> {
  const cacheKey = plz;
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.prices;
  }

  const coords = await plzToCoords(plz);
  if (!coords) return null;

  const url =
    `${TANKERKOENIG_BASE}/list.php` +
    `?lat=${coords.lat}&lng=${coords.lng}&rad=10&sort=price&type=all&apikey=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      stations?: TankStation[];
    };
    if (!data.ok || !Array.isArray(data.stations) || data.stations.length === 0) {
      return null;
    }

    const diesel = medianCheapest(data.stations.map((s) => s.diesel ?? 0));
    const benzin = medianCheapest(
      data.stations.map((s) => s.e5 ?? s.e10 ?? 0)
    );

    const prices: RegionalPrices = {};
    if (benzin != null) {
      prices.BENZIN = benzin;
      prices.HYBRID = benzin;
    }
    if (diesel != null) prices.DIESEL = diesel;

    priceCache.set(cacheKey, { prices, at: Date.now() });
    return prices;
  } catch (err) {
    console.error("Tankerkoenig fetch error:", err);
    return null;
  }
}

export async function fetchRegionalPricesForPlz(
  plz: string,
  apiKey: string
): Promise<RegionalPrices | null> {
  return fetchRegionalPrices(plz, apiKey);
}

export async function updateAutoFuelPricesForUser(
  pool: Pool,
  userId: number
): Promise<{ updated: number; skipped: number; errors: number }> {
  const apiKey = process.env.TANKERKOENIG_API_KEY?.trim();
  if (!apiKey) {
    return { updated: 0, skipped: 0, errors: 0 };
  }

  const result = await pool.query(
    `SELECT v.id, v.fuel_type,
            COALESCE(NULLIF(TRIM(v.fuel_price_plz), ''), NULLIF(TRIM(u.fuel_price_plz), '')) AS plz
     FROM vehicles v
     JOIN users u ON u.id = v.user_id
     WHERE v.user_id = $1 AND v.auto_fuel_price = true
       AND v.fuel_type IN ('BENZIN', 'DIESEL', 'HYBRID')
       AND COALESCE(NULLIF(TRIM(v.fuel_price_plz), ''), NULLIF(TRIM(u.fuel_price_plz), '')) IS NOT NULL`,
    [userId]
  );

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const plzSet = [...new Set(result.rows.map((r) => r.plz as string))];

  for (const plz of plzSet) {
    const regional = await fetchRegionalPrices(plz, apiKey);
    if (!regional) {
      errors += result.rows.filter((r) => r.plz === plz).length;
      continue;
    }
    for (const row of result.rows.filter((r) => r.plz === plz)) {
      const ft = row.fuel_type as FuelType;
      if (ft === "ELEKTRO") {
        skipped++;
        continue;
      }
      const price = regional[ft];
      if (price == null || price <= 0) {
        skipped++;
        continue;
      }
      await pool.query(
        `UPDATE vehicles SET current_fuel_price = $1, fuel_price_updated_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND user_id = $3 AND auto_fuel_price = true`,
        [price, row.id, userId]
      );
      updated++;
    }
  }

  return { updated, skipped, errors };
}

export async function updateAutoFuelPrices(pool: Pool): Promise<{
  updated: number;
  skipped: number;
  errors: number;
}> {
  const apiKey = process.env.TANKERKOENIG_API_KEY?.trim();
  if (!apiKey) {
    console.warn("⚠️ TANKERKOENIG_API_KEY nicht gesetzt – automatische Preisaktualisierung übersprungen");
    return { updated: 0, skipped: 0, errors: 0 };
  }

  const result = await pool.query(
    `SELECT v.id, v.fuel_type, v.fuel_price_plz, u.fuel_price_plz AS user_plz
     FROM vehicles v
     JOIN users u ON u.id = v.user_id
     WHERE v.auto_fuel_price = true
       AND v.fuel_type IN ('BENZIN', 'DIESEL', 'HYBRID')
       AND COALESCE(NULLIF(TRIM(v.fuel_price_plz), ''), NULLIF(TRIM(u.fuel_price_plz), '')) IS NOT NULL`
  );

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  const byPlz = new Map<string, { id: number; fuelType: FuelType }[]>();
  for (const row of result.rows) {
    const plz = (row.fuel_price_plz || row.user_plz) as string;
    const list = byPlz.get(plz) ?? [];
    list.push({ id: row.id, fuelType: row.fuel_type as FuelType });
    byPlz.set(plz, list);
  }

  for (const [plz, vehicles] of byPlz) {
    const regional = await fetchRegionalPrices(plz, apiKey);
    if (!regional) {
      errors += vehicles.length;
      continue;
    }

    for (const v of vehicles) {
      if (v.fuelType === "ELEKTRO") {
        skipped++;
        continue;
      }
      const price = regional[v.fuelType];
      if (price == null || price <= 0) {
        skipped++;
        continue;
      }
      await pool.query(
        `UPDATE vehicles SET current_fuel_price = $1, fuel_price_updated_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND auto_fuel_price = true`,
        [price, v.id]
      );
      updated++;
    }

    // Rate limit: max 1 request/minute for free tier
    await new Promise((r) => setTimeout(r, 65_000));
  }

  if (updated > 0) {
    console.log(`⛽ Kraftstoffpreise aktualisiert: ${updated} Fahrzeug(e)`);
  }
  return { updated, skipped, errors };
}

let lastDailyRun = "";

export function scheduleDailyFuelPriceUpdate(pool: Pool): void {
  const check = async () => {
    const now = new Date();
    const berlin = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);

    const parts = Object.fromEntries(berlin.map((p) => [p.type, p.value]));
    const dayKey = `${parts.year}-${parts.month}-${parts.day}`;
    const hour = parseInt(parts.hour ?? "0", 10);
    const minute = parseInt(parts.minute ?? "0", 10);

    if (hour === 6 && minute >= 10 && minute < 40 && lastDailyRun !== dayKey) {
      lastDailyRun = dayKey;
      const jitter = Math.floor(Math.random() * 120_000);
      setTimeout(() => {
        updateAutoFuelPrices(pool).catch((err) =>
          console.error("Daily fuel price update failed:", err)
        );
      }, jitter);
    }
  };

  setInterval(check, 5 * 60 * 1000);
  setTimeout(check, 15_000);
}
