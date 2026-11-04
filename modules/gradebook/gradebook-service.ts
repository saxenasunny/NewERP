/**
 * Gradebook service — Phase 8.
 *
 * Builds one course gradebook from records that already exist: published
 * assignments with their grades, and published quizzes with their attempts.
 * Totals are computed on every read, so a gradebook always reconciles with the
 * underlying rows and never goes stale when a scheme changes.
 *
 * Configuration lives in `grading_schemes` (mode, pass mark, rounding, letter
 * scale, missing-work policy), `assessment_weights` (weighted mode) and
 * `assessment_excusals` (per learner, per assessment). All three are optional:
 * an offering without a scheme uses points mode with no pass mark.
 *
 * Cell states:
 *   - excused (explicit excusal row) → leaves both sides of the total;
 *   - assignment: released `Grade` → scored; draft grade or an ungraded
 *     submission → ungraded; nothing submitted → missing;
 *   - quiz: highest finished attempt with a score → scored; an attempt without
 *     a score or still in progress → ungraded; no attempt → missing.
 *
 * Permissions:
 *   - faculty and administrators: `grades.read` plus access to the offering to
 *     read; `grades.update` plus access to change the scheme or excuse work.
 *   - learners: `courses.read` plus an active enrolment, released columns only.
 */

import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { sendMail } from "@/lib/mail/send";
import { log } from "@/lib/observability/logger";
import {
  PermissionDeniedError,
  ResourceNotFoundError,
  TenantSelectionRequiredError,
} from "@/lib/errors";
import { getOfferingAccess } from "@/modules/content/content-service";
import {
  AssessmentKind,
  GradeStatus,
  GradingMode,
  QuizAttemptStatus,
  type AssignmentStatus,
  type Prisma,
} from "../../generated/prisma/client";
import {
  calculateLearnerResult,
  DEFAULT_SCALE,
  type GradebookCell,
  type GradebookColumn,
  type GradebookScheme,
  type GradeScaleBand,
  type LearnerResult,
} from "./calculation";

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

/** Used when an offering has no stored scheme. */
export const DEFAULT_GRADEBOOK_SCHEME: GradebookScheme = {
  mode: "points",
  passMark: null,
  rounding: 2,
};

export type GradebookLearner = {
  userId: string;
  name: string;
  email: string;
  cells: Record<string, GradebookCell>;
  result: LearnerResult;
};

export type Gradebook = {
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  termName: string;
  academicYearName: string;
  columns: GradebookColumn[];
  learners: GradebookLearner[];
  scheme: GradebookScheme;
  /** Learners with at least one ungraded assessment. */
  incompleteCount: number;
  /** Current excusals, for the faculty controls. */
  excusals: { id: string; userId: string; columnId: string; reason: string | null }[];
  schemeId: string | null;
  schemeVersion: number;
  /** Present on faculty reads: the slice of learners being shown. */
  paging: { page: number; pageSize: number; total: number; totalPages: number };
  /** Every learner matching the current filter, for pickers while the table is paged. */
  learnerOptions: { userId: string; name: string }[];
};

function numberFromDecimal(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const candidate = value as { toNumber?: () => number };
  return typeof candidate.toNumber === "function" ? candidate.toNumber() : Number(value);
}

function parseScale(value: unknown): GradeScaleBand[] {
  if (!Array.isArray(value)) return DEFAULT_SCALE;
  const bands = value
    .map((entry) => {
      const band = entry as { minPercent?: unknown; letter?: unknown };
      if (typeof band.minPercent !== "number" || typeof band.letter !== "string") return null;
      return { minPercent: band.minPercent, letter: band.letter };
    })
    .filter((band): band is GradeScaleBand => band !== null)
    .sort((a, b) => b.minPercent - a.minPercent);
  return bands.length > 0 ? bands : DEFAULT_SCALE;
}

type OfferingHeader = {
  courseCode: string;
  courseTitle: string;
  termName: string;
  academicYearName: string;
};

function kindKey(kind: AssessmentKind): "assignment" | "quiz" {
  return kind === AssessmentKind.ASSIGNMENT ? "assignment" : "quiz";
}

async function offeringHeader(
  db: DatabaseClient,
  tenantId: string,
  offeringId: string,
): Promise<OfferingHeader> {
  const offering = await db.courseOffering.findFirst({
    where: { id: offeringId, tenantId },
    select: {
      course: { select: { code: true, title: true } },
      term: { select: { name: true, academicYear: { select: { name: true } } } },
    },
  });
  if (!offering) throw new ResourceNotFoundError("Course not found.");
  return {
    courseCode: offering.course.code,
    courseTitle: offering.course.title,
    termName: offering.term.name,
    academicYearName: offering.term.academicYear.name,
  };
}

/** Stored scheme, weights, and excusals for one offering. */
async function loadConfiguration(
  db: DatabaseClient,
  tenantId: string,
  offeringId: string,
  options: { userId?: string } = {},
) {
  const [stored, excusals] = await Promise.all([
    db.gradingScheme.findFirst({
      where: { tenantId, offeringId },
      include: { weights: true },
    }),
    db.assessmentExcusal.findMany({
      where: { tenantId, offeringId, ...(options.userId ? { userId: options.userId } : {}) },
      select: { id: true, userId: true, kind: true, refId: true, reason: true },
    }),
  ]);

  const scheme: GradebookScheme = stored
    ? {
        mode: stored.mode === GradingMode.WEIGHTED ? "weighted" : "points",
        passMark: numberFromDecimal(stored.passMark),
        rounding: stored.rounding,
        scale: parseScale(stored.scale),
        treatMissingAsZero: stored.treatMissingAsZero,
      }
    : { ...DEFAULT_GRADEBOOK_SCHEME };

  const weights = new Map<string, number>();
  for (const weight of stored?.weights ?? []) {
    weights.set(`${kindKey(weight.kind)}:${weight.refId}`, numberFromDecimal(weight.weight) ?? 1);
  }

  return {
    scheme,
    schemeId: stored?.id ?? null,
    schemeVersion: stored?.version ?? 0,
    weights,
    excusals,
  };
}

/** One shared assembly; callers decide access and which columns are visible. */
async function assembleGradebook(input: {
  db: DatabaseClient;
  tenantId: string;
  offeringId: string;
  header: OfferingHeader;
  /** Limit the result to one learner (their own view). */
  userId?: string;
  /** Server-side slice of enrolled learners for faculty reports. */
  paging?: { page: number; pageSize: number };
  /** Case-insensitive name or email filter. */
  search?: string;
}): Promise<Gradebook> {
  const { db, tenantId, offeringId, header, userId, paging, search } = input;
  const configuration = await loadConfiguration(db, tenantId, offeringId, { userId });

  const learnerWhere = {
    tenantId,
    courseOfferingId: offeringId,
    status: "ACTIVE" as const,
    ...(userId ? { userId } : {}),
    ...(search
      ? {
          user: {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };

  // Learners come first: a paged read uses their ids to scope the per-learner rows.
  const [enrolments, learnerTotal] = await Promise.all([
    db.enrolment.findMany({
      where: learnerWhere,
      orderBy: { user: { name: "asc" } },
      ...(paging ? { skip: (paging.page - 1) * paging.pageSize, take: paging.pageSize } : {}),
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
    db.enrolment.count({ where: learnerWhere }),
  ]);

  const learnerIds = enrolments.map((enrolment) => enrolment.userId);

  // The table may be paged, but pickers still need every learner in scope.
  const learnerOptions = paging
    ? await db.enrolment.findMany({
        where: learnerWhere,
        orderBy: { user: { name: "asc" } },
        select: { userId: true, user: { select: { name: true } } },
      })
    : enrolments.map((enrolment) => ({ userId: enrolment.userId, user: enrolment.user }));
  // Undefined means "every learner", which keeps unpaged exports on one query per table.
  const gradeScope = userId
    ? { learnerUserId: userId }
    : paging
      ? { learnerUserId: { in: learnerIds } }
      : undefined;
  const learnerScope = userId ? { userId } : paging ? { userId: { in: learnerIds } } : undefined;

  const [assignments, quizzes, releasedAssignments] = await Promise.all([
    db.assignment.findMany({
      where: { tenantId, offeringId, status: { not: "DRAFT" as AssignmentStatus } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        pointsPossible: true,
        grades: {
          where: gradeScope,
          select: { learnerUserId: true, rawScore: true, gradeStatus: true },
        },
        submissions: {
          where: learnerScope,
          select: { userId: true, status: true },
        },
      },
    }),
    db.quiz.findMany({
      where: { tenantId, offeringId, status: "PUBLISHED" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        releasedAt: true,
        questions: { select: { pointsOverride: true, question: { select: { points: true } } } },
        attempts: {
          where: learnerScope,
          select: { userId: true, status: true, score: true, attemptNumber: true },
        },
      },
    }),
    // A paged read only sees its own learners' marks, so the release flag comes from
    // a cohort-wide lookup instead of the sliced rows.
    paging
      ? db.grade.findMany({
          where: {
            tenantId,
            assignment: { offeringId },
            gradeStatus: GradeStatus.RELEASED,
          },
          select: { assignmentId: true },
          distinct: ["assignmentId"],
        })
      : Promise.resolve(null),
  ]);

  const releasedAssignmentIds = releasedAssignments
    ? new Set(releasedAssignments.map((row) => row.assignmentId))
    : null;

  const columns: GradebookColumn[] = [
    ...assignments.map((assignment) => ({
      id: `assignment:${assignment.id}`,
      title: assignment.title,
      kind: "assignment" as const,
      pointsPossible: numberFromDecimal(assignment.pointsPossible) ?? 0,
      weight: configuration.weights.get(`assignment:${assignment.id}`),
      // Marks count as released when at least one row has been released.
      released: releasedAssignmentIds
        ? releasedAssignmentIds.has(assignment.id)
        : assignment.grades.some((grade) => grade.gradeStatus === GradeStatus.RELEASED),
    })),
    ...quizzes.map((quiz) => ({
      id: `quiz:${quiz.id}`,
      title: quiz.title,
      kind: "quiz" as const,
      pointsPossible: quiz.questions.reduce((total, ref) => {
        const points =
          numberFromDecimal(ref.pointsOverride) ?? numberFromDecimal(ref.question.points) ?? 1;
        return total + points;
      }, 0),
      weight: configuration.weights.get(`quiz:${quiz.id}`),
      released: quiz.releasedAt !== null,
    })),
  ];

  const excusedKeys = new Set(
    configuration.excusals.map((row) => `${row.userId}|${kindKey(row.kind)}:${row.refId}`),
  );

  const learners: GradebookLearner[] = enrolments.map((enrolment) => {
    const cells: Record<string, GradebookCell> = {};
    const isExcused = (columnId: string) => excusedKeys.has(`${enrolment.userId}|${columnId}`);

    for (const assignment of assignments) {
      const columnId = `assignment:${assignment.id}`;
      if (isExcused(columnId)) {
        cells[columnId] = { state: "excused" };
        continue;
      }

      const grade = assignment.grades.find((row) => row.learnerUserId === enrolment.userId);
      if (grade) {
        cells[columnId] =
          grade.gradeStatus === GradeStatus.RELEASED
            ? { state: "scored", score: numberFromDecimal(grade.rawScore) }
            : { state: "ungraded" };
        continue;
      }

      const submitted = assignment.submissions.some(
        (row) => row.userId === enrolment.userId && row.status !== "DRAFT",
      );
      cells[columnId] = submitted ? { state: "ungraded" } : { state: "missing" };
    }

    for (const quiz of quizzes) {
      const columnId = `quiz:${quiz.id}`;
      if (isExcused(columnId)) {
        cells[columnId] = { state: "excused" };
        continue;
      }

      const attempts = quiz.attempts.filter((attempt) => attempt.userId === enrolment.userId);
      // Highest finished score wins; an in-progress attempt cannot count.
      const best = attempts
        .filter(
          (attempt) => attempt.status !== QuizAttemptStatus.IN_PROGRESS && attempt.score !== null,
        )
        .sort((a, b) => (numberFromDecimal(b.score) ?? 0) - (numberFromDecimal(a.score) ?? 0))[0];

      cells[columnId] = best
        ? { state: "scored", score: numberFromDecimal(best.score) }
        : attempts.length > 0
          ? { state: "ungraded" }
          : { state: "missing" };
    }

    return {
      userId: enrolment.userId,
      name: enrolment.user.name,
      email: enrolment.user.email,
      cells,
      result: calculateLearnerResult({ columns, cells, scheme: configuration.scheme }),
    };
  });

  return {
    offeringId,
    ...header,
    columns,
    learners,
    scheme: configuration.scheme,
    incompleteCount: learners.filter((learner) => !learner.result.complete).length,
    excusals: configuration.excusals.map((row) => ({
      id: row.id,
      userId: row.userId,
      columnId: `${kindKey(row.kind)}:${row.refId}`,
      reason: row.reason,
    })),
    schemeId: configuration.schemeId,
    schemeVersion: configuration.schemeVersion,
    learnerOptions: learnerOptions.map((row) => ({ userId: row.userId, name: row.user.name })),
    paging: {
      page: paging?.page ?? 1,
      pageSize: paging?.pageSize ?? learnerTotal,
      total: learnerTotal,
      totalPages: paging ? Math.max(1, Math.ceil(learnerTotal / paging.pageSize)) : 1,
    },
  };
}

/** Page size used by the faculty gradebook; the CSV export ignores paging. */
export const GRADEBOOK_PAGE_SIZE = 25;

export type GradebookQuery = {
  page?: number;
  pageSize?: number;
  /** Case-insensitive learner name or email filter. */
  search?: string;
  /** When false the whole cohort is returned (used by exports). */
  paginate?: boolean;
};

/** The faculty gradebook for one offering. */
export async function getCourseGradebook(
  account: AccountContext,
  offeringId: string,
  query: GradebookQuery = {},
  db: DatabaseClient = getDb(),
): Promise<Gradebook> {
  requirePermission(account, "grades.read");
  const access = await getOfferingAccess(account, offeringId, db);
  if (!access.canManage) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }

  const tenantId = tenantIdOf(account);
  const header = await offeringHeader(db, tenantId, offeringId);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? GRADEBOOK_PAGE_SIZE));
  const page = Math.max(1, Math.trunc(query.page ?? 1));

  return assembleGradebook({
    db,
    tenantId,
    offeringId,
    header,
    ...(query.paginate === false ? {} : { paging: { page, pageSize } }),
    ...(query.search?.trim() ? { search: query.search.trim() } : {}),
  });
}

/** One learner's own released results for an offering they are enrolled in. */
export async function getLearnerGradebook(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<{ gradebook: Gradebook; own: GradebookLearner }> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);

  const enrolment = await db.enrolment.findFirst({
    where: {
      tenantId,
      courseOfferingId: offeringId,
      userId: account.user.id,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!enrolment) throw new ResourceNotFoundError("Course not found.");

  const header = await offeringHeader(db, tenantId, offeringId);
  const full = await assembleGradebook({
    db,
    tenantId,
    offeringId,
    header,
    userId: account.user.id,
  });

  const own = full.learners.find((learner) => learner.userId === account.user.id);
  if (!own) throw new ResourceNotFoundError("Course not found.");

  const visibleColumns = full.columns.filter((column) => column.released);
  const result = calculateLearnerResult({
    columns: visibleColumns,
    cells: own.cells,
    scheme: full.scheme,
    learnerView: true,
  });

  return {
    gradebook: { ...full, columns: visibleColumns, learners: [{ ...own, result }] },
    own: { ...own, result },
  };
}

// ---------------------------------------------------------------------------
// Configuration writes
// ---------------------------------------------------------------------------

const schemeSchema = z.object({
  mode: z.enum(["points", "weighted"]),
  passMark: z
    .number()
    .min(0, "The pass mark cannot be below 0%.")
    .max(100, "The pass mark cannot exceed 100%.")
    .nullable(),
  rounding: z.number().int().min(0).max(2),
  treatMissingAsZero: z.boolean(),
  scale: z
    .array(
      z.object({
        minPercent: z.number().min(0).max(100),
        letter: z.string().trim().min(1).max(12),
      }),
    )
    .min(1)
    .optional(),
  weights: z
    .array(
      z.object({
        kind: z.enum(["assignment", "quiz"]),
        refId: z.string().trim().min(1),
        weight: z.number().positive("A weight must be greater than zero.").max(1000),
      }),
    )
    .optional(),
});

export type GradingSchemeInput = z.infer<typeof schemeSchema>;

/**
 * Create or replace the grading scheme of an offering.
 * Changing the configuration never rewrites stored marks: results are computed,
 * so every learner is recalculated on the next read.
 */
export async function saveGradingScheme(
  account: AccountContext,
  offeringId: string,
  input: GradingSchemeInput,
) {
  requirePermission(account, "grades.update");
  const access = await getOfferingAccess(account, offeringId);
  if (!access.canManage) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }

  const parsed = schemeSchema.parse(input);
  const tenantId = tenantIdOf(account);
  const db = getDb();

  return db.$transaction(async (tx) => {
    const scheme = await tx.gradingScheme.upsert({
      where: { offeringId },
      create: {
        tenantId,
        offeringId,
        mode: parsed.mode === "weighted" ? GradingMode.WEIGHTED : GradingMode.POINTS,
        passMark: parsed.passMark,
        rounding: parsed.rounding,
        scale: (parsed.scale ?? DEFAULT_SCALE) as unknown as Prisma.InputJsonValue,
        treatMissingAsZero: parsed.treatMissingAsZero,
        version: 1,
      },
      update: {
        mode: parsed.mode === "weighted" ? GradingMode.WEIGHTED : GradingMode.POINTS,
        passMark: parsed.passMark,
        rounding: parsed.rounding,
        ...(parsed.scale ? { scale: parsed.scale as unknown as Prisma.InputJsonValue } : {}),
        treatMissingAsZero: parsed.treatMissingAsZero,
        version: { increment: 1 },
      },
    });

    if (parsed.weights) {
      await tx.assessmentWeight.deleteMany({ where: { schemeId: scheme.id } });
      if (parsed.weights.length > 0) {
        await tx.assessmentWeight.createMany({
          data: parsed.weights.map((weight) => ({
            tenantId,
            schemeId: scheme.id,
            kind: weight.kind === "quiz" ? AssessmentKind.QUIZ : AssessmentKind.ASSIGNMENT,
            refId: weight.refId,
            weight: weight.weight,
          })),
        });
      }
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "grading_scheme_saved",
      resourceType: "grading_scheme",
      resourceId: scheme.id,
      after: {
        mode: scheme.mode,
        passMark: parsed.passMark,
        rounding: scheme.rounding,
        version: scheme.version,
        weights: parsed.weights?.length ?? 0,
      },
    });

    return scheme;
  });
}

const excusalSchema = z.object({
  userId: z.string().trim().min(1),
  kind: z.enum(["assignment", "quiz"]),
  refId: z.string().trim().min(1),
  reason: z.string().trim().min(3, "Give a reason of at least 3 characters.").max(500),
});

/** Excuse one learner from one assessment. Excused work leaves the total. */
export async function excuseAssessment(
  account: AccountContext,
  offeringId: string,
  input: z.infer<typeof excusalSchema>,
) {
  requirePermission(account, "grades.update");
  const access = await getOfferingAccess(account, offeringId);
  if (!access.canManage) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }

  const parsed = excusalSchema.parse(input);
  const tenantId = tenantIdOf(account);
  const db = getDb();

  const enrolment = await db.enrolment.findFirst({
    where: { tenantId, courseOfferingId: offeringId, userId: parsed.userId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!enrolment) throw new ResourceNotFoundError("That learner is not enrolled in this course.");

  return db.$transaction(async (tx) => {
    const excusal = await tx.assessmentExcusal.upsert({
      where: {
        offeringId_userId_kind_refId: {
          offeringId,
          userId: parsed.userId,
          kind: parsed.kind === "quiz" ? AssessmentKind.QUIZ : AssessmentKind.ASSIGNMENT,
          refId: parsed.refId,
        },
      },
      create: {
        tenantId,
        offeringId,
        userId: parsed.userId,
        kind: parsed.kind === "quiz" ? AssessmentKind.QUIZ : AssessmentKind.ASSIGNMENT,
        refId: parsed.refId,
        reason: parsed.reason,
        createdByUserId: account.user.id,
      },
      update: { reason: parsed.reason, createdByUserId: account.user.id },
    });

    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "assessment_excused",
      resourceType: "assessment_excusal",
      resourceId: excusal.id,
      after: { userId: parsed.userId, kind: parsed.kind, refId: parsed.refId },
      reason: parsed.reason,
    });

    return excusal;
  });
}

export async function removeExcusal(
  account: AccountContext,
  offeringId: string,
  excusalId: string,
) {
  requirePermission(account, "grades.update");
  const access = await getOfferingAccess(account, offeringId);
  if (!access.canManage) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }

  const tenantId = tenantIdOf(account);
  const db = getDb();

  const existing = await db.assessmentExcusal.findFirst({
    where: { id: excusalId, tenantId, offeringId },
  });
  if (!existing) throw new ResourceNotFoundError("Excusal not found.");

  return db.$transaction(async (tx) => {
    await tx.assessmentExcusal.delete({ where: { id: existing.id } });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "assessment_excusal_removed",
      resourceType: "assessment_excusal",
      resourceId: existing.id,
      before: { userId: existing.userId, kind: existing.kind, refId: existing.refId },
    });
  });
}

/**
 * What an offering-wide release would publish, without publishing anything.
 * Assignment marks are counted from the stored grades; a column is "ready" when
 * a draft mark has a score, so releasing cannot publish an empty mark.
 */
export type ReleasePreviewColumn = {
  id: string;
  title: string;
  kind: "assignment" | "quiz";
  released: boolean;
  /** Draft marks with a score that the batch release would publish. */
  ready: number;
  /** Learners who submitted work that has no mark yet, excusals excluded. */
  awaitingMark: number;
  /** Quizzes are released from their own page, so they never join a batch. */
  batched: boolean;
};

export type ReleasePreview = {
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  termName: string;
  academicYearName: string;
  columns: ReleasePreviewColumn[];
  readyTotal: number;
  awaitingMarkTotal: number;
  releasedColumns: number;
  unreleasedColumns: number;
};

export async function getReleasePreview(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<ReleasePreview> {
  requirePermission(account, "grades.read");
  const access = await getOfferingAccess(account, offeringId, db);
  if (!access.canManage) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }

  const tenantId = tenantIdOf(account);
  const header = await offeringHeader(db, tenantId, offeringId);

  const [assignments, quizzes, grades, submissions, excusals] = await Promise.all([
    db.assignment.findMany({
      where: { tenantId, offeringId, status: { not: "DRAFT" as AssignmentStatus } },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true },
    }),
    db.quiz.findMany({
      where: { tenantId, offeringId, status: "PUBLISHED" },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, releasedAt: true },
    }),
    db.grade.findMany({
      where: { tenantId, assignment: { offeringId } },
      select: { assignmentId: true, learnerUserId: true, rawScore: true, gradeStatus: true },
    }),
    db.assignmentSubmission.findMany({
      where: { tenantId, assignment: { offeringId }, status: { not: "DRAFT" } },
      select: { assignmentId: true, userId: true },
    }),
    db.assessmentExcusal.findMany({
      where: { tenantId, offeringId, kind: AssessmentKind.ASSIGNMENT },
      select: { userId: true, refId: true },
    }),
  ]);

  const excused = new Set(excusals.map((row) => `${row.userId}|${row.refId}`));
  const marked = new Set(grades.map((grade) => `${grade.learnerUserId}|${grade.assignmentId}`));

  const assignmentColumns: ReleasePreviewColumn[] = assignments.map((assignment) => {
    const rows = grades.filter((grade) => grade.assignmentId === assignment.id);
    const awaiting = new Set(
      submissions
        .filter(
          (submission) =>
            submission.assignmentId === assignment.id &&
            !marked.has(`${submission.userId}|${assignment.id}`) &&
            !excused.has(`${submission.userId}|${assignment.id}`),
        )
        .map((submission) => submission.userId),
    );
    return {
      id: `assignment:${assignment.id}`,
      title: assignment.title,
      kind: "assignment" as const,
      released: rows.some((grade) => grade.gradeStatus === GradeStatus.RELEASED),
      ready: rows.filter(
        (grade) => grade.gradeStatus === GradeStatus.DRAFT && grade.rawScore !== null,
      ).length,
      awaitingMark: awaiting.size,
      batched: true,
    };
  });

  const quizColumns: ReleasePreviewColumn[] = quizzes.map((quiz) => ({
    id: `quiz:${quiz.id}`,
    title: quiz.title,
    kind: "quiz" as const,
    released: quiz.releasedAt !== null,
    ready: 0,
    awaitingMark: 0,
    batched: false,
  }));

  const columns = [...assignmentColumns, ...quizColumns];
  return {
    offeringId,
    ...header,
    columns,
    readyTotal: assignmentColumns.reduce((total, column) => total + column.ready, 0),
    awaitingMarkTotal: assignmentColumns.reduce((total, column) => total + column.awaitingMark, 0),
    releasedColumns: columns.filter((column) => column.released).length,
    unreleasedColumns: columns.filter((column) => !column.released).length,
  };
}

export type ReleaseOutcome = { released: number; learners: number };

/**
 * Release every scored draft mark in an offering in one step.
 *
 * Only marks that already have a score move: a submission without a mark stays
 * ungraded, so a batch release can never publish an empty grade. Each released
 * mark keeps its history (`grade_change_events`) and the batch writes one
 * offering-level audit event; learners get one summary email each.
 */
export async function releaseOfferingMarks(
  account: AccountContext,
  offeringId: string,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<ReleaseOutcome> {
  requirePermission(account, "grades.publish");
  const access = await getOfferingAccess(account, offeringId, db);
  if (!access.canManage) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }

  const tenantId = tenantIdOf(account);
  const header = await offeringHeader(db, tenantId, offeringId);

  const pending = await db.grade.findMany({
    where: {
      tenantId,
      gradeStatus: GradeStatus.DRAFT,
      rawScore: { not: null },
      assignment: { offeringId, status: { not: "DRAFT" as AssignmentStatus } },
    },
    select: {
      id: true,
      rawScore: true,
      learnerUserId: true,
      learner: { select: { name: true, email: true } },
      assignment: { select: { title: true } },
    },
  });

  const learners = new Map<string, { name: string; email: string; titles: string[] }>();
  for (const grade of pending) {
    const entry = learners.get(grade.learnerUserId) ?? {
      name: grade.learner.name,
      email: grade.learner.email,
      titles: [],
    };
    entry.titles.push(grade.assignment.title);
    learners.set(grade.learnerUserId, entry);
  }

  if (pending.length === 0) return { released: 0, learners: 0 };

  const now = new Date();

  await db.$transaction(async (tx) => {
    await tx.grade.updateMany({
      where: { id: { in: pending.map((grade) => grade.id) } },
      data: {
        gradeStatus: GradeStatus.RELEASED,
        releasedAt: now,
        version: { increment: 1 },
      },
    });

    await tx.gradeChangeEvent.createMany({
      data: pending.map((grade) => ({
        tenantId,
        gradeId: grade.id,
        actorUserId: account.user.id,
        oldRawScore: grade.rawScore,
        newRawScore: grade.rawScore,
        oldStatus: GradeStatus.DRAFT,
        newStatus: GradeStatus.RELEASED,
        requestId: context.requestId,
      })),
    });

    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "gradebook.offering_released",
      resourceType: "course_offering",
      resourceId: offeringId,
      after: {
        grades: pending.length,
        learners: learners.size,
        assessments: new Set(pending.map((grade) => grade.assignment.title)).size,
      },
      requestId: context.requestId,
    });
  });

  // Notifications are best-effort: the release is already committed, and one
  // summary per learner avoids a burst of messages for a cohort-sized batch.
  for (const learner of learners.values()) {
    try {
      await sendMail({
        to: learner.email,
        subject: `Grades released: ${header.courseCode}`,
        body: [
          `Hello ${learner.name},`,
          "",
          `Your marks for ${header.courseCode} ${header.courseTitle} have been released:`,
          ...learner.titles.map((title) => `- ${title}`),
          "",
          "Open the course in the LMS to read your feedback.",
        ].join("\n"),
      });
    } catch (error) {
      log("error", "gradebook.release_notification_failed", {
        offeringId,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return { released: pending.length, learners: learners.size };
}

/** CSV with a header row naming every column, its kind, and its points. */
export function gradebookToCsv(gradebook: Gradebook): string {
  const header = [
    "Learner",
    "Email",
    ...gradebook.columns.map(
      (column) => `${column.title} (${column.kind}, /${column.pointsPossible})`,
    ),
    "Earned",
    "Possible",
    "Percentage",
    "Letter",
    "Outcome",
  ];

  const escape = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const rows = gradebook.learners.map((learner) => {
    const marks = gradebook.columns.map((column) => {
      const cell = learner.cells[column.id];
      if (!cell) return "Missing";
      if (cell.state === "scored") return String(cell.score ?? "");
      if (cell.state === "ungraded") return "Not yet graded";
      if (cell.state === "excused") return "Excused";
      return "Missing";
    });

    return [
      learner.name,
      learner.email,
      ...marks,
      String(learner.result.earned),
      String(learner.result.possible),
      learner.result.percentage === null ? "" : String(learner.result.percentage),
      learner.result.letter ?? "",
      learner.result.outcome,
    ].map(escape);
  });

  return `${[header.map(escape).join(","), ...rows.map((row) => row.join(","))].join("\r\n")}\r\n`;
}
