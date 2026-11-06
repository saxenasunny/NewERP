import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AccountContext } from "@/lib/auth/account";
import { plannedNavigation, ROLES } from "@/lib/navigation";

export function RoleDashboard({
  account,
  emptyTitle,
  emptyDescription,
  children,
}: {
  account: AccountContext;
  emptyTitle: string;
  emptyDescription: string;
  children?: ReactNode;
}) {
  const meta = ROLES[account.navRole];
  const planned = plannedNavigation(account.navRole);
  const scope = account.tenant?.institutionName ?? "Platform operations";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={scope}
        title={meta.label}
        description={meta.summary}
        actions={
          <p className="text-ink-muted text-sm">
            Signed in as <span className="text-ink font-medium">{account.user.name}</span>
          </p>
        }
      />

      {children ? (
        children
      ) : (
        <section aria-labelledby="current-activity-heading" className="flex flex-col gap-3">
          <h2 id="current-activity-heading" className="text-ink text-lg font-semibold">
            Current activity
          </h2>
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </section>
      )}

      {planned.length > 0 ? (
        <section aria-labelledby="planned-heading" className="flex flex-col gap-3 pt-4 border-t border-border/60">
          <div className="flex flex-col gap-1">
            <h2 id="planned-heading" className="text-ink text-base font-semibold">
              Planned modules
            </h2>
            <p className="text-ink-muted max-w-2xl text-xs">
              Upcoming enhancements configured in the platform roadmap.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {planned.map((section) => (
              <div
                key={section.key}
                className="rounded-card border-border bg-surface shadow-card border p-4"
              >
                <h3 className="text-ink text-sm font-semibold">{section.label}</h3>
                <ul className="mt-3 flex flex-col gap-2">
                  {section.entries.map((entry) => (
                    <li
                      key={entry.key}
                      className="text-ink-muted flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span>{entry.label}</span>
                      <StatusBadge tone="neutral">Phase {entry.phase}</StatusBadge>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
