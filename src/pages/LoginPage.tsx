import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Car } from "lucide-react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/AuthContext.tsx";
import { useToast } from "../lib/ToastContext.tsx";
import { Button, Input } from "../components/ui/index.tsx";

export default function LoginPage() {
  const { login } = useAuth();
  const { success, error: showError } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    rememberMe: false,
  });
  const [mustSetPassword, setMustSetPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const email = form.email.trim();
    if (!email.includes("@")) {
      setMustSetPassword(false);
      return;
    }
    const t = window.setTimeout(() => {
      void api<{ mustSetPassword: boolean }>("/api/auth/login-status", {
        method: "POST",
        body: JSON.stringify({ email }),
      })
        .then((res) => setMustSetPassword(Boolean(res.mustSetPassword)))
        .catch(() => setMustSetPassword(false));
    }, 350);
    return () => window.clearTimeout(t);
  }, [form.email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mustSetPassword) {
      if (form.password.length < 8) {
        showError("Neues Passwort muss mindestens 8 Zeichen haben");
        return;
      }
      if (form.password !== form.confirmPassword) {
        showError("Passwörter stimmen nicht überein");
        return;
      }
    }
    setLoading(true);
    try {
      const res = await login(form.email, form.password, form.rememberMe);
      if (res.passwordWasSet) success("Neues Passwort gespeichert");
      navigate("/");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Login fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            <Car className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">MitFahr.io</h1>
          <p className="text-zinc-500 mt-1">Fahrgemeinschaft Abrechnung</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-zinc-100">Anmelden</h2>

          {mustSetPassword ? (
            <p className="text-sm text-amber-300 bg-amber-950/40 border border-amber-800 rounded-xl px-3 py-2">
              Dein Passwort wurde zurückgesetzt. Gib hier dein neues Passwort ein — es wird beim Anmelden gespeichert.
            </p>
          ) : null}

          <Input
            label="E-Mail"
            type="email"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            placeholder="deine@email.de"
            autoComplete="email"
            required
          />
          <Input
            label={mustSetPassword ? "Neues Passwort" : "Passwort"}
            type="password"
            value={form.password}
            onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
            placeholder="Mindestens 8 Zeichen"
            autoComplete={mustSetPassword ? "new-password" : "current-password"}
            required
          />
          {mustSetPassword ? (
            <Input
              label="Neues Passwort bestätigen"
              type="password"
              value={form.confirmPassword}
              onChange={(e) => setForm((p) => ({ ...p, confirmPassword: e.target.value }))}
              placeholder="Noch einmal eingeben"
              autoComplete="new-password"
              required
            />
          ) : null}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.rememberMe}
              onChange={(e) => setForm((p) => ({ ...p, rememberMe: e.target.checked }))}
              className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-600"
            />
            <span className="text-sm text-zinc-400">Angemeldet bleiben (30 Tage)</span>
          </label>

          <Button type="submit" loading={loading} className="w-full" size="lg">
            {mustSetPassword ? "Passwort setzen und anmelden" : "Anmelden"}
          </Button>

          <p className="text-center text-sm text-zinc-500">
            <Link to="/forgot-password" className="text-blue-400 hover:text-blue-300">
              Passwort vergessen?
            </Link>
          </p>
        </form>

        <p className="text-center text-sm text-zinc-500 mt-4">
          Noch kein Konto?{" "}
          <Link to="/register" className="text-blue-400 hover:text-blue-300 font-medium">
            Registrieren
          </Link>
        </p>
      </div>
    </div>
  );
}
