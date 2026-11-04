import { getServerEnv } from "@/lib/env";

/** Absolute URL under the configured application origin (no headers involved). */
export function absoluteUrl(path: string): string {
  const { APP_BASE_URL } = getServerEnv();
  return `${APP_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
