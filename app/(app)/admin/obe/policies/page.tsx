import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import {
  canManageInstitutionObe,
  listAttainmentPolicies,
  type AttainmentPolicyView,
} from "@/modules/obe/outcome-service";

import { activatePolicyAction, createPolicyDraftAction, updatePolicyDraftAction } from "../actions";

export const metadata: Metadata = { title: "Attainment policies" };

export default async function AttainmentPoliciesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const { edit, notice, error } = await searchParams;

  if (!canManageInstitutionObe(account)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Attainment policies" />
        <PermissionDenied message="Your role cannot manage attainment policies." />
      </div>
    );
  }

  let policies: AttainmentPolicyView[];
  try {
    policies = await listAttainmentPolicies(account);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Attainment policies" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "Policies could not be loaded."}
        </Alert>
      </div>
    );
  }

  const editing = edit ? policies.find((policy) => policy.id === edit) : undefined;
  const returnTo = "/admin/obe/policies";

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/admin" },
          { label: "OBE", href: "/admin/obe" },
          { label: "Policies" },
        ]}
      />
      <PageHeader
        eyebrow={account.tenant?.institutionName ?? "Institution"}
        title="Attainment policies"
        description="Each version is stored. Activating one archives the previous active version. Direct and indirect methods stay unconfigured until this institution confirms a formula — the product will not invent one."
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

      <form
        action={editing ? updatePolicyDraftAction : createPolicyDraftAction}
        className="rounded-card border-border bg-surface shadow-card grid gap-4 border p-4 sm:grid-cols-2"
      >
        {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
        <input type="hidden" name="returnTo" value={returnTo} />
        <Input
          id="policy-name"
          name="name"
          label="Policy name"
          defaultValue={editing?.name ?? "Institution attainment policy"}
          required
        />
        <Input
          id="policy-rounding"
          name="rounding"
          label="Rounding (decimal places)"
          type="number"
          min={0}
          max={6}
          defaultValue={editing?.configuration.rounding.decimalPlaces ?? 2}
          required
        />
        <Input
          id="policy-co-threshold"
          name="courseOutcomeThreshold"
          label="Course outcome threshold (optional)"
          type="number"
          min={0}
          max={100}
          defaultValue={editing?.configuration.thresholds.courseOutcome ?? ""}
        />
        <Input
          id="policy-po-threshold"
          name="programmeOutcomeThreshold"
          label="Programme outcome threshold (optional)"
          type="number"
          min={0}
          max={100}
          defaultValue={editing?.configuration.thresholds.programmeOutcome ?? ""}
        />
        <div className="sm:col-span-2">
          <Textarea
            id="policy-direct"
            name="directMethodNotes"
            label="Direct method notes"
            hint="Leave unconfigured until the institution confirms the formula."
            defaultValue={editing?.configuration.directMethod.description ?? ""}
          />
        </div>
        <div className="sm:col-span-2">
          <Textarea
            id="policy-indirect"
            name="indirectMethodNotes"
            label="Indirect method notes"
            defaultValue={editing?.configuration.indirectMethod.description ?? ""}
          />
        </div>
        <div className="sm:col-span-2">
          <Textarea
            id="policy-notes"
            name="notes"
            label="Internal notes"
            defaultValue={editing?.notes ?? ""}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">{editing ? "Save draft" : "Create draft version"}</Button>
          {editing ? (
            <Link href={returnTo} className="text-ink-muted text-sm font-medium hover:underline">
              Cancel
            </Link>
          ) : null}
        </div>
      </form>

      {policies.length === 0 ? (
        <EmptyState
          title="No policy versions"
          description="Create a draft. Activating it records the correlation scale without calculating attainment."
        />
      ) : (
        <div className="rounded-card border-border bg-surface shadow-card overflow-x-auto border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Attainment policy versions</caption>
            <thead className="bg-surface-muted">
              <tr>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Policy
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Version
                </th>
                <th
                  scope="col"
                  className="text-ink-muted px-3 py-2 text-xs font-semibold uppercase"
                >
                  Formula
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
              {policies.map((policy) => (
                <tr key={policy.id} className="border-border border-t">
                  <td className="text-ink px-3 py-3 text-sm font-medium">{policy.name}</td>
                  <td className="text-ink-muted px-3 py-3 text-sm tabular-nums">
                    {policy.version}
                  </td>
                  <td className="text-ink-muted px-3 py-3 text-sm">
                    {policy.formulaConfigured ? "Recorded" : "Unconfigured"}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge
                      tone={
                        policy.status === "ACTIVE"
                          ? "success"
                          : policy.status === "DRAFT"
                            ? "info"
                            : "warning"
                      }
                    >
                      {policy.status.toLowerCase()}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {policy.status === "DRAFT" ? (
                        <>
                          <Link
                            href={`${returnTo}?edit=${policy.id}`}
                            className="text-brand-800 text-sm font-medium hover:underline"
                          >
                            Edit
                          </Link>
                          <form action={activatePolicyAction} className="inline-flex">
                            <input type="hidden" name="id" value={policy.id} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <Button size="sm">Activate</Button>
                          </form>
                        </>
                      ) : (
                        <span className="text-ink-muted text-sm">Immutable</span>
                      )}
                    </div>
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
