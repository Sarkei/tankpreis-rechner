import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, MapPin, Users, ChevronDown, ChevronUp, Crown } from "lucide-react";
import { api } from "../lib/api.ts";
import { useToast } from "../lib/ToastContext.tsx";
import type { GroupMemberOverview, GroupOverview } from "../types.ts";
import {
  Card, Badge, Avatar, SkeletonCard, EmptyState, formatEuro, formatDate
} from "../components/ui/index.tsx";
import { clsx } from "clsx";

function memberRoleLabel(m: GroupMemberOverview) {
  if (m.isGroupDriver) return { label: "Fahrer", variant: "info" as const };
  return { label: "Mitfahrer", variant: "default" as const };
}

function entryTypeLabel(entryType: string) {
  if (entryType === "TRIP") return "🚗 Fahrt";
  if (entryType === "PAYMENT") return "💳 Zahlung";
  if (entryType === "NETTING") return "↔ Verrechnung";
  return entryType;
}

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { error: showError } = useToast();
  const [data, setData] = useState<GroupOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedMemberId, setExpandedMemberId] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    api<GroupOverview>(`/api/groups/${id}/overview`)
      .then(setData)
      .catch(() => showError("Gruppenübersicht konnte nicht geladen werden"))
      .finally(() => setLoading(false));
  }, [id, showError]);

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={<Users className="w-12 h-12" />}
        title="Gruppe nicht gefunden"
        action={<Link to="/groups"><Badge>← Zurück</Badge></Link>}
      />
    );
  }

  const { group, summary, members } = data;
  const drivers = members.filter((m) => m.isGroupDriver);
  const membersWithCosts = members.filter(
    (m) =>
      !m.isGroupDriver ||
      m.tripsAsPassenger > 0 ||
      m.openDebt > 0.005 ||
      m.totalCharged > 0.005
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/groups" className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-zinc-100 truncate">{group.name}</h1>
          <p className="text-xs text-zinc-500">
            {group.costSplitMode === "WITH_DRIVER" ? "Fahrer zahlt mit" : "Fahrer kostenlos"} · {members.length} Mitglieder
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="text-center">
          <p className="text-2xl font-bold text-zinc-100">{summary.tripCount}</p>
          <p className="text-xs text-zinc-500">Fahrten</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-blue-400">{summary.totalKm.toFixed(0)}</p>
          <p className="text-xs text-zinc-500">km gesamt</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-orange-400">{formatEuro(summary.totalOpenDebt)}</p>
          <p className="text-xs text-zinc-500">offen</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-green-400">{formatEuro(summary.totalCharged)}</p>
          <p className="text-xs text-zinc-500">berechnet</p>
        </Card>
      </div>

      {/* Drivers */}
      {drivers.length > 0 && (
        <Card className="space-y-3">
          <p className="text-sm font-medium text-zinc-400 flex items-center gap-2">
            <Crown className="w-4 h-4 text-yellow-400" />
            {drivers.length === 1 ? "Fahrer" : `${drivers.length} Fahrer`}
          </p>
          <div className="space-y-2">
            {drivers.map((d) => (
              <div key={d.id} className="flex items-center gap-3 bg-zinc-800/30 rounded-lg px-3 py-2">
                <Avatar name={`${d.firstName} ${d.lastName}`} src={d.avatarUrl} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-zinc-200 truncate">
                    {d.firstName} {d.lastName}
                    {d.isOwner && <span className="text-xs text-zinc-500 ml-1">(Besitzer)</span>}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {d.tripsAsDriver} Fahrten eingetragen
                    {d.tripsAsPassenger > 0 && ` · ${d.tripsAsPassenger}× mitgefahren`}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {drivers.length > 1 && (
            <p className="text-xs text-zinc-500">
              Wenn Fahrer gegenseitig mitfahren, werden Schulden automatisch verrechnet – es bleibt nur der Nettosaldo.
            </p>
          )}
        </Card>
      )}

      {/* Cost breakdown */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-400 flex items-center gap-2">
          <Users className="w-4 h-4" /> Kostenübersicht
        </h2>

        {membersWithCosts.length === 0 ? (
          <Card>
            <p className="text-sm text-zinc-500 text-center py-4">
              Noch keine Mitfahrer in dieser Gruppe. Teile den Einladecode, damit andere beitreten können.
            </p>
          </Card>
        ) : (
          membersWithCosts.map((m) => (
            <MemberCostCard
              key={m.id}
              member={m}
              expanded={expandedMemberId === m.id}
              onToggle={() => setExpandedMemberId(expandedMemberId === m.id ? null : m.id)}
            />
          ))
        )}
      </div>

      <div className="flex gap-2">
        <Link to="/trips" className="flex-1">
          <Card className="text-center py-3 hover:border-zinc-600 cursor-pointer transition-colors">
            <MapPin className="w-5 h-5 text-blue-400 mx-auto mb-1" />
            <p className="text-sm text-zinc-300">Fahrten</p>
          </Card>
        </Link>
        <Link to="/payments" className="flex-1">
          <Card className="text-center py-3 hover:border-zinc-600 cursor-pointer transition-colors">
            <p className="text-lg font-bold text-orange-400">{formatEuro(summary.totalOpenDebt)}</p>
            <p className="text-sm text-zinc-300">Zahlungen</p>
          </Card>
        </Link>
      </div>
    </div>
  );
}

function MemberCostCard({
  member, expanded, onToggle
}: {
  member: GroupMemberOverview;
  expanded: boolean;
  onToggle: () => void;
}) {
  const role = memberRoleLabel(member);
  const tripLabel = member.tripsAsPassenger === 1 ? "1 Fahrt" : `${member.tripsAsPassenger} Fahrten`;

  return (
    <Card className="space-y-3">
      <button type="button" onClick={onToggle} className="w-full text-left">
        <div className="flex items-start gap-3">
          <Avatar name={`${member.firstName} ${member.lastName}`} src={member.avatarUrl} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-zinc-100">{member.firstName} {member.lastName}</p>
              <Badge variant={role.variant}>{role.label}</Badge>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              {tripLabel}
              {member.outboundRides > 0 && ` · ${member.outboundRides}× Hin`}
              {member.returnRides > 0 && ` · ${member.returnRides}× Rück`}
            </p>
          </div>
          <div className="text-right shrink-0">
            {member.openDebt > 0.005 ? (
              <>
                <p className="text-lg font-bold text-orange-400">{formatEuro(member.openDebt)}</p>
                <p className="text-xs text-zinc-500">offen</p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-green-400">✓</p>
                <p className="text-xs text-zinc-500">ausgeglichen</p>
              </>
            )}
            <div className="mt-1 text-zinc-500">
              {expanded ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
            </div>
          </div>
        </div>
      </button>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-zinc-800/50 rounded-lg p-2">
          <p className="text-sm font-medium text-zinc-200">{formatEuro(member.totalCharged)}</p>
          <p className="text-xs text-zinc-500">berechnet</p>
        </div>
        <div className="bg-zinc-800/50 rounded-lg p-2">
          <p className="text-sm font-medium text-green-400">{formatEuro(member.paidAmount)}</p>
          <p className="text-xs text-zinc-500">bezahlt</p>
        </div>
        <div className="bg-zinc-800/50 rounded-lg p-2">
          <p className={clsx("text-sm font-medium", member.openDebt > 0.005 ? "text-orange-400" : "text-green-400")}>
            {formatEuro(member.openDebt)}
          </p>
          <p className="text-xs text-zinc-500">offen</p>
        </div>
      </div>

      {expanded && (
        <div className="pt-3 border-t border-zinc-800 space-y-2">
          <p className="text-xs font-medium text-zinc-500">Einzelbuchungen – warum dieser Betrag?</p>
          {member.entries.length === 0 ? (
            <p className="text-xs text-zinc-500">Noch keine Buchungen</p>
          ) : (
            member.entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm bg-zinc-800/30 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-zinc-300 truncate">
                    {entryTypeLabel(e.entryType)}
                    {e.tripDate && ` · ${formatDate(e.tripDate)}`}
                  </p>
                  {e.description && <p className="text-xs text-zinc-500 truncate">{e.description}</p>}
                  <p className="text-xs text-zinc-600">{formatDate(e.createdAt)}</p>
                </div>
                <p className={clsx(
                  "font-medium shrink-0 ml-2",
                  e.entryType === "PAYMENT" || e.entryType === "NETTING"
                    ? "text-green-400"
                    : "text-orange-400"
                )}>
                  {e.entryType === "PAYMENT" || e.entryType === "NETTING" ? "−" : "+"}
                  {formatEuro(Math.abs(e.amount))}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  );
}
