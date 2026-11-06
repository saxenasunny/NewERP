import type { ReactNode } from "react";

export type AlertTone = "info" | "success" | "warning" | "danger";

const toneClasses: Record<AlertTone, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-rose-200 bg-rose-50 text-rose-900",
};

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: AlertTone;
  title: string;
  children?: ReactNode;
}) {
  // Errors are assertive; informational messages are not live regions so a
  // static page does not announce them on every load.
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={`rounded-xl border p-4 text-sm shadow-xs ${toneClasses[tone]}`}
    >
      <p className="font-bold flex items-center gap-1.5">{title}</p>
      {children ? <div className="mt-1 text-ink-muted leading-relaxed">{children}</div> : null}
    </div>
  );
}
