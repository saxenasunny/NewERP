import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import {
  getContentWorkspace,
  listManagedCourses,
  type AuthoringItem,
} from "@/modules/content/content-service";

import { copyCourseAction, publishCourseAction, unpublishCourseAction } from "./actions";
import { ItemControls, ItemForm, ModuleControls, ModuleForm } from "./editor-forms";

export const metadata: Metadata = { title: "Course editor" };

const KIND_LABELS: Record<AuthoringItem["kind"], string> = {
  RICH_TEXT: "Rich text",
  FILE: "File",
  LINK: "Link",
  VIDEO_LINK: "Video",
};

function formatDateTime(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 16).replace("T", " ") : null;
}

function availabilityLabel(item: AuthoringItem): string | null {
  const opens = formatDateTime(item.availableFrom);
  const closes = formatDateTime(item.availableUntil);
  if (!opens && !closes) return null;
  if (opens && closes) return `Opens ${opens} · closes ${closes} UTC`;
  if (opens) return `Opens ${opens} UTC`;
  return `Closes ${closes} UTC`;
}

export default async function CourseEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error }] = await Promise.all([params, searchParams]);

  if (!account.tenant) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Course editor" />
        <Alert tone="warning" title="Choose an institution">
          Select the institution you are working in before editing courses.
        </Alert>
      </div>
    );
  }

  if (!account.permissions.has("content.create")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Course editor" />
        <PermissionDenied message="Your role cannot author course content." />
      </div>
    );
  }

  let workspace;
  try {
    workspace = await getContentWorkspace(account, offeringId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow={account.tenant.institutionName}
          title="Course editor"
          description="This course is not available to you."
        />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError
            ? caught.message
            : "The course could not be opened. Try again."}{" "}
          <Link href="/faculty/courses" className="font-medium underline">
            Back to my courses
          </Link>
          .
        </Alert>
      </div>
    );
  }

  const { access, modules, counts } = workspace;
  const returnTo = `/faculty/courses/${access.offeringId}`;
  const otherCourses = (await listManagedCourses(account)).filter(
    (course) => course.offeringId !== access.offeringId && course.moduleCount > 0,
  );

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Faculty", href: "/faculty" },
          { label: "My courses", href: "/faculty/courses" },
          { label: `${access.courseCode} · ${access.termName}` },
        ]}
      />
      <PageHeader
        eyebrow={`${access.academicYearName} · ${access.termName}${access.sectionName ? ` · Section ${access.sectionName}` : ""}`}
        title={`${access.courseCode} · ${access.courseTitle}`}
        description="Modules and lessons in the order learners see them. Publishing the course releases everything marked published."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone={access.status === "PUBLISHED" ? "success" : "info"}>
              course {access.status.toLowerCase()}
            </StatusBadge>
            <Link
              href={`/faculty/courses/${access.offeringId}/assignments`}
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Assignments
            </Link>
            <Link
              href={`/faculty/courses/${access.offeringId}/sessions`}
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Live sessions
            </Link>
            <Link
              href={`/faculty/courses/${access.offeringId}/timetable`}
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Timetable
            </Link>
            <Link
              href={`/faculty/courses/${access.offeringId}/attendance`}
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Attendance report
            </Link>
            <Link
              href={`/faculty/courses/${access.offeringId}/announcements`}
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Announcements
            </Link>
            <Link
              href={`/faculty/courses/${access.offeringId}/discussions`}
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Discussions
            </Link>
            <Link
              href={`/faculty/courses/${access.offeringId}/messages`}
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Messages
            </Link>
            <Link
              href={`/faculty/courses/${access.offeringId}/outcomes`}
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Outcomes
            </Link>
            <Link
              href={`/faculty/courses/${access.offeringId}/certificates`}
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Certificates
            </Link>
            <Link
              href={`/faculty/courses/${access.offeringId}/gradebook`}
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Gradebook
            </Link>
            <Link
              href={`/faculty/courses/${access.offeringId}/preview`}
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Preview as learner
            </Link>
          </div>
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

      <section aria-labelledby="publish-heading" className="flex flex-col gap-3">
        <h2 id="publish-heading" className="text-ink text-lg font-semibold">
          Publication
        </h2>
        <div className="rounded-card border-border bg-surface shadow-card flex flex-col gap-4 border p-4 sm:p-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-ink-muted text-xs uppercase">Modules</dt>
              <dd className="text-ink text-2xl font-semibold">{counts.modules}</dd>
            </div>
            <div>
              <dt className="text-ink-muted text-xs uppercase">Items</dt>
              <dd className="text-ink text-2xl font-semibold">{counts.items}</dd>
            </div>
            <div>
              <dt className="text-ink-muted text-xs uppercase">Published items</dt>
              <dd className="text-ink text-2xl font-semibold">{counts.publishedItems}</dd>
            </div>
            <div>
              <dt className="text-ink-muted text-xs uppercase">Files</dt>
              <dd className="text-ink text-2xl font-semibold">{counts.files}</dd>
            </div>
          </dl>
          <p className="text-ink-muted text-sm">
            Published items are visible to enrolled learners only while the course itself is
            published. Unpublishing hides the course without deleting anything.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={publishCourseAction}>
              <input type="hidden" name="offeringId" value={access.offeringId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button type="submit" size="sm">
                {access.status === "PUBLISHED" ? "Re-publish all items" : "Publish course"}
              </Button>
            </form>
            {access.status === "PUBLISHED" ? (
              <form action={unpublishCourseAction}>
                <input type="hidden" name="offeringId" value={access.offeringId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <Button type="submit" variant="secondary" size="sm">
                  Unpublish course
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="modules-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="modules-heading" className="text-ink text-lg font-semibold">
            Content
          </h2>
          <p className="text-ink-muted max-w-3xl text-sm">
            Order is saved on the server: use move up and move down, then refresh to confirm. A
            module with prerequisites stays locked for learners until those modules are complete.
          </p>
        </div>

        {modules.length === 0 ? (
          <EmptyState
            title="No modules yet"
            description="Add the first module, then add lessons, files, links, or videos inside it."
          />
        ) : (
          <ol className="flex flex-col gap-4">
            {modules.map((module, moduleIndex) => (
              <li
                key={module.id}
                className="rounded-card border-border bg-surface shadow-card flex flex-col gap-4 border p-4 sm:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-ink text-base font-semibold">
                      <span className="text-ink-muted mr-2">{module.position}.</span>
                      {module.title}
                    </h3>
                    {module.description ? (
                      <p className="text-ink-muted text-sm">{module.description}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={module.status === "PUBLISHED" ? "success" : "neutral"}>
                        {module.status.toLowerCase()}
                      </StatusBadge>
                      {module.prerequisiteModuleIds.length > 0 ? (
                        <StatusBadge tone="warning">
                          locked until{" "}
                          {module.prerequisiteModuleIds
                            .map((id) => modules.find((candidate) => candidate.id === id)?.title)
                            .filter(Boolean)
                            .join(", ")}
                        </StatusBadge>
                      ) : null}
                      <span className="text-ink-muted text-xs">
                        {module.items.length} item{module.items.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <ModuleControls
                    offeringId={access.offeringId}
                    module={module}
                    index={moduleIndex}
                    total={modules.length}
                    returnTo={returnTo}
                  />
                </div>

                {module.items.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {module.items.map((item, itemIndex) => (
                      <li
                        key={item.id}
                        className="border-border bg-surface-muted/40 rounded-lg border p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex flex-col gap-1">
                            <p className="text-ink text-sm font-medium">
                              {item.position}. {item.title}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge tone="neutral">{KIND_LABELS[item.kind]}</StatusBadge>
                              <StatusBadge
                                tone={item.status === "PUBLISHED" ? "success" : "neutral"}
                              >
                                {item.status.toLowerCase()}
                              </StatusBadge>
                              {item.hasFile ? (
                                <span className="text-ink-muted text-xs">
                                  {item.fileName ?? "file"} ·{" "}
                                  {Math.max(1, Math.round((item.fileSize ?? 0) / 1024))} KB
                                </span>
                              ) : null}
                              {item.url ? (
                                <a
                                  href={item.url}
                                  className="text-brand-800 text-xs font-medium hover:underline"
                                  target="_blank"
                                  rel="noreferrer noopener"
                                >
                                  Open link
                                </a>
                              ) : null}
                              {availabilityLabel(item) ? (
                                <span className="text-ink-muted text-xs">
                                  {availabilityLabel(item)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <ItemControls
                            offeringId={access.offeringId}
                            item={item}
                            index={itemIndex}
                            total={module.items.length}
                            returnTo={returnTo}
                          />
                        </div>
                        <div className="mt-3">
                          <ItemForm
                            offeringId={access.offeringId}
                            moduleId={module.id}
                            item={item}
                            returnTo={returnTo}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-muted text-sm">
                    No lessons in this module yet. Learners see an empty section until you add one.
                  </p>
                )}

                <ItemForm offeringId={access.offeringId} moduleId={module.id} returnTo={returnTo} />
              </li>
            ))}
          </ol>
        )}

        <ModuleForm offeringId={access.offeringId} modules={modules} returnTo={returnTo} />
      </section>

      {modules.length === 0 && otherCourses.length > 0 ? (
        <section aria-labelledby="copy-heading" className="flex flex-col gap-3">
          <h2 id="copy-heading" className="text-ink text-lg font-semibold">
            Copy content from another course
          </h2>
          <form
            action={copyCourseAction}
            className="rounded-card border-border bg-surface shadow-card flex flex-col gap-3 border p-4 sm:flex-row sm:items-end sm:p-6"
          >
            <input type="hidden" name="offeringId" value={access.offeringId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="flex-1">
              <Select id="copy-source" name="sourceOfferingId" label="Copy from" required>
                {otherCourses.map((course) => (
                  <option key={course.offeringId} value={course.offeringId}>
                    {course.courseCode} · {course.courseTitle} · {course.academicYearName}{" "}
                    {course.termName}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Copy modules and items
            </Button>
          </form>
          <p className="text-ink-muted text-sm">
            Copies modules, items, prerequisites, and file attachments. Enrolments, instructors, and
            learner progress are never copied.
          </p>
        </section>
      ) : null}
    </div>
  );
}
