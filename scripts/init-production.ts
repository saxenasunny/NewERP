/**
 * Production Institution and Admin Initialization Script.
 *
 * Seeds:
 * 1. Global permissions catalogue (from lib/permissions/catalogue.ts)
 * 2. System roles for the platform and the tenant
 * 3. A fresh, clean production Institution (no demo courses or sample data)
 * 4. The initial Administrator account with the institution_admin role
 *
 * Usage:
 *   npx tsx scripts/init-production.ts \
 *     --institution-name="My University" \
 *     --institution-code="MU" \
 *     --institution-slug="my-university" \
 *     --admin-name="Admin Name" \
 *     --admin-email="admin@myuniversity.edu" \
 *     --admin-password="StrongPassword123!"
 */
import { hashPassword } from "better-auth/crypto";
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import {
  PERMISSIONS,
  PLATFORM_ROLES,
  TENANT_ROLES,
  type RoleDefinition,
} from "../lib/permissions/catalogue";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function getArg(name: string, envFallback?: string): string | undefined {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length).trim();
    }
    if (arg === `--${name}` && i + 1 < args.length) {
      return args[i + 1]?.trim();
    }
  }
  return envFallback?.trim();
}

async function syncPermissionCatalogue(): Promise<void> {
  console.log("-> Syncing global permissions catalogue...");
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: { key: permission.key, description: permission.description },
    });
  }
  console.log(`✓ ${PERMISSIONS.length} permissions synced.`);
}

async function ensureRole(tenantId: string | null, definition: RoleDefinition) {
  const existing = await prisma.role.findFirst({ where: { tenantId, key: definition.key } });

  if (existing) {
    return prisma.role.update({
      where: { id: existing.id },
      data: {
        name: definition.name,
        scope: definition.scope === "platform" ? "PLATFORM" : "TENANT",
        isSystem: true,
        permissions: {
          deleteMany: {},
          create: definition.permissions.map((permissionKey) => ({ permissionKey })),
        },
      },
    });
  }

  return prisma.role.create({
    data: {
      tenantId,
      key: definition.key,
      name: definition.name,
      scope: definition.scope === "platform" ? "PLATFORM" : "TENANT",
      isSystem: true,
      permissions: {
        create: definition.permissions.map((permissionKey) => ({ permissionKey })),
      },
    },
  });
}

async function main(): Promise<void> {
  const institutionName =
    getArg("institution-name", process.env.PROD_INSTITUTION_NAME) ?? "Main Institution";
  const institutionCode =
    getArg("institution-code", process.env.PROD_INSTITUTION_CODE) ?? "MAIN";
  const institutionSlug = (
    getArg("institution-slug", process.env.PROD_INSTITUTION_SLUG) ??
    institutionCode.toLowerCase()
  )
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");

  const adminName = getArg("admin-name", process.env.PROD_ADMIN_NAME) ?? "System Administrator";
  const adminEmail = (
    getArg("admin-email", process.env.PROD_ADMIN_EMAIL) ?? "admin@example.com"
  ).toLowerCase();
  const adminPassword =
    getArg("admin-password", process.env.PROD_ADMIN_PASSWORD) ?? "ChangeMe2026!Admin";

  if (adminPassword.length < 8) {
    throw new Error("Admin password must be at least 8 characters.");
  }

  console.log("=== Initializing Production Environment ===");
  console.log(`Institution: ${institutionName} (${institutionCode}) [slug: ${institutionSlug}]`);
  console.log(`Admin User:  ${adminName} <${adminEmail}>`);

  // 1. Sync permissions
  await syncPermissionCatalogue();

  // 2. Platform roles
  console.log("-> Ensuring platform roles...");
  for (const roleDef of PLATFORM_ROLES) {
    await ensureRole(null, roleDef);
  }

  // 3. Create or update Tenant & Institution
  console.log("-> Ensuring Tenant and Institution record...");
  const tenant = await prisma.tenant.upsert({
    where: { slug: institutionSlug },
    update: { name: institutionName, status: "ACTIVE" },
    create: {
      slug: institutionSlug,
      name: institutionName,
      status: "ACTIVE",
      timezone: "UTC",
      locale: "en",
    },
  });

  const institution = await prisma.institution.upsert({
    where: { tenantId: tenant.id },
    update: { name: institutionName, code: institutionCode },
    create: {
      tenantId: tenant.id,
      name: institutionName,
      code: institutionCode,
    },
  });

  // 4. Ensure tenant roles
  console.log("-> Ensuring tenant roles...");
  const tenantRoles = new Map<string, string>();
  for (const definition of TENANT_ROLES) {
    const role = await ensureRole(tenant.id, definition);
    tenantRoles.set(definition.key, role.id);
  }

  const adminRoleId = tenantRoles.get("institution_admin");
  if (!adminRoleId) {
    throw new Error("Failed to configure institution_admin role.");
  }

  // 5. Ensure Admin User
  console.log("-> Setting up Admin user...");
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { name: adminName, status: "ACTIVE", emailVerified: true },
    create: {
      email: adminEmail,
      name: adminName,
      status: "ACTIVE",
      emailVerified: true,
    },
  });

  // 6. Ensure credential account
  const hashedPassword = await hashPassword(adminPassword);
  const existingCredential = await prisma.account.findFirst({
    where: { userId: adminUser.id, providerId: "credential" },
  });

  if (existingCredential) {
    await prisma.account.update({
      where: { id: existingCredential.id },
      data: { password: hashedPassword },
    });
    console.log("✓ Admin password updated.");
  } else {
    await prisma.account.create({
      data: {
        accountId: adminUser.id,
        providerId: "credential",
        userId: adminUser.id,
        password: hashedPassword,
      },
    });
    console.log("✓ Admin credential account created.");
  }

  // 7. Ensure Tenant Membership
  await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: adminUser.id } },
    update: { status: "ACTIVE" },
    create: {
      tenantId: tenant.id,
      userId: adminUser.id,
      status: "ACTIVE",
      joinedAt: new Date(),
    },
  });

  // 8. Assign institution_admin role
  const existingAssignment = await prisma.userRoleAssignment.findFirst({
    where: {
      tenantId: tenant.id,
      userId: adminUser.id,
      roleId: adminRoleId,
      scopeType: "TENANT",
    },
  });

  if (!existingAssignment) {
    await prisma.userRoleAssignment.create({
      data: {
        tenantId: tenant.id,
        userId: adminUser.id,
        roleId: adminRoleId,
        scopeType: "TENANT",
      },
    });
  }

  console.log("\n✅ Production initialization complete!");
  console.log(`Tenant ID:      ${tenant.id}`);
  console.log(`Institution ID: ${institution.id}`);
  console.log(`Admin Email:    ${adminEmail}`);
  console.log("You can now sign in at /sign-in using your admin credentials.");
}

main()
  .catch((err) => {
    console.error("Initialization failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
