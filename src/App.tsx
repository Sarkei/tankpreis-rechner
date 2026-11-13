import { AlertTriangle, Car, Cog, HandCoins, LogOut, Plus, Route, ShieldCheck, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AppSettings, AppState, HomePlace, Person, Trip } from "./lib/calc.ts";
import { ApiError, api, type TripPayload } from "./lib/api.ts";
import { ageLabel, eur, pricePerLiter } from "./lib/format.ts";
import { TripDialog } from "./components/TripDialog.tsx";
import { TripList } from "./components/TripList.tsx";
import { DebtMatrix } from "./components/DebtMatrix.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { ConfirmDialog, type ConfirmState } from "./components/ConfirmDialog.tsx";
import { FilterMenu } from "./components/FilterMenu.tsx";
import { AuthScreen } from "./pages/AuthScreen.tsx";
import { AdminDialog } from "./pages/AdminDialog.tsx";
import { Button } from "./components/ui.tsx";

type Tab = "fahrten" | "zahlungen";

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [guestPersons, setGuestPersons] = useState<Person[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("fahrten");
  const [driverFilter, setDriverFilter] = useState<number | null>(null);
  const [passengerFilter, setPassengerFilter] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [tripOpen, setTripOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2800);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.state();
      setState(data);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setState(null);
        try {
          const { persons } = await api.publicPersons();
          setGuestPersons(persons);
        } catch {
          setGuestPersons([]);
        }
      } else {
        setLoadError(err instanceof Error ? err.message : "Daten konnten nicht geladen werden");
      }
    } finally {
      setAuthReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function guard<T>(action: () => Promise<T>, success?: string): Promise<T | undefined> {
    setBusy(true);
    try {
      const result = await action();
      if (success) notify(success);
      return result;
    } catch (err) {
      notify(err instanceof Error ? err.message : "Etwas ist schiefgelaufen");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Lädt…</p>
      </div>
    );
  }

  if (loadError && !state) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-warn" />
        <p className="text-sm text-muted">{loadError}</p>
        <button onClick={() => void load()} className="rounded-xl bg-accent px-4 py-2 text-sm text-on-accent">
          Erneut laden
        </button>
      </div>
    );
  }

  if (!state) {
    return <AuthScreen persons={guestPersons} onAuthenticated={(next) => setState(next)} />;
  }

  const { persons, trips, matrix, settings, fuelPrice, me } = state;
  const mePersonId = me?.personId ?? null;

  const driverOptions = persons.filter((person) => trips.some((trip) => trip.driverId === person.id));
  const passengerOptions = persons.filter((person) =>
    trips.some((trip) => trip.passengers.some((passenger) => passenger.id === person.id))
  );

  const visibleTrips = trips.filter((trip) => {
    if (driverFilter !== null && trip.driverId !== driverFilter) return false;
    if (passengerFilter !== null && !trip.passengers.some((p) => p.id === passengerFilter)) return false;
    return true;
  });

  async function addTrip(payload: TripPayload): Promise<boolean> {
    const result = await guard(() => api.addTrip(payload));
    if (!result) return false;
    setState(result.state);
    notify("Fahrt gespeichert");
    return true;
  }

  function requestDeleteTrip(trip: Trip) {
    setConfirm({
      title: "Fahrt löschen?",
      message: `${trip.direction === "HIN" ? "Hinfahrt" : "Rückfahrt"} vom ${trip.date} mit ${trip.driverName} (${trip.km} km) wird gelöscht – die Beträge verschwinden aus der Abrechnung.`,
      confirmLabel: "Löschen",
      danger: true,
      onConfirm: async () => {
        setConfirmBusy(true);
        const result = await guard(() => api.deleteTrip(trip.id));
        if (result) {
          setState(result.state);
          notify("Fahrt gelöscht");
        }
        setConfirmBusy(false);
        setConfirm(null);
      },
    });
  }

  function requestSettle(debtorId: number, creditorId: number | null) {
    const debtor = persons.find((person) => person.id === debtorId);
    if (!debtor) return;
    const creditor = creditorId ? persons.find((person) => person.id === creditorId) : null;

    const amount = creditor
      ? (matrix.cells[`${creditor.id}:${debtor.id}`] ?? 0)
      : (matrix.colTotals[String(debtor.id)] ?? 0);
    if (amount <= 0) return;

    setConfirm({
      title: "Schulden begleichen",
      message: creditor
        ? `${debtor.name} hat ${eur(amount)} an ${creditor.name} bezahlt. Wirklich als bezahlt markieren?`
        : `${debtor.name} begleicht alle offenen Beträge (${eur(amount)}). Wirklich als bezahlt markieren?`,
      confirmLabel: "Ja, bezahlt",
      onConfirm: async () => {
        setConfirmBusy(true);
        const result = await guard(() => api.settle(debtorId, creditorId ?? undefined));
        if (result) {
          setState(result.state);
          notify(`${debtor.name}: ${eur(result.total)} beglichen`);
        }
        setConfirmBusy(false);
        setConfirm(null);
      },
    });
  }

  async function saveSettings(patch: Partial<AppSettings>) {
    const result = await guard(() => api.saveSettings(patch));
    if (result) {
      setState(result.state);
      setSettingsOpen(false);
      notify("Einstellungen gespeichert");
    }
  }

  async function saveHome(home: HomePlace | null) {
    const result = await guard(() => api.saveHome(home));
    if (result) {
      setState(result.state);
      notify(home ? "Zuhause-Adresse gespeichert" : "Zuhause-Adresse entfernt");
    }
  }

  async function refreshPrice() {
    const price = await guard(() => api.refreshPrice());
    if (price) {
      setState((current) => (current ? { ...current, fuelPrice: price } : current));
      notify(price.price ? `Aktueller Preis: ${pricePerLiter(price.price)}/l` : "Kein Preis gefunden");
    }
  }

  async function logout() {
    await guard(() => api.logout());
    setState(null);
    setDriverFilter(null);
    setPassengerFilter(null);
    await load();
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-16 pt-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
            <Car className="h-5 w-5 text-accent" />
            MitFahr.io
          </h1>
          <p className="mt-0.5 truncate text-xs text-muted">
            {me ? `${me.firstName} ${me.lastName}${me.isAdmin ? " · Admin" : ""}` : "Fahrgemeinschaft abrechnen"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {me?.isAdmin && (
            <button
              onClick={() => setAdminOpen(true)}
              aria-label="Admin-Dashboard"
              title="Admin-Dashboard"
              className="rounded-xl border border-line bg-surface p-2.5 text-accent hover:border-accent hover:text-accent"
            >
              <ShieldCheck className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Einstellungen"
            className="rounded-xl border border-line bg-surface p-2.5 text-muted hover:border-line-strong hover:text-ink"
          >
            <Cog className="h-5 w-5" />
          </button>
          <button
            onClick={() => void logout()}
            aria-label="Abmelden"
            title="Abmelden"
            className="rounded-xl border border-line bg-surface p-2.5 text-muted hover:border-line-strong hover:text-danger"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <button
        onClick={() => setSettingsOpen(true)}
        className="mb-4 flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left hover:border-line-strong"
      >
        <div className="flex items-center gap-2 text-sm">
          <TrendingUp className="h-4 w-4 text-accent" />
          <span className="font-medium text-ink">
            {fuelPrice.price ? `${pricePerLiter(fuelPrice.price)}/l` : "kein Tankpreis"}
          </span>
          <span className="text-muted">{fuelPrice.fuelLabel}</span>
        </div>
        <span className="text-xs text-muted">
          {fuelPrice.source === "manual"
            ? "manuell"
            : fuelPrice.stale
              ? "veraltet"
              : ageLabel(fuelPrice.fetchedAt) || "PLZ prüfen"}
        </span>
      </button>

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
        <button
          onClick={() => setTab("fahrten")}
          className={
            "flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors " +
            (tab === "fahrten" ? "bg-accent text-on-accent" : "text-muted hover:text-ink")
          }
        >
          <Route className="h-4 w-4" />
          Fahrten
          <span className="text-xs opacity-70">{trips.length}</span>
        </button>
        <button
          onClick={() => setTab("zahlungen")}
          className={
            "flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors " +
            (tab === "zahlungen" ? "bg-accent text-on-accent" : "text-muted hover:text-ink")
          }
        >
          <HandCoins className="h-4 w-4" />
          Zahlungen
          {matrix.total > 0 && <span className="text-xs opacity-70">{eur(matrix.total)}</span>}
        </button>
      </div>

      {tab === "fahrten" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-xl bg-surface p-1">
              <FilterMenu label="Fahrer" options={driverOptions} value={driverFilter} onChange={setDriverFilter} />
              <FilterMenu
                label="Mitfahrer"
                options={passengerOptions}
                value={passengerFilter}
                onChange={setPassengerFilter}
              />
              {(driverFilter !== null || passengerFilter !== null) && (
                <button
                  onClick={() => {
                    setDriverFilter(null);
                    setPassengerFilter(null);
                  }}
                  className="rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-ink"
                >
                  zurücksetzen
                </button>
              )}
            </div>
            <Button onClick={() => setTripOpen(true)} className="shrink-0">
              <Plus className="h-4 w-4" />
              Fahrt
            </Button>
          </div>

          {driverFilter === mePersonId && mePersonId !== null && (
            <p className="px-1 text-xs text-muted">Zeigt nur deine eigenen Fahrten als Fahrer.</p>
          )}

          {visibleTrips.length === 0 && trips.length > 0 && (driverFilter !== null || passengerFilter !== null) ? (
            <div className="rounded-xl border border-line bg-surface p-5 text-sm text-muted">
              Keine Fahrt passt zu diesen Filtern.
            </div>
          ) : (
            <TripList
              trips={visibleTrips}
              onDelete={requestDeleteTrip}
              canDelete={(trip) => Boolean(me?.isAdmin) || trip.driverId === mePersonId}
              myPersonId={mePersonId}
            />
          )}
        </div>
      ) : (
        <DebtMatrix
          matrix={matrix}
          onSettle={requestSettle}
          canSettle={(debtorId) => Boolean(me?.isAdmin) || debtorId === mePersonId}
          myPersonId={mePersonId}
        />
      )}

      <TripDialog
        open={tripOpen}
        persons={persons}
        settings={settings}
        fuelPrice={fuelPrice}
        me={me}
        busy={busy}
        onClose={() => setTripOpen(false)}
        onSubmit={addTrip}
      />

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        fuelPrice={fuelPrice}
        me={me}
        canEditGlobal={Boolean(me?.isAdmin)}
        busy={busy}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
        onRefresh={refreshPrice}
        onSaveHome={saveHome}
      />

      <AdminDialog
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        notify={notify}
        onDataChanged={() => void load()}
      />

      <ConfirmDialog
        state={confirm}
        busy={confirmBusy}
        onClose={() => {
          if (!confirmBusy) setConfirm(null);
        }}
      />

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
          <div className="pointer-events-auto rounded-xl border border-line-strong bg-surface-2 px-4 py-2.5 text-sm text-ink shadow-[var(--shadow)]">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
