import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RoleDashboard } from "@/components/dashboards/role-dashboard";
import { requireAccountContext } from "@/lib/auth/account";
import { listManagedCourses } from "@/modules/content/content-service";

export const metadata: Metadata = { title: "Faculty dashboard" };

export default async function FacultyDashboardPage() {
  const account = await requireAccountContext();
  if (!account.tenant) redirect(account.homePath);

  const canAuthor =
    account.permissions.has("content.create") || account.permissions.has("courses.update");
  const courses = canAuthor ? await listManagedCourses(account) : [];
  const draftCourses = courses.filter((course) => course.offeringStatus !== "PUBLISHED").length;

  return (
    <RoleDashboard
      account={account}
      emptyTitle={courses.length === 0 ? "No assigned courses" : "No submissions to grade yet"}
      emptyDescription={
        courses.length === 0
          ? "An administrator assigns you to a course offering from the offering screen. Its content editor then appears under My courses."
          : "Create an assignment from one of your courses. Submissions and grading appear here once learners start work."
      }
    >
      {courses.length > 0 ? (
        <section className="rounded-card border-border bg-surface shadow-card border p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-ink text-lg font-semibold">Teaching this term</h2>
              <p className="text-ink-muted text-sm">
                {courses.length} course{courses.length === 1 ? "" : "s"} ·{" "}
                {courses.reduce((total, course) => total + course.learnerCount, 0)} active learner
                {courses.reduce((total, course) => total + course.learnerCount, 0) === 1 ? "" : "s"}
                {draftCourses > 0 ? ` · ${draftCourses} unpublished` : ""}
              </p>
            </div>
            <Link
              href="/faculty/courses"
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Open my courses
            </Link>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {courses.slice(0, 3).map((course) => (
              <li key={course.offeringId} className="text-ink-muted text-sm">
                <Link
                  href={`/faculty/courses/${course.offeringId}`}
                  className="text-brand-800 font-medium hover:underline"
                >
                  {course.courseCode} · {course.courseTitle}
                </Link>{" "}
                — {course.moduleCount} module{course.moduleCount === 1 ? "" : "s"},{" "}
                {course.itemCount} item{course.itemCount === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </RoleDashboard>
  );
}
