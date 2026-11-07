import type { Metadata } from "next";
import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { ROLES, type RoleKey } from "@/lib/navigation";
import { SUPPORTED_LOCALES } from "@/modules/identity/user-service";

import { updateProfileAction } from "./actions";

export const metadata: Metadata = { title: "My account" };

const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  "en-IN": "English (India)",
  "en-GB": "English (United Kingdom)",
  fr: "Français",
  sw: "Kiswahili",
};

function formatSessionExpiry(date: unknown): string {
  if (!date) return "Active session";
  try {
    const d = date instanceof Date ? date : new Date(String(date));
    if (isNaN(d.getTime())) return "Active session";
    return d.toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Active session";
  }
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const { notice, error } = await searchParams;

  let timezones: string[] = [];
  try {
    timezones = Intl.supportedValuesOf("timeZone");
  } catch {
    timezones = [
      "UTC",
      "Asia/Kolkata",
      "America/New_York",
      "America/Chicago",
      "America/Los_Angeles",
      "Europe/London",
      "Europe/Paris",
      "Asia/Singapore",
      "Asia/Dubai",
      "Asia/Tokyo",
      "Australia/Sydney",
    ];
  }

  const userTimezone = account.user.timezone || "UTC";
  const timezoneOptions = timezones.includes(userTimezone)
    ? timezones
    : [userTimezone, ...timezones];

  const userLocale = account.user.locale && LOCALE_LABELS[account.user.locale]
    ? account.user.locale
    : "en";

  const roleLabel =
    (account.navRole && ROLES[account.navRole as RoleKey]?.label) ||
    account.navRole ||
    "User";

  return (
    <div className="flex flex-col gap-8 pb-12">
      <Breadcrumbs items={[{ label: "Overview", href: account.homePath }, { label: "My account" }]} />

      <PageHeader
        eyebrow={account.tenant?.institutionName ?? "Platform operations"}
        title="My account"
        description="Your profile preferences, institutional memberships, and active credentials."
        actions={<SignOutButton />}
      />

      {notice === "profile-saved" ? (
        <Alert tone="success" title="Profile saved">
          Your display name, time zone, and language were updated successfully.
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Could not save your profile">
          {error}
        </Alert>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left Column (2 cols): Profile & Notification Settings */}
        <div className="flex flex-col gap-8 lg:col-span-2">
          {/* Profile Form Card */}
          <section aria-labelledby="profile-heading" className="flex flex-col gap-4">
            <h2 id="profile-heading" className="text-ink text-lg font-bold tracking-tight">
              Profile Information
            </h2>
            <form
              action={updateProfileAction}
              className="rounded-2xl border border-border bg-surface/90 backdrop-blur-md shadow-sm flex flex-col gap-5 p-5 sm:p-7"
            >
              <Input
                id="account-email"
                label="Email address"
                value={account.user.email ?? ""}
                readOnly
                disabled
                hint="Managed by your institution administrator."
              />
              <Input
                id="account-name"
                name="name"
                label="Display name"
                defaultValue={account.user.name ?? ""}
                autoComplete="name"
                required
              />
              <Select
                id="account-timezone"
                name="timezone"
                label="Time zone"
                defaultValue={userTimezone}
                hint="Used for calculating deadlines, session reminders, and class schedules."
              >
                {timezoneOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
              <Select
                id="account-locale"
                name="locale"
                label="Language"
                defaultValue={userLocale}
              >
                {SUPPORTED_LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {LOCALE_LABELS[locale] ?? locale}
                  </option>
                ))}
              </Select>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button type="submit">Save Changes</Button>
                <Link
                  href="/forgot-password"
                  className="text-brand-700 text-sm font-semibold hover:underline"
                >
                  Reset password by email →
                </Link>
              </div>
            </form>
          </section>

          {/* Notifications Card */}
          <section aria-labelledby="notifications-heading" className="flex flex-col gap-4">
            <h2 id="notifications-heading" className="text-ink text-lg font-bold tracking-tight">
              Notification Preferences
            </h2>
            <div className="rounded-2xl border border-border bg-surface/90 backdrop-blur-md shadow-sm flex flex-wrap items-center justify-between gap-4 p-5 sm:p-7">
              <div className="max-w-xl">
                <p className="text-ink font-semibold text-sm">Delivery Channels</p>
                <p className="text-ink-muted text-xs sm:text-sm mt-1 leading-relaxed">
                  Choose which alerts reach you in-app and by transactional email for assignments, live classes, grading, and discussions.
                </p>
              </div>
              <Link href="/account/notifications" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                Configure Notifications →
              </Link>
            </div>
          </section>
        </div>

        {/* Right Column (1 col): Access & Security Metadata */}
        <div className="flex flex-col gap-8 lg:col-span-1">
          <section aria-labelledby="access-heading" className="flex flex-col gap-4">
            <h2 id="access-heading" className="text-ink text-lg font-bold tracking-tight">
              Access & Security
            </h2>
            <div className="rounded-2xl border border-border bg-surface/90 backdrop-blur-md shadow-sm flex flex-col gap-6 p-5 sm:p-6">
              <div>
                <dt className="text-ink-muted text-xs font-semibold tracking-wider uppercase">
                  Current Role
                </dt>
                <dd className="mt-1.5 flex items-center gap-2">
                  <span className="text-ink font-bold text-base">{roleLabel}</span>
                  <StatusBadge tone="brand">Active</StatusBadge>
                </dd>
              </div>

              <div className="pt-4 border-t border-border">
                <dt className="text-ink-muted text-xs font-semibold tracking-wider uppercase">
                  Session Expiry
                </dt>
                <dd className="text-ink mt-1.5 text-sm font-mono font-medium">
                  {formatSessionExpiry(account.sessionExpiresAt)}
                </dd>
              </div>

              <div className="pt-4 border-t border-border">
                <p className="text-ink-muted text-xs font-semibold tracking-wider uppercase">
                  Institution Memberships
                </p>
                <ul className="mt-2.5 flex flex-col gap-2">
                  {!account.memberships || account.memberships.length === 0 ? (
                    <li className="text-ink-muted text-xs">No active institution membership.</li>
                  ) : null}
                  {account.memberships?.map((membership) => (
                    <li key={membership.tenantId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="text-ink font-medium text-xs">
                        {membership.institutionName || membership.tenantName || "Institution"}
                      </span>
                      {membership.tenantId === account.tenant?.tenantId ? (
                        <span className="text-[11px] font-bold text-brand-700 bg-brand-50 border border-brand-200 px-2 py-0.5 rounded-full">
                          Current
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {account.memberships && account.memberships.length > 1 ? (
                  <Link
                    href="/select-institution"
                    className="text-brand-700 mt-3 inline-block text-xs font-bold hover:underline"
                  >
                    Switch active institution →
                  </Link>
                ) : null}
              </div>

              <div className="pt-4 border-t border-border">
                <p className="text-ink-muted text-xs font-semibold tracking-wider uppercase">
                  Assigned Capabilities
                </p>
                <p className="text-ink mt-1.5 text-xs leading-relaxed font-mono bg-surface-muted/60 p-2.5 rounded-xl border border-border">
                  {account.roleKeys && account.roleKeys.length > 0
                    ? account.roleKeys.join(", ")
                    : "Standard account permissions"}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
