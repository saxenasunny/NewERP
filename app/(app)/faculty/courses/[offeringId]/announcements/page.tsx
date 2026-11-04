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
import {
  listAnnouncements,
  type AnnouncementStatusKey,
} from "@/modules/communication/announcement-service";
import { getOfferingAccess } from "@/modules/content/content-service";

import {
  createAnnouncementAction,
  publishAnnouncementAction,
  updateAnnouncementAction,
  withdrawAnnouncementAction,
} from "./actions";

export const metadata: Metadata = { title: "Announcements" };

const STATUS_TONES: Record<AnnouncementStatusKey, BadgeTone> = {
  draft: "neutral",
  published: "success",
  withdrawn: "danger",
};

export default async function FacultyAnnouncementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error }] = await Promise.all([params, searchParams]);

  let access;
  let list;
  try {
    access = await getOfferingAccess(account, offeringId);
    list = await listAnnouncements(account, offeringId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Announcements" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "The announcements could not be loaded."}
        </Alert>
      </div>
    );
  }

  const canManage = access.canManage && account.permissions.has("announcements.manage");

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My courses", href: "/faculty/courses" },
          { label: list.courseCode, href: `/faculty/courses/${offeringId}` },
          { label: "Announcements" },
        ]}
      />
      <PageHeader
        title={`${list.courseCode} announcements`}
        description={`${list.courseTitle} · ${list.termName}. Publishing notifies every enrolled learner once, in the app and by email.`}
        actions={
          <Link
            href={`/faculty/courses/${offeringId}/discussions`}
            className="text-brand-800 text-sm font-medium hover:underline"
          >
            Discussions
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

      {canManage ? (
        <section className="rounded-lg border p-5">
          <h2 className="mb-1 text-base font-semibold">New announcement</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            Save it as a draft while you check the wording; publishing sends it to the cohort and
            cannot be undone, though it can be withdrawn.
          </p>
          <form action={createAnnouncementAction} className="flex flex-col gap-4">
            <input type="hidden" name="offeringId" value={offeringId} />
            <Input id="announcement-title" label="Title" name="title" required minLength={3} />
            <Textarea id="announcement-body" label="Message" name="body" rows={5} required />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="pinned" className="size-4" />
              Pin to the top of the course
            </label>
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="submit" name="intent" value="draft" variant="secondary">
                Save draft
              </Button>
              <Button type="submit" name="intent" value="publish">
                Publish and notify
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {list.announcements.length === 0 ? (
        <EmptyState
          title="No announcements yet"
          description="A published announcement reaches every enrolled learner in the notification centre and by email."
        />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Posted announcements</h2>
          <ul className="flex flex-col gap-3">
            {list.announcements.map((announcement) => (
              <li key={announcement.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {announcement.pinned ? <span aria-hidden>📌</span> : null}
                      {announcement.title}
                      <StatusBadge tone={STATUS_TONES[announcement.status]}>
                        {announcement.status}
                      </StatusBadge>
                    </span>
                    <span className="text-muted-foreground text-sm">
                      {announcement.authorName} ·{" "}
                      {announcement.publishedAt
                        ? `published ${announcement.publishedAt.toLocaleString("en-GB")}`
                        : `created ${announcement.createdAt.toLocaleString("en-GB")}`}
                      {announcement.withdrawnAt
                        ? ` · withdrawn ${announcement.withdrawnAt.toLocaleString("en-GB")}`
                        : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {announcement.status === "draft" ? (
                      <form action={publishAnnouncementAction}>
                        <input type="hidden" name="offeringId" value={offeringId} />
                        <input type="hidden" name="announcementId" value={announcement.id} />
                        <Button type="submit" size="sm">
                          Publish
                        </Button>
                      </form>
                    ) : null}
                    {announcement.status === "published" ? (
                      <form action={withdrawAnnouncementAction}>
                        <input type="hidden" name="offeringId" value={offeringId} />
                        <input type="hidden" name="announcementId" value={announcement.id} />
                        <Button type="submit" size="sm" variant="danger">
                          Withdraw
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </div>

                <p className="mt-3 text-sm whitespace-pre-line">{announcement.body}</p>

                {canManage && announcement.status !== "withdrawn" ? (
                  <details className="mt-3 border-t pt-3">
                    <summary className="cursor-pointer text-sm font-medium">Edit</summary>
                    <form action={updateAnnouncementAction} className="mt-3 flex flex-col gap-3">
                      <input type="hidden" name="offeringId" value={offeringId} />
                      <input type="hidden" name="announcementId" value={announcement.id} />
                      <Input
                        id={`announcement-title-${announcement.id}`}
                        label="Title"
                        name="title"
                        defaultValue={announcement.title}
                        required
                        minLength={3}
                      />
                      <Textarea
                        id={`announcement-body-${announcement.id}`}
                        label="Message"
                        name="body"
                        rows={4}
                        defaultValue={announcement.body}
                        required
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="pinned"
                          className="size-4"
                          defaultChecked={announcement.pinned}
                        />
                        Pin to the top of the course
                      </label>
                      <div className="flex justify-end">
                        <Button type="submit" size="sm" variant="secondary">
                          Save changes
                        </Button>
                      </div>
                    </form>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
