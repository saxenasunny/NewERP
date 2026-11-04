# ADR 0002 — Tenant isolation and authorization

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

The platform hosts multiple institutions. A defect that lets one institution read
or mutate another's records is a critical security incident, not a UI bug. The
specification requires automated cross-tenant tests and server-side permission
checks on every protected operation.

## Decision

### Identity and membership

- `users` is global (a person may belong to more than one institution).
- `tenant_memberships` links a user to a tenant with a status
  (`invited`, `active`, `suspended`).
- `roles` are tenant-scoped (platform roles have a null tenant); a role carries
  permissions from a code-owned catalogue.
- `user_role_assignments` grant a role with an optional scope
  (`tenant`, `department`, `programme`, `course_offering`). Course access is also
  derived from `course_instructors` / `enrolments`; a role alone never grants a
  specific course.

### Request-scoped actor

The authenticated session resolves an `ActorContext`:

```ts
type ActorContext = {
  userId: string;
  tenantId: string;
  membershipId: string;
  permissions: ReadonlySet<PermissionKey>;
  requestId: string;
};
```

The active tenant is stored server-side in the session (or selected through a
validated membership switch). It is **never** read from a request body, query
parameter, or client header. Services accept the actor explicitly; there is no
ambient "current tenant" global that a request could mutate.

### Two-part checks

1. **Permission** — `requirePermission(actor, "grades.update")` throws a typed
   `PermissionDeniedError` (HTTP 403) when absent.
2. **Resource scope** — services load the target row with `where: { id, tenantId:
actor.tenantId }`. A row in another tenant yields **404**, not 403, so the
   response does not confirm the record exists. Course-scoped operations
   additionally verify instructor/enrolment assignment.

Platform super-admins do **not** get implicit access to tenant learning data.
Support access, if ever added, must be an explicit, time-boxed, audited grant.

### Database enforcement

- Every tenant-owned table has a non-null `tenant_id` with an index, even when it
  is derivable through a parent.
- Composite foreign keys `(id, tenant_id)` are used where PostgreSQL allows them,
  preventing a child row from referencing a parent in another tenant.
- Unique constraints include `tenant_id` (for example, course code unique per
  tenant).
- Cross-tenant integrity is verified in integration tests that manipulate IDs
  directly.

### Tests

Every tenant-owned service ships with tests for:

- allowed access inside the tenant,
- denied read and write using a valid ID from another tenant,
- permission denial for a same-tenant user lacking the capability.

The Phase 2 suite establishes the harness; later phases extend it.

## Consequences

- Queries are slightly more verbose (explicit `tenantId` filters) in exchange for
  a reviewable, uniform isolation rule.
- Background jobs and scripts must construct an explicit actor or a system
  principal; they cannot bypass the service layer silently.
- A user switching institutions gets a new session context; caches (if any are
  ever added) must be keyed by tenant.
