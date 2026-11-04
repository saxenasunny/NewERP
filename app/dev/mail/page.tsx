import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { getDb } from "@/lib/db/client";

export const metadata: Metadata = { title: "Development outbox", robots: { index: false } };

function firstLink(body: string): string | null {
  const match = body.match(/https?:\/\/[^\s]+/);
  return match?.[0] ?? null;
}

export default async function DevelopmentMailPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const messages = await getDb().emailMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      to: true,
      subject: true,
      body: true,
      transport: true,
      createdAt: true,
      sentAt: true,
      error: true,
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
      <PageHeader
        eyebrow="Development only"
        title="Outbox"
        description="Messages written by the transactional mail adapter. No email leaves this machine."
      />

      <Alert tone="warning" title="Contains single-use links">
        This page exposes password-reset and invitation links. It is disabled in production and must
        not be reachable from an untrusted network.
      </Alert>

      {messages.length === 0 ? (
        <p className="text-ink-muted text-sm">
          No messages yet. Request a password reset or invite someone to see one here.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {messages.map((message) => {
            const link = firstLink(message.body);
            return (
              <li
                key={message.id}
                className="rounded-card border-border bg-surface shadow-card flex flex-col gap-3 border p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-ink font-medium">{message.subject}</p>
                    <p className="text-ink-muted text-sm">To {message.to}</p>
                  </div>
                  <StatusBadge tone={message.sentAt ? "success" : "warning"}>
                    {message.sentAt ? "Captured" : "Not delivered"}
                  </StatusBadge>
                </div>

                <p className="text-ink-muted text-xs">
                  {message.transport} · {message.createdAt.toLocaleString("en-GB")}
                </p>

                {message.error ? (
                  <Alert tone="danger" title="Delivery error">
                    {message.error}
                  </Alert>
                ) : null}

                <pre className="bg-surface-muted text-ink overflow-x-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
                  {message.body}
                </pre>

                {link ? (
                  <a
                    href={link}
                    className="text-brand-800 text-sm font-medium break-all hover:underline"
                  >
                    Open the link in this message
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
