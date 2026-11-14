import React, { useEffect, useState } from "react";
import { Plus, Car, Fuel, Star, Pencil, Trash2, Droplets } from "lucide-react";
import { api } from "../lib/api.ts";
import { useToast } from "../lib/ToastContext.tsx";
import type { Vehicle } from "../types.ts";
import { getFuelPriceStatus } from "../types.ts";
import {
  Card, Button, Modal, Input, Select, Textarea, Badge, EmptyState, SkeletonCard, formatDate
} from "../components/ui/index.tsx";
import { clsx } from "clsx";

const FUEL_LABELS: Record<string, string> = {
  BENZIN: "Benzin",
  DIESEL: "Diesel",
  ELEKTRO: "Elektro (kWh)",
  HYBRID: "Hybrid",
};

const STATUS_COLORS = {
  green: "border-green-800/50 bg-green-900/10",
  yellow: "border-yellow-800/50 bg-yellow-900/10",
  red: "border-red-800/50 bg-red-900/10",
  none: "",
};

export default function VehiclesPage() {
  const { success, error: showError } = useToast();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null);
  const [showFuelLog, setShowFuelLog] = useState<Vehicle | null>(null);
  const [fuelLogs, setFuelLogs] = useState<{id:number;date:string;liters:number;pricePerLiter:number;totalCost:number;odometerKm?:number}[]>([]);
  const [fuelLogLoading, setFuelLogLoading] = useState(false);
  const [fuelForm, setFuelForm] = useState({ date: new Date().toISOString().slice(0,10), liters: "", pricePerLiter: "", odometerKm: "", notes: "" });
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    loadVehicles();
  }, []);

  async function loadVehicles() {
    try {
      const data = await api<Vehicle[]>("/api/vehicles");
      setVehicles(data);
    } catch (err) {
      showError("Fahrzeuge konnten nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }

  async function loadFuelLogs(vehicleId: number) {
    setFuelLogLoading(true);
    try {
      const data = await api<typeof fuelLogs>(`/api/vehicles/${vehicleId}/fuel-logs`);
      setFuelLogs(data);
    } catch {}
    setFuelLogLoading(false);
  }

  async function addFuelLog(vehicleId: number) {
    if (!fuelForm.liters || !fuelForm.pricePerLiter) {
      showError("Liter und Preis erforderlich");
      return;
    }
    try {
      await api(`/api/vehicles/${vehicleId}/fuel-logs`, {
        method: "POST",
        body: JSON.stringify({
          date: fuelForm.date,
          liters: parseFloat(fuelForm.liters),
          pricePerLiter: parseFloat(fuelForm.pricePerLiter),
          odometerKm: fuelForm.odometerKm ? parseInt(fuelForm.odometerKm) : undefined,
          notes: fuelForm.notes || undefined,
        }),
      });
      success("Tankvorgang gespeichert");
      await loadFuelLogs(vehicleId);
      await loadVehicles();
      setFuelForm({ date: new Date().toISOString().slice(0,10), liters: "", pricePerLiter: "", odometerKm: "", notes: "" });
    } catch (err) {
      showError(err instanceof Error ? err.message : "Fehler");
    }
  }

  async function deleteVehicle(id: number) {
    setDeletingId(id);
    try {
      await api(`/api/vehicles/${id}`, { method: "DELETE" });
      setVehicles((prev) => prev.filter((v) => v.id !== id));
      success("Fahrzeug gelöscht");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold text-zinc-100">Meine Fahrzeuge</h1>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<Fuel className="w-3.5 h-3.5" />}
            onClick={async () => {
              try {
                const r = await api<{ message: string }>("/api/fuel-prices/refresh", { method: "POST" });
                success(r.message);
                loadVehicles();
              } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
            }}>
            Preise holen
          </Button>
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => { setEditVehicle(null); setShowForm(true); }}>
            Hinzufügen
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3"><SkeletonCard /><SkeletonCard /></div>
      ) : vehicles.length === 0 ? (
        <EmptyState
          icon={<Car className="w-12 h-12" />}
          title="Noch keine Fahrzeuge"
          description="Füge dein Fahrzeug hinzu, um Fahrkosten berechnen zu können."
          action={<Button onClick={() => setShowForm(true)}>Fahrzeug hinzufügen</Button>}
        />
      ) : (
        <div className="space-y-3">
          {vehicles.map((v) => {
            const status = getFuelPriceStatus(v.fuelPriceUpdatedAt);
            return (
              <Card key={v.id} className={clsx("space-y-3", STATUS_COLORS[status])}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center shrink-0">
                      <Car className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-zinc-100">{v.name}</p>
                        {v.isDefault && <Badge variant="info">Standard</Badge>}
                      </div>
                      <p className="text-xs text-zinc-500">
                        {FUEL_LABELS[v.fuelType]} · {v.consumptionPer100km} {v.fuelType === "ELEKTRO" ? "kWh" : "L"}/100km
                        {v.licensePlate && ` · ${v.licensePlate}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => { setEditVehicle(v); setShowForm(true); }}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteVehicle(v.id)}
                      disabled={deletingId === v.id}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-800"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Fuel price */}
                <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Droplets className={clsx("w-4 h-4", status === "green" ? "text-green-400" : status === "yellow" ? "text-yellow-400" : status === "red" ? "text-red-400" : "text-zinc-600")} />
                    <div>
                      <p className="text-sm text-zinc-300">
                        {v.currentFuelPrice ? `${v.currentFuelPrice.toFixed(3)} €/L` : "Preis nicht gesetzt"}
                        {v.autoFuelPrice !== false && (
                          <span className="text-xs text-blue-400 ml-1">· Auto</span>
                        )}
                      </p>
                      {v.fuelPriceUpdatedAt && (
                        <p className="text-xs text-zinc-500">{formatDate(v.fuelPriceUpdatedAt)}</p>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Fuel className="w-3.5 h-3.5" />}
                    onClick={() => {
                      setShowFuelLog(v);
                      loadFuelLogs(v.id);
                    }}
                  >
                    Tankprotokoll
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Vehicle Form Modal */}
      <VehicleFormModal
        isOpen={showForm}
        vehicle={editVehicle}
        onClose={() => setShowForm(false)}
        onSaved={(v) => {
          if (editVehicle) {
            setVehicles((prev) => prev.map((x) => (x.id === v.id ? v : x)));
          } else {
            setVehicles((prev) => [...prev, v]);
          }
          setShowForm(false);
          success(editVehicle ? "Fahrzeug aktualisiert" : "Fahrzeug hinzugefügt");
        }}
      />

      {/* Fuel Log Modal */}
      <Modal
        isOpen={!!showFuelLog}
        onClose={() => setShowFuelLog(null)}
        title={`⛽ Tankprotokoll – ${showFuelLog?.name}`}
        size="md"
      >
        <div className="space-y-4">
          {/* Add entry */}
          <div className="bg-zinc-800/50 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-zinc-300">Neuer Tankvorgang</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Datum" type="date" value={fuelForm.date}
                onChange={(e) => setFuelForm((p) => ({ ...p, date: e.target.value }))} />
              <Input label="Liter" type="number" step="0.01" placeholder="45.5" value={fuelForm.liters}
                onChange={(e) => setFuelForm((p) => ({ ...p, liters: e.target.value }))} />
              <Input label="€/Liter" type="number" step="0.001" placeholder="1.899" value={fuelForm.pricePerLiter}
                onChange={(e) => setFuelForm((p) => ({ ...p, pricePerLiter: e.target.value }))} />
              <Input label="Kilometerstand" type="number" placeholder="75000" value={fuelForm.odometerKm}
                onChange={(e) => setFuelForm((p) => ({ ...p, odometerKm: e.target.value }))} />
            </div>
            <Button
              onClick={() => showFuelLog && addFuelLog(showFuelLog.id)}
              size="sm"
              className="w-full"
            >
              Tankvorgang speichern
            </Button>
          </div>

          {/* History */}
          <div>
            <p className="text-sm font-medium text-zinc-400 mb-2">Verlauf</p>
            {fuelLogLoading ? (
              <p className="text-zinc-500 text-sm text-center py-4">Lädt…</p>
            ) : fuelLogs.length === 0 ? (
              <p className="text-zinc-500 text-sm text-center py-4">Noch keine Einträge</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {fuelLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between bg-zinc-800/50 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-sm text-zinc-300">{formatDate(log.date)}</p>
                      <p className="text-xs text-zinc-500">{log.liters.toFixed(2)} L · {log.pricePerLiter.toFixed(3)} €/L</p>
                    </div>
                    <p className="text-sm font-medium text-zinc-200">{log.totalCost.toFixed(2)} €</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function VehicleFormModal({
  isOpen, vehicle, onClose, onSaved
}: {
  isOpen: boolean;
  vehicle: Vehicle | null;
  onClose: () => void;
  onSaved: (v: Vehicle) => void;
}) {
  const { error: showError } = useToast();
  const [form, setForm] = useState({
    name: "", fuelType: "BENZIN", consumptionPer100km: "", tankCapacity: "",
    licensePlate: "", notes: "", isDefault: false, currentFuelPrice: "",
    autoFuelPrice: true, fuelPricePlz: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (vehicle) {
      setForm({
        name: vehicle.name,
        fuelType: vehicle.fuelType,
        consumptionPer100km: String(vehicle.consumptionPer100km),
        tankCapacity: vehicle.tankCapacity ? String(vehicle.tankCapacity) : "",
        licensePlate: vehicle.licensePlate ?? "",
        notes: vehicle.notes ?? "",
        isDefault: vehicle.isDefault,
        currentFuelPrice: vehicle.currentFuelPrice ? String(vehicle.currentFuelPrice) : "",
        autoFuelPrice: vehicle.autoFuelPrice !== false,
        fuelPricePlz: vehicle.fuelPricePlz ?? "",
      });
    } else {
      setForm({ name: "", fuelType: "BENZIN", consumptionPer100km: "", tankCapacity: "", licensePlate: "", notes: "", isDefault: false, currentFuelPrice: "", autoFuelPrice: true, fuelPricePlz: "" });
    }
  }, [vehicle, isOpen]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.consumptionPer100km) { showError("Name und Verbrauch sind Pflicht"); return; }
    setLoading(true);
    try {
      const payload = {
        name: form.name,
        fuelType: form.fuelType,
        consumptionPer100km: parseFloat(form.consumptionPer100km),
        tankCapacity: form.tankCapacity ? parseFloat(form.tankCapacity) : undefined,
        licensePlate: form.licensePlate || undefined,
        notes: form.notes || undefined,
        isDefault: form.isDefault,
        autoFuelPrice: form.autoFuelPrice,
        fuelPricePlz: form.fuelPricePlz || null,
        currentFuelPrice: !form.autoFuelPrice && form.currentFuelPrice
          ? parseFloat(form.currentFuelPrice) : undefined,
      };
      const url = vehicle ? `/api/vehicles/${vehicle.id}` : "/api/vehicles";
      const method = vehicle ? "PUT" : "POST";
      const saved = await api<Vehicle>(url, { method, body: JSON.stringify(payload) });
      onSaved(saved);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={vehicle ? "Fahrzeug bearbeiten" : "Fahrzeug hinzufügen"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Name / Bezeichnung" value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          placeholder='z.B. "Golf GTI"' required />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Kraftstoffart" value={form.fuelType}
            onChange={(e) => setForm((p) => ({ ...p, fuelType: e.target.value }))}>
            {Object.entries(FUEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input label={form.fuelType === "ELEKTRO" ? "kWh/100km" : "L/100km"}
            type="number" step="0.1" placeholder="8.0" value={form.consumptionPer100km}
            onChange={(e) => setForm((p) => ({ ...p, consumptionPer100km: e.target.value }))} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Tankinhalt (L)" type="number" placeholder="55" value={form.tankCapacity}
            onChange={(e) => setForm((p) => ({ ...p, tankCapacity: e.target.value }))} />
          <Input label="Kennzeichen" placeholder="M-AB 1234" value={form.licensePlate}
            onChange={(e) => setForm((p) => ({ ...p, licensePlate: e.target.value }))} />
        </div>
        <Input label="Aktueller Kraftstoffpreis (€/L)" type="number" step="0.001"
          placeholder="1.899" value={form.currentFuelPrice}
          disabled={form.autoFuelPrice}
          onChange={(e) => setForm((p) => ({ ...p, currentFuelPrice: e.target.value }))}
          hint={form.autoFuelPrice ? "Wird täglich automatisch aktualisiert" : "Manueller Preis"} />
        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border border-zinc-700 bg-zinc-800/50">
          <input type="checkbox" checked={form.autoFuelPrice}
            onChange={(e) => setForm((p) => ({ ...p, autoFuelPrice: e.target.checked }))}
            className="w-5 h-5 rounded border-zinc-600 bg-zinc-800 text-blue-600 shrink-0" />
          <div>
            <span className="text-sm text-zinc-200 font-medium">Automatischer Tankpreis</span>
            <p className="text-xs text-zinc-500">Täglich via Tankerkoenig (PLZ in Einstellungen oder unten)</p>
          </div>
        </label>
        {form.autoFuelPrice && (
          <Input label="PLZ (optional, überschreibt Profil-PLZ)" value={form.fuelPricePlz}
            onChange={(e) => setForm((p) => ({ ...p, fuelPricePlz: e.target.value.replace(/\D/g, "").slice(0, 5) }))}
            placeholder="80331" />
        )}
        <Textarea label="Notizen" value={form.notes} rows={2}
          onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.isDefault}
            onChange={(e) => setForm((p) => ({ ...p, isDefault: e.target.checked }))}
            className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-600" />
          <span className="text-sm text-zinc-400">Als Standardfahrzeug</span>
        </label>
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Abbrechen</Button>
          <Button type="submit" loading={loading} className="flex-1">
            {vehicle ? "Speichern" : "Hinzufügen"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
