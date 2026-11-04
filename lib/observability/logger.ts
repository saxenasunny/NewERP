export type LogLevel = "info" | "warn" | "error";

/**
 * Structured JSON logging. Callers pass identifiers and counters only —
 * names, emails, submission text, tokens, and answers must never be logged.
 */
export function log(level: LogLevel, message: string, context: Record<string, unknown> = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  const line = JSON.stringify(entry);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
