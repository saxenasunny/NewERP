import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/navigation/brand";

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-3">
            <BrandMark />
            <span className="text-ink text-sm font-semibold">LMS Platform</span>
          </Link>
          <span className="text-ink-muted text-xs">Development environment</span>
        </div>

        <div className="rounded-card border-border bg-surface shadow-card border p-6 sm:p-8">
          <h1 className="text-ink text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-ink-muted mt-2 text-sm">{description}</p>
          <div className="mt-6">{children}</div>
        </div>

        {footer ? <div className="text-ink-muted mt-5 text-sm">{footer}</div> : null}
      </div>
    </main>
  );
}
