import type { PrismaClient } from "@/generated/prisma/client";

type DbClient = {
  tenantMembership: Pick<PrismaClient["tenantMembership"], "findMany">;
};

/**
 * Generates the next sequential enrollment number without any hyphen, dash, or special characters.
 * Starts with the 4-digit year number followed by a sequential number:
 * e.g. 2026001, 2026002, 2026003, ... 2026010, ...
 */
export async function generateNextEnrollmentNumber(
  db: DbClient,
  tenantId: string,
  year: number = new Date().getFullYear(),
): Promise<string> {
  const prefix = String(year);
  const existing = await db.tenantMembership.findMany({
    where: {
      tenantId,
      institutionalId: { startsWith: prefix },
    },
    select: { institutionalId: true },
  });

  let maxSerial = 0;
  for (const row of existing) {
    if (!row.institutionalId) continue;
    if (row.institutionalId.startsWith(prefix)) {
      const remainder = row.institutionalId.slice(prefix.length);
      if (/^\d+$/.test(remainder)) {
        const num = parseInt(remainder, 10);
        if (num > maxSerial) {
          maxSerial = num;
        }
      }
    }
  }

  const nextSerial = maxSerial + 1;
  return `${prefix}${String(nextSerial).padStart(3, "0")}`;
}
