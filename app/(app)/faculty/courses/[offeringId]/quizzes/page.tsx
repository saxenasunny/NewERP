import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { listQuizzes, quizStatusToKey } from "@/modules/quizzes/quiz-service";

import { createQuizAction } from "./actions";

export const metadata: Metadata = { title: "Quizzes" };

const STATUS_TONES: Record<string, BadgeTone> = {
  draft: "info",
  published: "success",
  archived: "warning",
};

function fmtDate(date: Date | null): string {
  return date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";
}

export default async function CourseQuizzesPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error }] = await Promise.all([params, searchParams]);

  let quizzes;
  try {
    quizzes = await listQuizzes(account, offeringId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Quizzes" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "Unable to load quizzes."}
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
          { label: "Quizzes" },
        ]}
      />

      <PageHeader
        title="Quizzes"
        description="Manage quizzes for this course."
        actions={
          <Link href={`/faculty/courses/${offeringId}/question-banks`}>
            <Button variant="secondary" size="sm">
              Question banks
            </Button>
          </Link>
        }
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

      {/* Create quiz */}
      <section className="rounded-lg border p-5">
        <h2 className="mb-4 text-base font-semibold">Create quiz</h2>
        <form action={createQuizAction} className="flex flex-col gap-4">
          <input type="hidden" name="offeringId" value={offeringId} />
          <Input
            id="quiz-title"
            label="Title"
            name="title"
            required
            placeholder="e.g. Week 3 Quiz — Recursion"
          />
          <Textarea
            id="quiz-instructions"
            label="Instructions (optional)"
            name="instructions"
            rows={2}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="quiz-available-from"
              label="Available from"
              name="availableFrom"
              type="datetime-local"
            />
            <Input
              id="quiz-available-until"
              label="Available until"
              name="availableUntil"
              type="datetime-local"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="quiz-time-limit"
              label="Time limit (minutes)"
              name="timeLimitMinutes"
              type="number"
              min={1}
            />
            <Input
              id="quiz-attempt-limit"
              label="Attempt limit"
              name="attemptLimit"
              type="number"
              min={1}
              defaultValue={1}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit">Create quiz</Button>
          </div>
        </form>
      </section>

      {/* Quiz list */}
      {quizzes.length === 0 ? (
        <EmptyState title="No quizzes yet" description="Create your first quiz above." />
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="py-2 pr-4 font-medium">Title</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Questions</th>
              <th className="py-2 pr-4 font-medium">Attempts</th>
              <th className="py-2 pr-4 font-medium">Opens</th>
              <th className="py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {quizzes.map((quiz) => {
              const status = quizStatusToKey(quiz.status);
              return (
                <tr key={quiz.id} className="hover:bg-muted/30 border-b">
                  <td className="py-2 pr-4 font-medium">{quiz.title}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge tone={STATUS_TONES[status] ?? "neutral"}>{status}</StatusBadge>
                  </td>
                  <td className="py-2 pr-4">{quiz._count.questions}</td>
                  <td className="py-2 pr-4">{quiz._count.attempts}</td>
                  <td className="text-muted-foreground py-2 pr-4 text-xs">
                    {fmtDate(quiz.availableFrom)}
                  </td>
                  <td className="py-2">
                    <Link
                      href={`/faculty/courses/${offeringId}/quizzes/${quiz.id}`}
                      className="text-primary hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
