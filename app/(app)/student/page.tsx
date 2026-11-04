import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RoleDashboard } from "@/components/dashboards/role-dashboard";
import { requireAccountContext } from "@/lib/auth/account";
import { listLearnerCourses } from "@/modules/content/delivery-service";

export const metadata: Metadata = { title: "My learning" };

export default async function StudentDashboardPage() {
  const account = await requireAccountContext();
  if (!account.tenant) redirect(account.homePath);

  const courses = account.permissions.has("courses.read") ? await listLearnerCourses(account) : [];

  return (
    <RoleDashboard
      account={account}
      emptyTitle={courses.length === 0 ? "No enrolments" : "Nothing due yet"}
      emptyDescription={
        courses.length === 0
          ? "An administrator, an import, or a teacher enrols you in a course offering. Published courses then appear under My courses."
          : "Assignments from your enrolled courses appear under Assignments. Published lessons are available now."
      }
    >
      {courses.length > 0 ? (
        <section className="rounded-card border-border bg-surface shadow-card flex flex-col gap-3 border p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-ink text-lg font-semibold">Continue learning</h2>
              <p className="text-ink-muted text-sm">
                {courses.length} published course{courses.length === 1 ? "" : "s"} this term.
              </p>
            </div>
            <Link
              href="/student/courses"
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              All my courses
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {courses.slice(0, 3).map((course) => (
              <li key={course.offeringId} className="text-ink-muted text-sm">
                <Link
                  href={`/student/courses/${course.offeringId}`}
                  className="text-brand-800 font-medium hover:underline"
                >
                  {course.courseCode} · {course.courseTitle}
                </Link>{" "}
                — {course.completedCount} of {course.itemCount} lessons complete
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </RoleDashboard>
  );
}
