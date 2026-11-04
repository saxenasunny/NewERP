import type { Metadata } from "next";

import { MessagesPanel, MessagesUnavailable } from "@/components/communication/messages-panel";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PageHeader } from "@/components/ui/page-header";
import { requireAccountContext } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import {
  getConversation,
  listConversations,
  type ConversationView,
} from "@/modules/communication/message-service";

import { sendMessageAction } from "./actions";

export const metadata: Metadata = { title: "Messages" };

export default async function FacultyMessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ with?: string; notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { with: otherUserId, notice, error }] = await Promise.all([
    params,
    searchParams,
  ]);

  let list;
  try {
    list = await listConversations(account, offeringId);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Messages" />
        <MessagesUnavailable
          message={
            caught instanceof AppError ? caught.message : "The messages could not be loaded."
          }
        />
      </div>
    );
  }

  let conversation: ConversationView | null = null;
  let loadError: string | null = null;
  if (otherUserId) {
    try {
      conversation = await getConversation(account, offeringId, otherUserId);
    } catch (caught) {
      loadError =
        caught instanceof AppError ? caught.message : "The conversation could not be loaded.";
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "My courses", href: "/faculty/courses" },
          { label: list.courseCode, href: `/faculty/courses/${offeringId}` },
          { label: "Messages" },
        ]}
      />
      <PageHeader
        title={`${list.courseCode} messages`}
        description={`Private messages with the cohort of ${list.courseTitle}. ${list.unreadTotal} unread.`}
      />

      {notice ? (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Could not send">
          {error}
        </Alert>
      ) : null}
      {loadError ? (
        <Alert tone="warning" title="Conversation unavailable">
          {loadError}
        </Alert>
      ) : null}

      <MessagesPanel
        list={list}
        conversation={conversation}
        offeringId={offeringId}
        basePath={`/faculty/courses/${offeringId}/messages`}
        sendAction={sendMessageAction}
      />
    </div>
  );
}
