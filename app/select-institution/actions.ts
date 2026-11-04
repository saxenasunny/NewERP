"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACTIVE_TENANT_COOKIE, requireAccountContext } from "@/lib/auth/account";
import { getServerEnv } from "@/lib/env";

export async function selectInstitutionAction(formData: FormData): Promise<void> {
  const account = await requireAccountContext();
  const tenantId = String(formData.get("tenantId") ?? "");

  const membership = account.memberships.find((candidate) => candidate.tenantId === tenantId);
  if (!membership) {
    redirect("/select-institution?error=not-a-member");
  }

  (await cookies()).set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: getServerEnv().APP_BASE_URL.startsWith("https://"),
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  redirect("/dashboard");
}
