import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { pool, initDb } from "./src/lib/server/db.ts";
import { getFuelPrice, resolveTripPrice } from "./src/lib/server/fuelPrice.ts";
import { getSettings, saveSettings, type FuelTypeKey } from "./src/lib/server/settings.ts";
import { chargePairs, loadPayments, loadState, loadTrips } from "./src/lib/server/state.ts";
import { buildMatrix, round2 } from "./src/lib/calc.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

function asId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function asName(value: unknown): string {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new HttpError(400, "Name braucht mindestens 2 Zeichen");
  if (name.length > 60) throw new HttpError(400, "Name ist zu lang (max. 60 Zeichen)");
  return name;
}

function asKm(value: unknown, label: string): number {
  const km = Number(value);
  if (!Number.isFinite(km) || km <= 0) throw new HttpError(400, `${label} muss größer als 0 sein`);
  if (km > 5000) throw new HttpError(400, `${label} ist unrealistisch groß (max. 5000 km)`);
  return round2(km);
}

async function assertPersonExists(id: number, label = "Person"): Promise<void> {
  const { rows } = await pool.query(`SELECT 1 FROM persons WHERE id = $1`, [id]);
  if (rows.length === 0) throw new HttpError(400, `${label} nicht gefunden`);
}

async function startServer() {
  await initDb();

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // ── Health ────────────────────────────────────────────────────────────────
  app.get(
    "/api/health",
    wrap(async (_req, res) => {
      await pool.query("SELECT 1");
      res.json({ ok: true, uptime: Math.round(process.uptime()) });
    })
  );

  // ── Kompletter Zustand ────────────────────────────────────────────────────
  app.get(
    "/api/state",
    wrap(async (_req, res) => {
      res.json(await loadState());
    })
  );

  // ── Personen ──────────────────────────────────────────────────────────────
  app.post(
    "/api/persons",
    wrap(async (req, res) => {
      const name = asName(req.body?.name);
      const { rows } = await pool.query<{ id: number; name: string }>(
        `INSERT INTO persons (name) VALUES ($1) RETURNING id, name`,
        [name]
      );
      res.status(201).json({ person: { id: Number(rows[0].id), name: rows[0].name }, state: await loadState() });
    })
  );

  app.patch(
    "/api/persons/:id",
    wrap(async (req, res) => {
      const id = asId(req.params.id);
      if (!id) throw new HttpError(400, "Ungültige ID");
      const name = asName(req.body?.name);
      await assertPersonExists(id);
      await pool.query(`UPDATE persons SET name = $1 WHERE id = $2`, [name, id]);
      res.json({ state: await loadState() });
    })
  );

  app.delete(
    "/api/persons/:id",
    wrap(async (req, res) => {
      const id = asId(req.params.id);
      if (!id) throw new HttpError(400, "Ungültige ID");
      await assertPersonExists(id);

      const used = await pool.query<{ n: string }>(
        `SELECT (
           (SELECT COUNT(*) FROM trips WHERE driver_id = $1) +
           (SELECT COUNT(*) FROM trip_passengers WHERE person_id = $1) +
           (SELECT COUNT(*) FROM payments WHERE debtor_id = $1 OR creditor_id = $1)
         )::text AS n`,
        [id]
      );
      if (Number(used.rows[0].n) > 0) {
        throw new HttpError(409, "Person kommt in Fahrten oder Zahlungen vor und kann nicht gelöscht werden");
      }
      await pool.query(`DELETE FROM persons WHERE id = $1`, [id]);
      res.json({ state: await loadState() });
    })
  );

  // ── Fahrten ───────────────────────────────────────────────────────────────
  app.post(
    "/api/trips",
    wrap(async (req, res) => {
      const driverId = asId(req.body?.driverId);
      if (!driverId) throw new HttpError(400, "Fahrer fehlt");
      await assertPersonExists(driverId, "Fahrer");

      const rawPassengers: unknown[] = Array.isArray(req.body?.passengerIds) ? req.body.passengerIds : [];
      const passengerIds = [
        ...new Set(rawPassengers.map((v) => asId(v)).filter((v): v is number => v !== null)),
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
      const tripDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
      const note = req.body?.note ? String(req.body.note).slice(0, 200) : null;

      const fuelPrice = await resolveTripPrice();
      if (!fuelPrice) {
        throw new HttpError(409, "Kein Tankpreis verfügbar – bitte in den Einstellungen einen Preis setzen");
      }

      const settings = await getSettings();
      const legs: { direction: "HIN" | "RUECK"; km: number }[] = [];
      if (direction === "HIN" || direction === "BOTH") {
        legs.push({ direction: "HIN", km: asKm(req.body?.km, "Kilometer Hinfahrt") });
      }
      if (direction === "RUECK" || direction === "BOTH") {
        legs.push({ direction: "RUECK", km: asKm(req.body?.kmReturn, "Kilometer Rückfahrt") });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const leg of legs) {
          const { rows } = await client.query<{ id: number }>(
            `INSERT INTO trips (trip_date, direction, km, driver_id, fuel_price, consumption, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [tripDate, leg.direction, leg.km, driverId, fuelPrice, settings.consumption, note]
          );
          const tripId = rows[0].id;
          for (const personId of passengerIds) {
            await client.query(`INSERT INTO trip_passengers (trip_id, person_id) VALUES ($1, $2)`, [
              tripId,
              personId,
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

      res.status(201).json({ state: await loadState() });
    })
  );

  app.delete(
    "/api/trips/:id",
    wrap(async (req, res) => {
      const id = asId(req.params.id);
      if (!id) throw new HttpError(400, "Ungültige ID");
      const deleted = await pool.query(`DELETE FROM trips WHERE id = $1`, [id]);
      if (deleted.rowCount === 0) throw new HttpError(404, "Fahrt nicht gefunden");
      res.json({ state: await loadState() });
    })
  );

  // ── Schulden begleichen ───────────────────────────────────────────────────
  app.post(
    "/api/payments/settle",
    wrap(async (req, res) => {
      const debtorId = asId(req.body?.debtorId);
      if (!debtorId) throw new HttpError(400, "Mitfahrer fehlt");
      const creditorId = req.body?.creditorId == null ? null : asId(req.body.creditorId);
      if (req.body?.creditorId != null && !creditorId) throw new HttpError(400, "Fahrer-ID ungültig");

      const [trips, paidRows, { rows: personRows }] = await Promise.all([
        loadTrips(),
        loadPayments(),
        pool.query<{ id: number; name: string }>(`SELECT id, name FROM persons ORDER BY name ASC`),
      ]);
      const persons = personRows.map((r) => ({ id: Number(r.id), name: r.name }));
      const matrix = buildMatrix(persons, trips, chargePairs(trips), paidRows);

      const settled: { creditorId: number; debtorId: number; amount: number }[] = [];
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
      res.json({ settled, total, state: await loadState() });
    })
  );

  // ── Tankpreis ─────────────────────────────────────────────────────────────
  app.get(
    "/api/fuel-price",
    wrap(async (req, res) => {
      res.json(await getFuelPrice(req.query.refresh === "1"));
    })
  );

  // ── Einstellungen ─────────────────────────────────────────────────────────
  app.put(
    "/api/settings",
    wrap(async (req, res) => {
      const fuelType = req.body?.fuelType as FuelTypeKey | undefined;
      const priceMode = req.body?.priceMode;
      try {
        await saveSettings({
          plz: req.body?.plz === undefined ? undefined : String(req.body.plz),
          consumption: req.body?.consumption === undefined ? undefined : Number(req.body.consumption),
          fuelType,
          priceMode: priceMode === "manual" || priceMode === "auto" ? priceMode : undefined,
          manualPrice:
            req.body?.manualPrice === undefined || req.body?.manualPrice === null
              ? undefined
              : Number(req.body.manualPrice),
        });
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : "Einstellungen ungültig");
      }
      const fuelPrice = await getFuelPrice(true);
      res.json({ settings: await getSettings(), fuelPrice, state: await loadState() });
    })
  );

  // ── Frontend (Produktion) ─────────────────────────────────────────────────
  const distDir = path.join(__dirname, "dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { maxAge: "1h", index: false }));
    app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
  }

  // ── Fehlerbehandlung ──────────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const pgErr = err as Error & { code?: string };
    // Unique-Verletzung (doppelter Name)
    if (pgErr.code === "23505") {
      res.status(409).json({ error: "Diesen Namen gibt es schon" });
      return;
    }
    console.error("❌", err);
    res.status(500).json({ error: "Interner Fehler" });
  });

  app.listen(PORT, () => {
    console.log(`🚗 MitFahr.io läuft auf Port ${PORT}`);
  });

  // Spritpreis im Hintergrund frisch halten
  setInterval(
    () => {
      getFuelPrice(true).catch((err) => console.error("Preis-Update fehlgeschlagen:", err));
    },
    3 * 60 * 60 * 1000
  ).unref();
}

startServer().catch((err) => {
  console.error("❌ Start fehlgeschlagen:", err);
  process.exit(1);
});
