import { headers } from "next/headers";

import { getAuth } from "./config";

export type AuthenticatedSession = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>
>;

/**
 * Server-validated session. Better Auth's cookie cache is disabled, so this
 * checks the session row and its expiry in PostgreSQL on every call. The
 * presence of a cookie alone is never treated as authentication.
 */
export async function getSession(): Promise<AuthenticatedSession | null> {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
}
