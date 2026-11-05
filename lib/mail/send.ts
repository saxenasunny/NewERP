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
 * Supports:
 * - Resend API (`RESEND_API_KEY`) via HTTP POST to https://api.resend.com/emails
 * - Development outbox (`email_messages` table) when no provider is set
 */
export async function sendMail(input: MailInput): Promise<MailResult> {
  const env = getServerEnv();
  const db = getDb();
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const isProduction = env.NODE_ENV === "production";

  const message = await db.emailMessage.create({
    data: {
      transport: resendApiKey
        ? "resend"
        : isProduction
          ? "unconfigured"
          : "development_outbox",
      to: input.to,
      subject: input.subject,
      body: input.body,
    },
    select: { id: true },
  });

  if (resendApiKey) {
    try {
      const from = process.env.EMAIL_FROM?.trim() || "NewERP <onboarding@resend.dev>";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: input.to,
          subject: input.subject,
          text: input.body,
        }),
      });

      if (res.ok) {
        await db.emailMessage.update({
          where: { id: message.id },
          data: { sentAt: new Date(), error: null },
        });
        log("info", "email.delivered_resend", {
          messageId: message.id,
          to: maskEmail(input.to),
        });
        return { messageId: message.id, delivered: true };
      } else {
        const errorText = await res.text();
        await db.emailMessage.update({
          where: { id: message.id },
          data: { error: `Resend error (${res.status}): ${errorText}` },
        });
        log("error", "email.resend_failed", {
          messageId: message.id,
          status: res.status,
          error: errorText,
        });
        return { messageId: message.id, delivered: false };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Network error";
      await db.emailMessage.update({
        where: { id: message.id },
        data: { error: `Resend exception: ${errorMsg}` },
      });
      log("error", "email.resend_exception", {
        messageId: message.id,
        error: errorMsg,
      });
      return { messageId: message.id, delivered: false };
    }
  }

  if (isProduction) {
    await db.emailMessage.update({
      where: { id: message.id },
      data: {
        error:
          "No email provider is configured. Set RESEND_API_KEY in environment variables to deliver emails.",
      },
    });
    log("warn", "email.not_delivered", {
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
