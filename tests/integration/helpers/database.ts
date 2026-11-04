import { disconnectDb, getDb, type DatabaseClient } from "@/lib/db/client";
import { PERMISSIONS, TENANT_ROLES, type PermissionKey } from "@/lib/permissions/catalogue";

/**
 * Integration tests are destructive (they truncate tables). They only run
 * against a database whose name ends in `_test`, so a misconfigured
 * environment cannot wipe development data.
 */
export function integrationDatabaseUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const databaseName = new URL(url).pathname.replace(/^\//, "");
    return databaseName.endsWith("_test") ? url : null;
  } catch {
    return null;
  }
}

export function testDb(): DatabaseClient {
  if (!integrationDatabaseUrl()) {
    throw new Error(
      "Integration tests require a PostgreSQL database whose name ends in `_test` (set TEST_DATABASE_URL).",
    );
  }
  return getDb();
}

export async function disconnectTestDb(): Promise<void> {
  await disconnectDb();
}

/** Removes all rows. Permissions are re-seeded by `seedPermissions`. */
export async function resetDatabase(): Promise<void> {
  const db = testDb();
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "webhook_events", "audit_events", "certificates", "outcome_mappings", "assessment_outcome_mappings", "course_outcomes", "programme_outcomes", "attainment_policies", "learning_events", "grade_change_events", "grade_feedback", "rubric_criterion_scores", "grades", "submission_file_links", "submission_text_versions", "assignment_submissions", "rubric_criteria", "assignments", "content_progress", "content_items", "module_prerequisites", "course_modules", "import_rows", "import_jobs", "enrolments", "course_instructors", "course_offerings", "courses", "cohort_members", "sections", "cohorts", "programmes", "departments", "terms", "academic_years", "invitations", "email_messages", "direct_messages", "notification_deliveries", "notification_preferences", "notifications", "rate_limit_buckets", "sessions", "accounts", "verifications", "user_role_assignments", "role_permissions", "roles", "tenant_memberships", "institutions", "tenants", "users", "permissions" RESTART IDENTITY CASCADE',
  );
}

export async function seedPermissions(): Promise<void> {
  await testDb().permission.createMany({
    data: PERMISSIONS.map((permission) => ({
      key: permission.key,
      description: permission.description,
    })),
  });
}

export type TenantFixture = {
  tenantId: string;
  institutionId: string;
  slug: string;
  admin: { userId: string; membershipId: string };
  faculty: { userId: string; membershipId: string };
  student: { userId: string; membershipId: string };
};

async function createRole(tenantId: string, roleKey: string) {
  const definition = TENANT_ROLES.find((role) => role.key === roleKey);
  if (!definition) throw new Error(`Unknown role: ${roleKey}`);

  return testDb().role.create({
    data: {
      tenantId,
      key: definition.key,
      name: definition.name,
      scope: "TENANT",
      isSystem: true,
      permissions: {
        create: definition.permissions.map((permissionKey: PermissionKey) => ({ permissionKey })),
      },
    },
  });
}

async function createMember(
  tenantId: string,
  slug: string,
  roleKey: string,
  label: string,
  status: "ACTIVE" | "SUSPENDED" = "ACTIVE",
) {
  const user = await testDb().user.create({
    data: {
      email: `${label}@${slug}.example`,
      name: `${label} ${slug}`,
      status: "ACTIVE",
      emailVerified: true,
    },
  });
  const membership = await testDb().tenantMembership.create({
    data: { tenantId, userId: user.id, status, joinedAt: new Date() },
  });
  const role = await testDb().role.findFirstOrThrow({ where: { tenantId, key: roleKey } });
  await testDb().userRoleAssignment.create({
    data: { tenantId, userId: user.id, roleId: role.id, scopeType: "TENANT" },
  });
  return { userId: user.id, membershipId: membership.id };
}

/** Creates an active tenant with institution, roles, and one member per role. */
export async function createTenantFixture(params: {
  slug: string;
  name: string;
  code: string;
  status?: "ACTIVE" | "SUSPENDED";
}): Promise<TenantFixture> {
  const db = testDb();
  const tenant = await db.tenant.create({
    data: {
      slug: params.slug,
      name: params.name,
      status: params.status ?? "ACTIVE",
      timezone: "UTC",
    },
  });

  const institution = await db.institution.create({
    data: {
      tenantId: tenant.id,
      name: params.name,
      code: params.code,
    },
  });

  for (const definition of TENANT_ROLES) {
    await createRole(tenant.id, definition.key);
  }

  const admin = await createMember(tenant.id, params.slug, "institution_admin", "admin");
  const faculty = await createMember(tenant.id, params.slug, "faculty", "faculty");
  const student = await createMember(tenant.id, params.slug, "student", "student");

  return {
    tenantId: tenant.id,
    institutionId: institution.id,
    slug: params.slug,
    admin,
    faculty,
    student,
  };
}
