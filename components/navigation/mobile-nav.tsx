"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { ROLES, type RoleKey } from "@/lib/navigation";

import { BrandMark } from "./brand";
import { SidebarNav } from "./sidebar-nav";

export function MobileNav({
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
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="border-border-strong text-ink hover:bg-brand-50 flex size-10 items-center justify-center rounded-xl border bg-white/80 shadow-xs lg:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-5">
          <path
            d="M3 5h14M3 10h14M3 15h14"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
        <span className="sr-only">Open navigation menu</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Navigation menu"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        className="border-r border-[#0A4174]/40 bg-[#001D39] text-white m-0 h-dvh max-h-dvh w-[min(20rem,85vw)] max-w-none border-0 p-0 shadow-2xl"
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-[#0A4174]/40 flex items-center justify-between gap-2 px-4 py-3 bg-[#001428]/60">
            <div className="flex min-w-0 items-center gap-3">
              <BrandMark />
              <div className="min-w-0">
                <p className="text-white truncate text-sm font-bold tracking-tight">NewERP System</p>
                <p className="text-[#BDD8E9]/75 truncate text-xs">{tenantName}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[#BDD8E9]/80 hover:bg-[#0A4174]/50 hover:text-white flex size-9 items-center justify-center rounded-lg transition-colors"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-5">
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              <span className="sr-only">Close navigation menu</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-4">
            <SidebarNav role={role} onNavigate={() => setOpen(false)} />
          </div>

          <div className="border-t border-[#0A4174]/40 px-2 py-3 bg-[#001428]/40">
            <p className="text-[#7BBDE8] px-3 pb-2 text-[11px] font-bold tracking-wider uppercase">
              {ROLES[role].label}
            </p>
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              className="text-[#BDD8E9]/80 hover:bg-[#0A4174]/50 hover:text-white flex rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            >
              My account
            </Link>
            {showDesignSystem ? (
              <Link
                href="/design"
                onClick={() => setOpen(false)}
                className="text-[#BDD8E9]/80 hover:bg-[#0A4174]/50 hover:text-white flex rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                Design system
              </Link>
            ) : null}
            {showDevMail ? (
              <Link
                href="/dev/mail"
                onClick={() => setOpen(false)}
                className="text-[#BDD8E9]/80 hover:bg-[#0A4174]/50 hover:text-white flex rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                Development outbox
              </Link>
            ) : null}
            <div className="pt-1">
              <SignOutButton className="w-full justify-start text-[#BDD8E9]/80 hover:text-rose-300 hover:bg-rose-950/40" />
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
