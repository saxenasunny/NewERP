import { redirect } from "next/navigation";

import { requireAccountContext } from "@/lib/auth/account";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const account = await requireAccountContext();

  const isAuthorized =
    account.isPlatformAdmin ||
    account.navRole === "institution_admin" ||
    account.roleKeys.includes("institution_admin") ||
    account.roleKeys.includes("academic_coordinator");

  if (!isAuthorized) {
    redirect(account.homePath);
  }

  return <>{children}</>;
}
