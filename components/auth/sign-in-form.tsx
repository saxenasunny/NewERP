"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth/client";

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const notice = searchParams.get("notice");

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    const { error: signInError } = await authClient.signIn.email({
      email,
      password,
      rememberMe: false,
    });

    if (signInError) {
      console.error("Sign-in error details:", signInError);
      // Deliberately generic: never reveal whether the address exists.
      setError(
        signInError.status === 429
          ? "Too many sign-in attempts. Wait a minute and try again."
          : "The email or password is incorrect.",
      );
      setPending(false);
      return;
    }

    router.replace(nextPath);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {notice === "invitation-accepted" ? (
        <Alert tone="success" title="Account ready">
          Your account was created. Sign in with the email address that received the invitation.
        </Alert>
      ) : null}
      {notice === "signed-out" ? (
        <Alert tone="info" title="Signed out">
          Your session has ended.
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Could not sign in">
          {error}
        </Alert>
      ) : null}

      <Input
        id="sign-in-email"
        name="email"
        label="Institution email"
        type="email"
        autoComplete="username"
        required
      />
      <Input
        id="sign-in-password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
      />

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <div className="text-ink-muted flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/forgot-password" className="text-brand-800 font-medium hover:underline">
          Forgot your password?
        </Link>
        <span>Access is by invitation only.</span>
      </div>
    </form>
  );
}
