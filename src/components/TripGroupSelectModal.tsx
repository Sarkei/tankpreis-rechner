import React from "react";
import { Users } from "lucide-react";
import type { CarpoolGroup } from "../types.ts";
import { Modal } from "./ui/index.tsx";
import { clsx } from "clsx";

export function TripGroupSelectModal({
  groups,
  onClose,
  onSelect,
}: {
  groups: CarpoolGroup[];
  onClose: () => void;
  onSelect: (group: CarpoolGroup) => void;
}) {
  return (
    <Modal isOpen onClose={onClose} title="Gruppe wählen" size="sm">
      <p className="text-sm text-zinc-500 mb-4">
        Für welche Gruppe möchtest du eine Fahrt eintragen?
      </p>
      <div className="space-y-2">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => onSelect(g)}
            className={clsx(
              "w-full flex items-center gap-3 p-4 rounded-xl border border-zinc-700",
              "bg-zinc-800/60 hover:border-blue-500/50 hover:bg-zinc-800",
              "active:scale-[0.98] transition-all text-left"
            )}
          >
            <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-zinc-100">{g.name}</p>
              {g.memberCount != null && (
                <p className="text-xs text-zinc-500">{g.memberCount} Mitglieder</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
