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
        className="border-border-strong text-ink hover:bg-surface-muted flex size-10 items-center justify-center rounded-lg border lg:hidden"
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
        className="border-border bg-surface text-ink m-0 h-dvh max-h-dvh w-[min(20rem,85vw)] max-w-none border-0 border-r p-0"
      >
        <div className="flex h-full flex-col">
          <div className="border-border flex items-center justify-between gap-2 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <BrandMark />
              <div className="min-w-0">
                <p className="text-ink truncate text-sm font-semibold">LMS Platform</p>
                <p className="text-ink-muted truncate text-xs">{tenantName}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-ink-muted hover:bg-surface-muted hover:text-ink flex size-9 items-center justify-center rounded-lg"
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

          <div className="border-border border-t px-2 py-3">
            <p className="text-ink-muted px-3 pb-2 text-xs font-semibold tracking-wide uppercase">
              {ROLES[role].label}
            </p>
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              className="text-ink-muted hover:bg-surface-muted hover:text-ink flex rounded-lg px-3 py-2 text-sm"
            >
              My account
            </Link>
            {showDesignSystem ? (
              <Link
                href="/design"
                onClick={() => setOpen(false)}
                className="text-ink-muted hover:bg-surface-muted hover:text-ink flex rounded-lg px-3 py-2 text-sm"
              >
                Design system
              </Link>
            ) : null}
            {showDevMail ? (
              <Link
                href="/dev/mail"
                onClick={() => setOpen(false)}
                className="text-ink-muted hover:bg-surface-muted hover:text-ink flex rounded-lg px-3 py-2 text-sm"
              >
                Development outbox
              </Link>
            ) : null}
            <div className="pt-1">
              <SignOutButton className="w-full justify-start" />
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
