import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default function ResetPasswordPage() {
  return (
    <AuthCard
      title="Choose a new password"
      description="This single-use link expires 30 minutes after it was requested."
      footer={
        <p>
          <Link href="/sign-in" className="text-brand-800 font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthCard>
  );
}
