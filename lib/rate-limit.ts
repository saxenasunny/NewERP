import type { DatabaseClient } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import { RateLimitedError } from "@/lib/errors";

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Database-backed fixed-window limiter for our own sensitive endpoints.
 *
 * Better Auth limits its own HTTP endpoints in memory per process; this covers
 * Server Actions such as invitation acceptance, where a shared counter is
 * required. The increment is a single atomic statement, so concurrent requests
 * cannot both observe the same count.
 */
export async function consumeRateLimit({
  key,
  limit,
  windowSeconds,
  db = getDb(),
  now = new Date(),
}: {
  key: string;
  limit: number;
  windowSeconds: number;
  db?: DatabaseClient;
  now?: Date;
}): Promise<RateLimitDecision> {
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);

  const rows = await db.$queryRaw<Array<{ count: number; reset_at: Date }>>`
    INSERT INTO "rate_limit_buckets" ("key", "count", "reset_at", "updated_at")
    VALUES (${key}, 1, ${resetAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "rate_limit_buckets"."reset_at" <= ${now} THEN 1
        ELSE "rate_limit_buckets"."count" + 1
      END,
      "reset_at" = CASE
        WHEN "rate_limit_buckets"."reset_at" <= ${now} THEN ${resetAt}
        ELSE "rate_limit_buckets"."reset_at"
      END,
      "updated_at" = ${now}
    RETURNING "count", "reset_at"
  `;

  const row = rows[0];
  if (!row) {
    // A failed insert must not silently disable the protection.
    throw new Error("Rate limit store returned no row.");
  }

  const count = Number(row.count);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((new Date(row.reset_at).getTime() - now.getTime()) / 1000),
  );

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds,
  };
}

/** Throws a mapped 429 instead of returning a decision. */
export async function enforceRateLimit(options: {
  key: string;
  limit: number;
  windowSeconds: number;
  db?: DatabaseClient;
  now?: Date;
}): Promise<void> {
  const decision = await consumeRateLimit(options);
  if (!decision.allowed) {
    throw new RateLimitedError(decision.retryAfterSeconds);
  }
}
