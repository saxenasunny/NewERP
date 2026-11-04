import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import {
  getBank,
  listQuestions,
  questionTypeToKey,
  type Question,
} from "@/modules/quizzes/bank-service";
import { fromDecimal } from "@/modules/quizzes/rules";

import { createQuestionAction, deleteQuestionAction, publishQuestionAction } from "../actions";

export const metadata: Metadata = { title: "Question bank" };

/** The stored prompt snapshot, rendered as plain text. */
function promptText(promptJson: unknown): string {
  const prompt = promptJson as { stem?: unknown } | null;
  return typeof prompt?.stem === "string" && prompt.stem.trim() ? prompt.stem : "(no prompt)";
}

function optionCount(promptJson: unknown): number {
  const prompt = promptJson as { options?: unknown } | null;
  return Array.isArray(prompt?.options) ? prompt.options.length : 0;
}

export default async function QuestionBankDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string; bankId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId, bankId }, { notice, error }] = await Promise.all([params, searchParams]);
  const returnTo = `/faculty/courses/${offeringId}/question-banks/${bankId}`;

  let bank: Awaited<ReturnType<typeof getBank>>;
  let questions: Question[];
  try {
    [bank, questions] = await Promise.all([
      getBank(account, bankId),
      listQuestions(account, bankId),
    ]);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Question bank" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "Bank not found."}
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
          { label: "Question banks", href: `/faculty/courses/${offeringId}/question-banks` },
          { label: bank.title },
        ]}
      />

      <PageHeader
        title={bank.title}
        description={`${bank._count.questions} question(s) in this bank`}
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

      {/* Add question */}
      <section className="rounded-lg border p-5">
        <h2 className="mb-4 text-base font-semibold">Add question</h2>
        <form action={createQuestionAction} className="flex flex-col gap-4">
          <input type="hidden" name="bankId" value={bankId} />
          <input type="hidden" name="returnTo" value={returnTo} />

          <Input
            id="qn-title"
            label="Title (internal reference)"
            name="title"
            required
            placeholder="e.g. Recursion base case"
          />

          <Select
            id="qn-type"
            label="Question type"
            name="questionType"
            defaultValue="single_choice"
          >
            <option value="single_choice">Single choice</option>
            <option value="multi_select">Multiple select</option>
            <option value="true_false">True / False</option>
            <option value="short_answer">Short answer</option>
            <option value="fill_blank">Fill in the blank</option>
            <option value="essay">Essay</option>
          </Select>

          <Textarea
            id="qn-stem"
            label="Question prompt"
            name="stem"
            rows={3}
            required
            placeholder="A recursive function without a base case will…"
          />

          <fieldset className="space-y-3 rounded-lg border p-4">
            <legend className="text-sm font-medium">
              Options for choice questions (leave blank for text questions)
            </legend>
            {["Option A", "Option B", "Option C", "Option D", "Option E"].map((label, index) => (
              <Input
                key={label}
                id={`qn-option-${index + 1}`}
                label={label}
                name={`option${index + 1}`}
                placeholder="e.g. Recursion never terminates"
              />
            ))}
          </fieldset>

          <div className="flex flex-col gap-3">
            <Input
              id="qn-correct-option"
              label="Correct option ID (single choice / true-false)"
              name="correctOptionId"
              placeholder="opt_0"
              hint="Options are numbered opt_0 (A) to opt_4 (E)."
            />
            <Input
              id="qn-correct-options"
              label="Correct option IDs (multiple select)"
              name="correctOptionIds"
              placeholder="opt_0,opt_2"
            />
            <Textarea
              id="qn-accepted"
              label="Accepted answers (short answer / fill in the blank, one per line)"
              name="acceptedAnswers"
              rows={3}
              placeholder={"Recursive definition\nrecursion"}
            />
          </div>

          <Input
            id="qn-points"
            label="Points"
            name="points"
            type="number"
            min={1}
            step={1}
            defaultValue={1}
          />

          <div className="flex justify-end">
            <Button type="submit">Add question</Button>
          </div>
        </form>
      </section>

      {/* Question list */}
      {questions.length === 0 ? (
        <EmptyState title="No questions yet" description="Add your first question above." />
      ) : (
        <section>
          <h2 className="mb-3 text-base font-semibold">Questions ({questions.length})</h2>
          <div className="flex flex-col gap-3">
            {questions.map((question) => (
              <div
                key={question.id}
                className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{question.title}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {questionTypeToKey(question.type).replace("_", " ")} ·{" "}
                    {fromDecimal(question.points) ?? 1} pt
                    {optionCount(question.promptJson) > 0
                      ? ` · ${optionCount(question.promptJson)} options`
                      : ""}
                  </p>
                  <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                    {promptText(question.promptJson)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge tone={question.status === "PUBLISHED" ? "success" : "info"}>
                    {question.status === "PUBLISHED" ? "published" : "draft"}
                  </StatusBadge>
                  {question.status === "DRAFT" && (
                    <form action={publishQuestionAction}>
                      <input type="hidden" name="questionId" value={question.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <Button type="submit" size="sm">
                        Publish
                      </Button>
                    </form>
                  )}
                  <form action={deleteQuestionAction}>
                    <input type="hidden" name="questionId" value={question.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <Button type="submit" variant="danger" size="sm">
                      Delete
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
