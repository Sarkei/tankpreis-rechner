import React, { useEffect, useState, useCallback } from "react";
import { Plus, MapPin, Trash2, ChevronDown, ChevronUp, Users } from "lucide-react";
import { api } from "../lib/api.ts";
import { useToast } from "../lib/ToastContext.tsx";
import { useAuth } from "../lib/AuthContext.tsx";
import type { Trip, CarpoolGroup, GroupDriver } from "../types.ts";
import {
  Card, Button, EmptyState,
  SkeletonCard, Avatar, formatEuro, formatDate
} from "../components/ui/index.tsx";
import { TripFormModal } from "../components/TripFormModal.tsx";
import { TripGroupSelectModal } from "../components/TripGroupSelectModal.tsx";
import { computeTripFuelCost, sumPassengerCosts } from "../lib/tripCost.ts";

type GroupTrips = { group: CarpoolGroup; trips: Trip[] };

export default function TripsPage() {
  const { user, isDriver } = useAuth();
  const { success, error: showError } = useToast();
  const [groups, setGroups] = useState<CarpoolGroup[]>([]);
  const [groupTrips, setGroupTrips] = useState<GroupTrips[]>([]);
  const [loading, setLoading] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formGroup, setFormGroup] = useState<CarpoolGroup | null>(null);
  const [driverGroups, setDriverGroups] = useState<CarpoolGroup[]>([]);
  const [expandedTripId, setExpandedTripId] = useState<number | null>(null);

  useEffect(() => {
    api<CarpoolGroup[]>("/api/groups")
      .then((data) => setGroups(data.filter((g) => !g.isArchived)))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (groups.length === 0 || !user?.id) {
      setDriverGroups([]);
      return;
    }
    Promise.all(
      groups.map(async (g) => {
        const drivers = await api<GroupDriver[]>(`/api/groups/${g.id}/drivers`).catch(() => []);
        return drivers.some((d) => d.id === user.id) ? g : null;
      })
    ).then((results) => {
      setDriverGroups(results.filter((g): g is CarpoolGroup => g !== null));
    });
  }, [groups, user?.id]);

  const loadAllTrips = useCallback(async () => {
    if (groups.length === 0) {
      setGroupTrips([]);
      return;
    }
    setLoading(true);
    try {
      const results = await Promise.all(
        groups.map(async (g) => {
          const data = await api<{ trips: Trip[]; total: number }>(
            `/api/groups/${g.id}/trips?limit=50`
          );
          return { group: g, trips: data.trips };
        })
      );
      setGroupTrips(results);
    } catch {
      showError("Fahrten konnten nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, [groups, showError]);

  useEffect(() => {
    loadAllTrips();
  }, [loadAllTrips]);

  function openTripForm() {
    if (driverGroups.length === 0) return;
    if (driverGroups.length === 1) {
      setFormGroup(driverGroups[0]);
      setShowForm(true);
    } else {
      setShowGroupPicker(true);
    }
  }

  function handleGroupSelected(group: CarpoolGroup) {
    setShowGroupPicker(false);
    setFormGroup(group);
    setShowForm(true);
  }

  function closeTripForm() {
    setShowForm(false);
    setFormGroup(null);
  }

  async function deleteTrip(tripId: number, groupId: number) {
    if (!confirm("Fahrt wirklich löschen? Die Schulden werden zurückgesetzt.")) return;
    try {
      await api(`/api/groups/${groupId}/trips/${tripId}`, { method: "DELETE" });
      setGroupTrips((prev) =>
        prev.map((section) =>
          section.group.id === groupId
            ? { ...section, trips: section.trips.filter((t) => t.id !== tripId) }
            : section
        )
      );
      success("Fahrt gelöscht");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Fehler");
    }
  }

  const canLogTrips = driverGroups.length > 0;

  if (!isDriver) {
    return <PassengerTripsView />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-100">Fahrten</h1>
        {canLogTrips && (
          <Button icon={<Plus className="w-4 h-4" />} onClick={openTripForm}>
            Fahrt eintragen
          </Button>
        )}
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<MapPin className="w-12 h-12" />}
          title="Keine Gruppen"
          description="Erstelle zuerst eine Fahrgruppe."
        />
      ) : loading ? (
        <div className="space-y-3"><SkeletonCard /><SkeletonCard /></div>
      ) : (
        <div className="space-y-8">
          {groupTrips.map(({ group, trips }) => (
            <section key={group.id} className="space-y-3">
              <div className="flex items-center gap-3 pb-1 border-b border-zinc-800">
                <div className="w-9 h-9 bg-blue-600/20 rounded-xl flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-zinc-100 truncate">{group.name}</h2>
                  <p className="text-xs text-zinc-500">
                    {trips.length === 1 ? "1 Fahrt" : `${trips.length} Fahrten`}
                  </p>
                </div>
              </div>

              {trips.length === 0 ? (
                <p className="text-sm text-zinc-500 py-2 pl-1">Noch keine Fahrten in dieser Gruppe.</p>
              ) : (
                <div className="space-y-3">
                  {trips.map((trip) => (
                    <TripCard
                      key={trip.id}
                      trip={trip}
                      canDelete={group.ownerId === user?.id || trip.driver.id === user?.id}
                      expanded={expandedTripId === trip.id}
                      onToggle={() =>
                        setExpandedTripId(expandedTripId === trip.id ? null : trip.id)
                      }
                      onDelete={() => deleteTrip(trip.id, group.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {showGroupPicker && (
        <TripGroupSelectModal
          groups={driverGroups}
          onClose={() => setShowGroupPicker(false)}
          onSelect={handleGroupSelected}
        />
      )}

      {showForm && formGroup && (
        <TripFormModal
          group={formGroup}
          onClose={closeTripForm}
          onSaved={() => {
            closeTripForm();
            loadAllTrips();
            success("Fahrt eingetragen!");
          }}
        />
      )}
    </div>
  );
}

function TripCard({
  trip, canDelete, expanded, onToggle, onDelete
}: {
  trip: Trip;
  canDelete: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const totalKm = (trip.outboundKm ?? 0) + (trip.returnKm ?? 0);
  const fuelCost = trip.totalFuelCost ?? computeTripFuelCost(trip);
  const billableTotal = sumPassengerCosts(trip.participations);
  const hasPassengers = trip.participations.length > 0;

  const uniqueParticipants = [...new Map(trip.participations.map(p => [p.userId, p])).values()];

  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-zinc-100">{formatDate(trip.tripDate)}</p>
            <div className="flex items-center gap-1">
              {canDelete && (
                <button onClick={onDelete} className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button onClick={onToggle} className="p-1.5 text-zinc-500 hover:text-zinc-300">
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            {totalKm.toFixed(1)} km ·{" "}
            {trip.outboundKm ? `Hin ${trip.outboundKm.toFixed(1)}` : ""}
            {trip.outboundKm && trip.returnKm ? " · " : ""}
            {trip.returnKm ? `Rück ${trip.returnKm.toFixed(1)}` : ""}
            {" · "}{trip.fuelPriceUsed.toFixed(3)} €/L
            {" · "}Fahrer: {trip.driver.firstName} {trip.driver.lastName}
          </p>
          <div className="flex items-center gap-1 mt-1">
            {uniqueParticipants.slice(0, 4).map((p) => (
              <Avatar key={p.userId} name={`${p.firstName} ${p.lastName}`} size="sm" />
            ))}
            {uniqueParticipants.length > 4 && (
              <span className="text-xs text-zinc-500">+{uniqueParticipants.length - 4}</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-green-400">{formatEuro(fuelCost)}</p>
          <p className="text-xs text-zinc-500">
            {hasPassengers ? `Fahrtkosten · ${formatEuro(billableTotal)} abrechenbar` : "Fahrtkosten · privat"}
          </p>
        </div>
      </div>

      {trip.comment && (
        <p className="text-xs text-zinc-500 italic">💬 {trip.comment}</p>
      )}

      {expanded && (
        <div className="pt-3 border-t border-zinc-800 space-y-2">
          <p className="text-xs font-medium text-zinc-500">Kosten</p>
          <div className="flex justify-between text-sm bg-zinc-800/30 rounded-lg px-3 py-2">
            <span className="text-zinc-400">Tankkosten (Strecke × Verbrauch)</span>
            <span className="font-medium text-green-400">{formatEuro(fuelCost)}</span>
          </div>
          {hasPassengers ? (
            <>
              <p className="text-xs font-medium text-zinc-500 pt-1">Aufteilung Mitfahrer</p>
              {[...new Map(
            trip.participations.map((p) => [
              p.userId,
              {
                ...p,
                total: trip.participations.filter((x) => x.userId === p.userId).reduce((s, x) => s + x.amountOwed, 0),
              },
            ])
          ).values()].map((p) => (
            <div key={p.userId} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Avatar name={`${p.firstName} ${p.lastName}`} size="sm" />
                <div>
                  <p className="text-sm text-zinc-300">{p.firstName} {p.lastName}</p>
                  <p className="text-xs text-zinc-500">
                    {trip.participations.filter((x) => x.userId === p.userId).map((x) => x.direction === "OUTBOUND" ? "Hin" : "Rück").join(" + ")}
                  </p>
                </div>
              </div>
              <p className="font-medium text-orange-400">{formatEuro(p.total)}</p>
            </div>
          ))}
            </>
          ) : (
            <p className="text-xs text-zinc-500 px-1">
              Keine Mitfahrer – es werden keine Schulden angelegt. Die Fahrtkosten basieren auf
              {" "}{trip.consumptionPer100km?.toFixed(1) ?? "8.0"} L/100 km und {trip.fuelPriceUsed.toFixed(3)} €/L.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function PassengerTripsView() {
  const [trips, setTrips] = useState<{
    id: number; tripDate: string; groupName: string; driverName: string;
    outboundKm?: number; returnKm?: number; totalOwed: number;
  }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<typeof trips>("/api/my-trips")
      .then(setTrips)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const tripsByGroup = trips.reduce((acc, trip) => {
    const list = acc.get(trip.groupName) ?? [];
    list.push(trip);
    acc.set(trip.groupName, list);
    return acc;
  }, new Map<string, typeof trips>());

  const grouped = [...tripsByGroup.entries()].sort(([a], [b]) => a.localeCompare(b, "de"));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-zinc-100">Meine Fahrten</h1>
      {loading ? (
        <div className="space-y-3"><SkeletonCard /><SkeletonCard /></div>
      ) : trips.length === 0 ? (
        <EmptyState icon={<MapPin className="w-12 h-12" />} title="Noch keine Fahrten" description="Du wirst hier sehen, an welchen Fahrten du teilgenommen hast." />
      ) : (
        <div className="space-y-8">
          {grouped.map(([groupName, groupTripList]) => (
            <section key={groupName} className="space-y-3">
              <div className="flex items-center gap-3 pb-1 border-b border-zinc-800">
                <div className="w-9 h-9 bg-blue-600/20 rounded-xl flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-zinc-100 truncate">{groupName}</h2>
                  <p className="text-xs text-zinc-500">
                    {groupTripList.length === 1 ? "1 Fahrt" : `${groupTripList.length} Fahrten`}
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {groupTripList.map((t) => (
                  <Card key={t.id} className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center shrink-0">
                      <MapPin className="w-5 h-5 text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-zinc-200">{formatDate(t.tripDate)}</p>
                      <p className="text-xs text-zinc-500">
                        {t.driverName} · {((t.outboundKm ?? 0) + (t.returnKm ?? 0)).toFixed(1)} km
                      </p>
                    </div>
                    <p className="font-bold text-orange-400">{formatEuro(t.totalOwed)}</p>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
