import React, { useEffect, useState } from "react";
import { MapPin, Pencil } from "lucide-react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/AuthContext.tsx";
import { useToast } from "../lib/ToastContext.tsx";
import type { Trip, CarpoolGroup } from "../types.ts";
import {
  Modal, Button, Avatar, SkeletonCard, formatEuro, formatDate
} from "./ui/index.tsx";
import { clsx } from "clsx";
import { TripFormModal } from "./TripFormModal.tsx";
import { computeTripFuelCost, sumPassengerCosts } from "../lib/tripCost.ts";

export default function TripDetailModal({
  groupId,
  tripId,
  onClose,
  onUpdated,
}: {
  groupId: number;
  tripId: number;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { user } = useAuth();
  const { success, error: showError } = useToast();
  const [trip, setTrip] = useState<(Trip & { groupId: number; groupName?: string; vehicleId?: number | null }) | null>(null);
  const [group, setGroup] = useState<CarpoolGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<Trip & { groupId: number; groupName?: string; vehicleId?: number | null }>(
        `/api/groups/${groupId}/trips/${tripId}`
      ),
      api<CarpoolGroup>(`/api/groups/${groupId}`),
    ])
      .then(([t, g]) => { setTrip({ ...t, groupId }); setGroup(g); })
      .catch(() => showError("Fahrt konnte nicht geladen werden"))
      .finally(() => setLoading(false));
  }, [groupId, tripId, showError]);

  if (editing && trip && group) {
    return (
      <TripFormModal
        group={group}
        editTrip={trip}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          success("Fahrt aktualisiert");
          onUpdated();
        }}
      />
    );
  }

  const canEdit = trip && user && (
    trip.driver.id === user.id ||
    group?.ownerId === user.id ||
    user.roles?.includes("FAHRER")
  );

  const totalKm = trip ? (trip.outboundKm ?? 0) + (trip.returnKm ?? 0) : 0;
  const fuelCost = trip
    ? (trip.totalFuelCost ?? computeTripFuelCost(trip))
    : 0;
  const billableTotal = trip ? sumPassengerCosts(trip.participations) : 0;
  const hasPassengers = (trip?.participations.length ?? 0) > 0;

  return (
    <Modal isOpen onClose={onClose} title="Fahrtdetails" size="md">
      {loading || !trip ? (
        <SkeletonCard />
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center shrink-0">
              <MapPin className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-zinc-100">{formatDate(trip.tripDate)}</p>
              {trip.groupName && (
                <p className="text-sm text-zinc-400">{trip.groupName}</p>
              )}
              <p className="text-xs text-zinc-500 mt-1">
                Fahrer: {trip.driver.firstName} {trip.driver.lastName}
                {trip.vehicle && ` · ${trip.vehicle.name}`}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-bold text-green-400">{formatEuro(fuelCost)}</p>
              <p className="text-xs text-zinc-500">
                {hasPassengers ? `Fahrtkosten · ${formatEuro(billableTotal)} abrechenbar` : "Fahrtkosten · privat"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-zinc-800/50 rounded-lg p-2">
              <p className="text-xs text-zinc-500">Strecke</p>
              <p className="text-zinc-200">{totalKm.toFixed(1)} km</p>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-2">
              <p className="text-xs text-zinc-500">Kraftstoff</p>
              <p className="text-zinc-200">{trip.fuelPriceUsed.toFixed(3)} €/L</p>
            </div>
            {trip.outboundKm != null && trip.outboundKm > 0 && (
              <div className="bg-zinc-800/50 rounded-lg p-2">
                <p className="text-xs text-zinc-500">Hinweg</p>
                <p className="text-zinc-200">{trip.outboundKm.toFixed(1)} km</p>
              </div>
            )}
            {trip.returnKm != null && trip.returnKm > 0 && (
              <div className="bg-zinc-800/50 rounded-lg p-2">
                <p className="text-xs text-zinc-500">Rückweg</p>
                <p className="text-zinc-200">{trip.returnKm.toFixed(1)} km</p>
              </div>
            )}
          </div>

          {trip.comment && (
            <p className="text-sm text-zinc-400 italic bg-zinc-800/30 rounded-lg px-3 py-2">
              💬 {trip.comment}
            </p>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-500">Tankkosten</p>
            <div className="flex justify-between bg-zinc-800/30 rounded-lg px-3 py-2 text-sm">
              <span className="text-zinc-400">
                {totalKm.toFixed(1)} km · {trip.consumptionPer100km?.toFixed(1) ?? "8.0"} L/100 km
              </span>
              <span className="font-medium text-green-400">{formatEuro(fuelCost)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-500">Mitfahrer & Abrechnung</p>
            {!hasPassengers ? (
              <p className="text-sm text-zinc-500">Keine Mitfahrer – keine Schulden, nur dokumentierte Fahrtkosten.</p>
            ) : (
              [...new Map(
                trip.participations.map((p) => [
                  p.userId,
                  {
                    ...p,
                    total: trip.participations
                      .filter((x) => x.userId === p.userId)
                      .reduce((s, x) => s + x.amountOwed, 0),
                  },
                ])
              ).values()].map((p) => (
                <div key={p.userId} className="flex items-center justify-between bg-zinc-800/30 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar name={`${p.firstName} ${p.lastName}`} size="sm" />
                    <div>
                      <p className="text-sm text-zinc-300">{p.firstName} {p.lastName}</p>
                      <p className="text-xs text-zinc-500">
                        {trip.participations
                          .filter((x) => x.userId === p.userId)
                          .map((x) => (x.direction === "OUTBOUND" ? "Hin" : "Rück"))
                          .join(" + ")}
                      </p>
                    </div>
                  </div>
                  <p className={clsx("font-medium", "text-orange-400")}>{formatEuro(p.total)}</p>
                </div>
              ))
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              Schließen
            </Button>
            {canEdit && (
              <Button
                type="button"
                icon={<Pencil className="w-4 h-4" />}
                onClick={() => setEditing(true)}
                className="flex-1"
              >
                Bearbeiten
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
