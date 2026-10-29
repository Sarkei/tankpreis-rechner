import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { findUserById, type UserRow } from "./users.ts";

const SECRET = process.env.JWT_SECRET?.trim() || "mitfahr-io-dev-secret-change-me";
const COOKIE_NAME = "mitfahr_session";
const SESSION_DAYS = 30;

export interface SessionPayload {
  sub: number;
  email: string;
  admin: boolean;
}

export interface AuthRequest extends Request {
  user?: UserRow;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function signSession(user: UserRow): string {
  const payload: SessionPayload = {
    sub: Number(user.id),
    email: user.email,
    admin: Boolean(user.is_admin),
  };
  return jwt.sign(payload, SECRET, { expiresIn: `${SESSION_DAYS}d` });
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "1",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function readSession(req: Request): SessionPayload | null {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, SECRET) as unknown as SessionPayload;
    if (!decoded || typeof decoded.sub !== "number") return null;
    return decoded;
  } catch {
    return null;
  }
}

/** Kurzlebiger Token zwischen Code-Prüfung und neuem Passwort (10 Minuten). */
export function signResetToken(userId: number): string {
  return jwt.sign({ reset: userId }, SECRET, { expiresIn: "10m" });
}

export function readResetToken(token: unknown): number | null {
  try {
    const decoded = jwt.verify(String(token ?? ""), SECRET) as unknown as { reset?: number };
    return typeof decoded.reset === "number" ? decoded.reset : null;
  } catch {
    return null;
  }
}

export async function attachUser(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
  const session = readSession(req);
  if (!session) {
    next();
    return;
  }
  const user = await findUserById(session.sub);
  if (user && user.is_active) req.user = user;
  next();
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Bitte anmelden" });
    return;
  }
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || !req.user.is_admin) {
    res.status(403).json({ error: "Nur für Admins" });
    return;
  }
  next();
}
