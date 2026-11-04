import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="border-border flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        {eyebrow ? (
          <p className="text-brand-700 text-xs font-semibold tracking-wide uppercase">{eyebrow}</p>
        ) : null}
        <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description ? <div className="text-ink-muted max-w-2xl">{description}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
