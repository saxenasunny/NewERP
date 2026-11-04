import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { listManagedCourses, type ManagedCourse } from "@/modules/content/content-service";

export const metadata: Metadata = { title: "My courses" };

const STATUS_TONES: Record<ManagedCourse["offeringStatus"], BadgeTone> = {
  DRAFT: "info",
  PUBLISHED: "success",
  CLOSED: "warning",
};

export default async function FacultyCoursesPage() {
  const account = await requireAccountContext();
  if (!account.tenant) redirect(account.homePath);

  if (!account.permissions.has("content.create") && !account.permissions.has("courses.update")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="My courses" />
        <PermissionDenied message="Your role does not author course content. Ask an institution administrator if you need access." />
      </div>
    );
  }

  const courses = await listManagedCourses(account);

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs items={[{ label: "Faculty", href: "/faculty" }, { label: "My courses" }]} />
      <PageHeader
        eyebrow={account.tenant.institutionName}
        title="My courses"
        description="Build modules and lessons, publish them when they are ready, and preview exactly what enrolled learners will see."
      />

      {courses.length === 0 ? (
        <EmptyState
          title="No courses assigned"
          description="An administrator assigns you to a course offering from the offering screen. Once assigned, its content editor appears here."
        />
      ) : (
        <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Course offerings you can author</caption>
            <thead className="bg-surface-muted">
              <tr>
                {["Course", "Term", "Section", "Modules", "Items", "Learners", "Status", ""].map(
                  (heading) => (
                    <th
                      key={heading || "actions"}
                      scope="col"
                      className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                    >
                      {heading || <span className="sr-only">Actions</span>}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.offeringId} className="border-border border-t">
                  <td className="px-3 py-3">
                    <Link
                      href={`/faculty/courses/${course.offeringId}`}
                      className="text-brand-800 text-sm font-medium hover:underline"
                    >
                      {course.courseCode} · {course.courseTitle}
                    </Link>
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">
                    {course.academicYearName} · {course.termName}
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{course.sectionName ?? "—"}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{course.moduleCount}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{course.itemCount}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{course.learnerCount}</td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={STATUS_TONES[course.offeringStatus]}>
                      {course.offeringStatus.toLowerCase()}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link
                      href={`/faculty/courses/${course.offeringId}`}
                      className="text-brand-800 text-sm font-medium hover:underline"
                    >
                      Edit content
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Alert tone="info" title="What learners can see">
        A learner sees a lesson only when the course is published, the lesson is published, it is
        inside its availability window, and any prerequisite modules are complete. Drafts never
        leave the editor.
      </Alert>
    </div>
  );
}
