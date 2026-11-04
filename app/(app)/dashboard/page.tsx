import { redirect } from "next/navigation";

import { requireAccountContext } from "@/lib/auth/account";

export default async function DashboardRedirectPage() {
  const account = await requireAccountContext();
  redirect(account.homePath);
}
