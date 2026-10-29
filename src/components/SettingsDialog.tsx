import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppSettings, FuelPriceState, HomePlace, MeUser } from "../lib/calc.ts";
import { RouteField } from "./RouteField.tsx";
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
  me,
  canEditGlobal,
  busy,
  onClose,
  onSave,
  onRefresh,
  onSaveHome,
}: {
  open: boolean;
  settings: AppSettings;
  fuelPrice: FuelPriceState;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: Partial<AppSettings>) => Promise<void>;
  onRefresh: () => Promise<void>;
  me: MeUser | null;
  /** Globale Werte (PLZ, Sprit, Verbrauch) darf nur ein Admin ändern. */
  canEditGlobal: boolean;
  onSaveHome: (home: HomePlace | null) => Promise<void>;
}) {
  const [plz, setPlz] = useState(settings.plz);
  const [consumption, setConsumption] = useState(String(settings.consumption));
  const [fuelType, setFuelType] = useState(settings.fuelType);
  const [priceMode, setPriceMode] = useState(settings.priceMode);
  const [manualPrice, setManualPrice] = useState(settings.manualPrice ? String(settings.manualPrice) : "");
  const [home, setHome] = useState<HomePlace | null>(me?.home ?? null);
  const [homeBusy, setHomeBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlz(settings.plz);
    setConsumption(String(settings.consumption));
    setFuelType(settings.fuelType);
    setPriceMode(settings.priceMode);
    setManualPrice(settings.manualPrice ? String(settings.manualPrice) : "");
    setHome(me?.home ?? null);
  }, [open, settings]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Einstellungen"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {canEditGlobal ? "Abbrechen" : "Schließen"}
          </Button>
          {canEditGlobal && (
          <Button
            onClick={() =>
              onSave({
                plz,
                consumption: Number(consumption),
                fuelType,
                priceMode,
                manualPrice: priceMode === "manual" ? Number(manualPrice) : null,
              })
            }
            disabled={busy}
          >
            Speichern
          </Button>
          )}
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

        {!canEditGlobal && (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
            Tankpreis, PLZ und Verbrauch gelten für alle und lassen sich nur vom Admin ändern.
          </p>
        )}

        {canEditGlobal ? (
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
        ) : (
          <p className="text-xs text-zinc-500">
            Preisquelle: <span className="text-zinc-300">{priceMode === "manual" ? "manuell" : "automatisch"}</span>
          </p>
        )}

        {priceMode === "manual" ? (
          <Field label="Preis pro Liter (€)">
            <input
              type="number"
              inputMode="decimal"
              min="0.1"
              step="0.001"
              value={manualPrice}
              disabled={!canEditGlobal}
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
                disabled={!canEditGlobal}
                onChange={(event) => setPlz(event.target.value.replace(/\D/g, "").slice(0, 5))}
                placeholder="83278"
              />
            </Field>
            <Field label="Kraftstoff">
              <select value={fuelType} disabled={!canEditGlobal} onChange={(event) => setFuelType(event.target.value as AppSettings["fuelType"])}>
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
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Meine Zuhause-Adresse</span>
          <RouteField
            label="Adresse"
            value={home}
            onChange={setHome}
            placeholder="z. B. Bahnhofstraße 5 Traunstein"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-zinc-500">
              {me?.home ? "Steht beim Anlegen einer Fahrt als Schnellwahl bereit." : "Noch keine Adresse gespeichert."}
            </p>
            <div className="flex gap-2">
              {home && (
                <Button
                  variant="secondary"
                  disabled={homeBusy}
                  onClick={async () => {
                    setHomeBusy(true);
                    await onSaveHome(null);
                    setHome(null);
                    setHomeBusy(false);
                  }}
                >
                  entfernen
                </Button>
              )}
              <Button
                disabled={homeBusy || !home}
                onClick={async () => {
                  if (!home) return;
                  setHomeBusy(true);
                  await onSaveHome(home);
                  setHomeBusy(false);
                }}
              >
                {homeBusy ? "…" : "speichern"}
              </Button>
            </div>
          </div>
        </div>

        <Field label="Verbrauch (l / 100 km)" hint="Gilt für alle neuen Fahrten.">
          <input
            type="number"
            inputMode="decimal"
            min="1"
            max="30"
            step="0.1"
            value={consumption}
            disabled={!canEditGlobal}
            onChange={(event) => setConsumption(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
