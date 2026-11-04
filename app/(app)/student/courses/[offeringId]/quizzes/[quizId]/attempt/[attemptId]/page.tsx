import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { getAttemptForLearner, type AttemptItemView } from "@/modules/quizzes/attempt-engine";

import { autosaveAttemptAction, submitAttemptAction } from "../../../actions";

export const metadata: Metadata = { title: "Quiz attempt" };

/** The stored prompt snapshot keeps its text under `stem`. */
function promptText(promptJson: object): string {
  const prompt = promptJson as { stem?: unknown };
  return typeof prompt.stem === "string" && prompt.stem.trim() ? prompt.stem : "(no prompt)";
}

function chosenIds(item: AttemptItemView): string[] {
  if (item.answer.selectedOptionIds?.length) return item.answer.selectedOptionIds;
  if (item.answer.selectedOptionId) return [item.answer.selectedOptionId];
  return [];
}

export default async function AttemptRunnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string; quizId: string; attemptId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId, quizId, attemptId }, { notice, error }] = await Promise.all([
    params,
    searchParams,
  ]);

  let attempt;
  try {
    attempt = await getAttemptForLearner(account, attemptId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Quiz attempt" description="This attempt is not available." />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "The attempt could not be loaded."}{" "}
          <Link
            href={`/student/courses/${offeringId}/quizzes/${quizId}`}
            className="font-medium underline"
          >
            Back to quiz
          </Link>
          .
        </Alert>
      </div>
    );
  }

  const isFinished = attempt.status !== "in_progress";
  const resultsPath = `/student/courses/${offeringId}/quizzes/${quizId}/results?attemptId=${attemptId}`;
  const attemptPath = `/student/courses/${offeringId}/quizzes/${quizId}/attempt/${attemptId}`;

  const secondsRemaining = attempt.deadlineAt
    ? Math.max(0, Math.floor((attempt.deadlineAt.getTime() - new Date().getTime()) / 1000))
    : null;

  function formatCountdown(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}:${rest.toString().padStart(2, "0")}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My learning", href: "/student" },
          { label: "My courses", href: "/student/courses" },
          { label: "Course", href: `/student/courses/${offeringId}` },
          { label: "Quizzes", href: `/student/courses/${offeringId}/quizzes` },
          { label: "Attempt" },
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

      {/* Timer banner (server-rendered at request time) */}
      {!isFinished && secondsRemaining !== null ? (
        <div
          className={`flex items-center justify-between rounded-lg border px-4 py-2 text-sm font-medium ${
            secondsRemaining < 300
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-yellow-300 bg-yellow-50 text-yellow-800"
          }`}
        >
          <span>Time remaining at page load</span>
          <span className="font-mono text-base">{formatCountdown(secondsRemaining)}</span>
        </div>
      ) : null}

      <PageHeader
        title={`Attempt #${attempt.attemptNumber}`}
        description={
          isFinished
            ? `Submitted — ${attempt.submittedAt?.toISOString().slice(0, 16).replace("T", " ")} UTC`
            : "Answer each question below. Use Save progress to keep your answers."
        }
      />

      {isFinished ? (
        <Alert tone="info" title="Attempt submitted">
          Your responses have been received.{" "}
          <Link href={resultsPath} className="font-medium underline">
            View results
          </Link>
        </Alert>
      ) : (
        <form className="flex flex-col gap-6">
          <input type="hidden" name="attemptId" value={attemptId} />
          <input type="hidden" name="returnTo" value={attemptPath} />

          {attempt.items.map((item, index) => {
            const prompt = promptText(item.promptJson);
            const selected = chosenIds(item);
            const isTextAnswer =
              item.type === "essay" || item.type === "short_answer" || item.type === "fill_blank";
            const options =
              item.type === "true_false" && item.options.length === 0
                ? [
                    { id: "true", text: "True" },
                    { id: "false", text: "False" },
                  ]
                : item.options;

            return (
              <section key={item.id} className="flex flex-col gap-4 rounded-lg border p-5">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-sm font-medium">
                    <span className="text-muted-foreground mr-2">Q{index + 1}.</span>
                    {prompt}
                  </p>
                  <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
                    {item.pointsPossible} pt{item.pointsPossible !== 1 ? "s" : ""}
                  </span>
                </div>

                {item.type === "multi_select" && options.length > 0 ? (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="text-muted-foreground mb-1 text-xs">
                      Select every correct answer
                    </legend>
                    {options.map((option) => (
                      <label
                        key={option.id}
                        className="hover:bg-muted/40 flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          name={`answer_${item.id}`}
                          value={option.id}
                          defaultChecked={selected.includes(option.id)}
                          className="accent-primary"
                        />
                        {option.text}
                      </label>
                    ))}
                  </fieldset>
                ) : null}

                {(item.type === "single_choice" || item.type === "true_false") &&
                options.length > 0 ? (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="text-muted-foreground mb-1 text-xs">
                      Choose one answer
                    </legend>
                    {options.map((option) => (
                      <label
                        key={option.id}
                        className="hover:bg-muted/40 flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm"
                      >
                        <input
                          type="radio"
                          name={`answer_${item.id}`}
                          value={option.id}
                          defaultChecked={selected[0] === option.id}
                          className="accent-primary"
                        />
                        {option.text}
                      </label>
                    ))}
                  </fieldset>
                ) : null}

                {isTextAnswer ? (
                  <Textarea
                    id={`answer-${item.id}`}
                    label={item.type === "fill_blank" ? "Your answer" : "Your response"}
                    name={`answer_${item.id}`}
                    rows={item.type === "essay" ? 6 : 3}
                    defaultValue={item.answer.text ?? ""}
                    placeholder={
                      item.type === "essay" ? "Write your essay response…" : "Write your answer…"
                    }
                  />
                ) : null}

                {item.type === "multi_select" && options.length === 0 ? (
                  <Input
                    id={`answer-${item.id}`}
                    label="Your answer"
                    name={`answer_${item.id}`}
                    defaultValue={item.answer.text ?? ""}
                    placeholder="Your answer…"
                  />
                ) : null}
              </section>
            );
          })}

          <section className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-lg border p-4">
            <p className="text-muted-foreground text-sm">
              Once you submit you cannot change your answers. Save progress keeps them until you
              return.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" formAction={submitAttemptAction}>
                Submit quiz
              </Button>
              <Button type="submit" variant="secondary" formAction={autosaveAttemptAction}>
                Save progress
              </Button>
              <Link href={`/student/courses/${offeringId}/quizzes`}>
                <Button variant="ghost">Back to quizzes</Button>
              </Link>
            </div>
          </section>
        </form>
      )}
    </div>
  );
}
