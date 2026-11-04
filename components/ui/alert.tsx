import type { ReactNode } from "react";

export type AlertTone = "info" | "success" | "warning" | "danger";

const toneClasses: Record<AlertTone, string> = {
  info: "border-info/20 bg-info-subtle text-info",
  success: "border-success/20 bg-success-subtle text-success",
  warning: "border-warning/20 bg-warning-subtle text-warning",
  danger: "border-danger/20 bg-danger-subtle text-danger",
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
      className={`rounded-lg border px-4 py-3 text-sm ${toneClasses[tone]}`}
    >
      <p className="font-semibold">{title}</p>
      {children ? <div className="text-ink-muted mt-1">{children}</div> : null}
    </div>
  );
}
