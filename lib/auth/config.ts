import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";

import { recordAuditEvent } from "@/lib/audit/events";
import { getDb } from "@/lib/db/client";
import { getServerEnv } from "@/lib/env";
import { log } from "@/lib/observability/logger";
import { sendMail } from "@/lib/mail/send";

/** Eight hours; refreshed at most every 30 minutes while the user is active. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 30 * 60;
export const PASSWORD_RESET_TTL_SECONDS = 30 * 60;
export const MIN_PASSWORD_LENGTH = 12;

function createAuth() {
  const env = getServerEnv();
  const db = getDb();

  const isProduction = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
  const baseURL =
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : env.APP_BASE_URL;

  return betterAuth({
    appName: "LMS Platform",
    baseURL,
    secret: env.AUTH_SECRET,
    // Better Auth's Prisma adapter addresses the generated client by *model*
    // name (`prisma.user`, `prisma.session`, …); `@@map("users", …)` already
    // gives the physical tables their plural names. `usePlural` would instead
    // expect models literally named `Users`/`Sessions`, so it must stay off.
    database: prismaAdapter(db, { provider: "postgresql" }),
    trustedOrigins: [
      env.APP_BASE_URL,
      "https://*.vercel.app",
      "http://localhost:3000",
      ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
      ...(process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
        : []),
    ],
    emailAndPassword: {
      enabled: true,
      // Accounts are created only by accepting an invitation. Public sign-up
      // would bypass institution membership and role assignment.
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: "Reset your LMS password",
          body: [
            `Hello ${user.name},`,
            "",
            "Use the single-use link below to choose a new password. It expires in 30 minutes.",
            "",
            url,
            "",
            "If you did not request this, you can ignore this message.",
          ].join("\n"),
        });
      },
    },
    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      // Disable the signed cookie cache: deactivation and password reset must
      // revoke access immediately, not after a cache window.
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: {
        // Server-owned lifecycle state. It is exposed on the session user but
        // cannot be set by a client request.
        status: { type: "string", required: false, input: false },
      },
    },
    rateLimit: {
      // Enabled in every environment so tests and development exercise the
      // same rules. Storage is per-process; a multi-instance deployment needs a
      // shared store (documented in the README).
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 },
      },
    },
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: baseURL.startsWith("https://") || isProduction,
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const user = await db.user.findUnique({
              where: { id: session.userId },
              select: { status: true },
            });
            if (!user || user.status !== "ACTIVE") {
              throw new APIError("FORBIDDEN", {
                message: "This account cannot sign in.",
                code: "ACCOUNT_INACTIVE",
              });
            }
            return { data: session };
          },
          after: async (session) => {
            try {
              await recordAuditEvent(db, {
                tenantId: null,
                actorUserId: session.userId,
                action: "auth.session_created",
                resourceType: "session",
                resourceId: session.id,
                after: {
                  ipAddress: session.ipAddress ?? null,
                  userAgent: session.userAgent ?? null,
                },
              });
            } catch (error) {
              // Audit failure must not prevent a legitimate sign-in; log it so
              // the gap is visible to operators.
              log("error", "audit.write_failed", {
                action: "auth.session_created",
                reason: error instanceof Error ? error.message : "unknown",
              });
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { lmsAuth?: Auth };

/**
 * Lazy singleton. Building the app must not require database or secret access,
 * so imports of this module are side-effect free.
 */
export function getAuth(): Auth {
  globalForAuth.lmsAuth ??= createAuth();
  return globalForAuth.lmsAuth;
}
