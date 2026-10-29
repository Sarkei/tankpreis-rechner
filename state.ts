import { pool } from "./db.ts";
import { buildMatrix, sharePerPerson, tripCost, type Matrix, type Person, type Trip } from "../calc.ts";
import { getFuelPrice, type FuelPriceState } from "./fuelPrice.ts";
import { getSettings, type AppSettings } from "./settings.ts";

export interface AppState {
  persons: Person[];
  trips: Trip[];
  matrix: Matrix;
  settings: AppSettings;
  fuelPrice: FuelPriceState;
}

export async function loadPersons(): Promise<Person[]> {
  const { rows } = await pool.query<{ id: number; name: string }>(`SELECT id, name FROM mf_persons ORDER BY name ASC`);
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

interface TripRow {
  id: number;
  trip_date: string;
  direction: "HIN" | "RUECK";
  km: string;
  driver_id: number;
  driver_name: string;
  fuel_price: string;
  consumption: string;
  note: string | null;
  created_at: string;
}

export async function loadTrips(): Promise<Trip[]> {
  const { rows } = await pool.query<TripRow>(`
    SELECT t.id, to_char(t.trip_date, 'YYYY-MM-DD') AS trip_date, t.direction, t.km,
           t.driver_id, p.name AS driver_name, t.fuel_price, t.consumption, t.note, t.created_at
    FROM mf_trips t
    JOIN mf_persons p ON p.id = t.driver_id
    ORDER BY t.trip_date DESC, t.id DESC
  `);

  const { rows: passengerRows } = await pool.query<{ trip_id: number; id: number; name: string }>(`
    SELECT tp.trip_id, p.id, p.name
    FROM mf_trip_passengers tp
    JOIN mf_persons p ON p.id = tp.person_id
    ORDER BY p.name ASC
  `);

  const byTrip = new Map<number, Person[]>();
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
      note: row.note,
      createdAt: row.created_at,
    };
  });
}

export async function loadPayments(): Promise<{ creditorId: number; debtorId: number; charged: number }[]> {
  const { rows } = await pool.query<{ creditor_id: number; debtor_id: number; total: string }>(`
    SELECT creditor_id, debtor_id, SUM(amount)::text AS total
    FROM mf_payments
    GROUP BY creditor_id, debtor_id
  `);
  return rows.map((r) => ({
    creditorId: Number(r.creditor_id),
    debtorId: Number(r.debtor_id),
    charged: Number(r.total),
  }));
}

/** Summe, die jeder Mitfahrer jedem Fahrer schuldet (vor Zahlungen). */
export function chargePairs(trips: Trip[]): { creditorId: number; debtorId: number; charged: number }[] {
  const map = new Map<string, { creditorId: number; debtorId: number; charged: number }>();
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

export async function loadState(): Promise<AppState> {
  const [persons, trips, paid, settings, fuelPrice] = await Promise.all([
    loadPersons(),
    loadTrips(),
    loadPayments(),
    getSettings(),
    getFuelPrice(false),
  ]);

  return {
    persons,
    trips,
    matrix: buildMatrix(persons, trips, chargePairs(trips), paid),
    settings,
    fuelPrice,
  };
}
