import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RoleDashboard } from "@/components/dashboards/role-dashboard";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { getDb } from "@/lib/db/client";

export const metadata: Metadata = { title: "Institution overview" };

export default async function InstitutionDashboardPage() {
  const account = await requireAccountContext();
  if (!account.tenant) redirect(account.homePath);

  if (
    account.navRole !== "institution_admin" &&
    !account.isPlatformAdmin &&
    !account.roleKeys.includes("institution_admin") &&
    !account.roleKeys.includes("academic_coordinator")
  ) {
    redirect(account.homePath);
  }

  const canReadUsers = account.permissions.has("users.read");
  const db = getDb();
  const tenantId = account.tenant.tenantId;

  const [memberCount, activeMembers, pendingInvitations, roleCount] = canReadUsers
    ? await Promise.all([
        db.tenantMembership.count({ where: { tenantId } }),
        db.tenantMembership.count({ where: { tenantId, status: "ACTIVE" } }),
        db.invitation.count({
          where: { tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        }),
        db.role.count({ where: { tenantId } }),
      ])
    : [null, null, null, null];

  return (
    <RoleDashboard
      account={account}
      emptyTitle="No academic structure configured"
      emptyDescription="Academic years, programmes, courses, and enrolments arrive in Phase 4. People and invitations are available now."
    >
      {canReadUsers ? (
        <section aria-labelledby="people-summary-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="people-summary-heading" className="text-ink text-lg font-semibold">
              People
            </h2>
            <Link
              href="/admin/users"
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Manage people and invitations
            </Link>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Members", value: memberCount, hint: "All membership records" },
              {
                label: "Active members",
                value: activeMembers,
                hint: "Can access this institution",
              },
              { label: "Pending invitations", value: pendingInvitations, hint: "Unexpired links" },
              { label: "Roles", value: roleCount, hint: "Tenant-scoped roles" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-card border-border bg-surface shadow-card border p-4"
              >
                <dt className="text-ink-muted text-xs font-medium tracking-wide uppercase">
                  {stat.label}
                </dt>
                <dd className="text-ink mt-2 text-2xl font-semibold tabular-nums">
                  {stat.value ?? "—"}
                </dd>
                <dd className="text-ink-muted mt-1 text-xs">{stat.hint}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <section className="rounded-card border-border bg-surface border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="warning">Permission denied</StatusBadge>
            <p className="text-ink-muted text-sm">
              Your role cannot view the institution directory. Ask an institution administrator if
              you need access.
            </p>
          </div>
        </section>
      )}
    </RoleDashboard>
  );
}
