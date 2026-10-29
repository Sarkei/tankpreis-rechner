import { Plus, RefreshCw, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppSettings, FuelPriceState, Person } from "../lib/calc.ts";
import { ageLabel, pricePerLiter } from "../lib/format.ts";
import { Button, Field, Modal, Segmented } from "./ui.tsx";

const FUEL_OPTIONS: { value: AppSettings["fuelType"]; label: string }[] = [
  { value: "e10", label: "Super E10" },
  { value: "diesel", label: "Diesel" },
  { value: "superplus", label: "SuperPlus" },
];

export function SettingsDialog({
  open,
  settings,
  fuelPrice,
  persons,
  busy,
  onClose,
  onSave,
  onRefresh,
  onAddPerson,
  onDeletePerson,
}: {
  open: boolean;
  settings: AppSettings;
  fuelPrice: FuelPriceState;
  persons: Person[];
  busy: boolean;
  onClose: () => void;
  onSave: (patch: Partial<AppSettings>) => Promise<void>;
  onRefresh: () => Promise<void>;
  onAddPerson: (name: string) => Promise<void>;
  onDeletePerson: (person: Person) => void;
}) {
  const [plz, setPlz] = useState(settings.plz);
  const [consumption, setConsumption] = useState(String(settings.consumption));
  const [fuelType, setFuelType] = useState(settings.fuelType);
  const [priceMode, setPriceMode] = useState(settings.priceMode);
  const [manualPrice, setManualPrice] = useState(settings.manualPrice ? String(settings.manualPrice) : "");
  const [mePersonId, setMePersonId] = useState<number | null>(settings.mePersonId);
  const [newPerson, setNewPerson] = useState("");

  useEffect(() => {
    if (!open) return;
    setPlz(settings.plz);
    setConsumption(String(settings.consumption));
    setFuelType(settings.fuelType);
    setPriceMode(settings.priceMode);
    setManualPrice(settings.manualPrice ? String(settings.manualPrice) : "");
    setMePersonId(settings.mePersonId);
    setNewPerson("");
  }, [open, settings]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Einstellungen"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            onClick={() =>
              onSave({
                plz,
                consumption: Number(consumption),
                fuelType,
                priceMode,
                manualPrice: priceMode === "manual" ? Number(manualPrice) : null,
                mePersonId,
              })
            }
            disabled={busy}
          >
            Speichern
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-400">Aktueller Preis</span>
            <span className="shrink-0 font-semibold text-zinc-100">
              {pricePerLiter(fuelPrice.price)}
              {fuelPrice.price ? "/l" : ""}
            </span>
          </div>
          <div className="mt-1 flex items-start justify-between gap-3 text-xs text-zinc-500">
            <span className="min-w-0 flex-1">
              {fuelPrice.source === "manual"
                ? "manuell gesetzt"
                : fuelPrice.source === "clever-tanken"
                  ? `clever-tanken · ${fuelPrice.fuelLabel} · PLZ ${fuelPrice.plz}`
                  : fuelPrice.source === "cache"
                    ? `zwischengespeichert · ${ageLabel(fuelPrice.fetchedAt)}`
                    : "kein Preis verfügbar"}
              {fuelPrice.fetchedAt && fuelPrice.source === "clever-tanken" ? ` · ${ageLabel(fuelPrice.fetchedAt)}` : ""}
            </span>
            <button
              onClick={onRefresh}
              disabled={busy}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
            >
              <RefreshCw className={"h-3.5 w-3.5 " + (busy ? "animate-spin" : "")} />
              neu holen
            </button>
          </div>
          {fuelPrice.error && <p className="mt-2 text-xs text-amber-400">{fuelPrice.error}</p>}
          {fuelPrice.stations !== null && (
            <p className="mt-1 text-xs text-zinc-600">
              Durchschnitt der 5 günstigsten von {fuelPrice.stations} Tankstellen im 10-km-Umkreis
            </p>
          )}
        </div>

        <Field label="Preisquelle">
          <Segmented
            value={priceMode}
            onChange={setPriceMode}
            options={[
              { value: "auto", label: "Automatisch" },
              { value: "manual", label: "Manuell" },
            ]}
          />
        </Field>

        {priceMode === "manual" ? (
          <Field label="Preis pro Liter (€)">
            <input
              type="number"
              inputMode="decimal"
              min="0.1"
              step="0.001"
              value={manualPrice}
              onChange={(event) => setManualPrice(event.target.value)}
              placeholder="z. B. 1.789"
            />
          </Field>
        ) : (
          <>
            <Field label="PLZ für Tankstellensuche">
              <input
                inputMode="numeric"
                maxLength={5}
                value={plz}
                onChange={(event) => setPlz(event.target.value.replace(/\D/g, "").slice(0, 5))}
                placeholder="83278"
              />
            </Field>
            <Field label="Kraftstoff">
              <select value={fuelType} onChange={(event) => setFuelType(event.target.value as AppSettings["fuelType"])}>
                {FUEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Personen</span>
            <span className="text-xs text-zinc-600">{persons.length}</span>
          </div>

          {persons.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {persons.map((person) => (
                <span
                  key={person.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 py-1 pl-2.5 pr-1.5 text-sm text-zinc-200"
                >
                  <UserRound className="h-3.5 w-3.5 text-zinc-500" />
                  {person.name}
                  <button
                    type="button"
                    onClick={() => onDeletePerson(person)}
                    aria-label={`${person.name} entfernen`}
                    className="rounded-full p-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Noch niemand angelegt.</p>
          )}

          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const name = newPerson.trim();
              if (name.length < 2) return;
              await onAddPerson(name);
              setNewPerson("");
            }}
            className="flex gap-2"
          >
            <input
              value={newPerson}
              onChange={(event) => setNewPerson(event.target.value)}
              placeholder="Name, z. B. Lia"
              maxLength={60}
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={busy || newPerson.trim().length < 2} className="shrink-0">
              <Plus className="h-4 w-4" />
              Hinzufügen
            </Button>
          </form>

          <Field label="Das bin ich" hint="Wird beim Anlegen einer Fahrt als Fahrer vorbelegt.">
            <select
              value={mePersonId ?? ""}
              onChange={(event) => setMePersonId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">– nicht festgelegt –</option>
              {persons.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Verbrauch (l / 100 km)" hint="Gilt für alle neuen Fahrten.">
          <input
            type="number"
            inputMode="decimal"
            min="1"
            max="30"
            step="0.1"
            value={consumption}
            onChange={(event) => setConsumption(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
