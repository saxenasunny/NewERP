import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { ROLES, type RoleKey } from "@/lib/navigation";

import { BrandMark } from "./brand";
import { SidebarNav } from "./sidebar-nav";

export function Sidebar({
  role,
  tenantName,
  showDesignSystem,
  showDevMail,
}: {
  role: RoleKey;
  tenantName: string;
  showDesignSystem: boolean;
  showDevMail: boolean;
}) {
  return (
    <aside className="border-border bg-surface hidden border-r lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
      <div className="border-border flex items-center gap-3 border-b px-5 py-4">
        <BrandMark />
        <div className="min-w-0">
          <p className="text-ink truncate text-sm font-semibold">LMS Platform</p>
          <p className="text-ink-muted truncate text-xs">{tenantName}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-4">
        <SidebarNav role={role} />
      </div>

      <div className="border-border border-t px-2 py-3">
        <p className="text-ink-muted px-3 pb-2 text-xs font-semibold tracking-wide uppercase">
          {ROLES[role].label}
        </p>
        <ul className="flex flex-col gap-1">
          <li>
            <Link
              href="/account"
              className="text-ink-muted hover:bg-surface-muted hover:text-ink flex rounded-lg px-3 py-2 text-sm"
            >
              My account
            </Link>
          </li>
          {showDesignSystem ? (
            <li>
              <Link
                href="/design"
                className="text-ink-muted hover:bg-surface-muted hover:text-ink flex rounded-lg px-3 py-2 text-sm"
              >
                Design system
              </Link>
            </li>
          ) : null}
          {showDevMail ? (
            <li>
              <Link
                href="/dev/mail"
                className="text-ink-muted hover:bg-surface-muted hover:text-ink flex rounded-lg px-3 py-2 text-sm"
              >
                Development outbox
              </Link>
            </li>
          ) : null}
          <li className="pt-1">
            <SignOutButton className="w-full justify-start" />
          </li>
        </ul>
      </div>
    </aside>
  );
}
