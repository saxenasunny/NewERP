import type { Metadata } from "next";
import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { ROLES } from "@/lib/navigation";
import { SUPPORTED_LOCALES } from "@/modules/identity/user-service";

import { updateProfileAction } from "./actions";

export const metadata: Metadata = { title: "My account" };

const LOCALE_LABELS: Record<(typeof SUPPORTED_LOCALES)[number], string> = {
  en: "English",
  "en-IN": "English (India)",
  "en-GB": "English (United Kingdom)",
  fr: "Français",
  sw: "Kiswahili",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const { notice, error } = await searchParams;

  const timezones = Intl.supportedValuesOf("timeZone");
  const timezoneOptions = timezones.includes(account.user.timezone)
    ? timezones
    : [account.user.timezone, ...timezones];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={account.tenant?.institutionName ?? "Platform"}
        title="My account"
        description="Your profile, institution access, and session. Email addresses are managed by your administrator."
        actions={<SignOutButton />}
      />

      {notice === "profile-saved" ? (
        <Alert tone="success" title="Profile saved">
          Your display name, time zone, and language were updated.
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Could not save your profile">
          {error}
        </Alert>
      ) : null}

      <section aria-labelledby="profile-heading" className="flex flex-col gap-4">
        <h2 id="profile-heading" className="text-ink text-lg font-semibold">
          Profile
        </h2>
        <form
          action={updateProfileAction}
          className="rounded-card border-border bg-surface shadow-card flex max-w-2xl flex-col gap-5 border p-4 sm:p-6"
        >
          <Input id="account-email" label="Email" value={account.user.email} readOnly disabled />
          <Input
            id="account-name"
            name="name"
            label="Display name"
            defaultValue={account.user.name}
            autoComplete="name"
            required
          />
          <Select
            id="account-timezone"
            name="timezone"
            label="Time zone"
            defaultValue={account.user.timezone}
            hint="Used for deadlines and timestamps once course delivery exists."
          >
            {timezoneOptions.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone}
              </option>
            ))}
          </Select>
          <Select
            id="account-locale"
            name="locale"
            label="Language"
            defaultValue={account.user.locale}
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {LOCALE_LABELS[locale]}
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">Save profile</Button>
            <Link
              href="/forgot-password"
              className="text-brand-800 text-sm font-medium hover:underline"
            >
              Reset password by email
            </Link>
          </div>
        </form>
      </section>

      <section aria-labelledby="notifications-heading" className="flex flex-col gap-4">
        <h2 id="notifications-heading" className="text-ink text-lg font-semibold">
          Notifications
        </h2>
        <div className="rounded-card border-border bg-surface shadow-card flex flex-wrap items-center justify-between gap-3 border p-4 sm:p-6">
          <p className="text-ink-muted max-w-xl text-sm">
            Choose which categories reach you in the app and by email. Each notice is delivered once
            per event, and email that cannot be sent is queued for retry.
          </p>
          <Link href="/account/notifications" className={buttonClasses({ variant: "secondary" })}>
            Notification settings
          </Link>
        </div>
      </section>

      <section aria-labelledby="access-heading" className="flex flex-col gap-4">
        <h2 id="access-heading" className="text-ink text-lg font-semibold">
          Access
        </h2>
        <div className="rounded-card border-border bg-surface shadow-card flex flex-col gap-4 border p-4 sm:p-6">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted text-xs font-medium tracking-wide uppercase">
                Navigation role
              </dt>
              <dd className="text-ink mt-1 text-sm">{ROLES[account.navRole].label}</dd>
            </div>
            <div>
              <dt className="text-ink-muted text-xs font-medium tracking-wide uppercase">
                Session expires
              </dt>
              <dd className="text-ink mt-1 text-sm">
                {account.sessionExpiresAt.toLocaleString("en-GB")}
              </dd>
            </div>
          </dl>

          <div>
            <p className="text-ink-muted text-xs font-medium tracking-wide uppercase">
              Institutions
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {account.memberships.length === 0 ? (
                <li className="text-ink-muted text-sm">No active institution membership.</li>
              ) : null}
              {account.memberships.map((membership) => (
                <li key={membership.tenantId} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-ink">{membership.institutionName}</span>
                  {membership.tenantId === account.tenant?.tenantId ? (
                    <StatusBadge tone="brand">Current</StatusBadge>
                  ) : null}
                </li>
              ))}
            </ul>
            {account.memberships.length > 1 ? (
              <Link
                href="/select-institution"
                className="text-brand-800 mt-3 inline-block text-sm font-medium hover:underline"
              >
                Switch institution
              </Link>
            ) : null}
          </div>

          <div>
            <p className="text-ink-muted text-xs font-medium tracking-wide uppercase">
              Roles in {account.tenant?.institutionName ?? "this institution"}
            </p>
            <p className="text-ink mt-1 text-sm">
              {account.roleKeys.length > 0
                ? account.roleKeys.join(", ")
                : "No tenant role assigned."}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
