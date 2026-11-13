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
            ? "bg-accent/20 text-accent ring-1 ring-accent/40"
            : "text-muted hover:bg-surface-2 hover:text-ink")
        }
      >
        <UserRound className="h-3.5 w-3.5" />
        <span className="text-muted">{label}:</span>
        {active ? active.name : "Alle"}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-line-strong bg-surface py-1 shadow-[var(--shadow)]">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 hover:text-ink"
          >
            Alle
            {value === null && <Check className="h-4 w-4 text-accent" />}
          </button>
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">Noch keine Fahrten erfasst.</p>
          )}
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 hover:text-ink"
            >
              {option.name}
              {value === option.id && <Check className="h-4 w-4 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
