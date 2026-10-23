import React, { useState } from "react";
import { api } from "../lib/api.ts";
import { useToast } from "../lib/ToastContext.tsx";
import type { Debt } from "../types.ts";
import { Modal, Button, Input, Textarea, formatEuro } from "./ui/index.tsx";

export default function ReportPaymentModal({
  debt,
  onClose,
  onReported,
}: {
  debt: Debt;
  onClose: () => void;
  onReported: () => void;
}) {
  const { error: showError } = useToast();
  const [amount, setAmount] = useState(String(debt.openAmount.toFixed(2)));
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api(`/api/groups/${debt.groupId}/payments/report`, {
        method: "POST",
        body: JSON.stringify({
          receiverId: debt.creditor.id,
          amount: parseFloat(amount),
          note: note || undefined,
        }),
      });
      onReported();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Zahlung melden">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-zinc-400">
          An:{" "}
          <strong className="text-zinc-200">
            {debt.creditor.firstName} {debt.creditor.lastName}
          </strong>
          <span className="ml-2 text-zinc-500">({debt.groupName})</span>
        </p>
        <p className="text-sm text-zinc-500">
          Offen:{" "}
          <strong className="text-orange-400">{formatEuro(debt.openAmount)}</strong>
        </p>
        <Input
          label="Betrag (€)"
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <Textarea
          label="Notiz (optional)"
          value={note}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          placeholder="z.B. PayPal Referenz: xyz"
        />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Abbrechen
          </Button>
          <Button type="submit" loading={loading} className="flex-1">
            Zahlung melden
          </Button>
        </div>
      </form>
    </Modal>
  );
}
