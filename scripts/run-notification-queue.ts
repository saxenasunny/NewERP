/**
 * Notification queue runner — Phase 9.
 *
 * `npm run jobs:notifications` sends every queued email whose retry time has
 * come and prints a summary. Point cron (or the platform scheduler) at it every
 * few minutes: in-app notices are written immediately, so this job only catches
 * email the transport refused on the first attempt.
 *
 * A message that fails again is rescheduled with exponential backoff (5, 10, 20,
 * 40 minutes) and left `failed` with a null `next_attempt_at` after five
 * attempts, so an operator can see exactly what never went out. Running the job
 * early is harmless — nothing is due, so nothing is sent.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

import { disconnectDb, getDb } from "../lib/db/client";
import {
  countPendingDeliveries,
  processDeliveryQueue,
} from "../modules/notifications/delivery-queue";

async function main(): Promise<void> {
  const db = getDb();
  const summary = await processDeliveryQueue({}, db);
  const remaining = await countPendingDeliveries(db);

  console.log(JSON.stringify({ ranAt: new Date().toISOString(), summary, remaining }, null, 2));

  await disconnectDb();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "The notification queue job failed.");
  await disconnectDb();
  process.exitCode = 1;
});
