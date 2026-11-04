import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { listBanks } from "@/modules/quizzes/bank-service";

import { createBankAction, deleteBankAction } from "./actions";

export const metadata: Metadata = { title: "Question banks" };

export default async function QuestionBanksPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error }] = await Promise.all([params, searchParams]);

  let banks;
  try {
    banks = await listBanks(account, { courseOfferingId: offeringId });
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Question banks" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "Unable to load banks."}
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
          { label: "Question banks" },
        ]}
      />

      <PageHeader
        title="Question banks"
        description="Reusable question pools for quizzes."
        actions={
          <Link href={`/faculty/courses/${offeringId}/quizzes`}>
            <Button variant="secondary" size="sm">
              Quizzes
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

      {/* Create bank */}
      <section className="rounded-lg border p-5">
        <h2 className="mb-4 text-base font-semibold">Create question bank</h2>
        <form action={createBankAction} className="flex items-end gap-4">
          <input type="hidden" name="offeringId" value={offeringId} />
          <div className="flex-1">
            <Input
              id="bank-title"
              label="Bank title"
              name="title"
              required
              placeholder="e.g. Week 3 — Recursion"
            />
          </div>
          <div className="pb-1">
            <Button type="submit">Create bank</Button>
          </div>
        </form>
      </section>

      {/* Bank list */}
      {banks.length === 0 ? (
        <EmptyState title="No question banks" description="Create your first bank above." />
      ) : (
        <div className="flex flex-col gap-3">
          {banks.map((bank) => (
            <div
              key={bank.id}
              className="flex items-center justify-between rounded-lg border px-4 py-3"
            >
              <div>
                <Link
                  href={`/faculty/courses/${offeringId}/question-banks/${bank.id}`}
                  className="font-medium hover:underline"
                >
                  {bank.title}
                </Link>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {bank._count.questions} question(s)
                </p>
              </div>
              <div className="flex gap-2">
                <Link href={`/faculty/courses/${offeringId}/question-banks/${bank.id}`}>
                  <Button variant="secondary" size="sm">
                    Edit
                  </Button>
                </Link>
                <form action={deleteBankAction}>
                  <input type="hidden" name="bankId" value={bank.id} />
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <Button type="submit" variant="danger" size="sm">
                    Delete
                  </Button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
