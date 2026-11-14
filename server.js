// server.ts
import "dotenv/config";
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// src/lib/server/db.ts
import pg from "pg";
var { Pool } = pg;
var connectionString = process.env.DATABASE_URL?.trim();
var poolSize = Number(process.env.PG_POOL_MAX ?? 5);
var pool = connectionString ? new Pool({ connectionString, max: poolSize }) : new Pool({
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? "mitfahr_io",
  user: process.env.POSTGRES_USER ?? "mitfahr",
  password: process.env.POSTGRES_PASSWORD ?? "",
  max: poolSize
});
pool.on("error", (err) => {
  console.error("\u274C PostgreSQL Pool-Fehler:", err.message);
});
async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS persons (
        id SERIAL PRIMARY KEY,
        name VARCHAR(60) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS trips (
        id SERIAL PRIMARY KEY,
        trip_date DATE NOT NULL DEFAULT CURRENT_DATE,
        direction VARCHAR(10) NOT NULL CHECK (direction IN ('HIN', 'RUECK')),
        km NUMERIC(7,2) NOT NULL CHECK (km > 0),
        driver_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
        fuel_price NUMERIC(6,3) NOT NULL CHECK (fuel_price > 0),
        consumption NUMERIC(5,2) NOT NULL CHECK (consumption > 0),
        from_label VARCHAR(200),
        to_label VARCHAR(200),
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS trip_passengers (
        trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
        PRIMARY KEY (trip_id, person_id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        debtor_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
        creditor_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
        amount NUMERIC(8,2) NOT NULL CHECK (amount > 0),
        paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(40) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS fuel_price_cache (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        price NUMERIC(6,3),
        fuel_type VARCHAR(20) NOT NULL,
        plz VARCHAR(5) NOT NULL,
        source VARCHAR(40) NOT NULL,
        stations INTEGER,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        error TEXT
      )
    `);
    await client.query(`
      ALTER TABLE trips
        ADD COLUMN IF NOT EXISTS from_label VARCHAR(200),
        ADD COLUMN IF NOT EXISTS to_label VARCHAR(200)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(80) NOT NULL,
        last_name VARCHAR(80) NOT NULL,
        is_admin BOOLEAN NOT NULL DEFAULT false,
        is_active BOOLEAN NOT NULL DEFAULT true,
        person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
        home_label VARCHAR(200),
        home_lat NUMERIC(9,6),
        home_lon NUMERIC(9,6),
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS reset_codes (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        code_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS mail_queue (
        id SERIAL PRIMARY KEY,
        to_email VARCHAR(255) NOT NULL,
        subject VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ,
        error TEXT
      )
    `);
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS home_label VARCHAR(200),
        ADD COLUMN IF NOT EXISTS home_lat NUMERIC(9,6),
        ADD COLUMN IF NOT EXISTS home_lon NUMERIC(9,6),
        ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mail_queue_pending ON mail_queue(sent_at) WHERE sent_at IS NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(trip_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_pair ON payments(debtor_id, creditor_id)`);
    console.log("\u2705 Datenbankschema bereit");
  } finally {
    client.release();
  }
}

// src/lib/calc.ts
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function round3(value) {
  return Math.round((value + Number.EPSILON) * 1e3) / 1e3;
}
function tripCost(km, consumptionPer100km, pricePerLiter) {
  if (!Number.isFinite(km) || km <= 0) return 0;
  if (!Number.isFinite(consumptionPer100km) || consumptionPer100km <= 0) return 0;
  if (!Number.isFinite(pricePerLiter) || pricePerLiter <= 0) return 0;
  return round2(km / 100 * consumptionPer100km * pricePerLiter);
}
function sharePerPerson(cost, occupants) {
  if (occupants <= 0) return 0;
  return round2(cost / occupants);
}
function cellKey(creditorId, debtorId) {
  return `${creditorId}:${debtorId}`;
}
function buildMatrix(persons, trips, pairs, paid) {
  const driverIds = /* @__PURE__ */ new Set();
  const passengerIds = /* @__PURE__ */ new Set();
  for (const trip of trips) {
    driverIds.add(trip.driverId);
    for (const p of trip.passengers) {
      if (p.id !== trip.driverId) passengerIds.add(p.id);
    }
  }
  const cells = {};
  const add = (creditorId, debtorId, amount) => {
    const key = cellKey(creditorId, debtorId);
    cells[key] = round2((cells[key] ?? 0) + amount);
  };
  for (const pair of pairs) {
    if (pair.creditorId === pair.debtorId) continue;
    add(pair.creditorId, pair.debtorId, pair.charged);
  }
  for (const pair of paid) {
    if (pair.creditorId === pair.debtorId) continue;
    add(pair.creditorId, pair.debtorId, -pair.charged);
  }
  for (const key of Object.keys(cells)) {
    if (cells[key] <= 4e-3) cells[key] = 0;
  }
  const drivers = persons.filter((p) => driverIds.has(p.id));
  const passengers = persons.filter((p) => passengerIds.has(p.id));
  const rowTotals = {};
  const colTotals = {};
  let total = 0;
  for (const driver of drivers) {
    let sum = 0;
    for (const passenger of passengers) {
      sum += cells[cellKey(driver.id, passenger.id)] ?? 0;
    }
    rowTotals[String(driver.id)] = round2(sum);
    total += sum;
  }
  for (const passenger of passengers) {
    let sum = 0;
    for (const driver of drivers) {
      sum += cells[cellKey(driver.id, passenger.id)] ?? 0;
    }
    colTotals[String(passenger.id)] = round2(sum);
  }
  return { drivers, passengers, cells, rowTotals, colTotals, total: round2(total) };
}

// src/lib/server/settings.ts
var DEFAULT_SETTINGS = {
  plz: process.env.FUEL_PLZ?.trim() || "83278",
  fuelType: "e10",
  consumption: Number(process.env.DEFAULT_CONSUMPTION ?? 8),
  priceMode: "auto",
  manualPrice: null
};
var FUEL_TYPE_LABELS = {
  diesel: "Diesel",
  e10: "Super E10",
  superplus: "SuperPlus"
};
async function getSettings() {
  const { rows } = await pool.query(`SELECT key, value FROM settings`);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const fuelType = map.get("fuel_type");
  const priceMode = map.get("price_mode");
  const manualPrice = map.get("manual_price");
  return {
    plz: map.get("plz") ?? DEFAULT_SETTINGS.plz,
    fuelType: fuelType === "diesel" || fuelType === "e10" || fuelType === "superplus" ? fuelType : DEFAULT_SETTINGS.fuelType,
    consumption: Number(map.get("consumption") ?? DEFAULT_SETTINGS.consumption),
    priceMode: priceMode === "manual" ? "manual" : "auto",
    manualPrice: manualPrice ? Number(manualPrice) : null
  };
}
async function saveSettings(patch) {
  const current = await getSettings();
  const next = {
    plz: patch.plz?.trim() || current.plz,
    fuelType: patch.fuelType ?? current.fuelType,
    consumption: patch.consumption ?? current.consumption,
    priceMode: patch.priceMode ?? current.priceMode,
    manualPrice: patch.manualPrice === void 0 ? current.manualPrice : patch.manualPrice
  };
  if (!/^\d{5}$/.test(next.plz)) throw new Error("PLZ muss aus 5 Ziffern bestehen");
  if (!(next.consumption > 0) || next.consumption > 30) throw new Error("Verbrauch muss zwischen 0 und 30 l/100 km liegen");
  if (next.priceMode === "manual" && !(Number(next.manualPrice) > 0)) {
    throw new Error("Manueller Preis fehlt");
  }
  const entries = [
    ["plz", next.plz],
    ["fuel_type", next.fuelType],
    ["consumption", String(next.consumption)],
    ["price_mode", next.priceMode],
    ["manual_price", next.manualPrice ? String(next.manualPrice) : ""]
  ];
  for (const [key, value] of entries) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    );
  }
  return next;
}

// src/lib/server/fuelPrice.ts
var CLEVER_TANKEN_BASE = "https://www.clever-tanken.de/tankstelle_liste";
var FUEL_TYPE_CODES = {
  diesel: 3,
  e10: 5,
  superplus: 6
};
var USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
var CACHE_TTL_MS = Number(process.env.FUEL_PRICE_TTL_HOURS ?? 6) * 60 * 60 * 1e3;
var memoryCache = null;
function parsePrices(html) {
  const prices = [];
  const re = /price-text price[^"]*">\s*([0-9])\.([0-9]{2})<sup>([0-9])<\/sup>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const value = Number(`${match[1]}.${match[2]}${match[3]}`);
    if (value > 0.2 && value < 5) prices.push(value);
  }
  return prices.sort((a, b) => a - b);
}
async function scrapePrices(plz, fuelType) {
  const url = `${CLEVER_TANKEN_BASE}?ort=${encodeURIComponent(plz)}&spritsorte=${FUEL_TYPE_CODES[fuelType]}&r=10`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "de-DE,de;q=0.9"
    },
    signal: AbortSignal.timeout(15e3)
  });
  if (!res.ok) throw new Error(`clever-tanken antwortete mit HTTP ${res.status}`);
  const html = await res.text();
  const prices = parsePrices(html);
  if (prices.length === 0) {
    throw new Error("Keine Tankstellen f\xFCr diese PLZ gefunden");
  }
  const cheapest = prices.slice(0, Math.min(5, prices.length));
  const avg = cheapest.reduce((sum, p) => sum + p, 0) / cheapest.length;
  return { price: round3(avg), stations: prices.length };
}
async function loadCacheFromDb() {
  const { rows } = await pool.query(
    `SELECT price, fuel_type, plz, source, stations, fetched_at, error FROM fuel_price_cache WHERE id = 1`
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
    error: row.error
  };
}
async function storeCache(entry) {
  memoryCache = entry;
  await pool.query(
    `INSERT INTO fuel_price_cache (id, price, fuel_type, plz, source, stations, fetched_at, error)
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
function toState(settings, cache, stale) {
  return {
    price: cache?.price ?? null,
    source: cache?.price ? stale ? "cache" : "clever-tanken" : "none",
    fuelType: settings.fuelType,
    fuelLabel: FUEL_TYPE_LABELS[settings.fuelType],
    plz: settings.plz,
    fetchedAt: cache?.fetchedAt ? cache.fetchedAt.toISOString() : null,
    stale,
    stations: cache?.stations ?? null,
    error: cache?.error ?? null
  };
}
async function getFuelPrice(force = false) {
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
      error: null
    };
  }
  let cache = memoryCache ?? await loadCacheFromDb();
  const matchesSettings = cache !== null && cache.plz === settings.plz && cache.fuelType === settings.fuelType;
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
      fetchedAt: /* @__PURE__ */ new Date(),
      error: null
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
      error: message
    };
  }
}
async function resolveTripPrice() {
  const state = await getFuelPrice(false);
  return state.price;
}

// src/lib/server/state.ts
async function loadPersons() {
  const { rows } = await pool.query(`SELECT id, name FROM persons ORDER BY name ASC`);
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}
async function loadTrips() {
  const { rows } = await pool.query(`
    SELECT t.id, to_char(t.trip_date, 'YYYY-MM-DD') AS trip_date, t.direction, t.km,
           t.driver_id, p.name AS driver_name, t.fuel_price, t.consumption,
           t.from_label, t.to_label, t.note, t.created_at
    FROM trips t
    JOIN persons p ON p.id = t.driver_id
    ORDER BY t.trip_date DESC, t.id DESC
  `);
  const { rows: passengerRows } = await pool.query(`
    SELECT tp.trip_id, p.id, p.name
    FROM trip_passengers tp
    JOIN persons p ON p.id = tp.person_id
    ORDER BY p.name ASC
  `);
  const byTrip = /* @__PURE__ */ new Map();
  for (const row of passengerRows) {
    const list = byTrip.get(row.trip_id) ?? [];
    list.push({ id: Number(row.id), name: row.name });
    byTrip.set(row.trip_id, list);
  }
  return rows.map((row) => {
    const km = Number(row.km);
    const fuelPrice = Number(row.fuel_price);
    const consumption = Number(row.consumption);
    const passengers = byTrip.get(row.id) ?? [];
    const cost = tripCost(km, consumption, fuelPrice);
    return {
      id: Number(row.id),
      date: row.trip_date,
      direction: row.direction,
      km,
      driverId: Number(row.driver_id),
      driverName: row.driver_name,
      fuelPrice,
      consumption,
      cost,
      share: sharePerPerson(cost, passengers.length + 1),
      passengers,
      fromLabel: row.from_label,
      toLabel: row.to_label,
      note: row.note,
      createdAt: row.created_at
    };
  });
}
async function loadPayments() {
  const { rows } = await pool.query(`
    SELECT creditor_id, debtor_id, SUM(amount)::text AS total
    FROM payments
    GROUP BY creditor_id, debtor_id
  `);
  return rows.map((r) => ({
    creditorId: Number(r.creditor_id),
    debtorId: Number(r.debtor_id),
    charged: Number(r.total)
  }));
}
function chargePairs(trips) {
  const map = /* @__PURE__ */ new Map();
  for (const trip of trips) {
    for (const passenger of trip.passengers) {
      if (passenger.id === trip.driverId) continue;
      const key = `${trip.driverId}:${passenger.id}`;
      const entry = map.get(key) ?? { creditorId: trip.driverId, debtorId: passenger.id, charged: 0 };
      entry.charged += trip.share;
      map.set(key, entry);
    }
  }
  return [...map.values()];
}
async function loadState(me = null) {
  const [persons, trips, paid, settings, fuelPrice] = await Promise.all([
    loadPersons(),
    loadTrips(),
    loadPayments(),
    getSettings(),
    getFuelPrice(false)
  ]);
  return {
    persons,
    trips,
    matrix: buildMatrix(persons, trips, chargePairs(trips), paid),
    settings,
    fuelPrice,
    me
  };
}

// src/lib/server/geo.ts
var USER_AGENT2 = "MitFahr.io/2.0 (self-hosted)";
var PHOTON = "https://photon.komoot.io/api/";
var NOMINATIM = "https://nominatim.openstreetmap.org/search";
var OSRM = "https://router.project-osrm.org/route/v1/driving";
var ZIPPO = "https://api.zippopotam.us/de";
var SEARCH_TTL_MS = 24 * 60 * 60 * 1e3;
var ROUTE_TTL_MS = 24 * 60 * 60 * 1e3;
var searchCache = /* @__PURE__ */ new Map();
var routeCache = /* @__PURE__ */ new Map();
var plzCache = /* @__PURE__ */ new Map();
var lastSearchCall = 0;
function roundKm(meters) {
  return Math.round(meters / 1e3 * 10) / 10;
}
async function throttle() {
  const wait = 1e3 - (Date.now() - lastSearchCall);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastSearchCall = Date.now();
}
var CATEGORIES = {
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
  "amenity/cafe": "Caf\xE9",
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
  "building/commercial": "Geb\xE4ude",
  "building/industrial": "Betrieb",
  "building/office": "B\xFCro",
  "building/retail": "Gesch\xE4ft",
  "building/church": "Kirche",
  "shop/supermarket": "Supermarkt",
  "shop/convenience": "Kiosk",
  "shop/bakery": "B\xE4ckerei",
  "shop/butcher": "Metzgerei",
  "shop/clothes": "Bekleidung",
  "shop/doityourself": "Baumarkt",
  "shop/electronics": "Elektronik",
  "shop/car_repair": "Werkstatt",
  "shop/hairdresser": "Friseur",
  "shop/books": "Buchhandlung",
  "shop/beverages": "Getr\xE4nkemarkt",
  "leisure/sports_centre": "Sportzentrum",
  "leisure/fitness_centre": "Fitnessstudio",
  "leisure/pitch": "Sportplatz",
  "leisure/park": "Park",
  "leisure/swimming_pool": "Schwimmbad",
  "tourism/hotel": "Hotel",
  "tourism/guest_house": "Pension",
  "tourism/museum": "Museum",
  "office/company": "Firma",
  "office/government": "Beh\xF6rde",
  "office/estate_agent": "Makler",
  "craft/*": "Betrieb",
  "landuse/construction": "Baustelle",
  "landuse/industrial": "Gewerbe",
  "landuse/residential": "Wohngebiet"
};
function categoryOf(key, value) {
  if (!key) return null;
  if (value && CATEGORIES[`${key}/${value}`]) return CATEGORIES[`${key}/${value}`];
  if (CATEGORIES[`${key}/*`]) return CATEGORIES[`${key}/*`];
  if (key === "shop" && value) return "Gesch\xE4ft";
  if (key === "office" && value) return "B\xFCro";
  return null;
}
async function plzCoords(plz) {
  const cached = plzCache.get(plz);
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.coords;
  let coords = null;
  try {
    const res = await fetch(`${ZIPPO}/${encodeURIComponent(plz)}`, {
      headers: { "User-Agent": USER_AGENT2, Accept: "application/json" },
      signal: AbortSignal.timeout(8e3)
    });
    if (res.ok) {
      const data = await res.json();
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
async function searchPhoton(query, bias) {
  const params = new URLSearchParams({ q: query, lang: "de", limit: "8" });
  if (bias) {
    params.set("lat", String(bias.lat));
    params.set("lon", String(bias.lon));
    params.set("zoom", "12");
  }
  const res = await fetch(`${PHOTON}?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT2, Accept: "application/json" },
    signal: AbortSignal.timeout(1e4)
  });
  if (!res.ok) throw new Error(`Ortssuche antwortete mit HTTP ${res.status}`);
  const data = await res.json();
  const places = [];
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
      category: categoryOf(props.osm_key, props.osm_value)
    });
  }
  return places;
}
async function searchNominatim(query) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=jsonv2&limit=6&addressdetails=0&countrycodes=de`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT2, Accept: "application/json", "Accept-Language": "de" },
    signal: AbortSignal.timeout(1e4)
  });
  if (!res.ok) throw new Error(`Ortssuche antwortete mit HTTP ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : []).map((item) => ({
    label: String(item.display_name ?? "").trim(),
    lat: Number(item.lat),
    lon: Number(item.lon),
    category: null
  })).filter((place) => place.label.length > 0 && Number.isFinite(place.lat) && Number.isFinite(place.lon));
}
var ROMAN = { "1": "I", "2": "II", "3": "III" };
var ARABIC = { I: "1", II: "2", III: "3" };
function queryVariants(query) {
  const variants = [query];
  const toRoman = query.replace(/\b([123])\b/g, (match) => ROMAN[match] ?? match);
  if (toRoman !== query) variants.push(toRoman);
  const toArabic = query.replace(/\b(III|II|I)\b/g, (match) => ARABIC[match] ?? match);
  if (toArabic !== query && !variants.includes(toArabic)) variants.push(toArabic);
  return variants.slice(0, 2);
}
function mergeUnique(groups) {
  const seen = /* @__PURE__ */ new Set();
  const merged = [];
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
var LOW_VALUE_CATEGORIES = /* @__PURE__ */ new Set([
  "Baustelle",
  "Wohngebiet",
  "Gewerbe",
  "Haltestelle",
  "Bahnsteig",
  "Bahnhalt"
]);
function normalizeText(text) {
  return text.toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss").replace(/\b(iii|ii|i)\b/g, (match) => String({ iii: 3, ii: 2, i: 1 }[match])).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function distanceScore(place, bias) {
  if (!bias) return 0;
  const dLat = place.lat - bias.lat;
  const dLon = place.lon - bias.lon;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}
function rankPlaces(places, query, bias) {
  const tokens = normalizeText(query).split(" ").filter((token) => token.length > 1 || /^\d+$/.test(token));
  return places.map((place) => {
    const namePart = normalizeText(place.label.split(",")[0]);
    const nameWords = namePart.split(" ");
    const haystack = normalizeText(`${place.label} ${place.category ?? ""}`);
    const hits = tokens.reduce((sum, token) => {
      if (/^\d+$/.test(token)) return sum + (nameWords.includes(token) ? 2 : 0);
      return sum + (haystack.includes(token) ? 1 : 0);
    }, 0);
    const low = LOW_VALUE_CATEGORIES.has(place.category ?? "") ? -2 : 0;
    return { place, score: hits + low };
  }).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return distanceScore(a.place, bias) - distanceScore(b.place, bias);
  }).map((entry) => entry.place);
}
async function searchPlaces(query, plz) {
  const q = query.trim();
  if (q.length < 3) return [];
  const cacheKey = `${plz ?? ""}|${q.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.results;
  const bias = plz && /^\d{5}$/.test(plz) ? await plzCoords(plz) : null;
  await throttle();
  const variants = queryVariants(q);
  const groups = await Promise.all(
    variants.map((variant) => searchPhoton(variant, bias).catch(() => []))
  );
  let results = rankPlaces(mergeUnique(groups), q, bias);
  if (results.length === 0) {
    await throttle();
    results = await searchNominatim(q);
  }
  searchCache.set(cacheKey, { at: Date.now(), results });
  return results;
}
async function routeKm(from, to) {
  const key = `${from.lat},${from.lon}|${to.lat},${to.lon}`;
  const cached = routeCache.get(key);
  if (cached && Date.now() - cached.at < ROUTE_TTL_MS) return cached.km;
  const url = `${OSRM}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT2, Accept: "application/json" },
    signal: AbortSignal.timeout(1e4)
  });
  if (!res.ok) throw new Error(`Streckensuche antwortete mit HTTP ${res.status}`);
  const data = await res.json();
  const distance = data.routes?.[0]?.distance;
  if (data.code !== "Ok" || typeof distance !== "number") {
    throw new Error("Keine Strecke gefunden");
  }
  const km = roundKm(distance);
  routeCache.set(key, { at: Date.now(), km });
  return km;
}

// src/lib/server/auth.ts
import jwt from "jsonwebtoken";

// src/lib/server/users.ts
import bcrypt from "bcryptjs";
var ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
var BCRYPT_ROUNDS = 12;
var AuthError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function isAdminEmail(email) {
  return email.trim().toLowerCase() === ADMIN_EMAIL;
}
async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
async function checkPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
function normalizeEmail(email) {
  const value = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value)) {
    throw new AuthError(400, "Bitte eine g\xFCltige E-Mail-Adresse angeben");
  }
  return value;
}
function passwordProblems(password) {
  const problems = [];
  if (password.length < 8) problems.push("mindestens 8 Zeichen");
  if (!/[A-ZÄÖÜ]/.test(password)) problems.push("einen Gro\xDFbuchstaben");
  if (!/[0-9]/.test(password)) problems.push("eine Zahl");
  if (!/[^A-Za-z0-9ÄÖÜäöüß]/.test(password)) problems.push("ein Sonderzeichen");
  return problems;
}
function checkPasswordStrength(password) {
  const value = String(password ?? "");
  if (value.length > 200) throw new AuthError(400, "Das Passwort ist zu lang");
  const problems = passwordProblems(value);
  if (problems.length > 0) {
    throw new AuthError(400, `Das Passwort braucht ${problems.join(", ")}`);
  }
  return value;
}
function normalizeName(value, label) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new AuthError(400, `${label} braucht mindestens 2 Zeichen`);
  if (name.length > 80) throw new AuthError(400, `${label} ist zu lang`);
  return name;
}
async function resolvePersonId(personId, fullName) {
  if (personId) {
    const linked = await pool.query(`SELECT 1 FROM users WHERE person_id = $1`, [personId]);
    if (linked.rows.length > 0) throw new AuthError(409, "Diese Person geh\xF6rt schon zu einem Konto");
    const exists = await pool.query(`SELECT 1 FROM persons WHERE id = $1`, [personId]);
    if (exists.rows.length === 0) throw new AuthError(400, "Diese Person gibt es nicht");
    return personId;
  }
  const sameName = await pool.query(
    `SELECT p.id FROM persons p
     LEFT JOIN users u ON u.person_id = p.id
     WHERE lower(p.name) = lower($1) AND u.id IS NULL
     LIMIT 1`,
    [fullName]
  );
  if (sameName.rows.length > 0) return Number(sameName.rows[0].id);
  const created = await pool.query(
    `INSERT INTO persons (name) VALUES ($1) RETURNING id`,
    [fullName]
  );
  return Number(created.rows[0].id);
}
async function registerUser(input) {
  const firstName = normalizeName(input.firstName, "Vorname");
  const lastName = normalizeName(input.lastName, "Nachname");
  const email = normalizeEmail(input.email);
  const password = checkPasswordStrength(input.password);
  const personId = input.personId ? Number(input.personId) : null;
  if (personId !== null && !Number.isInteger(personId)) throw new AuthError(400, "Ung\xFCltige Person");
  if (personId === null && isAdminEmail(email) === false) {
  }
  const existing = await pool.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
  if (existing.rows.length > 0) throw new AuthError(409, "F\xFCr diese E-Mail gibt es schon ein Konto");
  const linkedPerson = await resolvePersonId(personId, `${firstName} ${lastName}`);
  const admin = isAdminEmail(email);
  const hash = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, is_admin, person_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [email, hash, firstName, lastName, admin, linkedPerson]
  );
  return { user: rows[0], isFirstAdmin: admin };
}
async function findUserByEmail(email) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
  return rows[0] ?? null;
}
async function findUserById(id) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}
async function markLogin(id) {
  await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [id]);
}
function toMe(user) {
  return {
    id: Number(user.id),
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    isAdmin: Boolean(user.is_admin),
    personId: user.person_id ? Number(user.person_id) : null,
    home: user.home_label && user.home_lat && user.home_lon ? { label: user.home_label, lat: Number(user.home_lat), lon: Number(user.home_lon) } : null
  };
}
async function saveHome(userId, home) {
  if (home === null) {
    await pool.query(`UPDATE users SET home_label = NULL, home_lat = NULL, home_lon = NULL WHERE id = $1`, [
      userId
    ]);
    return;
  }
  const label = String(home.label ?? "").trim().slice(0, 200);
  if (label.length < 3) throw new AuthError(400, "Adresse ist zu kurz");
  if (!Number.isFinite(home.lat) || !Number.isFinite(home.lon)) throw new AuthError(400, "Koordinaten fehlen");
  await pool.query(
    `UPDATE users SET home_label = $2, home_lat = $3, home_lon = $4 WHERE id = $1`,
    [userId, label, home.lat, home.lon]
  );
}
async function setPassword(userId, password) {
  const value = checkPasswordStrength(password);
  const hash = await hashPassword(value);
  await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, hash]);
  await pool.query(`DELETE FROM reset_codes WHERE user_id = $1`, [userId]);
}
async function createResetCode(userId) {
  const code = String(Math.floor(1e5 + Math.random() * 9e5));
  const hash = await bcrypt.hash(code, 10);
  await pool.query(
    `INSERT INTO reset_codes (user_id, code_hash, expires_at, attempts)
     VALUES ($1, $2, NOW() + INTERVAL '15 minutes', 0)
     ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash,
       expires_at = EXCLUDED.expires_at, attempts = 0, created_at = NOW()`,
    [userId, hash]
  );
  return code;
}
async function verifyResetCode(email, code) {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const { rows } = await pool.query(
    `SELECT code_hash, attempts, expires_at < NOW() AS expired FROM reset_codes WHERE user_id = $1`,
    [user.id]
  );
  const entry = rows[0];
  if (!entry || entry.expired) return null;
  if (Number(entry.attempts) >= 5) {
    throw new AuthError(429, "Zu viele Versuche \u2013 bitte neuen Code anfordern");
  }
  const ok = await bcrypt.compare(String(code).trim(), entry.code_hash);
  if (!ok) {
    await pool.query(`UPDATE reset_codes SET attempts = attempts + 1 WHERE user_id = $1`, [user.id]);
    return null;
  }
  return { userId: Number(user.id) };
}
async function clearResetCode(userId) {
  await pool.query(`DELETE FROM reset_codes WHERE user_id = $1`, [userId]);
}
async function enqueueMail(to, subject, body) {
  await pool.query(`INSERT INTO mail_queue (to_email, subject, body) VALUES ($1, $2, $3)`, [
    to,
    subject.slice(0, 200),
    body
  ]);
}
async function listUsers() {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.is_admin, u.is_active,
            u.person_id, u.created_at, u.last_login_at,
            p.name AS person_name,
            (SELECT COUNT(*) FROM trips t WHERE t.driver_id = u.person_id)::int AS trips_as_driver,
            (SELECT COUNT(*) FROM trip_passengers tp WHERE tp.person_id = u.person_id)::int AS trips_as_passenger
     FROM users u
     LEFT JOIN persons p ON p.id = u.person_id
     ORDER BY u.is_admin DESC, u.created_at ASC`
  );
  return rows.map((row) => ({
    id: Number(row.id),
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    isAdmin: Boolean(row.is_admin),
    isActive: Boolean(row.is_active),
    personId: row.person_id ? Number(row.person_id) : null,
    personName: row.person_name ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    tripsAsDriver: Number(row.trips_as_driver ?? 0),
    tripsAsPassenger: Number(row.trips_as_passenger ?? 0)
  }));
}
async function deleteUser(userId) {
  const user = await findUserById(userId);
  if (!user) throw new AuthError(404, "Konto nicht gefunden");
  if (user.is_admin) throw new AuthError(409, "Das Admin-Konto kann nicht gel\xF6scht werden");
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  if (!user.person_id) return { personKept: false };
  const used = await pool.query(
    `SELECT ((SELECT COUNT(*) FROM trips WHERE driver_id = $1) +
             (SELECT COUNT(*) FROM trip_passengers WHERE person_id = $1) +
             (SELECT COUNT(*) FROM payments WHERE debtor_id = $1 OR creditor_id = $1))::text AS n`,
    [user.person_id]
  );
  if (Number(used.rows[0].n) > 0) return { personKept: true };
  await pool.query(`DELETE FROM persons WHERE id = $1`, [user.person_id]);
  return { personKept: false };
}

// src/lib/server/auth.ts
var SECRET = process.env.JWT_SECRET?.trim() ?? "";
if (SECRET.length < 32) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET fehlt oder ist zu kurz (mindestens 32 Zeichen). In der .env setzen: openssl rand -hex 32"
    );
  }
  console.warn("\u26A0\uFE0F  JWT_SECRET fehlt \u2013 es wird ein Entwicklungs-Schl\xFCssel benutzt (nur lokal!)");
}
var SESSION_SECRET = SECRET.length >= 32 ? SECRET : "mitfahr-io-development-only-secret-000000";
var COOKIE_NAME = "mitfahr_session";
var SESSION_DAYS = 30;
function parseCookies(header) {
  const out = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}
function signSession(user) {
  const payload = {
    sub: Number(user.id),
    email: user.email,
    admin: Boolean(user.is_admin)
  };
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: `${SESSION_DAYS}d` });
}
function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "1",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1e3,
    path: "/"
  });
}
function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}
function readSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    if (!decoded || typeof decoded.sub !== "number") return null;
    return decoded;
  } catch {
    return null;
  }
}
function signResetToken(userId) {
  return jwt.sign({ reset: userId }, SESSION_SECRET, { expiresIn: "10m" });
}
function readResetToken(token) {
  try {
    const decoded = jwt.verify(String(token ?? ""), SESSION_SECRET);
    return typeof decoded.reset === "number" ? decoded.reset : null;
  } catch {
    return null;
  }
}
async function attachUser(req, _res, next) {
  const session = readSession(req);
  if (!session) {
    next();
    return;
  }
  const user = await findUserById(session.sub);
  if (user && user.is_active) req.user = user;
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "Bitte anmelden" });
    return;
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    res.status(403).json({ error: "Nur f\xFCr Admins" });
    return;
  }
  next();
}

// server.ts
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var PORT = Number(process.env.PORT ?? 3e3);
var HttpError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var wrap = (fn) => (req, res, next) => {
  fn(req, res).catch(next);
};
function asId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
function asKm(value, label) {
  const km = Number(value);
  if (!Number.isFinite(km) || km <= 0) throw new HttpError(400, `${label} muss gr\xF6\xDFer als 0 sein`);
  if (km > 5e3) throw new HttpError(400, `${label} ist unrealistisch gro\xDF (max. 5000 km)`);
  return round2(km);
}
function parseLatLon(value) {
  const text = String(value ?? "");
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
function myPersonId(req) {
  return req.user?.person_id ? Number(req.user.person_id) : null;
}
function isAdminUser(req) {
  return Boolean(req.user?.is_admin);
}
var rateHits = /* @__PURE__ */ new Map();
function rateLimit(key, max = 10, windowMs = 15 * 60 * 1e3) {
  const now = Date.now();
  const entry = rateHits.get(key);
  if (!entry || now - entry.first > windowMs) {
    rateHits.set(key, { count: 1, first: now });
    return;
  }
  entry.count += 1;
  if (entry.count > max) {
    throw new HttpError(429, "Zu viele Versuche \u2013 bitte in ein paar Minuten erneut");
  }
}
async function assertPersonExists(id, label = "Person") {
  const { rows } = await pool.query(`SELECT 1 FROM persons WHERE id = $1`, [id]);
  if (rows.length === 0) throw new HttpError(400, `${label} nicht gefunden`);
}
async function startServer() {
  await initDb();
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", attachUser);
  app.get(
    "/api/health",
    wrap(async (_req, res) => {
      await pool.query("SELECT 1");
      res.json({ ok: true, uptime: Math.round(process.uptime()) });
    })
  );
  app.post(
    "/api/auth/register",
    wrap(async (req, res) => {
      const { user } = await registerUser({
        firstName: req.body?.firstName,
        lastName: req.body?.lastName,
        email: req.body?.email,
        password: req.body?.password,
        personId: req.body?.personId ?? null
      });
      await markLogin(user.id);
      setSessionCookie(res, signSession(user));
      res.status(201).json({ state: await loadState(toMe(user)) });
    })
  );
  app.post(
    "/api/auth/login",
    wrap(async (req, res) => {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const password = String(req.body?.password ?? "");
      rateLimit(`login:${req.ip ?? "?"}:${email}`);
      const user = await findUserByEmail(email);
      if (!user || !await checkPassword(password, user.password_hash)) {
        throw new HttpError(401, "E-Mail oder Passwort ist falsch");
      }
      if (!user.is_active) throw new HttpError(403, "Dieses Konto ist gesperrt");
      await markLogin(user.id);
      setSessionCookie(res, signSession(user));
      res.json({ state: await loadState(toMe(user)) });
    })
  );
  const DEMO_EMAIL = "demo@example.com";
  const demoLogin = wrap(async (_req, res) => {
    const user = await findUserByEmail(DEMO_EMAIL);
    if (!user || !user.is_active) {
      throw new HttpError(404, "Demo-Zugang ist nicht eingerichtet");
    }
    await markLogin(user.id);
    const token = signSession(user);
    setSessionCookie(res, token);
    res.json({ token, user: toMe(user) });
  });
  app.get("/api/auth/demo", demoLogin);
  app.post("/api/auth/demo", demoLogin);
  app.post(
    "/api/auth/logout",
    wrap(async (_req, res) => {
      clearSessionCookie(res);
      res.json({ ok: true });
    })
  );
  app.get(
    "/api/auth/me",
    wrap(async (req, res) => {
      res.json({ me: req.user ? toMe(req.user) : null });
    })
  );
  app.post(
    "/api/auth/forgot",
    wrap(async (req, res) => {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      rateLimit(`forgot:${req.ip ?? "?"}:${email}`, 5);
      const user = await findUserByEmail(email);
      if (user && user.is_active) {
        const code = await createResetCode(user.id);
        await enqueueMail(
          user.email,
          "MitFahr.io \u2013 dein Code zum Zur\xFCcksetzen",
          [
            `Hallo ${user.first_name},`,
            "",
            "mit diesem Code kannst du dein Passwort zur\xFCcksetzen:",
            "",
            `    ${code}`,
            "",
            "Der Code gilt 15 Minuten. Wenn du ihn nicht angefordert hast, ignoriere diese Mail.",
            "",
            "MitFahr.io"
          ].join("\n")
        );
      }
      res.json({ ok: true });
    })
  );
  app.post(
    "/api/auth/verify-code",
    wrap(async (req, res) => {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const code = String(req.body?.code ?? "").trim();
      if (!/^\d{6}$/.test(code)) throw new HttpError(400, "Bitte den 6-stelligen Code eingeben");
      const result = await verifyResetCode(email, code);
      if (!result) throw new HttpError(400, "Code ist falsch oder abgelaufen");
      res.json({ resetToken: signResetToken(result.userId) });
    })
  );
  app.post(
    "/api/auth/reset-password",
    wrap(async (req, res) => {
      const userId = readResetToken(req.body?.resetToken);
      if (!userId) throw new HttpError(400, "Der Vorgang ist abgelaufen \u2013 bitte neu anfordern");
      await setPassword(userId, req.body?.password);
      await clearResetCode(userId);
      const user = await findUserById(userId);
      if (user) {
        await markLogin(user.id);
        setSessionCookie(res, signSession(user));
      }
      res.json({ state: user ? await loadState(toMe(user)) : null });
    })
  );
  app.get(
    "/api/public/persons",
    wrap(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT p.id, p.name FROM persons p
         LEFT JOIN users u ON u.person_id = p.id
         WHERE u.id IS NULL
         ORDER BY p.name ASC`
      );
      res.json({ persons: rows.map((row) => ({ id: Number(row.id), name: row.name })) });
    })
  );
  app.use("/api", requireAuth);
  app.put(
    "/api/me/home",
    wrap(async (req, res) => {
      const home = req.body?.home;
      if (home === null) {
        await saveHome(req.user.id, null);
      } else {
        const lat = Number(home?.lat);
        const lon = Number(home?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, "Koordinaten fehlen");
        await saveHome(req.user.id, { label: String(home?.label ?? ""), lat, lon });
      }
      const user = await findUserById(req.user.id);
      res.json({ state: await loadState(user ? toMe(user) : null) });
    })
  );
  app.get(
    "/api/admin/users",
    requireAdmin,
    wrap(async (_req, res) => {
      res.json({ users: await listUsers() });
    })
  );
  app.post(
    "/api/admin/users/:id/password",
    requireAdmin,
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw new HttpError(400, "Ung\xFCltige ID");
      const user = await findUserById(id);
      if (!user) throw new HttpError(404, "Konto nicht gefunden");
      await setPassword(id, req.body?.password);
      res.json({ ok: true, email: user.email });
    })
  );
  app.delete(
    "/api/admin/users/:id",
    requireAdmin,
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw new HttpError(400, "Ung\xFCltige ID");
      const result = await deleteUser(id);
      res.json({ ok: true, personKept: result.personKept });
    })
  );
  app.get(
    "/api/state",
    wrap(async (req, res) => {
      res.json(await loadState(req.user ? toMe(req.user) : null));
    })
  );
  app.post(
    "/api/trips",
    wrap(async (req, res) => {
      const driverId = asId(req.body?.driverId);
      if (!driverId) throw new HttpError(400, "Fahrer fehlt");
      if (!isAdminUser(req) && driverId !== myPersonId(req)) {
        throw new HttpError(403, "Du kannst nur Fahrten eintragen, bei denen du selbst f\xE4hrst");
      }
      await assertPersonExists(driverId, "Fahrer");
      const rawPassengers = Array.isArray(req.body?.passengerIds) ? req.body.passengerIds : [];
      const passengerIds = [
        ...new Set(rawPassengers.map((v) => asId(v)).filter((v) => v !== null))
      ];
      if (passengerIds.includes(driverId)) {
        throw new HttpError(400, "Der Fahrer kann nicht gleichzeitig Mitfahrer sein");
      }
      for (const id of passengerIds) await assertPersonExists(id, "Mitfahrer");
      const direction = req.body?.direction;
      if (!["HIN", "RUECK", "BOTH"].includes(direction)) {
        throw new HttpError(400, "Richtung muss HIN, RUECK oder BOTH sein");
      }
      const date = String(req.body?.date ?? "").trim();
      const tripDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const note = req.body?.note ? String(req.body.note).slice(0, 200) : null;
      const fromLabel = req.body?.fromLabel ? String(req.body.fromLabel).slice(0, 200) : null;
      const toLabel = req.body?.toLabel ? String(req.body.toLabel).slice(0, 200) : null;
      const fuelPrice = await resolveTripPrice();
      if (!fuelPrice) {
        throw new HttpError(409, "Kein Tankpreis verf\xFCgbar \u2013 bitte in den Einstellungen einen Preis setzen");
      }
      const settings = await getSettings();
      const legs = [];
      if (direction === "HIN" || direction === "BOTH") {
        legs.push({ direction: "HIN", km: asKm(req.body?.km, "Kilometer Hinfahrt") });
      }
      if (direction === "RUECK" || direction === "BOTH") {
        legs.push({ direction: "RUECK", km: asKm(req.body?.kmReturn, "Kilometer R\xFCckfahrt") });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const leg of legs) {
          const { rows } = await client.query(
            `INSERT INTO trips (trip_date, direction, km, driver_id, fuel_price, consumption, from_label, to_label, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [
              tripDate,
              leg.direction,
              leg.km,
              driverId,
              fuelPrice,
              settings.consumption,
              fromLabel,
              toLabel,
              note
            ]
          );
          const tripId = rows[0].id;
          for (const personId of passengerIds) {
            await client.query(`INSERT INTO trip_passengers (trip_id, person_id) VALUES ($1, $2)`, [
              tripId,
              personId
            ]);
          }
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      res.status(201).json({ state: await loadState(req.user ? toMe(req.user) : null) });
    })
  );
  app.delete(
    "/api/trips/:id",
    wrap(async (req, res) => {
      const id = asId(req.params.id);
      if (!id) throw new HttpError(400, "Ung\xFCltige ID");
      const { rows } = await pool.query(`SELECT driver_id FROM trips WHERE id = $1`, [id]);
      if (rows.length === 0) throw new HttpError(404, "Fahrt nicht gefunden");
      if (!isAdminUser(req) && Number(rows[0].driver_id) !== myPersonId(req)) {
        throw new HttpError(403, "Nur der Fahrer oder ein Admin kann diese Fahrt l\xF6schen");
      }
      const deleted = await pool.query(`DELETE FROM trips WHERE id = $1`, [id]);
      if (deleted.rowCount === 0) throw new HttpError(404, "Fahrt nicht gefunden");
      res.json({ state: await loadState(req.user ? toMe(req.user) : null) });
    })
  );
  app.post(
    "/api/payments/settle",
    wrap(async (req, res) => {
      const debtorId = asId(req.body?.debtorId);
      if (!debtorId) throw new HttpError(400, "Mitfahrer fehlt");
      if (!isAdminUser(req) && debtorId !== myPersonId(req)) {
        throw new HttpError(403, "Du kannst nur eigene Schulden als bezahlt markieren");
      }
      const creditorId = req.body?.creditorId == null ? null : asId(req.body.creditorId);
      if (req.body?.creditorId != null && !creditorId) throw new HttpError(400, "Fahrer-ID ung\xFCltig");
      const [trips, paidRows, { rows: personRows }] = await Promise.all([
        loadTrips(),
        loadPayments(),
        pool.query(`SELECT id, name FROM persons ORDER BY name ASC`)
      ]);
      const persons = personRows.map((r) => ({ id: Number(r.id), name: r.name }));
      const matrix = buildMatrix(persons, trips, chargePairs(trips), paidRows);
      const settled = [];
      for (const driver of matrix.drivers) {
        if (creditorId && driver.id !== creditorId) continue;
        const amount = matrix.cells[`${driver.id}:${debtorId}`] ?? 0;
        if (amount > 0) settled.push({ creditorId: driver.id, debtorId, amount });
      }
      if (settled.length === 0) throw new HttpError(409, "Keine offenen Schulden gefunden");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const entry of settled) {
          await client.query(
            `INSERT INTO payments (debtor_id, creditor_id, amount, paid_on) VALUES ($1, $2, $3, CURRENT_DATE)`,
            [entry.debtorId, entry.creditorId, entry.amount]
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      const total = round2(settled.reduce((sum, e) => sum + e.amount, 0));
      res.json({ settled, total, state: await loadState(req.user ? toMe(req.user) : null) });
    })
  );
  app.get(
    "/api/geo/search",
    wrap(async (req, res) => {
      const q = String(req.query.q ?? "").trim();
      if (q.length < 3) {
        res.json({ results: [] });
        return;
      }
      try {
        const { plz } = await getSettings();
        res.json({ results: await searchPlaces(q, plz) });
      } catch (err) {
        throw new HttpError(503, err instanceof Error ? err.message : "Ortssuche nicht erreichbar");
      }
    })
  );
  app.get(
    "/api/geo/route",
    wrap(async (req, res) => {
      const from = parseLatLon(req.query.from);
      const to = parseLatLon(req.query.to);
      if (!from || !to) throw new HttpError(400, 'from/to m\xFCssen als "lat,lon" \xFCbergeben werden');
      try {
        res.json({ km: await routeKm(from, to) });
      } catch (err) {
        throw new HttpError(503, err instanceof Error ? err.message : "Streckensuche nicht erreichbar");
      }
    })
  );
  app.get(
    "/api/fuel-price",
    wrap(async (req, res) => {
      res.json(await getFuelPrice(req.query.refresh === "1"));
    })
  );
  app.put(
    "/api/settings",
    requireAdmin,
    wrap(async (req, res) => {
      const fuelType = req.body?.fuelType;
      const priceMode = req.body?.priceMode;
      try {
        await saveSettings({
          plz: req.body?.plz === void 0 ? void 0 : String(req.body.plz),
          consumption: req.body?.consumption === void 0 ? void 0 : Number(req.body.consumption),
          fuelType,
          priceMode: priceMode === "manual" || priceMode === "auto" ? priceMode : void 0,
          manualPrice: req.body?.manualPrice === void 0 || req.body?.manualPrice === null ? void 0 : Number(req.body.manualPrice)
        });
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : "Einstellungen ung\xFCltig");
      }
      const fuelPrice = await getFuelPrice(true);
      res.json({ settings: await getSettings(), fuelPrice, state: await loadState(req.user ? toMe(req.user) : null) });
    })
  );
  const distDir = path.join(__dirname, "dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { maxAge: "1h", index: false }));
    app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
  }
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const pgErr = err;
    if (pgErr.code === "23505") {
      res.status(409).json({ error: "Diesen Namen gibt es schon" });
      return;
    }
    console.error("\u274C", err);
    res.status(500).json({ error: "Interner Fehler" });
  });
  app.listen(PORT, () => {
    console.log(`\u{1F697} MitFahr.io l\xE4uft auf Port ${PORT}`);
  });
  setInterval(
    () => {
      getFuelPrice(true).catch((err) => console.error("Preis-Update fehlgeschlagen:", err));
    },
    3 * 60 * 60 * 1e3
  ).unref();
}
startServer().catch((err) => {
  console.error("\u274C Start fehlgeschlagen:", err);
  process.exit(1);
});
