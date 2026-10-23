import React, { useEffect, useState } from "react";
import { CreditCard, Check, X, Plus, Download } from "lucide-react";
import { api } from "../lib/api.ts";
import { useToast } from "../lib/ToastContext.tsx";
import { useAuth } from "../lib/AuthContext.tsx";
import type { Debt, Payment, CarpoolGroup } from "../types.ts";
import {
  Card, Button, Modal, Input, Select, Textarea, Badge, EmptyState, SkeletonCard,
  Avatar, formatEuro, formatDate
} from "../components/ui/index.tsx";
import { clsx } from "clsx";
import DebtPayCard from "../components/DebtPayCard.tsx";

const STATUS_CONFIG = {
  OFFEN: { label: "Offen", variant: "warning" as const },
  GEMELDET: { label: "Gemeldet", variant: "info" as const },
  BESTAETIGT: { label: "Bestätigt", variant: "success" as const },
};

export default function PaymentsPage() {
  const { isDriver } = useAuth();
  const { success, error: showError } = useToast();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [groups, setGroups] = useState<CarpoolGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRecordModal, setShowRecordModal] = useState<number | null>(null); // group id

  useEffect(() => {
    Promise.all([
      api<Debt[]>("/api/debts"),
      api<CarpoolGroup[]>("/api/groups"),
    ]).then(([d, g]) => {
      setDebts(d);
      const active = g.filter((x) => !x.isArchived);
      setGroups(active);
      if (active.length > 0) setSelectedGroupId(active[0].id);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedGroupId) return;
    api<Payment[]>(`/api/groups/${selectedGroupId}/payments`)
      .then(setPayments)
      .catch(console.error);
  }, [selectedGroupId]);

  async function confirmPayment(paymentId: number) {
    try {
      await api(`/api/payments/${paymentId}/confirm`, { method: "POST" });
      setPayments((prev) => prev.map((p) => p.id === paymentId ? { ...p, status: "BESTAETIGT" } : p));
      success("Zahlung bestätigt");
      refreshDebts();
    } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
  }

  async function rejectPayment(paymentId: number) {
    try {
      await api(`/api/payments/${paymentId}/reject`, { method: "POST" });
      setPayments((prev) => prev.map((p) => p.id === paymentId ? { ...p, status: "OFFEN", reportedAt: null } : p));
      success("Zahlung abgelehnt");
      refreshDebts();
    } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
  }

  async function refreshDebts() {
    const d = await api<Debt[]>("/api/debts");
    setDebts(d);
  }

  async function downloadCsv(groupId: number) {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/groups/${groupId}/export/csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) { showError("CSV-Export fehlgeschlagen"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fahrten-gruppe-${groupId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { showError("CSV-Export fehlgeschlagen"); }
  }

  const myDebts = debts.filter((d) => d.isMyDebt);
  const myCredits = debts.filter((d) => !d.isMyDebt);
  const pendingPayments = payments.filter((p) => p.status === "GEMELDET");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-100">Schulden & Zahlungen</h1>
        {isDriver && selectedGroupId && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={<Download className="w-3.5 h-3.5" />}
              onClick={() => downloadCsv(selectedGroupId!)}>CSV</Button>
            <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowRecordModal(selectedGroupId!)}>Zahlung erfassen</Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-3"><SkeletonCard /><SkeletonCard /></div>
      ) : (
        <>
          {/* My debts (as passenger) */}
          {myDebts.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-zinc-400 mb-3">Meine Schulden</h2>
              <div className="space-y-3">
                {myDebts.map((d) => (
                  <DebtPayCard key={d.id} debt={d} onUpdated={refreshDebts} />
                ))}
              </div>
            </div>
          )}

          {/* Credits (as driver) */}
          {myCredits.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-zinc-400 mb-3">Ausstehende Forderungen</h2>
              <div className="space-y-2">
                {myCredits.map((d) => (
                  <Card key={d.id} className="flex items-center gap-3">
                    <Avatar name={`${d.debtor.firstName} ${d.debtor.lastName}`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-zinc-200">{d.debtor.firstName} {d.debtor.lastName}</p>
                      <p className="text-xs text-zinc-500">{d.groupName}</p>
                    </div>
                    <p className="text-lg font-bold text-green-400">{formatEuro(d.openAmount)}</p>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Pending confirmations for driver */}
          {isDriver && pendingPayments.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-yellow-400 mb-3">
                ⚠️ Zahlungen bestätigen ({pendingPayments.length})
              </h2>
              <div className="space-y-2">
                {pendingPayments.map((p) => (
                  <Card key={p.id} className="border-yellow-800/50 bg-yellow-900/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-zinc-200">
                          {p.payer.firstName} {p.payer.lastName}
                        </p>
                        {p.note && <p className="text-xs text-zinc-500">Notiz: {p.note}</p>}
                        {p.reportedAt && <p className="text-xs text-zinc-500">{formatDate(p.reportedAt)}</p>}
                      </div>
                      <p className="text-xl font-bold text-yellow-400">{formatEuro(p.amount)}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="success" className="flex-1" icon={<Check className="w-4 h-4" />}
                        onClick={() => confirmPayment(p.id)}>Bestätigen</Button>
                      <Button size="sm" variant="danger" className="flex-1" icon={<X className="w-4 h-4" />}
                        onClick={() => rejectPayment(p.id)}>Ablehnen</Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Group selector + Payment history */}
          {groups.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-zinc-400">Zahlungshistorie</h2>
                {groups.length > 1 && (
                  <div className="flex gap-1 overflow-x-auto">
                    {groups.map((g) => (
                      <button key={g.id} onClick={() => setSelectedGroupId(g.id)}
                        className={clsx("px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors",
                          selectedGroupId === g.id ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400")}>
                        {g.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {payments.length === 0 ? (
                  <p className="text-zinc-500 text-sm text-center py-4">Keine Zahlungen</p>
                ) : (
                  payments.map((p) => (
                    <Card key={p.id} className="flex items-center gap-3">
                      <Avatar name={`${p.payer.firstName} ${p.payer.lastName}`} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-200">
                          {p.payer.firstName} → {p.receiver.firstName}
                        </p>
                        <p className="text-xs text-zinc-500">{formatDate(p.createdAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-zinc-200">{formatEuro(p.amount)}</p>
                        <Badge variant={STATUS_CONFIG[p.status].variant}>{STATUS_CONFIG[p.status].label}</Badge>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </div>
          )}

          {myDebts.length === 0 && myCredits.length === 0 && (
            <EmptyState
              icon={<CreditCard className="w-12 h-12" />}
              title="Keine offenen Schulden"
              description="Alles beglichen!"
            />
          )}
        </>
      )}

      {showRecordModal && (
        <RecordPaymentModal
          groupId={showRecordModal}
          debtors={myCredits.filter((d) => d.groupId === showRecordModal)}
          onClose={() => setShowRecordModal(null)}
          onRecorded={() => {
            setShowRecordModal(null);
            success("Zahlung erfasst!");
            refreshDebts();
            api<Payment[]>(`/api/groups/${selectedGroupId}/payments`).then(setPayments);
          }}
        />
      )}
    </div>
  );
}

function RecordPaymentModal({ groupId, debtors, onClose, onRecorded }: {
  groupId: number; debtors: Debt[]; onClose: () => void; onRecorded: () => void;
}) {
  const { error: showError } = useToast();
  const [payerId, setPayerId] = useState(debtors[0]?.debtor.id ? String(debtors[0].debtor.id) : "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const d = debtors.find((x) => x.debtor.id === parseInt(payerId));
    if (d) setAmount(d.openAmount.toFixed(2));
  }, [payerId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!payerId || !amount) { showError("Zahler und Betrag erforderlich"); return; }
    setLoading(true);
    try {
      await api(`/api/groups/${groupId}/payments/record`, {
        method: "POST",
        body: JSON.stringify({ payerId: parseInt(payerId), amount: parseFloat(amount), note: note || undefined }),
      });
      onRecorded();
    } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
    finally { setLoading(false); }
  }

  return (
    <Modal isOpen onClose={onClose} title="Zahlung erfassen (Fahrer)">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select label="Mitfahrer" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
          {debtors.map((d) => (
            <option key={d.debtor.id} value={d.debtor.id}>
              {d.debtor.firstName} {d.debtor.lastName} (schuldet {formatEuro(d.openAmount)})
            </option>
          ))}
        </Select>
        <Input label="Betrag (€)" type="number" step="0.01" value={amount}
          onChange={(e) => setAmount(e.target.value)} required />
        <Textarea label="Notiz (optional)" value={note} rows={2}
          onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Abbrechen</Button>
          <Button type="submit" loading={loading} className="flex-1">Zahlung bestätigen</Button>
        </div>
      </form>
    </Modal>
  );
}
