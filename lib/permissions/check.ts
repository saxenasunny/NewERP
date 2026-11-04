import { PermissionDeniedError } from "@/lib/errors";
import type { PermissionKey } from "@/lib/permissions/catalogue";
import type { ActorContext } from "@/lib/tenancy/actor";

export function hasPermission(actor: ActorContext, permission: PermissionKey): boolean {
  return actor.permissions.has(permission);
}

export function hasAnyPermission(
  actor: ActorContext,
  permissions: readonly PermissionKey[],
): boolean {
  return permissions.some((permission) => actor.permissions.has(permission));
}

/** Deny-by-default server check. Never rely on hidden UI as the control. */
export function requirePermission(actor: ActorContext, permission: PermissionKey): void {
  if (!hasPermission(actor, permission)) {
    throw new PermissionDeniedError(`Missing permission: ${permission}.`);
  }
}
