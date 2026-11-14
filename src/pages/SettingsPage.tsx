import React, { useState, useRef, useEffect } from "react";
import { User, Lock, Camera, Car, CreditCard, Users } from "lucide-react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/AuthContext.tsx";
import { useToast } from "../lib/ToastContext.tsx";
import { Card, Button, Input, Avatar, Badge } from "../components/ui/index.tsx";
import { isValidIban } from "../lib/iban.ts";
import { clsx } from "clsx";

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const { success, error: showError } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState({
    firstName: user?.firstName ?? "",
    lastName: user?.lastName ?? "",
    email: user?.email ?? "",
    iban: user?.iban ?? "",
    fuelPricePlz: user?.fuelPricePlz ?? "",
  });
  const [passwords, setPasswords] = useState({
    currentPassword: "", newPassword: "", confirmPassword: ""
  });
  const [profileLoading, setProfileLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (profile.iban && !isValidIban(profile.iban)) {
      showError("Ungültige IBAN");
      return;
    }
    if (profile.fuelPricePlz && profile.fuelPricePlz.replace(/\D/g, "").length !== 5) {
      showError("PLZ muss 5 Ziffern haben");
      return;
    }
    setProfileLoading(true);
    try {
      await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          firstName: profile.firstName,
          lastName: profile.lastName,
          email: profile.email,
          iban: profile.iban.trim() || null,
          fuelPricePlz: profile.fuelPricePlz.trim() || null,
        }),
      });
      await refreshUser();
      success("Profil aktualisiert");
    } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
    finally { setProfileLoading(false); }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (passwords.newPassword !== passwords.confirmPassword) {
      showError("Passwörter stimmen nicht überein");
      return;
    }
    if (passwords.newPassword.length < 8) {
      showError("Mindestens 8 Zeichen");
      return;
    }
    setPasswordLoading(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: passwords.currentPassword,
          newPassword: passwords.newPassword,
        }),
      });
      success("Passwort geändert");
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
    finally { setPasswordLoading(false); }
  }

  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarLoading(true);
    try {
      const fd = new FormData();
      fd.append("avatar", file);
      await api("/api/profile/avatar", { method: "POST", body: fd });
      await refreshUser();
      success("Profilbild aktualisiert");
    } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
    finally { setAvatarLoading(false); }
  }

  async function toggleRole(role: string) {
    const currentRoles = user?.roles ?? [];
    const newRoles = currentRoles.includes(role)
      ? currentRoles.filter((r) => r !== role)
      : [...currentRoles, role];
    if (newRoles.length === 0) { showError("Mindestens eine Rolle erforderlich"); return; }
    try {
      await api("/api/profile/roles", {
        method: "PUT",
        body: JSON.stringify({ roles: newRoles }),
      });
      await refreshUser();
      success("Rollen aktualisiert");
    } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
  }

  return (
    <div className="space-y-6 max-w-lg mx-auto w-full pb-8">
      <h1 className="text-xl font-bold text-zinc-100">Einstellungen</h1>

      {/* Avatar */}
      <Card>
        <p className="text-sm font-medium text-zinc-300 mb-4">Profilbild</p>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar
              src={user?.avatarUrl}
              name={`${user?.firstName} ${user?.lastName}`}
              size="lg"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={avatarLoading}
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center hover:bg-blue-500 transition-colors"
            >
              <Camera className="w-3.5 h-3.5 text-white" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={uploadAvatar} />
          </div>
          <div>
            <p className="font-medium text-zinc-200">{user?.firstName} {user?.lastName}</p>
            <p className="text-sm text-zinc-500">{user?.email}</p>
            <div className="flex gap-1 mt-1">
              {user?.roles?.map((r) => (
                <Badge key={r} variant={r === "FAHRER" ? "info" : "default"}>{r}</Badge>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {user?.roles?.includes("FAHRER") && (
        <Card>
          <p className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
            <CreditCard className="w-4 h-4" /> Zahlungsdaten
          </p>
          <form onSubmit={saveProfile} className="space-y-4">
            <Input
              label="IBAN"
              value={profile.iban}
              onChange={(e) => setProfile((p) => ({ ...p, iban: e.target.value }))}
              placeholder="DE89 3704 0044 0532 0130 00"
              hint="Wird Mitfahrern angezeigt, damit sie wissen wohin sie überweisen sollen"
            />
            <Input
              label="PLZ für Kraftstoffpreise"
              value={profile.fuelPricePlz}
              onChange={(e) => setProfile((p) => ({ ...p, fuelPricePlz: e.target.value.replace(/\D/g, "").slice(0, 5) }))}
              placeholder="80331"
              hint="Für automatische Preisaktualisierung deiner Fahrzeuge (Tankerkoenig)"
            />
            <Button type="submit" loading={profileLoading} className="w-full min-h-[48px]">
              Zahlungsdaten speichern
            </Button>
          </form>
        </Card>
      )}

      {/* Profile */}
      <Card>
        <p className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
          <User className="w-4 h-4" /> Profil bearbeiten
        </p>
        <form onSubmit={saveProfile} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Vorname" value={profile.firstName}
              onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))} />
            <Input label="Nachname" value={profile.lastName}
              onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))} />
          </div>
          <Input label="E-Mail" type="email" value={profile.email}
            onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} />
          <Button type="submit" loading={profileLoading} className="w-full">Speichern</Button>
        </form>
      </Card>

      {/* Roles */}
      <Card>
        <p className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
          <Car className="w-4 h-4" /> Meine Rollen
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: "FAHRER", label: "Fahrer", icon: "🚗", desc: "Gruppen erstellen & Fahrten eintragen" },
            { value: "MITFAHRER", label: "Mitfahrer", icon: "👤", desc: "Gruppen beitreten & Schulden sehen" },
          ].map((opt) => {
            const active = user?.roles?.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleRole(opt.value)}
                className={clsx(
                  "p-3 rounded-xl border text-left transition-all",
                  active
                    ? "border-blue-500 bg-blue-500/10 text-blue-300"
                    : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
                )}
              >
                <div className="text-2xl mb-1">{opt.icon}</div>
                <div className="font-medium text-sm">{opt.label}</div>
                <div className="text-xs opacity-70">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </Card>

      {user?.isAdmin ? <AdminUsersCard /> : null}

      {/* Password */}
      <Card>
        <p className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
          <Lock className="w-4 h-4" /> Passwort ändern
        </p>
        <form onSubmit={changePassword} className="space-y-4">
          <Input label="Aktuelles Passwort" type="password" value={passwords.currentPassword}
            onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))} required />
          <Input label="Neues Passwort" type="password" value={passwords.newPassword}
            onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))}
            placeholder="Mindestens 8 Zeichen" required />
          <Input label="Passwort bestätigen" type="password" value={passwords.confirmPassword}
            onChange={(e) => setPasswords((p) => ({ ...p, confirmPassword: e.target.value }))} required />
          <Button type="submit" loading={passwordLoading} className="w-full">Passwort ändern</Button>
        </form>
      </Card>

      <p className="text-xs text-zinc-600 text-center pb-4">MitFahr.io · Fahrgemeinschaft Abrechnung</p>
    </div>
  );
}

interface AdminUserRow {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  mustSetPassword: boolean;
}

function AdminUsersCard() {
  const { success, error: showError } = useToast();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function loadUsers() {
    try {
      const data = await api<AdminUserRow[]>("/api/admin/users");
      setUsers(data);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Benutzer konnten nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requireNewPassword(id: number) {
    setBusyId(id);
    try {
      await api(`/api/admin/users/${id}/require-password`, { method: "POST" });
      setUsers((list) =>
        list.map((u) => (u.id === id ? { ...u, mustSetPassword: true } : u))
      );
      success("Beim nächsten Anmelden muss ein neues Passwort gesetzt werden");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <p className="text-sm font-medium text-zinc-300 mb-1 flex items-center gap-2">
        <Users className="w-4 h-4" /> Benutzer
      </p>
      <p className="text-xs text-zinc-500 mb-4">
        Klick auf „Neues Passwort“: Die Person gibt beim nächsten Anmelden ein neues Passwort ein, das direkt gesetzt wird.
      </p>
      {loading ? (
        <p className="text-sm text-zinc-500">Lädt…</p>
      ) : (
        <div className="divide-y divide-zinc-800">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <Avatar src={u.avatarUrl} name={`${u.firstName} ${u.lastName}`} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-200 truncate">
                  {u.firstName} {u.lastName}
                </p>
                <p className="text-xs text-zinc-500 truncate">{u.email}</p>
                {u.mustSetPassword ? (
                  <p className="text-xs text-amber-400 mt-0.5">Wartet auf neues Passwort</p>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={busyId === u.id}
                onClick={() => void requireNewPassword(u.id)}
              >
                Neues Passwort
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
