import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ConversationList, ConversationView } from "@/modules/communication/message-service";

/**
 * The conversation surface for one offering: the people you may write to on the
 * left, the selected conversation on the right. Learner and staff pages render
 * the same panel; only the path prefix and the roster differ.
 */
export function MessagesPanel({
  list,
  conversation,
  offeringId,
  basePath,
  sendAction,
}: {
  list: ConversationList;
  conversation: ConversationView | null;
  offeringId: string;
  basePath: string;
  sendAction: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <section aria-labelledby="contacts-heading" className="flex flex-col gap-3">
        <h2 id="contacts-heading" className="text-ink text-sm font-semibold">
          {list.role === "learner" ? "Your instructors" : "People in this course"}
        </h2>
        {list.contacts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            There is nobody to message in this course yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {list.contacts.map((contact) => {
              const active = conversation?.contact.userId === contact.userId;
              return (
                <li key={contact.userId}>
                  <Link
                    href={`${basePath}?with=${contact.userId}`}
                    aria-current={active ? "true" : undefined}
                    className={`hover:bg-surface-muted flex flex-col gap-1 px-3 py-3 text-sm ${
                      active ? "bg-surface-muted" : ""
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-ink font-medium">{contact.name}</span>
                      {contact.unread > 0 ? (
                        <StatusBadge tone="info">{contact.unread} new</StatusBadge>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      <StatusBadge tone="neutral">
                        {contact.role === "staff" ? "staff" : "learner"}
                      </StatusBadge>
                      {contact.lastPreview ?? "No messages yet"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="conversation-heading" className="flex flex-col gap-4">
        <h2 id="conversation-heading" className="text-ink text-sm font-semibold">
          {conversation ? `Conversation with ${conversation.contact.name}` : "Conversation"}
        </h2>

        {!conversation ? (
          <EmptyState
            title="Choose someone to message"
            description="Messages stay inside this course. Nobody outside the class can read or send them."
          />
        ) : (
          <>
            <ol className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto rounded-lg border p-4">
              {conversation.messages.length === 0 ? (
                <li className="text-muted-foreground text-sm">
                  No messages yet. Say hello to {conversation.contact.name}.
                </li>
              ) : null}
              {conversation.messages.map((message) => (
                <li
                  key={message.id}
                  className={`flex flex-col gap-1 rounded-lg px-3 py-2 text-sm ${
                    message.mine ? "bg-brand-50 self-end" : "bg-surface-muted self-start"
                  }`}
                >
                  <span className="text-muted-foreground text-xs">
                    {message.mine ? "You" : message.senderName} ·{" "}
                    {message.createdAt.toLocaleString("en-GB")}
                  </span>
                  <span className="text-ink whitespace-pre-wrap">{message.body}</span>
                </li>
              ))}
            </ol>

            <form action={sendAction} className="flex flex-col gap-3">
              <input type="hidden" name="offeringId" value={offeringId} />
              <input type="hidden" name="recipientUserId" value={conversation.contact.userId} />
              <Textarea
                id="message-body"
                name="body"
                label="Message"
                rows={3}
                required
                maxLength={4000}
                hint="Only the two of you can read this conversation."
              />
              <div className="flex justify-end">
                <Button type="submit">Send message</Button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

export function MessagesUnavailable({ message }: { message: string }) {
  return (
    <Alert tone="warning" title="Not available">
      {message}
    </Alert>
  );
}
