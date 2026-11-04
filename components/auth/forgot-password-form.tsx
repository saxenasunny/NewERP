"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth/client";

export function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");

    const { error: requestError } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setPending(false);
    if (requestError?.status === 429) {
      setError("Too many reset requests. Wait a minute and try again.");
      return;
    }
    // Success and unknown addresses look identical on purpose.
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title="Check your email">
          If an account exists for that address, a single-use reset link has been sent. It expires
          in 30 minutes.
        </Alert>
        {process.env.NODE_ENV !== "production" ? (
          <p className="text-ink-muted text-sm">
            Development has no mail server. Open the{" "}
            <a className="text-brand-800 font-medium hover:underline" href="/dev/mail">
              development outbox
            </a>{" "}
            to follow the link.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {error ? (
        <Alert tone="danger" title="Could not send the link">
          {error}
        </Alert>
      ) : null}
      <Input
        id="forgot-email"
        name="email"
        label="Institution email"
        type="email"
        autoComplete="username"
        hint="We will send a single-use link if the address has an account."
        required
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
