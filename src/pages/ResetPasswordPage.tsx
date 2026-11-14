import React, { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Car } from "lucide-react";
import { api } from "../lib/api.ts";
import { useToast } from "../lib/ToastContext.tsx";
import { Button, Input } from "../components/ui/index.tsx";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();
  const { success, error: showError } = useToast();
  const [form, setForm] = useState({ password: "", confirmPassword: "" });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      showError("Passwörter stimmen nicht überein");
      return;
    }
    if (form.password.length < 8) {
      showError("Passwort muss mindestens 8 Zeichen haben");
      return;
    }
    setLoading(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password: form.password }),
      });
      success("Passwort erfolgreich geändert");
      navigate("/login");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Fehler beim Zurücksetzen");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-400 mb-4">Ungültiger oder fehlender Token.</p>
          <Link to="/login" className="text-blue-400">Zurück zum Login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            <Car className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Neues Passwort</h1>
        </div>
        <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
          <Input label="Neues Passwort" type="password" value={form.password}
            onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
            placeholder="Mindestens 8 Zeichen" />
          <Input label="Passwort bestätigen" type="password" value={form.confirmPassword}
            onChange={(e) => setForm((p) => ({ ...p, confirmPassword: e.target.value }))} />
          <Button type="submit" loading={loading} className="w-full">
            Passwort ändern
          </Button>
        </form>
      </div>
    </div>
  );
}
