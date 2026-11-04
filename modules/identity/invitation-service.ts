import { hashPassword } from "better-auth/crypto";
import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import type { AccountContext } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/account";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/config";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import {
  ConflictError,
  InvalidLinkError,
  ResourceNotFoundError,
  TenantSelectionRequiredError,
  UnauthenticatedError,
} from "@/lib/errors";
import { log } from "@/lib/observability/logger";
import { sendMail } from "@/lib/mail/send";
import { enforceRateLimit } from "@/lib/rate-limit";
import { absoluteUrl } from "@/lib/url";

import { INVITATION_TTL_MS, generateSingleUseToken, hashToken, isWellFormedToken } from "./tokens";

export const invitationInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  roleId: z.string().min(1, "Choose a role."),
});

export type InvitationSummary = {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  expiresAt: Date;
  createdAt: Date;
};

export type InvitationPreview = {
  email: string;
  tenantName: string;
  institutionName: string;
  roleName: string;
  expiresAt: Date;
  /** True when the address already has an account: the visitor must sign in first. */
  requiresSignIn: boolean;
};

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

export async function listPendingInvitations(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<InvitationSummary[]> {
  requirePermission(account, "users.read");
  const tenantId = tenantIdOf(account);

  const invitations = await db.invitation.findMany({
    where: { tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      email: true,
      roleId: true,
      expiresAt: true,
      createdAt: true,
      role: { select: { name: true } },
    },
  });

  return invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    roleId: invitation.roleId,
    roleName: invitation.role.name,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  }));
}

export async function inviteUser(
  account: AccountContext,
  rawInput: unknown,
  options: { requestId?: string } = {},
): Promise<{ invitationId: string; emailDelivered: boolean }> {
  requirePermission(account, "users.create");
  const tenantId = tenantIdOf(account);
  const input = invitationInputSchema.parse(rawInput);
  const db = getDb();

  const role = await db.role.findFirst({
    where: { id: input.roleId, tenantId, scope: "TENANT" },
    select: { id: true, key: true, name: true },
  });
  if (!role) throw new ResourceNotFoundError("That role does not exist in this institution.");

  const existingUser = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true, memberships: { where: { tenantId }, select: { status: true } } },
  });
  if (existingUser?.memberships.length) {
    const status = existingUser.memberships[0]?.status;
    throw new ConflictError(
      status === "SUSPENDED"
        ? "This person's membership is suspended. Reactivate it instead of inviting them again."
        : "This person is already a member of this institution.",
    );
  }

  const token = generateSingleUseToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const invitation = await db.$transaction(async (transaction) => {
    // One live invitation per address and institution: issuing a new one
    // invalidates the previous link.
    await transaction.invitation.updateMany({
      where: { tenantId, email: input.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const created = await transaction.invitation.create({
      data: {
        tenantId,
        email: input.email,
        roleId: role.id,
        tokenHash,
        invitedByUserId: account.user.id,
        expiresAt,
      },
      select: { id: true },
    });

    await recordAuditEvent(transaction, {
      tenantId,
      actorUserId: account.user.id,
      action: "user.invited",
      resourceType: "invitation",
      resourceId: created.id,
      after: { email: input.email, roleKey: role.key, roleName: role.name, expiresAt },
      requestId: options.requestId ?? null,
    });

    return created;
  });

  const link = absoluteUrl(`/accept-invitation/${token}`);
  let emailDelivered = false;
  try {
    const result = await sendMail({
      to: input.email,
      subject: `You are invited to ${account.tenant?.institutionName ?? "an institution"}`,
      body: [
        `You have been invited to join ${account.tenant?.institutionName ?? "the institution"} as ${role.name}.`,
        "",
        "Open the single-use link below to set up your account. It expires in 7 days.",
        "",
        link,
        "",
        "If you were not expecting this invitation, you can ignore this message.",
      ].join("\n"),
    });
    emailDelivered = result.delivered;
  } catch (error) {
    // The invitation stays valid; delivery is reported honestly to the caller.
    log("error", "email.send_failed", {
      action: "user.invited",
      reason: error instanceof Error ? error.message : "unknown",
    });
  }

  return { invitationId: invitation.id, emailDelivered };
}

export async function revokeInvitation(
  account: AccountContext,
  invitationId: string,
  options: { requestId?: string } = {},
): Promise<void> {
  requirePermission(account, "users.create");
  const tenantId = tenantIdOf(account);
  const db = getDb();

  const invitation = await db.invitation.findFirst({
    where: { id: invitationId, tenantId },
    select: { id: true, email: true, acceptedAt: true, revokedAt: true },
  });
  if (!invitation) throw new ResourceNotFoundError("That invitation was not found.");
  if (invitation.acceptedAt) throw new ConflictError("This invitation was already accepted.");

  await db.$transaction(async (transaction) => {
    await transaction.invitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });
    await recordAuditEvent(transaction, {
      tenantId,
      actorUserId: account.user.id,
      action: "invitation.revoked",
      resourceType: "invitation",
      resourceId: invitation.id,
      before: { email: invitation.email, revoked: false },
      after: { email: invitation.email, revoked: true },
      requestId: options.requestId ?? null,
    });
  });
}

/** Public lookup used by the acceptance page. Only non-sensitive fields are returned. */
export async function getInvitationPreview(
  token: string,
  db: DatabaseClient = getDb(),
): Promise<InvitationPreview | null> {
  if (!isWellFormedToken(token)) return null;

  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      email: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      role: { select: { name: true } },
      tenant: {
        select: { name: true, institution: { select: { name: true } } },
      },
    },
  });
  if (!invitation) return null;
  if (invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
    return null;
  }

  const existingUser = await db.user.findUnique({
    where: { email: invitation.email },
    select: { accounts: { select: { id: true }, take: 1 } },
  });

  return {
    email: invitation.email,
    tenantName: invitation.tenant.name,
    institutionName: invitation.tenant.institution?.name ?? invitation.tenant.name,
    roleName: invitation.role.name,
    expiresAt: invitation.expiresAt,
    requiresSignIn: Boolean(existingUser?.accounts.length),
  };
}

export const acceptanceInputSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name.").max(120).optional(),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      .max(128)
      .optional(),
  })
  .optional();

export async function acceptInvitation({
  token,
  rawInput,
  sessionUserId,
  db = getDb(),
}: {
  token: string;
  rawInput?: unknown;
  sessionUserId?: string | null;
  db?: DatabaseClient;
}): Promise<{ tenantId: string; institutionName: string }> {
  if (!isWellFormedToken(token)) throw new InvalidLinkError();
  const tokenHash = hashToken(token);

  await enforceRateLimit({
    key: `invitation-accept:${tokenHash.slice(0, 24)}`,
    limit: 10,
    windowSeconds: 600,
    db,
  });

  const invitation = await db.invitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      tenantId: true,
      email: true,
      roleId: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      tenant: { select: { institution: { select: { name: true } }, name: true } },
      role: { select: { key: true, name: true, scope: true } },
    },
  });

  if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
    throw new InvalidLinkError();
  }
  if (invitation.expiresAt <= new Date())
    throw new InvalidLinkError("This invitation has expired.");
  if (invitation.role.scope !== "TENANT") {
    // Defensive: platform roles are never granted by invitation.
    throw new ResourceNotFoundError("That role cannot be granted by invitation.");
  }

  const institutionName = invitation.tenant.institution?.name ?? invitation.tenant.name;
  const existingUser = await db.user.findUnique({
    where: { email: invitation.email },
    select: {
      id: true,
      status: true,
      accounts: { select: { id: true }, take: 1 },
    },
  });

  if (existingUser?.accounts.length) {
    // Existing account: the visitor must prove they are that person.
    if (!sessionUserId) {
      throw new UnauthenticatedError(`Sign in as ${invitation.email} to accept this invitation.`);
    }
    const sessionUser = await db.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true, email: true, status: true },
    });
    if (!sessionUser || sessionUser.status !== "ACTIVE" || sessionUser.email !== invitation.email) {
      throw new UnauthenticatedError(`Sign in as ${invitation.email} to accept this invitation.`);
    }

    await joinInstitution({ db, invitation, userId: sessionUser.id, actorUserId: sessionUser.id });
    return { tenantId: invitation.tenantId, institutionName };
  }

  const input = acceptanceInputSchema.parse(rawInput);
  if (!input?.name || !input.password) {
    throw new InvalidLinkError("Enter your name and a password to continue.");
  }

  const passwordHash = await hashPassword(input.password);

  const userId = await db.$transaction(async (transaction) => {
    const user = existingUser
      ? await transaction.user.update({
          where: { id: existingUser.id },
          data: { name: input.name!, status: "ACTIVE", emailVerified: true },
          select: { id: true },
        })
      : await transaction.user.create({
          data: {
            email: invitation.email,
            name: input.name!,
            status: "ACTIVE",
            emailVerified: true,
          },
          select: { id: true },
        });

    await transaction.account.create({
      data: {
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: passwordHash,
      },
    });

    await transaction.tenantMembership.upsert({
      where: { tenantId_userId: { tenantId: invitation.tenantId, userId: user.id } },
      update: { status: "ACTIVE", joinedAt: new Date() },
      create: {
        tenantId: invitation.tenantId,
        userId: user.id,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });

    await transaction.userRoleAssignment.create({
      data: {
        tenantId: invitation.tenantId,
        userId: user.id,
        roleId: invitation.roleId,
        scopeType: "TENANT",
      },
    });

    await transaction.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });

    await recordAuditEvent(transaction, {
      tenantId: invitation.tenantId,
      actorUserId: user.id,
      action: "invitation.accepted",
      resourceType: "invitation",
      resourceId: invitation.id,
      after: { email: invitation.email, roleKey: invitation.role.key, userId: user.id },
    });

    return user.id;
  });

  log("info", "invitation.accepted", { tenantId: invitation.tenantId, userId });
  return { tenantId: invitation.tenantId, institutionName };
}

async function joinInstitution({
  db,
  invitation,
  userId,
  actorUserId,
}: {
  db: DatabaseClient;
  invitation: {
    id: string;
    tenantId: string;
    email: string;
    roleId: string;
    role: { key: string; name: string };
  };
  userId: string;
  actorUserId: string;
}): Promise<void> {
  await db.$transaction(async (transaction) => {
    await transaction.tenantMembership.upsert({
      where: { tenantId_userId: { tenantId: invitation.tenantId, userId } },
      update: { status: "ACTIVE", joinedAt: new Date() },
      create: {
        tenantId: invitation.tenantId,
        userId,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });

    const existingAssignment = await transaction.userRoleAssignment.findFirst({
      where: { tenantId: invitation.tenantId, userId, roleId: invitation.roleId },
      select: { id: true },
    });
    if (!existingAssignment) {
      await transaction.userRoleAssignment.create({
        data: {
          tenantId: invitation.tenantId,
          userId,
          roleId: invitation.roleId,
          scopeType: "TENANT",
        },
      });
    }

    await transaction.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });

    await recordAuditEvent(transaction, {
      tenantId: invitation.tenantId,
      actorUserId,
      action: "invitation.accepted",
      resourceType: "invitation",
      resourceId: invitation.id,
      after: { email: invitation.email, roleKey: invitation.role.key, userId },
    });
  });
}
