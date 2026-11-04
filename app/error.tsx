"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log only the digest; error details may contain tenant data.
    console.error("Route error", error.digest ?? "no digest");
  }, [error.digest]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-16">
      <h1 className="text-ink text-2xl font-semibold">Something went wrong</h1>
      <p className="text-ink-muted">
        This page could not be rendered. The problem was recorded with reference{" "}
        <span className="font-mono text-sm">{error.digest ?? "unavailable"}</span>.
      </p>
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
