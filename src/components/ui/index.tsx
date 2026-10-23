import React, { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";
import { clsx } from "clsx";
import { Loader2 } from "lucide-react";

// ─── Button ─────────────────────────────────────────────────────────────────
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "success";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  icon,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-blue-600 hover:bg-blue-500 text-white focus:ring-blue-500",
    secondary: "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 focus:ring-zinc-500",
    danger: "bg-red-600 hover:bg-red-500 text-white focus:ring-red-500",
    ghost: "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 focus:ring-zinc-500",
    success: "bg-green-600 hover:bg-green-500 text-white focus:ring-green-500",
  };
  const sizes = {
    sm: "px-3 py-2 text-xs min-h-[40px]",
    md: "px-4 py-2.5 text-sm min-h-[44px]",
    lg: "px-6 py-3.5 text-base min-h-[48px]",
  };
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={clsx(base, variants[variant], sizes[size], className)}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
export function Card({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        "bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5",
        onClick && "cursor-pointer hover:border-zinc-600 transition-colors",
        className
      )}
    >
      {children}
    </div>
  );
}

// Shared field styling – high contrast on dark cards
const fieldClass =
  "w-full bg-zinc-950 text-zinc-100 border-2 border-zinc-500 rounded-lg px-3 py-2.5 text-sm " +
  "shadow-inner shadow-black/30 placeholder-zinc-500 outline-none " +
  "focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40 transition-all";
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, className, id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-zinc-400">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={clsx(
          fieldClass,
          error && "border-red-500 focus:ring-red-500/40 focus:border-red-500",
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hint && !error && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

// ─── Select ──────────────────────────────────────────────────────────────────
export function Select({
  label,
  error,
  hint,
  children,
  className,
  id,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  error?: string;
  hint?: string;
}) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={selectId} className="block text-sm font-medium text-zinc-400">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={clsx(
          fieldClass,
          error && "border-red-500",
          className
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hint && !error && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

// ─── Textarea ────────────────────────────────────────────────────────────────
export function Textarea({
  label,
  error,
  className,
  id,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  error?: string;
}) {
  const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={textareaId} className="block text-sm font-medium text-zinc-400">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        className={clsx(
          fieldClass,
          "resize-none",
          error && "border-red-500",
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  if (!isOpen) return null;
  const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={clsx(
          "relative bg-zinc-900 border border-zinc-800 rounded-2xl w-full shadow-2xl",
          sizes[size],
          "max-h-[90vh] overflow-y-auto"
        )}
      >
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 sticky top-0 bg-zinc-900 z-10">
          <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 p-1 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────────────
export function Badge({
  children,
  variant = "default",
  className,
}: {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "info";
  className?: string;
}) {
  const variants = {
    default: "bg-zinc-800 text-zinc-300",
    success: "bg-green-900/50 text-green-400 border border-green-800",
    warning: "bg-yellow-900/50 text-yellow-400 border border-yellow-800",
    danger: "bg-red-900/50 text-red-400 border border-red-800",
    info: "bg-blue-900/50 text-blue-400 border border-blue-800",
  };
  return (
    <span className={clsx("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", variants[variant], className)}>
      {children}
    </span>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} />;
}

export function SkeletonCard() {
  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 space-y-3">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="text-zinc-600 mb-4">{icon}</div>
      <h3 className="text-lg font-medium text-zinc-300 mb-2">{title}</h3>
      {description && <p className="text-sm text-zinc-500 mb-6 max-w-sm">{description}</p>}
      {action}
    </div>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────
export function Divider({ label }: { label?: string }) {
  if (!label) return <hr className="border-zinc-800 my-4" />;
  return (
    <div className="flex items-center gap-3 my-4">
      <hr className="flex-1 border-zinc-800" />
      <span className="text-xs text-zinc-500">{label}</span>
      <hr className="flex-1 border-zinc-800" />
    </div>
  );
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
export function Avatar({
  src,
  name,
  size = "md",
}: {
  src?: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = { sm: "w-8 h-8 text-xs", md: "w-10 h-10 text-sm", lg: "w-14 h-14 text-base" };
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (src)
    return (
      <img
        src={src}
        alt={name}
        className={clsx("rounded-full object-cover bg-zinc-800", sizes[size])}
      />
    );
  return (
    <div
      className={clsx(
        "rounded-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center font-semibold text-white shrink-0",
        sizes[size]
      )}
    >
      {initials}
    </div>
  );
}

// ─── Currency ────────────────────────────────────────────────────────────────
export function formatEuro(amount: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
