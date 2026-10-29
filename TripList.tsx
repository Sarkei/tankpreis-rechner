import { ArrowLeftRight, ArrowRight, Car, Trash2, Users } from "lucide-react";
import type { Trip } from "../lib/calc.ts";
import { dayLabel, eur, kmLabel } from "../lib/format.ts";
import { Card } from "./ui.tsx";

function DirectionBadge({ direction }: { direction: Trip["direction"] }) {
  const isHin = direction === "HIN";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide " +
        (isHin ? "bg-blue-600/20 text-blue-300" : "bg-amber-600/20 text-amber-300")
      }
    >
      {isHin ? <ArrowRight className="h-3 w-3" /> : <ArrowLeftRight className="h-3 w-3" />}
      {isHin ? "Hin" : "Rück"}
    </span>
  );
}

export function TripList({ trips, onDelete }: { trips: Trip[]; onDelete: (trip: Trip) => void }) {
  if (trips.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-sm text-zinc-400">Noch keine Fahrten eingetragen.</p>
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
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{dayLabel(date)}</span>
              <span className="text-xs text-zinc-500">{eur(dayTotal)} Sprit</span>
            </div>
            <Card className="divide-y divide-zinc-800 overflow-hidden">
              {dayTrips.map((trip) => (
                <div key={trip.id} className="flex items-start gap-3 p-3">
                  <div className="mt-0.5">
                    <DirectionBadge direction={trip.direction} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                      <span className="inline-flex items-center gap-1 font-medium text-zinc-100">
                        <Car className="h-3.5 w-3.5 text-zinc-500" />
                        {trip.driverName}
                      </span>
                      <span className="text-zinc-500">{kmLabel(trip.km)}</span>
                      <span className="text-zinc-500">·</span>
                      <span className="text-zinc-400">{eur(trip.cost)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {trip.passengers.length > 0
                          ? trip.passengers.map((passenger) => passenger.name).join(", ")
                          : "allein gefahren"}
                      </span>
                      <span>·</span>
                      <span>
                        je <span className="text-emerald-400">{eur(trip.share)}</span> ({trip.passengers.length + 1}{" "}
                        Insassen)
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => onDelete(trip)}
                    aria-label="Fahrt löschen"
                    className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </Card>
          </div>
        );
      })}
    </div>
  );
}
