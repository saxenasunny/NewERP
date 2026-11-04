import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getCheckInView } from "@/modules/attendance/check-in-service";

import { checkInAction } from "./actions";

export const metadata: Metadata = {
  title: "Check in",
  robots: { index: false, follow: false },
};

export default async function LearnerCheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ token }, { notice, error }] = await Promise.all([params, searchParams]);

  let view;
  try {
    view = await getCheckInView(account, token);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Check in" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "This check-in link could not be opened."}
        </Alert>
        <p className="text-muted-foreground text-xs">
          <Link href="/student/courses" className="underline">
            Back to my courses
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My courses", href: "/student/courses" },
          { label: view.courseCode },
          { label: "Check in" },
        ]}
      />
      <PageHeader title={view.title} description={`${view.courseCode} · ${view.courseTitle}`} />

      {notice ? (
        <Alert tone="success" title="Checked in">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Not recorded">
          {error}
        </Alert>
      ) : null}

      <Alert tone="info" title="This session">
        {view.startsAt.toLocaleString("en-GB")} → {view.endsAt.toLocaleString("en-GB")}. You are
        checking yourself in for this session only.
      </Alert>

      {view.ownStatus ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
          <StatusBadge tone={view.ownStatus === "present" ? "success" : "warning"}>
            {view.ownStatus}
          </StatusBadge>
          <span className="text-sm">
            Already recorded
            {view.ownMarkedAt ? ` at ${view.ownMarkedAt.toLocaleString("en-GB")}` : ""}
            {view.ownSource === "staff" ? " by your lecturer" : ""}. Nothing further to do.
          </span>
        </div>
      ) : (
        <form action={checkInAction} className="flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <div>
            <Button type="submit">Check in now</Button>
          </div>
          <p className="text-muted-foreground text-xs">
            This only works while your lecturer&apos;s code is open, and only once. If you are
            already marked, nothing changes.
          </p>
        </form>
      )}
    </div>
  );
}
