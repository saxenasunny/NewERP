import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-border-strong/70 bg-surface-muted text-ink-muted",
  brand: "border-brand-200 bg-brand-50 text-brand-700 font-semibold",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold",
  warning: "border-amber-200 bg-amber-50 text-amber-800 font-semibold",
  danger: "border-rose-200 bg-rose-50 text-rose-700 font-semibold",
  info: "border-sky-200 bg-sky-50 text-sky-700 font-semibold",
};

export function StatusBadge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs tracking-wide ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
