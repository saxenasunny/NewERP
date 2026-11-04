import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getThread } from "@/modules/communication/discussion-service";

import { replyAction } from "../actions";

export const metadata: Metadata = { title: "Discussion" };

export default async function LearnerThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string; threadId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId, threadId }, { notice, error }] = await Promise.all([params, searchParams]);

  let detail;
  try {
    detail = await getThread(account, threadId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Discussion" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "This discussion could not be opened."}
        </Alert>
      </div>
    );
  }

  const { thread, posts } = detail;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My courses", href: "/student/courses" },
          { label: detail.courseCode, href: `/student/courses/${offeringId}` },
          { label: "Discussions", href: `/student/courses/${offeringId}/discussions` },
          { label: "Thread" },
        ]}
      />
      <PageHeader
        title={thread.title}
        description={`${thread.authorName} · ${thread.createdAt.toLocaleString("en-GB")}`}
        actions={
          thread.status === "locked" ? <StatusBadge tone="warning">locked</StatusBadge> : null
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

      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{thread.authorName}</span>
          <span className="text-muted-foreground text-sm">
            {thread.createdAt.toLocaleString("en-GB")}
          </span>
        </div>
        <p className="mt-3 text-sm whitespace-pre-line">{thread.body}</p>
      </section>

      {posts.length === 0 ? (
        <p className="text-muted-foreground text-sm">No replies yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {posts.map((post) => (
            <li key={post.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{post.authorName}</span>
                <span className="text-muted-foreground text-sm">
                  {post.createdAt.toLocaleString("en-GB")}
                </span>
              </div>
              <p className="mt-3 text-sm whitespace-pre-line">{post.body}</p>
            </li>
          ))}
        </ul>
      )}

      {detail.canReply ? (
        <section className="rounded-lg border p-5">
          <h2 className="mb-3 text-base font-semibold">Reply</h2>
          <form action={replyAction} className="flex flex-col gap-4">
            <input type="hidden" name="offeringId" value={offeringId} />
            <input type="hidden" name="threadId" value={thread.id} />
            <Textarea id="reply-body" label="Your reply" name="body" rows={4} required />
            <div className="flex justify-end">
              <Button type="submit">Post reply</Button>
            </div>
          </form>
        </section>
      ) : (
        <Alert tone="info" title="Replies are closed">
          A moderator has locked this discussion. You can still read it.
        </Alert>
      )}

      <Link
        href={`/student/courses/${offeringId}/discussions`}
        className="text-brand-800 text-sm font-medium hover:underline"
      >
        Back to discussions
      </Link>
    </div>
  );
}
