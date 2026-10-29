import { Check, Fuel, Home, Route, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  sharePerPerson,
  tripCost,
  type AppSettings,
  type FuelPriceState,
  type MeUser,
  type Person,
} from "../lib/calc.ts";
import { eur, kmLabel, pricePerLiter, todayIso } from "../lib/format.ts";
import type { Place, TripPayload } from "../lib/api.ts";
import { Button, Field, Modal, Segmented } from "./ui.tsx";
import { RouteField } from "./RouteField.tsx";
import { api } from "../lib/api.ts";

type Direction = "HIN" | "RUECK" | "BOTH";

export function TripDialog({
  open,
  persons,
  settings,
  fuelPrice,
  me,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  persons: Person[];
  settings: AppSettings;
  fuelPrice: FuelPriceState;
  me: MeUser | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: TripPayload) => Promise<boolean>;
}) {
  const [date, setDate] = useState(todayIso());
  const [direction, setDirection] = useState<Direction>("BOTH");
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [km, setKm] = useState("");
  const [kmReturn, setKmReturn] = useState("");
  const [kmTouched, setKmTouched] = useState(false);
  const [kmReturnTouched, setKmReturnTouched] = useState(false);
  const [driverId, setDriverId] = useState<number | null>(null);
  const [passengerIds, setPassengerIds] = useState<number[]>([]);
  const [routeState, setRouteState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [routeError, setRouteError] = useState<string | null>(null);

  const meId = me?.personId ?? null;
  const price = fuelPrice.price;

  // Beim Öffnen sinnvoll vorbelegen: ich als Fahrer
  useEffect(() => {
    if (!open) return;
    setDate(todayIso());
    setDirection("BOTH");
    setFrom(null);
    setTo(null);
    setKm("");
    setKmReturn("");
    setKmTouched(false);
    setKmReturnTouched(false);
    setDriverId(meId ?? persons[0]?.id ?? null);
    setPassengerIds([]);
    setRouteState("idle");
    setRouteError(null);
  }, [open, meId, persons]);

  // Strecke automatisch aus den beiden Orten berechnen
  useEffect(() => {
    if (!from || !to) {
      setRouteState("idle");
      return;
    }
    let cancelled = false;
    setRouteState("loading");
    api
      .routeKm({ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon })
      .then(({ km: distance }) => {
        if (cancelled) return;
        const value = String(distance).replace(".", ",");
        if (!kmTouched) setKm(value);
        if (!kmReturnTouched) setKmReturn(value);
        setRouteState("done");
        setRouteError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setRouteState("error");
        setRouteError(err instanceof Error ? err.message : "Strecke nicht gefunden");
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, kmTouched, kmReturnTouched]);

  const activeDriverId = driverId ?? persons[0]?.id ?? null;

  const preview = useMemo(() => {
    if (!price) return null;
    const parse = (value: string) => Number(value.replace(",", "."));
    const legs: { label: string; km: number }[] = [];
    if (direction !== "RUECK") legs.push({ label: "Hin", km: parse(km) });
    if (direction !== "HIN") legs.push({ label: "Rück", km: parse(kmReturn) });

    const parts = legs
      .filter((leg) => Number.isFinite(leg.km) && leg.km > 0)
      .map((leg) => ({ ...leg, cost: tripCost(leg.km, settings.consumption, price) }));
    if (parts.length === 0) return null;

    const occupants = passengerIds.length + 1;
    const total = parts.reduce((sum, part) => sum + part.cost, 0);
    return { parts, total, share: sharePerPerson(total, occupants), occupants };
  }, [direction, km, kmReturn, passengerIds.length, price, settings.consumption]);

  const kmValue = Number(km.replace(",", "."));
  const kmReturnValue = Number(kmReturn.replace(",", "."));
  const canSubmit =
    !busy &&
    Boolean(price) &&
    Boolean(activeDriverId) &&
    (direction === "RUECK" || kmValue > 0) &&
    (direction === "HIN" || kmReturnValue > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!activeDriverId || !canSubmit) return;
    const ok = await onSubmit({
      date,
      driverId: activeDriverId,
      passengerIds,
      direction,
      km: direction === "RUECK" ? undefined : kmValue,
      kmReturn: direction === "HIN" ? undefined : kmReturnValue,
      fromLabel: from?.label ?? null,
      toLabel: to?.label ?? null,
    });
    if (ok) onClose();
  }

  function togglePassenger(id: number) {
    setPassengerIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Fahrt eintragen"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            <Save className="h-4 w-4" />
            {busy ? "Speichert…" : "Speichern"}
          </Button>
        </>
      }
    >
      {persons.length === 0 ? (
        <p className="text-sm text-zinc-400">
          Lege zuerst in den Einstellungen Personen an – danach kannst du Fahrten eintragen.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Datum">
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </Field>
            <Field label="Fahrer">
              <select
                value={activeDriverId ?? ""}
                onChange={(event) => {
                  const id = Number(event.target.value);
                  setDriverId(id);
                  setPassengerIds((current) => current.filter((value) => value !== id));
                }}
              >
                {persons.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.id === meId ? " (ich)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              <Route className="h-3.5 w-3.5" />
              Strecke
            </div>
            <div className="space-y-1">
              <RouteField label="Von" value={from} onChange={setFrom} placeholder="z. B. Bahnhof Traunstein" />
              {me?.home && (
                <button
                  type="button"
                  onClick={() => setFrom({ ...me.home! })}
                  className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  <Home className="h-3 w-3" /> Zuhause übernehmen
                </button>
              )}
            </div>
            <div className="space-y-1">
              <RouteField
                label="Nach"
                value={to}
                onChange={setTo}
                placeholder="z. B. Berufsschule 1 Traunstein"
              />
              {me?.home && (
                <button
                  type="button"
                  onClick={() => setTo({ ...me.home! })}
                  className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  <Home className="h-3 w-3" /> Zuhause als Ziel
                </button>
              )}
            </div>
            {routeState === "loading" && <p className="text-xs text-zinc-400">Strecke wird berechnet…</p>}
            {routeState === "done" && (
              <p className="text-xs text-emerald-400">
                Strecke berechnet – Kilometer unten angepasst, bei Bedarf überschreiben.
              </p>
            )}
            {routeState === "error" && <p className="text-xs text-amber-400">{routeError}</p>}
          </div>

          <Field label="Richtung">
            <Segmented
              value={direction}
              onChange={setDirection}
              options={[
                { value: "HIN", label: "Hinfahrt" },
                { value: "RUECK", label: "Rückfahrt" },
                { value: "BOTH", label: "Hin & Rück" },
              ]}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            {direction !== "RUECK" && (
              <Field label="Kilometer hin">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="z. B. 24"
                  value={km}
                  onChange={(event) => {
                    setKm(event.target.value);
                    setKmTouched(true);
                  }}
                />
              </Field>
            )}
            {direction !== "HIN" && (
              <Field label="Kilometer zurück">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="z. B. 24"
                  value={kmReturn}
                  onChange={(event) => {
                    setKmReturn(event.target.value);
                    setKmReturnTouched(true);
                  }}
                />
              </Field>
            )}
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Mitfahrer</span>
            <div className="flex flex-wrap gap-2">
              {persons
                .filter((person) => person.id !== activeDriverId)
                .map((person) => {
                  const active = passengerIds.includes(person.id);
                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => togglePassenger(person.id)}
                      className={
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors " +
                        (active
                          ? "border-blue-500 bg-blue-600/20 text-blue-200"
                          : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500")
                      }
                    >
                      {active && <Check className="h-3.5 w-3.5" />}
                      {person.name}
                    </button>
                  );
                })}
              {persons.length === 1 && <span className="text-sm text-zinc-500">Nur der Fahrer ist unterwegs.</span>}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm">
            {!price ? (
              <p className="text-amber-400">Kein Tankpreis verfügbar – prüfe die Einstellungen (PLZ, Preis).</p>
            ) : preview ? (
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-zinc-400">
                    <Fuel className="mr-1 inline h-3.5 w-3.5" />
                    {preview.parts.map((part) => `${part.label} ${kmLabel(part.km)}`).join(" · ")} ·{" "}
                    {pricePerLiter(price)}/l
                  </span>
                  <span className="font-semibold text-zinc-100">{eur(preview.total)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-xs text-zinc-500">
                  <span>{preview.occupants} Insassen · Sprit durch alle geteilt</span>
                  <span>
                    je <span className="font-medium text-emerald-400">{eur(preview.share)}</span>
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-zinc-500">Ort wählen oder Kilometer eintragen – die Kosten kommen automatisch.</p>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
