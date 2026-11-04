"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth/client";

const MIN_PASSWORD_LENGTH = 12;

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const linkError = searchParams.get("error");

  const [error, setError] = useState<string | null>(
    linkError ? "This reset link is invalid or has expired." : null,
  );
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("This reset link is missing its token. Request a new link.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setPending(true);
    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setPending(false);

    if (resetError) {
      setError(
        resetError.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "This reset link is invalid, expired, or already used. Request a new link.",
      );
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title="Password changed">
          All other sessions were signed out. Sign in with your new password.
        </Alert>
        <Link href="/sign-in" className="text-brand-800 text-sm font-medium hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {error ? (
        <Alert tone="danger" title="Could not reset the password">
          {error}
        </Alert>
      ) : null}
      <Input
        id="reset-password"
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        required
      />
      <Input
        id="reset-confirmation"
        name="confirmation"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
      />
      <Button type="submit" disabled={pending || !token} className="w-full">
        {pending ? "Saving…" : "Set new password"}
      </Button>
      {!token ? (
        <p className="text-ink-muted text-sm">
          Request a new link from{" "}
          <Link href="/forgot-password" className="text-brand-800 font-medium hover:underline">
            forgot password
          </Link>
          .
        </p>
      ) : null}
    </form>
  );
}
