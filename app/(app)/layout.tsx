import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { AppShell } from "@/components/navigation/app-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireAccountContext } from "@/lib/auth/account";
import { countUnreadNotifications } from "@/modules/notifications/notification-service";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const account = await requireAccountContext();
  const unreadNotifications = account.tenant ? await countUnreadNotifications(account) : 0;

  if (!account.tenant) {
    if (account.memberships.length > 1) redirect("/select-institution");
    if (!account.isPlatformAdmin) {
      return (
        <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
          <div className="w-full max-w-lg">
            <Alert tone="warning" title="No active institution">
              Your account has no active institution membership. Ask your institution administrator
              to restore access, or contact platform support.
            </Alert>
            <div className="mt-4 flex items-center gap-3">
              <SignOutButton />
              <Button variant="secondary" disabled>
                Continue
              </Button>
            </div>
          </div>
        </main>
      );
    }
  } else if (account.memberships.length > 1) {
    // A cookie-selected institution is already applied; offer switching on the
    // account page rather than redirecting.
    const selected = account.tenant;
    if (!selected) redirect("/select-institution");
  }

  return (
    <AppShell
      role={account.navRole}
      tenantName={account.tenant?.institutionName ?? "Platform operations"}
      userName={account.user.name}
      unreadNotifications={unreadNotifications}
      showDesignSystem={process.env.NODE_ENV !== "production"}
      showDevMail={process.env.NODE_ENV !== "production"}
    >
      {children}
    </AppShell>
  );
}
