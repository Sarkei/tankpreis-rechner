import { Plus, UserRound, X } from "lucide-react";
import { useState } from "react";
import type { Person } from "../lib/calc.ts";
import { Button, Card } from "./ui.tsx";

export function PersonBar({
  persons,
  busy,
  onAdd,
  onDelete,
}: {
  persons: Person[];
  busy: boolean;
  onAdd: (name: string) => Promise<void>;
  onDelete: (person: Person) => void;
}) {
  const [name, setName] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (value.length < 2) return;
    await onAdd(value);
    setName("");
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Personen</h2>
        <span className="text-xs text-zinc-500">{persons.length}</span>
      </div>

      {persons.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {persons.map((person) => (
            <span
              key={person.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 py-1 pl-2.5 pr-1.5 text-sm text-zinc-200"
            >
              <UserRound className="h-3.5 w-3.5 text-zinc-500" />
              {person.name}
              <button
                type="button"
                onClick={() => onDelete(person)}
                aria-label={`${person.name} entfernen`}
                className="rounded-full p-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-sm text-zinc-500">Noch niemand angelegt – füge unten die ersten Namen hinzu.</p>
      )}

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name, z. B. Lia"
          maxLength={60}
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={busy || name.trim().length < 2} className="shrink-0">
          <Plus className="h-4 w-4" />
          Hinzufügen
        </Button>
      </form>
    </Card>
  );
}
