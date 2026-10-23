import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Users, Copy, RefreshCw, Archive, UserMinus, Crown, ChevronDown, ChevronUp, Settings } from "lucide-react";
import { api } from "../lib/api.ts";
import { useToast } from "../lib/ToastContext.tsx";
import { useAuth } from "../lib/AuthContext.tsx";
import type { CarpoolGroup, GroupMember } from "../types.ts";
import {
  Card, Button, Modal, Input, Select, Textarea, Badge, EmptyState, SkeletonCard,
  Avatar, formatEuro
} from "../components/ui/index.tsx";
import { clsx } from "clsx";

function memberRoleBadge(member: GroupMember, ownerId: number) {
  if (member.id === ownerId || member.isOwner) {
    return <Badge variant="info">Fahrer</Badge>;
  }
  if (member.roles?.includes("FAHRER")) {
    return <Badge variant="info">Fahrer</Badge>;
  }
  return <Badge variant="default">Mitfahrer</Badge>;
}

export default function GroupsPage() {
  const navigate = useNavigate();
  const { user, isDriver } = useAuth();
  const { success, error: showError, info } = useToast();
  const [groups, setGroups] = useState<CarpoolGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editGroup, setEditGroup] = useState<CarpoolGroup | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [groupDetails, setGroupDetails] = useState<Record<number, CarpoolGroup>>({});

  useEffect(() => { loadGroups(); }, []);

  async function loadGroups() {
    try {
      const data = await api<CarpoolGroup[]>("/api/groups");
      setGroups(data);
    } catch { showError("Gruppen konnten nicht geladen werden"); }
    finally { setLoading(false); }
  }

  async function loadGroupDetails(id: number) {
    try {
      const data = await api<CarpoolGroup>(`/api/groups/${id}`);
      setGroupDetails((prev) => ({ ...prev, [id]: data }));
    } catch { showError("Gruppendetails konnten nicht geladen werden"); }
  }

  async function toggleExpand(id: number) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!groupDetails[id]) await loadGroupDetails(id);
  }

  async function renewCode(group: CarpoolGroup) {
    try {
      const res = await api<{ inviteCode: string }>(`/api/groups/${group.id}/renew-code`, { method: "POST" });
      setGroups((prev) => prev.map((g) => g.id === group.id ? { ...g, inviteCode: res.inviteCode } : g));
      success("Einladecode erneuert");
    } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
  }

  async function archiveGroup(group: CarpoolGroup) {
    if (!confirm(`Gruppe "${group.name}" archivieren?`)) return;
    try {
      await api(`/api/groups/${group.id}/archive`, {
        method: "PATCH",
        body: JSON.stringify({ archived: !group.isArchived }),
      });
      setGroups((prev) => prev.map((g) => g.id === group.id ? { ...g, isArchived: !g.isArchived } : g));
      success(group.isArchived ? "Gruppe reaktiviert" : "Gruppe archiviert");
    } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
  }

  async function removeMember(groupId: number, memberId: number) {
    if (!confirm("Mitglied entfernen?")) return;
    try {
      await api(`/api/groups/${groupId}/members/${memberId}`, { method: "DELETE" });
      setGroupDetails((prev) => {
        const existing = prev[groupId];
        if (!existing) return prev;
        return {
          ...prev,
          [groupId]: {
            ...existing,
            members: existing.members?.filter((m) => m.id !== memberId),
          },
        };
      });
      success("Mitglied entfernt");
    } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => info("Einladecode kopiert!"));
  }

  const activeGroups = groups.filter((g) => !g.isArchived);
  const archivedGroups = groups.filter((g) => g.isArchived);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-100">Fahrgruppen</h1>
        <div className="flex gap-2">
          <Link to="/join">
            <Button variant="secondary">Beitreten</Button>
          </Link>
          {isDriver && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
              Erstellen
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3"><SkeletonCard /><SkeletonCard /></div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Users className="w-12 h-12" />}
          title="Noch keine Gruppen"
          description="Erstelle eine Fahrgruppe oder tritt über einen Einladecode bei."
          action={
            <div className="flex gap-2">
              <Link to="/join"><Button variant="secondary">Beitreten</Button></Link>
              {isDriver && <Button onClick={() => setShowCreate(true)}>Erstellen</Button>}
            </div>
          }
        />
      ) : (
        <>
          {activeGroups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              currentUserId={user?.id ?? 0}
              details={groupDetails[group.id]}
              expanded={expandedId === group.id}
              onToggle={() => toggleExpand(group.id)}
              onCopyCode={() => copyCode(group.inviteCode)}
              onRenewCode={() => renewCode(group)}
              onArchive={() => archiveGroup(group)}
              onRemoveMember={(memberId) => removeMember(group.id, memberId)}
              onEdit={() => setEditGroup(groupDetails[group.id] ?? group)}
              onOpen={() => navigate(`/groups/${group.id}`)}
            />
          ))}

          {archivedGroups.length > 0 && (
            <div>
              <p className="text-sm text-zinc-500 mb-3">Archiviert</p>
              {archivedGroups.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  currentUserId={user?.id ?? 0}
                  details={groupDetails[group.id]}
                  expanded={expandedId === group.id}
                  onToggle={() => toggleExpand(group.id)}
                  onCopyCode={() => copyCode(group.inviteCode)}
                  onRenewCode={() => renewCode(group)}
                  onArchive={() => archiveGroup(group)}
                  onRemoveMember={(memberId) => removeMember(group.id, memberId)}
              onEdit={() => setEditGroup(groupDetails[group.id] ?? group)}
              onOpen={() => navigate(`/groups/${group.id}`)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <CreateGroupModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(g) => { setGroups((prev) => [...prev, g]); setShowCreate(false); success("Gruppe erstellt!"); }}
      />

      {editGroup && (
        <EditGroupModal
          group={editGroup}
          onClose={() => setEditGroup(null)}
          onSaved={(g) => {
            setGroups((prev) => prev.map((x) => x.id === g.id ? { ...x, ...g } : x));
            setGroupDetails((prev) => ({ ...prev, [g.id]: { ...prev[g.id], ...g } }));
            setEditGroup(null);
            success("Gruppe aktualisiert");
          }}
        />
      )}
    </div>
  );
}

function GroupCard({
  group, currentUserId, details, expanded, onToggle,
  onCopyCode, onRenewCode, onArchive, onRemoveMember, onEdit, onOpen
}: {
  group: CarpoolGroup;
  currentUserId: number;
  details?: CarpoolGroup;
  expanded: boolean;
  onToggle: () => void;
  onCopyCode: () => void;
  onRenewCode: () => void;
  onArchive: () => void;
  onRemoveMember: (id: number) => void;
  onEdit: () => void;
  onOpen: () => void;
}) {
  const isOwner = group.ownerId === currentUserId;

  return (
    <Card className={clsx("space-y-3", group.isArchived && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-90 transition-opacity"
        >
          <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-blue-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-zinc-100">{group.name}</p>
              {isOwner && <Crown className="w-3.5 h-3.5 text-yellow-400" />}
              {group.isArchived && <Badge variant="warning">Archiviert</Badge>}
            </div>
            <p className="text-xs text-zinc-500">
              {group.memberCount} Mitglieder ·{" "}
              {group.costSplitMode === "WITH_DRIVER" ? "Fahrer zahlt mit" : "Fahrer kostenlos"}
            </p>
            <p className="text-xs text-blue-400 mt-0.5">Tippen für Kostenübersicht →</p>
          </div>
        </button>
        <button onClick={onToggle} className="text-zinc-500 hover:text-zinc-300 p-1 shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Invite code */}
      {isOwner && !group.isArchived && (
        <div className="flex items-center gap-2 bg-zinc-800/50 rounded-xl px-3 py-2">
          <div className="flex-1">
            <p className="text-xs text-zinc-500">Einladecode</p>
            <p className="font-mono text-lg font-bold text-blue-400 tracking-wider">{group.inviteCode}</p>
          </div>
          <button onClick={onCopyCode} className="p-1.5 text-zinc-500 hover:text-zinc-300">
            <Copy className="w-4 h-4" />
          </button>
          <button onClick={onRenewCode} className="p-1.5 text-zinc-500 hover:text-zinc-300">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Expanded details */}
      {expanded && details && (
        <div className="space-y-3 pt-2 border-t border-zinc-800">
          {details.description && (
            <p className="text-sm text-zinc-400">{details.description}</p>
          )}

          {(details.defaultOutboundKm || details.defaultReturnKm || details.defaultFuelPrice) && (
            <div className="bg-zinc-800/40 rounded-xl p-3 space-y-1">
              <p className="text-xs font-medium text-zinc-500">Standard-Strecke</p>
              {details.defaultOutboundKm != null && (
                <p className="text-sm text-zinc-300">Hinweg: {details.defaultOutboundKm} km</p>
              )}
              {details.defaultReturnKm != null && (
                <p className="text-sm text-zinc-300">Rückweg: {details.defaultReturnKm} km</p>
              )}
              {details.defaultFuelPrice != null && (
                <p className="text-sm text-zinc-300">Kraftstoffpreis: {details.defaultFuelPrice.toFixed(3)} €/L</p>
              )}
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-zinc-500 mb-2">Mitglieder</p>
            <div className="space-y-2">
              {details.members?.filter((m) => m.isActive).map((member) => (
                <div key={member.id} className="flex items-center gap-3">
                  <Avatar src={member.avatarUrl} name={`${member.firstName} ${member.lastName}`} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm text-zinc-300">{member.firstName} {member.lastName}</p>
                      {memberRoleBadge(member, group.ownerId)}
                    </div>
                    {member.debtAmount > 0.005 && (
                      <p className="text-xs text-orange-400">schuldet {formatEuro(member.debtAmount)}</p>
                    )}
                  </div>
                  {isOwner && member.id !== currentUserId && member.isActive && (
                    <button
                      onClick={() => onRemoveMember(member.id)}
                      className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors"
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={onOpen}>
              Übersicht öffnen
            </Button>
            <Link to="/trips" className="flex-1">
              <Button variant="secondary" size="sm" className="w-full">Fahrten</Button>
            </Link>
            {isOwner && !group.isArchived && (
              <Button variant="secondary" size="sm" onClick={onEdit} icon={<Settings className="w-3.5 h-3.5" />}>
                Bearbeiten
              </Button>
            )}
            {isOwner && (
              <Button variant="ghost" size="sm" onClick={onArchive} icon={<Archive className="w-3.5 h-3.5" />}>
                {group.isArchived ? "Reaktivieren" : "Archivieren"}
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function CreateGroupModal({ isOpen, onClose, onCreated }: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (g: CarpoolGroup) => void;
}) {
  const { error: showError } = useToast();
  const [form, setForm] = useState({
    name: "",
    description: "",
    costSplitMode: "WITHOUT_DRIVER",
    defaultOutboundKm: "",
    defaultReturnKm: "",
    defaultFuelPrice: "",
  });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) { showError("Gruppenname ist Pflicht"); return; }
    setLoading(true);
    try {
      const group = await api<CarpoolGroup>("/api/groups", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          costSplitMode: form.costSplitMode,
          defaultOutboundKm: form.defaultOutboundKm ? parseFloat(form.defaultOutboundKm) : null,
          defaultReturnKm: form.defaultReturnKm ? parseFloat(form.defaultReturnKm) : null,
          defaultFuelPrice: form.defaultFuelPrice ? parseFloat(form.defaultFuelPrice) : null,
        }),
      });
      onCreated(group);
      setForm({
        name: "", description: "", costSplitMode: "WITHOUT_DRIVER",
        defaultOutboundKm: "", defaultReturnKm: "", defaultFuelPrice: "",
      });
    } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
    finally { setLoading(false); }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Neue Fahrgruppe erstellen" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Gruppenname" value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          placeholder='z.B. "Berufsschule Rosenheim"' required />
        <Textarea label="Beschreibung (optional)" value={form.description} rows={2}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
        <Select label="Kostenaufteilung" value={form.costSplitMode}
          onChange={(e) => setForm((p) => ({ ...p, costSplitMode: e.target.value }))}>
          <option value="WITHOUT_DRIVER">Mitfahrer tragen alle Kosten</option>
          <option value="WITH_DRIVER">Fahrer zahlt mit (Kosten geteilt)</option>
        </Select>
        <p className="text-xs text-zinc-500">
          {form.costSplitMode === "WITHOUT_DRIVER"
            ? "Die Gesamtkosten werden nur auf die Mitfahrer aufgeteilt."
            : "Die Gesamtkosten werden auf Fahrer + Mitfahrer aufgeteilt."}
        </p>

        <div className="border-t border-zinc-800 pt-4 space-y-3">
          <p className="text-sm font-medium text-zinc-300">Standard-Strecke für diese Gruppe</p>
          <p className="text-xs text-zinc-500">
            Diese Werte werden beim Eintragen einer Fahrt automatisch vorausgefüllt.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Hinweg (km)" type="number" step="0.1" min="0"
              value={form.defaultOutboundKm}
              onChange={(e) => setForm((p) => ({ ...p, defaultOutboundKm: e.target.value }))}
              placeholder="z.B. 45.5" />
            <Input label="Rückweg (km)" type="number" step="0.1" min="0"
              value={form.defaultReturnKm}
              onChange={(e) => setForm((p) => ({ ...p, defaultReturnKm: e.target.value }))}
              placeholder="z.B. 45.5" />
          </div>
          <Input label="Kraftstoffpreis (€/L)" type="number" step="0.001" min="0"
            value={form.defaultFuelPrice}
            onChange={(e) => setForm((p) => ({ ...p, defaultFuelPrice: e.target.value }))}
            placeholder="z.B. 1.899" />
        </div>

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Abbrechen</Button>
          <Button type="submit" loading={loading} className="flex-1">Erstellen</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditGroupModal({ group, onClose, onSaved }: {
  group: CarpoolGroup;
  onClose: () => void;
  onSaved: (g: CarpoolGroup) => void;
}) {
  const { error: showError } = useToast();
  const [form, setForm] = useState({
    name: group.name,
    description: group.description ?? "",
    costSplitMode: group.costSplitMode,
    defaultOutboundKm: group.defaultOutboundKm != null ? String(group.defaultOutboundKm) : "",
    defaultReturnKm: group.defaultReturnKm != null ? String(group.defaultReturnKm) : "",
    defaultFuelPrice: group.defaultFuelPrice != null ? String(group.defaultFuelPrice) : "",
  });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) { showError("Gruppenname ist Pflicht"); return; }
    setLoading(true);
    try {
      const updated = await api<CarpoolGroup>(`/api/groups/${group.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          costSplitMode: form.costSplitMode,
          defaultOutboundKm: form.defaultOutboundKm ? parseFloat(form.defaultOutboundKm) : null,
          defaultReturnKm: form.defaultReturnKm ? parseFloat(form.defaultReturnKm) : null,
          defaultFuelPrice: form.defaultFuelPrice ? parseFloat(form.defaultFuelPrice) : null,
        }),
      });
      onSaved(updated);
    } catch (err) { showError(err instanceof Error ? err.message : "Fehler"); }
    finally { setLoading(false); }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Gruppe bearbeiten: ${group.name}`} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Gruppenname" value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
        <Textarea label="Beschreibung (optional)" value={form.description} rows={2}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
        <Select label="Kostenaufteilung" value={form.costSplitMode}
          onChange={(e) => setForm((p) => ({
            ...p,
            costSplitMode: e.target.value as "WITH_DRIVER" | "WITHOUT_DRIVER",
          }))}>
          <option value="WITHOUT_DRIVER">Mitfahrer tragen alle Kosten</option>
          <option value="WITH_DRIVER">Fahrer zahlt mit (Kosten geteilt)</option>
        </Select>

        <div className="border-t border-zinc-800 pt-4 space-y-3">
          <p className="text-sm font-medium text-zinc-300">Standard-Strecke</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Hinweg (km)" type="number" step="0.1" min="0"
              value={form.defaultOutboundKm}
              onChange={(e) => setForm((p) => ({ ...p, defaultOutboundKm: e.target.value }))} />
            <Input label="Rückweg (km)" type="number" step="0.1" min="0"
              value={form.defaultReturnKm}
              onChange={(e) => setForm((p) => ({ ...p, defaultReturnKm: e.target.value }))} />
          </div>
          <Input label="Kraftstoffpreis (€/L)" type="number" step="0.001" min="0"
            value={form.defaultFuelPrice}
            onChange={(e) => setForm((p) => ({ ...p, defaultFuelPrice: e.target.value }))} />
        </div>

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Abbrechen</Button>
          <Button type="submit" loading={loading} className="flex-1">Speichern</Button>
        </div>
      </form>
    </Modal>
  );
}
