import { getDb } from "@/lib/db/client";
import { getServerEnv } from "@/lib/env";
import { log } from "@/lib/observability/logger";

export type MailInput = {
  to: string;
  subject: string;
  body: string;
};

export type MailResult = {
  messageId: string;
  delivered: boolean;
};

/**
 * Transactional email adapter.
 *
 * Every message is written to `email_messages` so the development sink
 * (`/dev/mail`) can display it and so an operator can inspect what would have
 * been sent. There is **no production provider configured**: outside
 * development the row is marked with an error, nothing leaves the server, and
 * the caller/operator sees the failure in logs. Do not present this as working
 * email delivery.
 *
 * Message bodies can contain single-use links, so they are never logged and the
 * development viewer is disabled outside development.
 */
export async function sendMail(input: MailInput): Promise<MailResult> {
  const env = getServerEnv();
  const db = getDb();
  const isProduction = env.NODE_ENV === "production";

  const message = await db.emailMessage.create({
    data: {
      transport: isProduction ? "unconfigured" : "development_outbox",
      to: input.to,
      subject: input.subject,
      body: input.body,
    },
    select: { id: true },
  });

  if (isProduction) {
    await db.emailMessage.update({
      where: { id: message.id },
      data: { error: "No email provider is configured. The message was not delivered." },
    });
    log("error", "email.not_delivered", {
      messageId: message.id,
      reason: "no_provider_configured",
    });
    return { messageId: message.id, delivered: false };
  }

  await db.emailMessage.update({
    where: { id: message.id },
    data: { sentAt: new Date() },
  });
  log("info", "email.outbox_written", { messageId: message.id, to: maskEmail(input.to) });

  return { messageId: message.id, delivered: true };
}

/** Keeps addresses out of logs while still allowing support triage. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - visible.length, 3))}@${domain}`;
}
