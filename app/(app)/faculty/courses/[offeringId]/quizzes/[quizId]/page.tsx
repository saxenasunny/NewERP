import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { listBanks, listQuestions, questionTypeToKey } from "@/modules/quizzes/bank-service";
import { getQuiz, quizStatusToKey } from "@/modules/quizzes/quiz-service";
import { fromDecimal, parseQuizSettings } from "@/modules/quizzes/rules";

import {
  addQuestionRefAction,
  archiveQuizAction,
  deleteQuizAction,
  publishQuizAction,
  releaseResultsAction,
  removeQuestionRefAction,
  updateQuizAction,
} from "../actions";

export const metadata: Metadata = { title: "Edit quiz" };

const STATUS_TONES: Record<string, BadgeTone> = {
  draft: "info",
  published: "success",
  archived: "warning",
};

function toLocal(date: Date | null): string {
  return date ? date.toISOString().slice(0, 16) : "";
}

export default async function QuizDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string; quizId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId, quizId }, { notice, error }] = await Promise.all([params, searchParams]);
  const returnTo = `/faculty/courses/${offeringId}/quizzes/${quizId}`;

  let quiz;
  try {
    quiz = await getQuiz(account, quizId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Quiz" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "Quiz not found."}
        </Alert>
      </div>
    );
  }

  const settings = parseQuizSettings(quiz.settings);
  const status = quizStatusToKey(quiz.status);
  const isDraft = status === "draft";
  const isPublished = status === "published";
  const attemptCount = quiz._count.attempts;

  const addedIds = new Set(quiz.questions.map((ref) => ref.questionId));
  const availableSections = isDraft
    ? await Promise.all(
        (await listBanks(account, { courseOfferingId: offeringId })).map(async (bank) => {
          const questions = await listQuestions(account, bank.id, { status: "published" });
          return { bank, questions: questions.filter((question) => !addedIds.has(question.id)) };
        }),
      )
    : [];

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Courses", href: "/faculty/courses" },
          { label: "Course", href: `/faculty/courses/${offeringId}` },
          { label: "Quizzes", href: `/faculty/courses/${offeringId}/quizzes` },
          { label: quiz.title },
        ]}
      />

      <PageHeader
        title={quiz.title}
        actions={<StatusBadge tone={STATUS_TONES[status] ?? "neutral"}>{status}</StatusBadge>}
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

      {/* Settings */}
      <section className="rounded-lg border p-5">
        <h2 className="mb-4 text-base font-semibold">Settings</h2>
        <form action={updateQuizAction} className="flex flex-col gap-4">
          <input type="hidden" name="quizId" value={quizId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Input id="quiz-title" label="Title" name="title" defaultValue={quiz.title} required />
          <Textarea
            id="quiz-instructions"
            label="Instructions"
            name="instructions"
            rows={3}
            defaultValue={quiz.instructions ?? ""}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="quiz-available-from"
              label="Available from"
              name="availableFrom"
              type="datetime-local"
              defaultValue={toLocal(quiz.availableFrom)}
            />
            <Input
              id="quiz-available-until"
              label="Available until"
              name="availableUntil"
              type="datetime-local"
              defaultValue={toLocal(quiz.availableUntil)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="quiz-time-limit"
              label="Time limit (min)"
              name="timeLimitMinutes"
              type="number"
              min={1}
              defaultValue={settings.timeLimitMinutes ?? ""}
            />
            <Input
              id="quiz-attempt-limit"
              label="Attempt limit"
              name="attemptLimit"
              type="number"
              min={1}
              defaultValue={settings.attemptLimit}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Select
              id="quiz-grading-method"
              label="Grading method"
              name="gradingMethod"
              defaultValue={settings.gradingMethod}
            >
              <option value="highest">Highest score</option>
              <option value="latest">Latest attempt</option>
              <option value="first">First attempt</option>
            </Select>
            <Select
              id="quiz-release-policy"
              label="Release policy"
              name="releasePolicy"
              defaultValue={settings.releasePolicy}
            >
              <option value="on_submit">Show on submit</option>
              <option value="after_until">Show after close date</option>
              <option value="manual">Manual release</option>
              <option value="never">Never show</option>
            </Select>
            <Input
              id="quiz-pass-mark"
              label="Pass mark (%)"
              name="passMark"
              type="number"
              min={0}
              max={100}
              defaultValue={settings.passMark ?? ""}
            />
          </div>
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="shuffleQuestions"
                defaultChecked={settings.shuffleQuestions}
              />
              Shuffle question order
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="shuffleOptions"
                defaultChecked={settings.shuffleOptions}
              />
              Shuffle option order
            </label>
          </div>
          <div className="flex justify-end">
            <Button type="submit">Save settings</Button>
          </div>
        </form>
      </section>

      {/* Question list */}
      <section className="rounded-lg border p-5">
        <h2 className="mb-4 text-base font-semibold">Questions in this quiz</h2>
        {quiz.questions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No questions added yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="w-8 py-2 pr-4 font-medium">#</th>
                <th className="py-2 pr-4 font-medium">Question</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Pts</th>
                {isDraft && <th className="py-2 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {quiz.questions.map((ref) => (
                <tr key={ref.id} className="border-b">
                  <td className="text-muted-foreground py-2 pr-4">{ref.position}</td>
                  <td className="py-2 pr-4">{ref.question.title}</td>
                  <td className="py-2 pr-4 text-xs">
                    {questionTypeToKey(ref.question.type).replace("_", " ")}
                  </td>
                  <td className="py-2 pr-4">
                    {fromDecimal(ref.pointsOverride) ?? fromDecimal(ref.question.points) ?? 1}
                  </td>
                  {isDraft && (
                    <td className="py-2">
                      <form action={removeQuestionRefAction}>
                        <input type="hidden" name="quizId" value={quizId} />
                        <input type="hidden" name="questionId" value={ref.questionId} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <Button type="submit" variant="ghost" size="sm">
                          Remove
                        </Button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Add questions */}
      {isDraft && availableSections.some((section) => section.questions.length > 0) && (
        <section className="rounded-lg border p-5">
          <h2 className="mb-4 text-base font-semibold">Add questions from bank</h2>
          {availableSections
            .filter((section) => section.questions.length > 0)
            .map(({ bank, questions }) => (
              <div key={bank.id} className="mb-4">
                <h3 className="text-muted-foreground mb-2 text-sm font-medium">{bank.title}</h3>
                {questions.map((question) => (
                  <form
                    key={question.id}
                    action={addQuestionRefAction}
                    className="flex items-center gap-3 py-1"
                  >
                    <input type="hidden" name="quizId" value={quizId} />
                    <input type="hidden" name="questionId" value={question.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <span className="flex-1 text-sm">
                      {question.title}{" "}
                      <span className="text-muted-foreground text-xs">
                        ({questionTypeToKey(question.type).replace("_", " ")})
                      </span>
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {fromDecimal(question.points) ?? 1} pt
                    </span>
                    <Button type="submit" variant="secondary" size="sm">
                      Add
                    </Button>
                  </form>
                ))}
              </div>
            ))}
        </section>
      )}

      {/* Actions */}
      <section className="flex flex-wrap gap-3">
        {isDraft && (
          <form action={publishQuizAction}>
            <input type="hidden" name="quizId" value={quizId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" disabled={quiz.questions.length === 0}>
              Publish quiz
            </Button>
          </form>
        )}
        {isPublished && settings.releasePolicy === "manual" && !quiz.releasedAt && (
          <form action={releaseResultsAction}>
            <input type="hidden" name="quizId" value={quizId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit">Release results to students</Button>
          </form>
        )}
        {isPublished && (
          <form action={archiveQuizAction}>
            <input type="hidden" name="quizId" value={quizId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" variant="secondary">
              Archive quiz
            </Button>
          </form>
        )}
        {isDraft && attemptCount === 0 && (
          <form action={deleteQuizAction}>
            <input type="hidden" name="quizId" value={quizId} />
            <input type="hidden" name="offeringId" value={offeringId} />
            <Button type="submit" variant="danger">
              Delete quiz
            </Button>
          </form>
        )}
        {isPublished && (
          <Link href={`/faculty/courses/${offeringId}/quizzes/${quizId}/grading`}>
            <Button variant="secondary">Grading queue ({attemptCount})</Button>
          </Link>
        )}
      </section>
    </div>
  );
}
