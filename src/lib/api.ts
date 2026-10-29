import type { AppState } from "./calc.ts";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    throw new ApiError(res.status, String(data.error ?? `HTTP ${res.status}`));
  }
  return data as T;
}

export interface TripPayload {
  date: string;
  driverId: number;
  passengerIds: number[];
  direction: "HIN" | "RUECK" | "BOTH";
  km?: number;
  kmReturn?: number;
  note?: string | null;
}

export const api = {
  state: () => request<AppState>("/api/state"),

  addPerson: (name: string) => request<{ state: AppState }>("/api/persons", { method: "POST", body: { name } }),

  deletePerson: (id: number) => request<{ state: AppState }>(`/api/persons/${id}`, { method: "DELETE" }),

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
};
