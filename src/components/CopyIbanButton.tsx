import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { copyToClipboard, formatIbanDisplay, normalizeIban } from "../lib/iban.ts";
import { clsx } from "clsx";

export default function CopyIbanButton({
  iban,
  className,
  size = "md",
}: {
  iban: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);
  const display = formatIbanDisplay(iban);
  const raw = normalizeIban(iban);

  if (!raw) return null;

  async function handleCopy() {
    const ok = await copyToClipboard(raw);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={clsx(
        "flex items-center gap-2 w-full rounded-xl border border-zinc-700 bg-zinc-800/80",
        "hover:border-blue-500/50 hover:bg-zinc-800 active:scale-[0.98] transition-all text-left",
        size === "sm" ? "px-3 py-2" : "px-4 py-3",
        className
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500 font-medium">IBAN</p>
        <p className={clsx("font-mono text-zinc-100 truncate", size === "sm" ? "text-xs" : "text-sm")}>
          {display}
        </p>
      </div>
      <div className={clsx(
        "shrink-0 flex items-center justify-center rounded-lg",
        copied ? "bg-green-600/20 text-green-400" : "bg-blue-600/20 text-blue-400",
        size === "sm" ? "w-8 h-8" : "w-10 h-10"
      )}>
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </div>
    </button>
  );
}
