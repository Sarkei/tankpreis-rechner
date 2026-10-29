import { Check, Fuel, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { sharePerPerson, tripCost, type AppSettings, type FuelPriceState, type Person } from "../lib/calc.ts";
import { eur, pricePerLiter, todayIso } from "../lib/format.ts";
import type { TripPayload } from "../lib/api.ts";
import { Button, Card, Field, Segmented } from "./ui.tsx";

type Direction = "HIN" | "RUECK" | "BOTH";

export function TripForm({
  persons,
  settings,
  fuelPrice,
  busy,
  onSubmit,
}: {
  persons: Person[];
  settings: AppSettings;
  fuelPrice: FuelPriceState;
  busy: boolean;
  onSubmit: (payload: TripPayload) => Promise<boolean>;
}) {
  const [date, setDate] = useState(todayIso());
  const [direction, setDirection] = useState<Direction>("BOTH");
  const [km, setKm] = useState("");
  const [kmReturn, setKmReturn] = useState("");
  const [driverId, setDriverId] = useState<number | null>(persons[0]?.id ?? null);
  const [passengerIds, setPassengerIds] = useState<number[]>([]);

  const price = fuelPrice.price;
  const activeDriverId = driverId ?? persons[0]?.id ?? null;

  const preview = useMemo(() => {
    if (!price) return null;
    const legs: { label: string; km: number }[] = [];
    if (direction === "HIN" || direction === "BOTH") legs.push({ label: "Hin", km: Number(km) });
    if (direction === "RUECK" || direction === "BOTH") legs.push({ label: "Rück", km: Number(kmReturn) });

    const occupants = passengerIds.length + 1;
    const parts = legs
      .filter((leg) => Number.isFinite(leg.km) && leg.km > 0)
      .map((leg) => ({ ...leg, cost: tripCost(leg.km, settings.consumption, price) }));

    if (parts.length === 0) return null;
    const total = parts.reduce((sum, part) => sum + part.cost, 0);
    return { parts, total, share: sharePerPerson(total, occupants), occupants };
  }, [direction, km, kmReturn, passengerIds.length, price, settings.consumption]);

  function togglePassenger(id: number) {
    setPassengerIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!activeDriverId) return;
    const ok = await onSubmit({
      date,
      driverId: activeDriverId,
      passengerIds,
      direction,
      km: direction === "HIN" || direction === "BOTH" ? Number(km) : undefined,
      kmReturn: direction === "RUECK" || direction === "BOTH" ? Number(kmReturn) : undefined,
    });
    if (ok) {
      setKm("");
      setKmReturn("");
      setPassengerIds([]);
      setDate(todayIso());
    }
  }

  if (persons.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-sm text-zinc-400">Lege zuerst oben Personen an – danach kannst du Fahrten eintragen.</p>
      </Card>
    );
  }

  const disabled =
    busy ||
    !price ||
    !activeDriverId ||
    (direction !== "RUECK" && !(Number(km) > 0)) ||
    (direction !== "HIN" && !(Number(kmReturn) > 0));

  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <Fuel className="h-4 w-4 text-blue-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Neue Fahrt</h2>
      </div>

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
                </option>
              ))}
            </select>
          </Field>
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
                type="number"
                inputMode="decimal"
                min="0.1"
                step="0.1"
                placeholder="z. B. 24"
                value={km}
                onChange={(event) => setKm(event.target.value)}
              />
            </Field>
          )}
          {direction !== "HIN" && (
            <Field label="Kilometer zurück">
              <input
                type="number"
                inputMode="decimal"
                min="0.1"
                step="0.1"
                placeholder="z. B. 24"
                value={kmReturn}
                onChange={(event) => setKmReturn(event.target.value)}
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
            <p className="text-amber-400">
              Kein Tankpreis verfügbar – prüfe die Einstellungen (PLZ, Preis).
            </p>
          ) : preview ? (
            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-zinc-400">
                  {preview.parts.map((part) => `${part.label} ${part.km} km`).join(" · ")} ·{" "}
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
            <p className="text-zinc-500">Kilometer eintragen – die Kosten werden automatisch berechnet.</p>
          )}
        </div>

        <Button type="submit" disabled={disabled} className="w-full">
          <Save className="h-4 w-4" />
          {busy ? "Speichert…" : "Fahrt speichern"}
        </Button>
      </form>
    </Card>
  );
}
