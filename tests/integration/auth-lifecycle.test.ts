import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildAccountContext, type AccountContext } from "@/lib/auth/account";
import { getAuth } from "@/lib/auth/config";
import {
  ConflictError,
  InvalidLinkError,
  PermissionDeniedError,
  RateLimitedError,
  ResourceNotFoundError,
} from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  acceptInvitation,
  getInvitationPreview,
  inviteUser,
  revokeInvitation,
} from "@/modules/identity/invitation-service";
import { generateSingleUseToken, hashToken } from "@/modules/identity/tokens";
import {
  assignRole,
  deactivateUser,
  listMembers,
  reactivateUser,
  removeRole,
} from "@/modules/identity/user-service";

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
    "Skipping auth lifecycle tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
  );
}

const describeDb = describe.skipIf(!databaseAvailable);

/** Builds the real account context through production code (no cookie needed). */
async function accountFor(userId: string, activeTenantId: string | null): Promise<AccountContext> {
  const account = await buildAccountContext(
    {
      session: { id: "test-session", expiresAt: new Date(Date.now() + 60_000) },
      user: { id: userId },
    },
    { activeTenantId },
  );
  if (!account) throw new Error("Expected an account context for an active user.");
  return account;
}

async function roleIdFor(tenantId: string, key: string): Promise<string> {
  const role = await testDb().role.findFirst({ where: { tenantId, key } });
  if (!role) throw new Error(`Role ${key} missing in fixture.`);
  return role.id;
}

/** Pulls the single-use token out of a rendered invitation message. */
function extractInvitationToken(body: string): string {
  const token = /accept-invitation\/([A-Za-z0-9_-]{43})/.exec(body)?.[1];
  if (!token) throw new Error("Invitation message did not contain a well-formed token.");
  return token;
}

/** Pulls the single-use reset token out of a rendered reset message. */
function extractResetToken(body: string): string {
  // Better Auth links to /api/auth/reset-password/<token>?callbackURL=..., which
  // verifies the token and then redirects to the app's /reset-password page.
  const token = /\/api\/auth\/reset-password\/([A-Za-z0-9_-]+)/.exec(body)?.[1];
  if (!token) throw new Error("Reset message did not contain a well-formed token.");
  return token;
}

/** Attaches an email/password credential to an existing fixture user. */
async function giveCredential(userId: string, password: string): Promise<void> {
  await testDb().account.create({
    data: {
      accountId: userId,
      providerId: "credential",
      userId,
      password: await hashPassword(password),
    },
  });
}

describeDb("authentication and account lifecycle (PostgreSQL)", () => {
  let alpha: TenantFixture;
  let beta: TenantFixture;

  beforeEach(async () => {
    await resetDatabase();
    await seedPermissions();
    alpha = await createTenantFixture({ slug: "alpha", name: "Alpha University", code: "ALP" });
    beta = await createTenantFixture({ slug: "beta", name: "Beta College", code: "BET" });
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  describe("invitation flow", () => {
    it("invites, writes to the development outbox, and accepts into the institution", async () => {
      const admin = await accountFor(alpha.admin.userId, alpha.tenantId);
      const studentRoleId = await roleIdFor(alpha.tenantId, "student");

      const result = await inviteUser(
        admin,
        { email: "newcomer@alpha.example", roleId: studentRoleId },
        { requestId: "req-invite" },
      );
      expect(result.emailDelivered).toBe(true);

      // The message body carries the single-use link; tokens are never stored.
      const message = await testDb().emailMessage.findFirstOrThrow({
        where: { to: "newcomer@alpha.example" },
        orderBy: { createdAt: "desc" },
      });
      const token = extractInvitationToken(message.body);

      const invitation = await testDb().invitation.findFirstOrThrow({
        where: { email: "newcomer@alpha.example" },
      });
      expect(invitation.tokenHash).toBe(hashToken(token));
      expect(invitation.acceptedAt).toBeNull();

      const audit = await testDb().auditEvent.findFirstOrThrow({
        where: { tenantId: alpha.tenantId, action: "user.invited" },
      });
      expect(audit.actorUserId).toBe(alpha.admin.userId);
      expect(audit.requestId).toBe("req-invite");

      const preview = await getInvitationPreview(token);
      expect(preview?.email).toBe("newcomer@alpha.example");
      expect(preview?.requiresSignIn).toBe(false);

      const accepted = await acceptInvitation({
        token,
        rawInput: { name: "New Person", password: "Str0ngPassphrase!2026" },
      });
      expect(accepted.tenantId).toBe(alpha.tenantId);

      const user = await testDb().user.findUniqueOrThrow({
        where: { email: "newcomer@alpha.example" },
        include: {
          memberships: true,
          roleAssignments: { include: { role: true } },
          accounts: true,
        },
      });
      expect(user.status).toBe("ACTIVE");
      expect(user.emailVerified).toBe(true);
      expect(user.accounts[0]?.providerId).toBe("credential");
      expect(user.memberships[0]).toMatchObject({ tenantId: alpha.tenantId, status: "ACTIVE" });
      expect(user.roleAssignments[0]?.role.key).toBe("student");

      const consumed = await testDb().invitation.findUniqueOrThrow({
        where: { id: invitation.id },
      });
      expect(consumed.acceptedAt).not.toBeNull();
    });

    it("never reuses an accepted token", async () => {
      const admin = await accountFor(alpha.admin.userId, alpha.tenantId);
      const studentRoleId = await roleIdFor(alpha.tenantId, "student");
      await inviteUser(admin, { email: "twice@alpha.example", roleId: studentRoleId });

      const message = await testDb().emailMessage.findFirstOrThrow({
        where: { to: "twice@alpha.example" },
        orderBy: { createdAt: "desc" },
      });
      const token = extractInvitationToken(message.body);

      await acceptInvitation({
        token,
        rawInput: { name: "Twice", password: "Str0ngPassphrase!2026" },
      });
      await expect(
        acceptInvitation({ token, rawInput: { name: "Twice", password: "Str0ngPassphrase!2026" } }),
      ).rejects.toBeInstanceOf(InvalidLinkError);
    });

    it("rejects expired and revoked invitations", async () => {
      const studentRoleId = await roleIdFor(alpha.tenantId, "student");

      const expiredToken = generateSingleUseToken();
      await testDb().invitation.create({
        data: {
          tenantId: alpha.tenantId,
          email: "late@alpha.example",
          roleId: studentRoleId,
          tokenHash: hashToken(expiredToken),
          expiresAt: new Date(Date.now() - 1_000),
        },
      });
      await expect(
        acceptInvitation({
          token: expiredToken,
          rawInput: { name: "Late", password: "Str0ngPassphrase!2026" },
        }),
      ).rejects.toBeInstanceOf(InvalidLinkError);

      const admin = await accountFor(alpha.admin.userId, alpha.tenantId);
      const invitation = await inviteUser(admin, {
        email: "changed@alpha.example",
        roleId: studentRoleId,
      });
      await revokeInvitation(admin, invitation.invitationId);

      const message = await testDb().emailMessage.findFirstOrThrow({
        where: { to: "changed@alpha.example" },
        orderBy: { createdAt: "desc" },
      });
      const revokedToken = extractInvitationToken(message.body);
      await expect(
        acceptInvitation({
          token: revokedToken,
          rawInput: { name: "Changed", password: "Str0ngPassphrase!2026" },
        }),
      ).rejects.toBeInstanceOf(InvalidLinkError);
    });

    it("refuses inviting without permission and refuses duplicate members", async () => {
      const student = await accountFor(alpha.student.userId, alpha.tenantId);
      const studentRoleId = await roleIdFor(alpha.tenantId, "student");
      await expect(
        inviteUser(student, { email: "x@alpha.example", roleId: studentRoleId }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      const admin = await accountFor(alpha.admin.userId, alpha.tenantId);
      await expect(
        inviteUser(admin, { email: "admin@alpha.example", roleId: studentRoleId }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("credential sign-in and sessions", () => {
    const password = "Corr3ctHorseBattery!";

    it("signs in a credential user and records an audit event", async () => {
      await giveCredential(alpha.faculty.userId, password);
      const auth = getAuth();

      const result = await auth.api.signInEmail({
        body: { email: `faculty@${alpha.slug}.example`, password },
        headers: new Headers(),
      });
      expect(result.user.email).toBe(`faculty@${alpha.slug}.example`);

      const sessions = await testDb().session.findMany({
        where: { userId: alpha.faculty.userId },
      });
      expect(sessions).toHaveLength(1);

      const audit = await testDb().auditEvent.findFirst({
        where: { action: "auth.session_created" },
      });
      expect(audit?.actorUserId).toBe(alpha.faculty.userId);
    });

    it("rejects wrong passwords and unknown accounts identically, creating no session", async () => {
      await giveCredential(alpha.faculty.userId, password);
      const auth = getAuth();

      const wrongPassword = await auth.api
        .signInEmail({
          body: { email: `faculty@${alpha.slug}.example`, password: "NotThePassword!1" },
          headers: new Headers(),
        })
        .then(
          () => null,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
      const unknownAccount = await auth.api
        .signInEmail({
          body: { email: "nobody@alpha.example", password },
          headers: new Headers(),
        })
        .then(
          () => null,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );

      expect(wrongPassword).toBeTruthy();
      expect(unknownAccount).toBeTruthy();
      // One generic message: the response must not reveal whether the address exists.
      expect(wrongPassword).toBe(unknownAccount);
      expect(wrongPassword).not.toContain(`faculty@${alpha.slug}.example`);

      expect(await testDb().session.count()).toBe(0);
    });

    it("revokes sessions on deactivation, blocks new sign-ins, and restores on reactivation", async () => {
      await giveCredential(alpha.faculty.userId, password);
      const auth = getAuth();
      const admin = await accountFor(alpha.admin.userId, alpha.tenantId);

      // Establish a live session first.
      await auth.api.signInEmail({
        body: { email: `faculty@${alpha.slug}.example`, password },
        headers: new Headers(),
      });
      expect(await testDb().session.count({ where: { userId: alpha.faculty.userId } })).toBe(1);

      await deactivateUser(admin, { userId: alpha.faculty.userId, reason: "Left the department" });
      expect(await testDb().session.count({ where: { userId: alpha.faculty.userId } })).toBe(0);

      await expect(
        auth.api.signInEmail({
          body: { email: `faculty@${alpha.slug}.example`, password },
          headers: new Headers(),
        }),
      ).rejects.toThrow();

      const deactivation = await testDb().auditEvent.findFirstOrThrow({
        where: { action: "user.deactivated", resourceId: alpha.faculty.userId },
      });
      expect(deactivation.reason).toBe("Left the department");

      await reactivateUser(admin, alpha.faculty.userId);
      const restored = await auth.api.signInEmail({
        body: { email: `faculty@${alpha.slug}.example`, password },
        headers: new Headers(),
      });
      expect(restored.user.email).toBe(`faculty@${alpha.slug}.example`);
    });
  });

  describe("password reset", () => {
    const password = "Corr3ctHorseBattery!";
    const newPassword = "N3wCorrectHorseBattery!";

    it("resets through the development outbox, revokes sessions, and burns the token", async () => {
      await giveCredential(alpha.faculty.userId, password);
      const auth = getAuth();
      const email = `faculty@${alpha.slug}.example`;

      // An existing session must be revoked by the reset.
      await auth.api.signInEmail({ body: { email, password }, headers: new Headers() });
      expect(await testDb().session.count({ where: { userId: alpha.faculty.userId } })).toBe(1);

      await auth.api.requestPasswordReset({
        body: { email, redirectTo: "http://localhost:3000/reset-password" },
        headers: new Headers(),
      });

      // No mail leaves the machine: the message is captured in the outbox table.
      const message = await testDb().emailMessage.findFirstOrThrow({
        where: { to: email, subject: "Reset your LMS password" },
        orderBy: { createdAt: "desc" },
      });
      expect(message.transport).toBe("development_outbox");
      expect(message.sentAt).not.toBeNull();

      const token = extractResetToken(message.body);
      // Only the hash is persisted; the raw token exists in the message alone.
      expect(await testDb().verification.count({ where: { identifier: token } })).toBe(0);

      await auth.api.resetPassword({ body: { newPassword, token } });

      expect(await testDb().session.count({ where: { userId: alpha.faculty.userId } })).toBe(0);
      await expect(
        auth.api.signInEmail({ body: { email, password }, headers: new Headers() }),
      ).rejects.toThrow();
      const restored = await auth.api.signInEmail({
        body: { email, password: newPassword },
        headers: new Headers(),
      });
      expect(restored.user.id).toBe(alpha.faculty.userId);

      // Single use: the same token cannot set another password.
      await expect(
        auth.api.resetPassword({ body: { newPassword: "AnotherPassword!23", token } }),
      ).rejects.toThrow();
      await expect(
        auth.api.signInEmail({
          body: { email, password: "AnotherPassword!23" },
          headers: new Headers(),
        }),
      ).rejects.toThrow();
    });

    it("reveals nothing for unknown addresses and rejects invalid tokens", async () => {
      await giveCredential(alpha.faculty.userId, password);
      const auth = getAuth();

      // Unknown address: the response is the same shape and no message is written.
      await auth.api.requestPasswordReset({
        body: { email: "nobody@alpha.example", redirectTo: "http://localhost:3000/reset-password" },
        headers: new Headers(),
      });
      expect(await testDb().emailMessage.count({ where: { to: "nobody@alpha.example" } })).toBe(0);

      await expect(
        auth.api.resetPassword({ body: { newPassword, token: "not-a-real-token" } }),
      ).rejects.toThrow();

      // The valid password is untouched by the rejected attempt.
      const signIn = await auth.api.signInEmail({
        body: { email: `faculty@${alpha.slug}.example`, password },
        headers: new Headers(),
      });
      expect(signIn.user.id).toBe(alpha.faculty.userId);
    });
  });

  describe("deactivation guards", () => {
    it("refuses self-deactivation and cross-tenant targets", async () => {
      const selfAdmin = await accountFor(alpha.admin.userId, alpha.tenantId);
      await expect(
        deactivateUser(selfAdmin, { userId: alpha.admin.userId }),
      ).rejects.toBeInstanceOf(ConflictError);

      const betaAdmin = await accountFor(beta.admin.userId, beta.tenantId);
      await expect(
        deactivateUser(betaAdmin, { userId: alpha.faculty.userId }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);

      const unchanged = await testDb().user.findUniqueOrThrow({
        where: { id: alpha.faculty.userId },
      });
      expect(unchanged.status).toBe("ACTIVE");
      expect(
        await testDb().auditEvent.count({
          where: { tenantId: beta.tenantId, action: "user.deactivated" },
        }),
      ).toBe(0);
    });

    it("lets any member of the institution see the directory but not students manage roles", async () => {
      const student = await accountFor(alpha.student.userId, alpha.tenantId);
      await expect(listMembers(student, {})).rejects.toBeInstanceOf(PermissionDeniedError);

      await expect(
        assignRole(student, {
          userId: alpha.student.userId,
          roleId: await roleIdFor(alpha.tenantId, "faculty"),
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
  });

  describe("role assignment", () => {
    it("grants a role inside the tenant with an audit trail and blocks foreign tenants", async () => {
      const admin = await accountFor(alpha.admin.userId, alpha.tenantId);
      const facultyRoleId = await roleIdFor(alpha.tenantId, "faculty");

      await assignRole(admin, { userId: alpha.student.userId, roleId: facultyRoleId });
      const assignment = await testDb().userRoleAssignment.findFirstOrThrow({
        where: { tenantId: alpha.tenantId, userId: alpha.student.userId, roleId: facultyRoleId },
      });
      expect(assignment.grantedByUserId).toBe(alpha.admin.userId);

      const audit = await testDb().auditEvent.findFirstOrThrow({
        where: {
          tenantId: alpha.tenantId,
          action: "role.assigned",
          resourceId: alpha.student.userId,
        },
      });
      expect(audit.actorUserId).toBe(alpha.admin.userId);

      // Idempotent: granting the same role twice does not duplicate rows.
      await assignRole(admin, { userId: alpha.student.userId, roleId: facultyRoleId });
      expect(
        await testDb().userRoleAssignment.count({
          where: { tenantId: alpha.tenantId, userId: alpha.student.userId, roleId: facultyRoleId },
        }),
      ).toBe(1);

      // A beta admin cannot touch an alpha member or grant an alpha role.
      const betaAdmin = await accountFor(beta.admin.userId, beta.tenantId);
      await expect(
        assignRole(betaAdmin, { userId: alpha.student.userId, roleId: facultyRoleId }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
      await expect(
        assignRole(betaAdmin, { userId: beta.student.userId, roleId: facultyRoleId }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("keeps at least one active institution administrator", async () => {
      const admin = await accountFor(alpha.admin.userId, alpha.tenantId);
      const assignment = await testDb().userRoleAssignment.findFirstOrThrow({
        where: {
          tenantId: alpha.tenantId,
          userId: alpha.admin.userId,
          role: { key: "institution_admin" },
        },
      });

      await expect(removeRole(admin, assignment.id)).rejects.toBeInstanceOf(ConflictError);

      // Grant the role to someone else first, then the original can be removed.
      await assignRole(admin, { userId: alpha.faculty.userId, roleId: assignment.roleId });
      await removeRole(admin, assignment.id);
      expect(
        await testDb().userRoleAssignment.findUnique({ where: { id: assignment.id } }),
      ).toBeNull();
    });
  });

  describe("rate limiting", () => {
    it("throws a mapped 429 after the window's limit is consumed", async () => {
      const key = "test-lifecycle-limit";
      await enforceRateLimit({ key, limit: 2, windowSeconds: 60 });
      await enforceRateLimit({ key, limit: 2, windowSeconds: 60 });
      await expect(enforceRateLimit({ key, limit: 2, windowSeconds: 60 })).rejects.toBeInstanceOf(
        RateLimitedError,
      );
    });
  });
});
