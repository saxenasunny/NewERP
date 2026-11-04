import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import {
  ConflictError,
  PermissionDeniedError,
  ResourceNotFoundError,
  TenantSelectionRequiredError,
} from "@/lib/errors";
import { getOfferingAccess } from "@/modules/content/content-service";

import { coverageWarnings, type CoverageWarning } from "./coverage";
import type { ObeEvidenceDoc } from "./evidence";
import {
  configFromDraftInput,
  defaultAttainmentPolicyConfig,
  formulaIsConfigured,
  isAllowedCorrelation,
  parseAttainmentPolicyConfig,
  policyDraftInputSchema,
  type AttainmentPolicyConfig,
  type PolicyDraftInput,
} from "./policy";

/**
 * OBE mapping: programme outcomes, course outcomes, CO–PO correlations,
 * assessment evidence, and versioned attainment policies.
 *
 * Attainment is not calculated here. An unconfigured policy still stores the
 * correlation scale and records that missing data is insufficient evidence.
 */

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function guardUnique<T>(work: () => Promise<T>, message: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(message);
    throw error;
  }
}

export function canManageInstitutionObe(account: AccountContext): boolean {
  return (
    account.permissions.has("obe.manage") &&
    (account.permissions.has("academic_structure.manage") ||
      account.permissions.has("reports.institution.read"))
  );
}

async function requireInstitutionObe(account: AccountContext): Promise<string> {
  requirePermission(account, "obe.manage");
  if (!canManageInstitutionObe(account)) {
    throw new PermissionDeniedError("Your role cannot manage programme outcomes or policies.");
  }
  return tenantIdOf(account);
}

async function requireCourseObe(account: AccountContext, offeringId: string, db: DatabaseClient) {
  requirePermission(account, "obe.manage");
  const access = await getOfferingAccess(account, offeringId, db);
  if (!canManageInstitutionObe(account) && !access.canManage) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }
  return access;
}

const outcomeCode = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(16, "Use at most 16 characters.")
  .regex(/^[A-Za-z0-9-]+$/, "Use letters, digits, and hyphens only.")
  .transform((value) => value.toUpperCase());

const outcomeTitle = z.string().trim().min(2, "Use at least 2 characters.").max(240);

const optionalDescription = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().trim().max(4000).optional(),
);

export const programmeOutcomeInputSchema = z.object({
  type: z.enum(["PEO", "PO", "PSO"]),
  code: outcomeCode,
  title: outcomeTitle,
  description: optionalDescription,
});

export const courseOutcomeInputSchema = z.object({
  code: outcomeCode,
  title: outcomeTitle,
  description: optionalDescription,
});

export const correlationInputSchema = z.object({
  courseOutcomeId: z.string().min(1),
  programmeOutcomeId: z.string().min(1),
  correlationLevel: z.coerce.number().int().min(1).max(9),
});

export const assessmentMappingInputSchema = z.object({
  courseOutcomeId: z.string().min(1),
  kind: z.enum(["ASSIGNMENT", "QUESTION"]),
  assignmentId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().min(1).optional(),
  ),
  questionId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().min(1).optional(),
  ),
  weight: z.coerce
    .number()
    .min(0.01, "Weight must be greater than zero.")
    .max(100, "Weight looks too large."),
});

export { policyDraftInputSchema };
export type { PolicyDraftInput };

type WriteContext = { requestId?: string | null };

export type ProgrammeOutcomeView = {
  id: string;
  programmeId: string;
  type: "PEO" | "PO" | "PSO";
  code: string;
  title: string;
  description: string | null;
  position: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
};

export type CourseOutcomeView = {
  id: string;
  offeringId: string;
  code: string;
  title: string;
  description: string | null;
  position: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
};

export type AttainmentPolicyView = {
  id: string;
  name: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  configuration: AttainmentPolicyConfig;
  notes: string | null;
  formulaConfigured: boolean;
  activatedAt: Date | null;
};

async function loadActivePolicyConfig(
  tenantId: string,
  db: DatabaseClient,
): Promise<AttainmentPolicyConfig> {
  const row = await db.attainmentPolicy.findFirst({
    where: { tenantId, status: "ACTIVE" },
  });
  if (!row) return defaultAttainmentPolicyConfig();
  return parseAttainmentPolicyConfig(row.configuration);
}

async function offeringProgramme(
  tenantId: string,
  offeringId: string,
  db: DatabaseClient,
): Promise<{ programmeId: string; programmeName: string; programmeCode: string } | null> {
  const offering = await db.courseOffering.findFirst({
    where: { id: offeringId, tenantId },
    select: {
      section: {
        select: {
          cohort: {
            select: { programme: { select: { id: true, name: true, code: true } } },
          },
        },
      },
    },
  });
  const programme = offering?.section?.cohort.programme;
  return programme
    ? { programmeId: programme.id, programmeName: programme.name, programmeCode: programme.code }
    : null;
}

function toProgrammeOutcome(row: {
  id: string;
  programmeId: string;
  type: "PEO" | "PO" | "PSO";
  code: string;
  title: string;
  description: string | null;
  position: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
}): ProgrammeOutcomeView {
  return {
    id: row.id,
    programmeId: row.programmeId,
    type: row.type,
    code: row.code,
    title: row.title,
    description: row.description,
    position: row.position,
    status: row.status,
  };
}

async function requireProgramme(tenantId: string, programmeId: string, db: DatabaseClient) {
  const programme = await db.programme.findFirst({
    where: { id: programmeId, tenantId },
    select: { id: true, name: true, code: true, department: { select: { name: true } } },
  });
  if (!programme) throw new ResourceNotFoundError();
  return programme;
}

export async function listObeProgrammes(account: AccountContext) {
  const tenantId = await requireInstitutionObe(account);
  const db = getDb();
  const programmes = await db.programme.findMany({
    where: { tenantId },
    orderBy: [{ code: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      department: { select: { name: true } },
      _count: { select: { outcomes: true } },
    },
  });
  return programmes.map((programme) => ({
    id: programme.id,
    name: programme.name,
    code: programme.code,
    status: programme.status,
    departmentName: programme.department.name,
    outcomeCount: programme._count.outcomes,
  }));
}

export async function getProgrammeOutcomes(account: AccountContext, programmeId: string) {
  const tenantId = await requireInstitutionObe(account);
  const db = getDb();
  const programme = await requireProgramme(tenantId, programmeId, db);
  const outcomes = await db.programmeOutcome.findMany({
    where: { tenantId, programmeId },
    orderBy: [{ type: "asc" }, { position: "asc" }, { code: "asc" }],
  });
  return {
    programme: {
      id: programme.id,
      name: programme.name,
      code: programme.code,
      departmentName: programme.department.name,
    },
    outcomes: outcomes.map(toProgrammeOutcome),
  };
}

export async function createProgrammeOutcome(
  account: AccountContext,
  programmeId: string,
  raw: unknown,
  context: WriteContext = {},
): Promise<ProgrammeOutcomeView> {
  const tenantId = await requireInstitutionObe(account);
  const input = programmeOutcomeInputSchema.parse(raw);
  const db = getDb();
  await requireProgramme(tenantId, programmeId, db);

  return guardUnique(async () => {
    return db.$transaction(async (tx) => {
      const last = await tx.programmeOutcome.findFirst({
        where: { tenantId, programmeId, type: input.type },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const created = await tx.programmeOutcome.create({
        data: {
          tenantId,
          programmeId,
          type: input.type,
          code: input.code,
          title: input.title,
          description: input.description,
          position: (last?.position ?? 0) + 1,
        },
      });
      await recordAuditEvent(tx, {
        tenantId,
        actorUserId: account.user.id,
        action: "obe.programme_outcome.created",
        resourceType: "programme_outcome",
        resourceId: created.id,
        after: { type: created.type, code: created.code, title: created.title },
        requestId: context.requestId,
      });
      return toProgrammeOutcome(created);
    });
  }, "That outcome code is already used on this programme.");
}

export async function updateProgrammeOutcome(
  account: AccountContext,
  outcomeId: string,
  raw: unknown,
  context: WriteContext = {},
): Promise<ProgrammeOutcomeView> {
  const tenantId = await requireInstitutionObe(account);
  const input = programmeOutcomeInputSchema.parse(raw);
  const db = getDb();

  return guardUnique(async () => {
    return db.$transaction(async (tx) => {
      const existing = await tx.programmeOutcome.findFirst({
        where: { id: outcomeId, tenantId },
      });
      if (!existing) throw new ResourceNotFoundError();
      const updated = await tx.programmeOutcome.update({
        where: { id: existing.id },
        data: {
          type: input.type,
          code: input.code,
          title: input.title,
          description: input.description ?? null,
        },
      });
      await recordAuditEvent(tx, {
        tenantId,
        actorUserId: account.user.id,
        action: "obe.programme_outcome.updated",
        resourceType: "programme_outcome",
        resourceId: updated.id,
        before: { type: existing.type, code: existing.code, title: existing.title },
        after: { type: updated.type, code: updated.code, title: updated.title },
        requestId: context.requestId,
      });
      return toProgrammeOutcome(updated);
    });
  }, "That outcome code is already used on this programme.");
}

export async function archiveProgrammeOutcome(
  account: AccountContext,
  outcomeId: string,
  context: WriteContext = {},
): Promise<ProgrammeOutcomeView> {
  const tenantId = await requireInstitutionObe(account);
  const db = getDb();
  return db.$transaction(async (tx) => {
    const existing = await tx.programmeOutcome.findFirst({ where: { id: outcomeId, tenantId } });
    if (!existing) throw new ResourceNotFoundError();
    const updated = await tx.programmeOutcome.update({
      where: { id: existing.id },
      data: { status: existing.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" },
    });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action:
        updated.status === "ARCHIVED"
          ? "obe.programme_outcome.archived"
          : "obe.programme_outcome.restored",
      resourceType: "programme_outcome",
      resourceId: updated.id,
      before: { status: existing.status },
      after: { status: updated.status },
      requestId: context.requestId,
    });
    return toProgrammeOutcome(updated);
  });
}

export async function getCourseObeWorkspace(account: AccountContext, offeringId: string) {
  const db = getDb();
  const access = await requireCourseObe(account, offeringId, db);
  const tenantId = access.tenantId;
  const programme = await offeringProgramme(tenantId, offeringId, db);
  const policyConfig = await loadActivePolicyConfig(tenantId, db);

  const [courseOutcomes, programmeOutcomes, mappings, assessmentMaps, assignments, questions] =
    await Promise.all([
      db.courseOutcome.findMany({
        where: { tenantId, offeringId },
        orderBy: [{ position: "asc" }, { code: "asc" }],
      }),
      programme
        ? db.programmeOutcome.findMany({
            where: { tenantId, programmeId: programme.programmeId, status: { not: "ARCHIVED" } },
            orderBy: [{ type: "asc" }, { position: "asc" }],
          })
        : Promise.resolve([]),
      db.outcomeMapping.findMany({
        where: { tenantId, courseOutcome: { offeringId } },
      }),
      db.assessmentOutcomeMapping.findMany({
        where: { tenantId, courseOutcome: { offeringId } },
      }),
      db.assignment.findMany({
        where: { tenantId, offeringId },
        select: { id: true, title: true, status: true },
        orderBy: { title: "asc" },
      }),
      db.question.findMany({
        where: { tenantId, bank: { offeringId }, status: "PUBLISHED" },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
      }),
    ]);

  const warnings = coverageWarnings({
    offeringId,
    programmeId: programme?.programmeId ?? null,
    formulaConfigured: formulaIsConfigured(policyConfig),
    courseOutcomes: courseOutcomes.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
    })),
    programmeOutcomes: programmeOutcomes.map((row) => ({
      id: row.id,
      code: row.code,
      type: row.type,
      status: row.status,
    })),
    coToPo: mappings.map((row) => ({
      courseOutcomeId: row.courseOutcomeId,
      programmeOutcomeId: row.programmeOutcomeId,
    })),
    coToAssessment: assessmentMaps.map((row) => ({
      courseOutcomeId: row.courseOutcomeId,
      kind: row.kind,
      refId: row.assignmentId ?? row.questionId ?? "",
    })),
    assignments,
    questions,
  });

  return {
    access,
    programme,
    policy: {
      ...policyConfig,
      formulaConfigured: formulaIsConfigured(policyConfig),
    },
    courseOutcomes: courseOutcomes.map((row) => ({
      id: row.id,
      offeringId: row.offeringId,
      code: row.code,
      title: row.title,
      description: row.description,
      position: row.position,
      status: row.status,
    })) satisfies CourseOutcomeView[],
    programmeOutcomes: programmeOutcomes
      .filter((row) => row.type === "PO" || row.type === "PSO")
      .map(toProgrammeOutcome),
    mappings: mappings.map((row) => ({
      id: row.id,
      courseOutcomeId: row.courseOutcomeId,
      programmeOutcomeId: row.programmeOutcomeId,
      correlationLevel: row.correlationLevel,
    })),
    assessmentMappings: assessmentMaps.map((row) => ({
      id: row.id,
      courseOutcomeId: row.courseOutcomeId,
      kind: row.kind,
      assignmentId: row.assignmentId,
      questionId: row.questionId,
      weight: Number(row.weight),
    })),
    assignments,
    questions,
    warnings,
  };
}

export async function createCourseOutcome(
  account: AccountContext,
  offeringId: string,
  raw: unknown,
  context: WriteContext = {},
): Promise<CourseOutcomeView> {
  const input = courseOutcomeInputSchema.parse(raw);
  const db = getDb();
  const access = await requireCourseObe(account, offeringId, db);

  return guardUnique(async () => {
    return db.$transaction(async (tx) => {
      const last = await tx.courseOutcome.findFirst({
        where: { tenantId: access.tenantId, offeringId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const created = await tx.courseOutcome.create({
        data: {
          tenantId: access.tenantId,
          offeringId,
          code: input.code,
          title: input.title,
          description: input.description,
          position: (last?.position ?? 0) + 1,
        },
      });
      await recordAuditEvent(tx, {
        tenantId: access.tenantId,
        actorUserId: account.user.id,
        action: "obe.course_outcome.created",
        resourceType: "course_outcome",
        resourceId: created.id,
        after: { code: created.code, title: created.title, offeringId },
        requestId: context.requestId,
      });
      return {
        id: created.id,
        offeringId: created.offeringId,
        code: created.code,
        title: created.title,
        description: created.description,
        position: created.position,
        status: created.status,
      };
    });
  }, "That course outcome code is already used on this offering.");
}

export async function updateCourseOutcome(
  account: AccountContext,
  outcomeId: string,
  raw: unknown,
  context: WriteContext = {},
): Promise<CourseOutcomeView> {
  const input = courseOutcomeInputSchema.parse(raw);
  const db = getDb();
  const existing = await db.courseOutcome.findFirst({
    where: { id: outcomeId, tenantId: tenantIdOf(account) },
  });
  if (!existing) throw new ResourceNotFoundError();
  await requireCourseObe(account, existing.offeringId, db);

  return guardUnique(async () => {
    return db.$transaction(async (tx) => {
      const updated = await tx.courseOutcome.update({
        where: { id: existing.id },
        data: {
          code: input.code,
          title: input.title,
          description: input.description ?? null,
        },
      });
      await recordAuditEvent(tx, {
        tenantId: existing.tenantId,
        actorUserId: account.user.id,
        action: "obe.course_outcome.updated",
        resourceType: "course_outcome",
        resourceId: updated.id,
        before: { code: existing.code, title: existing.title },
        after: { code: updated.code, title: updated.title },
        requestId: context.requestId,
      });
      return {
        id: updated.id,
        offeringId: updated.offeringId,
        code: updated.code,
        title: updated.title,
        description: updated.description,
        position: updated.position,
        status: updated.status,
      };
    });
  }, "That course outcome code is already used on this offering.");
}

export async function setCourseOutcomeStatus(
  account: AccountContext,
  outcomeId: string,
  context: WriteContext = {},
): Promise<CourseOutcomeView> {
  const db = getDb();
  const existing = await db.courseOutcome.findFirst({
    where: { id: outcomeId, tenantId: tenantIdOf(account) },
  });
  if (!existing) throw new ResourceNotFoundError();
  await requireCourseObe(account, existing.offeringId, db);

  return db.$transaction(async (tx) => {
    const updated = await tx.courseOutcome.update({
      where: { id: existing.id },
      data: { status: existing.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" },
    });
    await recordAuditEvent(tx, {
      tenantId: existing.tenantId,
      actorUserId: account.user.id,
      action: "obe.course_outcome.status",
      resourceType: "course_outcome",
      resourceId: updated.id,
      before: { status: existing.status },
      after: { status: updated.status },
      requestId: context.requestId,
    });
    return {
      id: updated.id,
      offeringId: updated.offeringId,
      code: updated.code,
      title: updated.title,
      description: updated.description,
      position: updated.position,
      status: updated.status,
    };
  });
}

export async function upsertOutcomeMapping(
  account: AccountContext,
  offeringId: string,
  raw: unknown,
  context: WriteContext = {},
) {
  const input = correlationInputSchema.parse(raw);
  const db = getDb();
  const access = await requireCourseObe(account, offeringId, db);
  const policy = await loadActivePolicyConfig(access.tenantId, db);
  if (!isAllowedCorrelation(policy, input.correlationLevel)) {
    throw new ConflictError("That correlation level is not on the active policy scale.");
  }

  const courseOutcome = await db.courseOutcome.findFirst({
    where: { id: input.courseOutcomeId, tenantId: access.tenantId, offeringId },
  });
  if (!courseOutcome) throw new ResourceNotFoundError();

  const programme = await offeringProgramme(access.tenantId, offeringId, db);
  if (!programme) {
    throw new ConflictError(
      "Attach this offering to a section before mapping course outcomes to programme outcomes.",
    );
  }

  const programmeOutcome = await db.programmeOutcome.findFirst({
    where: {
      id: input.programmeOutcomeId,
      tenantId: access.tenantId,
      programmeId: programme.programmeId,
      status: { not: "ARCHIVED" },
    },
  });
  if (!programmeOutcome) throw new ResourceNotFoundError();
  if (programmeOutcome.type === "PEO") {
    throw new ConflictError("Map course outcomes to POs or PSOs, not to PEOs.");
  }

  return db.$transaction(async (tx) => {
    const mapping = await tx.outcomeMapping.upsert({
      where: {
        courseOutcomeId_programmeOutcomeId: {
          courseOutcomeId: courseOutcome.id,
          programmeOutcomeId: programmeOutcome.id,
        },
      },
      update: { correlationLevel: input.correlationLevel },
      create: {
        tenantId: access.tenantId,
        courseOutcomeId: courseOutcome.id,
        programmeOutcomeId: programmeOutcome.id,
        correlationLevel: input.correlationLevel,
      },
    });
    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "obe.outcome_mapping.upserted",
      resourceType: "outcome_mapping",
      resourceId: mapping.id,
      after: {
        courseOutcomeId: mapping.courseOutcomeId,
        programmeOutcomeId: mapping.programmeOutcomeId,
        correlationLevel: mapping.correlationLevel,
      },
      requestId: context.requestId,
    });
    return mapping;
  });
}

export async function removeOutcomeMapping(
  account: AccountContext,
  offeringId: string,
  mappingId: string,
  context: WriteContext = {},
) {
  const db = getDb();
  const access = await requireCourseObe(account, offeringId, db);
  const mapping = await db.outcomeMapping.findFirst({
    where: { id: mappingId, tenantId: access.tenantId, courseOutcome: { offeringId } },
  });
  if (!mapping) throw new ResourceNotFoundError();

  await db.$transaction(async (tx) => {
    await tx.outcomeMapping.delete({ where: { id: mapping.id } });
    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "obe.outcome_mapping.removed",
      resourceType: "outcome_mapping",
      resourceId: mapping.id,
      before: {
        courseOutcomeId: mapping.courseOutcomeId,
        programmeOutcomeId: mapping.programmeOutcomeId,
      },
      requestId: context.requestId,
    });
  });
}

export async function createAssessmentMapping(
  account: AccountContext,
  offeringId: string,
  raw: unknown,
  context: WriteContext = {},
) {
  const input = assessmentMappingInputSchema.parse(raw);
  if (input.kind === "ASSIGNMENT" && !input.assignmentId) {
    throw new ConflictError("Choose an assignment.");
  }
  if (input.kind === "QUESTION" && !input.questionId) {
    throw new ConflictError("Choose a question.");
  }

  const db = getDb();
  const access = await requireCourseObe(account, offeringId, db);
  const courseOutcome = await db.courseOutcome.findFirst({
    where: { id: input.courseOutcomeId, tenantId: access.tenantId, offeringId },
  });
  if (!courseOutcome) throw new ResourceNotFoundError();

  if (input.kind === "ASSIGNMENT") {
    const assignment = await db.assignment.findFirst({
      where: { id: input.assignmentId, tenantId: access.tenantId, offeringId },
    });
    if (!assignment) throw new ResourceNotFoundError();
  } else {
    const question = await db.question.findFirst({
      where: { id: input.questionId, tenantId: access.tenantId, bank: { offeringId } },
    });
    if (!question) throw new ResourceNotFoundError();
  }

  return guardUnique(async () => {
    return db.$transaction(async (tx) => {
      const created = await tx.assessmentOutcomeMapping.create({
        data: {
          tenantId: access.tenantId,
          courseOutcomeId: courseOutcome.id,
          kind: input.kind,
          assignmentId: input.kind === "ASSIGNMENT" ? input.assignmentId : null,
          questionId: input.kind === "QUESTION" ? input.questionId : null,
          weight: input.weight,
        },
      });
      await recordAuditEvent(tx, {
        tenantId: access.tenantId,
        actorUserId: account.user.id,
        action: "obe.assessment_mapping.created",
        resourceType: "assessment_outcome_mapping",
        resourceId: created.id,
        after: {
          kind: created.kind,
          courseOutcomeId: created.courseOutcomeId,
          assignmentId: created.assignmentId,
          questionId: created.questionId,
          weight: Number(created.weight),
        },
        requestId: context.requestId,
      });
      return created;
    });
  }, "That assessment is already mapped to this course outcome.");
}

export async function removeAssessmentMapping(
  account: AccountContext,
  offeringId: string,
  mappingId: string,
  context: WriteContext = {},
) {
  const db = getDb();
  const access = await requireCourseObe(account, offeringId, db);
  const mapping = await db.assessmentOutcomeMapping.findFirst({
    where: { id: mappingId, tenantId: access.tenantId, courseOutcome: { offeringId } },
  });
  if (!mapping) throw new ResourceNotFoundError();

  await db.$transaction(async (tx) => {
    await tx.assessmentOutcomeMapping.delete({ where: { id: mapping.id } });
    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "obe.assessment_mapping.removed",
      resourceType: "assessment_outcome_mapping",
      resourceId: mapping.id,
      before: {
        kind: mapping.kind,
        courseOutcomeId: mapping.courseOutcomeId,
      },
      requestId: context.requestId,
    });
  });
}

export async function listAttainmentPolicies(
  account: AccountContext,
): Promise<AttainmentPolicyView[]> {
  const tenantId = await requireInstitutionObe(account);
  const rows = await getDb().attainmentPolicy.findMany({
    where: { tenantId },
    orderBy: [{ name: "asc" }, { version: "desc" }],
  });
  return rows.map((row) => {
    const configuration = parseAttainmentPolicyConfig(row.configuration);
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      status: row.status,
      configuration,
      notes: row.notes,
      formulaConfigured: formulaIsConfigured(configuration),
      activatedAt: row.activatedAt,
    };
  });
}

export async function getActiveAttainmentPolicy(
  account: AccountContext,
): Promise<AttainmentPolicyView | null> {
  requirePermission(account, "obe.manage");
  const tenantId = tenantIdOf(account);
  const row = await getDb().attainmentPolicy.findFirst({
    where: { tenantId, status: "ACTIVE" },
  });
  if (!row) return null;
  const configuration = parseAttainmentPolicyConfig(row.configuration);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    configuration,
    notes: row.notes,
    formulaConfigured: formulaIsConfigured(configuration),
    activatedAt: row.activatedAt,
  };
}

export async function createAttainmentPolicyDraft(
  account: AccountContext,
  raw: unknown,
  context: WriteContext = {},
): Promise<AttainmentPolicyView> {
  const tenantId = await requireInstitutionObe(account);
  const input = policyDraftInputSchema.parse(raw);
  const configuration = configFromDraftInput(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const last = await tx.attainmentPolicy.findFirst({
      where: { tenantId, name: input.name },
      orderBy: { version: "desc" },
      select: { version: true, status: true },
    });
    if (last?.status === "DRAFT") {
      throw new ConflictError("Finish or archive the existing draft of this policy first.");
    }
    const created = await tx.attainmentPolicy.create({
      data: {
        tenantId,
        name: input.name,
        version: (last?.version ?? 0) + 1,
        status: "DRAFT",
        configuration,
        notes: input.notes,
      },
    });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "obe.policy.drafted",
      resourceType: "attainment_policy",
      resourceId: created.id,
      after: { name: created.name, version: created.version },
      requestId: context.requestId,
    });
    return {
      id: created.id,
      name: created.name,
      version: created.version,
      status: created.status,
      configuration,
      notes: created.notes,
      formulaConfigured: false,
      activatedAt: null,
    };
  });
}

export async function updateAttainmentPolicyDraft(
  account: AccountContext,
  policyId: string,
  raw: unknown,
  context: WriteContext = {},
): Promise<AttainmentPolicyView> {
  const tenantId = await requireInstitutionObe(account);
  const input = policyDraftInputSchema.parse(raw);
  const configuration = configFromDraftInput(input);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const existing = await tx.attainmentPolicy.findFirst({ where: { id: policyId, tenantId } });
    if (!existing) throw new ResourceNotFoundError();
    if (existing.status !== "DRAFT") {
      throw new ConflictError(
        "Activated or archived policies cannot be edited. Create a new version.",
      );
    }
    const updated = await tx.attainmentPolicy.update({
      where: { id: existing.id },
      data: { name: input.name, configuration, notes: input.notes ?? null },
    });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "obe.policy.updated",
      resourceType: "attainment_policy",
      resourceId: updated.id,
      before: { name: existing.name, version: existing.version },
      after: { name: updated.name, version: updated.version },
      requestId: context.requestId,
    });
    return {
      id: updated.id,
      name: updated.name,
      version: updated.version,
      status: updated.status,
      configuration,
      notes: updated.notes,
      formulaConfigured: formulaIsConfigured(configuration),
      activatedAt: updated.activatedAt,
    };
  });
}

export async function activateAttainmentPolicy(
  account: AccountContext,
  policyId: string,
  context: WriteContext = {},
): Promise<AttainmentPolicyView> {
  const tenantId = await requireInstitutionObe(account);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const existing = await tx.attainmentPolicy.findFirst({ where: { id: policyId, tenantId } });
    if (!existing) throw new ResourceNotFoundError();
    if (existing.status === "ARCHIVED") {
      throw new ConflictError("Archived policies cannot be activated.");
    }
    const now = new Date();
    await tx.attainmentPolicy.updateMany({
      where: { tenantId, status: "ACTIVE", id: { not: existing.id } },
      data: { status: "ARCHIVED", archivedAt: now },
    });
    const updated = await tx.attainmentPolicy.update({
      where: { id: existing.id },
      data: { status: "ACTIVE", activatedAt: existing.activatedAt ?? now },
    });
    const configuration = parseAttainmentPolicyConfig(updated.configuration);
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "obe.policy.activated",
      resourceType: "attainment_policy",
      resourceId: updated.id,
      after: {
        name: updated.name,
        version: updated.version,
        formulaConfigured: formulaIsConfigured(configuration),
      },
      requestId: context.requestId,
    });
    return {
      id: updated.id,
      name: updated.name,
      version: updated.version,
      status: updated.status,
      configuration,
      notes: updated.notes,
      formulaConfigured: formulaIsConfigured(configuration),
      activatedAt: updated.activatedAt,
    };
  });
}

export function offeringCoverageWarnings(workspace: {
  warnings: CoverageWarning[];
}): CoverageWarning[] {
  return workspace.warnings;
}

/**
 * Everything an accreditation reviewer needs to reproduce a mapping report:
 * the offering, the policy version in force, every correlation, every piece of
 * mapped evidence, and the open warnings. No attainment value is computed.
 */
export async function getCourseObeEvidence(
  account: AccountContext,
  offeringId: string,
): Promise<ObeEvidenceDoc> {
  const workspace = await getCourseObeWorkspace(account, offeringId);
  const db = getDb();
  const active = await db.attainmentPolicy.findFirst({
    where: { tenantId: workspace.access.tenantId, status: "ACTIVE" },
    select: { name: true, version: true, status: true },
  });

  const courseOutcomeCode = new Map(
    workspace.courseOutcomes.map((outcome) => [outcome.id, outcome.code]),
  );
  const programmeOutcomeCode = new Map(
    workspace.programmeOutcomes.map((outcome) => [outcome.id, outcome.code]),
  );
  const scale = new Map(
    workspace.policy.correlationScale.map((entry) => [entry.level, entry.label]),
  );
  const assignmentTitle = new Map(
    workspace.assignments.map((assignment) => [assignment.id, assignment.title]),
  );
  const questionTitle = new Map(
    workspace.questions.map((question) => [question.id, question.title]),
  );

  return {
    generatedAt: new Date().toISOString(),
    offering: {
      offeringId: workspace.access.offeringId,
      courseCode: workspace.access.courseCode,
      courseTitle: workspace.access.courseTitle,
      termName: workspace.access.termName,
      academicYearName: workspace.access.academicYearName,
      programmeCode: workspace.programme?.programmeCode ?? null,
      programmeName: workspace.programme?.programmeName ?? null,
    },
    policy: {
      name: active?.name ?? null,
      version: active?.version ?? null,
      status: active?.status ?? null,
      correlationScale: workspace.policy.correlationScale,
      rounding: workspace.policy.rounding.decimalPlaces,
      thresholds: workspace.policy.thresholds,
      directMethod: workspace.policy.directMethod,
      indirectMethod: workspace.policy.indirectMethod,
      formulaConfigured: workspace.policy.formulaConfigured,
    },
    courseOutcomes: workspace.courseOutcomes.map((outcome) => ({
      code: outcome.code,
      title: outcome.title,
      status: outcome.status,
    })),
    programmeOutcomes: workspace.programmeOutcomes.map((outcome) => ({
      code: outcome.code,
      type: outcome.type,
      title: outcome.title,
      status: outcome.status,
    })),
    correlations: workspace.mappings.map((mapping) => ({
      courseOutcomeCode: courseOutcomeCode.get(mapping.courseOutcomeId) ?? "unknown",
      programmeOutcomeCode: programmeOutcomeCode.get(mapping.programmeOutcomeId) ?? "unknown",
      level: mapping.correlationLevel,
      label: scale.get(mapping.correlationLevel) ?? String(mapping.correlationLevel),
    })),
    evidence: workspace.assessmentMappings.map((mapping) => ({
      courseOutcomeCode: courseOutcomeCode.get(mapping.courseOutcomeId) ?? "unknown",
      kind: mapping.kind,
      target:
        mapping.kind === "ASSIGNMENT"
          ? (assignmentTitle.get(mapping.assignmentId ?? "") ?? "unknown assignment")
          : (questionTitle.get(mapping.questionId ?? "") ?? "unknown question"),
      weight: mapping.weight,
    })),
    warnings: workspace.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
    })),
  };
}
