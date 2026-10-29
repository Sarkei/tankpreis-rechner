import bcrypt from "bcryptjs";
import { pool } from "./db.ts";
import type { MeUser, AdminUserRow } from "../calc.ts";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "nagraszust@gmail.com").trim().toLowerCase();
const BCRYPT_ROUNDS = 12;

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  is_admin: boolean;
  is_active: boolean;
  person_id: number | null;
  home_label: string | null;
  home_lat: string | null;
  home_lon: string | null;
  last_login_at: string | null;
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function isAdminEmail(email: string): boolean {
  return email.trim().toLowerCase() === ADMIN_EMAIL;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function normalizeEmail(email: unknown): string {
  const value = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value)) {
    throw new AuthError(400, "Bitte eine gültige E-Mail-Adresse angeben");
  }
  return value;
}

export function checkPasswordStrength(password: unknown): string {
  const value = String(password ?? "");
  if (value.length < 8) throw new AuthError(400, "Das Passwort braucht mindestens 8 Zeichen");
  if (value.length > 200) throw new AuthError(400, "Das Passwort ist zu lang");
  return value;
}

export function normalizeName(value: unknown, label: string): string {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new AuthError(400, `${label} braucht mindestens 2 Zeichen`);
  if (name.length > 80) throw new AuthError(400, `${label} ist zu lang`);
  return name;
}

/** Person anlegen oder eine bestehende (noch nicht verknüpfte) übernehmen. */
async function resolvePersonId(personId: number | null, fullName: string): Promise<number> {
  if (personId) {
    const linked = await pool.query(`SELECT 1 FROM users WHERE person_id = $1`, [personId]);
    if (linked.rows.length > 0) throw new AuthError(409, "Diese Person gehört schon zu einem Konto");
    const exists = await pool.query(`SELECT 1 FROM persons WHERE id = $1`, [personId]);
    if (exists.rows.length === 0) throw new AuthError(400, "Diese Person gibt es nicht");
    return personId;
  }

  const sameName = await pool.query<{ id: number }>(
    `SELECT p.id FROM persons p
     LEFT JOIN users u ON u.person_id = p.id
     WHERE lower(p.name) = lower($1) AND u.id IS NULL
     LIMIT 1`,
    [fullName]
  );
  if (sameName.rows.length > 0) return Number(sameName.rows[0].id);

  const created = await pool.query<{ id: number }>(
    `INSERT INTO persons (name) VALUES ($1) RETURNING id`,
    [fullName]
  );
  return Number(created.rows[0].id);
}

export async function registerUser(input: {
  firstName: unknown;
  lastName: unknown;
  email: unknown;
  password: unknown;
  personId?: unknown;
}): Promise<{ user: UserRow; isFirstAdmin: boolean }> {
  const firstName = normalizeName(input.firstName, "Vorname");
  const lastName = normalizeName(input.lastName, "Nachname");
  const email = normalizeEmail(input.email);
  const password = checkPasswordStrength(input.password);
  const personId = input.personId ? Number(input.personId) : null;
  if (personId !== null && !Number.isInteger(personId)) throw new AuthError(400, "Ungültige Person");
  if (personId === null && isAdminEmail(email) === false) {
    // Admins dürfen sich auch ohne Person anlegen; alle anderen bekommen eine.
  }

  const existing = await pool.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
  if (existing.rows.length > 0) throw new AuthError(409, "Für diese E-Mail gibt es schon ein Konto");

  const linkedPerson = await resolvePersonId(personId, `${firstName} ${lastName}`);
  const admin = isAdminEmail(email);
  const hash = await hashPassword(password);

  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (email, password_hash, first_name, last_name, is_admin, person_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [email, hash, firstName, lastName, admin, linkedPerson]
  );

  return { user: rows[0], isFirstAdmin: admin };
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE email = $1`, [email]);
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function markLogin(id: number): Promise<void> {
  await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [id]);
}

export function toMe(user: UserRow): MeUser {
  return {
    id: Number(user.id),
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    isAdmin: Boolean(user.is_admin),
    personId: user.person_id ? Number(user.person_id) : null,
    home:
      user.home_label && user.home_lat && user.home_lon
        ? { label: user.home_label, lat: Number(user.home_lat), lon: Number(user.home_lon) }
        : null,
  };
}

export async function saveHome(
  userId: number,
  home: { label: string; lat: number; lon: number } | null
): Promise<void> {
  if (home === null) {
    await pool.query(`UPDATE users SET home_label = NULL, home_lat = NULL, home_lon = NULL WHERE id = $1`, [
      userId,
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

export async function setPassword(userId: number, password: unknown): Promise<void> {
  const value = checkPasswordStrength(password);
  const hash = await hashPassword(value);
  await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, hash]);
  await pool.query(`DELETE FROM reset_codes WHERE user_id = $1`, [userId]);
}

/** 6-stelliger Code, 15 Minuten gültig, höchstens 5 Versuche. */
export async function createResetCode(userId: number): Promise<string> {
  const code = String(Math.floor(100000 + Math.random() * 900000));
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

export async function verifyResetCode(
  email: string,
  code: string
): Promise<{ userId: number } | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;

  const { rows } = await pool.query<{ code_hash: string; attempts: number; expired: boolean }>(
    `SELECT code_hash, attempts, expires_at < NOW() AS expired FROM reset_codes WHERE user_id = $1`,
    [user.id]
  );
  const entry = rows[0];
  if (!entry || entry.expired) return null;
  if (Number(entry.attempts) >= 5) {
    throw new AuthError(429, "Zu viele Versuche – bitte neuen Code anfordern");
  }

  const ok = await bcrypt.compare(String(code).trim(), entry.code_hash);
  if (!ok) {
    await pool.query(`UPDATE reset_codes SET attempts = attempts + 1 WHERE user_id = $1`, [user.id]);
    return null;
  }
  return { userId: Number(user.id) };
}

export async function clearResetCode(userId: number): Promise<void> {
  await pool.query(`DELETE FROM reset_codes WHERE user_id = $1`, [userId]);
}

export async function enqueueMail(to: string, subject: string, body: string): Promise<void> {
  await pool.query(`INSERT INTO mail_queue (to_email, subject, body) VALUES ($1, $2, $3)`, [
    to,
    subject.slice(0, 200),
    body,
  ]);
}

/** Admin-Übersicht: alle Konten mit letztem Login und Anzahl Fahrten. */
export async function listUsers(): Promise<AdminUserRow[]> {
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
    tripsAsPassenger: Number(row.trips_as_passenger ?? 0),
  }));
}

/**
 * Konto löschen. Hängt an der verknüpften Person noch etwas (Fahrten, Zahlungen),
 * bleibt die Person bestehen – nur der Zugang verschwindet.
 */
export async function deleteUser(userId: number): Promise<{ personKept: boolean }> {
  const user = await findUserById(userId);
  if (!user) throw new AuthError(404, "Konto nicht gefunden");
  if (user.is_admin) throw new AuthError(409, "Das Admin-Konto kann nicht gelöscht werden");

  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);

  if (!user.person_id) return { personKept: false };

  const used = await pool.query<{ n: string }>(
    `SELECT ((SELECT COUNT(*) FROM trips WHERE driver_id = $1) +
             (SELECT COUNT(*) FROM trip_passengers WHERE person_id = $1) +
             (SELECT COUNT(*) FROM payments WHERE debtor_id = $1 OR creditor_id = $1))::text AS n`,
    [user.person_id]
  );
  if (Number(used.rows[0].n) > 0) return { personKept: true };

  await pool.query(`DELETE FROM persons WHERE id = $1`, [user.person_id]);
  return { personKept: false };
}
