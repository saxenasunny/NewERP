"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { visibleNavigation, type RoleKey } from "@/lib/navigation";

export function SidebarNav({ role, onNavigate }: { role: RoleKey; onNavigate?: () => void }) {
  const pathname = usePathname();
  const sections = visibleNavigation(role);

  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-6">
      {sections.map((section) => (
        <div key={section.key}>
          <p className="text-[#7BBDE8] px-3 text-[11px] font-bold tracking-wider uppercase">
            {section.label}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {section.entries.map((entry) => {
              const isActive = pathname === entry.href;
              return (
                <li key={entry.key}>
                  <Link
                    href={entry.href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 ${
                      isActive
                        ? "bg-gradient-to-r from-[#0A4174] to-[#49769F] text-white font-semibold shadow-md shadow-[#001D39]/50 ring-1 ring-[#7BBDE8]/50"
                        : "text-[#BDD8E9]/85 hover:bg-[#0A4174]/40 hover:text-white hover:translate-x-0.5"
                    }`}
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full transition-all ${
                        isActive
                          ? "bg-[#7BBDE8] ring-2 ring-[#7BBDE8]/60 shadow-[0_0_8px_#7BBDE8]"
                          : "bg-transparent"
                      }`}
                    />
                    {entry.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
