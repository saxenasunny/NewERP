import { z } from "zod";

/**
 * Server-only environment configuration.
 *
 * Validation is lazy so that `next build` and client bundles never require
 * runtime secrets. Anything that needs configuration must call
 * `getServerEnv()` at request time, where a misconfiguration becomes a clear,
 * fail-closed error instead of `undefined` leaking into a query or a cookie.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && value === url.origin;
    } catch {
      return false;
    }
  }, "must be an absolute http(s) origin with no path or trailing slash"),
  DATABASE_URL: z
    .string()
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "must be a PostgreSQL connection string",
    ),
  AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  /** Sender shown on transactional email. Delivery itself is not configured. */
  EMAIL_FROM: z.string().min(3).default("LMS Platform <no-reply@lms.example>"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  /** Names of the offending variables. Never includes their values. */
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    const list = variables.join(", ");
    super(`Invalid or missing server environment variables: ${list}`);
    this.name = "EnvValidationError";
    this.variables = variables;
  }
}

/**
 * Parses without touching global state. Exported so tests can exercise the
 * rules without mutating `process.env`.
 */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const normalizedSource = { ...source };
  if (!normalizedSource.APP_BASE_URL && normalizedSource.VERCEL_URL) {
    normalizedSource.APP_BASE_URL = `https://${normalizedSource.VERCEL_URL}`;
  }

  const result = serverEnvSchema.safeParse(normalizedSource);
  if (!result.success) {
    const variables = [
      ...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "unknown"))),
    ];
    throw new EnvValidationError(variables);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/** Test helper: clears the module-level cache. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
