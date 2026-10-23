import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Plus, MapPin, CreditCard, Users, Car, ChevronRight, AlertCircle, Wallet
} from "lucide-react";
import { useAuth } from "../lib/AuthContext.tsx";
import { api } from "../lib/api.ts";
import { Card, Button, Avatar, SkeletonCard, formatEuro } from "../components/ui/index.tsx";
import DebtPayCard from "../components/DebtPayCard.tsx";
import TripCalendar from "../components/TripCalendar.tsx";
import type { Debt } from "../types.ts";
import { clsx } from "clsx";

export default function DashboardPage() {
  const { user, isDriver } = useAuth();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadDebts = useCallback(async () => {
    const [d, p] = await Promise.all([
      api<Debt[]>("/api/debts").catch(() => [] as Debt[]),
      api<{ count: number }>("/api/payments/pending-count").catch(() => ({ count: 0 })),
    ]);
    setDebts(d);
    setPendingCount(p.count);
  }, []);

  useEffect(() => {
    loadDebts().finally(() => setLoading(false));
  }, [loadDebts]);

  const myDebts = debts.filter((d) => d.isMyDebt);
  const myCredits = debts.filter((d) => !d.isMyDebt);
  const totalOwed = myDebts.reduce((s, d) => s + d.openAmount, 0);
  const totalReceivable = myCredits.reduce((s, d) => s + d.openAmount, 0);

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-2">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-zinc-100">
          Hallo, {user?.firstName} 👋
        </h1>
        <p className="text-sm text-zinc-500">Deine Übersicht auf einen Blick</p>
      </div>

      {/* Balance cards – Fahrer: immer beide nebeneinander */}
      <div className={clsx(
        "grid gap-3",
        isDriver ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
      )}>
        {(isDriver || myDebts.length > 0 || totalOwed > 0.005) && (
          <BalanceCard
            label="Ich schulde"
            amount={totalOwed}
            sublabel={
              myDebts.length === 0
                ? "Alles ausgeglichen"
                : `${myDebts.length} offene${myDebts.length === 1 ? "r Posten" : " Posten"}`
            }
            variant="owe"
            icon={Wallet}
          />
        )}

        {isDriver && (
          <BalanceCard
            label="Mir schuldet man"
            amount={totalReceivable}
            sublabel={
              myCredits.length === 0
                ? "Keine offenen Forderungen"
                : `${myCredits.length} offene${myCredits.length === 1 ? "r Posten" : " Posten"}`
            }
            variant="receive"
            icon={CreditCard}
          />
        )}
      </div>

      {isDriver && pendingCount > 0 && (
        <Link to="/payments">
          <Card className="flex items-center gap-3 p-4 border-yellow-800/50 bg-yellow-900/15 active:scale-[0.99] transition-transform">
            <AlertCircle className="w-6 h-6 text-yellow-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-yellow-200">
                {pendingCount} Zahlung{pendingCount > 1 ? "en" : ""} bestätigen
              </p>
              <p className="text-xs text-yellow-600/80">Tippe um zur Übersicht zu gehen</p>
            </div>
            <ChevronRight className="w-5 h-5 text-yellow-600 shrink-0" />
          </Card>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {isDriver && (
          <>
            <QuickAction to="/trips" icon={Plus} label="Fahrt" accent="blue" />
            <QuickAction to="/vehicles" icon={Car} label="Fahrzeuge" />
          </>
        )}
        <QuickAction to="/groups" icon={Users} label="Gruppen" />
        <QuickAction
          to="/payments"
          icon={CreditCard}
          label="Zahlungen"
          accent={totalOwed > 0 ? "orange" : undefined}
        />
      </div>

      {/* Schulden begleichen – pro Fahrer/Gläubiger */}
      {myDebts.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-200">
              Schulden begleichen
            </h2>
            <Link to="/payments" className="text-xs text-blue-400">
              Details →
            </Link>
          </div>
          <p className="text-xs text-zinc-500">
            IBAN kopieren, überweisen, dann „Begleichen“ tippen – pro Person einzeln.
          </p>
          <div className="space-y-3">
            {myDebts.map((d) => (
              <DebtPayCard key={d.id} debt={d} onUpdated={loadDebts} />
            ))}
          </div>
        </section>
      )}

      {isDriver && myCredits.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-zinc-200">Offene Forderungen</h2>
          <div className="space-y-2">
            {myCredits.map((d) => (
              <Card key={d.id} className="flex items-center gap-3 p-4">
                <Avatar
                  name={`${d.debtor.firstName} ${d.debtor.lastName}`}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-zinc-200 truncate">
                    {d.debtor.firstName} {d.debtor.lastName}
                  </p>
                  <p className="text-xs text-zinc-500">{d.groupName}</p>
                </div>
                <p className="font-bold text-green-400 shrink-0">
                  {formatEuro(d.openAmount)}
                </p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {!isDriver && myDebts.length === 0 && (
        <Card className="text-center py-10 px-4">
          <MapPin className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-300 font-medium">Keine offenen Schulden</p>
          <p className="text-sm text-zinc-500 mt-1 mb-4">
            Tritt einer Fahrgemeinschaft bei.
          </p>
          <Link to="/groups">
            <Button>Gruppe beitreten</Button>
          </Link>
        </Card>
      )}

      <TripCalendar />
    </div>
  );
}

function BalanceCard({
  label,
  amount,
  sublabel,
  variant,
  icon: Icon,
}: {
  label: string;
  amount: number;
  sublabel: string;
  variant: "owe" | "receive";
  icon: React.ComponentType<{ className?: string }>;
}) {
  const isOwe = variant === "owe";
  const hasDebt = amount > 0.005;

  return (
    <Card
      className={clsx(
        "p-5",
        isOwe
          ? "border-orange-800/40 bg-orange-950/20"
          : hasDebt
            ? "border-green-800/40 bg-green-950/20"
            : ""
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
            {label}
          </p>
          <p
            className={clsx(
              "text-3xl font-bold mt-1",
              isOwe ? "text-orange-400" : "text-green-400"
            )}
          >
            {formatEuro(amount)}
          </p>
          <p className="text-xs text-zinc-500 mt-1">{sublabel}</p>
        </div>
        <div
          className={clsx(
            "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
            isOwe ? "bg-orange-600/20" : "bg-green-600/20"
          )}
        >
          <Icon
            className={clsx(
              "w-6 h-6",
              isOwe ? "text-orange-400" : "text-green-400"
            )}
          />
        </div>
      </div>
    </Card>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
  accent,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  accent?: "blue" | "orange";
}) {
  const colors = {
    blue: "bg-blue-600/15 text-blue-400 border-blue-800/40",
    orange: "bg-orange-600/15 text-orange-400 border-orange-800/40",
    default: "bg-zinc-800/80 text-zinc-300 border-zinc-700",
  };
  const style = accent ? colors[accent] : colors.default;

  return (
    <Link to={to}>
      <div
        className={clsx(
          "flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border min-h-[5.5rem]",
          "active:scale-[0.97] transition-transform",
          style
        )}
      >
        <Icon className="w-6 h-6" />
        <span className="text-xs font-medium">{label}</span>
      </div>
    </Link>
  );
}
