import { redirect } from "next/navigation";

import { requireAccountContext } from "@/lib/auth/account";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const account = await requireAccountContext();

  if (!account.isPlatformAdmin) {
    redirect(account.homePath);
  }

  return <>{children}</>;
}
