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
            className="hover:bg-brand-50 hover:text-brand-700 text-ink-muted flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm transition-colors border border-transparent hover:border-brand-200/60"
            aria-label={
              unreadNotifications > 0
                ? `Notifications, ${unreadNotifications} unread`
                : "Notifications"
            }
          >
            <span aria-hidden="true" className="text-base">🔔</span>
            <span className="hidden sm:inline font-medium">Notifications</span>
            {unreadNotifications > 0 ? (
              <span className="bg-gradient-to-r from-red-500 to-rose-600 rounded-full px-2 py-0.5 text-xs font-bold text-white shadow-xs">
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            ) : null}
          </Link>
          <Link
            href="/account"
            className="hover:bg-surface-muted flex min-w-0 items-center gap-3 rounded-xl px-2 py-1 transition-colors"
          >
            <span
              aria-hidden="true"
              className="bg-gradient-to-tr from-brand-900 via-brand-700 to-brand-500 text-white shadow-xs flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold tracking-wider ring-1 ring-brand-200/50"
            >
              {initials(userName)}
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className="text-ink block truncate text-sm font-semibold">{userName}</span>
              <span className="text-brand-700 block truncate text-xs font-semibold">{ROLES[role].label}</span>
            </span>
          </Link>
          <SignOutButton className="hidden sm:inline-flex" />
        </div>
      </div>
    </header>
  );
}
