import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { ROLES, type RoleKey } from "@/lib/navigation";

import { MobileNav } from "./mobile-nav";

function initials(name: string): string {
  const parts = name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

export function Topbar({
  role,
  tenantName,
  userName,
  unreadNotifications,
  contextLabel,
  showDesignSystem,
  showDevMail,
}: {
  role: RoleKey;
  tenantName: string;
  userName: string;
  unreadNotifications: number;
  contextLabel: string;
  showDesignSystem: boolean;
  showDevMail: boolean;
}) {
  return (
    <header className="border-border bg-surface/95 sticky top-0 z-20 border-b backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <MobileNav
          role={role}
          tenantName={tenantName}
          showDesignSystem={showDesignSystem}
          showDevMail={showDevMail}
        />

        <div className="min-w-0 flex-1">
          <p className="text-ink-muted text-xs">{contextLabel}</p>
          <p className="text-ink truncate text-sm font-semibold">{tenantName}</p>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/notifications"
            className="hover:bg-surface-muted text-ink-muted flex items-center gap-2 rounded-lg px-2 py-1 text-sm"
            aria-label={
              unreadNotifications > 0
                ? `Notifications, ${unreadNotifications} unread`
                : "Notifications"
            }
          >
            <span aria-hidden="true">🔔</span>
            <span className="hidden sm:inline">Notifications</span>
            {unreadNotifications > 0 ? (
              <span className="bg-brand-800 rounded-full px-2 py-0.5 text-xs font-semibold text-white">
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            ) : null}
          </Link>
          <Link
            href="/account"
            className="hover:bg-surface-muted flex min-w-0 items-center gap-3 rounded-lg px-2 py-1"
          >
            <span
              aria-hidden="true"
              className="bg-brand-100 text-brand-800 flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
            >
              {initials(userName)}
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className="text-ink block truncate text-sm font-medium">{userName}</span>
              <span className="text-ink-muted block truncate text-xs">{ROLES[role].label}</span>
            </span>
          </Link>
          <SignOutButton className="hidden sm:inline-flex" />
        </div>
      </div>
    </header>
  );
}
