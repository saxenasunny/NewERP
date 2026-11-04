"use server";

import { redirect } from "next/navigation";

import { currentRequestId, requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { updateOwnProfile } from "@/modules/identity/user-service";

export async function updateProfileAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();

  try {
    await updateOwnProfile(
      account.user.id,
      {
        name: String(formData.get("name") ?? ""),
        timezone: String(formData.get("timezone") ?? ""),
        locale: String(formData.get("locale") ?? ""),
      },
      { requestId: await currentRequestId() },
    );
  } catch (error) {
    if (error instanceof AppError) {
      redirect(`/account?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }

  redirect("/account?notice=profile-saved");
}
