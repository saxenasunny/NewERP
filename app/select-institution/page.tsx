import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireAccountContext } from "@/lib/auth/account";

import { selectInstitutionAction } from "./actions";

export const metadata: Metadata = { title: "Choose an institution", robots: { index: false } };

export default async function SelectInstitutionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const account = await requireAccountContext();
  const { error } = await searchParams;

  if (account.memberships.length <= 1) redirect(account.homePath);

  return (
    <AuthCard
      title="Choose an institution"
      description="Your account belongs to more than one institution. Choose which one to work in."
      footer={
        <p>
          <Link href="/account" className="text-brand-800 font-medium hover:underline">
            Account settings
          </Link>
        </p>
      }
    >
      {error ? (
        <div className="mb-5">
          <Alert tone="danger" title="Not allowed">
            That institution is not one of your active memberships.
          </Alert>
        </div>
      ) : null}

      <ul className="flex flex-col gap-3">
        {account.memberships.map((membership) => (
          <li
            key={membership.tenantId}
            className="rounded-card border-border bg-surface flex flex-wrap items-center justify-between gap-3 border p-4"
          >
            <div>
              <p className="text-ink font-medium">{membership.institutionName}</p>
              <p className="text-ink-muted text-sm">{membership.tenantName}</p>
            </div>
            <form action={selectInstitutionAction}>
              <input type="hidden" name="tenantId" value={membership.tenantId} />
              <Button type="submit" size="sm">
                Continue
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </AuthCard>
  );
}
