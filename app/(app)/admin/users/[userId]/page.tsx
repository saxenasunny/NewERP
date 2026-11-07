import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { ResourceNotFoundError } from "@/lib/errors";
import {
  getMember,
  listAssignableRoles,
  listMemberAuditEvents,
} from "@/modules/identity/user-service";

import {
  assignRoleAction,
  deactivateUserAction,
  reactivateUserAction,
  removeRoleAction,
} from "../actions";

export const metadata: Metadata = { title: "Manage person" };

const STATUS_TONES: Record<string, BadgeTone> = {
  ACTIVE: "success",
  INVITED: "info",
  DEACTIVATED: "danger",
  LOCKED: "danger",
};

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  if (!account.tenant) redirect(account.homePath);

  const { userId } = await params;
  const { notice, error } = await searchParams;
  const returnTo = `/admin/users/${userId}`;

  const canManageUser =
    account.permissions.has("users.update") ||
    account.permissions.has("roles.assign") ||
    account.permissions.has("users.create") ||
    account.permissions.has("users.deactivate") ||
    account.navRole === "institution_admin";

  if (!canManageUser) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="People" title="Person" />
        <PermissionDenied message="Your role cannot view or manage institution members. Ask an institution administrator if you need access." />
      </div>
    );
  }

  const member = await getMember(account, userId).catch((cause) => {
    // A foreign tenant's user ID is reported exactly like a missing row.
    if (cause instanceof ResourceNotFoundError) notFound();
    throw cause;
  });

  const canAssignRoles = account.permissions.has("roles.assign");
  const canDeactivate = account.permissions.has("users.deactivate");
  const canReactivate = account.permissions.has("users.update");
  const isSelf = member.userId === account.user.id;

  const [roles, auditEvents] = await Promise.all([
    canAssignRoles ? listAssignableRoles(account) : Promise.resolve([]),
    listMemberAuditEvents(account, member.userId),
  ]);
  const heldRoleIds = new Set(member.roles.map((role) => role.roleId));
  const grantableRoles = roles.filter((role) => !heldRoleIds.has(role.id));
  const isDeactivated = member.accountStatus === "DEACTIVATED";

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/admin" },
          { label: "People", href: "/admin/users" },
          { label: member.name },
        ]}
      />
      <PageHeader
        eyebrow={account.tenant.institutionName}
        title={member.name}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <span>{member.email}</span>
            <StatusBadge tone={STATUS_TONES[member.accountStatus] ?? "neutral"}>
              {member.accountStatus === "DEACTIVATED"
                ? "Deactivated"
                : member.accountStatus === "INVITED"
                  ? "Invited"
                  : member.accountStatus === "LOCKED"
                    ? "Locked"
                    : "Active"}
            </StatusBadge>
            {member.status !== "ACTIVE" ? (
              <StatusBadge tone="warning">
                Membership {member.status === "SUSPENDED" ? "suspended" : "invited"}
              </StatusBadge>
            ) : null}
          </span>
        }
        actions={
          <Link href="/admin/users" className="text-brand-800 text-sm font-medium hover:underline">
            Back to people
          </Link>
        }
      />

      {notice ? (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Action failed">
          {error}
        </Alert>
      ) : null}

      {member.institutionalId || member.studentProfile ? (
        <section aria-labelledby="profile-heading" className="rounded-card border-border bg-surface shadow-card border p-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-border border-b pb-3">
            <div>
              <h2 id="profile-heading" className="text-ink text-lg font-semibold">
                Admission & Demographic Record
              </h2>
              <p className="text-ink-muted text-sm">
                Student identification and personal contact record on file.
              </p>
            </div>
            {member.institutionalId ? (
              <div className="flex items-center gap-2 bg-surface-muted px-3 py-1.5 rounded-lg border border-border">
                <span className="text-xs uppercase tracking-wide text-ink-muted font-medium">
                  Enrollment No:
                </span>
                <span className="font-mono font-bold text-brand-800 text-sm">
                  {member.institutionalId}
                </span>
              </div>
            ) : null}
          </div>

          {member.studentProfile ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-ink-muted block text-xs font-medium uppercase">Phone</span>
                <span className="text-ink font-medium">{member.studentProfile.phone ?? "—"}</span>
              </div>
              <div>
                <span className="text-ink-muted block text-xs font-medium uppercase">Date of Birth</span>
                <span className="text-ink font-medium">
                  {member.studentProfile.dateOfBirth
                    ? new Date(member.studentProfile.dateOfBirth).toISOString().slice(0, 10)
                    : "—"}
                </span>
              </div>
              <div>
                <span className="text-ink-muted block text-xs font-medium uppercase">Gender</span>
                <span className="text-ink font-medium">{member.studentProfile.gender ?? "—"}</span>
              </div>
              <div>
                <span className="text-ink-muted block text-xs font-medium uppercase">Parent / Guardian</span>
                <span className="text-ink font-medium">{member.studentProfile.guardianName ?? "—"}</span>
              </div>
              <div>
                <span className="text-ink-muted block text-xs font-medium uppercase">Guardian Phone</span>
                <span className="text-ink font-medium">{member.studentProfile.guardianPhone ?? "—"}</span>
              </div>
              <div className="sm:col-span-2 md:col-span-1">
                <span className="text-ink-muted block text-xs font-medium uppercase">Address</span>
                <span className="text-ink font-medium">
                  {[
                    member.studentProfile.address,
                    member.studentProfile.city,
                    member.studentProfile.state,
                    member.studentProfile.postalCode,
                  ]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </span>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="roles-heading" className="flex flex-col gap-4">
        <h2 id="roles-heading" className="text-ink text-lg font-semibold">
          Roles in {account.tenant.institutionName}
        </h2>

        {member.roles.length === 0 ? (
          <EmptyState
            title="No roles granted"
            description="This person can sign in but has no capabilities until a role is granted."
            titleAs="h3"
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {member.roles.map((role) => (
              <li
                key={role.assignmentId}
                className="rounded-card border-border bg-surface shadow-card flex flex-wrap items-center justify-between gap-3 border p-4"
              >
                <span className="text-ink text-sm font-medium">{role.roleName}</span>
                {canAssignRoles ? (
                  <form action={removeRoleAction}>
                    <input type="hidden" name="assignmentId" value={role.assignmentId} />
                    <input type="hidden" name="userId" value={member.userId} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <Button variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canAssignRoles && grantableRoles.length > 0 ? (
          <form
            action={assignRoleAction}
            className="rounded-card border-border bg-surface shadow-card flex flex-col gap-4 border p-4 sm:flex-row sm:items-end sm:p-6"
          >
            <input type="hidden" name="userId" value={member.userId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="flex-1">
              <Select id="grant-role" name="roleId" label="Grant a role" defaultValue="" required>
                <option value="" disabled>
                  Choose a role
                </option>
                {grantableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="shrink-0">
              <Button type="submit">Grant role</Button>
            </div>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="status-heading" className="flex flex-col gap-4">
        <h2 id="status-heading" className="text-ink text-lg font-semibold">
          Account status
        </h2>

        {!isDeactivated && canDeactivate && !isSelf ? (
          <form
            action={deactivateUserAction}
            className="rounded-card border-danger/30 bg-surface flex flex-col gap-4 border p-4 sm:p-6"
          >
            <input type="hidden" name="userId" value={member.userId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Textarea
              id="deactivate-reason"
              name="reason"
              label="Reason (optional)"
              hint="Recorded in the audit trail. Deactivation revokes every session and blocks sign-in immediately."
              maxLength={500}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="danger" type="submit">
                Deactivate account
              </Button>
              {isSelf ? (
                <span className="text-ink-muted text-sm">
                  You cannot deactivate your own account.
                </span>
              ) : null}
            </div>
          </form>
        ) : null}

        {isDeactivated && canReactivate ? (
          <form
            action={reactivateUserAction}
            className="rounded-card border-border bg-surface flex flex-col gap-4 border p-4 sm:p-6"
          >
            <input type="hidden" name="userId" value={member.userId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <p className="text-ink-muted text-sm">
              This account is deactivated. Reactivating restores sign-in and the institution
              membership.
            </p>
            <div>
              <Button type="submit">Reactivate account</Button>
            </div>
          </form>
        ) : null}

        {isDeactivated && !canReactivate ? (
          <Alert tone="info" title="Deactivated">
            This account is deactivated and cannot sign in.
          </Alert>
        ) : null}

        {isSelf && !isDeactivated ? (
          <p className="text-ink-muted text-sm">
            This is your own account. Deactivation must be performed by another administrator.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="audit-heading" className="flex flex-col gap-4">
        <h2 id="audit-heading" className="text-ink text-lg font-semibold">
          Recent activity
        </h2>
        {auditEvents.length === 0 ? (
          <EmptyState
            title="No recorded activity yet"
            description="Role changes, invitations, and status changes for this person appear here."
            titleAs="h3"
          />
        ) : (
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Audit events for this person</caption>
              <thead>
                <tr className="bg-surface-muted">
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-medium tracking-wide uppercase"
                  >
                    When
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-medium tracking-wide uppercase"
                  >
                    Action
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-medium tracking-wide uppercase"
                  >
                    By
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-medium tracking-wide uppercase"
                  >
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.map((event) => (
                  <tr key={event.id} className="border-border border-t">
                    <td className="text-ink-muted px-3 py-2 text-sm whitespace-nowrap">
                      {event.createdAt.toLocaleString("en-GB")}
                    </td>
                    <td className="text-ink px-3 py-2 text-sm font-medium">{event.action}</td>
                    <td className="text-ink-muted px-3 py-2 text-sm">
                      {event.actor?.name ?? "System"}
                    </td>
                    <td className="text-ink-muted px-3 py-2 text-sm">{event.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
