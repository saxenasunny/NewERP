import type { ReactNode } from "react";

import type { RoleKey } from "@/lib/navigation";

import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  role,
  tenantName,
  userName,
  unreadNotifications,
  showDesignSystem,
  showDevMail,
  children,
}: {
  role: RoleKey;
  tenantName: string;
  userName: string;
  unreadNotifications: number;
  showDesignSystem: boolean;
  showDevMail: boolean;
  children: ReactNode;
}) {
  const contextLabel = role === "platform_admin" ? "Platform" : "Institution";

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="focus:bg-surface sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow"
      >
        Skip to main content
      </a>

      <Sidebar
        role={role}
        tenantName={tenantName}
        showDesignSystem={showDesignSystem}
        showDevMail={showDevMail}
      />

      <div className="flex min-h-dvh min-w-0 flex-col">
        <Topbar
          role={role}
          tenantName={tenantName}
          userName={userName}
          unreadNotifications={unreadNotifications}
          contextLabel={contextLabel}
          showDesignSystem={showDesignSystem}
          showDevMail={showDevMail}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8"
        >
          {children}
        </main>
        <footer className="text-ink-muted mx-auto w-full max-w-6xl px-4 py-6 text-xs sm:px-6 lg:px-8">
          {tenantName} · fictional demo data · built in verified phases.
        </footer>
      </div>
    </div>
  );
}
