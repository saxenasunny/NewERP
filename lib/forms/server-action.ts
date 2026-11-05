import { AppError, RateLimitedError } from "@/lib/errors";
import { ZodError } from "zod";

/** The outcome of a Server Action service call, without throwing. */
export type Attempt<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Runs a service call and captures an expected failure as a message.
 *
 * `redirect()` works by throwing in Next.js, so actions must never call it
 * inside `attempt`'s try block. Redirect only after this helper returns.
 */
export async function attempt<T>(work: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
}

export function failureMessage(error: unknown): string {
  if (error instanceof RateLimitedError) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (error instanceof AppError) return error.message;

  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    if (firstIssue) {
      const field = firstIssue.path.length ? `${firstIssue.path.join(".")}: ` : "";
      return `${field}${firstIssue.message}`;
    }
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray((error as { issues: unknown }).issues)
  ) {
    const issues = (error as { issues: Array<{ path?: (string | number)[]; message?: string }> }).issues;
    const first = issues[0];
    if (first?.message) {
      const field = first.path && first.path.length ? `${first.path.join(".")}: ` : "";
      return `${field}${first.message}`;
    }
  }

  if (error instanceof Error && error.message) {
    const code = (error as { code?: string }).code;
    if (code === "P2002" || code === "23505") {
      return "A record with these details already exists.";
    }
    return error.message;
  }

  return "The change could not be saved. Try again.";
}

/** Appends an encoded notice/error to an internal path. */
export function withMessage(path: string, key: "notice" | "error", message: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${key}=${encodeURIComponent(message)}`;
}

/**
 * Only redirect back to a path inside the section that submitted the form.
 * Prevents an open-redirect through a crafted `returnTo` value.
 */
export function safeReturnTo(
  value: FormDataEntryValue | null,
  allowedPrefixes: readonly string[],
  fallback: string,
): string {
  const path = typeof value === "string" ? value : "";
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  return allowedPrefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}/`),
  )
    ? path
    : fallback;
}
