import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Car } from "lucide-react";
import { useAuth } from "../lib/AuthContext.tsx";
import { useToast } from "../lib/ToastContext.tsx";
import { Button, Input } from "../components/ui/index.tsx";
import { clsx } from "clsx";

export default function RegisterPage() {
  const { register } = useAuth();
  const { error: showError } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "MITFAHRER",
    iban: "",
    fuelPricePlz: "",
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!form.firstName) e.firstName = "Pflichtfeld";
    if (!form.lastName) e.lastName = "Pflichtfeld";
    if (!form.email) e.email = "Pflichtfeld";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Ungültige E-Mail";
    if (form.password.length < 8) e.password = "Mindestens 8 Zeichen";
    if (form.password !== form.confirmPassword) e.confirmPassword = "Passwörter stimmen nicht überein";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setLoading(true);
    try {
      await register({
        email: form.email,
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role,
        ...(form.role === "FAHRER" && {
          iban: form.iban || undefined,
          fuelPricePlz: form.fuelPricePlz || undefined,
        }),
      });
      navigate("/");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Registrierung fehlgeschlagen");
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
        </div>

        <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-zinc-100">Registrieren</h2>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Vorname" value={form.firstName} error={errors.firstName}
              onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} />
            <Input label="Nachname" value={form.lastName} error={errors.lastName}
              onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} />
          </div>

          <Input label="E-Mail" type="email" value={form.email} error={errors.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            placeholder="deine@email.de" />

          <Input label="Passwort" type="password" value={form.password} error={errors.password}
            onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
            placeholder="Mindestens 8 Zeichen" />

          <Input label="Passwort bestätigen" type="password" value={form.confirmPassword}
            error={errors.confirmPassword}
            onChange={(e) => setForm((p) => ({ ...p, confirmPassword: e.target.value }))} />

          {/* Role Selection */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-400">Ich bin hauptsächlich …</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "FAHRER", label: "Fahrer", icon: "🚗", desc: "Ich fahre andere" },
                { value: "MITFAHRER", label: "Mitfahrer", icon: "👤", desc: "Ich fahre mit" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, role: opt.value }))}
                  className={clsx(
                    "p-3 rounded-xl border text-left transition-all",
                    form.role === opt.value
                      ? "border-blue-500 bg-blue-500/10 text-blue-300"
                      : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
                  )}
                >
                  <div className="text-2xl mb-1">{opt.icon}</div>
                  <div className="font-medium text-sm">{opt.label}</div>
                  <div className="text-xs opacity-70">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {form.role === "FAHRER" && (
            <div className="space-y-3 pt-1 border-t border-zinc-800">
              <p className="text-xs text-zinc-500">Optional – kannst du auch später in den Einstellungen ergänzen</p>
              <Input label="IBAN" value={form.iban}
                onChange={(e) => setForm((p) => ({ ...p, iban: e.target.value }))}
                placeholder="DE89 3704 0044 0532 0130 00" />
              <Input label="PLZ (für Auto-Tankpreise)" value={form.fuelPricePlz}
                onChange={(e) => setForm((p) => ({ ...p, fuelPricePlz: e.target.value.replace(/\D/g, "").slice(0, 5) }))}
                placeholder="80331" />
            </div>
          )}

          <Button type="submit" loading={loading} className="w-full min-h-[48px]" size="lg">
            Konto erstellen
          </Button>
        </form>

        <p className="text-center text-sm text-zinc-500 mt-4">
          Bereits registriert?{" "}
          <Link to="/login" className="text-blue-400 hover:text-blue-300 font-medium">
            Anmelden
          </Link>
        </p>
      </div>
    </div>
  );
}
