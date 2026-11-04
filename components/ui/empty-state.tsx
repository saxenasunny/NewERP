import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
  titleAs: TitleTag = "h2",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  titleAs?: "h2" | "h3";
}) {
  return (
    <div className="rounded-card border-border-strong bg-surface flex flex-col items-center gap-2 border border-dashed px-6 py-10 text-center">
      <TitleTag className="text-ink text-base font-semibold">{title}</TitleTag>
      {description ? <div className="text-ink-muted max-w-md text-sm">{description}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
