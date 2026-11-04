/**
 * Course direct messages — Phase 9.
 *
 * A conversation lives inside one offering, so a message can only reach someone
 * who is already part of that class: a learner may write to the instructors, and
 * staff may write to the active cohort and to each other. Nobody can message
 * themselves, and an outsider gets a 404 because the offerings they cannot see
 * are none of their business.
 *
 * A message is personal content, so it produces one in-app notice and no email:
 * the platform does not copy private conversation into a mailbox, and the queue in
 * `delivery-queue.ts` would otherwise have to store that text for retries.
 */

import { z } from "zod";

import type { AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { ConflictError, ResourceNotFoundError } from "@/lib/errors";
import { resolveAudience } from "@/modules/communication/audience";
import { notify } from "@/modules/notifications/dispatch";

export type MessageContact = {
  userId: string;
  name: string;
  role: "staff" | "learner";
  lastMessageAt: Date | null;
  lastPreview: string | null;
  unread: number;
};

export type ConversationList = {
  role: "staff" | "learner";
  courseCode: string;
  courseTitle: string;
  contacts: MessageContact[];
  unreadTotal: number;
};

export type MessageView = {
  id: string;
  body: string;
  mine: boolean;
  senderName: string;
  readAt: Date | null;
  createdAt: Date;
};

export type ConversationView = {
  role: "staff" | "learner";
  courseCode: string;
  courseTitle: string;
  contact: Omit<MessageContact, "lastMessageAt" | "lastPreview" | "unread">;
  messages: MessageView[];
};

const messageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write a message before sending.")
    .max(4_000, "Messages are limited to 4000 characters."),
});

export type MessageInput = z.input<typeof messageSchema>;

/** Everyone this caller may write to in the offering, with the latest message. */
export async function listConversations(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<ConversationList> {
  const audience = await resolveAudience(account, offeringId, db);
  const contacts = await contactsFor(audience, account, db);

  const [outgoing, incoming] = await Promise.all([
    db.directMessage.findMany({
      where: {
        tenantId: audience.tenantId,
        offeringId: audience.offeringId,
        senderUserId: account.user.id,
      },
      orderBy: { createdAt: "desc" },
      select: { recipientUserId: true, body: true, createdAt: true },
    }),
    db.directMessage.findMany({
      where: {
        tenantId: audience.tenantId,
        offeringId: audience.offeringId,
        recipientUserId: account.user.id,
      },
      orderBy: { createdAt: "desc" },
      select: { senderUserId: true, body: true, createdAt: true, readAt: true },
    }),
  ]);

  const latest = new Map<string, { body: string; createdAt: Date }>();
  for (const message of [...outgoing, ...incoming].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  )) {
    const other = "recipientUserId" in message ? message.recipientUserId : message.senderUserId;
    if (!latest.has(other)) latest.set(other, { body: message.body, createdAt: message.createdAt });
  }

  const unread = new Map<string, number>();
  for (const message of incoming) {
    if (message.readAt !== null) continue;
    unread.set(message.senderUserId, (unread.get(message.senderUserId) ?? 0) + 1);
  }

  const rows: MessageContact[] = contacts.map((contact) => {
    const last = latest.get(contact.userId);
    return {
      ...contact,
      lastMessageAt: last?.createdAt ?? null,
      lastPreview: last ? preview(last.body) : null,
      unread: unread.get(contact.userId) ?? 0,
    };
  });

  rows.sort((left, right) => {
    const leftAt = left.lastMessageAt?.getTime() ?? 0;
    const rightAt = right.lastMessageAt?.getTime() ?? 0;
    if (leftAt !== rightAt) return rightAt - leftAt;
    return left.name.localeCompare(right.name);
  });

  return {
    role: audience.role,
    courseCode: audience.courseCode,
    courseTitle: audience.courseTitle,
    contacts: rows,
    unreadTotal: rows.reduce((total, row) => total + row.unread, 0),
  };
}

/**
 * One conversation, oldest message first. Opening it marks the messages the
 * other person sent as read — that is the only write a read does, and it is
 * scoped to this caller as the recipient.
 */
export async function getConversation(
  account: AccountContext,
  offeringId: string,
  otherUserId: string,
  db: DatabaseClient = getDb(),
): Promise<ConversationView> {
  const audience = await resolveAudience(account, offeringId, db);
  const contact = await requireContact(audience, account, otherUserId, db);

  await db.directMessage.updateMany({
    where: {
      tenantId: audience.tenantId,
      offeringId: audience.offeringId,
      senderUserId: otherUserId,
      recipientUserId: account.user.id,
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  const rows = await db.directMessage.findMany({
    where: {
      tenantId: audience.tenantId,
      offeringId: audience.offeringId,
      OR: [
        { senderUserId: account.user.id, recipientUserId: otherUserId },
        { senderUserId: otherUserId, recipientUserId: account.user.id },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      body: true,
      senderUserId: true,
      readAt: true,
      createdAt: true,
      sender: { select: { name: true } },
    },
  });

  return {
    role: audience.role,
    courseCode: audience.courseCode,
    courseTitle: audience.courseTitle,
    contact,
    messages: rows.map((row) => ({
      id: row.id,
      body: row.body,
      mine: row.senderUserId === account.user.id,
      senderName: row.sender.name,
      readAt: row.readAt,
      createdAt: row.createdAt,
    })),
  };
}

/** Sends one message and notifies the recipient in the app. */
export async function sendMessage(
  account: AccountContext,
  offeringId: string,
  input: MessageInput & { recipientUserId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  const audience = await resolveAudience(account, offeringId, db);
  const parsed = messageSchema.parse(input);
  const contact = await requireContact(audience, account, input.recipientUserId, db);

  const message = await db.directMessage.create({
    data: {
      tenantId: audience.tenantId,
      offeringId: audience.offeringId,
      senderUserId: account.user.id,
      recipientUserId: contact.userId,
      body: parsed.body,
    },
    select: { id: true },
  });

  const sender = await db.user.findFirstOrThrow({
    where: { id: account.user.id },
    select: { name: true, email: true },
  });

  await notify(db, {
    tenantId: audience.tenantId,
    category: "announcements",
    template: "message.received",
    recipients: [{ userId: contact.userId, name: contact.name, email: contact.email }],
    payload: {
      href: `${basePath(contact.role)}/courses/${audience.offeringId}/messages?with=${account.user.id}`,
      senderName: sender.name,
      courseCode: audience.courseCode,
      messageBody: parsed.body,
    },
    dedupeKey: `direct_message:${message.id}`,
    email: false,
  });

  return message;
}

function basePath(role: "staff" | "learner"): string {
  return role === "staff" ? "/faculty" : "/student";
}

type Audience = Awaited<ReturnType<typeof resolveAudience>>;

async function contactsFor(
  audience: Audience,
  account: AccountContext,
  db: DatabaseClient,
): Promise<{ userId: string; name: string; role: "staff" | "learner"; email: string }[]> {
  if (audience.role === "learner") {
    return staffContacts(audience, account, db);
  }

  const [learners, staff] = await Promise.all([
    db.enrolment.findMany({
      where: {
        tenantId: audience.tenantId,
        courseOfferingId: audience.offeringId,
        status: "ACTIVE",
        userId: { not: account.user.id },
      },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
    staffContacts(audience, account, db),
  ]);

  return [
    ...learners.map((row) => ({
      userId: row.user.id,
      name: row.user.name,
      email: row.user.email,
      role: "learner" as const,
    })),
    ...staff,
  ];
}

async function staffContacts(
  audience: Audience,
  account: AccountContext,
  db: DatabaseClient,
): Promise<{ userId: string; name: string; role: "staff"; email: string }[]> {
  const rows = await db.courseInstructor.findMany({
    where: {
      tenantId: audience.tenantId,
      courseOfferingId: audience.offeringId,
      userId: { not: account.user.id },
      user: { status: "ACTIVE" },
    },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });

  return rows.map((row) => ({
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    role: "staff" as const,
  }));
}

/** Resolves the other party, refusing anyone outside this offering's audience. */
async function requireContact(
  audience: Audience,
  account: AccountContext,
  otherUserId: string,
  db: DatabaseClient,
): Promise<{ userId: string; name: string; role: "staff" | "learner"; email: string }> {
  if (!otherUserId) throw new ResourceNotFoundError("Person not found.");
  if (otherUserId === account.user.id) {
    throw new ConflictError("You cannot send a message to yourself.");
  }

  const contacts = await contactsFor(audience, account, db);
  const contact = contacts.find((row) => row.userId === otherUserId);
  if (!contact) throw new ResourceNotFoundError("Person not found.");
  return contact;
}

function preview(body: string): string {
  return body.length > 120 ? `${body.slice(0, 117)}…` : body;
}
