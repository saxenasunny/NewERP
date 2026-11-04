import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { ResourceNotFoundError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions/check";
import type { ActorContext } from "@/lib/tenancy/actor";

export const institutionProfileSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(120),
  code: z
    .string()
    .trim()
    .min(2, "Code must be at least 2 characters.")
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, "Code may contain letters, digits, and hyphens only."),
});

export type InstitutionProfileInput = z.input<typeof institutionProfileSchema>;

/** Reads the actor's own institution. */
export async function getInstitution(actor: ActorContext, db: DatabaseClient = getDb()) {
  requirePermission(actor, "institution.settings.read");

  const institution = await db.institution.findUnique({ where: { tenantId: actor.tenantId } });
  if (!institution) throw new ResourceNotFoundError("Institution not found.");
  return institution;
}

/**
 * Loads by ID inside the actor's tenant. A valid ID from another tenant is
 * indistinguishable from a missing record.
 */
export async function getInstitutionById(
  actor: ActorContext,
  institutionId: string,
  db: DatabaseClient = getDb(),
) {
  requirePermission(actor, "institution.settings.read");

  const institution = await db.institution.findFirst({
    where: { id: institutionId, tenantId: actor.tenantId },
  });
  if (!institution) throw new ResourceNotFoundError();
  return institution;
}

/**
 * Updates name and code and appends an audit event in the same transaction.
 * The update is scoped by tenant at read time; the primary key alone is never
 * trusted from the caller.
 */
export async function updateInstitutionProfile(
  actor: ActorContext,
  institutionId: string,
  input: InstitutionProfileInput,
  db: DatabaseClient = getDb(),
) {
  requirePermission(actor, "institution.settings.manage");
  const data = institutionProfileSchema.parse(input);

  return db.$transaction(async (tx) => {
    const existing = await tx.institution.findFirst({
      where: { id: institutionId, tenantId: actor.tenantId },
    });
    if (!existing) throw new ResourceNotFoundError();

    const updated = await tx.institution.update({
      where: { id: existing.id },
      data: { name: data.name, code: data.code },
    });

    await recordAuditEvent(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "institution.profile.updated",
      resourceType: "institution",
      resourceId: existing.id,
      before: { name: existing.name, code: existing.code },
      after: { name: updated.name, code: updated.code },
      requestId: actor.requestId,
    });

    return updated;
  });
}

export const memberListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["INVITED", "ACTIVE", "SUSPENDED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});

export type MemberListQuery = z.input<typeof memberListSchema>;

/** Paginated, tenant-scoped member directory. Requires users.read. */
export async function listMembers(
  actor: ActorContext,
  query: MemberListQuery = {},
  db: DatabaseClient = getDb(),
) {
  requirePermission(actor, "users.read");
  const { search, status, limit, cursor } = memberListSchema.parse(query);

  const rows = await db.tenantMembership.findMany({
    where: {
      tenantId: actor.tenantId,
      ...(status ? { status } : {}),
      ...(search
        ? {
            user: {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    },
    select: {
      id: true,
      status: true,
      joinedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          roleAssignments: {
            where: { tenantId: actor.tenantId, role: { scope: "TENANT" } },
            select: { role: { select: { key: true, name: true } } },
          },
        },
      },
    },
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: page.map((row) => ({
      id: row.id,
      status: row.status,
      joinedAt: row.joinedAt,
      user: {
        id: row.user.id,
        name: row.user.name,
        email: row.user.email,
        status: row.user.status,
      },
      roles: row.user.roleAssignments.map((assignment) => assignment.role),
    })),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    hasMore,
  };
}

/** Loads a membership inside the actor's tenant, or reports it missing. */
export async function getMember(
  actor: ActorContext,
  membershipId: string,
  db: DatabaseClient = getDb(),
) {
  requirePermission(actor, "users.read");

  const membership = await db.tenantMembership.findFirst({
    where: { id: membershipId, tenantId: actor.tenantId },
    select: {
      id: true,
      status: true,
      joinedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          roleAssignments: {
            where: { tenantId: actor.tenantId, role: { scope: "TENANT" } },
            select: { role: { select: { key: true, name: true } } },
          },
        },
      },
    },
  });
  if (!membership) throw new ResourceNotFoundError();

  const { roleAssignments, ...user } = membership.user;
  return {
    id: membership.id,
    status: membership.status,
    joinedAt: membership.joinedAt,
    user,
    roles: roleAssignments.map((assignment) => assignment.role),
  };
}
