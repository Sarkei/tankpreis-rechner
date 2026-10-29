/** Geld- und Kostenrechnung – eine Stelle für Server und Client. */

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** Spritkosten einer Strecke: km/100 × Verbrauch (l/100 km) × Preis (€/l). */
export function tripCost(km: number, consumptionPer100km: number, pricePerLiter: number): number {
  if (!Number.isFinite(km) || km <= 0) return 0;
  if (!Number.isFinite(consumptionPer100km) || consumptionPer100km <= 0) return 0;
  if (!Number.isFinite(pricePerLiter) || pricePerLiter <= 0) return 0;
  return round2((km / 100) * consumptionPer100km * pricePerLiter);
}

/** Anteil pro Insasse (Fahrer + Mitfahrer). Der Rundungsrest trägt der Fahrer. */
export function sharePerPerson(cost: number, occupants: number): number {
  if (occupants <= 0) return 0;
  return round2(cost / occupants);
}

export interface AppState {
  persons: Person[];
  trips: Trip[];
  matrix: Matrix;
  settings: AppSettings;
  fuelPrice: FuelPriceState;
}

export type FuelTypeKey = "diesel" | "e10" | "superplus";

export interface AppSettings {
  plz: string;
  fuelType: FuelTypeKey;
  consumption: number;
  priceMode: "auto" | "manual";
  manualPrice: number | null;
}

export interface FuelPriceState {
  price: number | null;
  source: "clever-tanken" | "manual" | "cache" | "none";
  fuelType: FuelTypeKey;
  fuelLabel: string;
  plz: string;
  fetchedAt: string | null;
  stale: boolean;
  stations: number | null;
  error: string | null;
}

export interface Person {
  id: number;
  name: string;
}

export interface TripPassenger extends Person {}

export interface Trip {
  id: number;
  date: string;
  direction: "HIN" | "RUECK";
  km: number;
  driverId: number;
  driverName: string;
  fuelPrice: number;
  consumption: number;
  cost: number;
  share: number;
  passengers: TripPassenger[];
  note: string | null;
  createdAt: string;
}

export interface Matrix {
  drivers: Person[];
  passengers: Person[];
  /** Schlüssel `${creditorId}:${debtorId}` → offener Betrag */
  cells: Record<string, number>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  total: number;
}

export function cellKey(creditorId: number, debtorId: number): string {
  return `${creditorId}:${debtorId}`;
}

export interface PairCharge {
  creditorId: number;
  debtorId: number;
  charged: number;
}

/** Baut die Schulden-Matrix: Zeilen = Fahrer, Spalten = Mitfahrer. */
export function buildMatrix(
  persons: Person[],
  trips: Trip[],
  pairs: PairCharge[],
  paid: PairCharge[]
): Matrix {
  const driverIds = new Set<number>();
  const passengerIds = new Set<number>();
  for (const trip of trips) {
    driverIds.add(trip.driverId);
    for (const p of trip.passengers) {
      if (p.id !== trip.driverId) passengerIds.add(p.id);
    }
  }

  const cells: Record<string, number> = {};
  const add = (creditorId: number, debtorId: number, amount: number) => {
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
    if (cells[key] <= 0.004) cells[key] = 0;
  }

  const drivers = persons.filter((p) => driverIds.has(p.id));
  const passengers = persons.filter((p) => passengerIds.has(p.id));

  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
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
