import { randomUUID } from "node:crypto";

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
import { getStorage, StorageObjectNotFoundError } from "@/lib/storage";

import type { RubricCriterionView, SubmissionType } from "./assignment-service";
import {
  gradeVisibleToLearner,
  learnerAssignmentState,
  parseAssignmentSettings,
  submissionGate,
  windowState,
  type AssignmentSettings,
  type LearnerAssignmentState,
  type SubmissionStatus,
  type WindowState,
} from "./rules";

/**
 * Learner-facing assignments: the to-do list, one assignment's detail, drafts,
 * submission receipts, history, and released feedback.
 *
 * A learner may read an assignment only with an active enrolment in a published
 * offering. Draft assignments return 404 rather than confirming they exist.
 * Submitting is always re-checked on the server against the window, the late
 * policy, the resubmission rule, and the attempt limit.
 */

export const MAX_SUBMISSION_FILE_BYTES = 25 * 1024 * 1024;

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

export type SubmissionFileView = {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string | null;
};

export type SubmissionView = {
  id: string;
  status: SubmissionStatus;
  submittedAt: Date | null;
  receivedAt: Date;
  late: boolean;
  attemptNumber: number;
  body: string | null;
  files: SubmissionFileView[];
  history: Array<{ body: string; createdAt: Date }>;
};

export type ReleasedGradeView = {
  rawScore: number | null;
  pointsPossible: number;
  percent: number | null;
  feedback: string | null;
  releasedAt: Date | null;
  rubricScores: Array<{ criterionId: string; score: number | null; feedback: string | null }>;
};

export type LearnerAssignment = {
  id: string;
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  termName: string;
  title: string;
  instructions: string | null;
  dueAt: Date | null;
  availableFrom: Date | null;
  availableUntil: Date | null;
  pointsPossible: number;
  submissionType: SubmissionType;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  mode: "learner" | "preview";
  window: WindowState;
  state: LearnerAssignmentState;
  canSubmit: boolean;
  blockedReason: string | null;
  settings: AssignmentSettings;
  submission: SubmissionView | null;
  grade: ReleasedGradeView | null;
  rubric: RubricCriterionView[];
};

export type LearnerAssignmentCard = {
  id: string;
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  title: string;
  dueAt: Date | null;
  availableUntil: Date | null;
  pointsPossible: number;
  state: LearnerAssignmentState;
  percent: number | null;
};

const BLOCKED_MESSAGES: Record<
  Exclude<ReturnType<typeof submissionGate>, { allowed: true }>["reason"],
  string
> = {
  not_yet: "This assignment has not opened yet.",
  closed: "This assignment is closed and no longer accepts work.",
  past_due: "The deadline has passed and late submissions are not accepted.",
  graded: "This submission has been graded. Ask your teacher to reopen it.",
  resubmission_not_allowed:
    "You have already submitted. Resubmission is not allowed for this assignment.",
  max_attempts: "You have used every allowed attempt for this assignment.",
};

function optionalDateTime() {
  return z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : value),
    z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Use a valid date and time.")
      .transform((value) => new Date(value))
      .optional(),
  );
}

const submissionSchema = z.object({
  assignmentId: z.string().min(1),
  body: z.string().max(20000, "Keep your answer under 20,000 characters.").optional(),
  bodyIsUrl: z.preprocess(
    (value) => value === true || value === "true" || value === "on" || value === "1",
    z.boolean(),
  ),
  /** Accepted but unused by the service; the caller passes the file separately. */
  submittedAt: optionalDateTime(),
});

export type SubmissionInput = z.input<typeof submissionSchema>;
export type SubmissionFile = { fileName: string; contentType: string; data: Buffer };

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Rejects empty work before anything is written. */
function validateWork(
  type: SubmissionType,
  body: string,
  hasFile: boolean,
  bodyIsUrl: boolean,
): void {
  if (type === "FILE") {
    if (!hasFile) throw new ConflictError("Attach a file before submitting.");
    return;
  }
  if (type === "LINK") {
    if (!body) throw new ConflictError("Add the link you are submitting.");
    if (!isHttpUrl(body)) throw new ConflictError("Use an http(s) link.");
    return;
  }
  if (!body) throw new ConflictError("Add your answer before submitting.");
  if (bodyIsUrl && !isHttpUrl(body)) throw new ConflictError("Use an http(s) link.");
}

function storageKeyFor(tenantId: string, assignmentId: string): string {
  return `tenants/${tenantId}/assignments/${assignmentId}/submissions/${randomUUID()}`;
}

async function loadAssignment(
  account: AccountContext,
  assignmentId: string,
  db: DatabaseClient,
  now: Date,
) {
  const tenantId = tenantIdOf(account);
  const assignment = await db.assignment.findFirst({
    where: { id: assignmentId, tenantId },
    select: {
      id: true,
      offeringId: true,
      title: true,
      instructions: true,
      dueAt: true,
      availableFrom: true,
      availableUntil: true,
      pointsPossible: true,
      submissionTypes: true,
      settings: true,
      status: true,
      offering: {
        select: {
          status: true,
          course: { select: { code: true, title: true } },
          term: { select: { name: true } },
          instructors: { select: { userId: true, user: { select: { name: true } } } },
          enrolments: {
            where: { userId: account.user.id },
            select: { status: true },
          },
        },
      },
      rubric: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, title: true, description: true, pointsPossible: true, position: true },
      },
    },
  });
  if (!assignment) throw new ResourceNotFoundError();

  const isInstructor = assignment.offering.instructors.some(
    (instructor) => instructor.userId === account.user.id,
  );
  const isAdministrator =
    account.permissions.has("enrolments.manage") || account.permissions.has("courses.update");
  const isEnrolled = assignment.offering.enrolments[0]?.status === "ACTIVE";
  const preview = isInstructor || isAdministrator;

  if (!preview) {
    if (assignment.status !== "PUBLISHED" || assignment.offering.status !== "PUBLISHED") {
      throw new ResourceNotFoundError();
    }
    if (!isEnrolled) throw new PermissionDeniedError("You are not enrolled in this course.");
  }

  const settings = parseAssignmentSettings(assignment.settings);
  const window = {
    availableFrom: assignment.availableFrom,
    availableUntil: assignment.availableUntil,
    dueAt: assignment.dueAt,
  };

  return { assignment, settings, window, preview, isEnrolled, now, tenantId };
}

function toFileView(file: {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string | null;
}): SubmissionFileView {
  return {
    id: file.id,
    fileName: file.fileName,
    fileSize: file.fileSize,
    contentType: file.contentType,
  };
}

export async function getLearnerAssignment(
  account: AccountContext,
  assignmentId: string,
  options: { now?: Date } = {},
  db: DatabaseClient = getDb(),
): Promise<LearnerAssignment> {
  requirePermission(account, "courses.read");
  const now = options.now ?? new Date();
  const { assignment, settings, window, preview } = await loadAssignment(
    account,
    assignmentId,
    db,
    now,
  );

  const submission = await db.assignmentSubmission.findUnique({
    where: { assignmentId_userId: { assignmentId, userId: account.user.id } },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      lateFlag: true,
      attemptNumber: true,
      createdAt: true,
      textVersions: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { body: true, createdAt: true },
      },
      fileLinks: {
        orderBy: { createdAt: "asc" },
        select: { id: true, fileName: true, fileSize: true, contentType: true },
      },
      grades: {
        where: { learnerUserId: account.user.id },
        select: {
          rawScore: true,
          pointsPossible: true,
          gradeStatus: true,
          releasedAt: true,
          feedback: { select: { body: true } },
          rubricScores: {
            select: { rubricCriterionId: true, score: true, feedback: true },
          },
        },
      },
    },
  });

  const latest = submission?.textVersions[0];
  const grade = submission?.grades[0] ?? null;
  const released = gradeVisibleToLearner(grade ?? null);

  const submissionView: SubmissionView | null = submission
    ? {
        id: submission.id,
        status: submission.status,
        submittedAt: submission.submittedAt,
        receivedAt: submission.createdAt,
        late: submission.lateFlag,
        attemptNumber: submission.attemptNumber,
        body: latest?.body ?? null,
        files: submission.fileLinks.map(toFileView),
        history: submission.textVersions.map((version) => ({
          body: version.body,
          createdAt: version.createdAt,
        })),
      }
    : null;

  const gate = submissionGate({ window, settings, submission: submission ?? null, now });
  const points = Number(assignment.pointsPossible);
  const state = learnerAssignmentState({
    window,
    now,
    submission: submission ?? null,
    gradeReleased: released,
  });

  return {
    id: assignment.id,
    offeringId: assignment.offeringId,
    courseCode: assignment.offering.course.code,
    courseTitle: assignment.offering.course.title,
    termName: assignment.offering.term.name,
    title: assignment.title,
    instructions: assignment.instructions,
    dueAt: assignment.dueAt,
    availableFrom: assignment.availableFrom,
    availableUntil: assignment.availableUntil,
    pointsPossible: points,
    submissionType: assignment.submissionTypes,
    status: assignment.status,
    mode: preview ? "preview" : "learner",
    window: windowState(window, now),
    state,
    canSubmit: !preview && gate.allowed,
    blockedReason: gate.allowed || preview ? null : BLOCKED_MESSAGES[gate.reason],
    settings,
    submission: submissionView,
    grade:
      released && grade
        ? {
            rawScore: grade.rawScore === null ? null : Number(grade.rawScore),
            pointsPossible: Number(grade.pointsPossible),
            percent:
              grade.rawScore === null
                ? null
                : Math.round((Number(grade.rawScore) / Number(grade.pointsPossible)) * 1000) / 10,
            feedback: grade.feedback[0]?.body ?? null,
            releasedAt: grade.releasedAt,
            rubricScores: grade.rubricScores.map((score) => ({
              criterionId: score.rubricCriterionId,
              score: score.score === null ? null : Number(score.score),
              feedback: score.feedback,
            })),
          }
        : null,
    rubric: assignment.rubric.map((criterion) => ({
      id: criterion.id,
      title: criterion.title,
      description: criterion.description,
      pointsPossible: Number(criterion.pointsPossible),
      position: criterion.position,
    })),
  };
}

/** Every published assignment in a course the learner is actively enrolled in. */
export async function listLearnerAssignments(
  account: AccountContext,
  options: { now?: Date } = {},
  db: DatabaseClient = getDb(),
): Promise<LearnerAssignmentCard[]> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);
  const now = options.now ?? new Date();

  const rows = await db.assignment.findMany({
    where: {
      tenantId,
      status: "PUBLISHED",
      offering: {
        status: "PUBLISHED",
        enrolments: { some: { userId: account.user.id, status: "ACTIVE" } },
      },
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      offeringId: true,
      title: true,
      dueAt: true,
      availableFrom: true,
      availableUntil: true,
      pointsPossible: true,
      offering: {
        select: {
          course: { select: { code: true, title: true } },
        },
      },
      submissions: {
        where: { userId: account.user.id },
        select: {
          status: true,
          grades: {
            where: { learnerUserId: account.user.id },
            select: { rawScore: true, pointsPossible: true, gradeStatus: true, releasedAt: true },
          },
        },
      },
    },
  });

  return rows.map((row) => {
    const submission = row.submissions[0] ?? null;
    const grade = submission?.grades[0] ?? null;
    const released = gradeVisibleToLearner(grade ?? null);
    return {
      id: row.id,
      offeringId: row.offeringId,
      courseCode: row.offering.course.code,
      courseTitle: row.offering.course.title,
      title: row.title,
      dueAt: row.dueAt,
      availableUntil: row.availableUntil,
      pointsPossible: Number(row.pointsPossible),
      state: learnerAssignmentState({
        window: {
          availableFrom: row.availableFrom,
          availableUntil: row.availableUntil,
          dueAt: row.dueAt,
        },
        now,
        submission: submission ?? null,
        gradeReleased: released,
      }),
      percent:
        released && grade?.rawScore !== null && grade
          ? Math.round((Number(grade.rawScore) / Number(grade.pointsPossible)) * 1000) / 10
          : null,
    };
  });
}

async function persistSubmission(
  account: AccountContext,
  input: unknown,
  file: SubmissionFile | null,
  options: { submit: boolean; requestId: string },
  db: DatabaseClient,
) {
  requirePermission(account, "submissions.submit");
  const parsed = submissionSchema.parse(input);
  const now = new Date();
  const { assignment, settings, window, preview, tenantId } = await loadAssignment(
    account,
    parsed.assignmentId,
    db,
    now,
  );
  if (preview) {
    throw new PermissionDeniedError("Teaching staff cannot submit work for a learner.");
  }

  const existing = await db.assignmentSubmission.findUnique({
    where: {
      assignmentId_userId: { assignmentId: assignment.id, userId: account.user.id },
    },
    select: {
      id: true,
      status: true,
      attemptNumber: true,
      version: true,
      submittedAt: true,
      lateFlag: true,
      textVersions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true },
      },
      fileLinks: { select: { id: true, storageKey: true } },
    },
  });

  const body = (parsed.body ?? "").trim();
  const latestBody = existing?.textVersions[0]?.body ?? null;
  const existingFiles = existing?.fileLinks ?? [];
  const hasFileAfter = Boolean(file) || existingFiles.length > 0;
  const type = assignment.submissionTypes;

  validateWork(type, body, hasFileAfter, parsed.bodyIsUrl);

  // A retry of an identical submission returns the stored receipt instead of
  // creating a second attempt. This is what makes the submit button safe to
  // press twice (double click, network retry, back-and-resubmit).
  if (options.submit && existing && existing.status !== "DRAFT") {
    const identical = body === (latestBody ?? "") && !file;
    if (identical) {
      return {
        submissionId: existing.id,
        status: existing.status,
        submittedAt: existing.submittedAt,
        attemptNumber: existing.attemptNumber,
        late: existing.lateFlag,
        created: false,
      };
    }
  }

  const gate = submissionGate({ window, settings, submission: existing ?? null, now });
  if (!gate.allowed) {
    throw new ConflictError(BLOCKED_MESSAGES[gate.reason]);
  }

  if (!options.submit && existing && existing.status !== "DRAFT") {
    throw new ConflictError("This submission has already been sent to your teacher.");
  }

  let uploadedKey: string | null = null;
  if (file) {
    if (file.data.byteLength === 0) throw new ConflictError("That file is empty.");
    if (file.data.byteLength > MAX_SUBMISSION_FILE_BYTES) {
      throw new ConflictError("Submission files must be 25 MB or smaller.");
    }
    uploadedKey = storageKeyFor(tenantId, assignment.id);
    await getStorage().put(uploadedKey, file.data);
  }

  try {
    return await db.$transaction(async (tx) => {
      const submission = await tx.assignmentSubmission.upsert({
        where: {
          assignmentId_userId: { assignmentId: assignment.id, userId: account.user.id },
        },
        update: {},
        create: {
          tenantId,
          assignmentId: assignment.id,
          userId: account.user.id,
          status: "DRAFT",
          attemptNumber: 1,
          version: 1,
        },
        select: {
          id: true,
          status: true,
          attemptNumber: true,
          version: true,
          submittedAt: true,
          lateFlag: true,
        },
      });

      if (!options.submit && submission.status !== "DRAFT") {
        throw new ConflictError("This submission has already been sent to your teacher.");
      }

      if (body && body !== (latestBody ?? "")) {
        await tx.submissionTextVersion.create({
          data: { submissionId: submission.id, body },
        });
      }

      if (file && uploadedKey) {
        await tx.submissionFileLink.deleteMany({ where: { submissionId: submission.id } });
        await tx.submissionFileLink.create({
          data: {
            submissionId: submission.id,
            fileName: file.fileName.slice(0, 200),
            fileSize: file.data.byteLength,
            contentType: file.contentType,
            storageKey: uploadedKey,
          },
        });
      }

      const resubmission =
        Boolean(existing) && existing !== null && existing.status !== "DRAFT" && options.submit;
      const nextAttempt = resubmission
        ? submission.attemptNumber + 1
        : Math.max(1, submission.attemptNumber);

      if (options.submit) {
        await tx.assignmentSubmission.update({
          where: { id: submission.id },
          data: {
            status: gate.late ? "LATE" : "SUBMITTED",
            submittedAt: now,
            lateFlag: gate.late,
            attemptNumber: nextAttempt,
            version: submission.version + 1,
          },
        });

        await recordAuditEvent(tx, {
          tenantId: tenantIdOf(account),
          actorUserId: account.user.id,
          action: resubmission ? "assignment.resubmitted" : "assignment.submitted",
          resourceType: "assignment_submission",
          resourceId: submission.id,
          after: {
            assignmentId: assignment.id,
            attemptNumber: nextAttempt,
            late: gate.late,
            hasFile: Boolean(file) || existingFiles.length > 0,
          },
          requestId: options.requestId,
        });

        await tx.learningEvent.create({
          data: {
            tenantId: tenantIdOf(account),
            userId: account.user.id,
            courseOfferingId: assignment.offeringId,
            type: "assignment.submitted",
            metadata: { assignmentId: assignment.id, late: gate.late, attempt: nextAttempt },
          },
        });
      } else {
        await recordAuditEvent(tx, {
          tenantId: tenantIdOf(account),
          actorUserId: account.user.id,
          action: "assignment.draft_saved",
          resourceType: "assignment_submission",
          resourceId: submission.id,
          after: {
            assignmentId: assignment.id,
            hasFile: Boolean(file) || existingFiles.length > 0,
          },
          requestId: options.requestId,
        });
      }

      return {
        submissionId: submission.id,
        status: options.submit ? (gate.late ? "LATE" : "SUBMITTED") : "DRAFT",
        submittedAt: options.submit ? now : submission.submittedAt,
        attemptNumber: nextAttempt,
        late: gate.late,
        created: true,
      };
    });
  } catch (error) {
    if (uploadedKey) {
      await getStorage()
        .delete(uploadedKey)
        .catch(() => undefined);
    }
    throw error;
  }
}

/** Saves a draft without a receipt; nothing is "submitted" yet. */
export async function saveSubmissionDraft(
  account: AccountContext,
  input: unknown,
  file: SubmissionFile | null,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
) {
  return persistSubmission(
    account,
    input,
    file,
    { submit: false, requestId: context.requestId },
    db,
  );
}

/** Submits work and returns a receipt. Safe to retry with identical content. */
export async function submitAssignment(
  account: AccountContext,
  input: unknown,
  file: SubmissionFile | null,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
) {
  return persistSubmission(
    account,
    input,
    file,
    { submit: true, requestId: context.requestId },
    db,
  );
}

/** Authorisation for a submission attachment: its owner, or teaching staff. */
export async function readSubmissionFile(
  account: AccountContext,
  fileId: string,
  db: DatabaseClient = getDb(),
): Promise<{ fileName: string; contentType: string; data: Buffer }> {
  const tenantId = tenantIdOf(account);
  const file = await db.submissionFileLink.findFirst({
    where: { id: fileId, submission: { assignment: { tenantId } } },
    select: {
      fileName: true,
      contentType: true,
      storageKey: true,
      submission: {
        select: {
          userId: true,
          assignment: {
            select: {
              offering: { select: { instructors: { select: { userId: true } } } },
            },
          },
        },
      },
    },
  });
  if (!file || !file.storageKey) throw new ResourceNotFoundError();

  const isOwner = file.submission.userId === account.user.id;
  const isInstructor = file.submission.assignment.offering.instructors.some(
    (instructor) => instructor.userId === account.user.id,
  );
  const isAdministrator =
    account.permissions.has("enrolments.manage") || account.permissions.has("courses.update");
  if (!isOwner && !isInstructor && !isAdministrator) {
    throw new PermissionDeniedError("You cannot open this file.");
  }

  try {
    const data = await getStorage().get(file.storageKey);
    return {
      fileName: file.fileName,
      contentType: file.contentType ?? "application/octet-stream",
      data,
    };
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      throw new ResourceNotFoundError("The stored file is missing.");
    }
    throw error;
  }
}
