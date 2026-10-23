import React, { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useToast } from "../lib/ToastContext.tsx";
import type { Trip, CarpoolGroup, Vehicle, GroupDriver } from "../types.ts";
import {
  Button, Modal, Input, Select, Textarea, Avatar, formatEuro
} from "./ui/index.tsx";
import { clsx } from "clsx";

interface CostPreview {
  participantCosts: { userId: number; name: string; amount: number }[];
  outboundCostPerPassenger: number;
  returnCostPerPassenger: number;
  costSplitMode: string;
  consumptionPer100km: number;
  totalFuelCost: number;
}

interface TripFormState {
  driverId: string;
  vehicleId: string;
  tripDate: string;
  outboundKm: string;
  returnKm: string;
  outboundEnabled: boolean;
  returnEnabled: boolean;
  fuelPrice: string;
  outboundPassengerIds: number[];
  returnPassengerIds: number[];
  samePassengers: boolean;
  comment: string;
}

function toDateKey(d: string): string {
  return d.slice(0, 10);
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function TripFormModal({
  group,
  onClose,
  onSaved,
  editTrip,
}: {
  group: CarpoolGroup;
  onClose: () => void;
  onSaved: () => void;
  editTrip?: Trip & { groupId: number; vehicleId?: number | null };
}) {
  const { error: showError } = useToast();
  const [drivers, setDrivers] = useState<GroupDriver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [members, setMembers] = useState<{ id: number; firstName: string; lastName: string }[]>([]);
  const [groupDefaults, setGroupDefaults] = useState<{
    defaultOutboundKm?: number | null;
    defaultReturnKm?: number | null;
    defaultFuelPrice?: number | null;
  }>({});
  const [preview, setPreview] = useState<CostPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const [form, setForm] = useState<TripFormState>({
    driverId: "",
    vehicleId: "",
    tripDate: new Date().toISOString().slice(0, 10),
    outboundKm: "",
    returnKm: "",
    outboundEnabled: true,
    returnEnabled: true,
    fuelPrice: "",
    outboundPassengerIds: [],
    returnPassengerIds: [],
    samePassengers: true,
    comment: "",
  });

  function updatePassengerList(g: CarpoolGroup, driverId: number) {
    setMembers(
      (g.members ?? []).filter((m) => m.isActive && Number(m.id) !== driverId)
    );
  }

  async function loadVehiclesForDriver(
    driverId: number,
    fuelDefault: string | null,
    keepExistingFuel = false
  ) {
    const vs = await api<Vehicle[]>(`/api/groups/${group.id}/drivers/${driverId}/vehicles`);
    setVehicles(vs);
    const defaultV = vs.find((v) => v.isDefault) ?? vs[0];
    const fuelPrice =
      fuelDefault ??
      (defaultV?.currentFuelPrice ? String(defaultV.currentFuelPrice) : "");
    setForm((p) => ({
      ...p,
      vehicleId: p.vehicleId && vs.some((v) => v.id === parseInt(p.vehicleId))
        ? p.vehicleId
        : defaultV ? String(defaultV.id) : "",
      fuelPrice: keepExistingFuel && p.fuelPrice ? p.fuelPrice : fuelPrice,
      outboundPassengerIds: p.outboundPassengerIds.filter((id) => id !== driverId),
      returnPassengerIds: p.returnPassengerIds.filter((id) => id !== driverId),
    }));
  }

  useEffect(() => {
    setInitialized(false);
    Promise.all([
      api<GroupDriver[]>(`/api/groups/${group.id}/drivers`),
      api<CarpoolGroup>(`/api/groups/${group.id}`),
    ]).then(async ([dr, g]) => {
      setDrivers(dr);
      setGroupDefaults({
        defaultOutboundKm: g.defaultOutboundKm,
        defaultReturnKm: g.defaultReturnKm,
        defaultFuelPrice: g.defaultFuelPrice,
      });

      if (editTrip) {
        const driverId = editTrip.driver.id;
        const outIds = [
          ...new Set(
            editTrip.participations
              .filter((p) => p.direction === "OUTBOUND")
              .map((p) => p.userId)
          ),
        ];
        const retIds = [
          ...new Set(
            editTrip.participations
              .filter((p) => p.direction === "RETURN")
              .map((p) => p.userId)
          ),
        ];
        const sortedOut = [...outIds].sort();
        const sortedRet = [...retIds].sort();
        const samePassengers =
          sortedOut.length === sortedRet.length &&
          sortedOut.every((id, i) => id === sortedRet[i]);

        updatePassengerList(g, driverId);
        setForm({
          driverId: String(driverId),
          vehicleId: editTrip.vehicleId ? String(editTrip.vehicleId) : "",
          tripDate: toDateKey(editTrip.tripDate),
          outboundKm: editTrip.outboundKm ? String(editTrip.outboundKm) : "",
          returnKm: editTrip.returnKm ? String(editTrip.returnKm) : "",
          outboundEnabled: editTrip.outboundKm != null && editTrip.outboundKm > 0,
          returnEnabled: editTrip.returnKm != null && editTrip.returnKm > 0,
          fuelPrice: String(editTrip.fuelPriceUsed),
          outboundPassengerIds: outIds,
          returnPassengerIds: retIds,
          samePassengers,
          comment: editTrip.comment ?? "",
        });
        await loadVehiclesForDriver(driverId, String(editTrip.fuelPriceUsed), true);
      } else {
        const defaultDriver = dr[0];
        if (!defaultDriver) return;

        updatePassengerList(g, defaultDriver.id);
        const hasOutbound = g.defaultOutboundKm != null && g.defaultOutboundKm > 0;
        const hasReturn = g.defaultReturnKm != null && g.defaultReturnKm > 0;
        const fuelDefault =
          g.defaultFuelPrice != null ? String(g.defaultFuelPrice) : null;

        setForm({
          driverId: String(defaultDriver.id),
          vehicleId: "",
          tripDate: new Date().toISOString().slice(0, 10),
          outboundKm: hasOutbound ? String(g.defaultOutboundKm) : "",
          returnKm: hasReturn ? String(g.defaultReturnKm) : "",
          outboundEnabled: hasOutbound || (!hasOutbound && !hasReturn),
          returnEnabled: hasReturn || (!hasOutbound && !hasReturn),
          fuelPrice: fuelDefault ?? "",
          outboundPassengerIds: [],
          returnPassengerIds: [],
          samePassengers: true,
          comment: "",
        });
        await loadVehiclesForDriver(defaultDriver.id, fuelDefault);
      }
      setInitialized(true);
    }).catch(console.error);
  }, [group.id, editTrip?.id]);

  async function handleDriverChange(driverId: string) {
    const id = parseInt(driverId);
    if (isNaN(id)) return;
    setForm((p) => ({
      ...p,
      driverId,
      outboundPassengerIds: p.outboundPassengerIds.filter((x) => x !== id),
      returnPassengerIds: p.returnPassengerIds.filter((x) => x !== id),
    }));
    const g = await api<CarpoolGroup>(`/api/groups/${group.id}`);
    updatePassengerList(g, id);
    const fuelDefault =
      groupDefaults.defaultFuelPrice != null
        ? String(groupDefaults.defaultFuelPrice)
        : null;
    await loadVehiclesForDriver(id, fuelDefault);
  }

  useEffect(() => {
    if (!initialized || !form.vehicleId || groupDefaults.defaultFuelPrice != null || editTrip) return;
    const v = vehicles.find((x) => x.id === parseInt(form.vehicleId));
    if (v?.currentFuelPrice) {
      setForm((p) => ({ ...p, fuelPrice: String(v.currentFuelPrice) }));
    }
  }, [form.vehicleId, vehicles, groupDefaults.defaultFuelPrice, initialized, editTrip]);

  const debouncedPreview = useCallback(
    debounce(async (f: TripFormState): Promise<void> => {
      if (!f.fuelPrice || (!f.outboundKm && !f.returnKm)) { setPreview(null); return; }
      const outPassengers = f.outboundEnabled ? f.outboundPassengerIds : [];
      const retPassengers = f.returnEnabled ? (f.samePassengers ? f.outboundPassengerIds : f.returnPassengerIds) : [];
      setPreviewLoading(true);
      try {
        const data = await api<CostPreview>("/api/trips/preview", {
          method: "POST",
          body: JSON.stringify({
            groupId: group.id,
            vehicleId: f.vehicleId ? parseInt(f.vehicleId) : undefined,
            outboundKm: f.outboundEnabled && f.outboundKm ? parseFloat(f.outboundKm) : undefined,
            returnKm: f.returnEnabled && f.returnKm ? parseFloat(f.returnKm) : undefined,
            fuelPrice: parseFloat(f.fuelPrice),
            outboundPassengerIds: outPassengers,
            returnPassengerIds: retPassengers,
          }),
        });
        setPreview(data);
      } catch {} finally { setPreviewLoading(false); }
    }, 500),
    [group.id]
  );

  useEffect(() => {
    if (initialized) debouncedPreview(form);
  }, [form, debouncedPreview, initialized]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const outPassengers = form.outboundEnabled ? form.outboundPassengerIds : [];
    const retPassengers = form.returnEnabled ? (form.samePassengers ? form.outboundPassengerIds : form.returnPassengerIds) : [];
    if (!form.fuelPrice) { showError("Kraftstoffpreis ist Pflicht"); return; }
    if (!form.outboundKm && !form.returnKm) { showError("Mindestens eine Strecke angeben"); return; }
    setSubmitting(true);
    const body = {
      driverId: form.driverId ? parseInt(form.driverId) : undefined,
      vehicleId: form.vehicleId ? parseInt(form.vehicleId) : undefined,
      tripDate: form.tripDate,
      outboundKm: form.outboundEnabled && form.outboundKm ? parseFloat(form.outboundKm) : undefined,
      returnKm: form.returnEnabled && form.returnKm ? parseFloat(form.returnKm) : undefined,
      fuelPrice: parseFloat(form.fuelPrice),
      outboundPassengerIds: outPassengers,
      returnPassengerIds: retPassengers,
      comment: form.comment || undefined,
    };
    try {
      if (editTrip) {
        await api(`/api/groups/${group.id}/trips/${editTrip.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      } else {
        await api(`/api/groups/${group.id}/trips`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      onSaved();
    } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
    finally { setSubmitting(false); }
  }

  function setOutboundPassengers(ids: number[]) {
    setForm((p) => ({ ...p, outboundPassengerIds: ids }));
  }

  function setReturnPassengers(ids: number[]) {
    setForm((p) => ({ ...p, returnPassengerIds: ids }));
  }

  function togglePassenger(userId: number, direction: "outbound" | "return") {
    if (direction === "outbound") {
      setForm((p) => ({
        ...p,
        outboundPassengerIds: p.outboundPassengerIds.includes(userId)
          ? p.outboundPassengerIds.filter((id) => id !== userId)
          : [...p.outboundPassengerIds, userId],
      }));
    } else {
      setForm((p) => ({
        ...p,
        returnPassengerIds: p.returnPassengerIds.includes(userId)
          ? p.returnPassengerIds.filter((id) => id !== userId)
          : [...p.returnPassengerIds, userId],
      }));
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={editTrip ? "Fahrt bearbeiten" : `Fahrt eintragen – ${group.name}`}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <Select
          label="Wer ist gefahren?"
          value={form.driverId}
          onChange={(e) => handleDriverChange(e.target.value)}
          disabled={drivers.length <= 1}
          hint={drivers.length <= 1 ? "Ein Fahrer in dieser Gruppe" : "Fahrer für diese Fahrt auswählen"}
        >
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.firstName} {d.lastName}{d.isOwner ? " (Gruppenbesitzer)" : ""}
            </option>
          ))}
        </Select>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Datum" type="date" value={form.tripDate}
            onChange={(e) => setForm((p) => ({ ...p, tripDate: e.target.value }))} required />
          {vehicles.length > 0 && (
            <Select label="Fahrzeug" value={form.vehicleId}
              onChange={(e) => setForm((p) => ({ ...p, vehicleId: e.target.value }))}>
              <option value="">Kein Fahrzeug</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          )}
        </div>

        <Input label="Kraftstoffpreis (€/L)" type="number" step="0.001" value={form.fuelPrice}
          onChange={(e) => setForm((p) => ({ ...p, fuelPrice: e.target.value }))}
          placeholder="1.899" required
          hint={groupDefaults.defaultFuelPrice != null && !editTrip ? "Vorausgefüllt aus Gruppen-Einstellungen" : undefined} />

        <div className="space-y-3 bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/50">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-300">🡒 Hinweg</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.outboundEnabled}
                onChange={(e) => setForm((p) => ({ ...p, outboundEnabled: e.target.checked }))}
                className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-600" />
              <span className="text-xs text-zinc-500">Hinweg gefahren</span>
            </label>
          </div>
          {form.outboundEnabled && (
            <>
              <Input label="Kilometer" type="number" step="0.1" placeholder="45.5" value={form.outboundKm}
                onChange={(e) => setForm((p) => ({ ...p, outboundKm: e.target.value }))}
                hint={groupDefaults.defaultOutboundKm != null && !editTrip ? "Standard aus Gruppe" : undefined} />
              <PassengerSelect
                label="Mitfahrer (Hinweg)"
                members={members}
                selectedIds={form.outboundPassengerIds}
                onToggle={(id) => togglePassenger(id, "outbound")}
                onSelectAll={() => setOutboundPassengers(members.map((m) => m.id))}
                onClearAll={() => setOutboundPassengers([])}
              />
            </>
          )}
        </div>

        <div className="space-y-3 bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/50">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-300">🡐 Rückweg</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.returnEnabled}
                onChange={(e) => setForm((p) => ({ ...p, returnEnabled: e.target.checked }))}
                className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-600" />
              <span className="text-xs text-zinc-500">Rückweg gefahren</span>
            </label>
          </div>
          {form.returnEnabled && (
            <>
              <Input label="Kilometer" type="number" step="0.1" placeholder="45.5" value={form.returnKm}
                onChange={(e) => setForm((p) => ({ ...p, returnKm: e.target.value }))}
                hint={groupDefaults.defaultReturnKm != null && !editTrip ? "Standard aus Gruppe" : undefined} />
              {form.outboundEnabled && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.samePassengers}
                    onChange={(e) => setForm((p) => ({ ...p, samePassengers: e.target.checked }))}
                    className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-600" />
                  <span className="text-xs text-zinc-400">Gleiche Mitfahrer wie Hinweg</span>
                </label>
              )}
              {!form.samePassengers && (
                <PassengerSelect
                  label="Mitfahrer (Rückweg)"
                  members={members}
                  selectedIds={form.returnPassengerIds}
                  onToggle={(id) => togglePassenger(id, "return")}
                  onSelectAll={() => setReturnPassengers(members.map((m) => m.id))}
                  onClearAll={() => setReturnPassengers([])}
                />
              )}
            </>
          )}
        </div>

        {(previewLoading || preview) && (
          <div className="bg-blue-900/20 border border-blue-800/50 rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-blue-300">💡 Kostenvorschau</p>
            {previewLoading ? (
              <p className="text-xs text-zinc-500">Berechne…</p>
            ) : preview && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-300">Fahrtkosten gesamt</span>
                  <span className="font-semibold text-green-400">{formatEuro(preview.totalFuelCost)}</span>
                </div>
                <p className="text-[11px] text-zinc-500">
                  {preview.consumptionPer100km.toFixed(1)} L/100 km · keine Schulden ohne Mitfahrer
                </p>
                {preview.participantCosts.length > 0 && (
                  <div className="space-y-1 pt-2 border-t border-blue-800/40">
                    <p className="text-xs text-zinc-500">Aufteilung Mitfahrer</p>
                    {preview.participantCosts.map((pc) => (
                      <div key={pc.userId} className="flex justify-between text-sm">
                        <span className="text-zinc-400">{pc.name}</span>
                        <span className="font-medium text-blue-300">{formatEuro(pc.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <Textarea label="Kommentar (optional)" value={form.comment} rows={2}
          onChange={(e) => setForm((p) => ({ ...p, comment: e.target.value }))}
          placeholder="z.B. Umweg wegen Baustelle" />

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Abbrechen</Button>
          <Button type="submit" loading={submitting} className="flex-1">
            {editTrip ? "Änderungen speichern" : "Fahrt speichern"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PassengerSelect({
  label, members, selectedIds, onToggle, onSelectAll, onClearAll
}: {
  label: string;
  members: { id: number; firstName: string; lastName: string }[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  if (members.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-zinc-400">{label}</p>
        <p className="text-xs text-zinc-500 bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-2">
          Noch keine Mitfahrer in dieser Gruppe. Du kannst die Fahrt trotzdem speichern und
          Mitfahrer später per Bearbeiten hinzufügen.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-400">{label}</p>
        <div className="flex gap-2">
          <button type="button" onClick={onSelectAll}
            className="text-xs text-blue-400 hover:text-blue-300">Alle</button>
          <button type="button" onClick={onClearAll}
            className="text-xs text-zinc-500 hover:text-zinc-300">Keine</button>
        </div>
      </div>
      <div className="space-y-1.5">
        {members.map((m) => {
          const checked = selectedIds.includes(m.id);
          return (
            <label
              key={m.id}
              className={clsx(
                "flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all",
                checked
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-zinc-700 bg-zinc-800/60 hover:border-zinc-500"
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(m.id)}
                className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-600 shrink-0"
              />
              <Avatar name={`${m.firstName} ${m.lastName}`} size="sm" />
              <span className="text-sm text-zinc-200">{m.firstName} {m.lastName}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
