import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { listUngradedEssays } from "@/modules/quizzes/attempt-engine";
import { getQuiz } from "@/modules/quizzes/quiz-service";
import { fromDecimal } from "@/modules/quizzes/rules";

import { gradeEssayAction } from "./actions";

export const metadata: Metadata = { title: "Grading queue" };

/** The prompt snapshot stores its text under `stem`. */
function promptText(promptJson: unknown): string {
  const prompt = promptJson as { stem?: unknown } | null;
  return typeof prompt?.stem === "string" && prompt.stem.trim() ? prompt.stem : "(no prompt)";
}

function answerText(answerJson: unknown): string {
  const answer = answerJson as { text?: unknown } | null;
  return typeof answer?.text === "string" && answer.text.trim() ? answer.text : "(no answer)";
}

export default async function GradingQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string; quizId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId, quizId }, { notice, error }] = await Promise.all([params, searchParams]);
  const returnTo = `/faculty/courses/${offeringId}/quizzes/${quizId}/grading`;

  let quiz;
  let ungradedAttempts;
  try {
    [quiz, ungradedAttempts] = await Promise.all([
      getQuiz(account, quizId),
      listUngradedEssays(account, quizId),
    ]);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Grading queue" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "Unable to load the grading queue."}
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Courses", href: "/faculty/courses" },
          { label: "Course", href: `/faculty/courses/${offeringId}` },
          { label: "Quizzes", href: `/faculty/courses/${offeringId}/quizzes` },
          { label: quiz.title, href: `/faculty/courses/${offeringId}/quizzes/${quizId}` },
          { label: "Grading queue" },
        ]}
      />

      <PageHeader
        title="Grading queue"
        description={`${ungradedAttempts.length} attempt${ungradedAttempts.length === 1 ? "" : "s"} with ungraded essay items`}
      />

      {notice && (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="danger" title="Error">
          {error}
        </Alert>
      )}

      {ungradedAttempts.length === 0 ? (
        <EmptyState
          title="All caught up"
          description="There are no essay items waiting for a grade."
        />
      ) : (
        <div className="flex flex-col gap-8">
          {ungradedAttempts.map((attempt) => (
            <section key={attempt.id} className="rounded-lg border p-5">
              <h2 className="mb-1 text-sm font-semibold">
                {attempt.user.name} · Attempt #{attempt.attemptNumber}
                <span className="text-muted-foreground ml-2 font-normal">
                  Submitted {attempt.submittedAt ? attempt.submittedAt.toLocaleString() : "—"}
                </span>
              </h2>

              {attempt.items.map((item) => {
                const maxPoints = fromDecimal(item.pointsPossible) ?? 0;
                return (
                  <div key={item.id} className="mt-4 border-t pt-4">
                    <p className="mb-1 text-sm font-medium">
                      {promptText(item.questionVersion.promptJson)}
                    </p>
                    <blockquote className="text-muted-foreground mb-4 border-l-2 pl-3 text-sm whitespace-pre-wrap">
                      {answerText(item.answer?.answerJson)}
                    </blockquote>

                    <form action={gradeEssayAction} className="flex flex-col gap-3">
                      <input type="hidden" name="attemptId" value={attempt.id} />
                      <input type="hidden" name="attemptItemId" value={item.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <div className="flex items-end gap-4">
                        <Input
                          id={`score-${item.id}`}
                          label={`Score (0 – ${maxPoints})`}
                          name="score"
                          type="number"
                          min={0}
                          max={maxPoints}
                          step={0.5}
                          required
                        />
                        <Textarea
                          id={`feedback-${item.id}`}
                          label="Feedback (optional)"
                          name="feedback"
                          rows={2}
                          placeholder="Visible to the student after results are released"
                        />
                        <div className="pb-1">
                          <Button type="submit" size="sm">
                            Save grade
                          </Button>
                        </div>
                      </div>
                    </form>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}

      <div className="pt-2">
        <Link
          href={`/faculty/courses/${offeringId}/quizzes/${quizId}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Back to quiz
        </Link>
      </div>
    </div>
  );
}
