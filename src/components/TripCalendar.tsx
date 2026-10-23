import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { api } from "../lib/api.ts";
import { Card, SkeletonCard } from "./ui/index.tsx";
import { clsx } from "clsx";
import TripDetailModal from "./TripDetailModal.tsx";

export interface CalendarTrip {
  id: number;
  groupId: number;
  groupName: string;
  tripDate: string;
  outboundKm?: number | null;
  returnKm?: number | null;
  driver: { id: number; firstName: string; lastName: string };
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function toDateKey(d: string | Date): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function driverShort(first: string, last: string): string {
  return `${first.charAt(0)}.${last}`;
}

export default function TripCalendar() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [trips, setTrips] = useState<CalendarTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<CalendarTrip | null>(null);

  useEffect(() => {
    setLoading(true);
    api<{ trips: CalendarTrip[] }>(`/api/calendar?year=${year}&month=${month}`)
      .then((data) => setTrips(data.trips))
      .catch(() => setTrips([]))
      .finally(() => setLoading(false));
  }, [year, month]);

  const tripsByDay = useMemo(() => {
    const map = new Map<string, CalendarTrip[]>();
    for (const t of trips) {
      const key = toDateKey(t.tripDate);
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [trips]);

  const grid = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startOffset = (first.getDay() + 6) % 7;
    const cells: { day: number | null; dateKey: string | null }[] = [];
    for (let i = 0; i < startOffset; i++) cells.push({ day: null, dateKey: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ day: d, dateKey });
    }
    while (cells.length % 7 !== 0) cells.push({ day: null, dateKey: null });
    return cells;
  }, [year, month]);

  const todayKey = toDateKey(now);

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  }

  function nextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  }

  function handleDayClick(dateKey: string) {
    const dayTrips = tripsByDay.get(dateKey) ?? [];
    if (dayTrips.length === 0) return;
    if (dayTrips.length === 1) {
      setSelectedTrip(dayTrips[0]);
    } else {
      setSelectedDay(dateKey);
    }
  }

  function reloadCalendar() {
    api<{ trips: CalendarTrip[] }>(`/api/calendar?year=${year}&month=${month}`)
      .then((data) => setTrips(data.trips))
      .catch(() => {});
  }

  const dayTripsForPicker = selectedDay ? (tripsByDay.get(selectedDay) ?? []) : [];

  return (
    <>
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-400" />
            Fahrtenkalender
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={prevMonth}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              aria-label="Vorheriger Monat"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-zinc-200 min-w-[8rem] text-center">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              aria-label="Nächster Monat"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <SkeletonCard />
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((wd) => (
                <div key={wd} className="text-xs font-medium text-zinc-500 py-1">{wd}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {grid.map((cell, i) => {
                if (cell.day === null || !cell.dateKey) {
                  return <div key={`empty-${i}`} className="min-h-[4.5rem]" />;
                }
                const dayTrips = tripsByDay.get(cell.dateKey) ?? [];
                const isToday = cell.dateKey === todayKey;
                const hasTrips = dayTrips.length > 0;

                return (
                  <button
                    key={cell.dateKey}
                    type="button"
                    onClick={() => handleDayClick(cell.dateKey!)}
                    disabled={!hasTrips}
                    className={clsx(
                      "min-h-[4.5rem] rounded-lg border p-1 text-left transition-colors",
                      hasTrips
                        ? "border-zinc-600 bg-zinc-800/50 hover:border-blue-500/60 hover:bg-blue-900/20 cursor-pointer"
                        : "border-zinc-800/50 bg-zinc-900/30 cursor-default",
                      isToday && "ring-1 ring-blue-500/50"
                    )}
                  >
                    <span className={clsx(
                      "text-xs font-medium",
                      isToday ? "text-blue-400" : "text-zinc-400"
                    )}>
                      {cell.day}
                    </span>
                    {hasTrips && (
                      <div className="mt-1 space-y-0.5">
                        {dayTrips.slice(0, 2).map((t) => (
                          <p
                            key={t.id}
                            className="text-[10px] leading-tight text-zinc-300 truncate"
                            title={`${t.driver.firstName} ${t.driver.lastName} · ${t.groupName}`}
                          >
                            <span className="text-blue-400 font-medium">
                              {driverShort(t.driver.firstName, t.driver.lastName)}
                            </span>
                            <span className="text-zinc-500"> · {t.groupName}</span>
                          </p>
                        ))}
                        {dayTrips.length > 2 && (
                          <p className="text-[10px] text-zinc-500">+{dayTrips.length - 2} weitere</p>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-zinc-500">
              Tippe auf einen Tag mit Fahrten, um Details zu sehen · Fahrer-Kürzel in Blau
            </p>
          </>
        )}
      </Card>

      {selectedDay && dayTripsForPicker.length > 1 && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60">
          <Card className="w-full max-w-sm space-y-3">
            <p className="font-medium text-zinc-200">
              Fahrten am {new Date(selectedDay + "T12:00:00").toLocaleDateString("de-DE")}
            </p>
            <div className="space-y-2">
              {dayTripsForPicker.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setSelectedDay(null); setSelectedTrip(t); }}
                  className="w-full text-left p-3 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700"
                >
                  <p className="text-sm text-zinc-200">{t.groupName}</p>
                  <p className="text-xs text-zinc-500">
                    Fahrer: {t.driver.firstName} {t.driver.lastName}
                    {((t.outboundKm ?? 0) + (t.returnKm ?? 0)) > 0 &&
                      ` · ${((t.outboundKm ?? 0) + (t.returnKm ?? 0)).toFixed(1)} km`}
                  </p>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSelectedDay(null)}
              className="w-full text-sm text-zinc-400 hover:text-zinc-200 py-2"
            >
              Schließen
            </button>
          </Card>
        </div>
      )}

      {selectedTrip && (
        <TripDetailModal
          groupId={selectedTrip.groupId}
          tripId={selectedTrip.id}
          onClose={() => setSelectedTrip(null)}
          onUpdated={() => { setSelectedTrip(null); reloadCalendar(); }}
        />
      )}
    </>
  );
}