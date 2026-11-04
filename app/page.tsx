import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";

const previews = [
  { href: "/platform", label: "Platform super admin", detail: "Tenants and platform health" },
  { href: "/admin", label: "Institution admin", detail: "Academic structure and people" },
  { href: "/faculty", label: "Faculty", detail: "Teaching and assessment" },
  { href: "/student", label: "Student", detail: "Learning, deadlines, and grades" },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className="bg-brand-700 flex size-10 items-center justify-center rounded-lg text-sm font-bold text-white"
          >
            LMS
          </span>
          <StatusBadge tone="brand">Phase 2 · data foundation</StatusBadge>
        </div>
        <h1 className="text-ink text-3xl font-semibold tracking-tight sm:text-4xl">
          Learning Management System
        </h1>
        <p className="text-ink-muted max-w-2xl">
          A multi-tenant LMS for higher education, built in verified phases. Navigation, layout,
          PostgreSQL schema, seeded demo institutions, tenant isolation, and permission checks
          exist. There is still no sign-in, so the previews below are not access control.
        </p>
      </header>

      <section aria-labelledby="role-previews-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="role-previews-heading" className="text-ink text-lg font-semibold">
            Role previews
          </h2>
          <p className="text-ink-muted text-sm">
            Development previews of role-specific navigation. There is no sign-in yet, so these
            pages are reachable directly and must not be treated as access control.
          </p>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2">
          {previews.map((preview) => (
            <li key={preview.href}>
              <Link
                href={preview.href}
                className="rounded-card border-border bg-surface shadow-card hover:border-brand-300 hover:bg-brand-50/40 flex h-full flex-col gap-1 border p-4 transition-colors"
              >
                <span className="text-ink font-medium">{preview.label}</span>
                <span className="text-ink-muted text-sm">{preview.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="available-heading" className="flex flex-col gap-3">
        <h2 id="available-heading" className="text-ink text-lg font-semibold">
          Working today
        </h2>
        <ul className="text-ink-muted list-disc space-y-1 pl-5 text-sm">
          <li>Strict TypeScript build, lint, formatting, and automated tests.</li>
          <li>Fail-closed server environment validation.</li>
          <li>PostgreSQL schema, versioned migrations, and idempotent demo seed.</li>
          <li>
            Tenant isolation, central permission checks, and transactional audit events, covered by
            PostgreSQL integration tests.
          </li>
          <li>
            Liveness endpoint at{" "}
            <a
              className="text-brand-800 font-medium underline underline-offset-2"
              href="/api/health"
            >
              /api/health
            </a>
            .
          </li>
        </ul>
      </section>

      <footer className="border-border text-ink-muted border-t pt-4 text-sm">
        Source of truth: <span className="font-mono text-xs">docs/LMS_BUILD_SPEC.md</span> · Current
        state: <span className="font-mono text-xs">docs/IMPLEMENTATION_STATUS.md</span>
      </footer>
    </main>
  );
}
