import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import type { AccountContext } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import {
  ConflictError,
  ResourceNotFoundError,
  TenantSelectionRequiredError,
  UnauthenticatedError,
} from "@/lib/errors";
import type { PermissionKey } from "@/lib/permissions/catalogue";

const TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));
export const SUPPORTED_LOCALES = ["en", "en-IN", "en-GB", "fr", "sw"] as const;

export const profileInputSchema = z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters.").max(120),
  timezone: z
    .string()
    .trim()
    .refine((value) => TIMEZONES.has(value), "Choose a valid IANA time zone."),
  locale: z.enum(SUPPORTED_LOCALES),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;

export const roleAssignmentInputSchema = z.object({
  userId: z.string().min(1),
  roleId: z.string().min(1),
});

export const deactivationInputSchema = z.object({
  userId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

export type MemberRole = {
  assignmentId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
};

export type MemberSummary = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED";
  accountStatus: "ACTIVE" | "INVITED" | "DEACTIVATED" | "LOCKED";
  joinedAt: Date | null;
  roles: MemberRole[];
};

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

/** Tenant-scoped member directory. Never returns rows from another tenant. */
export async function listMembers(
  account: AccountContext,
  options: { query?: string; limit?: number } = {},
  db: DatabaseClient = getDb(),
): Promise<MemberSummary[]> {
  requirePermission(account, "users.read");
  const tenantId = tenantIdOf(account);
  const query = options.query?.trim() ?? "";
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  const memberships = await db.tenantMembership.findMany({
    where: {
      tenantId,
      ...(query
        ? {
            user: {
              OR: [
                { email: { contains: query, mode: "insensitive" as const } },
                { name: { contains: query, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    },
    orderBy: [{ user: { name: "asc" } }],
    take: limit,
    select: {
      id: true,
      userId: true,
      status: true,
      joinedAt: true,
      user: {
        select: {
          name: true,
          email: true,
          status: true,
          roleAssignments: {
            where: { tenantId },
            select: {
              id: true,
              role: { select: { id: true, key: true, name: true } },
            },
          },
        },
      },
    },
  });

  return memberships.map((membership) => ({
    membershipId: membership.id,
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    status: membership.status,
    accountStatus: membership.user.status,
    joinedAt: membership.joinedAt,
    roles: membership.user.roleAssignments.map((assignment) => ({
      assignmentId: assignment.id,
      roleId: assignment.role.id,
      roleKey: assignment.role.key,
      roleName: assignment.role.name,
    })),
  }));
}

export async function getMember(
  account: AccountContext,
  userId: string,
  db: DatabaseClient = getDb(),
): Promise<MemberSummary> {
  requirePermission(account, "users.read");
  const tenantId = tenantIdOf(account);

  const membership = await db.tenantMembership.findFirst({
    where: { tenantId, userId },
    select: {
      id: true,
      userId: true,
      status: true,
      joinedAt: true,
      user: {
        select: {
          name: true,
          email: true,
          status: true,
          roleAssignments: {
            where: { tenantId },
            select: { id: true, role: { select: { id: true, key: true, name: true } } },
          },
        },
      },
    },
  });

  if (!membership)
    throw new ResourceNotFoundError("This person is not a member of your institution.");

  return {
    membershipId: membership.id,
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    status: membership.status,
    accountStatus: membership.user.status,
    joinedAt: membership.joinedAt,
    roles: membership.user.roleAssignments.map((assignment) => ({
      assignmentId: assignment.id,
      roleId: assignment.role.id,
      roleKey: assignment.role.key,
      roleName: assignment.role.name,
    })),
  };
}

/** Tenant roles that may be granted through the UI. Platform roles never appear. */
export async function listAssignableRoles(account: AccountContext, db: DatabaseClient = getDb()) {
  requirePermission(account, "users.read");
  const tenantId = tenantIdOf(account);
  return db.role.findMany({
    where: { tenantId, scope: "TENANT" },
    orderBy: { name: "asc" },
    select: { id: true, key: true, name: true },
  });
}

export async function updateOwnProfile(
  userId: string,
  rawInput: unknown,
  options: { requestId?: string; db?: DatabaseClient } = {},
): Promise<void> {
  const input = profileInputSchema.parse(rawInput);
  const db = options.db ?? getDb();

  const existing = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, timezone: true, locale: true, status: true },
  });
  if (!existing || existing.status !== "ACTIVE") throw new UnauthenticatedError();

  await db.$transaction(async (transaction) => {
    await transaction.user.update({
      where: { id: userId },
      data: { name: input.name, timezone: input.timezone, locale: input.locale },
    });
    await recordAuditEvent(transaction, {
      tenantId: null,
      actorUserId: userId,
      action: "profile.updated",
      resourceType: "user",
      resourceId: userId,
      before: { name: existing.name, timezone: existing.timezone, locale: existing.locale },
      after: input,
      requestId: options.requestId ?? null,
    });
  });
}

export async function assignRole(
  account: AccountContext,
  rawInput: unknown,
  options: { requestId?: string } = {},
): Promise<void> {
  requirePermission(account, "roles.assign");
  const tenantId = tenantIdOf(account);
  const { userId, roleId } = roleAssignmentInputSchema.parse(rawInput);
  const db = getDb();

  const role = await db.role.findFirst({
    where: { id: roleId, tenantId, scope: "TENANT" },
    select: { id: true, key: true, name: true },
  });
  if (!role) throw new ResourceNotFoundError("That role does not exist in this institution.");

  const membership = await db.tenantMembership.findFirst({
    where: { tenantId, userId },
    select: { id: true, status: true },
  });
  if (!membership)
    throw new ResourceNotFoundError("This person is not a member of your institution.");
  if (membership.status !== "ACTIVE") {
    throw new ConflictError("Activate this membership before granting roles.");
  }

  const existing = await db.userRoleAssignment.findFirst({
    where: { tenantId, userId, roleId, scopeType: "TENANT", scopeId: null },
    select: { id: true },
  });
  if (existing) return;

  await db.$transaction(async (transaction) => {
    await transaction.userRoleAssignment.create({
      data: {
        tenantId,
        userId,
        roleId,
        scopeType: "TENANT",
        grantedByUserId: account.user.id,
      },
    });
    await recordAuditEvent(transaction, {
      tenantId,
      actorUserId: account.user.id,
      action: "role.assigned",
      resourceType: "user",
      resourceId: userId,
      after: { roleId, roleKey: role.key, roleName: role.name },
      requestId: options.requestId ?? null,
    });
  });
}

export async function removeRole(
  account: AccountContext,
  assignmentId: string,
  options: { requestId?: string } = {},
): Promise<void> {
  requirePermission(account, "roles.assign");
  const tenantId = tenantIdOf(account);
  const db = getDb();

  const assignment = await db.userRoleAssignment.findFirst({
    where: { id: assignmentId, tenantId },
    select: {
      id: true,
      userId: true,
      roleId: true,
      role: { select: { key: true, name: true, scope: true } },
    },
  });
  if (!assignment || assignment.role.scope !== "TENANT") {
    throw new ResourceNotFoundError("That role assignment was not found.");
  }

  if (assignment.role.key === "institution_admin") {
    const remaining = await db.userRoleAssignment.count({
      where: {
        tenantId,
        roleId: assignment.roleId,
        id: { not: assignment.id },
        user: { status: "ACTIVE", memberships: { some: { tenantId, status: "ACTIVE" } } },
      },
    });
    if (remaining === 0) {
      throw new ConflictError(
        "At least one active institution administrator is required. Grant the role to someone else first.",
      );
    }
  }

  await db.$transaction(async (transaction) => {
    await transaction.userRoleAssignment.delete({ where: { id: assignment.id } });
    await recordAuditEvent(transaction, {
      tenantId,
      actorUserId: account.user.id,
      action: "role.removed",
      resourceType: "user",
      resourceId: assignment.userId,
      before: {
        roleId: assignment.roleId,
        roleKey: assignment.role.key,
        roleName: assignment.role.name,
      },
      requestId: options.requestId ?? null,
    });
  });
}

/**
 * Account deactivation. This is deliberately global (the user row and every
 * session), not a single-membership suspension, so it is refused while the
 * person still belongs to another active institution. Suspending one
 * membership is a later, distinct operation.
 */
export async function deactivateUser(
  account: AccountContext,
  rawInput: unknown,
  options: { requestId?: string } = {},
): Promise<void> {
  requirePermission(account, "users.deactivate");
  const tenantId = tenantIdOf(account);
  const { userId, reason } = deactivationInputSchema.parse(rawInput);
  if (userId === account.user.id) {
    throw new ConflictError("You cannot deactivate your own account.");
  }

  const db = getDb();
  const membership = await db.tenantMembership.findFirst({
    where: { tenantId, userId },
    select: {
      id: true,
      status: true,
      user: {
        select: {
          id: true,
          email: true,
          status: true,
          memberships: {
            where: { status: "ACTIVE", tenantId: { not: tenantId }, tenant: { status: "ACTIVE" } },
            select: { id: true },
          },
        },
      },
    },
  });
  if (!membership)
    throw new ResourceNotFoundError("This person is not a member of your institution.");

  if (membership.user.status === "DEACTIVATED") {
    throw new ConflictError("This account is already deactivated.");
  }
  if (membership.user.memberships.length > 0) {
    throw new ConflictError(
      "This account also belongs to another institution. Multi-institution account deactivation requires platform support and is not available yet.",
    );
  }

  await db.$transaction(async (transaction) => {
    await transaction.user.update({
      where: { id: userId },
      data: { status: "DEACTIVATED" },
    });
    await transaction.tenantMembership.update({
      where: { id: membership.id },
      data: { status: "SUSPENDED" },
    });
    // Revoke every session immediately; the session hook also blocks new ones.
    await transaction.session.deleteMany({ where: { userId } });
    await recordAuditEvent(transaction, {
      tenantId,
      actorUserId: account.user.id,
      action: "user.deactivated",
      resourceType: "user",
      resourceId: userId,
      before: { accountStatus: membership.user.status, membershipStatus: membership.status },
      after: { accountStatus: "DEACTIVATED", membershipStatus: "SUSPENDED" },
      reason: reason?.trim() || "Deactivated by an institution administrator.",
      requestId: options.requestId ?? null,
    });
  });
}

export async function reactivateUser(
  account: AccountContext,
  userId: string,
  options: { requestId?: string } = {},
): Promise<void> {
  requirePermission(account, "users.update");
  const tenantId = tenantIdOf(account);
  const db = getDb();

  const membership = await db.tenantMembership.findFirst({
    where: { tenantId, userId },
    select: { id: true, status: true, user: { select: { status: true } } },
  });
  if (!membership)
    throw new ResourceNotFoundError("This person is not a member of your institution.");
  if (membership.user.status === "ACTIVE" && membership.status === "ACTIVE") {
    throw new ConflictError("This account is already active.");
  }

  await db.$transaction(async (transaction) => {
    await transaction.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
    await transaction.tenantMembership.update({
      where: { id: membership.id },
      data: { status: "ACTIVE", joinedAt: new Date() },
    });
    await recordAuditEvent(transaction, {
      tenantId,
      actorUserId: account.user.id,
      action: "user.reactivated",
      resourceType: "user",
      resourceId: userId,
      before: {
        accountStatus: membership.user.status,
        membershipStatus: membership.status,
      },
      after: { accountStatus: "ACTIVE", membershipStatus: "ACTIVE" },
      requestId: options.requestId ?? null,
    });
  });
}

export async function listMemberAuditEvents(
  account: AccountContext,
  userId: string,
  db: DatabaseClient = getDb(),
) {
  requirePermission(account, "users.read");
  const tenantId = tenantIdOf(account);

  const membership = await db.tenantMembership.findFirst({
    where: { tenantId, userId },
    select: { id: true },
  });
  if (!membership) throw new ResourceNotFoundError();

  return db.auditEvent.findMany({
    where: { tenantId, resourceId: userId },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      action: true,
      createdAt: true,
      reason: true,
      actor: { select: { name: true, email: true } },
    },
  });
}

export function can(account: AccountContext, permission: PermissionKey): boolean {
  return account.permissions.has(permission);
}
