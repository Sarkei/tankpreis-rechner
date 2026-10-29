import { MapPin, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type Place } from "../lib/api.ts";

export function RouteField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  placeholder: string;
}) {
  const [text, setText] = useState(value?.label ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value === null) setText("");
  }, [value]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function handleText(next: string) {
    setText(next);
    setError(null);
    if (value) onChange(null);
    if (timer.current) window.clearTimeout(timer.current);
    if (next.trim().length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const { results: found } = await api.searchPlaces(next.trim());
        setResults(found);
        setOpen(true);
        if (found.length === 0) setError("Nichts gefunden – andere Schreibweise probieren");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ortssuche fehlgeschlagen");
      } finally {
        setLoading(false);
      }
    }, 400);
  }

  return (
    <div className="relative" ref={box}>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          value={text}
          onChange={(event) => handleText(event.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="pl-9 pr-9"
          autoComplete="off"
        />
        {text.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setText("");
              onChange(null);
              setResults([]);
              setOpen(false);
            }}
            aria-label="Feld leeren"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-500 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/50">
          {results.map((place) => (
            <li key={`${place.lat}-${place.lon}-${place.label}`}>
              <button
                type="button"
                onClick={() => {
                  onChange(place);
                  setText(place.label);
                  setOpen(false);
                  setResults([]);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              >
                {place.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
        {loading ? (
          <>
            <Search className="h-3 w-3 animate-pulse" /> sucht…
          </>
        ) : error ? (
          <span className="text-amber-400">{error}</span>
        ) : value ? (
          <span className="text-emerald-400/90">Ort übernommen – Strecke wird berechnet</span>
        ) : (
          "Ort suchen und aus der Liste wählen"
        )}
      </p>
    </div>
  );
}
