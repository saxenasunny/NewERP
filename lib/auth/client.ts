import { createAuthClient } from "better-auth/react";

/**
 * Browser client for Better Auth's own endpoints. It is same-origin, so the
 * session cookie is set by the route handler and never read by our JavaScript.
 */
export const authClient = createAuthClient();
