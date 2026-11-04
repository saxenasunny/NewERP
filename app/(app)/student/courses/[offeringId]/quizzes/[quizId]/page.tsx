import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { findLatestAttempt } from "@/modules/quizzes/attempt-engine";
import { getLearnerQuiz } from "@/modules/quizzes/quiz-service";
import { parseQuizSettings } from "@/modules/quizzes/rules";

import { startAttemptAction } from "../actions";

export const metadata: Metadata = { title: "Quiz" };

function formatDateTime(date: Date | null): string {
  return date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";
}

export default async function StudentQuizDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string; quizId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId, quizId }, { notice, error }] = await Promise.all([params, searchParams]);

  let quiz;
  let latestAttempt;
  try {
    [quiz, latestAttempt] = await Promise.all([
      getLearnerQuiz(account, quizId),
      findLatestAttempt(account, quizId),
    ]);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Quiz" description="This quiz is not available." />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "The quiz could not be loaded."}{" "}
          <Link href={`/student/courses/${offeringId}/quizzes`} className="font-medium underline">
            Back to quizzes
          </Link>
          .
        </Alert>
      </div>
    );
  }

  const settings = parseQuizSettings(quiz.settings);
  const now = new Date();
  const isOpen =
    (!quiz.availableFrom || quiz.availableFrom <= now) &&
    (!quiz.availableUntil || quiz.availableUntil >= now);
  const isInProgress = latestAttempt?.status === "in_progress";

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My learning", href: "/student" },
          { label: "My courses", href: "/student/courses" },
          { label: "Course", href: `/student/courses/${offeringId}` },
          { label: "Quizzes", href: `/student/courses/${offeringId}/quizzes` },
          { label: quiz.title },
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

      <PageHeader title={quiz.title} description={quiz.instructions ?? undefined} />

      <section className="flex flex-col gap-4 rounded-lg border p-5">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
          Quiz details
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <StatusBadge tone={isOpen ? "success" : "neutral"}>
                {isOpen ? "Open" : "Closed"}
              </StatusBadge>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Time limit</dt>
            <dd>
              {settings.timeLimitMinutes ? `${settings.timeLimitMinutes} minutes` : "No limit"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Attempts allowed</dt>
            <dd>{settings.attemptLimit}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Opens</dt>
            <dd>{formatDateTime(quiz.availableFrom)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Closes</dt>
            <dd>{formatDateTime(quiz.availableUntil)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Pass mark</dt>
            <dd>{settings.passMark !== null ? `${settings.passMark}%` : "—"}</dd>
          </div>
        </dl>
      </section>

      {latestAttempt ? (
        <section className="flex flex-col gap-3 rounded-lg border p-5">
          <h2 className="text-sm font-semibold">
            Your latest attempt #{latestAttempt.attemptNumber}
          </h2>
          <p className="text-muted-foreground text-sm">
            Status: {latestAttempt.status.replace("_", " ")}
            {latestAttempt.showResults && latestAttempt.score !== null
              ? ` · ${latestAttempt.score} / ${latestAttempt.pointsPossible} points`
              : ""}
          </p>
          <div className="flex gap-2">
            {isInProgress ? (
              <Link
                href={`/student/courses/${offeringId}/quizzes/${quizId}/attempt/${latestAttempt.id}`}
              >
                <Button size="sm">Resume attempt</Button>
              </Link>
            ) : (
              <Link
                href={`/student/courses/${offeringId}/quizzes/${quizId}/results?attemptId=${latestAttempt.id}`}
              >
                <Button size="sm" variant="secondary">
                  View results
                </Button>
              </Link>
            )}
          </div>
        </section>
      ) : null}

      {isOpen && !isInProgress ? (
        <section className="flex flex-col gap-3 rounded-lg border p-5">
          <p className="text-muted-foreground text-sm">
            When you start the quiz, the timer begins immediately.
            {settings.timeLimitMinutes
              ? ` You have ${settings.timeLimitMinutes} minutes to complete it.`
              : " There is no time limit."}{" "}
            Use <span className="font-medium">Save progress</span> at any time; your saved answers
            are restored if you come back.
          </p>
          <form action={startAttemptAction}>
            <input type="hidden" name="quizId" value={quizId} />
            <input type="hidden" name="offeringId" value={offeringId} />
            <Button type="submit">Start quiz</Button>
          </form>
        </section>
      ) : !isInProgress ? (
        <Alert tone="info" title="Not open">
          {quiz.availableFrom && quiz.availableFrom > now
            ? `This quiz opens at ${formatDateTime(quiz.availableFrom)}.`
            : "This quiz has closed."}
        </Alert>
      ) : null}
    </div>
  );
}
