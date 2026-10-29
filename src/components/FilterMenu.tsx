import { Check, ChevronDown, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Person } from "../lib/calc.ts";

export function FilterMenu({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Person[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const active = value !== null ? options.find((option) => option.id === value) : null;

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={
          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors " +
          (active
            ? "bg-blue-600/20 text-blue-200 ring-1 ring-blue-500/50"
            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")
        }
      >
        <UserRound className="h-3.5 w-3.5" />
        <span className="text-zinc-500">{label}:</span>
        {active ? active.name : "Alle"}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          >
            Alle
            {value === null && <Check className="h-4 w-4 text-blue-400" />}
          </button>
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-zinc-500">Noch keine Fahrten erfasst.</p>
          )}
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              {option.name}
              {value === option.id && <Check className="h-4 w-4 text-blue-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
