import type { AdminUserRow, AppState, Person } from "./calc.ts";

/**
 * Sitzungs-Token im Browser.
 *
 * Der Server setzt zusaetzlich ein HttpOnly-Cookie; das Token hier ist der
 * Rueckfall fuer Umgebungen ohne Cookie-Zugriff und fuer den Authorization-Header.
 */
const TOKEN_KEY = "mitfahr_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null | undefined): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Speicher voll oder gesperrt - die Sitzung laeuft dann nur ueber das Cookie.
  }
}

export function clearToken(): void {
  setToken(null);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    throw new ApiError(res.status, String(data.error ?? `HTTP ${res.status}`));
  }
  return data as T;
}

export interface Place {
  label: string;
  lat: number;
  lon: number;
  /** Art des Treffers, z. B. "Schule" oder "Bahnhof" */
  category?: string | null;
}

export interface TripPayload {
  date: string;
  driverId: number;
  passengerIds: number[];
  direction: "HIN" | "RUECK" | "BOTH";
  km?: number;
  kmReturn?: number;
  fromLabel?: string | null;
  toLabel?: string | null;
  note?: string | null;
}

/** Direkter Aufruf eines beliebigen Endpunkts (fuer Routen ohne eigene Methode im api-Objekt). */
export function apiCall<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  return request<T>(path, init);
}

export const api = {
  state: () => request<AppState>("/api/state"),

  addTrip: (payload: TripPayload) => request<{ state: AppState }>("/api/trips", { method: "POST", body: payload }),

  deleteTrip: (id: number) => request<{ state: AppState }>(`/api/trips/${id}`, { method: "DELETE" }),

  settle: (debtorId: number, creditorId?: number) =>
    request<{ state: AppState; total: number }>("/api/payments/settle", {
      method: "POST",
      body: { debtorId, creditorId },
    }),

  refreshPrice: () => request<AppState["fuelPrice"]>("/api/fuel-price?refresh=1"),

  saveSettings: (patch: Partial<AppState["settings"]>) =>
    request<{ state: AppState }>("/api/settings", { method: "PUT", body: patch }),

  // ── Anmeldung ──────────────────────────────────────────────────────────
  publicPersons: () => request<{ persons: Person[] }>("/api/public/persons"),

  register: (payload: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    personId: number | null;
  }) => request<{ state: AppState }>("/api/auth/register", { method: "POST", body: payload }),

  login: (email: string, password: string) =>
    request<{ state: AppState }>("/api/auth/login", { method: "POST", body: { email, password } }),

  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: {} }),

  forgotPassword: (email: string) =>
    request<{ ok: boolean }>("/api/auth/forgot", { method: "POST", body: { email } }),

  verifyCode: (email: string, code: string) =>
    request<{ resetToken: string }>("/api/auth/verify-code", { method: "POST", body: { email, code } }),

  resetPassword: (resetToken: string, password: string) =>
    request<{ state: AppState | null }>("/api/auth/reset-password", {
      method: "POST",
      body: { resetToken, password },
    }),

  saveHome: (home: { label: string; lat: number; lon: number } | null) =>
    request<{ state: AppState }>("/api/me/home", { method: "PUT", body: { home } }),

  // ── Admin ──────────────────────────────────────────────────────────────
  adminUsers: () => request<{ users: AdminUserRow[] }>("/api/admin/users"),

  adminSetPassword: (id: number, password: string) =>
    request<{ ok: boolean; email: string }>(`/api/admin/users/${id}/password`, {
      method: "POST",
      body: { password },
    }),

  adminDeleteUser: (id: number) =>
    request<{ ok: boolean; personKept: boolean }>(`/api/admin/users/${id}`, { method: "DELETE" }),

  searchPlaces: (query: string) => request<{ results: Place[] }>(`/api/geo/search?q=${encodeURIComponent(query)}`),

  routeKm: (from: { lat: number; lon: number }, to: { lat: number; lon: number }) =>
    request<{ km: number }>(`/api/geo/route?from=${from.lat},${from.lon}&to=${to.lat},${to.lon}`),
};
