const eurFormat = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function eur(value: number): string {
  return eurFormat.format(value);
}

export function kmLabel(value: number): string {
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value)} km`;
}

export function pricePerLiter(value: number | null): string {
  if (value === null) return "–";
  return `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value)} €`;
}

export function dayLabel(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Heute";
  if (sameDay(date, yesterday)) return "Gestern";

  return date.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

export function ageLabel(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  return `vor ${days} ${days === 1 ? "Tag" : "Tagen"}`;
}

/** Kürzt einen Nominatim-Namen auf die wesentlichen Teile: "Name, Straße". */
export function shortPlaceLabel(full: string): string {
  const parts = full
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter(
      (part) =>
        !/^\d{5}$/.test(part) &&
        !/^(deutschland|bayern|landkreis|gemarkung|regierungsbezirk|oberbayern)$/i.test(part) &&
        !/^(landkreis|gemarkung|regierungsbezirk)\b/i.test(part)
    );
  return parts.slice(0, 2).join(", ") || full;
}

export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}
