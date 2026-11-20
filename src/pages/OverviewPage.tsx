import { useState } from "react";
import { ArrowRight, ArrowUpRight, Cog, HandCoins, Plus, Route, Users } from "lucide-react";
import type { FuelPriceState, Matrix, Person, Trip } from "../lib/calc.ts";
import { ageLabel, dayLabel, eur, kmLabel, pricePerLiter } from "../lib/format.ts";
import { Band, PageHead, StatRow } from "../components/AppShell.tsx";
import { DetailSheet, StatButton, type DetailDef } from "../components/DetailSheet.tsx";
import { Button } from "../components/ui.tsx";

/** Startseite als Übersicht: Kennzahlen aus echten Daten, Kartenraster der Bereiche. */
export function OverviewPage({
  persons,
  trips,
  matrix,
  fuelPrice,
  onNavigate,
  onNewTrip,
  onOpenSettings,
}: {
  persons: Person[];
  trips: Trip[];
  matrix: Matrix;
  fuelPrice: FuelPriceState;
  onNavigate: (id: string) => void;
  onNewTrip: () => void;
  onOpenSettings: () => void;
}) {
  const [detail, setDetail] = useState<DetailDef | null>(null);
  const passengerIds = new Set<number>();
  let totalKm = 0;
  for (const trip of trips) {
    totalKm += trip.km;
    for (const passenger of trip.passengers) passengerIds.add(passenger.id);
  }

  const recent = [...trips]
    .sort((a, b) => (a.date === b.date ? b.id - a.id : b.date.localeCompare(a.date)))
    .slice(0, 3);

  const priceNote = fuelPrice.price
    ? `${fuelPrice.fuelLabel} · ${pricePerLiter(fuelPrice.price)}/l${
        fuelPrice.source === "manual"
          ? " · manuell"
          : fuelPrice.stale
            ? " · veraltet"
            : ageLabel(fuelPrice.fetchedAt)
              ? ` · ${ageLabel(fuelPrice.fetchedAt)}`
              : ""
      }`
    : "Noch kein Tankpreis hinterlegt";

  const cards = [
    {
      id: "fahrten",
      icon: <Route className="h-5 w-5" />,
      title: "Fahrten",
      text: "Jede Fahrt mit Datum, Strecke, Insassen und Kostenanteil je Person.",
      action: () => onNavigate("fahrten"),
    },
    {
      id: "abrechnung",
      icon: <HandCoins className="h-5 w-5" />,
      title: "Abrechnung",
      text: "Wer wem was schuldet – als Matrix, mit Häkchen für bezahlte Beträge.",
      action: () => onNavigate("abrechnung"),
    },
    {
      id: "neu",
      icon: <Plus className="h-5 w-5" />,
      title: "Fahrt eintragen",
      text: "Neue Fahrt in wenigen Feldern erfassen – Route und Tankpreis inklusive.",
      action: onNewTrip,
    },
    {
      id: "einstellungen",
      icon: <Cog className="h-5 w-5" />,
      title: "Einstellungen",
      text: "Tankpreis, Verbrauch, Postleitzahl und Zuhause-Adresse pflegen.",
      action: onOpenSettings,
    },
  ];

  return (
    <>
      <PageHead
        label="Fahrgemeinschaft · Übersicht"
        title="Fahrten erfassen, Kosten gerecht teilen."
        intro="Kilometer, Verbrauch und aktueller Tankpreis ergeben den Anteil pro Person – die Übersicht zeigt, was zuletzt gefahren wurde und welche Beträge noch offen sind."
      >
        <dl className="stat-row">
          <StatButton
            value={eur(matrix.total)}
            label="Offene Beträge"
            onClick={() =>
              setDetail({
                titel: "Offene Beträge",
                einheit: "€",
                hinweis: "Wer wem noch etwas schuldet, größte Beträge zuerst.",
                hoeherBesser: false,
                laden: async () =>
                  matrix.drivers
                    .flatMap((d) =>
                      matrix.passengers.map((p) => ({
                        label: `${p.name} → ${d.name}`,
                        wert: Number(matrix.cells[`${d.id}:${p.id}`] ?? 0),
                      })),
                    )
                    .filter((x) => x.wert > 0)
                    .sort((a, b) => b.wert - a.wert),
              })
            }
          />
          <StatButton
            value={String(trips.length)}
            label="Fahrten"
            onClick={() =>
              setDetail({
                titel: "Fahrten",
                hinweis: "Kilometer pro Fahrt, neueste zuerst.",
                hoeherBesser: true,
                laden: async () =>
                  [...trips]
                    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
                    .map((t) => ({
                      label: `${t.date} · ${t.fromLabel ?? "?"} → ${t.toLabel ?? "?"}`,
                      wert: t.km,
                    })),
              })
            }
          />
          <StatButton
            value={String(passengerIds.size)}
            label="Mitfahrer"
            onClick={() =>
              setDetail({
                titel: "Mitfahrer",
                hinweis: "Wie oft jede Person mitgefahren ist.",
                hoeherBesser: true,
                laden: async () => {
                  const zaehler = new Map<string, number>();
                  for (const t of trips) {
                    for (const p of t.passengers) {
                      zaehler.set(p.name, (zaehler.get(p.name) ?? 0) + 1);
                    }
                  }
                  return [...zaehler.entries()]
                    .map(([name, n]) => ({ label: name, wert: n }))
                    .sort((a, b) => b.wert - a.wert);
                },
              })
            }
          />
          <StatButton
            value={kmLabel(totalKm)}
            label="Gefahren insgesamt"
            onClick={() =>
              setDetail({
                titel: "Gefahrene Kilometer",
                einheit: "km",
                hinweis: "Kilometer pro Monat.",
                hoeherBesser: true,
                laden: async () => {
                  const proMonat = new Map<string, number>();
                  for (const t of trips) {
                    const m = String(t.date).slice(0, 7);
                    proMonat.set(m, (proMonat.get(m) ?? 0) + t.km);
                  }
                  return [...proMonat.entries()]
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([m, km]) => ({ label: m, wert: Math.round(km * 10) / 10 }));
                },
              })
            }
          />
        </dl>
      </PageHead>

      <section className="app-section app-container">
        <div className="app-section__head">
          <h2 className="app-section__title">Bereiche</h2>
          <p className="app-section__note">
            {persons.length} {persons.length === 1 ? "Person" : "Personen"} in der Gruppe
          </p>
        </div>

        <div className="app-grid">
          {cards.map((card) => (
            <button key={card.id} className="app-card app-card--link" onClick={card.action}>
              <span className="app-card__head">
                {card.icon}
                <ArrowUpRight className="h-4 w-4" />
              </span>
              <span className="app-card__title block">{card.title}</span>
              <span className="app-card__text block">{card.text}</span>
            </button>
          ))}
        </div>
      </section>

      <Band title="Zuletzt erfasst" note={priceNote}>
        {recent.length === 0 ? (
          <div className="app-card" style={{ marginTop: 32 }}>
            <p className="app-card__text">Noch keine Fahrt eingetragen.</p>
            <Button className="mt-4 rounded-full px-5 py-3" onClick={onNewTrip}>
              <Plus className="h-4 w-4" />
              Erste Fahrt eintragen
            </Button>
          </div>
        ) : (
          <div className="app-card" style={{ marginTop: 32, padding: 0 }}>
            <ul>
              {recent.map((trip, index) => (
                <li
                  key={trip.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 py-4"
                  style={{ borderTop: index === 0 ? "none" : "1px solid var(--line)" }}
                >
                  <span className="text-sm text-ink">
                    <span className="app-label mr-3">{dayLabel(trip.date)}</span>
                    {trip.direction === "HIN" ? "Hinfahrt" : "Rückfahrt"} mit {trip.driverName}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {trip.passengers.length > 0 ? trip.passengers.length : "allein"}
                    </span>
                    <span>{kmLabel(trip.km)}</span>
                    <span className="text-ink">je {eur(trip.share)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: "1px solid var(--line)" }}>
              <span className="app-label">Alle Fahrten</span>
              <button className="app-nav-item" onClick={() => onNavigate("fahrten")}>
                ansehen <ArrowRight className="inline h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </Band>

      {detail && <DetailSheet def={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
