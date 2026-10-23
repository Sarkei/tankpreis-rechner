import type { Express, Response } from "express";
import type { Pool } from "pg";
import type { AuthRequest } from "../../../server.js";

export function registerVehicleRoutes(
  app: Express,
  pool: Pool,
  requireAuth: (req: AuthRequest, res: Response, next: () => void) => void
) {
  // Get all vehicles of current user
  app.get("/api/vehicles", requireAuth, async (req: AuthRequest, res) => {
    try {
      const result = await pool.query(
        `SELECT id, name, fuel_type, consumption_per_100km, tank_capacity,
                license_plate, notes, is_default, current_fuel_price, fuel_price_updated_at,
                auto_fuel_price, fuel_price_plz, created_at
         FROM vehicles WHERE user_id = $1 ORDER BY is_default DESC, name`,
        [req.userId]
      );
      res.json(result.rows.map(mapVehicle));
    } catch (err) {
      console.error("Get vehicles error:", err);
      res.status(500).json({ error: "Fahrzeuge konnten nicht geladen werden" });
    }
  });

  // Create vehicle
  app.post("/api/vehicles", requireAuth, async (req: AuthRequest, res) => {
    const {
      name,
      fuelType,
      consumptionPer100km,
      tankCapacity,
      licensePlate,
      notes,
      isDefault,
      currentFuelPrice,
      autoFuelPrice,
      fuelPricePlz,
    } = req.body as {
      name: string;
      fuelType: string;
      consumptionPer100km: number;
      tankCapacity?: number;
      licensePlate?: string;
      notes?: string;
      isDefault?: boolean;
      currentFuelPrice?: number;
      autoFuelPrice?: boolean;
      fuelPricePlz?: string | null;
    };

    if (!name || consumptionPer100km === undefined) {
      res.status(400).json({ error: "Name und Verbrauch sind Pflichtfelder" });
      return;
    }
    const validFuelTypes = ["BENZIN", "DIESEL", "ELEKTRO", "HYBRID"];
    const ft = validFuelTypes.includes(fuelType) ? fuelType : "BENZIN";

    try {
      if (isDefault) {
        await pool.query(
          "UPDATE vehicles SET is_default = false WHERE user_id = $1",
          [req.userId]
        );
      }
      const hasFuelPrice = currentFuelPrice !== undefined && currentFuelPrice > 0;
      const autoPrice = autoFuelPrice !== false;
      const vPlz = fuelPricePlz?.trim().replace(/\D/g, "").slice(0, 5) || null;
      const result = await pool.query(
        `INSERT INTO vehicles (user_id, name, fuel_type, consumption_per_100km, tank_capacity,
                               license_plate, notes, is_default, current_fuel_price, fuel_price_updated_at,
                               auto_fuel_price, fuel_price_plz)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          req.userId,
          name.trim(),
          ft,
          consumptionPer100km,
          tankCapacity ?? null,
          licensePlate?.trim() ?? null,
          notes?.trim() ?? null,
          isDefault ?? false,
          hasFuelPrice && !autoPrice ? currentFuelPrice : null,
          hasFuelPrice && !autoPrice ? new Date() : null,
          autoPrice,
          vPlz,
        ]
      );
      res.status(201).json(mapVehicle(result.rows[0]));
    } catch (err) {
      console.error("Create vehicle error:", err);
      res.status(500).json({ error: "Fahrzeug konnte nicht erstellt werden" });
    }
  });

  // Update vehicle
  app.put("/api/vehicles/:id", requireAuth, async (req: AuthRequest, res) => {
    const vehicleId = parseInt(req.params.id);
    const {
      name,
      fuelType,
      consumptionPer100km,
      tankCapacity,
      licensePlate,
      notes,
      isDefault,
      currentFuelPrice,
      autoFuelPrice,
      fuelPricePlz,
    } = req.body as {
      name?: string;
      fuelType?: string;
      consumptionPer100km?: number;
      tankCapacity?: number;
      licensePlate?: string;
      notes?: string;
      isDefault?: boolean;
      currentFuelPrice?: number;
      autoFuelPrice?: boolean;
      fuelPricePlz?: string | null;
    };

    try {
      const check = await pool.query(
        "SELECT id FROM vehicles WHERE id = $1 AND user_id = $2",
        [vehicleId, req.userId]
      );
      if ((check.rowCount ?? 0) === 0) {
        res
          .status(404)
          .json({ error: "Fahrzeug nicht gefunden oder kein Zugriff" });
        return;
      }

      if (isDefault) {
        await pool.query(
          "UPDATE vehicles SET is_default = false WHERE user_id = $1",
          [req.userId]
        );
      }

      const validFuelTypes = ["BENZIN", "DIESEL", "ELEKTRO", "HYBRID"];
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name.trim()); }
      if (fuelType !== undefined && validFuelTypes.includes(fuelType)) {
        updates.push(`fuel_type = $${idx++}`);
        values.push(fuelType);
      }
      if (consumptionPer100km !== undefined) { updates.push(`consumption_per_100km = $${idx++}`); values.push(consumptionPer100km); }
      if (tankCapacity !== undefined) { updates.push(`tank_capacity = $${idx++}`); values.push(tankCapacity); }
      if (licensePlate !== undefined) { updates.push(`license_plate = $${idx++}`); values.push(licensePlate.trim() || null); }
      if (notes !== undefined) { updates.push(`notes = $${idx++}`); values.push(notes.trim() || null); }
      if (isDefault !== undefined) { updates.push(`is_default = $${idx++}`); values.push(isDefault); }
      if (autoFuelPrice !== undefined) { updates.push(`auto_fuel_price = $${idx++}`); values.push(autoFuelPrice); }
      if (fuelPricePlz !== undefined) {
        const vPlz = fuelPricePlz ? fuelPricePlz.trim().replace(/\D/g, "").slice(0, 5) : null;
        updates.push(`fuel_price_plz = $${idx++}`);
        values.push(vPlz);
      }
      if (currentFuelPrice !== undefined) {
        updates.push(`current_fuel_price = $${idx++}`);
        values.push(currentFuelPrice);
        updates.push(`fuel_price_updated_at = NOW()`);
      }
      updates.push(`updated_at = NOW()`);

      if (updates.length === 1) {
        res.status(400).json({ error: "Keine Änderungen" });
        return;
      }

      values.push(vehicleId);
      const result = await pool.query(
        `UPDATE vehicles SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );
      res.json(mapVehicle(result.rows[0]));
    } catch (err) {
      console.error("Update vehicle error:", err);
      res.status(500).json({ error: "Fehler beim Aktualisieren" });
    }
  });

  // Update fuel price only
  app.patch(
    "/api/vehicles/:id/fuel-price",
    requireAuth,
    async (req: AuthRequest, res) => {
      const vehicleId = parseInt(req.params.id);
      const { price } = req.body as { price: number };
      if (!price || price <= 0) {
        res.status(400).json({ error: "Ungültiger Preis" });
        return;
      }
      try {
        const check = await pool.query(
          "SELECT id FROM vehicles WHERE id = $1 AND user_id = $2",
          [vehicleId, req.userId]
        );
        if ((check.rowCount ?? 0) === 0) {
          res.status(404).json({ error: "Fahrzeug nicht gefunden" });
          return;
        }
        const result = await pool.query(
          `UPDATE vehicles SET current_fuel_price = $1, fuel_price_updated_at = NOW(), updated_at = NOW()
           WHERE id = $2 RETURNING *`,
          [price, vehicleId]
        );
        res.json(mapVehicle(result.rows[0]));
      } catch (err) {
        console.error("Update fuel price error:", err);
        res.status(500).json({ error: "Fehler beim Aktualisieren" });
      }
    }
  );

  // Delete vehicle
  app.delete(
    "/api/vehicles/:id",
    requireAuth,
    async (req: AuthRequest, res) => {
      const vehicleId = parseInt(req.params.id);
      try {
        const result = await pool.query(
          "DELETE FROM vehicles WHERE id = $1 AND user_id = $2",
          [vehicleId, req.userId]
        );
        if ((result.rowCount ?? 0) === 0) {
          res.status(404).json({ error: "Fahrzeug nicht gefunden" });
          return;
        }
        res.json({ message: "Fahrzeug gelöscht" });
      } catch (err) {
        console.error("Delete vehicle error:", err);
        res.status(500).json({ error: "Fehler beim Löschen" });
      }
    }
  );

  // Fuel log
  app.get(
    "/api/vehicles/:id/fuel-logs",
    requireAuth,
    async (req: AuthRequest, res) => {
      const vehicleId = parseInt(req.params.id);
      try {
        const check = await pool.query(
          "SELECT id FROM vehicles WHERE id = $1 AND user_id = $2",
          [vehicleId, req.userId]
        );
        if ((check.rowCount ?? 0) === 0) {
          res.status(404).json({ error: "Fahrzeug nicht gefunden" });
          return;
        }
        const result = await pool.query(
          `SELECT id, log_date, liters, price_per_liter, total_cost, odometer_km, notes
           FROM fuel_logs WHERE vehicle_id = $1 ORDER BY log_date DESC LIMIT 50`,
          [vehicleId]
        );
        res.json(result.rows.map((r) => ({
          id: r.id,
          date: r.log_date,
          liters: parseFloat(r.liters),
          pricePerLiter: parseFloat(r.price_per_liter),
          totalCost: parseFloat(r.total_cost),
          odometerKm: r.odometer_km,
          notes: r.notes,
        })));
      } catch (err) {
        console.error("Get fuel logs error:", err);
        res.status(500).json({ error: "Tankprotokoll konnte nicht geladen werden" });
      }
    }
  );

  app.post(
    "/api/vehicles/:id/fuel-logs",
    requireAuth,
    async (req: AuthRequest, res) => {
      const vehicleId = parseInt(req.params.id);
      const { date, liters, pricePerLiter, totalCost, odometerKm, notes } =
        req.body as {
          date: string;
          liters: number;
          pricePerLiter: number;
          totalCost?: number;
          odometerKm?: number;
          notes?: string;
        };
      if (!date || !liters || !pricePerLiter) {
        res.status(400).json({ error: "Datum, Liter und Preis sind Pflichtfelder" });
        return;
      }
      try {
        const check = await pool.query(
          "SELECT id FROM vehicles WHERE id = $1 AND user_id = $2",
          [vehicleId, req.userId]
        );
        if ((check.rowCount ?? 0) === 0) {
          res.status(404).json({ error: "Fahrzeug nicht gefunden" });
          return;
        }
        const cost = totalCost ?? liters * pricePerLiter;
        await pool.query(
          `INSERT INTO fuel_logs (vehicle_id, log_date, liters, price_per_liter, total_cost, odometer_km, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [vehicleId, date, liters, pricePerLiter, cost, odometerKm ?? null, notes ?? null]
        );
        // Update current price on vehicle
        await pool.query(
          `UPDATE vehicles SET current_fuel_price = $1, fuel_price_updated_at = NOW() WHERE id = $2`,
          [pricePerLiter, vehicleId]
        );
        res.status(201).json({ message: "Tankvorgang gespeichert" });
      } catch (err) {
        console.error("Create fuel log error:", err);
        res.status(500).json({ error: "Fehler beim Speichern" });
      }
    }
  );
}

function mapVehicle(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    fuelType: r.fuel_type,
    consumptionPer100km: parseFloat(r.consumption_per_100km as string),
    tankCapacity: r.tank_capacity ? parseFloat(r.tank_capacity as string) : null,
    licensePlate: r.license_plate,
    notes: r.notes,
    isDefault: r.is_default,
    currentFuelPrice: r.current_fuel_price
      ? parseFloat(r.current_fuel_price as string)
      : null,
    fuelPriceUpdatedAt: r.fuel_price_updated_at,
    autoFuelPrice: r.auto_fuel_price !== false,
    fuelPricePlz: r.fuel_price_plz ?? null,
    createdAt: r.created_at,
  };
}
