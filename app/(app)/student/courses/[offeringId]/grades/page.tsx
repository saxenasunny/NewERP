import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getLearnerGradebook } from "@/modules/gradebook/gradebook-service";

export const metadata: Metadata = { title: "My grades" };

const OUTCOME_TONES: Record<string, BadgeTone> = {
  passed: "success",
  failed: "danger",
  incomplete: "warning",
  no_result: "neutral",
};

const OUTCOME_LABELS: Record<string, string> = {
  passed: "Passed",
  failed: "Failed",
  incomplete: "Incomplete",
  no_result: "No result yet",
};

export default async function StudentGradesPage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const account = await requireAccountContext();
  const { offeringId } = await params;

  let gradebook;
  let own;
  try {
    const loaded = await getLearnerGradebook(account, offeringId);
    gradebook = loaded.gradebook;
    own = loaded.own;
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="My grades" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "Your grades could not be loaded."}{" "}
          <Link href={`/student/courses/${offeringId}`} className="font-medium underline">
            Back to course
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
          { label: "My learning", href: "/student" },
          { label: "My courses", href: "/student/courses" },
          { label: gradebook.courseCode, href: `/student/courses/${offeringId}` },
          { label: "My grades" },
        ]}
      />

      <PageHeader
        title="My grades"
        description={`${gradebook.courseCode} ${gradebook.courseTitle} · ${gradebook.termName}`}
      />

      <section className="flex flex-col gap-3 rounded-lg border p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Current result</h2>
          <StatusBadge tone={OUTCOME_TONES[own.result.outcome] ?? "neutral"}>
            {OUTCOME_LABELS[own.result.outcome] ?? own.result.outcome}
          </StatusBadge>
        </div>
        <p className="text-2xl font-semibold tabular-nums">
          {own.result.percentage === null ? "—" : `${own.result.percentage}%`}
          {own.result.letter ? (
            <span className="text-muted-foreground ml-2 text-base font-normal">
              {own.result.letter}
            </span>
          ) : null}
        </p>
        <p className="text-muted-foreground text-sm">
          {own.result.earned} of {own.result.possible} counted points.
          {own.result.counts.ungraded > 0
            ? " Some work is still being graded, so this result can change."
            : ""}
          {own.result.counts.missing > 0
            ? " Work you have not submitted is shown as missing and is not counted as zero."
            : ""}
        </p>
      </section>

      {gradebook.columns.length === 0 ? (
        <Alert tone="info" title="Nothing released yet">
          Your instructor has not released any marks for this course.
        </Alert>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="py-2 pr-4 font-medium">Assessment</th>
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 pr-4 font-medium">Points</th>
              <th className="py-2 font-medium">Mark</th>
            </tr>
          </thead>
          <tbody>
            {gradebook.columns.map((column) => {
              const cell = own.cells[column.id];
              const mark = !cell
                ? "—"
                : cell.state === "scored"
                  ? `${cell.score ?? "—"} / ${column.pointsPossible}`
                  : cell.state === "ungraded"
                    ? "Being graded"
                    : cell.state === "excused"
                      ? "Excused"
                      : "—";

              return (
                <tr key={column.id} className="border-b">
                  <td className="py-2 pr-4">{column.title}</td>
                  <td className="py-2 pr-4 text-xs">{column.kind}</td>
                  <td className="text-muted-foreground py-2 pr-4 text-xs">
                    /{column.pointsPossible}
                  </td>
                  <td className="py-2 tabular-nums">{mark}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="text-muted-foreground text-xs">
        Only assessments whose marks have been released are listed here.
      </p>
    </div>
  );
}
