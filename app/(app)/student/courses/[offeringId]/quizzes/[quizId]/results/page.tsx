import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getAttemptForLearner } from "@/modules/quizzes/attempt-engine";
import { getLearnerQuiz } from "@/modules/quizzes/quiz-service";
import { parseQuizSettings } from "@/modules/quizzes/rules";

export const metadata: Metadata = { title: "Quiz results" };

const RESULT_TONES: Record<string, BadgeTone> = {
  passed: "success",
  failed: "danger",
  pending_essay: "warning",
};

function promptText(promptJson: object): string {
  const prompt = promptJson as { stem?: unknown };
  return typeof prompt.stem === "string" && prompt.stem.trim() ? prompt.stem : "(no prompt)";
}

export default async function StudentQuizResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string; quizId: string }>;
  searchParams: Promise<{ attemptId?: string; notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId, quizId }, { attemptId, notice, error }] = await Promise.all([
    params,
    searchParams,
  ]);

  if (!attemptId) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Quiz results" description="No attempt specified." />
        <Alert tone="warning" title="Missing attempt">
          No attempt was specified.{" "}
          <Link href={`/student/courses/${offeringId}/quizzes`} className="font-medium underline">
            Back to quizzes
          </Link>
          .
        </Alert>
      </div>
    );
  }

  let attempt;
  let quiz;
  try {
    [attempt, quiz] = await Promise.all([
      getAttemptForLearner(account, attemptId),
      getLearnerQuiz(account, quizId),
    ]);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Quiz results" description="Could not load results." />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "Results could not be loaded."}{" "}
          <Link href={`/student/courses/${offeringId}/quizzes`} className="font-medium underline">
            Back to quizzes
          </Link>
          .
        </Alert>
      </div>
    );
  }

  const settings = parseQuizSettings(quiz.settings);
  const hasPendingEssays = attempt.items.some(
    (item) =>
      (item.type === "essay" || item.type === "short_answer") &&
      (item.score === null || item.score === undefined),
  );

  let outcome: "passed" | "failed" | "pending_essay" | "submitted" = "submitted";
  if (attempt.showResults) {
    if (hasPendingEssays) {
      outcome = "pending_essay";
    } else if (attempt.score !== null && settings.passMark !== null) {
      const percentage =
        attempt.pointsPossible > 0 ? (attempt.score / attempt.pointsPossible) * 100 : 0;
      outcome = percentage >= settings.passMark ? "passed" : "failed";
    }
  }

  const scorePercentage =
    attempt.pointsPossible > 0 && attempt.score !== null
      ? Math.round((attempt.score / attempt.pointsPossible) * 100)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My learning", href: "/student" },
          { label: "My courses", href: "/student/courses" },
          { label: "Course", href: `/student/courses/${offeringId}` },
          { label: "Quizzes", href: `/student/courses/${offeringId}/quizzes` },
          { label: quiz.title, href: `/student/courses/${offeringId}/quizzes/${quizId}` },
          { label: "Results" },
        ]}
      />

      {notice ? (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Error">
          {error}
        </Alert>
      ) : null}

      <PageHeader title="Quiz results" description={quiz.title} />

      {/* Score summary */}
      <section className="flex flex-col gap-4 rounded-lg border p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Your score</h2>
          {attempt.showResults && outcome !== "submitted" ? (
            <StatusBadge tone={RESULT_TONES[outcome] ?? "neutral"}>
              {outcome === "pending_essay"
                ? "Awaiting essay grades"
                : outcome.charAt(0).toUpperCase() + outcome.slice(1)}
            </StatusBadge>
          ) : null}
        </div>

        {!attempt.showResults ? (
          <p className="text-muted-foreground text-sm">
            Your submission has been received. Results will be shown once your instructor releases
            them.
          </p>
        ) : (
          <>
            <div className="flex items-end gap-3">
              <span className="text-4xl font-bold tabular-nums">
                {attempt.score !== null ? attempt.score : "—"}
              </span>
              <span className="text-muted-foreground text-lg">/ {attempt.pointsPossible} pts</span>
              {scorePercentage !== null ? (
                <span className="text-muted-foreground text-2xl font-semibold">
                  ({scorePercentage}%)
                </span>
              ) : null}
            </div>
            {hasPendingEssays ? (
              <p className="rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-700">
                Some written answers are still being graded. Your final score may change.
              </p>
            ) : null}
          </>
        )}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t pt-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Attempt</dt>
            <dd>#{attempt.attemptNumber}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Started</dt>
            <dd>{attempt.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Submitted</dt>
            <dd>
              {attempt.submittedAt
                ? `${attempt.submittedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
                : "—"}
            </dd>
          </div>
        </dl>
      </section>

      {/* Per-question breakdown */}
      {attempt.showResults ? (
        <div className="flex flex-col gap-4">
          <h2 className="font-semibold">Question breakdown</h2>
          {attempt.items.map((item, index) => {
            const hasScore = item.score !== null && item.score !== undefined;
            return (
              <section
                key={item.id}
                className={`flex flex-col gap-2 rounded-lg border border-l-4 p-5 ${
                  hasScore
                    ? item.score! >= item.pointsPossible
                      ? "border-l-green-500"
                      : item.score! > 0
                        ? "border-l-yellow-500"
                        : "border-l-red-400"
                    : "border-l-border-strong"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="text-sm font-medium">
                    <span className="text-muted-foreground mr-2">Q{index + 1}.</span>
                    {promptText(item.promptJson)}
                  </p>
                  <span className="shrink-0 text-sm font-medium">
                    {hasScore ? `${item.score} / ${item.pointsPossible}` : "Pending"} pt
                    {item.pointsPossible !== 1 ? "s" : ""}
                  </span>
                </div>
                {item.feedback ? (
                  <p className="text-muted-foreground border-t pt-2 text-sm italic">
                    Feedback: {item.feedback}
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}

      <div className="flex gap-3">
        <Link href={`/student/courses/${offeringId}/quizzes`}>
          <Button>Back to quizzes</Button>
        </Link>
        <Link href={`/student/courses/${offeringId}`}>
          <Button variant="secondary">Back to course</Button>
        </Link>
      </div>
    </div>
  );
}
