import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import {
  listNotifications,
  type NotificationCategoryKey,
} from "@/modules/notifications/notification-service";

import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

const CATEGORY_LABELS: Record<NotificationCategoryKey, string> = {
  sessions: "Live sessions",
  assignments: "Assignments",
  quizzes: "Quizzes",
  grades: "Grades",
  announcements: "Announcements",
  security: "Security",
  account: "Account",
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ error }, notifications] = await Promise.all([
    searchParams,
    listNotifications(account, { limit: 50 }),
  ]);
  const unread = notifications.filter((notification) => notification.readAt === null).length;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: "Notifications" }]} />
      <PageHeader
        title="Notifications"
        description={
          unread === 0
            ? "Nothing unread. Each notice is delivered once per event."
            : `${unread} unread of the latest ${notifications.length}.`
        }
        actions={
          unread > 0 ? (
            <form action={markAllNotificationsReadAction}>
              <Button type="submit" variant="secondary">
                Mark all as read
              </Button>
            </form>
          ) : null
        }
      />

      {error ? (
        <Alert tone="danger" title="Error">
          {error}
        </Alert>
      ) : null}

      {notifications.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          description="Schedule changes, released marks, and other course notices appear here."
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  {notification.readAt === null ? <StatusBadge tone="info">new</StatusBadge> : null}
                  <span className="text-sm font-medium">{notification.title}</span>
                  <span className="text-muted-foreground text-xs">
                    {CATEGORY_LABELS[notification.category]}
                  </span>
                </span>
                <span className="text-sm">{notification.body}</span>
                <span className="text-muted-foreground text-xs">
                  {notification.createdAt.toLocaleString("en-GB")}
                  {notification.href ? (
                    <>
                      {" · "}
                      <Link href={notification.href} className="underline">
                        Open
                      </Link>
                    </>
                  ) : null}
                </span>
              </div>
              {notification.readAt === null ? (
                <form action={markNotificationReadAction}>
                  <input type="hidden" name="notificationId" value={notification.id} />
                  <Button type="submit" variant="ghost">
                    Mark read
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
