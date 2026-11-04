import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth/config";

/**
 * Better Auth's HTTP endpoints: sign-in, sign-out, password reset, session
 * lookup, and invitation-adjacent flows. The configuration in
 * `lib/auth/config.ts` owns validation, rate limits, and session rules; this
 * file only adapts them to the App Router.
 */
export const { GET, POST } = toNextJsHandler(getAuth().handler);
