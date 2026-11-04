import type { Metadata } from "next";
import Link from "next/link";

import { CourseView } from "@/components/courses/course-view";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PageHeader } from "@/components/ui/page-header";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getCourseView, recordItemViewed } from "@/modules/content/delivery-service";

export const metadata: Metadata = { title: "Course" };

export default async function StudentCoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ item?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { item, error }] = await Promise.all([params, searchParams]);

  let course;
  try {
    course = await getCourseView(account, offeringId, { itemId: item });
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Course" description="This course is not available to you." />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError
            ? caught.message
            : "The course could not be opened. Try again."}{" "}
          <Link href="/student/courses" className="font-medium underline">
            Back to my courses
          </Link>
          .
        </Alert>
      </div>
    );
  }

  // Opening an open lesson is the learning event; a failure here must not stop
  // the lesson from being read.
  if (course.mode === "learner" && course.activeItem) {
    await recordItemViewed(account, course.activeItem.id).catch(() => undefined);
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My learning", href: "/student" },
          { label: "My courses", href: "/student/courses" },
          { label: course.offering.courseCode },
        ]}
      />
      {error ? (
        <Alert tone="danger" title="Could not save">
          {error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-4 text-sm">
        <Link
          href={`/student/courses/${offeringId}/quizzes`}
          className="text-brand-800 font-medium hover:underline"
        >
          Quizzes
        </Link>
        <Link
          href={`/student/courses/${offeringId}/sessions`}
          className="text-brand-800 font-medium hover:underline"
        >
          Live sessions
        </Link>
        <Link
          href={`/student/courses/${offeringId}/announcements`}
          className="text-brand-800 font-medium hover:underline"
        >
          Announcements
        </Link>
        <Link
          href={`/student/courses/${offeringId}/discussions`}
          className="text-brand-800 font-medium hover:underline"
        >
          Discussions
        </Link>
        <Link
          href={`/student/courses/${offeringId}/messages`}
          className="text-brand-800 font-medium hover:underline"
        >
          Messages
        </Link>
        <Link
          href={`/student/courses/${offeringId}/grades`}
          className="text-brand-800 font-medium hover:underline"
        >
          My grades
        </Link>
      </div>
      <CourseView
        course={course}
        baseHref={`/student/courses/${offeringId}`}
        requestedItemId={item}
      />
    </div>
  );
}
