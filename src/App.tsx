import { AlertTriangle, Car, Cog, HandCoins, LogOut, Plus, Route, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AppSettings, AppState, HomePlace, Person, Trip } from "./lib/calc.ts";
import { ApiError, api, type TripPayload } from "./lib/api.ts";
import { eur, pricePerLiter } from "./lib/format.ts";
import { TripDialog } from "./components/TripDialog.tsx";
import { TripList } from "./components/TripList.tsx";
import { DebtMatrix } from "./components/DebtMatrix.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { ConfirmDialog, type ConfirmState } from "./components/ConfirmDialog.tsx";
import { FilterMenu } from "./components/FilterMenu.tsx";
import { AuthScreen } from "./pages/AuthScreen.tsx";
import { AdminDialog } from "./pages/AdminDialog.tsx";
import { OverviewPage } from "./pages/OverviewPage.tsx";
import { AppShell, PageHead, type NavItem } from "./components/AppShell.tsx";
import { Button } from "./components/ui.tsx";

type Tab = "uebersicht" | "fahrten" | "abrechnung";

const NAV: NavItem[] = [
  { id: "uebersicht", label: "Übersicht" },
  { id: "fahrten", label: "Fahrten" },
  { id: "abrechnung", label: "Abrechnung" },
];

const THEME_KEY = "mitfahr-theme";

function readTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [guestPersons, setGuestPersons] = useState<Person[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("uebersicht");
  const [driverFilter, setDriverFilter] = useState<number | null>(null);
  const [passengerFilter, setPassengerFilter] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [tripOpen, setTripOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* privater Modus: dann eben ohne Merken */
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0e1512" : "#f3f5f4");
  }, [theme]);

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
      <div className="app flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Lädt…</p>
      </div>
    );
  }

  if (loadError && !state) {
    return (
      <div className="app mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-warn" />
        <p className="text-sm text-muted">{loadError}</p>
        <button onClick={() => void load()} className="rounded-full bg-accent px-5 py-2.5 text-sm text-on-accent">
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
    setTab("uebersicht");
    await load();
  }

  const headerActions = (
    <>
      {me?.isAdmin && (
        <button
          onClick={() => setAdminOpen(true)}
          aria-label="Admin-Dashboard"
          title="Admin-Dashboard"
          className="app-iconbtn"
        >
          <ShieldCheck className="h-[18px] w-[18px]" />
        </button>
      )}
      <button
        onClick={() => setSettingsOpen(true)}
        aria-label="Einstellungen"
        title="Einstellungen"
        className="app-iconbtn"
      >
        <Cog className="h-[18px] w-[18px]" />
      </button>
      {me ? (
        <button onClick={() => void logout()} aria-label="Abmelden" title="Abmelden" className="app-iconbtn">
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      ) : null}
    </>
  );

  return (
    <AppShell
      name="MitFahr.io"
      subtitle="Fahrten & Abrechnung"
      mark={<Car className="h-5 w-5" />}
      items={NAV}
      active={tab}
      onNavigate={(id) => setTab(id as Tab)}
      theme={theme}
      onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      actions={headerActions}
      footer={
        <div className="app-container flex flex-wrap items-center justify-between gap-2">
          <span>MitFahr.io · Fahrgemeinschaft abrechnen</span>
          <span className="text-muted">
            {me ? `${me.firstName} ${me.lastName}${me.isAdmin ? " · Admin" : ""}` : "Demo-Ansicht ohne Anmeldung"}
          </span>
        </div>
      }
    >
      {tab === "uebersicht" && (
        <OverviewPage
          persons={persons}
          trips={trips}
          matrix={matrix}
          fuelPrice={fuelPrice}
          onNavigate={(id) => setTab(id as Tab)}
          onNewTrip={() => setTripOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {tab === "fahrten" && (
        <>
          <PageHead
            label="Fahrten"
            title="Alle Fahrten"
            intro="Jede Zeile ist eine Fahrt: wer gefahren ist, wer mitfuhr und was der Anteil pro Person kostet. Filter grenzen nach Fahrer und Mitfahrer ein."
          >
            <div className="mt-8 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1 rounded-full border border-line bg-surface p-1">
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
                    className="rounded-full px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-ink"
                  >
                    zurücksetzen
                  </button>
                )}
              </div>
              <Button onClick={() => setTripOpen(true)} className="shrink-0 rounded-full px-5">
                <Plus className="h-4 w-4" />
                Fahrt eintragen
              </Button>
            </div>
          </PageHead>

          <section className="app-container pb-16">
            {driverFilter === mePersonId && mePersonId !== null && (
              <p className="mb-3 px-1 text-xs text-muted">Zeigt nur deine eigenen Fahrten als Fahrer.</p>
            )}

            {visibleTrips.length === 0 && trips.length > 0 && (driverFilter !== null || passengerFilter !== null) ? (
              <div className="app-card">
                <p className="app-card__text">Keine Fahrt passt zu diesen Filtern.</p>
              </div>
            ) : trips.length === 0 ? (
              <div className="app-card">
                <p className="app-card__text">Noch keine Fahrt eingetragen. Die erste Fahrt legt auch die Abrechnung an.</p>
                <Button className="mt-4 rounded-full px-5 py-3" onClick={() => setTripOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Erste Fahrt eintragen
                </Button>
              </div>
            ) : (
              <TripList
                trips={visibleTrips}
                onDelete={requestDeleteTrip}
                canDelete={(trip) => Boolean(me?.isAdmin) || trip.driverId === mePersonId}
                myPersonId={mePersonId}
              />
            )}
          </section>
        </>
      )}

      {tab === "abrechnung" && (
        <>
          <PageHead
            label="Abrechnung"
            title="Wer wem was schuldet"
            intro={
              matrix.total > 0
                ? `Offen sind insgesamt ${eur(matrix.total)}. Häkchen bestätigen eine einzelne Zahlung, der Button je Spalte begleicht alle Beträge einer Person.`
                : "Aktuell ist alles ausgeglichen – sobald jemand mitfährt, erscheinen hier die offenen Beträge."
            }
          />
          <section className="app-container pb-16">
            <DebtMatrix
              matrix={matrix}
              onSettle={requestSettle}
              canSettle={(debtorId) => Boolean(me?.isAdmin) || debtorId === mePersonId}
              myPersonId={mePersonId}
            />
          </section>
        </>
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
          <div className="pointer-events-auto rounded-full border border-line-strong bg-surface px-4 py-2.5 text-sm text-ink shadow-[var(--shadow)]">
            {toast}
          </div>
        </div>
      )}
    </AppShell>
  );
}
