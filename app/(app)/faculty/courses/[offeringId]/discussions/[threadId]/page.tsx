import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getThread, type ThreadStatusKey } from "@/modules/communication/discussion-service";

import { moderatePostAction, moderateThreadAction, replyAction } from "../actions";

export const metadata: Metadata = { title: "Discussion" };

const STATUS_TONES: Record<ThreadStatusKey, BadgeTone> = {
  open: "success",
  locked: "warning",
  hidden: "danger",
};

export default async function FacultyThreadPage({
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
          { label: "My courses", href: "/faculty/courses" },
          { label: detail.courseCode, href: `/faculty/courses/${offeringId}` },
          { label: "Discussions", href: `/faculty/courses/${offeringId}/discussions` },
          { label: "Thread" },
        ]}
      />
      <PageHeader
        title={thread.title}
        description={`${thread.authorName} · ${thread.createdAt.toLocaleString("en-GB")} · ${detail.courseCode} ${detail.termName}`}
        actions={
          <StatusBadge tone={STATUS_TONES[thread.status]}>
            {thread.pinned ? "pinned · " : ""}
            {thread.status}
          </StatusBadge>
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

      {detail.canModerate ? (
        <section className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
          <form action={moderateThreadAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="offeringId" value={offeringId} />
            <input type="hidden" name="threadId" value={thread.id} />
            <input type="hidden" name="intent" value={thread.pinned ? "unpin" : "pin"} />
            <Button type="submit" size="sm" variant="secondary">
              {thread.pinned ? "Unpin" : "Pin"}
            </Button>
          </form>
          {thread.status !== "locked" ? (
            <form action={moderateThreadAction}>
              <input type="hidden" name="offeringId" value={offeringId} />
              <input type="hidden" name="threadId" value={thread.id} />
              <input type="hidden" name="intent" value="lock" />
              <Button type="submit" size="sm" variant="secondary">
                Lock replies
              </Button>
            </form>
          ) : null}
          {thread.status !== "open" ? (
            <form action={moderateThreadAction}>
              <input type="hidden" name="offeringId" value={offeringId} />
              <input type="hidden" name="threadId" value={thread.id} />
              <input type="hidden" name="intent" value="reopen" />
              <Button type="submit" size="sm" variant="secondary">
                Reopen
              </Button>
            </form>
          ) : null}
          {thread.status !== "hidden" ? (
            <form action={moderateThreadAction}>
              <input type="hidden" name="offeringId" value={offeringId} />
              <input type="hidden" name="threadId" value={thread.id} />
              <input type="hidden" name="intent" value="hide" />
              <Button type="submit" size="sm" variant="danger">
                Hide thread
              </Button>
            </form>
          ) : null}
        </section>
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
            <li
              key={post.id}
              className={`rounded-lg border p-4 ${post.status === "hidden" ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {post.authorName}
                  {post.status === "hidden" ? (
                    <StatusBadge tone="danger">hidden</StatusBadge>
                  ) : null}
                </span>
                <span className="text-muted-foreground text-sm">
                  {post.createdAt.toLocaleString("en-GB")}
                </span>
              </div>
              <p className="mt-3 text-sm whitespace-pre-line">{post.body}</p>
              {detail.canModerate ? (
                <form action={moderatePostAction} className="mt-3 flex justify-end">
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <input type="hidden" name="threadId" value={thread.id} />
                  <input type="hidden" name="postId" value={post.id} />
                  <input
                    type="hidden"
                    name="intent"
                    value={post.status === "hidden" ? "restore" : "hide"}
                  />
                  <Button type="submit" size="sm" variant="secondary">
                    {post.status === "hidden" ? "Restore reply" : "Hide reply"}
                  </Button>
                </form>
              ) : null}
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
          This thread is {thread.status}. Reopen it to allow new replies.
        </Alert>
      )}

      <Link
        href={`/faculty/courses/${offeringId}/discussions`}
        className="text-brand-800 text-sm font-medium hover:underline"
      >
        Back to discussions
      </Link>
    </div>
  );
}
