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
import { routeKm, searchPlaces } from "./src/lib/server/geo.ts";
import {
  attachUser,
  clearSessionCookie,
  readResetToken,
  requireAdmin,
  requireAuth,
  setSessionCookie,
  signResetToken,
  signSession,
  type AuthRequest,
} from "./src/lib/server/auth.ts";
import {
  AuthError,
  checkPassword,
  clearResetCode,
  createResetCode,
  deleteUser,
  enqueueMail,
  findUserByEmail,
  findUserById,
  listUsers,
  markLogin,
  registerUser,
  saveHome,
  setPassword,
  toMe,
  verifyResetCode,
} from "./src/lib/server/users.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: AuthRequest, res: Response, next: NextFunction) => {
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

function parseLatLon(value: unknown): { lat: number; lon: number } | null {
  const text = String(value ?? "");
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

async function assertPersonExists(id: number, label = "Person"): Promise<void> {
  const { rows } = await pool.query(`SELECT 1 FROM persons WHERE id = $1`, [id]);
  if (rows.length === 0) throw new HttpError(400, `${label} nicht gefunden`);
}

async function startServer() {
  await initDb();

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", attachUser);

  // ── Health ────────────────────────────────────────────────────────────────
  app.get(
    "/api/health",
    wrap(async (_req, res) => {
      await pool.query("SELECT 1");
      res.json({ ok: true, uptime: Math.round(process.uptime()) });
    })
  );

  // ── Anmeldung ─────────────────────────────────────────────────────────────
  app.post(
    "/api/auth/register",
    wrap(async (req, res) => {
      const { user } = await registerUser({
        firstName: req.body?.firstName,
        lastName: req.body?.lastName,
        email: req.body?.email,
        password: req.body?.password,
        personId: req.body?.personId ?? null,
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
      const user = await findUserByEmail(email);
      if (!user || !(await checkPassword(password, user.password_hash))) {
        throw new HttpError(401, "E-Mail oder Passwort ist falsch");
      }
      if (!user.is_active) throw new HttpError(403, "Dieses Konto ist gesperrt");
      await markLogin(user.id);
      setSessionCookie(res, signSession(user));
      res.json({ state: await loadState(toMe(user)) });
    })
  );

  app.post(
    "/api/auth/logout",
    wrap(async (_req, res) => {
      clearSessionCookie(res);
      res.json({ ok: true });
    })
  );

  app.get(
    "/api/auth/me",
    wrap(async (req: AuthRequest, res) => {
      res.json({ me: req.user ? toMe(req.user) : null });
    })
  );

  // Passwort vergessen: Code erzeugen und in die Mail-Warteschlange legen
  app.post(
    "/api/auth/forgot",
    wrap(async (req, res) => {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const user = await findUserByEmail(email);
      if (user && user.is_active) {
        const code = await createResetCode(user.id);
        await enqueueMail(
          user.email,
          "MitFahr.io – dein Code zum Zurücksetzen",
          [
            `Hallo ${user.first_name},`,
            "",
            "mit diesem Code kannst du dein Passwort zurücksetzen:",
            "",
            `    ${code}`,
            "",
            "Der Code gilt 15 Minuten. Wenn du ihn nicht angefordert hast, ignoriere diese Mail.",
            "",
            "MitFahr.io",
          ].join("\n")
        );
      }
      // Immer dieselbe Antwort – verrät nicht, ob es die Adresse gibt
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
      if (!userId) throw new HttpError(400, "Der Vorgang ist abgelaufen – bitte neu anfordern");
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

  // Öffentlich: Namensliste für die Registrierung ("ich bin schon in der Liste")
  app.get(
    "/api/public/persons",
    wrap(async (_req, res) => {
      const { rows } = await pool.query<{ id: number; name: string }>(
        `SELECT p.id, p.name FROM persons p
         LEFT JOIN users u ON u.person_id = p.id
         WHERE u.id IS NULL
         ORDER BY p.name ASC`
      );
      res.json({ persons: rows.map((row) => ({ id: Number(row.id), name: row.name })) });
    })
  );

  // Ab hier ist alles geschützt
  app.use("/api", requireAuth);

  // ── Eigenes Konto ─────────────────────────────────────────────────────────
  app.put(
    "/api/me/home",
    wrap(async (req: AuthRequest, res) => {
      const home = req.body?.home;
      if (home === null) {
        await saveHome(req.user!.id, null);
      } else {
        const lat = Number(home?.lat);
        const lon = Number(home?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, "Koordinaten fehlen");
        await saveHome(req.user!.id, { label: String(home?.label ?? ""), lat, lon });
      }
      const user = await findUserById(req.user!.id);
      res.json({ state: await loadState(user ? toMe(user) : null) });
    })
  );

  // ── Admin ─────────────────────────────────────────────────────────────────
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
      if (!Number.isInteger(id)) throw new HttpError(400, "Ungültige ID");
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
      if (!Number.isInteger(id)) throw new HttpError(400, "Ungültige ID");
      const result = await deleteUser(id);
      res.json({ ok: true, personKept: result.personKept });
    })
  );

  // ── Kompletter Zustand ────────────────────────────────────────────────────
  app.get(
    "/api/state",
    wrap(async (req: AuthRequest, res) => {
      res.json(await loadState(req.user ? toMe(req.user) : null));
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
      const fromLabel = req.body?.fromLabel ? String(req.body.fromLabel).slice(0, 200) : null;
      const toLabel = req.body?.toLabel ? String(req.body.toLabel).slice(0, 200) : null;

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
              note,
            ]
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

      res.status(201).json({ state: await loadState(req.user ? toMe(req.user) : null) });
    })
  );

  app.delete(
    "/api/trips/:id",
    wrap(async (req, res) => {
      const id = asId(req.params.id);
      if (!id) throw new HttpError(400, "Ungültige ID");
      const deleted = await pool.query(`DELETE FROM trips WHERE id = $1`, [id]);
      if (deleted.rowCount === 0) throw new HttpError(404, "Fahrt nicht gefunden");
      res.json({ state: await loadState(req.user ? toMe(req.user) : null) });
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
      res.json({ settled, total, state: await loadState(req.user ? toMe(req.user) : null) });
    })
  );

  // ── Orte und Strecken (OpenStreetMap) ─────────────────────────────────────
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
      if (!from || !to) throw new HttpError(400, 'from/to müssen als "lat,lon" übergeben werden');
      try {
        res.json({ km: await routeKm(from, to) });
      } catch (err) {
        throw new HttpError(503, err instanceof Error ? err.message : "Streckensuche nicht erreichbar");
      }
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
      res.json({ settings: await getSettings(), fuelPrice, state: await loadState(req.user ? toMe(req.user) : null) });
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
    if (err instanceof AuthError) {
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
