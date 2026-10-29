import { Check, HandCoins } from "lucide-react";
import type { Matrix } from "../lib/calc.ts";
import { eur } from "../lib/format.ts";
import { Card } from "./ui.tsx";

export function DebtMatrix({
  matrix,
  onSettle,
}: {
  matrix: Matrix;
  onSettle: (debtorId: number, creditorId: number | null) => void;
}) {
  const { drivers, passengers } = matrix;

  if (drivers.length === 0 || passengers.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-sm text-zinc-400">
          Sobald jemand mitfährt, erscheint hier, wer wem wie viel schuldet.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <HandCoins className="h-4 w-4 text-emerald-400" />
          Offene Beträge
        </div>
        <span className="text-sm text-zinc-400">
          gesamt <span className="font-semibold text-zinc-100">{eur(matrix.total)}</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-[88px] bg-zinc-900 px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Fahrer ↓
              </th>
              {passengers.map((passenger) => (
                <th
                  key={passenger.id}
                  className="min-w-[72px] px-1.5 py-2 text-center text-xs font-semibold text-zinc-300"
                >
                  {passenger.name}
                </th>
              ))}
              <th className="hidden min-w-[72px] px-2 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 sm:table-cell">
                Σ
              </th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((driver) => (
              <tr key={driver.id} className="border-t border-zinc-800">
                <th className="sticky left-0 z-10 max-w-[88px] truncate bg-zinc-900 px-2 py-2 text-left text-sm font-medium text-zinc-100">
                  {driver.name}
                </th>
                {passengers.map((passenger) => {
                  const isSelf = driver.id === passenger.id;
                  const amount = matrix.cells[`${driver.id}:${passenger.id}`] ?? 0;
                  return (
                    <td key={passenger.id} className="px-1.5 py-2 text-center">
                      {isSelf ? (
                        <span className="text-zinc-700">–</span>
                      ) : amount > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-semibold text-red-400">{eur(amount)}</span>
                          <button
                            onClick={() => onSettle(passenger.id, driver.id)}
                            title={`${passenger.name} hat ${driver.name} bezahlt`}
                            aria-label={`${passenger.name} hat ${driver.name} bezahlt`}
                            className="rounded-md bg-zinc-800 p-1 text-zinc-400 hover:bg-emerald-600 hover:text-white"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ) : (
                        <span className="text-emerald-400/80">0,00 €</span>
                      )}
                    </td>
                  );
                })}
                <td className="hidden px-2 py-2 text-right text-xs text-zinc-400 sm:table-cell">
                  {eur(matrix.rowTotals[String(driver.id)] ?? 0)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-zinc-700 bg-zinc-950/40">
              <th className="sticky left-0 z-10 w-[88px] bg-zinc-950 px-2 py-3 text-left text-[11px] font-semibold uppercase leading-tight tracking-wide text-zinc-400">
                Begleichen
              </th>
              {passengers.map((passenger) => {
                const total = matrix.colTotals[String(passenger.id)] ?? 0;
                return (
                  <td key={passenger.id} className="px-1.5 py-2 text-center">
                    {total > 0 ? (
                      <button
                        onClick={() => onSettle(passenger.id, null)}
                        className="w-full whitespace-nowrap rounded-lg bg-zinc-800 px-1.5 py-1.5 text-[11px] font-medium text-zinc-200 hover:bg-emerald-600 hover:text-white"
                      >
                        {eur(total)} zahlen
                      </button>
                    ) : (
                      <span className="text-sm text-emerald-400/80" title="ausgeglichen">✓</span>
                    )}
                  </td>
                );
              })}
              <td className="hidden px-2 py-3 text-right text-xs font-semibold text-zinc-200 sm:table-cell">
                {eur(matrix.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="border-t border-zinc-800 px-4 py-2.5 text-xs leading-relaxed text-zinc-500">
        Zelle = was der Mitfahrer (Spalte) dem Fahrer (Zeile) schuldet.{" "}
        <span className="text-red-400">Rot</span> = offen, <span className="text-emerald-400">grün</span> = bezahlt.
        Häkchen bestätigt eine einzelne Zahlung, der Button unten begleicht alle offenen Beträge eines Mitfahrers.
      </p>
    </Card>
  );
}
