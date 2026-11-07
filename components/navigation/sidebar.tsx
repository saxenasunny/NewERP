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
    <aside className="border-r border-[#0A4174]/40 bg-[#001D39] text-white hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col shadow-2xl z-30">
      <div className="border-b border-[#0A4174]/40 flex items-center gap-3 px-5 py-4 bg-[#001428]/60">
        <BrandMark />
        <div className="min-w-0">
          <p className="text-white truncate text-sm font-bold tracking-tight">NewERP System</p>
          <p className="text-[#BDD8E9]/75 truncate text-xs">{tenantName}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-4">
        <SidebarNav role={role} />
      </div>

      <div className="border-t border-[#0A4174]/40 px-2 py-3 bg-[#001428]/40">
        <p className="text-[#7BBDE8] px-3 pb-2 text-[11px] font-bold tracking-wider uppercase">
          {ROLES[role].label}
        </p>
        <ul className="flex flex-col gap-1">
          <li>
            <Link
              href="/account"
              className="text-[#BDD8E9]/80 hover:bg-[#0A4174]/50 hover:text-white flex rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            >
              My account
            </Link>
          </li>
          {showDesignSystem ? (
            <li>
              <Link
                href="/design"
                className="text-[#BDD8E9]/80 hover:bg-[#0A4174]/50 hover:text-white flex rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                Design system
              </Link>
            </li>
          ) : null}
          {showDevMail ? (
            <li>
              <Link
                href="/dev/mail"
                className="text-[#BDD8E9]/80 hover:bg-[#0A4174]/50 hover:text-white flex rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                Development outbox
              </Link>
            </li>
          ) : null}
          <li className="pt-1">
            <SignOutButton className="w-full justify-start text-[#BDD8E9]/80 hover:text-rose-300 hover:bg-rose-950/40" />
          </li>
        </ul>
      </div>
    </aside>
  );
}
