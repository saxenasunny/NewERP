/**
 * Reminder job runner — Phase 9.
 *
 * `npm run jobs:reminders` runs both reminder jobs once and prints a summary.
 * Scheduling is deliberately the operator's job: point cron (or the platform's
 * scheduler) at this command every few minutes. Running it more often than
 * necessary is harmless — the dedupe keys in `reminder-service.ts` make a second
 * run inside the same window send nothing.
 *
 * In this build there is no production email provider. The adapter writes each
 * message to `email_messages`, marks it undelivered outside development, and
 * logs the failure; the summary printed here counts notices, not inboxes.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

import { disconnectDb, getDb } from "../lib/db/client";
import {
  runAssignmentDueReminders,
  runSessionReminders,
} from "../modules/notifications/reminder-service";

/**
 * Reads `--name value` or `--name=value`. A wider lead time is useful for a dry
 * run against seeded data, or for catching up after the scheduler was down.
 */
function numericArg(name: string): number | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (index === -1) return undefined;

  const arg = args[index]!;
  const raw = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[index + 1];
  if (!raw) return undefined;

  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

async function main(): Promise<void> {
  const db = getDb();
  const now = new Date();
  const leadMinutes = numericArg("lead-minutes");

  const sessions = await runSessionReminders({ now, leadMinutes }, db);
  const assignments = await runAssignmentDueReminders({ now, leadMinutes }, db);

  console.log(JSON.stringify({ ranAt: now.toISOString(), sessions, assignments }, null, 2));

  await disconnectDb();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "The reminder job failed.");
  await disconnectDb();
  process.exitCode = 1;
});
