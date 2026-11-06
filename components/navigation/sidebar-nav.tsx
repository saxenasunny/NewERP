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
          <p className="text-ink-muted px-3 text-xs font-semibold tracking-wide uppercase">
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
                        ? "bg-brand-50 text-brand-700 font-semibold shadow-xs ring-1 ring-brand-200/70"
                        : "text-ink-muted hover:bg-surface-muted hover:text-ink hover:translate-x-0.5"
                    }`}
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full transition-all ${
                        isActive ? "bg-brand-600 ring-2 ring-brand-200" : "bg-transparent"
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
