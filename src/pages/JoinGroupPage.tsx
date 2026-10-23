import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Car, Users } from "lucide-react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/AuthContext.tsx";
import { useToast } from "../lib/ToastContext.tsx";
import { Button, Input } from "../components/ui/index.tsx";

export default function JoinGroupPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { success, error: showError } = useToast();
  const [code, setCode] = useState(searchParams.get("code") ?? "");
  const [joining, setJoining] = useState(false);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) { showError("Bitte Einladecode eingeben"); return; }
    if (!user) { navigate(`/login?redirect=/join?code=${code}`); return; }
    setJoining(true);
    try {
      const res = await api<{ message: string; groupId: number; groupName: string }>(
        "/api/groups/join",
        { method: "POST", body: JSON.stringify({ inviteCode: code.trim() }) }
      );
      success(`Du bist "${res.groupName}" beigetreten!`);
      navigate("/groups");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Fehler beim Beitreten");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            <Users className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">Fahrgruppe beitreten</h1>
          <p className="text-zinc-500 mt-1">Gib deinen Einladecode ein</p>
        </div>

        <form onSubmit={handleJoin} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
          <Input
            label="Einladecode"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            className="text-center font-mono text-2xl tracking-[0.3em] uppercase"
            required
          />
          <Button type="submit" loading={joining} className="w-full" size="lg">
            Beitreten
          </Button>
        </form>

        {user ? (
          <p className="text-center mt-4 text-sm">
            <Link to="/groups" className="text-zinc-500 hover:text-zinc-300">Zurück zu Gruppen</Link>
          </p>
        ) : (
          <p className="text-center mt-4 text-sm text-zinc-500">
            Bereits registriert?{" "}
            <Link to="/login" className="text-blue-400 hover:text-blue-300">Anmelden</Link>
          </p>
        )}
      </div>
    </div>
  );
}
