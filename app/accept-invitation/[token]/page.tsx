import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { acceptInvitationAction } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { getInvitationPreview } from "@/modules/identity/invitation-service";

export const metadata: Metadata = { title: "Accept invitation", robots: { index: false } };

export default async function AcceptInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const preview = await getInvitationPreview(token);

  if (!preview) {
    return (
      <AuthCard
        title="Invitation unavailable"
        description="This invitation link is invalid, expired, revoked, or already used."
        footer={
          <p>
            Ask your institution administrator for a new invitation, or{" "}
            <Link href="/sign-in" className="text-brand-800 font-medium hover:underline">
              sign in
            </Link>{" "}
            if you already have an account.
          </p>
        }
      >
        <Alert tone="warning" title="Single-use links">
          Invitations expire after 7 days and can only be accepted once.
        </Alert>
      </AuthCard>
    );
  }

  const nextPath = `/accept-invitation/${token}`;

  return (
    <AuthCard
      title={`Join ${preview.institutionName}`}
      description={`${preview.email} was invited as ${preview.roleName}.`}
      footer={
        <p>
          Wrong address? Ask your institution administrator to revoke this invitation and issue a
          new one.
        </p>
      }
    >
      {error ? (
        <div className="mb-5">
          <Alert tone="danger" title="Could not accept the invitation">
            {error}
          </Alert>
        </div>
      ) : null}

      {preview.requiresSignIn ? (
        <div className="flex flex-col gap-4">
          <Alert tone="info" title="You already have an account">
            Sign in as {preview.email} to add {preview.institutionName} to your account.
          </Alert>
          <Link
            href={`/sign-in?next=${encodeURIComponent(nextPath)}`}
            className="bg-brand-700 hover:bg-brand-800 inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium text-white"
          >
            Sign in to accept
          </Link>
        </div>
      ) : (
        <form action={acceptInvitationAction} className="flex flex-col gap-5">
          <input type="hidden" name="token" value={token} />
          <Input
            id="invitation-email"
            label="Email"
            value={preview.email}
            readOnly
            disabled
            hint="The invitation is tied to this address."
          />
          <Input id="invitation-name" name="name" label="Full name" autoComplete="name" required />
          <Input
            id="invitation-password"
            name="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters."
            minLength={12}
            required
          />
          <Input
            id="invitation-confirmation"
            name="confirmation"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />

          {preview.roleKey === "student" ? (
            <div className="border-border border-t pt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-ink text-sm font-semibold">Student Admission Record</h3>
                <p className="text-ink-muted text-xs">
                  Your university enrollment number will be automatically allocated upon acceptance.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  id="student-phone"
                  name="phone"
                  label="Contact phone"
                  type="tel"
                  placeholder="e.g. 9876543210"
                  required
                />
                <Input
                  id="student-dob"
                  name="dateOfBirth"
                  label="Date of birth"
                  type="date"
                  required
                />
              </div>

              <Select id="student-gender" name="gender" label="Gender" defaultValue="Male" required>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </Select>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  id="student-guardian-name"
                  name="guardianName"
                  label="Parent / Guardian name"
                  placeholder="Father's / Mother's name"
                  required
                />
                <Input
                  id="student-guardian-phone"
                  name="guardianPhone"
                  label="Parent / Guardian phone"
                  type="tel"
                  placeholder="Emergency contact number"
                  required
                />
              </div>

              <Input
                id="student-address"
                name="address"
                label="Residential address"
                placeholder="Street address / House number"
                required
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input id="student-city" name="city" label="City" placeholder="City" required />
                <Input id="student-state" name="state" label="State" placeholder="State" required />
                <Input
                  id="student-pincode"
                  name="postalCode"
                  label="Postal code"
                  placeholder="PIN / Zip"
                  required
                />
              </div>
            </div>
          ) : null}

          <Button type="submit" className="w-full">
            Complete Admission & Create Account
          </Button>
          <p className="text-ink-muted text-sm">
            Invitation expires {preview.expiresAt.toLocaleDateString("en-GB")}. You will sign in
            after creating your account.
          </p>
        </form>
      )}
    </AuthCard>
  );
}
