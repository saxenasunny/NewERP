import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RoleDashboard } from "@/components/dashboards/role-dashboard";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { getDb } from "@/lib/db/client";

export const metadata: Metadata = { title: "Platform overview" };

const tones: Record<string, BadgeTone> = {
  ACTIVE: "success",
  PENDING: "info",
  SUSPENDED: "warning",
  ARCHIVED: "neutral",
};

export default async function PlatformDashboardPage() {
  const account = await requireAccountContext();
  if (!account.isPlatformAdmin) redirect(account.homePath);

  const tenants = await getDb().tenant.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      createdAt: true,
      _count: { select: { memberships: true } },
    },
  });

  return (
    <RoleDashboard
      account={account}
      emptyTitle="No platform operations to report"
      emptyDescription="Institution creation, suspension, and support access arrive in Phase 12. The institutions below are read directly from PostgreSQL."
    >
      <section aria-labelledby="tenant-list-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="tenant-list-heading" className="text-ink text-lg font-semibold">
            Institutions
          </h2>
          <p className="text-ink-muted text-sm">
            Read-only. Platform roles do not grant access to an institution&apos;s learning records.
          </p>
        </div>

        <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
          <table className="divide-border min-w-full divide-y text-sm">
            <thead className="bg-surface-muted">
              <tr>
                <th scope="col" className="text-ink-muted px-4 py-3 text-left font-medium">
                  Institution
                </th>
                <th scope="col" className="text-ink-muted px-4 py-3 text-left font-medium">
                  Status
                </th>
                <th scope="col" className="text-ink-muted px-4 py-3 text-left font-medium">
                  Members
                </th>
                <th scope="col" className="text-ink-muted px-4 py-3 text-left font-medium">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td className="px-4 py-3">
                    <span className="text-ink font-medium">{tenant.name}</span>
                    <span className="text-ink-muted block text-xs">{tenant.slug}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={tones[tenant.status] ?? "neutral"}>
                      {tenant.status.toLowerCase()}
                    </StatusBadge>
                  </td>
                  <td className="text-ink px-4 py-3 tabular-nums">{tenant._count.memberships}</td>
                  <td className="text-ink-muted px-4 py-3">
                    {tenant.createdAt.toLocaleDateString("en-GB")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </RoleDashboard>
  );
}
