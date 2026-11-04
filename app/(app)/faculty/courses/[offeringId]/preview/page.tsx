import type { Metadata } from "next";
import Link from "next/link";

import { CourseView } from "@/components/courses/course-view";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PageHeader } from "@/components/ui/page-header";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getCourseView } from "@/modules/content/delivery-service";

export const metadata: Metadata = { title: "Course preview" };

export default async function CoursePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { item }] = await Promise.all([params, searchParams]);

  let course;
  try {
    course = await getCourseView(account, offeringId, { itemId: item, mode: "preview" });
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Course preview" description="This preview is not available." />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError
            ? caught.message
            : "The preview could not be opened. Try again."}{" "}
          <Link href={`/faculty/courses/${offeringId}`} className="font-medium underline">
            Back to the editor
          </Link>
          .
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Faculty", href: "/faculty" },
          { label: "My courses", href: "/faculty/courses" },
          { label: course.offering.courseCode, href: `/faculty/courses/${offeringId}` },
          { label: "Preview" },
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-muted text-sm">
          Previewing with teacher visibility: drafts and future lessons are shown as open.
        </p>
        <Link
          href={`/faculty/courses/${offeringId}`}
          className="text-brand-800 text-sm font-medium hover:underline"
        >
          Back to the editor
        </Link>
      </div>
      <CourseView
        course={course}
        baseHref={`/faculty/courses/${offeringId}/preview`}
        requestedItemId={item}
      />
    </div>
  );
}
