import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import {
  canManageInstitutionObe,
  getActiveAttainmentPolicy,
  listObeProgrammes,
} from "@/modules/obe/outcome-service";

export const metadata: Metadata = { title: "OBE and accreditation" };

export default async function ObeOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const { notice, error } = await searchParams;

  if (!canManageInstitutionObe(account)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="OBE and accreditation" />
        <PermissionDenied message="Your role cannot manage programme outcomes or attainment policies." />
      </div>
    );
  }

  let programmes;
  let policy;
  try {
    [programmes, policy] = await Promise.all([
      listObeProgrammes(account),
      getActiveAttainmentPolicy(account),
    ]);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="OBE and accreditation" />
        <Alert tone="danger" title="Could not load">
          {caught instanceof AppError ? caught.message : "The OBE workspace could not be loaded."}
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs items={[{ label: "Overview", href: "/admin" }, { label: "OBE" }]} />
      <PageHeader
        eyebrow={account.tenant?.institutionName ?? "Institution"}
        title="OBE and accreditation"
        description="Define PEOs, POs, and PSOs per programme. Faculty map course outcomes and assessments. Attainment is not calculated until this institution confirms a formula."
      />

      {notice ? (
        <Alert tone="success" title="Saved">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Could not save">
          {error}
        </Alert>
      ) : null}

      <section className="rounded-card border-border bg-surface shadow-card border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-ink text-lg font-semibold">Attainment policy</h2>
            {policy ? (
              <p className="text-ink-muted mt-1 text-sm">
                {policy.name} · version {policy.version} ·{" "}
                {policy.formulaConfigured
                  ? "formula recorded"
                  : "formula unconfigured — missing evidence stays missing, never zero"}
              </p>
            ) : (
              <p className="text-ink-muted mt-1 text-sm">
                No active policy. Create a draft and activate it to lock the correlation scale.
              </p>
            )}
          </div>
          <Link
            href="/admin/obe/policies"
            className="text-brand-800 text-sm font-medium hover:underline"
          >
            Manage policy versions
          </Link>
        </div>
        {policy && !policy.formulaConfigured ? (
          <div className="mt-4">
            <Alert tone="warning" title="No attainment numbers yet">
              Direct and indirect methods are stored as unconfigured. Mapping coverage and warnings
              are available; approved snapshots wait until the formula is confirmed.
            </Alert>
          </div>
        ) : null}
      </section>

      {programmes.length === 0 ? (
        <EmptyState
          title="No programmes yet"
          description="Create a programme in academic setup, then add PEOs, POs, and PSOs here."
        />
      ) : (
        <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Programmes and outcome counts</caption>
            <thead className="bg-surface-muted">
              <tr>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Programme
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Department
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Outcomes
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Status
                </th>
                <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {programmes.map((programme) => (
                <tr key={programme.id} className="border-border border-t">
                  <td className="px-3 py-3 text-sm">
                    <p className="text-ink font-medium">{programme.name}</p>
                    <p className="text-ink-muted">{programme.code}</p>
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">{programme.departmentName}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm tabular-nums">
                    {programme.outcomeCount}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={programme.status === "ACTIVE" ? "success" : "warning"}>
                      {programme.status.toLowerCase()}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link
                      href={`/admin/obe/programmes/${programme.id}`}
                      className="text-brand-800 text-sm font-medium hover:underline"
                    >
                      Edit outcomes
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
