import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getDb } from "@/lib/db/client";
import { PermissionDeniedError } from "@/lib/errors";
import { isPermissionKey, type PermissionKey } from "@/lib/permissions/catalogue";
import { ROLES, type RoleKey } from "@/lib/navigation";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";

import { getSession } from "./session";

/** Chosen institution for users who belong to more than one. HttpOnly, tenant-authorized on read. */
export const ACTIVE_TENANT_COOKIE = "lms_active_institution";

export type TenantSummary = {
  tenantId: string;
  tenantName: string;
  institutionName: string;
  membershipId: string;
};

export type AccountContext = {
  sessionId: string;
  sessionExpiresAt: Date;
  user: {
    id: string;
    email: string;
    name: string;
    timezone: string;
    locale: string;
  };
  /** Active institution, when one is selected. */
  tenant: TenantSummary | null;
  /** Every active institution the user may switch to. */
  memberships: TenantSummary[];
  roleKeys: readonly string[];
  /** Effective permissions in the active tenant. Empty without a tenant. */
  permissions: ReadonlySet<PermissionKey>;
  /** Platform role grants. Platform roles confer no tenant-record access. */
  platformPermissions: ReadonlySet<PermissionKey>;
  isPlatformAdmin: boolean;
  navRole: RoleKey;
  homePath: string;
};

function navRoleFor(roleKeys: readonly string[], isPlatformAdmin: boolean): RoleKey {
  if (roleKeys.includes("institution_admin") || roleKeys.includes("academic_coordinator")) {
    return "institution_admin";
  }
  if (roleKeys.includes("faculty") || roleKeys.includes("teaching_assistant")) {
    return "faculty";
  }
  if (roleKeys.includes("student")) return "student";
  return isPlatformAdmin ? "platform_admin" : "student";
}

/** The session fields account resolution depends on. */
export type SessionInput = {
  session: { id: string; expiresAt: Date };
  user: { id: string };
};

/**
 * Resolves the full account context from a server-validated session. Exported
 * so integration tests exercise the real permission/tenancy assembly rather
 * than a hand-built approximation.
 */
export async function buildAccountContext(
  session: SessionInput,
  options: { activeTenantId?: string | null } = {},
): Promise<AccountContext | null> {
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      timezone: true,
      locale: true,
      memberships: {
        where: { status: "ACTIVE", tenant: { status: "ACTIVE" } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          tenantId: true,
          tenant: { select: { name: true, institution: { select: { name: true } } } },
        },
      },
      roleAssignments: {
        select: {
          tenantId: true,
          role: {
            select: {
              key: true,
              scope: true,
              permissions: { select: { permissionKey: true } },
            },
          },
        },
      },
    },
  });

  // A session can outlive a status change for a moment; reject it defensively.
  if (!user || user.status !== "ACTIVE") return null;

  const memberships: TenantSummary[] = user.memberships.map((membership) => ({
    tenantId: membership.tenantId,
    membershipId: membership.id,
    tenantName: membership.tenant.name,
    institutionName: membership.tenant.institution?.name ?? membership.tenant.name,
  }));

  const requestedTenantId =
    options.activeTenantId !== undefined
      ? options.activeTenantId
      : (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  const tenant =
    memberships.find((membership) => membership.tenantId === requestedTenantId) ??
    (memberships.length === 1 ? memberships[0] : null) ??
    null;

  const permissions = new Set<PermissionKey>();
  const platformPermissions = new Set<PermissionKey>();
  const roleKeys = new Set<string>();

  for (const assignment of user.roleAssignments) {
    const { role } = assignment;
    if (tenant && role.scope === "TENANT" && assignment.tenantId === tenant.tenantId) {
      roleKeys.add(role.key);
      for (const { permissionKey } of role.permissions) {
        if (isPermissionKey(permissionKey)) permissions.add(permissionKey);
      }
    }
    if (role.scope === "PLATFORM" && assignment.tenantId === null) {
      for (const { permissionKey } of role.permissions) {
        if (isPermissionKey(permissionKey)) platformPermissions.add(permissionKey);
      }
    }
  }

  const isPlatformAdmin = user.roleAssignments.some(
    (assignment) => assignment.role.scope === "PLATFORM" && assignment.tenantId === null,
  );

  const navRole = navRoleFor([...roleKeys], isPlatformAdmin);
  const homePath = tenant ? ROLES[navRole].dashboardPath : "/platform";

  return {
    sessionId: session.session.id,
    sessionExpiresAt: session.session.expiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      timezone: user.timezone,
      locale: user.locale,
    },
    tenant,
    memberships,
    roleKeys: [...roleKeys],
    permissions,
    platformPermissions,
    isPlatformAdmin,
    navRole,
    homePath,
  };
}

/** Deduplicated per request so layout and page do not repeat the queries. */
export const getAccountContext = cache(async (): Promise<AccountContext | null> => {
  const session = await getSession();
  if (!session?.user) return null;
  return buildAccountContext(session);
});

export async function requireAccountContext(): Promise<AccountContext> {
  const account = await getAccountContext();
  if (!account) redirect("/sign-in");
  return account;
}

export function requirePermission(account: AccountContext, permission: PermissionKey): void {
  if (!account.permissions.has(permission)) {
    throw new PermissionDeniedError(`Missing permission: ${permission}.`);
  }
}

export function requirePlatformPermission(
  account: AccountContext,
  permission: PermissionKey,
): void {
  if (!account.platformPermissions.has(permission)) {
    throw new PermissionDeniedError(`Missing permission: ${permission}.`);
  }
}

/** Request ID attached to audit rows by proxy.ts. Never client-supplied blindly. */
export async function currentRequestId(): Promise<string> {
  const requestHeaders = await headers();
  return requestHeaders.get(REQUEST_ID_HEADER) ?? "unknown";
}
