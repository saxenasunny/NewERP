import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import {
  listPendingInvitations,
  type InvitationSummary,
} from "@/modules/identity/invitation-service";
import {
  listAssignableRoles,
  listMembers,
  type MemberSummary,
} from "@/modules/identity/user-service";

import {
  inviteUserAction,
  resendInvitationAction,
  revokeInvitationAction,
} from "./actions";

export const metadata: Metadata = { title: "People" };

const STATUS_TONES: Record<MemberSummary["accountStatus"], BadgeTone> = {
  ACTIVE: "success",
  INVITED: "info",
  DEACTIVATED: "danger",
  LOCKED: "danger",
};

function statusLabel(member: MemberSummary): string {
  if (member.accountStatus === "DEACTIVATED") return "Deactivated";
  if (member.accountStatus === "LOCKED") return "Locked";
  if (member.accountStatus === "INVITED") return "Invited";
  return member.status === "ACTIVE" ? "Active" : "Suspended";
}

function InvitationRow({
  invitation,
  returnTo,
}: {
  invitation: InvitationSummary;
  returnTo: string;
}) {
  return (
    <tr className="border-border border-t">
      <td className="text-ink px-3 py-2 text-sm">{invitation.email}</td>
      <td className="text-ink-muted px-3 py-2 text-sm">{invitation.roleName}</td>
      <td className="text-ink-muted px-3 py-2 text-sm">
        {invitation.expiresAt.toLocaleDateString("en-GB")}
      </td>
      <td className="px-3 py-2 text-right space-x-2">
        <form action={resendInvitationAction} className="inline-flex">
          <input type="hidden" name="email" value={invitation.email} />
          <input type="hidden" name="roleId" value={invitation.roleId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button variant="secondary" size="sm">
            Resend / Get Link
          </Button>
        </form>
        <form action={revokeInvitationAction} className="inline-flex">
          <input type="hidden" name="invitationId" value={invitation.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button variant="ghost" size="sm">
            Revoke
          </Button>
        </form>
      </td>
    </tr>
  );
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  if (!account.tenant) redirect(account.homePath);

  const { q, notice, error } = await searchParams;
  const returnTo = `/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`;

  if (!account.permissions.has("users.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow={account.tenant.institutionName}
          title="People"
          description="The institution directory is restricted to administrators."
        />
        <PermissionDenied message="Your role cannot view the institution directory. Ask an institution administrator if you need access." />
      </div>
    );
  }

  const canCreate = account.permissions.has("users.create");
  const query = q?.trim() ?? "";

  const [members, invitations, roles] = await Promise.all([
    listMembers(account, { query, limit: 100 }),
    canCreate ? listPendingInvitations(account) : Promise.resolve([]),
    canCreate ? listAssignableRoles(account) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs items={[{ label: "Overview", href: "/admin" }, { label: "People" }]} />
      <PageHeader
        eyebrow={account.tenant.institutionName}
        title="People"
        description="Members of this institution, their roles, and pending invitations."
      />

      {notice ? (
        <Alert tone="success" title="Done">
          {notice.includes("http") ? (
            <div className="flex flex-col gap-2 mt-1">
              <p>{notice.split("http")[0]}</p>
              <div className="flex items-center gap-2 rounded bg-surface p-2 border border-border text-xs">
                <input
                  type="text"
                  readOnly
                  value={`http${notice.split("http")[1]}`}
                  className="w-full bg-transparent font-mono select-all focus:outline-none"
                />
                <a
                  href={`http${notice.split("http")[1]}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-800 font-semibold hover:underline shrink-0"
                >
                  Open Link ↗
                </a>
              </div>
            </div>
          ) : (
            notice
          )}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Action failed">
          {error}
        </Alert>
      ) : null}

      {canCreate ? (
        <section aria-labelledby="invite-heading" className="flex flex-col gap-4">
          <h2 id="invite-heading" className="text-ink text-lg font-semibold">
            Invite someone
          </h2>
          <form
            action={inviteUserAction}
            className="rounded-card border-border bg-surface shadow-card flex flex-col gap-4 border p-4 sm:flex-row sm:items-end sm:p-6"
          >
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="flex-1">
              <Input
                id="invite-email"
                name="email"
                type="email"
                label="Email address"
                placeholder="person@institution.edu"
                autoComplete="email"
                required
              />
            </div>
            <div className="flex-1">
              <Select id="invite-role" name="roleId" label="Role" defaultValue="" required>
                <option value="" disabled>
                  Choose a role
                </option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="shrink-0">
              <Button type="submit">Send invitation</Button>
            </div>
          </form>
          <p className="text-ink-muted text-sm">
            The invitation link is single-use and expires in 7 days. When email delivery (e.g. Resend) is configured, the invitation is emailed automatically. You can also view recent email activity in the{" "}
            <Link href="/dev/mail" className="text-brand-800 font-medium hover:underline">
              System Outbox
            </Link>
            .
          </p>
        </section>
      ) : null}

      {canCreate && invitations.length > 0 ? (
        <section aria-labelledby="invitations-heading" className="flex flex-col gap-3">
          <h2 id="invitations-heading" className="text-ink text-lg font-semibold">
            Pending invitations
          </h2>
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Invitations that have not been accepted</caption>
              <thead>
                <tr className="bg-surface-muted">
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-medium tracking-wide uppercase"
                  >
                    Email
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-medium tracking-wide uppercase"
                  >
                    Role
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-medium tracking-wide uppercase"
                  >
                    Expires
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <InvitationRow key={invitation.id} invitation={invitation} returnTo={returnTo} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <h2 id="members-heading" className="text-ink text-lg font-semibold">
          Members
        </h2>

        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Input
              id="member-search"
              name="q"
              type="search"
              label="Search"
              placeholder="Name or email"
              defaultValue={query}
            />
          </div>
          <Button variant="secondary" type="submit">
            Search
          </Button>
        </form>

        {members.length === 0 ? (
          <EmptyState
            title={query ? "No members match your search" : "No members yet"}
            description={
              query
                ? "Try a different name or email address."
                : "Invite the first person to this institution to get started."
            }
          />
        ) : (
          <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Members of this institution</caption>
              <thead>
                <tr className="bg-surface-muted">
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-medium tracking-wide uppercase"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-medium tracking-wide uppercase"
                  >
                    Enrollment No.
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-medium tracking-wide uppercase"
                  >
                    Email
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-medium tracking-wide uppercase"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="text-ink-muted px-3 py-2 text-xs font-medium tracking-wide uppercase"
                  >
                    Roles
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.userId} className="border-border border-t">
                    <td className="text-ink px-3 py-2 text-sm font-medium">{member.name}</td>
                    <td className="text-ink-muted px-3 py-2 text-sm font-mono">
                      {member.institutionalId ?? "—"}
                    </td>
                    <td className="text-ink-muted px-3 py-2 text-sm">{member.email}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={STATUS_TONES[member.accountStatus]}>
                        {statusLabel(member)}
                      </StatusBadge>
                    </td>
                    <td className="text-ink-muted px-3 py-2 text-sm">
                      {member.roles.length > 0
                        ? member.roles.map((role) => role.roleName).join(", ")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/admin/users/${member.userId}`}
                        className="text-brand-800 text-sm font-medium hover:underline"
                      >
                        Manage
                      </Link>
                    </td>
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
