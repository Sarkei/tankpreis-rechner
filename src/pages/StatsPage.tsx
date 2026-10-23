import React, { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/AuthContext.tsx";
import type { CarpoolGroup } from "../types.ts";
import { Card, SkeletonCard, EmptyState, formatEuro } from "../components/ui/index.tsx";
import { clsx } from "clsx";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from "recharts";

interface Stats {
  totalKm: number;
  tripCount: number;
  avgKmPerTrip: number;
  totalIncome: number;
  uniquePassengers: number;
  monthlyBreakdown: { month: string; trips: number; km: number; income: number }[];
  weekdayHeatmap: { dayOfWeek: number; tripCount: number }[];
  fuelPriceHistory: { date: string; price: number }[];
}

const DOW_LABELS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const TREND_MONTHS = 24;

type MonthlyEntry = { month: string; trips: number; km: number; income: number };

function fillMonthlyTrend(data: MonthlyEntry[], monthCount = TREND_MONTHS): MonthlyEntry[] {
  const byMonth = new Map(data.map((d) => [d.month, d]));
  const result: MonthlyEntry[] = [];
  const now = new Date();

  for (let i = monthCount - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    result.push(
      byMonth.get(key) ?? { month: key, trips: 0, km: 0, income: 0 }
    );
  }
  return result;
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const d = new Date(parseInt(year), parseInt(month) - 1, 1);
  return d.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
}

function StatsDashboard({ stats, isDriver }: { stats: Stats; isDriver: boolean }) {
  const monthlyTrend = fillMonthlyTrend(stats.monthlyBreakdown);
  const hasKmTrend = monthlyTrend.some((m) => m.km > 0);
  const maxIncome = Math.max(0, ...monthlyTrend.map((x) => x.income));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="text-center">
          <p className="text-2xl font-bold text-blue-400">{stats.totalKm.toFixed(0)}</p>
          <p className="text-xs text-zinc-500 mt-1">km gesamt</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-zinc-200">{stats.tripCount}</p>
          <p className="text-xs text-zinc-500 mt-1">Fahrten</p>
        </Card>
        {isDriver && (
          <Card className="text-center">
            <p className="text-2xl font-bold text-green-400">{formatEuro(stats.totalIncome)}</p>
            <p className="text-xs text-zinc-500 mt-1">Einnahmen</p>
          </Card>
        )}
        <Card className="text-center">
          <p className="text-2xl font-bold text-zinc-200">{stats.avgKmPerTrip.toFixed(0)}</p>
          <p className="text-xs text-zinc-500 mt-1">Ø km/Fahrt</p>
        </Card>
      </div>

      {hasKmTrend && (
        <Card>
          <p className="text-sm font-medium text-zinc-300 mb-1">📅 Kilometer-Trend</p>
          <p className="text-xs text-zinc-500 mb-4">
            Letzte {TREND_MONTHS} Monate – erkenne, wann du besonders viel fährst
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyTrend} margin={{ bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
              <XAxis
                dataKey="month"
                tick={{ fill: "#71717a", fontSize: 10 }}
                tickFormatter={formatMonthLabel}
                interval={1}
                angle={-45}
                textAnchor="end"
                height={56}
                minTickGap={2}
              />
              <YAxis tick={{ fill: "#71717a", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
                labelStyle={{ color: "#e4e4e7" }}
                itemStyle={{ color: "#60a5fa" }}
                labelFormatter={(label) => formatMonthLabel(String(label))}
                formatter={(v, _name, item) => {
                  const trips = (item?.payload as MonthlyEntry)?.trips ?? 0;
                  return [`${Number(v).toFixed(0)} km (${trips} Fahrten)`, "Kilometer"];
                }}
              />
              <Bar dataKey="km" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {stats.fuelPriceHistory.length > 1 && (
        <Card>
          <p className="text-sm font-medium text-zinc-300 mb-4">⛽ Kraftstoffpreis-Verlauf</p>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={stats.fuelPriceHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#71717a", fontSize: 10 }}
                tickFormatter={(v) =>
                  new Date(v).toLocaleDateString("de-DE", { month: "2-digit", day: "2-digit" })
                }
              />
              <YAxis
                tick={{ fill: "#71717a", fontSize: 11 }}
                domain={["auto", "auto"]}
                tickFormatter={(v) => `${v.toFixed(2)}`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
                formatter={(v) => [`${Number(v).toFixed(3)} €/L`, "Kraftstoffpreis"]}
              />
              <Line type="monotone" dataKey="price" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {stats.weekdayHeatmap.length > 0 && (
        <Card>
          <p className="text-sm font-medium text-zinc-300 mb-4">📅 Wochentag-Heatmap</p>
          <div className="flex items-end gap-2">
            {DOW_LABELS.map((label, i) => {
              const entry = stats.weekdayHeatmap.find((e) => e.dayOfWeek === i);
              const count = entry?.tripCount ?? 0;
              const max = Math.max(...stats.weekdayHeatmap.map((e) => e.tripCount));
              const height = max > 0 ? Math.max(8, (count / max) * 60) : 8;
              return (
                <div key={i} className="flex flex-col items-center gap-1 flex-1">
                  <div
                    className="w-full rounded-t-md bg-blue-600/60 transition-all"
                    style={{ height: `${height}px` }}
                    title={`${count} Fahrten`}
                  />
                  <span className="text-xs text-zinc-500">{label}</span>
                  <span className="text-xs text-zinc-600">{count}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {isDriver && monthlyTrend.some((m) => m.income > 0) && (
        <Card>
          <p className="text-sm font-medium text-zinc-300 mb-4">💰 Monatliche Einnahmen</p>
          <div className="space-y-2">
            {[...monthlyTrend].reverse().filter((m) => m.income > 0).slice(0, 12).map((m) => (
              <div key={m.month} className="flex items-center gap-3">
                <span className="text-xs text-zinc-500 w-20 shrink-0">
                  {formatMonthLabel(m.month)}
                </span>
                <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-green-600 rounded-full"
                    style={{
                      width: `${Math.min(100, (m.income / (maxIncome || 1)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-zinc-300 w-16 text-right">{formatEuro(m.income)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

export default function StatsPage() {
  const { isDriver } = useAuth();
  const [groups, setGroups] = useState<CarpoolGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<CarpoolGroup[]>("/api/groups")
      .then((data) => {
        const active = data.filter((g) => !g.isArchived);
        setGroups(active);
        if (active.length > 0) setSelectedGroupId(active[0].id);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedGroupId) return;
    setLoading(true);
    api<Stats>(`/api/groups/${selectedGroupId}/stats`)
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedGroupId]);

  if (groups.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold text-zinc-100">Statistiken</h1>
        <EmptyState
          icon={<BarChart3 className="w-12 h-12" />}
          title="Keine Gruppen"
          description="Tritt einer Fahrgemeinschaft bei, um Statistiken zu sehen."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-zinc-100">Statistiken</h1>

      {groups.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setSelectedGroupId(g.id)}
              className={clsx(
                "px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors shrink-0",
                selectedGroupId === g.id
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              )}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-3"><SkeletonCard /><SkeletonCard /></div>
      ) : !stats ? null : stats.tripCount === 0 ? (
        <EmptyState
          icon={<BarChart3 className="w-12 h-12" />}
          title="Noch keine Daten"
          description="Trage Fahrten ein, um Statistiken zu sehen."
        />
      ) : (
        <StatsDashboard stats={stats} isDriver={isDriver} />
      )}
    </div>
  );
}
