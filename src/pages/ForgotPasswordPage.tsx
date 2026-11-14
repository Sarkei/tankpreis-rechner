import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Car } from "lucide-react";
import { api } from "../lib/api.ts";
import { useToast } from "../lib/ToastContext.tsx";
import { Button, Input } from "../components/ui/index.tsx";

export default function ForgotPasswordPage() {
  const { success, error: showError } = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api<{ message: string; devResetUrl?: string }>(
        "/api/auth/forgot-password",
        { method: "POST", body: JSON.stringify({ email }) }
      );
      setSent(true);
      success("E-Mail versendet (falls die Adresse existiert)");
      if (res.devResetUrl) setDevLink(res.devResetUrl);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Fehler beim Senden");
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
          <h1 className="text-2xl font-bold text-zinc-100">Passwort zurücksetzen</h1>
        </div>

        {sent ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center space-y-4">
            <div className="text-4xl">📧</div>
            <p className="text-zinc-300">
              Falls die E-Mail-Adresse registriert ist, haben wir einen Link gesendet.
            </p>
            {devLink && (
              <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-3 text-left">
                <p className="text-xs text-yellow-400 mb-1">Dev-Modus Reset-Link:</p>
                <a href={devLink} className="text-xs text-blue-400 break-all">{devLink}</a>
              </div>
            )}
            <Link to="/login" className="block text-blue-400 hover:text-blue-300 text-sm">
              Zurück zum Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
            <Input
              label="E-Mail-Adresse"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="deine@email.de"
              required
            />
            <Button type="submit" loading={loading} className="w-full">
              Reset-Link senden
            </Button>
            <p className="text-center text-xs text-zinc-500 leading-5">
              Wenn keine E-Mail ankommt, den Admin in den Einstellungen unter Benutzer ein neues Passwort verlangen lassen.
            </p>
            <p className="text-center text-sm">
              <Link to="/login" className="text-zinc-500 hover:text-zinc-300">
                Zurück zum Login
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
