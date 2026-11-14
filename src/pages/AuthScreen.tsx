import { ArrowLeft, Car, Check, KeyRound, LogIn, Mail, ShieldCheck, UserPlus, X } from "lucide-react";
import { useState } from "react";
import type { AppState, Person } from "../lib/calc.ts";
import { api } from "../lib/api.ts";
import { Button, Field } from "../components/ui.tsx";

type Mode = "login" | "register" | "forgot";

const BORDER_OK = "border-accent focus:border-accent ring-1 ring-accent/30";
const BORDER_BAD = "border-danger focus:border-danger ring-1 ring-danger/30";

/** Muss zu `passwordProblems` im Server passen. */
function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push("mindestens 8 Zeichen");
  if (!/[A-ZÄÖÜ]/.test(password)) problems.push("einen Großbuchstaben");
  if (!/[0-9]/.test(password)) problems.push("eine Zahl");
  if (!/[^A-Za-z0-9ÄÖÜäöüß]/.test(password)) problems.push("ein Sonderzeichen");
  return problems;
}

function PasswordRules({ password }: { password: string }) {
  if (password.length === 0) return null;
  const checks = [
    { ok: password.length >= 8, label: "mindestens 8 Zeichen" },
    { ok: /[A-ZÄÖÜ]/.test(password), label: "Großbuchstabe" },
    { ok: /[0-9]/.test(password), label: "Zahl" },
    { ok: /[^A-Za-z0-9ÄÖÜäöüß]/.test(password), label: "Sonderzeichen" },
  ];
  return (
    <ul className="space-y-1 text-xs">
      {checks.map((check) => (
        <li key={check.label} className={check.ok ? "text-accent" : "text-muted"}>
          {check.ok ? <Check className="mr-1 inline h-3 w-3" /> : <X className="mr-1 inline h-3 w-3" />}
          {check.label}
        </li>
      ))}
    </ul>
  );
}

export function AuthScreen({
  persons,
  onAuthenticated,
  initialMode = "login",
}: {
  persons: Person[];
  onAuthenticated: (state: AppState) => void;
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  // Auf der Demo-Domain gibt es keine Registrierung — sonst wäre der Weg in die echte App sichtbar.
  const isDemoHost = typeof location !== "undefined" && location.hostname.startsWith("demo-");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Registrierung
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [personId, setPersonId] = useState<string>("");

  // Passwort vergessen
  const [step, setStep] = useState<"mail" | "code" | "password">("mail");
  const [resetEmail, setResetEmail] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");

  const registerProblems = passwordProblems(password);
  const registerMatch = password2.length > 0 && password === password2;
  const registerReady =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.trim()) &&
    registerProblems.length === 0 &&
    registerMatch;

  const resetProblems = passwordProblems(newPassword);
  const resetMatch = newPassword2.length > 0 && newPassword === newPassword2;
  const resetReady = resetProblems.length === 0 && resetMatch;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Etwas ist schiefgelaufen");
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
    setStep("mail");
  }

  return (
    <div className="app mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex flex-col items-center text-center">
        <span className="app-brand__mark mb-3">
          <Car className="h-5 w-5" />
        </span>
        <h1 className="app-title" style={{ fontSize: 28, margin: 0 }}>
          MitFahr.io
        </h1>
        <p className="mt-2 text-sm text-muted">Fahrgemeinschaft abrechnen – Fahrten, Kosten, offene Beträge.</p>
      </div>

      <div className="app-card">
        {mode === "login" && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const { state } = await api.login(loginEmail, loginPassword);
                onAuthenticated(state);
              });
            }}
          >
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
              <LogIn className="h-4 w-4 text-accent" />
              Anmelden
            </h2>
            <Field label="E-Mail">
              <input
                type="email"
                autoComplete="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="name@beispiel.de"
                required
              />
            </Field>
            <Field label="Passwort">
              <input
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="••••••••"
                required
              />
            </Field>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Anmelden…" : "Anmelden"}
            </Button>
            <div className="flex items-center justify-between text-xs">
              {!isDemoHost && (
                <button type="button" onClick={() => switchMode("register")} className="text-accent hover:underline">
                  Neues Konto anlegen
                </button>
              )}
              <button type="button" onClick={() => switchMode("forgot")} className="text-muted hover:text-ink">
                Passwort vergessen?
              </button>
            </div>
          </form>
        )}

        {mode === "register" && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!registerReady) return;
              void run(async () => {
                const { state } = await api.register({
                  firstName,
                  lastName,
                  email,
                  password,
                  personId: personId ? Number(personId) : null,
                });
                onAuthenticated(state);
              });
            }}
          >
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
              <UserPlus className="h-4 w-4 text-accent" />
              Konto anlegen
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vorname">
                <input value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
              </Field>
              <Field label="Nachname">
                <input value={lastName} onChange={(event) => setLastName(event.target.value)} required />
              </Field>
            </div>
            <Field label="E-Mail">
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@beispiel.de"
                required
              />
            </Field>

            <div className="space-y-2">
              <Field label="Passwort">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="z. B. Mitfahr2026!"
                  className={
                    password.length === 0
                      ? undefined
                      : registerProblems.length === 0
                        ? BORDER_OK
                        : BORDER_BAD
                  }
                  required
                />
              </Field>
              <PasswordRules password={password} />
            </div>

            <Field label="Passwort wiederholen">
              <input
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(event) => setPassword2(event.target.value)}
                placeholder="nochmal eingeben"
                className={password2.length === 0 ? undefined : registerMatch ? BORDER_OK : BORDER_BAD}
                required
              />
            </Field>
            {password2.length > 0 && !registerMatch && (
              <p className="text-xs text-danger">Die Passwörter stimmen nicht überein.</p>
            )}

            {persons.length > 0 && (
              <Field label="Schon in der Liste?" hint="Damit deine bisherigen Fahrten zu dir gehören.">
                <select value={personId} onChange={(event) => setPersonId(event.target.value)}>
                  <option value="">– neu anlegen als {`${firstName} ${lastName}`.trim()} –</option>
                  {persons.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !registerReady}>
              {busy ? "Anlegen…" : "Konto anlegen"}
            </Button>
            {!registerReady && (
              <p className="text-center text-xs text-muted">
                Bitte alle Felder ausfüllen, Passwortregeln erfüllen und beide Passwörter angleichen.
              </p>
            )}
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="flex items-center gap-1 text-xs text-muted hover:text-ink"
            >
              <ArrowLeft className="h-3 w-3" /> zurück zur Anmeldung
            </button>
          </form>
        )}

        {mode === "forgot" && (
          <div className="space-y-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
              <KeyRound className="h-4 w-4 text-accent" />
              Passwort zurücksetzen
            </h2>

            {step === "mail" && (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await api.forgotPassword(resetEmail);
                    setStep("code");
                    setInfo("Wenn es die Adresse gibt, ist der Code unterwegs – er gilt 15 Minuten.");
                  });
                }}
              >
                <Field label="E-Mail deines Kontos">
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(event) => setResetEmail(event.target.value)}
                    placeholder="name@beispiel.de"
                    required
                  />
                </Field>
                {error && <p className="text-sm text-danger">{error}</p>}
                <Button type="submit" className="w-full" disabled={busy}>
                  <Mail className="h-4 w-4" />
                  {busy ? "Sende…" : "Code schicken"}
                </Button>
              </form>
            )}

            {step === "code" && (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const { resetToken: token } = await api.verifyCode(resetEmail, code);
                    setResetToken(token);
                    setStep("password");
                    setInfo(null);
                  });
                }}
              >
                {info && <p className="text-xs text-accent">{info}</p>}
                <Field label="6-stelliger Code aus der Mail">
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    className="text-center text-lg tracking-[0.4em]"
                    required
                  />
                </Field>
                {error && <p className="text-sm text-danger">{error}</p>}
                <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
                  {busy ? "Prüfe…" : "Code prüfen"}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("mail");
                    setInfo(null);
                    setError(null);
                  }}
                  className="text-xs text-muted hover:text-ink"
                >
                  anderen Code anfordern
                </button>
              </form>
            )}

            {step === "password" && (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!resetReady) return;
                  void run(async () => {
                    const { state } = await api.resetPassword(resetToken, newPassword);
                    if (state) onAuthenticated(state);
                    else switchMode("login");
                  });
                }}
              >
                <p className="flex items-center gap-1.5 text-xs text-accent">
                  <ShieldCheck className="h-3.5 w-3.5" /> Code bestätigt – jetzt neues Passwort setzen
                </p>
                <Field label="Neues Passwort">
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className={
                      newPassword.length === 0
                        ? undefined
                        : resetProblems.length === 0
                          ? BORDER_OK
                          : BORDER_BAD
                    }
                    required
                  />
                </Field>
                <PasswordRules password={newPassword} />
                <Field label="Passwort wiederholen">
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword2}
                    onChange={(event) => setNewPassword2(event.target.value)}
                    className={newPassword2.length === 0 ? undefined : resetMatch ? BORDER_OK : BORDER_BAD}
                    required
                  />
                </Field>
                {newPassword2.length > 0 && !resetMatch && (
                  <p className="text-xs text-danger">Die Passwörter stimmen nicht überein.</p>
                )}
                {error && <p className="text-sm text-danger">{error}</p>}
                <Button type="submit" className="w-full" disabled={busy || !resetReady}>
                  {busy ? "Speichere…" : "Passwort speichern"}
                </Button>
              </form>
            )}

            <button
              type="button"
              onClick={() => switchMode("login")}
              className="flex items-center gap-1 text-xs text-muted hover:text-ink"
            >
              <ArrowLeft className="h-3 w-3" /> zurück zur Anmeldung
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
