import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { SignInForm } from "@/components/auth/sign-in-form";
import { getAccountContext } from "@/lib/auth/account";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function SignInPage() {
  const account = await getAccountContext();
  if (account) redirect(account.homePath);

  return (
    <AuthCard
      title="Sign in"
      description="Use the institution email address your invitation was sent to."
      footer={
        <p>
          Trouble signing in? Contact your institution administrator.{" "}
          <Link href="/" className="text-brand-800 font-medium hover:underline">
            Back to overview
          </Link>
        </p>
      }
    >
      <SignInForm />
    </AuthCard>
  );
}
