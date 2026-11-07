import { redirect } from "next/navigation";

import { requireAccountContext } from "@/lib/auth/account";

export default async function FacultyLayout({ children }: { children: React.ReactNode }) {
  const account = await requireAccountContext();

  const isAuthorized =
    account.isPlatformAdmin ||
    account.navRole === "faculty" ||
    account.navRole === "institution_admin" ||
    account.roleKeys.includes("faculty") ||
    account.roleKeys.includes("teaching_assistant") ||
    account.roleKeys.includes("institution_admin");

  if (!isAuthorized) {
    redirect(account.homePath);
  }

  return <>{children}</>;
}
