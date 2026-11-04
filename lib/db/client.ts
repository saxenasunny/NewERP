import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client";
import { getServerEnv } from "../env";

export type DatabaseClient = PrismaClient;

const globalForPrisma = globalThis as unknown as { lmsPrisma?: DatabaseClient };

function createClient(): DatabaseClient {
  const { DATABASE_URL } = getServerEnv();
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * Lazy singleton. Importing this module must not require a database
 * connection, so builds and static pages stay independent of infrastructure.
 */
export function getDb(): DatabaseClient {
  globalForPrisma.lmsPrisma ??= createClient();
  return globalForPrisma.lmsPrisma;
}

/** Readiness check with a bounded wait. */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Test helper: releases the pool so a test process can exit cleanly. */
export async function disconnectDb(): Promise<void> {
  if (globalForPrisma.lmsPrisma) {
    await globalForPrisma.lmsPrisma.$disconnect();
    globalForPrisma.lmsPrisma = undefined;
  }
}
