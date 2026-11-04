"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.replace("/sign-in?notice=signed-out");
    router.refresh();
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      onClick={signOut}
      disabled={pending}
      aria-label="Sign out"
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
