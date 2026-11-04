import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PermissionDenied } from "@/components/permission-denied";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { requireAccountContext } from "@/lib/auth/account";
import { listLearnerCourses } from "@/modules/content/delivery-service";

export const metadata: Metadata = { title: "My courses" };

export default async function StudentCoursesPage() {
  const account = await requireAccountContext();
  if (!account.tenant) redirect(account.homePath);

  if (!account.permissions.has("courses.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="My courses" />
        <PermissionDenied message="Your role cannot view courses." />
      </div>
    );
  }

  const courses = await listLearnerCourses(account);

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs items={[{ label: "My learning", href: "/student" }, { label: "My courses" }]} />
      <PageHeader
        eyebrow={account.tenant.institutionName}
        title="My courses"
        description="Courses you are actively enrolled in. Only published lessons that are open to you appear inside."
      />

      {courses.length === 0 ? (
        <EmptyState
          title="No published courses yet"
          description="You are enrolled in a course once an administrator or an import adds you to a course offering, and it becomes available when the teacher publishes it."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {courses.map((course) => {
            const percent =
              course.itemCount > 0
                ? Math.round((course.completedCount / course.itemCount) * 100)
                : 0;
            return (
              <li
                key={course.offeringId}
                className="rounded-card border-border bg-surface shadow-card flex flex-col gap-3 border p-4 sm:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-ink text-lg font-semibold">
                      <Link
                        href={`/student/courses/${course.offeringId}`}
                        className="hover:underline"
                      >
                        {course.courseCode} · {course.courseTitle}
                      </Link>
                    </h2>
                    <p className="text-ink-muted text-sm">
                      {course.academicYearName} · {course.termName}
                      {course.instructorNames.length > 0
                        ? ` · ${course.instructorNames.join(", ")}`
                        : ""}
                    </p>
                  </div>
                  <StatusBadge tone={percent === 100 ? "success" : "info"}>{percent}%</StatusBadge>
                </div>
                <p className="text-ink-muted text-sm">
                  {course.completedCount} of {course.itemCount} lessons complete
                  {course.lastActivityAt
                    ? ` · last activity ${course.lastActivityAt.toISOString().slice(0, 10)}`
                    : ""}
                </p>
                <progress
                  className="h-2 w-full overflow-hidden rounded-full"
                  value={course.completedCount}
                  max={course.itemCount || 1}
                  aria-label={`Progress in ${course.courseCode}`}
                >
                  {percent}%
                </progress>
                <Link
                  href={`/student/courses/${course.offeringId}`}
                  className="text-brand-800 text-sm font-medium hover:underline"
                >
                  Open course
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
