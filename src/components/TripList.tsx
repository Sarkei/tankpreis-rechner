import { ArrowLeftRight, ArrowRight, Car, MapPin, Trash2, Users } from "lucide-react";
import type { Trip } from "../lib/calc.ts";
import { dayLabel, eur, kmLabel } from "../lib/format.ts";
import { Card } from "./ui.tsx";

function DirectionBadge({ direction }: { direction: Trip["direction"] }) {
  const isHin = direction === "HIN";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide " +
        (isHin ? "bg-accent-soft text-accent-ink" : "bg-warn-soft text-warn")
      }
    >
      {isHin ? <ArrowRight className="h-3 w-3" /> : <ArrowLeftRight className="h-3 w-3" />}
      {isHin ? "Hin" : "Rück"}
    </span>
  );
}

export function TripList({
  trips,
  onDelete,
  canDelete,
  myPersonId,
}: {
  trips: Trip[];
  onDelete: (trip: Trip) => void;
  /** Nur eigene Fahrten (oder als Admin alle) dürfen gelöscht werden. */
  canDelete: (trip: Trip) => boolean;
  myPersonId: number | null;
}) {
  if (trips.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-sm text-muted">Noch keine Fahrten eingetragen.</p>
      </Card>
    );
  }

  const groups = new Map<string, Trip[]>();
  for (const trip of trips) {
    const list = groups.get(trip.date) ?? [];
    list.push(trip);
    groups.set(trip.date, list);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([date, dayTrips]) => {
        const dayTotal = dayTrips.reduce((sum, trip) => sum + trip.cost, 0);
        return (
          <div key={date}>
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">{dayLabel(date)}</span>
              <span className="text-xs text-muted">{eur(dayTotal)} Sprit</span>
            </div>
            <Card className="divide-y divide-line overflow-hidden">
              {dayTrips.map((trip) => (
                <div key={trip.id} className="flex items-start gap-3 p-3">
                  <div className="mt-0.5">
                    <DirectionBadge direction={trip.direction} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                      <span className="inline-flex items-center gap-1 font-medium text-ink">
                        <Car className="h-3.5 w-3.5 text-muted" />
                        {trip.driverName}
                        {trip.driverId === myPersonId && <span className="text-[10px] text-accent">du</span>}
                      </span>
                      <span className="text-muted">{kmLabel(trip.km)}</span>
                      <span className="text-muted">·</span>
                      <span className="text-muted">{eur(trip.cost)}</span>
                    </div>
                    {(trip.fromLabel || trip.toLabel) && (
                      <div className="mt-1 flex items-start gap-1 text-xs text-muted">
                        <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-placeholder" />
                        <span className="line-clamp-2">
                          {trip.fromLabel ?? "?"} → {trip.toLabel ?? "?"}
                        </span>
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {trip.passengers.length > 0
                          ? trip.passengers.map((passenger) => passenger.name).join(", ")
                          : "allein gefahren"}
                      </span>
                      <span>·</span>
                      <span>
                        je <span className="text-accent">{eur(trip.share)}</span> ({trip.passengers.length + 1}{" "}
                        Insassen)
                      </span>
                    </div>
                  </div>
                  {canDelete(trip) && (
                    <button
                      onClick={() => onDelete(trip)}
                      aria-label="Fahrt löschen"
                      className="rounded-lg p-2 text-placeholder hover:bg-surface-2 hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </Card>
          </div>
        );
      })}
    </div>
  );
}
