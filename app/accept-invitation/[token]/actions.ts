"use server";

import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { AppError, UnauthenticatedError } from "@/lib/errors";
import { isWellFormedToken } from "@/modules/identity/tokens";
import { acceptInvitation } from "@/modules/identity/invitation-service";

export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  if (!isWellFormedToken(token)) redirect("/sign-in");

  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  const name = String(formData.get("name") ?? "");

  const failure = (message: string) =>
    redirect(`/accept-invitation/${token}?error=${encodeURIComponent(message)}`);

  if (password !== confirmation) failure("The passwords do not match.");

  const session = await getSession();

  try {
    await acceptInvitation({
      token,
      rawInput: {
        name: name || undefined,
        password: password || undefined,
        phone: String(formData.get("phone") ?? "") || undefined,
        dateOfBirth: String(formData.get("dateOfBirth") ?? "") || undefined,
        gender: String(formData.get("gender") ?? "") || undefined,
        guardianName: String(formData.get("guardianName") ?? "") || undefined,
        guardianPhone: String(formData.get("guardianPhone") ?? "") || undefined,
        address: String(formData.get("address") ?? "") || undefined,
        city: String(formData.get("city") ?? "") || undefined,
        state: String(formData.get("state") ?? "") || undefined,
        postalCode: String(formData.get("postalCode") ?? "") || undefined,
      },
      sessionUserId: session?.user.id ?? null,
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/sign-in?next=${encodeURIComponent(`/accept-invitation/${token}`)}`);
    }
    const message =
      error instanceof AppError
        ? error.message
        : "The invitation could not be accepted. Try again or ask for a new invitation.";
    failure(message);
  }

  redirect("/sign-in?notice=invitation-accepted");
}
