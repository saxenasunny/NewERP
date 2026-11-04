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

export default async function LearnerDiscussionsPage({
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
          { label: "My courses", href: "/student/courses" },
          { label: list.courseCode, href: `/student/courses/${offeringId}` },
          { label: "Discussions" },
        ]}
      />
      <PageHeader
        title={`${list.courseCode} discussions`}
        description={`${list.courseTitle} · ${list.termName}`}
        actions={
          <Link
            href={`/student/courses/${offeringId}/announcements`}
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
        <h2 className="mb-1 text-base font-semibold">Ask a question</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Staff and classmates in this course can see your thread and reply to it.
        </p>
        <form action={createThreadAction} className="flex flex-col gap-4">
          <input type="hidden" name="offeringId" value={offeringId} />
          <Input id="thread-title" label="Subject" name="title" required minLength={3} />
          <Textarea id="thread-body" label="Question" name="body" rows={4} required />
          <div className="flex justify-end">
            <Button type="submit">Post thread</Button>
          </div>
        </form>
      </section>

      {list.threads.length === 0 ? (
        <EmptyState
          title="No discussions yet"
          description="Start the first thread; your lecturer and classmates can reply."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {list.threads.map((thread) => (
            <li key={thread.id} className="rounded-lg border p-4">
              <Link
                href={`/student/courses/${offeringId}/discussions/${thread.id}`}
                className="flex flex-wrap items-center gap-2 font-medium hover:underline"
              >
                {thread.pinned ? <span aria-hidden>📌</span> : null}
                {thread.title}
                {thread.status === "locked" ? (
                  <StatusBadge tone={STATUS_TONES.locked}>locked</StatusBadge>
                ) : null}
              </Link>
              <span className="text-muted-foreground mt-1 block text-sm">
                {thread.authorName} · {thread.postCount} repl
                {thread.postCount === 1 ? "y" : "ies"} · last activity{" "}
                {thread.lastActivityAt.toLocaleString("en-GB")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
