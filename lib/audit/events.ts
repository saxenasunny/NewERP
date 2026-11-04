import type { Prisma } from "@/generated/prisma/client";
import type { DatabaseClient } from "@/lib/db/client";

type AuditWritable = Pick<DatabaseClient, "auditEvent"> | Prisma.TransactionClient;

export type AuditEventInput = {
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  reason?: string | null;
  requestId?: string | null;
};

/**
 * Appends an audit event. Call inside the same transaction as the mutation it
 * records so the change and its evidence succeed or fail together.
 */
export async function recordAuditEvent(db: AuditWritable, input: AuditEventInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
      reason: input.reason ?? null,
      requestId: input.requestId ?? null,
    },
  });
}
