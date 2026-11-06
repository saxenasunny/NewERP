/**
 * Notification templates — Phase 9.
 *
 * Every notice the platform sends is described here once: the in-app title and
 * body, the email subject and body, and the link it points at. Callers pass a
 * payload; this module validates it and renders the text.
 *
 * The same module renders a queued email later, after a retry, from the payload
 * stored in `notification_deliveries`. That is why payloads hold plain strings
 * (ISO timestamps, not `Date` objects) and why every template validates its own
 * payload: a row written by an older build must fail loudly as `skipped` rather
 * than send a broken message.
 */

import { z } from "zod";

const bodyText = z.string().trim().min(1).max(20_000);

const dateText = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Expected an ISO timestamp.");

const base = {
  recipientName: z.string().trim().min(1).max(200),
  href: z.string().trim().startsWith("/").max(500),
};

const templates = {
  "session.reminder": {
    schema: z.object({
      ...base,
      courseCode: z.string().trim().min(1).max(40),
      courseTitle: z.string().trim().min(1).max(200),
      sessionTitle: z.string().trim().min(1).max(200),
      startsAt: dateText,
      joinUrl: z.string().trim().url().max(2_000).nullable().optional(),
    }),
    render: (payload: {
      recipientName: string;
      courseCode: string;
      courseTitle: string;
      sessionTitle: string;
      startsAt: string;
      joinUrl?: string | null;
    }) => ({
      title: `${payload.courseCode}: session starting soon`,
      body: `"${payload.sessionTitle}" for ${payload.courseCode} ${payload.courseTitle} starts at ${formatWhen(payload.startsAt)}.`,
      subject: `${payload.courseCode}: session starting soon`,
      emailBody: [
        `Hello ${payload.recipientName},`,
        "",
        `The live session "${payload.sessionTitle}" for ${payload.courseCode} ${payload.courseTitle} starts at ${formatWhen(payload.startsAt)}.`,
        ...(payload.joinUrl
          ? [`Join link: ${payload.joinUrl}`]
          : ["No meeting link has been set yet."]),
        "",
        "Open the course in the LMS for the full schedule.",
      ].join("\n"),
    }),
  },

  "session.changed": {
    schema: z.object({
      ...base,
      courseCode: z.string().trim().min(1).max(40),
      courseTitle: z.string().trim().min(1).max(200),
      sessionTitle: z.string().trim().min(1).max(200),
      startsAt: dateText,
      endsAt: dateText,
      change: z.enum(["cancelled", "rescheduled", "scheduled"]),
    }),
    render: (payload: {
      recipientName: string;
      courseCode: string;
      courseTitle: string;
      sessionTitle: string;
      startsAt: string;
      endsAt: string;
      change: "cancelled" | "rescheduled" | "scheduled";
    }) => ({
      title:
        payload.change === "scheduled"
          ? `${payload.courseCode}: new live session scheduled`
          : `${payload.courseCode}: session ${payload.change}`,
      body:
        payload.change === "scheduled"
          ? `"${payload.sessionTitle}" scheduled for ${formatWhen(payload.startsAt)} – ${formatWhen(payload.endsAt)}.`
          : payload.change === "rescheduled"
            ? `"${payload.sessionTitle}" moved to ${formatWhen(payload.startsAt)} – ${formatWhen(payload.endsAt)}.`
            : `"${payload.sessionTitle}" has been cancelled.`,
      subject:
        payload.change === "scheduled"
          ? `${payload.courseCode}: new live session scheduled`
          : `${payload.courseCode}: session ${payload.change}`,
      emailBody: [
        `Hello ${payload.recipientName},`,
        "",
        payload.change === "scheduled"
          ? `A new live session "${payload.sessionTitle}" for ${payload.courseCode} ${payload.courseTitle} has been scheduled.`
          : `The session "${payload.sessionTitle}" for ${payload.courseCode} ${payload.courseTitle} has been ${payload.change}.`,
        ...(payload.change !== "cancelled"
          ? [`Time: ${payload.startsAt} to ${payload.endsAt}`]
          : []),
        "",
        "Open the course in the LMS for the current schedule.",
      ].join("\n"),
    }),
  },

  "assignment.due": {
    schema: z.object({
      ...base,
      courseCode: z.string().trim().min(1).max(40),
      courseTitle: z.string().trim().min(1).max(200),
      assignmentTitle: z.string().trim().min(1).max(200),
      dueAt: dateText,
    }),
    render: (payload: {
      recipientName: string;
      courseCode: string;
      courseTitle: string;
      assignmentTitle: string;
      dueAt: string;
    }) => ({
      title: `${payload.courseCode}: assignment due soon`,
      body: `"${payload.assignmentTitle}" for ${payload.courseCode} ${payload.courseTitle} is due ${formatWhen(payload.dueAt)}.`,
      subject: `${payload.courseCode}: assignment due soon`,
      emailBody: [
        `Hello ${payload.recipientName},`,
        "",
        `"${payload.assignmentTitle}" for ${payload.courseCode} ${payload.courseTitle} is due ${payload.dueAt}.`,
        "",
        "Open the course in the LMS to submit or review the assignment.",
      ].join("\n"),
    }),
  },

  "announcement.published": {
    schema: z.object({
      ...base,
      courseCode: z.string().trim().min(1).max(40),
      courseTitle: z.string().trim().min(1).max(200),
      announcementTitle: z.string().trim().min(1).max(200),
      announcementBody: bodyText,
    }),
    render: (payload: {
      recipientName: string;
      courseCode: string;
      courseTitle: string;
      announcementTitle: string;
      announcementBody: string;
    }) => ({
      title: `${payload.courseCode}: ${payload.announcementTitle}`,
      body: preview(payload.announcementBody, 240),
      subject: `${payload.courseCode}: ${payload.announcementTitle}`,
      emailBody: [
        `Hello ${payload.recipientName},`,
        "",
        `A new announcement was published for ${payload.courseCode} ${payload.courseTitle}.`,
        "",
        payload.announcementTitle,
        payload.announcementBody,
        "",
        "Open the course in the LMS to read it in context.",
      ].join("\n"),
    }),
  },

  "discussion.reply": {
    schema: z.object({
      ...base,
      authorName: z.string().trim().min(1).max(200),
      threadTitle: z.string().trim().min(1).max(200),
      replyBody: bodyText,
    }),
    render: (payload: {
      recipientName: string;
      authorName: string;
      threadTitle: string;
      replyBody: string;
    }) => ({
      title: `New reply in "${payload.threadTitle}"`,
      body: preview(payload.replyBody, 200),
      subject: `New reply in "${payload.threadTitle}"`,
      emailBody: [
        `Hello ${payload.recipientName},`,
        "",
        `${payload.authorName} replied in "${payload.threadTitle}":`,
        "",
        payload.replyBody,
      ].join("\n"),
    }),
  },

  "message.received": {
    schema: z.object({
      ...base,
      senderName: z.string().trim().min(1).max(200),
      courseCode: z.string().trim().min(1).max(40),
      messageBody: bodyText,
    }),
    render: (payload: {
      recipientName: string;
      senderName: string;
      courseCode: string;
      messageBody: string;
    }) => ({
      title: `${payload.senderName} sent you a message`,
      body: `${payload.courseCode}: ${preview(payload.messageBody, 160)}`,
      subject: `${payload.senderName} sent you a message (${payload.courseCode})`,
      emailBody: [
        `Hello ${payload.recipientName},`,
        "",
        `${payload.senderName} sent you a message in ${payload.courseCode}:`,
        "",
        payload.messageBody,
        "",
        "Open the conversation in the LMS to reply.",
      ].join("\n"),
    }),
  },
} as const;

export type NotificationTemplateKey = keyof typeof templates;

export type RenderedNotification = {
  title: string;
  body: string;
  subject: string;
  emailBody: string;
};

export const TEMPLATE_KEYS = Object.keys(templates) as NotificationTemplateKey[];

/** Renders one template from a stored payload, or throws if it does not match. */
export function renderNotification<K extends NotificationTemplateKey>(
  template: K,
  payload: unknown,
): RenderedNotification {
  const definition = templates[template];
  if (!definition) throw new Error(`Unknown notification template: ${template}`);
  const parsed = definition.schema.parse(payload);
  return definition.render(parsed as never);
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "UTC" });
}

function preview(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 3)}…` : text;
}
