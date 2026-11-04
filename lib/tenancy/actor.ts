import type { DatabaseClient } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import {
  ResourceNotFoundError,
  TenantAccessDeniedError,
  TenantSelectionRequiredError,
  UnauthenticatedError,
} from "@/lib/errors";
import { isPermissionKey, type PermissionKey } from "@/lib/permissions/catalogue";

export type ActorContext = {
  userId: string;
  tenantId: string;
  membershipId: string;
  permissions: ReadonlySet<PermissionKey>;
  requestId: string;
};

/**
 * Resolves the request actor from an authenticated user ID (supplied by the
 * session layer in Phase 3) plus an explicitly selected tenant.
 *
 * - The user must exist and be ACTIVE.
 * - The tenant membership must be ACTIVE and the tenant must be ACTIVE.
 * - When the user belongs to exactly one active tenant and no tenant is
 *   selected, that tenant is used. Multiple active tenants require an explicit
 *   selection; the caller must never guess from a URL or request body.
 * - Permissions come only from tenant-scoped role assignments inside the
 *   selected tenant. Platform roles grant no access to tenant records.
 */
export async function resolveActor({
  userId,
  activeTenantId,
  requestId,
  db = getDb(),
}: {
  userId: string;
  activeTenantId?: string | null;
  requestId: string;
  db?: DatabaseClient;
}): Promise<ActorContext> {
  const user = await db.user.findFirst({
    where: { id: userId, status: "ACTIVE" },
    select: {
      id: true,
      memberships: {
        where: { status: "ACTIVE", tenant: { status: "ACTIVE" } },
        select: { id: true, tenantId: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!user) throw new UnauthenticatedError();

  const memberships = user.memberships;
  if (memberships.length === 0) {
    throw new TenantAccessDeniedError("No active institution membership.");
  }

  let membership = memberships[0];
  if (memberships.length > 1) {
    if (!activeTenantId) throw new TenantSelectionRequiredError();
    membership = memberships.find((candidate) => candidate.tenantId === activeTenantId);
  } else if (activeTenantId) {
    const selected = memberships.find((candidate) => candidate.tenantId === activeTenantId);
    if (!selected) throw new TenantAccessDeniedError();
    membership = selected;
  }

  if (!membership) throw new TenantAccessDeniedError();

  const assignments = await db.userRoleAssignment.findMany({
    where: {
      userId: user.id,
      tenantId: membership.tenantId,
      role: { scope: "TENANT" },
    },
    select: {
      role: {
        select: {
          permissions: { select: { permissionKey: true } },
        },
      },
    },
  });

  const permissions = new Set<PermissionKey>();
  for (const assignment of assignments) {
    for (const { permissionKey } of assignment.role.permissions) {
      if (isPermissionKey(permissionKey)) {
        permissions.add(permissionKey);
      }
      // Unknown keys can only come from manual database edits; they grant
      // nothing because checks compare against the code-owned catalogue.
    }
  }

  return {
    userId: user.id,
    tenantId: membership.tenantId,
    membershipId: membership.id,
    permissions,
    requestId,
  };
}

/**
 * Guards a resource belonging to a tenant. Cross-tenant identifiers are
 * reported as missing rather than forbidden.
 */
export function assertTenantResource(
  actor: ActorContext,
  resourceTenantId: string | null | undefined,
): void {
  if (!resourceTenantId || resourceTenantId !== actor.tenantId) {
    throw new ResourceNotFoundError();
  }
}
