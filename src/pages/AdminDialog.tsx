import { KeyRound, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AdminUserRow } from "../lib/calc.ts";
import { api } from "../lib/api.ts";
import { Button, Field, Modal } from "../components/ui.tsx";

function formatDate(iso: string | null): string {
  if (!iso) return "nie";
  const date = new Date(iso);
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AdminDialog({
  open,
  onClose,
  notify,
  onDataChanged,
}: {
  open: boolean;
  onClose: () => void;
  notify: (message: string) => void;
  onDataChanged: () => void;
}) {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pwUser, setPwUser] = useState<AdminUserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<AdminUserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { users: rows } = await api.adminUsers();
      setUsers(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konnte Benutzer nicht laden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function setPassword() {
    if (!pwUser) return;
    setBusy(true);
    try {
      await api.adminSetPassword(pwUser.id, newPassword);
      notify(`Passwort für ${pwUser.email} gesetzt`);
      setPwUser(null);
      setNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konnte Passwort nicht setzen");
    } finally {
      setBusy(false);
    }
  }

  async function removeUser() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      const result = await api.adminDeleteUser(confirmDelete.id);
      notify(
        result.personKept
          ? `${confirmDelete.email} gelöscht – die Person bleibt wegen bestehender Fahrten in der Liste`
          : `${confirmDelete.email} gelöscht`
      );
      setConfirmDelete(null);
      await load();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konnte Konto nicht löschen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Admin-Dashboard"
      size="wide"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Schließen
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm text-ink">
            <ShieldCheck className="h-4 w-4 text-accent" />
            {users.length} Konten
          </p>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
          >
            <RefreshCw className={"h-3.5 w-3.5 " + (loading ? "animate-spin" : "")} />
            neu laden
          </button>
        </div>

        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-2 pr-2">Name</th>
                <th className="py-2 pr-2">E-Mail</th>
                <th className="py-2 pr-2 whitespace-nowrap">Letzter Login</th>
                <th className="py-2 pr-2 text-center">Fahrten</th>
                <th className="py-2 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-line">
                  <td className="py-2 pr-2 text-ink">
                    {user.firstName} {user.lastName}
                    {user.isAdmin && (
                      <span className="ml-1.5 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] uppercase text-accent">
                        Admin
                      </span>
                    )}
                    {user.personName && user.personName !== `${user.firstName} ${user.lastName}` && (
                      <div className="text-[11px] text-muted">Person: {user.personName}</div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-xs text-muted">{user.email}</td>
                  <td className="py-2 pr-2 text-xs text-muted">{formatDate(user.lastLoginAt)}</td>
                  <td className="py-2 pr-2 text-center text-xs text-muted">
                    {user.tripsAsDriver} / {user.tripsAsPassenger}
                  </td>
                  <td className="py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => {
                          setPwUser(user);
                          setNewPassword("");
                          setError(null);
                        }}
                        title="Passwort setzen"
                        aria-label={`Passwort für ${user.email} setzen`}
                        className="rounded-md bg-surface-2 p-1.5 text-muted hover:bg-accent hover:text-on-accent"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                      {!user.isAdmin && (
                        <button
                          onClick={() => {
                            setConfirmDelete(user);
                            setError(null);
                          }}
                          title="Konto löschen"
                          aria-label={`${user.email} löschen`}
                          className="rounded-md bg-surface-2 p-1.5 text-muted hover:bg-danger hover:text-white"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-sm text-muted">
                    Noch keine Konten.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Aktionen in der letzten Spalte: Passwort neu setzen (der Nutzer meldet sich danach mit dem neuen Passwort
          an) oder das Konto löschen. Fahrten der Person bleiben erhalten.
        </p>
      </div>

      {/* Passwort setzen */}
      <Modal
        open={pwUser !== null}
        onClose={() => setPwUser(null)}
        title="Passwort neu setzen"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPwUser(null)} disabled={busy}>
              Abbrechen
            </Button>
            <Button onClick={() => void setPassword()} disabled={busy || newPassword.length < 8}>
              Speichern
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink">
            Neues Passwort für <span className="font-medium text-ink">{pwUser?.email}</span>. Der Nutzer kann sich
            damit sofort anmelden – kein Code nötig.
          </p>
          <Field label="Passwort" hint="Mindestens 8 Zeichen.">
            <input
              type="text"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="z. B. Mitfahr-2026"
            />
          </Field>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      </Modal>

      {/* Löschen bestätigen */}
      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Konto löschen?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={busy}>
              Abbrechen
            </Button>
            <Button variant="danger" onClick={() => void removeUser()} disabled={busy}>
              <X className="h-4 w-4" />
              Löschen
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          {confirmDelete?.email} kann sich danach nicht mehr anmelden. Fahrten und Schulden der zugehörigen Person
          bleiben in der Abrechnung erhalten.
        </p>
      </Modal>
    </Modal>
  );
}
