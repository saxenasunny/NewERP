"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { AppError, RateLimitedError } from "@/lib/errors";
import { failureMessage } from "@/lib/forms/server-action";
import { inviteUser, revokeInvitation } from "@/modules/identity/invitation-service";
import {
  assignRole,
  deactivateUser,
  reactivateUser,
  removeRole,
} from "@/modules/identity/user-service";

function safeReturnTo(value: FormDataEntryValue | null, fallback: string): string {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/admin/users") ? path : fallback;
}

function withMessage(path: string, key: "notice" | "error", message: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${key}=${encodeURIComponent(message)}`;
}

/**
 * Runs a service call and captures any failure as a message.
 *
 * `redirect()` in Next.js works by throwing, so it must never sit inside a
 * `try` block whose `catch` also redirects: the redirect would be caught as
 * if it were a failure. Every action therefore redirects only after this
 * helper has returned.
 */
type Attempt<T> = { ok: true; value: T } | { ok: false; message: string };

async function attempt<T>(work: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
}

export async function inviteUserAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = safeReturnTo(formData.get("returnTo"), "/admin/users");
  const email = String(formData.get("email") ?? "").trim();

  const outcome = await attempt(async () =>
    inviteUser(
      account,
      {
        email,
        roleId: String(formData.get("roleId") ?? ""),
      },
      { requestId: await currentRequestId() },
    ),
  );

  if (!outcome.ok) {
    redirect(withMessage(returnTo, "error", outcome.message));
  }

  const notice = outcome.value.emailDelivered
    ? `Invitation sent by email to ${email}.`
    : `Invitation created for ${email}! Share this link: ${outcome.value.link}`;

  redirect(withMessage(returnTo, "notice", notice));
}

export async function resendInvitationAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = safeReturnTo(formData.get("returnTo"), "/admin/users");
  const email = String(formData.get("email") ?? "").trim();
  const roleId = String(formData.get("roleId") ?? "").trim();

  const outcome = await attempt(async () =>
    inviteUser(
      account,
      { email, roleId },
      { requestId: await currentRequestId() },
    ),
  );

  if (!outcome.ok) {
    redirect(withMessage(returnTo, "error", outcome.message));
  }

  const notice = outcome.value.emailDelivered
    ? `New invitation link emailed to ${email}.`
    : `New invitation link for ${email}: ${outcome.value.link}`;

  redirect(withMessage(returnTo, "notice", notice));
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const returnTo = safeReturnTo(formData.get("returnTo"), "/admin/users");

  const outcome = await attempt(async () =>
    revokeInvitation(account, String(formData.get("invitationId") ?? ""), {
      requestId: await currentRequestId(),
    }),
  );

  if (!outcome.ok) {
    redirect(withMessage(returnTo, "error", outcome.message));
  }
  redirect(withMessage(returnTo, "notice", "Invitation revoked."));
}

export async function assignRoleAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const userId = String(formData.get("userId") ?? "");
  const returnTo = safeReturnTo(formData.get("returnTo"), `/admin/users/${userId}`);

  const outcome = await attempt(async () =>
    assignRole(
      account,
      { userId, roleId: String(formData.get("roleId") ?? "") },
      { requestId: await currentRequestId() },
    ),
  );

  if (!outcome.ok) {
    redirect(withMessage(returnTo, "error", outcome.message));
  }
  redirect(withMessage(returnTo, "notice", "Role granted."));
}

export async function removeRoleAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const userId = String(formData.get("userId") ?? "");
  const returnTo = safeReturnTo(formData.get("returnTo"), `/admin/users/${userId}`);

  const outcome = await attempt(async () =>
    removeRole(account, String(formData.get("assignmentId") ?? ""), {
      requestId: await currentRequestId(),
    }),
  );

  if (!outcome.ok) {
    redirect(withMessage(returnTo, "error", outcome.message));
  }
  redirect(withMessage(returnTo, "notice", "Role removed."));
}

export async function deactivateUserAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const userId = String(formData.get("userId") ?? "");
  const returnTo = safeReturnTo(formData.get("returnTo"), `/admin/users/${userId}`);

  const outcome = await attempt(async () =>
    deactivateUser(
      account,
      { userId, reason: String(formData.get("reason") ?? "") || undefined },
      { requestId: await currentRequestId() },
    ),
  );

  if (!outcome.ok) {
    redirect(withMessage(returnTo, "error", outcome.message));
  }
  redirect(
    withMessage(
      returnTo,
      "notice",
      "Account deactivated. Every session was revoked and sign-in is blocked.",
    ),
  );
}

export async function reactivateUserAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const userId = String(formData.get("userId") ?? "");
  const returnTo = safeReturnTo(formData.get("returnTo"), `/admin/users/${userId}`);

  const outcome = await attempt(async () =>
    reactivateUser(account, userId, { requestId: await currentRequestId() }),
  );

  if (!outcome.ok) {
    redirect(withMessage(returnTo, "error", outcome.message));
  }
  redirect(withMessage(returnTo, "notice", "Account reactivated."));
}
