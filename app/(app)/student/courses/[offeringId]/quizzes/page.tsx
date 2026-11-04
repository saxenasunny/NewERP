import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { listLearnerQuizzes } from "@/modules/quizzes/quiz-service";
import { parseQuizSettings } from "@/modules/quizzes/rules";

export const metadata: Metadata = { title: "Quizzes" };

function formatDateTime(date: Date | null): string {
  return date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";
}

export default async function StudentQuizListPage({
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
    quizzes = await listLearnerQuizzes(account, offeringId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Quizzes" description="Could not load quizzes for this course." />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "Quizzes could not be loaded."}{" "}
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
          { label: "Course", href: `/student/courses/${offeringId}` },
          { label: "Quizzes" },
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

      <PageHeader
        title="Quizzes"
        description={`${quizzes.length} quiz${quizzes.length === 1 ? "" : "zes"} available`}
      />

      {quizzes.length === 0 ? (
        <section className="rounded-lg border p-6">
          <p className="text-muted-foreground text-center text-sm">
            No quizzes are available for this course yet.
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-4">
          {quizzes.map((quiz) => {
            const settings = parseQuizSettings(quiz.settings);
            return (
              <section key={quiz.id} className="flex flex-col gap-3 rounded-lg border p-5">
                <div className="flex flex-col gap-1">
                  <span className="text-base font-semibold">{quiz.title}</span>
                  {quiz.instructions ? (
                    <span className="text-muted-foreground text-sm">{quiz.instructions}</span>
                  ) : null}
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Time limit</dt>
                    <dd>
                      {settings.timeLimitMinutes ? `${settings.timeLimitMinutes} min` : "None"}
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
                </dl>

                <div className="flex gap-2 pt-1">
                  <Link href={`/student/courses/${offeringId}/quizzes/${quiz.id}`}>
                    <Button size="sm">View quiz</Button>
                  </Link>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
