import { pool } from "./db.ts";
import type { AppSettings, FuelTypeKey } from "../calc.ts";

export type { AppSettings, FuelTypeKey };

export const DEFAULT_SETTINGS: AppSettings = {
  plz: process.env.FUEL_PLZ?.trim() || "83278",
  fuelType: "e10",
  consumption: Number(process.env.DEFAULT_CONSUMPTION ?? 8),
  priceMode: "auto",
  manualPrice: null,
};

export const FUEL_TYPE_LABELS: Record<FuelTypeKey, string> = {
  diesel: "Diesel",
  e10: "Super E10",
  superplus: "SuperPlus",
};

export async function getSettings(): Promise<AppSettings> {
  const { rows } = await pool.query<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const fuelType = map.get("fuel_type");
  const priceMode = map.get("price_mode");
  const manualPrice = map.get("manual_price");

  return {
    plz: map.get("plz") ?? DEFAULT_SETTINGS.plz,
    fuelType:
      fuelType === "diesel" || fuelType === "e10" || fuelType === "superplus"
        ? fuelType
        : DEFAULT_SETTINGS.fuelType,
    consumption: Number(map.get("consumption") ?? DEFAULT_SETTINGS.consumption),
    priceMode: priceMode === "manual" ? "manual" : "auto",
    manualPrice: manualPrice ? Number(manualPrice) : null,
  };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = {
    plz: patch.plz?.trim() || current.plz,
    fuelType: patch.fuelType ?? current.fuelType,
    consumption: patch.consumption ?? current.consumption,
    priceMode: patch.priceMode ?? current.priceMode,
    manualPrice: patch.manualPrice === undefined ? current.manualPrice : patch.manualPrice,
  };

  if (!/^\d{5}$/.test(next.plz)) throw new Error("PLZ muss aus 5 Ziffern bestehen");
  if (!(next.consumption > 0) || next.consumption > 30) throw new Error("Verbrauch muss zwischen 0 und 30 l/100 km liegen");
  if (next.priceMode === "manual" && !(Number(next.manualPrice) > 0)) {
    throw new Error("Manueller Preis fehlt");
  }

  const entries: [string, string][] = [
    ["plz", next.plz],
    ["fuel_type", next.fuelType],
    ["consumption", String(next.consumption)],
    ["price_mode", next.priceMode],
    ["manual_price", next.manualPrice ? String(next.manualPrice) : ""],
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
