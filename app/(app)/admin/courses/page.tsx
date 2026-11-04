import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { listCourses, type CourseSummary } from "@/modules/academics/course-service";

import { createCourseAction, setCourseStatusAction, updateCourseAction } from "./actions";

export const metadata: Metadata = { title: "Course catalogue" };

const STATUS_TONES: Record<CourseSummary["status"], BadgeTone> = {
  DRAFT: "info",
  ACTIVE: "success",
  ARCHIVED: "warning",
};

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const { edit, notice, error } = await searchParams;

  if (!account.permissions.has("courses.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Course catalogue" />
        <PermissionDenied message="Your role cannot view the course catalogue." />
      </div>
    );
  }

  const courses = await listCourses(account);
  const canCreate = account.permissions.has("courses.create");
  const canUpdate = account.permissions.has("courses.update");
  const editing: CourseSummary | undefined = edit
    ? courses.find((course) => course.id === edit)
    : undefined;
  const returnTo = "/admin/courses";

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs items={[{ label: "Overview", href: "/admin" }, { label: "Course catalogue" }]} />
      <PageHeader
        eyebrow={account.tenant?.institutionName ?? "Institution"}
        title="Course catalogue"
        description="Catalogue entries describe a course. They are scheduled into terms as course offerings, where instructors and learners are attached."
        actions={
          <Link
            href="/admin/offerings"
            className="text-brand-800 text-sm font-medium hover:underline"
          >
            View offerings
          </Link>
        }
      />

      {notice ? (
        <Alert tone="success" title="Saved">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Could not save">
          {error}
        </Alert>
      ) : null}

      {canCreate || canUpdate ? (
        <form
          action={editing ? updateCourseAction : createCourseAction}
          className="rounded-card border-border bg-surface shadow-card grid gap-4 border p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <input type="hidden" name="returnTo" value={returnTo} />
          <Input
            id="course-code"
            name="code"
            label="Course code"
            placeholder="CS101"
            defaultValue={editing?.code}
            required
          />
          <Input
            id="course-title"
            name="title"
            label="Title"
            defaultValue={editing?.title}
            required
          />
          <Input
            id="course-credits"
            name="credits"
            type="number"
            step="0.5"
            min="0.5"
            max="60"
            label="Credits"
            defaultValue={editing?.credits}
            required
          />
          <Button type="submit">{editing ? "Save course" : "Add to catalogue"}</Button>
          <div className="sm:col-span-2 lg:col-span-3">
            <Textarea
              id="course-description"
              name="description"
              label="Description"
              hint="Optional. Shown to staff; students see course content after enrolment."
              defaultValue={editing?.description ?? ""}
            />
          </div>
          {editing ? (
            <Link
              href={returnTo}
              className="text-ink-muted self-center text-sm font-medium hover:underline"
            >
              Cancel edit
            </Link>
          ) : null}
        </form>
      ) : null}

      {courses.length === 0 ? (
        <EmptyState
          title="The catalogue is empty"
          description="Add the first course; it stays in draft until you mark it active."
        />
      ) : (
        <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Course catalogue</caption>
            <thead className="bg-surface-muted">
              <tr>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Course
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Credits
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Offerings
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Status
                </th>
                <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.id} className="border-border border-t align-top">
                  <td className="px-3 py-3 text-sm">
                    <p className="text-ink font-medium">
                      {course.code} · {course.title}
                    </p>
                    {course.description ? (
                      <p className="text-ink-muted mt-1 max-w-prose">{course.description}</p>
                    ) : null}
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{course.credits}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm">
                    {course.offeringCount === 0 ? (
                      "Not scheduled"
                    ) : (
                      <Link
                        href={`/admin/offerings?course=${course.id}`}
                        className="text-brand-800 hover:underline"
                      >
                        {course.offeringCount}
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={STATUS_TONES[course.status]}>
                      {course.status.toLowerCase()}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {canUpdate ? (
                        <Link
                          href={`${returnTo}?edit=${course.id}`}
                          className="text-brand-800 text-sm font-medium hover:underline"
                        >
                          Edit
                        </Link>
                      ) : null}
                      {canUpdate ? (
                        <form action={setCourseStatusAction} className="inline-flex">
                          <input type="hidden" name="id" value={course.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={
                              course.status === "ARCHIVED"
                                ? "ACTIVE"
                                : course.status === "DRAFT"
                                  ? "ACTIVE"
                                  : "ARCHIVED"
                            }
                          />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <Button variant="ghost" size="sm">
                            {course.status === "ARCHIVED"
                              ? "Restore"
                              : course.status === "DRAFT"
                                ? "Activate"
                                : "Archive"}
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
