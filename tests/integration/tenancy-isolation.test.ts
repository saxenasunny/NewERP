import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  PermissionDeniedError,
  ResourceNotFoundError,
  TenantAccessDeniedError,
  TenantSelectionRequiredError,
  UnauthenticatedError,
} from "@/lib/errors";
import { resolveActor, type ActorContext } from "@/lib/tenancy/actor";
import {
  getInstitutionById,
  getMember,
  listMembers,
  updateInstitutionProfile,
} from "@/modules/tenancy/institution-service";

import {
  createTenantFixture,
  disconnectTestDb,
  integrationDatabaseUrl,
  resetDatabase,
  seedPermissions,
  testDb,
  type TenantFixture,
} from "./helpers/database";

const databaseAvailable = Boolean(integrationDatabaseUrl());

if (!databaseAvailable) {
  console.warn(
    "Skipping tenant isolation tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
  );
}

const describeDb = describe.skipIf(!databaseAvailable);

describeDb("tenant isolation and authorization (PostgreSQL)", () => {
  let alpha: TenantFixture;
  let beta: TenantFixture;

  beforeEach(async () => {
    await resetDatabase();
    await seedPermissions();
    alpha = await createTenantFixture({
      slug: "alpha",
      name: "Alpha University",
      code: "ALP",
    });
    beta = await createTenantFixture({
      slug: "beta",
      name: "Beta College",
      code: "BET",
    });
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  async function actorFor(
    fixture: TenantFixture,
    member: "admin" | "faculty" | "student" = "admin",
  ): Promise<ActorContext> {
    return resolveActor({
      userId: fixture[member].userId,
      activeTenantId: fixture.tenantId,
      requestId: "test-request-id",
    });
  }

  describe("actor resolution", () => {
    it("resolves the sole active membership when no tenant is selected", async () => {
      const actor = await resolveActor({
        userId: alpha.admin.userId,
        requestId: "req-sole",
      });

      expect(actor.tenantId).toBe(alpha.tenantId);
      expect(actor.membershipId).toBe(alpha.admin.membershipId);
      expect(actor.permissions.has("institution.settings.manage")).toBe(true);
      expect(actor.permissions.has("users.read")).toBe(true);
      expect(actor.requestId).toBe("req-sole");
    });

    it("requires an explicit selection when the user belongs to several tenants", async () => {
      const studentRole = await testDb().role.findFirstOrThrow({
        where: { tenantId: beta.tenantId, key: "student" },
      });
      await testDb().tenantMembership.create({
        data: { tenantId: beta.tenantId, userId: alpha.admin.userId, status: "ACTIVE" },
      });
      await testDb().userRoleAssignment.create({
        data: {
          tenantId: beta.tenantId,
          userId: alpha.admin.userId,
          roleId: studentRole.id,
          scopeType: "TENANT",
        },
      });

      await expect(
        resolveActor({ userId: alpha.admin.userId, requestId: "req-multi" }),
      ).rejects.toBeInstanceOf(TenantSelectionRequiredError);

      const betaActor = await resolveActor({
        userId: alpha.admin.userId,
        activeTenantId: beta.tenantId,
        requestId: "req-multi",
      });
      expect(betaActor.tenantId).toBe(beta.tenantId);
      expect(betaActor.permissions.has("institution.settings.manage")).toBe(false);
      expect(betaActor.permissions.has("submissions.submit")).toBe(true);
    });

    it("denies a tenant the user is not an active member of", async () => {
      await expect(
        resolveActor({
          userId: alpha.admin.userId,
          activeTenantId: beta.tenantId,
          requestId: "req-foreign",
        }),
      ).rejects.toBeInstanceOf(TenantAccessDeniedError);
    });

    it("denies deactivated users, suspended memberships, and suspended tenants", async () => {
      await testDb().user.update({
        where: { id: alpha.admin.userId },
        data: { status: "DEACTIVATED" },
      });
      await expect(
        resolveActor({ userId: alpha.admin.userId, requestId: "req-inactive" }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);

      await testDb().user.update({
        where: { id: alpha.faculty.userId },
        data: { status: "ACTIVE" },
      });
      await testDb().tenantMembership.update({
        where: { id: alpha.faculty.membershipId },
        data: { status: "SUSPENDED" },
      });
      await expect(
        resolveActor({ userId: alpha.faculty.userId, requestId: "req-suspended-member" }),
      ).rejects.toBeInstanceOf(TenantAccessDeniedError);

      const suspended = await createTenantFixture({
        slug: "suspended",
        name: "Suspended Institute",
        code: "SUS",
        status: "SUSPENDED",
      });
      await expect(
        resolveActor({ userId: suspended.admin.userId, requestId: "req-suspended-tenant" }),
      ).rejects.toBeInstanceOf(TenantAccessDeniedError);
    });

    it("does not grant tenant permissions from a platform role", async () => {
      const platformRole = await testDb().role.create({
        data: {
          tenantId: null,
          key: "platform_super_admin",
          name: "Platform super admin",
          scope: "PLATFORM",
          isSystem: true,
          permissions: { create: [{ permissionKey: "tenant.manage" }] },
        },
      });
      await testDb().userRoleAssignment.create({
        data: {
          tenantId: null,
          userId: alpha.admin.userId,
          roleId: platformRole.id,
          scopeType: "PLATFORM",
        },
      });

      const actor = await actorFor(alpha);
      expect(actor.permissions.has("tenant.manage")).toBe(false);
      expect(actor.permissions.has("institution.settings.manage")).toBe(true);
    });
  });

  describe("institution reads and writes", () => {
    it("reads an institution inside the actor's tenant", async () => {
      const actor = await actorFor(alpha);
      const institution = await getInstitutionById(actor, alpha.institutionId);
      expect(institution.name).toBe("Alpha University");
    });

    it("reports a foreign institution ID as missing", async () => {
      const actor = await actorFor(beta);
      await expect(getInstitutionById(actor, alpha.institutionId)).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });

    it("refuses a cross-tenant update and leaves the record untouched", async () => {
      const betaActor = await actorFor(beta);

      await expect(
        updateInstitutionProfile(betaActor, alpha.institutionId, {
          name: "Hijacked University",
          code: "HJK",
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);

      const unchanged = await testDb().institution.findUniqueOrThrow({
        where: { id: alpha.institutionId },
      });
      expect(unchanged.name).toBe("Alpha University");
      expect(unchanged.code).toBe("ALP");

      const auditCount = await testDb().auditEvent.count({
        where: { tenantId: beta.tenantId, action: "institution.profile.updated" },
      });
      expect(auditCount).toBe(0);
    });

    it("updates its own institution and writes an audit event atomically", async () => {
      const actor = await actorFor(alpha);

      const updated = await updateInstitutionProfile(actor, alpha.institutionId, {
        name: "Alpha University of Science",
        code: "AUS",
      });

      expect(updated.name).toBe("Alpha University of Science");

      const audit = await testDb().auditEvent.findFirstOrThrow({
        where: { tenantId: alpha.tenantId, action: "institution.profile.updated" },
      });
      expect(audit.actorUserId).toBe(alpha.admin.userId);
      expect(audit.resourceId).toBe(alpha.institutionId);
      expect(audit.requestId).toBe("test-request-id");
      expect(audit.before).toMatchObject({ name: "Alpha University", code: "ALP" });
      expect(audit.after).toMatchObject({ name: "Alpha University of Science", code: "AUS" });
    });

    it("denies faculty and students the settings.manage permission", async () => {
      const facultyActor = await actorFor(alpha, "faculty");
      await expect(
        updateInstitutionProfile(facultyActor, alpha.institutionId, {
          name: "Nope",
          code: "NO",
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      const studentActor = await actorFor(alpha, "student");
      await expect(listMembers(studentActor, {})).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it("validates input before writing", async () => {
      const actor = await actorFor(alpha);
      await expect(
        updateInstitutionProfile(actor, alpha.institutionId, { name: "", code: "A" }),
      ).rejects.toThrowError();
    });
  });

  describe("member directory", () => {
    it("lists only members of the actor's tenant", async () => {
      const actor = await actorFor(alpha);
      const result = await listMembers(actor, { limit: 50 });

      expect(result.items).toHaveLength(3);
      const emails = result.items.map((member) => member.user.email);
      expect(emails.every((email) => email.endsWith("@alpha.example"))).toBe(true);
      expect(emails.some((email) => email.endsWith("@beta.example"))).toBe(false);
    });

    it("paginates without leaking rows", async () => {
      const actor = await actorFor(alpha);
      const first = await listMembers(actor, { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).toBeTruthy();

      const second = await listMembers(actor, { limit: 2, cursor: first.nextCursor ?? undefined });
      expect(second.items).toHaveLength(1);
      expect(second.hasMore).toBe(false);
      const ids = [...first.items, ...second.items].map((item) => item.id);
      expect(new Set(ids).size).toBe(3);
    });

    it("returns a foreign membership ID as missing", async () => {
      const actor = await actorFor(beta);
      await expect(getMember(actor, alpha.admin.membershipId)).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });
  });
});
