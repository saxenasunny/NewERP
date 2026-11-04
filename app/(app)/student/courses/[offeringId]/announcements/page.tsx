import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { listAnnouncements } from "@/modules/communication/announcement-service";

export const metadata: Metadata = { title: "Announcements" };

export default async function LearnerAnnouncementsPage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const account = await requireAccountContext();
  const { offeringId } = await params;

  let list;
  try {
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

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My courses", href: "/student/courses" },
          { label: list.courseCode, href: `/student/courses/${offeringId}` },
          { label: "Announcements" },
        ]}
      />
      <PageHeader
        title={`${list.courseCode} announcements`}
        description={`${list.courseTitle} · ${list.termName}`}
        actions={
          <Link
            href={`/student/courses/${offeringId}/discussions`}
            className="text-brand-800 text-sm font-medium hover:underline"
          >
            Discussions
          </Link>
        }
      />

      {list.announcements.length === 0 ? (
        <EmptyState
          title="No announcements yet"
          description="Your lecturer has not posted anything for this course. New announcements also appear in your notification centre."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {list.announcements.map((announcement) => (
            <li key={announcement.id} className="rounded-lg border p-4">
              <div className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {announcement.pinned ? <span aria-hidden>📌</span> : null}
                  {announcement.title}
                  {announcement.pinned ? <StatusBadge tone="info">pinned</StatusBadge> : null}
                </span>
                <span className="text-muted-foreground text-sm">
                  {announcement.authorName}
                  {announcement.publishedAt
                    ? ` · ${announcement.publishedAt.toLocaleString("en-GB")}`
                    : ""}
                </span>
              </div>
              <p className="mt-3 text-sm whitespace-pre-line">{announcement.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
