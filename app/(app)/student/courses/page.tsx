import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PermissionDenied } from "@/components/permission-denied";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { AttendanceHealthBadge } from "@/components/attendance/attendance-health-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { getLearnerAttendanceSummary } from "@/modules/attendance/health-service";
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

  const [courses, attendanceSummary] = await Promise.all([
    listLearnerCourses(account),
    getLearnerAttendanceSummary(account).catch(() => ({
      overall: {
        percentage: null,
        formattedPercentage: "N/A",
        status: "unrecorded" as const,
        attended: 0,
        recorded: 0,
        absent: 0,
        excused: 0,
        unmarked: 0,
        totalConducted: 0,
        classesNeededToSafe: 0,
        classesCanMiss: 0,
        isDebarred: false,
        message: "No attendance recorded yet.",
      },
      courses: [],
    })),
  ]);

  const attendanceByOffering = new Map(
    attendanceSummary.courses.map((c) => [c.offeringId, c.health]),
  );

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
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course, idx) => {
            const percent =
              course.itemCount > 0
                ? Math.round((course.completedCount / course.itemCount) * 100)
                : 0;

            const courseHealth = attendanceByOffering.get(course.offeringId);

            const accents = [
              { stripe: "from-brand-500 to-indigo-600", tone: "info" as const },
              { stripe: "from-emerald-500 to-teal-600", tone: "success" as const },
              { stripe: "from-violet-500 to-purple-600", tone: "brand" as const },
              { stripe: "from-amber-500 to-orange-600", tone: "warning" as const },
            ];
            const accent = accents[idx % accents.length] ?? accents[0]!;

            return (
              <div
                key={course.offeringId}
                className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lg"
              >
                <div className={`absolute inset-x-0 top-0 h-2 bg-gradient-to-r ${accent.stripe}`} />

                <div>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <span className="rounded-lg bg-surface-muted px-2.5 py-1 text-xs font-bold text-ink">
                      {course.courseCode}
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {courseHealth && courseHealth.status !== "unrecorded" ? (
                        <AttendanceHealthBadge health={courseHealth} />
                      ) : null}
                      <StatusBadge tone={percent === 100 ? "success" : percent > 0 ? "brand" : "neutral"}>
                        {percent}%
                      </StatusBadge>
                    </div>
                  </div>

                  <h2 className="text-ink group-hover:text-brand-700 mt-3 text-lg font-bold transition-colors">
                    <Link href={`/student/courses/${course.offeringId}`}>
                      {course.courseTitle}
                    </Link>
                  </h2>

                  <p className="text-ink-muted mt-1.5 text-xs">
                    {course.academicYearName} · {course.termName}
                    {course.instructorNames.length > 0
                      ? ` · ${course.instructorNames.join(", ")}`
                      : ""}
                  </p>
                </div>

                <div className="mt-6 flex flex-col gap-4">
                  <div>
                    <div className="flex justify-between text-xs font-medium text-ink-muted mb-1.5">
                      <span>{course.completedCount} of {course.itemCount} lessons complete</span>
                      <span>{percent}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${accent.stripe} transition-all duration-500`}
                        style={{ width: `${Math.max(percent, 4)}%` }}
                      />
                    </div>
                  </div>

                  {courseHealth && (courseHealth.status === "warning" || courseHealth.status === "critical") ? (
                    <div className={`rounded-xl border p-2.5 text-xs ${
                      courseHealth.status === "critical"
                        ? "bg-rose-50 border-rose-200 text-rose-800"
                        : "bg-amber-50 border-amber-200 text-amber-800"
                    }`}>
                      <p className="font-semibold">{courseHealth.message}</p>
                    </div>
                  ) : null}

                  <Link href={`/student/courses/${course.offeringId}`}>
                    <Button variant="primary" size="sm" className="w-full justify-between font-bold">
                      <span>Enter Course</span>
                      <span>→</span>
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
