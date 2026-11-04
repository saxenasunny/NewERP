import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { completeItemAction, reopenItemAction } from "@/modules/content/delivery-actions";
import type { LearnerCourse, LearnerItem } from "@/modules/content/delivery-service";
import { cleanRichText } from "@/modules/content/rich-text";

const STATE_LABELS: Record<LearnerItem["state"], { label: string; tone: BadgeTone }> = {
  open: { label: "available", tone: "success" },
  not_yet: { label: "opens later", tone: "info" },
  closed: { label: "closed", tone: "warning" },
  locked: { label: "locked", tone: "neutral" },
};

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 16).replace("T", " ") : "";
}

function fileSizeLabel(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ItemContent({ item }: { item: LearnerItem }) {
  if (item.kind === "RICH_TEXT") {
    const html = cleanRichText(item.body);
    return html ? (
      <div
        className="text-ink [&_a]:text-brand-800 [&_blockquote]:border-border-strong [&_pre]:bg-surface-muted flex flex-col gap-3 text-base leading-relaxed [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:p-3"
        // Sanitised on write and again above; scripts, styles, and event handlers
        // are not in the allowlist.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    ) : (
      <p className="text-ink-muted text-sm">This lesson has no text yet.</p>
    );
  }

  if (item.kind === "LINK" || item.kind === "VIDEO_LINK") {
    return item.url ? (
      <div className="flex flex-col gap-3">
        <p className="text-ink-muted text-sm">
          {item.kind === "VIDEO_LINK"
            ? "This lesson opens a video hosted elsewhere."
            : "This lesson opens an external resource."}
        </p>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-brand-800 text-sm font-medium underline"
        >
          Open {item.kind === "VIDEO_LINK" ? "video" : "link"} in a new tab
        </a>
      </div>
    ) : (
      <p className="text-ink-muted text-sm">No link has been added to this lesson.</p>
    );
  }

  return item.fileName ? (
    <div className="flex flex-col gap-2">
      <p className="text-ink text-sm font-medium">{item.fileName}</p>
      <p className="text-ink-muted text-sm">{fileSizeLabel(item.fileSize)} · private download</p>
      <a
        href={`/api/v1/content/${item.id}/file`}
        className="text-brand-800 w-fit text-sm font-medium underline"
      >
        Download file
      </a>
    </div>
  ) : (
    <p className="text-ink-muted text-sm">No file has been attached to this lesson.</p>
  );
}

/**
 * Shared learner view for a course offering. `baseHref` keeps the links inside
 * the caller's section, and `mode` decides whether progress controls appear.
 */
export function CourseView({
  course,
  baseHref,
  requestedItemId,
}: {
  course: LearnerCourse;
  baseHref: string;
  requestedItemId?: string;
}) {
  const { activeItem, offering, modules, progress, mode } = course;
  const requestedButUnavailable = Boolean(requestedItemId) && !activeItem;
  const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      {mode === "preview" ? (
        <Alert tone="info" title="Preview mode">
          You are seeing this course as a learner would, including drafts. Learner progress is not
          recorded from a preview.
        </Alert>
      ) : null}

      <div className="rounded-card border-border bg-surface shadow-card flex flex-col gap-3 border p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-ink-muted text-xs uppercase">
              {offering.academicYearName} · {offering.termName}
              {offering.sectionName ? ` · Section ${offering.sectionName}` : ""}
            </p>
            <h2 className="text-ink text-2xl font-semibold">
              {offering.courseCode} · {offering.courseTitle}
            </h2>
            <p className="text-ink-muted text-sm">
              {offering.credits} credits
              {offering.instructorNames.length > 0
                ? ` · ${offering.instructorNames.join(", ")}`
                : ""}
            </p>
          </div>
          <StatusBadge tone={offering.status === "PUBLISHED" ? "success" : "info"}>
            course {offering.status.toLowerCase()}
          </StatusBadge>
        </div>

        <div className="flex flex-col gap-1">
          <div className="text-ink-muted flex items-center justify-between text-sm">
            <span>
              {progress.completed} of {progress.total} lessons complete
            </span>
            <span>{percent}%</span>
          </div>
          <progress
            className="h-2 w-full overflow-hidden rounded-full"
            value={progress.completed}
            max={progress.total || 1}
            aria-label="Course progress"
          >
            {percent}%
          </progress>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <nav aria-label="Course contents" className="flex flex-col gap-4">
          {modules.length === 0 ? (
            <p className="text-ink-muted text-sm">No content has been published yet.</p>
          ) : (
            modules.map((module) => (
              <section key={module.id} className="rounded-card border-border border p-3">
                <h3 className="text-ink flex items-center justify-between gap-2 text-sm font-semibold">
                  <span>
                    {module.position}. {module.title}
                  </span>
                  {module.locked ? <StatusBadge tone="neutral">locked</StatusBadge> : null}
                </h3>
                {module.description ? (
                  <p className="text-ink-muted mt-1 text-xs">{module.description}</p>
                ) : null}
                {module.locked && module.unmetPrerequisiteTitles.length > 0 ? (
                  <p className="text-ink-muted mt-2 text-xs">
                    Complete {module.unmetPrerequisiteTitles.join(", ")} to unlock.
                  </p>
                ) : null}
                <ol className="mt-2 flex flex-col gap-1">
                  {module.items.map((item) => {
                    const isActive = activeItem?.id === item.id;
                    return (
                      <li key={item.id}>
                        <Link
                          href={`${baseHref}?item=${item.id}`}
                          aria-current={isActive ? "page" : undefined}
                          className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm ${
                            isActive
                              ? "bg-brand-50 text-brand-900 font-medium"
                              : "text-ink hover:bg-surface-muted"
                          }`}
                        >
                          <span>
                            {item.title}
                            {item.completed ? (
                              <span className="text-success ml-1" aria-label="completed">
                                ✓
                              </span>
                            ) : null}
                          </span>
                          {item.state !== "open" ? (
                            <span className="text-ink-muted text-xs">
                              {STATE_LABELS[item.state].label}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))
          )}
        </nav>

        <section aria-labelledby="active-lesson" className="flex flex-col gap-4">
          {activeItem ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-ink-muted text-xs uppercase">
                    {activeItem.kind.replace("_", " ")}
                  </p>
                  <h2 id="active-lesson" className="text-ink text-xl font-semibold">
                    {activeItem.title}
                  </h2>
                  {activeItem.opensAt || activeItem.closesAt ? (
                    <p className="text-ink-muted text-xs">
                      {activeItem.opensAt ? `Opens ${formatDate(activeItem.opensAt)} UTC` : null}
                      {activeItem.opensAt && activeItem.closesAt ? " · " : null}
                      {activeItem.closesAt ? `Closes ${formatDate(activeItem.closesAt)} UTC` : null}
                    </p>
                  ) : null}
                </div>
                {mode === "learner" ? (
                  <form action={activeItem.completed ? reopenItemAction : completeItemAction}>
                    <input type="hidden" name="itemId" value={activeItem.id} />
                    <input
                      type="hidden"
                      name="returnTo"
                      value={`${baseHref}?item=${activeItem.id}`}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant={activeItem.completed ? "secondary" : "primary"}
                    >
                      {activeItem.completed ? "Mark as not complete" : "Mark complete"}
                    </Button>
                  </form>
                ) : (
                  <StatusBadge tone={activeItem.completed ? "success" : "neutral"}>
                    {activeItem.completed ? "completed" : "not started"}
                  </StatusBadge>
                )}
              </div>

              <div className="rounded-card border-border bg-surface shadow-card border p-4 sm:p-6">
                <ItemContent item={activeItem} />
              </div>
            </>
          ) : (
            <div className="rounded-card border-border bg-surface shadow-card border p-4 sm:p-6">
              <h2 id="active-lesson" className="text-ink text-lg font-semibold">
                {requestedButUnavailable ? "This lesson is not available" : "Choose a lesson"}
              </h2>
              <p className="text-ink-muted mt-2 text-sm">
                {requestedButUnavailable
                  ? "It may be locked, not yet open, closed, or still a draft. Its title stays listed so you can see what is coming."
                  : modules.length === 0
                    ? "The teacher has not published any content for this course yet."
                    : "Pick a lesson from the contents panel to start. Your progress is saved as you go."}
              </p>
            </div>
          )}
        </section>
      </div>

      <p className="text-ink-muted text-xs">
        Times are shown in UTC. Your profile timezone is not applied to lesson windows yet.
      </p>
    </div>
  );
}
