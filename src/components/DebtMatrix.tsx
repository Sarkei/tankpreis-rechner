import { Check, HandCoins } from "lucide-react";
import type { Matrix } from "../lib/calc.ts";
import { eur } from "../lib/format.ts";
import { Card } from "./ui.tsx";

export function DebtMatrix({
  matrix,
  onSettle,
  canSettle,
  myPersonId,
}: {
  matrix: Matrix;
  onSettle: (debtorId: number, creditorId: number | null) => void;
  /** Nur eigene Schulden (oder als Admin alle) dürfen beglichen werden. */
  canSettle: (debtorId: number) => boolean;
  myPersonId: number | null;
}) {
  const { drivers, passengers } = matrix;

  if (drivers.length === 0 || passengers.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-sm text-muted">
          Sobald jemand mitfährt, erscheint hier, wer wem wie viel schuldet.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <HandCoins className="h-4 w-4 text-accent" />
          Offene Beträge
        </div>
        <span className="text-sm text-muted">
          gesamt <span className="font-semibold text-ink">{eur(matrix.total)}</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-[88px] bg-surface px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted">
                Fahrer ↓
              </th>
              {passengers.map((passenger) => (
                <th
                  key={passenger.id}
                  className="min-w-[72px] px-1.5 py-2 text-center text-xs font-semibold text-ink"
                >
                  {passenger.name}
                  {passenger.id === myPersonId && <span className="block text-[10px] text-accent">du</span>}
                </th>
              ))}
              <th className="hidden min-w-[72px] px-2 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted sm:table-cell">
                Σ
              </th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((driver) => (
              <tr key={driver.id} className="border-t border-line">
                <th className="sticky left-0 z-10 max-w-[88px] truncate bg-surface px-2 py-2 text-left text-sm font-medium text-ink">
                  {driver.name}
                  {driver.id === myPersonId && <span className="block text-[10px] text-accent">du</span>}
                </th>
                {passengers.map((passenger) => {
                  const isSelf = driver.id === passenger.id;
                  const amount = matrix.cells[`${driver.id}:${passenger.id}`] ?? 0;
                  return (
                    <td key={passenger.id} className="px-1.5 py-2 text-center">
                      {isSelf ? (
                        <span className="text-placeholder">–</span>
                      ) : amount > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-semibold text-danger">{eur(amount)}</span>
                          {canSettle(passenger.id) && (
                            <button
                              onClick={() => onSettle(passenger.id, driver.id)}
                              title={`${passenger.name} hat ${driver.name} bezahlt`}
                              aria-label={`${passenger.name} hat ${driver.name} bezahlt`}
                              className="rounded-md bg-surface-2 p-1 text-muted hover:bg-accent hover:text-on-accent"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </span>
                      ) : (
                        <span className="text-accent">0,00 €</span>
                      )}
                    </td>
                  );
                })}
                <td className="hidden px-2 py-2 text-right text-xs text-muted sm:table-cell">
                  {eur(matrix.rowTotals[String(driver.id)] ?? 0)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-line-strong bg-surface-2">
              <th className="sticky left-0 z-10 w-[88px] bg-surface-2 px-2 py-3 text-left text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted">
                Begleichen
              </th>
              {passengers.map((passenger) => {
                const total = matrix.colTotals[String(passenger.id)] ?? 0;
                return (
                  <td key={passenger.id} className="px-1.5 py-2 text-center">
                    {total > 0 && canSettle(passenger.id) ? (
                      <button
                        onClick={() => onSettle(passenger.id, null)}
                        className="w-full whitespace-nowrap rounded-lg bg-surface-2 px-1.5 py-1.5 text-[11px] font-medium text-ink hover:bg-accent hover:text-on-accent"
                      >
                        {eur(total)} zahlen
                      </button>
                    ) : total > 0 ? (
                      <span className="text-[11px] font-medium text-danger">{eur(total)}</span>
                    ) : (
                      <span className="text-sm text-accent" title="ausgeglichen">✓</span>
                    )}
                  </td>
                );
              })}
              <td className="hidden px-2 py-3 text-right text-xs font-semibold text-ink sm:table-cell">
                {eur(matrix.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="border-t border-line px-4 py-2.5 text-xs leading-relaxed text-muted">
        Zelle = was der Mitfahrer (Spalte) dem Fahrer (Zeile) schuldet.{" "}
        <span className="text-danger">Rot</span> = offen, <span className="text-accent">grün</span> = bezahlt.
        Häkchen bestätigt eine einzelne Zahlung, der Button unten begleicht alle offenen Beträge eines Mitfahrers.
      </p>
    </Card>
  );
}
