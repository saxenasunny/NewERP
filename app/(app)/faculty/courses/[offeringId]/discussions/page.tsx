import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { listThreads, type ThreadStatusKey } from "@/modules/communication/discussion-service";

import { createThreadAction } from "./actions";

export const metadata: Metadata = { title: "Discussions" };

const STATUS_TONES: Record<ThreadStatusKey, BadgeTone> = {
  open: "success",
  locked: "warning",
  hidden: "danger",
};

export default async function FacultyDiscussionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error }] = await Promise.all([params, searchParams]);

  let list;
  try {
    list = await listThreads(account, offeringId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Discussions" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "The discussions could not be loaded."}
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My courses", href: "/faculty/courses" },
          { label: list.courseCode, href: `/faculty/courses/${offeringId}` },
          { label: "Discussions" },
        ]}
      />
      <PageHeader
        title={`${list.courseCode} discussions`}
        description={`${list.courseTitle} · ${list.termName}. Learners and staff share one board; hide and lock instead of deleting so the record survives.`}
        actions={
          <Link
            href={`/faculty/courses/${offeringId}/announcements`}
            className="text-brand-800 text-sm font-medium hover:underline"
          >
            Announcements
          </Link>
        }
      />

      {notice ? (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Error">
          {error}
        </Alert>
      ) : null}

      <section className="rounded-lg border p-5">
        <h2 className="mb-1 text-base font-semibold">Start a thread</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Staff can post here too; learners see every visible thread in this course.
        </p>
        <form action={createThreadAction} className="flex flex-col gap-4">
          <input type="hidden" name="offeringId" value={offeringId} />
          <Input id="thread-title" label="Subject" name="title" required minLength={3} />
          <Textarea id="thread-body" label="Message" name="body" rows={4} required />
          <div className="flex justify-end">
            <Button type="submit">Post thread</Button>
          </div>
        </form>
      </section>

      {list.threads.length === 0 ? (
        <EmptyState
          title="No discussions yet"
          description="Threads started by you or your learners appear here, newest activity first."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {list.threads.map((thread) => (
            <li key={thread.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <Link
                    href={`/faculty/courses/${offeringId}/discussions/${thread.id}`}
                    className="flex flex-wrap items-center gap-2 font-medium hover:underline"
                  >
                    {thread.pinned ? <span aria-hidden>📌</span> : null}
                    {thread.title}
                    <StatusBadge tone={STATUS_TONES[thread.status]}>{thread.status}</StatusBadge>
                  </Link>
                  <span className="text-muted-foreground text-sm">
                    {thread.authorName} · {thread.postCount} repl
                    {thread.postCount === 1 ? "y" : "ies"} · last activity{" "}
                    {thread.lastActivityAt.toLocaleString("en-GB")}
                  </span>
                </div>
                <Link
                  href={`/faculty/courses/${offeringId}/discussions/${thread.id}`}
                  className="text-brand-800 text-sm font-medium hover:underline"
                >
                  Open &amp; moderate
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
