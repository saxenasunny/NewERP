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
import { getOfferingAccess, type OfferingAccess } from "@/modules/content/content-service";

import { parseAssignmentSettings, type AssignmentSettings } from "./rules";

/**
 * Assignment authoring for one course offering.
 *
 * The actor needs `assessments.manage` **and** must manage the offering
 * (assigned instructor, or an institution administrator). The permission alone
 * never grants access to a colleague's course, matching the content module.
 *
 * Assignments are drafts until published; archived assignments stay readable
 * for their existing submissions but cannot be edited.
 */

export type SubmissionType = "TEXT" | "FILE" | "LINK" | "TEXT_AND_FILE";
export type AssignmentStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

async function requireOfferingManagement(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient,
): Promise<OfferingAccess> {
  const access = await getOfferingAccess(account, offeringId, db);
  if (!access.canManage) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }
  return access;
}

async function requireAssignmentManagement(
  account: AccountContext,
  assignmentId: string,
  db: DatabaseClient,
) {
  const tenantId = tenantIdOf(account);
  const assignment = await db.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    select: {
      id: true,
      title: true,
      status: true,
      offeringId: true,
      pointsPossible: true,
      dueAt: true,
      submissionTypes: true,
    },
  });
  if (!assignment) throw new ResourceNotFoundError();
  const access = await requireOfferingManagement(account, assignment.offeringId, db);
  return { assignment, access };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const optionalDateTime = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Use a valid date and time.")
    .transform((value) => new Date(value))
    .optional(),
);

const optionalText = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().trim().max(20000, "Keep the instructions under 20,000 characters.").optional(),
);

const optionalCheckbox = z.preprocess(
  (value) => value === true || value === "true" || value === "on" || value === "1",
  z.boolean(),
);

const pointsSchema = z.preprocess(
  (value) => (typeof value === "string" ? Number(value.trim()) : value),
  z
    .number()
    .min(0.5, "Points must be at least 0.5.")
    .max(1000, "Points must be at most 1000.")
    .refine((value) => Math.round(value * 100) === value * 100, "Use at most two decimals."),
);

export const assignmentInputSchema = z
  .object({
    offeringId: z.string().min(1),
    assignmentId: z.string().min(1).optional(),
    title: z
      .string()
      .trim()
      .min(2, "Use at least 2 characters.")
      .max(200, "Use at most 200 characters."),
    instructions: optionalText,
    dueAt: optionalDateTime,
    availableFrom: optionalDateTime,
    availableUntil: optionalDateTime,
    pointsPossible: pointsSchema,
    submissionType: z.enum(["TEXT", "FILE", "LINK", "TEXT_AND_FILE"]).default("TEXT"),
    allowLateSubmission: optionalCheckbox.default(true),
    allowResubmission: optionalCheckbox.default(false),
    maxAttempts: z.preprocess(
      (value) => (value === "" || value === null || value === undefined ? 1 : Number(value)),
      z.number().int().min(1).max(10),
    ),
  })
  .superRefine((value, context) => {
    if (value.availableFrom && value.availableUntil && value.availableFrom > value.availableUntil) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["availableUntil"],
        message: "The close time must be after the open time.",
      });
    }
    if (value.dueAt && value.availableUntil && value.dueAt > value.availableUntil) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueAt"],
        message: "The due date must be on or before the close time.",
      });
    }
    if (value.availableFrom && value.dueAt && value.dueAt < value.availableFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueAt"],
        message: "The due date must be after the assignment opens.",
      });
    }
  });

export type AssignmentInput = z.input<typeof assignmentInputSchema>;

function settingsFrom(parsed: z.output<typeof assignmentInputSchema>): AssignmentSettings {
  return {
    allowLateSubmission: parsed.allowLateSubmission,
    allowResubmission: parsed.allowResubmission,
    maxAttempts: parsed.allowResubmission ? Math.max(2, parsed.maxAttempts) : 1,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type RubricCriterionView = {
  id: string;
  title: string;
  description: string | null;
  pointsPossible: number;
  position: number;
};

export type AssignmentSummary = {
  id: string;
  title: string;
  status: AssignmentStatus;
  submissionType: SubmissionType;
  dueAt: Date | null;
  availableFrom: Date | null;
  availableUntil: Date | null;
  pointsPossible: number;
  settings: AssignmentSettings;
  submissionCount: number;
  gradedCount: number;
  releasedCount: number;
  rubricCount: number;
};

export type AssignmentDetail = AssignmentSummary & {
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  termName: string;
  academicYearName: string;
  sectionName: string | null;
  instructions: string | null;
  learnerCount: number;
  rubric: RubricCriterionView[];
};

function summarize(
  assignment: {
    id: string;
    title: string;
    status: AssignmentStatus;
    submissionTypes: SubmissionType;
    dueAt: Date | null;
    availableFrom: Date | null;
    availableUntil: Date | null;
    pointsPossible: unknown;
    settings: unknown;
  },
  counts: { submissions: number; graded: number; released: number; rubric: number },
): AssignmentSummary {
  return {
    id: assignment.id,
    title: assignment.title,
    status: assignment.status,
    submissionType: assignment.submissionTypes,
    dueAt: assignment.dueAt,
    availableFrom: assignment.availableFrom,
    availableUntil: assignment.availableUntil,
    pointsPossible: Number(assignment.pointsPossible),
    settings: parseAssignmentSettings(assignment.settings),
    submissionCount: counts.submissions,
    gradedCount: counts.graded,
    releasedCount: counts.released,
    rubricCount: counts.rubric,
  };
}

/** Every assignment of one offering, for the teacher's authoring screen. */
export async function listAssignments(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<{ access: OfferingAccess; assignments: AssignmentSummary[] }> {
  requirePermission(account, "courses.read");
  const access = await requireOfferingManagement(account, offeringId, db);

  const rows = await db.assignment.findMany({
    where: { tenantId: access.tenantId, offeringId: access.offeringId },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      status: true,
      submissionTypes: true,
      dueAt: true,
      availableFrom: true,
      availableUntil: true,
      pointsPossible: true,
      settings: true,
      submissions: { select: { status: true, grades: { select: { gradeStatus: true } } } },
      _count: { select: { rubric: true } },
    },
  });

  return {
    access,
    assignments: rows.map((row) =>
      summarize(row, {
        submissions: row.submissions.length,
        graded: row.submissions.filter((submission) => submission.status === "GRADED").length,
        released: row.submissions.filter((submission) =>
          submission.grades.some((grade) => grade.gradeStatus === "RELEASED"),
        ).length,
        rubric: row._count.rubric,
      }),
    ),
  };
}

export async function getAssignmentDetail(
  account: AccountContext,
  assignmentId: string,
  db: DatabaseClient = getDb(),
): Promise<AssignmentDetail> {
  requirePermission(account, "courses.read");
  const { assignment, access } = await requireAssignmentManagement(account, assignmentId, db);

  const row = await db.assignment.findFirstOrThrow({
    where: { id: assignment.id, tenantId: access.tenantId },
    select: {
      id: true,
      title: true,
      status: true,
      submissionTypes: true,
      dueAt: true,
      availableFrom: true,
      availableUntil: true,
      pointsPossible: true,
      settings: true,
      instructions: true,
      submissions: { select: { status: true, grades: { select: { gradeStatus: true } } } },
      rubric: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          description: true,
          pointsPossible: true,
          position: true,
        },
      },
      offering: {
        select: {
          course: { select: { code: true, title: true } },
          term: { select: { name: true, academicYear: { select: { name: true } } } },
          section: { select: { name: true } },
          _count: { select: { enrolments: { where: { status: "ACTIVE" } } } },
        },
      },
    },
  });

  return {
    ...summarize(row, {
      submissions: row.submissions.length,
      graded: row.submissions.filter((submission) => submission.status === "GRADED").length,
      released: row.submissions.filter((submission) =>
        submission.grades.some((grade) => grade.gradeStatus === "RELEASED"),
      ).length,
      rubric: row.rubric.length,
    }),
    offeringId: access.offeringId,
    courseCode: row.offering.course.code,
    courseTitle: row.offering.course.title,
    termName: row.offering.term.name,
    academicYearName: row.offering.term.academicYear.name,
    sectionName: row.offering.section?.name ?? null,
    instructions: row.instructions,
    learnerCount: row.offering._count.enrolments,
    rubric: row.rubric.map((criterion) => ({
      id: criterion.id,
      title: criterion.title,
      description: criterion.description,
      pointsPossible: Number(criterion.pointsPossible),
      position: criterion.position,
    })),
  };
}

/** Assignments for every course the actor manages, for the faculty index. */
export async function listManagedAssignments(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<
  Array<
    AssignmentSummary & {
      offeringId: string;
      courseCode: string;
      courseTitle: string;
      termName: string;
      academicYearName: string;
    }
  >
> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);
  const isAdministrator =
    account.permissions.has("enrolments.manage") || account.permissions.has("courses.update");

  const rows = await db.assignment.findMany({
    where: {
      tenantId,
      offering: isAdministrator
        ? { tenantId }
        : { tenantId, instructors: { some: { userId: account.user.id } } },
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      status: true,
      submissionTypes: true,
      dueAt: true,
      availableFrom: true,
      availableUntil: true,
      pointsPossible: true,
      settings: true,
      offering: {
        select: {
          id: true,
          course: { select: { code: true, title: true } },
          term: { select: { name: true, academicYear: { select: { name: true } } } },
        },
      },
      submissions: { select: { status: true, grades: { select: { gradeStatus: true } } } },
      _count: { select: { rubric: true } },
    },
  });

  return rows.map((row) => ({
    ...summarize(row, {
      submissions: row.submissions.length,
      graded: row.submissions.filter((submission) => submission.status === "GRADED").length,
      released: row.submissions.filter((submission) =>
        submission.grades.some((grade) => grade.gradeStatus === "RELEASED"),
      ).length,
      rubric: row._count.rubric,
    }),
    offeringId: row.offering.id,
    courseCode: row.offering.course.code,
    courseTitle: row.offering.course.title,
    termName: row.offering.term.name,
    academicYearName: row.offering.term.academicYear.name,
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createAssignment(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "assessments.manage");
  const parsed = assignmentInputSchema.parse(input);
  const access = await requireOfferingManagement(account, parsed.offeringId, db);
  const settings = settingsFrom(parsed);

  return db.$transaction(async (tx) => {
    const created = await tx.assignment.create({
      data: {
        tenantId: access.tenantId,
        offeringId: access.offeringId,
        title: parsed.title,
        instructions: parsed.instructions ?? null,
        dueAt: parsed.dueAt ?? null,
        availableFrom: parsed.availableFrom ?? null,
        availableUntil: parsed.availableUntil ?? null,
        pointsPossible: parsed.pointsPossible,
        submissionTypes: parsed.submissionType,
        settings,
        status: "DRAFT",
      },
      select: { id: true },
    });

    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "assignment.created",
      resourceType: "assignment",
      resourceId: created.id,
      after: {
        offeringId: access.offeringId,
        title: parsed.title,
        submissionType: parsed.submissionType,
        pointsPossible: parsed.pointsPossible,
      },
      requestId: context.requestId,
    });

    return created;
  });
}

export async function updateAssignment(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "assessments.manage");
  const parsed = assignmentInputSchema.parse(input);
  if (!parsed.assignmentId) throw new ResourceNotFoundError();
  const { assignment, access } = await requireAssignmentManagement(
    account,
    parsed.assignmentId,
    db,
  );
  if (assignment.status === "ARCHIVED") {
    throw new ConflictError("Archived assignments cannot be edited. Restore it to draft first.");
  }

  const settings = settingsFrom(parsed);

  await db.$transaction(async (tx) => {
    await tx.assignment.update({
      where: { id: assignment.id },
      data: {
        title: parsed.title,
        instructions: parsed.instructions ?? null,
        dueAt: parsed.dueAt ?? null,
        availableFrom: parsed.availableFrom ?? null,
        availableUntil: parsed.availableUntil ?? null,
        pointsPossible: parsed.pointsPossible,
        submissionTypes: parsed.submissionType,
        settings,
      },
    });

    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "assignment.updated",
      resourceType: "assignment",
      resourceId: assignment.id,
      before: {
        title: assignment.title,
        status: assignment.status,
        pointsPossible: Number(assignment.pointsPossible),
        submissionType: assignment.submissionTypes,
      },
      after: {
        title: parsed.title,
        pointsPossible: parsed.pointsPossible,
        submissionType: parsed.submissionType,
        settings,
      },
      requestId: context.requestId,
    });
  });
}

export async function setAssignmentStatus(
  account: AccountContext,
  input: { assignmentId: string; status: AssignmentStatus },
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "assessments.manage");
  const { assignment, access } = await requireAssignmentManagement(account, input.assignmentId, db);

  await db.$transaction(async (tx) => {
    await tx.assignment.update({
      where: { id: assignment.id },
      data: { status: input.status },
    });
    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "assignment.status_changed",
      resourceType: "assignment",
      resourceId: assignment.id,
      before: { status: assignment.status },
      after: { status: input.status },
      requestId: context.requestId,
    });
  });
}

export async function deleteAssignment(
  account: AccountContext,
  assignmentId: string,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "assessments.manage");
  const { assignment, access } = await requireAssignmentManagement(account, assignmentId, db);
  if (assignment.status !== "DRAFT") {
    throw new ConflictError("Archive a published assignment instead of deleting it.");
  }
  const submissions = await db.assignmentSubmission.count({
    where: { assignmentId: assignment.id, tenantId: access.tenantId },
  });
  if (submissions > 0) {
    throw new ConflictError("This assignment already has submissions, so it cannot be deleted.");
  }

  await db.$transaction(async (tx) => {
    await tx.assignment.delete({ where: { id: assignment.id } });
    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "assignment.deleted",
      resourceType: "assignment",
      resourceId: assignment.id,
      before: { title: assignment.title },
      requestId: context.requestId,
    });
  });
}

const rubricSchema = z.object({
  assignmentId: z.string().min(1),
  criteria: z
    .array(
      z.object({
        title: z.string().trim().min(2, "Name the criterion.").max(160),
        description: z
          .string()
          .trim()
          .max(2000)
          .optional()
          .transform((value) => (value === "" ? undefined : value)),
        pointsPossible: z.preprocess(
          (value) => (typeof value === "string" ? Number(value.trim()) : value),
          z.number().min(0.5).max(1000),
        ),
      }),
    )
    .max(20, "Use at most 20 criteria."),
});

/**
 * Replaces the rubric. Refused once any grade exists, because deleting a
 * criterion would silently discard its scores.
 */
export async function saveRubric(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "assessments.manage");
  const parsed = rubricSchema.parse(input);
  const { assignment, access } = await requireAssignmentManagement(
    account,
    parsed.assignmentId,
    db,
  );

  const graded = await db.grade.count({
    where: {
      tenantId: access.tenantId,
      assignmentId: assignment.id,
      gradeStatus: { in: ["DRAFT", "RELEASED"] },
    },
  });
  if (graded > 0) {
    throw new ConflictError(
      "Grades already use this rubric. Clear the grades before changing the criteria.",
    );
  }

  await db.$transaction(async (tx) => {
    await tx.rubricCriterion.deleteMany({
      where: { tenantId: access.tenantId, assignmentId: assignment.id },
    });
    if (parsed.criteria.length > 0) {
      await tx.rubricCriterion.createMany({
        data: parsed.criteria.map((criterion, index) => ({
          tenantId: access.tenantId,
          courseOfferingId: access.offeringId,
          assignmentId: assignment.id,
          title: criterion.title,
          description: criterion.description ?? null,
          pointsPossible: criterion.pointsPossible,
          position: index + 1,
        })),
      });
    }

    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "assignment.rubric_saved",
      resourceType: "assignment",
      resourceId: assignment.id,
      after: {
        criteria: parsed.criteria.map((criterion) => ({
          title: criterion.title,
          pointsPossible: criterion.pointsPossible,
        })),
      },
      requestId: context.requestId,
    });
  });
}
