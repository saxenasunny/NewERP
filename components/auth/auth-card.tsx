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
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 relative">
      <div className="w-full max-w-md relative z-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-3 group">
            <BrandMark />
            <span className="text-ink text-base font-bold tracking-tight group-hover:text-brand-600 transition-colors">
              NewERP Portal
            </span>
          </Link>
          <span className="text-brand-700 bg-brand-50 border border-brand-200/60 rounded-full px-2.5 py-0.5 text-xs font-semibold">
            Student & Faculty
          </span>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-border bg-surface/95 backdrop-blur-sm shadow-xl p-6 sm:p-8">
          <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-brand-600 via-indigo-600 to-violet-600" />
          <h1 className="text-ink text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-ink-muted mt-2 text-sm leading-relaxed">{description}</p>
          <div className="mt-6">{children}</div>
        </div>

        {footer ? <div className="text-ink-muted mt-5 text-sm text-center">{footer}</div> : null}
      </div>
    </main>
  );
}
