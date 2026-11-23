export function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase();
}

export function formatIbanDisplay(iban: string): string {
  const n = normalizeIban(iban);
  if (!n) return "";
  return n.replace(/(.{4})/g, "$1 ").trim();
}

export function isValidIban(iban: string): boolean {
  const n = normalizeIban(iban);
  if (!n) return true;
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(n);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}
