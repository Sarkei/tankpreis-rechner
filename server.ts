import "dotenv/config";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import crypto from "crypto";
import multer from "multer";

import { registerVehicleRoutes } from "./src/lib/server/vehicleRoutes.js";
import { registerGroupRoutes } from "./src/lib/server/groupRoutes.js";
import { registerTripRoutes } from "./src/lib/server/tripRoutes.js";
import { registerPaymentRoutes } from "./src/lib/server/paymentRoutes.js";
import { registerNotificationRoutes } from "./src/lib/server/notificationRoutes.js";
import { registerStatsRoutes } from "./src/lib/server/statsRoutes.js";
import { registerExportRoutes } from "./src/lib/server/exportRoutes.js";
import { registerFuelPriceRoutes } from "./src/lib/server/fuelPriceRoutes.js";
import { scheduleDailyFuelPriceUpdate } from "./src/lib/server/fuelPriceService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET ?? "mitfahr-dev-secret-change-me";
const PORT = parseInt(process.env.PORT ?? "3000");
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const REGISTRATION_ENABLED = process.env.REGISTRATION_ENABLED !== "false";
const EMAIL_VERIFICATION_REQUIRED =
  process.env.EMAIL_VERIFICATION_REQUIRED === "true";
const ALLOW_DEV_RESET_LINK = process.env.ALLOW_DEV_RESET_LINK === "1";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "nagraszust@gmail.com").toLowerCase();

function isAdminEmail(email: string | null | undefined): boolean {
  return (email ?? "").toLowerCase() === ADMIN_EMAIL;
}

function toPublicUser(u: {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  roles: string[];
  avatar_url?: string | null;
  email_verified: boolean;
  iban?: string | null;
  fuel_price_plz?: string | null;
  created_at?: Date | string;
}) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    roles: u.roles,
    avatarUrl: u.avatar_url ?? null,
    emailVerified: u.email_verified,
    iban: u.iban ?? null,
    fuelPricePlz: u.fuel_price_plz ?? null,
    createdAt: u.created_at,
    isAdmin: isAdminEmail(u.email),
  };
}

// ─── Database Pool ────────────────────────────────────────────────────────────
export const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: parseInt(process.env.POSTGRES_PORT ?? "5432"),
  database: process.env.POSTGRES_DB ?? "mitfahr_io",
  user: process.env.POSTGRES_USER ?? "mitfahr",
  password: process.env.POSTGRES_PASSWORD ?? "mitfahr_secret",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// ─── Auth Types ───────────────────────────────────────────────────────────────
export interface AuthRequest extends Request {
  userId?: number;
}

// ─── JWT Auth Middleware ──────────────────────────────────────────────────────
export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Nicht autorisiert" });
    return;
  }
  void (async () => {
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET) as {
        userId: number;
      };
      const row = await pool.query(
        `SELECT id FROM users WHERE id = $1 AND is_active = true`,
        [payload.userId]
      );
      if (row.rowCount === 0) {
        res.status(401).json({ error: "Benutzer nicht gefunden" });
        return;
      }
      req.userId = payload.userId;
      next();
    } catch {
      res.status(401).json({ error: "Ungültiger Token" });
    }
  })();
}

export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  void (async () => {
    if (!req.userId) {
      res.status(401).json({ error: "Nicht autorisiert" });
      return;
    }
    try {
      const row = await pool.query("SELECT email FROM users WHERE id = $1", [
        req.userId,
      ]);
      if (!isAdminEmail(row.rows[0]?.email)) {
        res.status(403).json({ error: "Keine Berechtigung" });
        return;
      }
      next();
    } catch {
      res.status(500).json({ error: "Fehler bei der Berechtigung" });
    }
  })();
}

// ─── Mailer ───────────────────────────────────────────────────────────────────
function createMailer() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const mailer = createMailer();
  if (!mailer) return;
  await mailer.sendMail({
    from: process.env.SMTP_FROM ?? "noreply@mitfahr.io",
    ...opts,
  });
}

// ─── Upload ───────────────────────────────────────────────────────────────────
const uploadsDir = path.join(process.cwd(), "uploads", "avatars");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
export const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Nur Bilddateien erlaubt"));
  },
});

// ─── Database Schema ──────────────────────────────────────────────────────────
async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    // Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        roles TEXT[] NOT NULL DEFAULT '{"MITFAHRER"}',
        avatar_url VARCHAR(500),
        is_active BOOLEAN NOT NULL DEFAULT true,
        email_verified BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Password reset tokens
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(64) UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Email verification tokens
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(64) UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Vehicles
    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        fuel_type VARCHAR(20) NOT NULL DEFAULT 'BENZIN',
        consumption_per_100km DECIMAL(5,2) NOT NULL,
        tank_capacity DECIMAL(5,1),
        license_plate VARCHAR(20),
        notes TEXT,
        is_default BOOLEAN NOT NULL DEFAULT false,
        current_fuel_price DECIMAL(6,4),
        fuel_price_updated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Fuel logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS fuel_logs (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        log_date DATE NOT NULL,
        liters DECIMAL(6,2) NOT NULL,
        price_per_liter DECIMAL(6,4) NOT NULL,
        total_cost DECIMAL(8,2) NOT NULL,
        odometer_km INTEGER,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Carpool groups
    await client.query(`
      CREATE TABLE IF NOT EXISTS carpool_groups (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        invite_code VARCHAR(6) UNIQUE NOT NULL,
        cost_split_mode VARCHAR(20) NOT NULL DEFAULT 'WITHOUT_DRIVER',
        is_archived BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Group memberships
    await client.query(`
      CREATE TABLE IF NOT EXISTS group_memberships (
        id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES carpool_groups(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_active BOOLEAN NOT NULL DEFAULT true,
        UNIQUE(group_id, user_id)
      )
    `);

    // Trips
    await client.query(`
      CREATE TABLE IF NOT EXISTS trips (
        id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES carpool_groups(id) ON DELETE CASCADE,
        driver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
        trip_date DATE NOT NULL,
        fuel_price_used DECIMAL(6,4) NOT NULL,
        outbound_km DECIMAL(7,2),
        return_km DECIMAL(7,2),
        comment TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Trip participations
    await client.query(`
      CREATE TABLE IF NOT EXISTS trip_participations (
        id SERIAL PRIMARY KEY,
        trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        direction VARCHAR(10) NOT NULL,
        amount_owed DECIMAL(8,2) NOT NULL DEFAULT 0,
        UNIQUE(trip_id, user_id, direction)
      )
    `);

    // Debts (aggregated per passenger per group)
    await client.query(`
      CREATE TABLE IF NOT EXISTS debts (
        id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES carpool_groups(id) ON DELETE CASCADE,
        debtor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        creditor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        open_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(group_id, debtor_id, creditor_id)
      )
    `);

    // Payments
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES carpool_groups(id) ON DELETE CASCADE,
        payer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(8,2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'OFFEN',
        note TEXT,
        reported_at TIMESTAMPTZ,
        confirmed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Debt entries (individual bookings that make up debt)
    await client.query(`
      CREATE TABLE IF NOT EXISTS debt_entries (
        id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES carpool_groups(id) ON DELETE CASCADE,
        debtor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        creditor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
        payment_id INTEGER REFERENCES payments(id) ON DELETE CASCADE,
        amount DECIMAL(8,2) NOT NULL,
        entry_type VARCHAR(20) NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT false,
        reference_id INTEGER,
        reference_type VARCHAR(50),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Group default route settings (idempotent migration)
    await client.query(`
      ALTER TABLE carpool_groups
        ADD COLUMN IF NOT EXISTS default_outbound_km DECIMAL(7,2),
        ADD COLUMN IF NOT EXISTS default_return_km DECIMAL(7,2),
        ADD COLUMN IF NOT EXISTS default_fuel_price DECIMAL(6,4)
    `);

    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS iban VARCHAR(34),
        ADD COLUMN IF NOT EXISTS fuel_price_plz VARCHAR(5),
        ADD COLUMN IF NOT EXISTS must_set_password BOOLEAN NOT NULL DEFAULT false
    `);

    await client.query(`
      ALTER TABLE vehicles
        ADD COLUMN IF NOT EXISTS auto_fuel_price BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS fuel_price_plz VARCHAR(5)
    `);

    // Indexes for performance
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_trips_group_date ON trips(group_id, trip_date DESC)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_trip_participations_trip ON trip_participations(trip_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_trip_participations_user ON trip_participations(user_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_debts_debtor ON debts(debtor_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_debts_creditor ON debts(creditor_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_payments_group ON payments(group_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_group_memberships_group ON group_memberships(group_id, is_active)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_fuel_logs_vehicle ON fuel_logs(vehicle_id, log_date DESC)`
    );

    console.log("✅ Datenbankschema initialisiert");
  } finally {
    client.release();
  }
}

// ─── Rate Limiters ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Zu viele Anfragen, bitte warte 15 Minuten." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Express App ──────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();

  if (TRUST_PROXY) app.set("trust proxy", 1);

  app.use(express.json({ limit: "10mb" }));
  app.use(
    "/uploads",
    express.static(path.join(process.cwd(), "uploads"), {
      maxAge: "7d",
    })
  );

  // ── Health ──────────────────────────────────────────────────────────────────
  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: "error", message: "DB nicht erreichbar" });
    }
  });

  // ── Auth Routes ─────────────────────────────────────────────────────────────
  app.post("/api/auth/register", authLimiter, async (req, res) => {
    if (!REGISTRATION_ENABLED) {
      res.status(403).json({ error: "Registrierung ist deaktiviert" });
      return;
    }
    const { email, password, firstName, lastName, role, iban, fuelPricePlz } = req.body as {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      role: string;
      iban?: string;
      fuelPricePlz?: string;
    };

    if (!email || !password || !firstName || !lastName) {
      res.status(400).json({ error: "Alle Pflichtfelder ausfüllen" });
      return;
    }
    if (password.length < 8) {
      res
        .status(400)
        .json({ error: "Passwort muss mindestens 8 Zeichen haben" });
      return;
    }
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRx.test(email)) {
      res.status(400).json({ error: "Ungültige E-Mail-Adresse" });
      return;
    }

    const validRole = role === "FAHRER" ? "FAHRER" : "MITFAHRER";
    const normalizedIban = iban?.replace(/\s+/g, "").toUpperCase() || null;
    if (normalizedIban && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalizedIban)) {
      res.status(400).json({ error: "Ungültige IBAN" });
      return;
    }
    const plz = fuelPricePlz?.trim().replace(/\D/g, "").slice(0, 5) || null;
    if (plz && plz.length !== 5) {
      res.status(400).json({ error: "PLZ muss 5 Ziffern haben" });
      return;
    }

    try {
      const exists = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [email.toLowerCase()]
      );
      if ((exists.rowCount ?? 0) > 0) {
        res
          .status(409)
          .json({ error: "Diese E-Mail-Adresse ist bereits registriert" });
        return;
      }

      const hash = await bcrypt.hash(password, 12);
      const emailVerified = !EMAIL_VERIFICATION_REQUIRED;

      const user = await pool.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, roles, email_verified, iban, fuel_price_plz)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, email, first_name, last_name, roles, email_verified, iban, fuel_price_plz`,
        [
          email.toLowerCase(),
          hash,
          firstName.trim(),
          lastName.trim(),
          [validRole],
          emailVerified,
          validRole === "FAHRER" ? normalizedIban : null,
          validRole === "FAHRER" ? plz : null,
        ]
      );

      const u = user.rows[0];

      if (EMAIL_VERIFICATION_REQUIRED && !emailVerified) {
        const token = crypto.randomBytes(32).toString("hex");
        await pool.query(
          `INSERT INTO email_verification_tokens (user_id, token, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
          [u.id, token]
        );
        const verifyUrl = `${process.env.APP_BASE_URL}/verify-email?token=${token}`;
        await sendMail({
          to: u.email,
          subject: "MitFahr.io – E-Mail bestätigen",
          html: `<p>Hallo ${u.first_name},</p><p>Bitte bestätige deine E-Mail: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
        });
      }

      const token = jwt.sign({ userId: u.id }, JWT_SECRET, {
        expiresIn: "7d",
      });
      res.status(201).json({
        token,
        user: toPublicUser(u),
      });
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({ error: "Registrierung fehlgeschlagen" });
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const { email, password, rememberMe } = req.body as {
      email: string;
      password: string;
      rememberMe?: boolean;
    };
    if (!email || !password) {
      res.status(400).json({ error: "E-Mail und Passwort erforderlich" });
      return;
    }
    try {
      const result = await pool.query(
        `SELECT id, email, password_hash, first_name, last_name, roles, avatar_url, email_verified, is_active, iban, fuel_price_plz, must_set_password
         FROM users WHERE email = $1`,
        [email.toLowerCase()]
      );
      const user = result.rows[0];
      if (!user) {
        res.status(401).json({ error: "E-Mail oder Passwort falsch" });
        return;
      }
      if (!user.is_active) {
        res.status(403).json({ error: "Konto ist deaktiviert" });
        return;
      }
      if (EMAIL_VERIFICATION_REQUIRED && !user.email_verified) {
        res
          .status(403)
          .json({ error: "Bitte zuerst die E-Mail-Adresse bestätigen" });
        return;
      }
      let passwordWasSet = false;
      if (user.must_set_password) {
        if (password.length < 8) {
          res.status(400).json({
            error: "Neues Passwort muss mindestens 8 Zeichen haben",
          });
          return;
        }
        const hash = await bcrypt.hash(password, 12);
        await pool.query(
          `UPDATE users
           SET password_hash = $1, must_set_password = false, updated_at = NOW()
           WHERE id = $2`,
          [hash, user.id]
        );
        await pool.query(
          "UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false",
          [user.id]
        );
        passwordWasSet = true;
      } else {
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
          res.status(401).json({ error: "E-Mail oder Passwort falsch" });
          return;
        }
      }
      const expiresIn = rememberMe ? "30d" : "7d";
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn });
      res.json({
        token,
        passwordWasSet,
        user: toPublicUser(user),
      });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: "Login fehlgeschlagen" });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req: AuthRequest, res) => {
    try {
      const result = await pool.query(
        `SELECT id, email, first_name, last_name, roles, avatar_url, email_verified, created_at, iban, fuel_price_plz
         FROM users WHERE id = $1`,
        [req.userId]
      );
      const u = result.rows[0];
      if (!u) {
        res.status(404).json({ error: "Benutzer nicht gefunden" });
        return;
      }
      res.json(toPublicUser(u));
    } catch (err) {
      console.error("Me error:", err);
      res.status(500).json({ error: "Fehler beim Laden des Profils" });
    }
  });

  app.post("/api/auth/login-status", authLimiter, async (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) {
      res.json({ mustSetPassword: false });
      return;
    }
    try {
      const result = await pool.query(
        `SELECT must_set_password FROM users
         WHERE email = $1 AND is_active = true`,
        [email.toLowerCase()]
      );
      res.json({
        mustSetPassword: Boolean(result.rows[0]?.must_set_password),
      });
    } catch (err) {
      console.error("Login status error:", err);
      res.json({ mustSetPassword: false });
    }
  });

  app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, email, first_name, last_name, avatar_url, must_set_password, created_at
         FROM users
         ORDER BY last_name ASC, first_name ASC`
      );
      res.json(
        result.rows.map((u) => ({
          id: u.id,
          email: u.email,
          firstName: u.first_name,
          lastName: u.last_name,
          avatarUrl: u.avatar_url,
          mustSetPassword: u.must_set_password,
          createdAt: u.created_at,
        }))
      );
    } catch (err) {
      console.error("Admin users error:", err);
      res.status(500).json({ error: "Benutzer konnten nicht geladen werden" });
    }
  });

  app.post(
    "/api/admin/users/:id/require-password",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const userId = Number(req.params.id);
      if (!Number.isInteger(userId) || userId < 1) {
        res.status(400).json({ error: "Ungültiger Benutzer" });
        return;
      }
      try {
        const result = await pool.query(
          `UPDATE users
           SET must_set_password = true, updated_at = NOW()
           WHERE id = $1 AND is_active = true
           RETURNING id, first_name, last_name, email`,
          [userId]
        );
        if ((result.rowCount ?? 0) === 0) {
          res.status(404).json({ error: "Benutzer nicht gefunden" });
          return;
        }
        res.json({
          message: "Beim nächsten Anmelden muss ein neues Passwort gesetzt werden",
          user: result.rows[0],
        });
      } catch (err) {
        console.error("Require password error:", err);
        res.status(500).json({ error: "Passwort-Reset konnte nicht gesetzt werden" });
      }
    }
  );

  app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
    const { email } = req.body as { email: string };
    if (!email) {
      res.status(400).json({ error: "E-Mail erforderlich" });
      return;
    }
    try {
      const result = await pool.query(
        "SELECT id, first_name FROM users WHERE email = $1 AND is_active = true",
        [email.toLowerCase()]
      );
      const user = result.rows[0];
      if (!user) {
        // Don't reveal if email exists
        res.json({ message: "Falls die E-Mail existiert, wurde eine E-Mail gesendet" });
        return;
      }

      const token = crypto.randomBytes(32).toString("hex");
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [user.id, token]
      );

      const resetUrl = `${process.env.APP_BASE_URL}/reset-password?token=${token}`;

      if (ALLOW_DEV_RESET_LINK) {
        res.json({
          message: "Reset-Link (nur Dev-Modus)",
          devResetUrl: resetUrl,
        });
        return;
      }

      await sendMail({
        to: email,
        subject: "MitFahr.io – Passwort zurücksetzen",
        html: `<p>Hallo ${user.first_name},</p>
               <p>Klicke hier um dein Passwort zurückzusetzen (gültig 1 Stunde):</p>
               <p><a href="${resetUrl}">${resetUrl}</a></p>
               <p>Falls du das nicht angefordert hast, ignoriere diese E-Mail.</p>`,
      });
      res.json({ message: "Falls die E-Mail existiert, wurde eine E-Mail gesendet" });
    } catch (err) {
      console.error("Forgot password error:", err);
      res.status(500).json({ error: "Fehler beim Zurücksetzen" });
    }
  });

  app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
    const { token, password } = req.body as {
      token: string;
      password: string;
    };
    if (!token || !password) {
      res.status(400).json({ error: "Token und neues Passwort erforderlich" });
      return;
    }
    if (password.length < 8) {
      res
        .status(400)
        .json({ error: "Passwort muss mindestens 8 Zeichen haben" });
      return;
    }
    try {
      const result = await pool.query(
        `SELECT prt.id, prt.user_id FROM password_reset_tokens prt
         WHERE prt.token = $1 AND prt.used = false AND prt.expires_at > NOW()`,
        [token]
      );
      if ((result.rowCount ?? 0) === 0) {
        res.status(400).json({ error: "Token ungültig oder abgelaufen" });
        return;
      }
      const { id: tokenId, user_id } = result.rows[0];
      const hash = await bcrypt.hash(password, 12);
      await pool.query(
        "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
        [hash, user_id]
      );
      await pool.query(
        "UPDATE password_reset_tokens SET used = true WHERE id = $1",
        [tokenId]
      );
      res.json({ message: "Passwort erfolgreich geändert" });
    } catch (err) {
      console.error("Reset password error:", err);
      res.status(500).json({ error: "Fehler beim Zurücksetzen" });
    }
  });

  app.post(
    "/api/auth/change-password",
    requireAuth,
    async (req: AuthRequest, res) => {
      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };
      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: "Alle Felder erforderlich" });
        return;
      }
      if (newPassword.length < 8) {
        res
          .status(400)
          .json({ error: "Neues Passwort muss mindestens 8 Zeichen haben" });
        return;
      }
      try {
        const result = await pool.query(
          "SELECT password_hash FROM users WHERE id = $1",
          [req.userId]
        );
        const valid = await bcrypt.compare(
          currentPassword,
          result.rows[0].password_hash
        );
        if (!valid) {
          res.status(401).json({ error: "Aktuelles Passwort falsch" });
          return;
        }
        const hash = await bcrypt.hash(newPassword, 12);
        await pool.query(
          "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
          [hash, req.userId]
        );
        res.json({ message: "Passwort erfolgreich geändert" });
      } catch (err) {
        console.error("Change password error:", err);
        res.status(500).json({ error: "Fehler beim Ändern" });
      }
    }
  );

  // ── Profile Routes ──────────────────────────────────────────────────────────
  app.put(
    "/api/profile",
    requireAuth,
    async (req: AuthRequest, res) => {
      const { firstName, lastName, email, iban, fuelPricePlz } = req.body as {
        firstName?: string;
        lastName?: string;
        email?: string;
        iban?: string | null;
        fuelPricePlz?: string | null;
      };
      try {
        const updates: string[] = [];
        const values: unknown[] = [];
        let idx = 1;
        if (firstName) { updates.push(`first_name = $${idx++}`); values.push(firstName.trim()); }
        if (lastName) { updates.push(`last_name = $${idx++}`); values.push(lastName.trim()); }
        if (email) {
          const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRx.test(email)) {
            res.status(400).json({ error: "Ungültige E-Mail-Adresse" });
            return;
          }
          const exists = await pool.query(
            "SELECT id FROM users WHERE email = $1 AND id != $2",
            [email.toLowerCase(), req.userId]
          );
          if ((exists.rowCount ?? 0) > 0) {
            res.status(409).json({ error: "E-Mail bereits vergeben" });
            return;
          }
          updates.push(`email = $${idx++}`);
          values.push(email.toLowerCase());
        }
        if (iban !== undefined) {
          const normalized = iban ? iban.replace(/\s+/g, "").toUpperCase() : null;
          if (normalized && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalized)) {
            res.status(400).json({ error: "Ungültige IBAN" });
            return;
          }
          updates.push(`iban = $${idx++}`);
          values.push(normalized);
        }
        if (fuelPricePlz !== undefined) {
          const plz = fuelPricePlz ? fuelPricePlz.trim().replace(/\D/g, "").slice(0, 5) : null;
          if (plz && plz.length !== 5) {
            res.status(400).json({ error: "PLZ muss 5 Ziffern haben" });
            return;
          }
          updates.push(`fuel_price_plz = $${idx++}`);
          values.push(plz);
        }
        if (updates.length === 0) {
          res.status(400).json({ error: "Keine Änderungen" });
          return;
        }
        updates.push(`updated_at = NOW()`);
        values.push(req.userId);
        const result = await pool.query(
          `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx} RETURNING id, email, first_name, last_name, roles, avatar_url, iban, fuel_price_plz`,
          values
        );
        const u = result.rows[0];
        res.json({
          id: u.id,
          email: u.email,
          firstName: u.first_name,
          lastName: u.last_name,
          roles: u.roles,
          avatarUrl: u.avatar_url,
          iban: u.iban,
          fuelPricePlz: u.fuel_price_plz,
        });
      } catch (err) {
        console.error("Update profile error:", err);
        res.status(500).json({ error: "Fehler beim Aktualisieren" });
      }
    }
  );

  app.post(
    "/api/profile/avatar",
    requireAuth,
    uploadAvatar.single("avatar"),
    async (req: AuthRequest, res) => {
      if (!req.file) {
        res.status(400).json({ error: "Kein Bild hochgeladen" });
        return;
      }
      try {
        const avatarUrl = `/uploads/avatars/${req.file.filename}`;
        await pool.query(
          "UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2",
          [avatarUrl, req.userId]
        );
        res.json({ avatarUrl });
      } catch (err) {
        console.error("Avatar upload error:", err);
        res.status(500).json({ error: "Fehler beim Hochladen" });
      }
    }
  );

  app.put(
    "/api/profile/roles",
    requireAuth,
    async (req: AuthRequest, res) => {
      const { roles } = req.body as { roles: string[] };
      const validRoles = ["FAHRER", "MITFAHRER"];
      if (
        !Array.isArray(roles) ||
        roles.length === 0 ||
        !roles.every((r) => validRoles.includes(r))
      ) {
        res.status(400).json({ error: "Ungültige Rollen" });
        return;
      }
      try {
        await pool.query(
          "UPDATE users SET roles = $1, updated_at = NOW() WHERE id = $2",
          [roles, req.userId]
        );
        res.json({ roles });
      } catch (err) {
        console.error("Update roles error:", err);
        res.status(500).json({ error: "Fehler beim Aktualisieren" });
      }
    }
  );

  // Email verification
  app.post("/api/auth/verify-email", async (req, res) => {
    const { token } = req.body as { token: string };
    if (!token) {
      res.status(400).json({ error: "Token erforderlich" });
      return;
    }
    try {
      const result = await pool.query(
        `SELECT user_id FROM email_verification_tokens
         WHERE token = $1 AND expires_at > NOW()`,
        [token]
      );
      if ((result.rowCount ?? 0) === 0) {
        res.status(400).json({ error: "Token ungültig oder abgelaufen" });
        return;
      }
      const { user_id } = result.rows[0];
      await pool.query(
        "UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = $1",
        [user_id]
      );
      await pool.query(
        "DELETE FROM email_verification_tokens WHERE user_id = $1",
        [user_id]
      );
      res.json({ message: "E-Mail erfolgreich bestätigt" });
    } catch (err) {
      console.error("Verify email error:", err);
      res.status(500).json({ error: "Fehler bei der Verifizierung" });
    }
  });

  // ── Register domain routes ─────────────────────────────────────────────────
  registerVehicleRoutes(app, pool, requireAuth);
  registerGroupRoutes(app, pool, requireAuth);
  registerTripRoutes(app, pool, requireAuth);
  registerPaymentRoutes(app, pool, requireAuth);
  registerNotificationRoutes(app, pool, requireAuth);
  registerStatsRoutes(app, pool, requireAuth);
  registerExportRoutes(app, pool, requireAuth);
  registerFuelPriceRoutes(app, pool, requireAuth);

  // ── SPA fallback ───────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) =>
      res.sendFile(path.join(distPath, "index.html"))
    );
  }

  await initDb();
  scheduleDailyFuelPriceUpdate(pool);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚗 MitFahr.io → http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
