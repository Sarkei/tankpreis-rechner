import React, { useState } from "react";
import { Check } from "lucide-react";
import { api } from "../lib/api.ts";
import { useToast } from "../lib/ToastContext.tsx";
import type { Debt } from "../types.ts";
import { Card, Button, Avatar, formatEuro } from "./ui/index.tsx";
import CopyIbanButton from "./CopyIbanButton.tsx";
import ReportPaymentModal from "./ReportPaymentModal.tsx";

export default function DebtPayCard({
  debt,
  onUpdated,
}: {
  debt: Debt;
  onUpdated: () => void;
}) {
  const { success, error: showError } = useToast();
  const [settling, setSettling] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);

  async function handleQuickSettle() {
    setSettling(true);
    try {
      await api(`/api/groups/${debt.groupId}/payments/report`, {
        method: "POST",
        body: JSON.stringify({
          receiverId: debt.creditor.id,
          amount: debt.openAmount,
        }),
      });
      success(
        `${formatEuro(debt.openAmount)} an ${debt.creditor.firstName} gemeldet`
      );
      onUpdated();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setSettling(false);
    }
  }

  return (
    <>
      <Card className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Avatar
            name={`${debt.creditor.firstName} ${debt.creditor.lastName}`}
            size="md"
          />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-zinc-100 truncate">
              {debt.creditor.firstName} {debt.creditor.lastName}
            </p>
            <p className="text-xs text-zinc-500 truncate">{debt.groupName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-zinc-500">Offen</p>
            <p className="text-2xl font-bold text-orange-400">
              {formatEuro(debt.openAmount)}
            </p>
          </div>
          <Button
            variant="success"
            loading={settling}
            onClick={handleQuickSettle}
            icon={<Check className="w-4 h-4" />}
            className="shrink-0"
          >
            Begleichen
          </Button>
        </div>

        {debt.creditor.iban ? (
          <CopyIbanButton iban={debt.creditor.iban} />
        ) : (
          <p className="text-xs text-amber-500/90 bg-amber-950/30 border border-amber-900/40 rounded-lg px-3 py-2">
            Keine IBAN hinterlegt – bitte den Fahrer nach den Kontodaten fragen.
          </p>
        )}

        <button
          type="button"
          onClick={() => setShowAdjust(true)}
          className="text-xs text-zinc-500 hover:text-zinc-300 w-full text-center py-1"
        >
          Anderen Betrag melden
        </button>
      </Card>

      {showAdjust && (
        <ReportPaymentModal
          debt={debt}
          onClose={() => setShowAdjust(false)}
          onReported={() => {
            setShowAdjust(false);
            success("Zahlung gemeldet!");
            onUpdated();
          }}
        />
      )}
    </>
  );
}
