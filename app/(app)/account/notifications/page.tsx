import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireAccountContext } from "@/lib/auth/account";
import { listPreferences } from "@/modules/notifications/preference-service";
import type { NotificationCategoryKey } from "@/modules/notifications/notification-service";

import { updateNotificationPreferencesAction } from "./actions";

export const metadata: Metadata = { title: "Notification settings" };

const CATEGORY_LABELS: Record<NotificationCategoryKey, { label: string; hint: string }> = {
  sessions: {
    label: "Live sessions",
    hint: "Schedule changes, cancellations, and reminders before a session starts.",
  },
  assignments: {
    label: "Assignments",
    hint: "Deadline reminders before a published assignment closes.",
  },
  quizzes: { label: "Quizzes", hint: "Quiz openings, closing times, and attempt results." },
  grades: { label: "Grades", hint: "Released marks and feedback on your work." },
  announcements: {
    label: "Announcements and messages",
    hint: "Course announcements, discussion replies, and direct messages.",
  },
  security: { label: "Security", hint: "Password and sign-in activity on your account." },
  account: { label: "Account", hint: "Invitations, role changes, and membership updates." },
};

export default async function NotificationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ notice, error }, preferences] = await Promise.all([
    searchParams,
    listPreferences(account),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[{ label: "My account", href: "/account" }, { label: "Notifications" }]}
      />
      <PageHeader
        title="Notification settings"
        description="Choose how each kind of notice reaches you. In-app notices appear in the bell menu; email is queued and retried if the mail server is unavailable."
      />

      {notice === "preferences-saved" ? (
        <Alert tone="success" title="Preferences saved">
          New notices follow these choices. Nothing already delivered is recalled.
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Could not save your preferences">
          {error}
        </Alert>
      ) : null}

      <form
        action={updateNotificationPreferencesAction}
        className="rounded-card border-border bg-surface shadow-card flex flex-col gap-4 border p-4 sm:p-6"
      >
        <div className="text-ink-muted grid grid-cols-[1fr_5rem_5rem] gap-3 text-xs font-semibold tracking-wide uppercase sm:grid-cols-[1fr_6rem_6rem]">
          <span>Category</span>
          <span className="text-center">In app</span>
          <span className="text-center">Email</span>
        </div>

        <ul className="flex flex-col divide-y">
          {preferences.map((preference) => {
            const copy = CATEGORY_LABELS[preference.category];
            return (
              <li
                key={preference.category}
                className="grid grid-cols-[1fr_5rem_5rem] items-start gap-3 py-3 sm:grid-cols-[1fr_6rem_6rem]"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <label
                    htmlFor={`inApp-${preference.category}`}
                    className="text-ink text-sm font-medium"
                  >
                    {copy.label}
                  </label>
                  <span className="text-muted-foreground text-xs">{copy.hint}</span>
                </div>
                <input
                  id={`inApp-${preference.category}`}
                  name={`inApp-${preference.category}`}
                  type="checkbox"
                  defaultChecked={preference.inApp}
                  aria-label={`${copy.label}: in-app notices`}
                  className="mt-0.5 size-4 justify-self-center"
                />
                <input
                  name={`email-${preference.category}`}
                  type="checkbox"
                  defaultChecked={preference.email}
                  aria-label={`${copy.label}: email`}
                  className="mt-0.5 size-4 justify-self-center"
                />
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">Save preferences</Button>
          <span className="text-muted-foreground text-xs">
            Switching both off mutes the category; the notice is still recorded in the audit trail.
          </span>
        </div>
      </form>
    </div>
  );
}
