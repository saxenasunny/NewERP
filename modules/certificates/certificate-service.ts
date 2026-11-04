import { randomBytes } from "node:crypto";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
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

import {
  completionRuleInputSchema,
  describeCompletionRules,
  evaluateCompletion,
  parseCompletionRules,
  rulesFromInput,
  summarizeCompletionRules,
  type CompletionEvaluation,
  type CompletionFacts,
  type CompletionRuleConfig,
} from "./completion";

/**
 * Certificates and completion rules.
 *
 * A certificate is issued per learner per offering, once. The award stores the
 * rules that were applied and the facts they were evaluated against, so it can
 * explain itself later. Reissue replaces an award (marking the old row
 * `reissued`); revocation keeps the row and its reason but turns the public
 * status to `revoked`. Neither path deletes anything.
 *
 * The public verification token is an identifier, not a credential: it exposes
 * the learner's name, the course, the issuer, the dates, and the status — nothing
 * else. Verification never reveals an email, a grade, or a revocation reason.
 */

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

type WriteContext = { requestId?: string | null };

async function requireCertificateManagement(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient,
): Promise<OfferingAccess> {
  requirePermission(account, "certificates.manage");
  const access = await getOfferingAccess(account, offeringId, db);
  if (!access.canManage) {
    throw new PermissionDeniedError("You are not assigned to this course.");
  }
  return access;
}

export type CertificateView = {
  id: string;
  certificateNumber: string;
  verificationToken: string;
  status: "ISSUED" | "REISSUED" | "REVOKED";
  userId: string;
  learnerName: string;
  courseCode: string;
  courseTitle: string;
  institutionName: string;
  issuerName: string;
  issuedAt: Date;
  revokedAt: Date | null;
  reissuedFromId: string | null;
  completionSummary: string;
};

function toCertificateView(row: {
  id: string;
  certificateNumber: string;
  verificationToken: string;
  status: "ISSUED" | "REISSUED" | "REVOKED";
  userId: string;
  learnerName: string;
  courseCode: string;
  courseTitle: string;
  institutionName: string;
  issuerName: string;
  issuedAt: Date;
  revokedAt: Date | null;
  reissuedFromId: string | null;
  ruleSnapshot: Prisma.JsonValue;
}): CertificateView {
  return {
    id: row.id,
    certificateNumber: row.certificateNumber,
    verificationToken: row.verificationToken,
    status: row.status,
    userId: row.userId,
    learnerName: row.learnerName,
    courseCode: row.courseCode,
    courseTitle: row.courseTitle,
    institutionName: row.institutionName,
    issuerName: row.issuerName,
    issuedAt: row.issuedAt,
    revokedAt: row.revokedAt,
    reissuedFromId: row.reissuedFromId,
    completionSummary: summarizeCompletionRules(parseCompletionRules(row.ruleSnapshot)),
  };
}

function newVerificationToken(): string {
  return randomBytes(18).toString("base64url");
}

function newCertificateNumber(): string {
  return `CERT-${new Date().getUTCFullYear()}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Completion rules
// ---------------------------------------------------------------------------

export async function getOfferingCompletionRules(
  account: AccountContext,
  offeringId: string,
): Promise<{ access: OfferingAccess; rules: CompletionRuleConfig; summary: string[] }> {
  const db = getDb();
  const access = await requireCertificateManagement(account, offeringId, db);
  const offering = await db.courseOffering.findFirstOrThrow({
    where: { id: offeringId, tenantId: access.tenantId },
    select: { settings: true },
  });
  const settings =
    offering.settings && typeof offering.settings === "object" && !Array.isArray(offering.settings)
      ? (offering.settings as Record<string, unknown>)
      : {};
  const rules = parseCompletionRules(settings.completion);
  return { access, rules, summary: describeCompletionRules(rules) };
}

export async function saveCompletionRules(
  account: AccountContext,
  offeringId: string,
  raw: unknown,
  context: WriteContext = {},
): Promise<CompletionRuleConfig> {
  const input = completionRuleInputSchema.parse(raw);
  const rules = rulesFromInput(input);
  const db = getDb();
  const access = await requireCertificateManagement(account, offeringId, db);

  return db.$transaction(async (tx) => {
    const offering = await tx.courseOffering.findFirstOrThrow({
      where: { id: offeringId, tenantId: access.tenantId },
      select: { settings: true },
    });
    const settings =
      offering.settings &&
      typeof offering.settings === "object" &&
      !Array.isArray(offering.settings)
        ? (offering.settings as Record<string, Prisma.JsonValue>)
        : {};
    const before = parseCompletionRules(settings.completion);

    await tx.courseOffering.update({
      where: { id: offeringId },
      data: {
        settings: {
          ...settings,
          completion: rules as unknown as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
      },
    });

    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "certificate.rules_updated",
      resourceType: "course_offering",
      resourceId: offeringId,
      before: before as unknown as Prisma.InputJsonValue,
      after: rules as unknown as Prisma.InputJsonValue,
      requestId: context.requestId,
    });

    return rules;
  });
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Reads the facts completion rules are evaluated against. Only published content,
 * published assignments, and published quizzes count — a learner is never asked
 * to complete something they cannot see, and a withdrawn item stops counting.
 */
export async function completionFacts(
  db: DatabaseClient,
  tenantId: string,
  offeringId: string,
  userId: string,
): Promise<CompletionFacts> {
  const [publishedContentItems, completedContentItems, publishedAssignments, submittedAssignments] =
    await Promise.all([
      db.contentItem.count({
        where: {
          tenantId,
          status: "PUBLISHED",
          module: { courseOfferingId: offeringId, status: "PUBLISHED" },
        },
      }),
      db.contentProgress.count({
        where: {
          tenantId,
          userId,
          status: "COMPLETED",
          item: {
            status: "PUBLISHED",
            module: { courseOfferingId: offeringId, status: "PUBLISHED" },
          },
        },
      }),
      db.assignment.count({
        where: { tenantId, offeringId, status: "PUBLISHED" },
      }),
      db.assignmentSubmission.count({
        where: {
          tenantId,
          userId,
          status: { in: ["SUBMITTED", "LATE", "GRADED"] },
          assignment: { offeringId, status: "PUBLISHED" },
        },
      }),
    ]);

  const [publishedQuizzes, attemptedQuizzes] = await Promise.all([
    db.quiz.count({ where: { tenantId, offeringId, status: "PUBLISHED" } }),
    db.quizAttempt.findMany({
      where: {
        tenantId,
        userId,
        status: { in: ["SUBMITTED", "TIMED_OUT", "GRADED"] },
        quiz: { offeringId, status: "PUBLISHED" },
      },
      select: { quizId: true },
      distinct: ["quizId"],
    }),
  ]);

  const releasedGrades = await db.grade.findMany({
    where: {
      tenantId,
      learnerUserId: userId,
      releasedAt: { not: null },
      rawScore: { not: null },
      assignment: { offeringId },
    },
    select: { rawScore: true, pointsPossible: true },
  });

  const totals = releasedGrades.reduce(
    (accumulator, grade) => {
      const points = Number(grade.pointsPossible);
      if (points <= 0) return accumulator;
      return {
        raw: accumulator.raw + Number(grade.rawScore ?? 0),
        points: accumulator.points + points,
      };
    },
    { raw: 0, points: 0 },
  );

  return {
    publishedContentItems,
    completedContentItems,
    publishedAssignments,
    submittedAssignments,
    publishedQuizzes,
    submittedQuizzes: attemptedQuizzes.length,
    releasedGradePercent:
      totals.points > 0 ? Math.round((totals.raw / totals.points) * 1000) / 10 : null,
  };
}

export type CompletionRow = {
  learnerUserId: string;
  learnerName: string;
  learnerEmail: string;
  enrolmentStatus: "ACTIVE" | "WITHDRAWN" | "COMPLETED";
  facts: CompletionFacts;
  evaluation: CompletionEvaluation;
  certificate: CertificateView | null;
};

export type OfferingCertificatesWorkspace = {
  access: OfferingAccess;
  rules: CompletionRuleConfig;
  ruleSummary: string[];
  rows: CompletionRow[];
};

/** The staff view: every enrolment with its eligibility and current award. */
export async function getOfferingCertificatesWorkspace(
  account: AccountContext,
  offeringId: string,
): Promise<OfferingCertificatesWorkspace> {
  const db = getDb();
  const access = await requireCertificateManagement(account, offeringId, db);
  const offering = await db.courseOffering.findFirstOrThrow({
    where: { id: offeringId, tenantId: access.tenantId },
    select: { settings: true },
  });
  const settings =
    offering.settings && typeof offering.settings === "object" && !Array.isArray(offering.settings)
      ? (offering.settings as Record<string, unknown>)
      : {};
  const rules = parseCompletionRules(settings.completion);

  const enrolments = await db.enrolment.findMany({
    where: { tenantId: access.tenantId, courseOfferingId: offeringId },
    orderBy: { createdAt: "asc" },
    select: {
      userId: true,
      status: true,
      user: { select: { name: true, email: true } },
    },
  });

  const certificates = await db.certificate.findMany({
    where: { tenantId: access.tenantId, courseOfferingId: offeringId },
    orderBy: { issuedAt: "desc" },
  });
  const liveCertificates = new Map(
    certificates
      .filter((certificate) => certificate.status === "ISSUED")
      .map((certificate) => [certificate.userId, toCertificateView(certificate)]),
  );

  const rows: CompletionRow[] = [];
  for (const enrolment of enrolments) {
    const facts = await completionFacts(db, access.tenantId, offeringId, enrolment.userId);
    rows.push({
      learnerUserId: enrolment.userId,
      learnerName: enrolment.user.name,
      learnerEmail: enrolment.user.email,
      enrolmentStatus: enrolment.status,
      facts,
      evaluation: evaluateCompletion(facts, rules),
      certificate: liveCertificates.get(enrolment.userId) ?? null,
    });
  }

  return { access, rules, ruleSummary: describeCompletionRules(rules), rows };
}

// ---------------------------------------------------------------------------
// Issue, reissue, revoke
// ---------------------------------------------------------------------------

export async function issueCertificate(
  account: AccountContext,
  offeringId: string,
  learnerUserId: string,
  context: WriteContext = {},
): Promise<{ certificate: CertificateView; created: boolean }> {
  const db = getDb();
  const access = await requireCertificateManagement(account, offeringId, db);

  const enrolment = await db.enrolment.findFirst({
    where: { tenantId: access.tenantId, courseOfferingId: offeringId, userId: learnerUserId },
    select: { status: true },
  });
  if (!enrolment || enrolment.status === "WITHDRAWN") {
    throw new ResourceNotFoundError("That learner is not enrolled in this course.");
  }

  const existing = await db.certificate.findFirst({
    where: {
      tenantId: access.tenantId,
      courseOfferingId: offeringId,
      userId: learnerUserId,
      status: "ISSUED",
    },
  });
  if (existing) {
    return { certificate: toCertificateView(existing), created: false };
  }

  const superseded = await db.certificate.findFirst({
    where: { tenantId: access.tenantId, courseOfferingId: offeringId, userId: learnerUserId },
    orderBy: { createdAt: "desc" },
  });
  if (superseded) {
    throw new ConflictError(
      superseded.status === "REVOKED"
        ? "That learner's certificate was revoked. Reissue the award explicitly instead of issuing a new one."
        : "This learner's certificate was already replaced. Reissue the current award instead.",
    );
  }

  const offering = await db.courseOffering.findFirstOrThrow({
    where: { id: offeringId, tenantId: access.tenantId },
    select: {
      settings: true,
      course: { select: { code: true, title: true } },
    },
  });
  const settings =
    offering.settings && typeof offering.settings === "object" && !Array.isArray(offering.settings)
      ? (offering.settings as Record<string, unknown>)
      : {};
  const rules = parseCompletionRules(settings.completion);

  const facts = await completionFacts(db, access.tenantId, offeringId, learnerUserId);
  const evaluation = evaluateCompletion(facts, rules);
  if (!evaluation.eligible) {
    throw new ConflictError(
      `This learner is not eligible yet: ${evaluation.gaps.map((gap) => gap.message).join(" ")}`,
    );
  }

  const [learner, institution] = await Promise.all([
    db.user.findFirstOrThrow({
      where: { id: learnerUserId },
      select: { name: true },
    }),
    db.institution.findFirst({
      where: { tenantId: access.tenantId },
      select: { name: true },
    }),
  ]);
  const institutionName = institution?.name ?? access.tenantId;

  return db.$transaction(async (tx) => {
    const created = await tx.certificate.create({
      data: {
        tenantId: access.tenantId,
        courseOfferingId: offeringId,
        userId: learnerUserId,
        certificateNumber: newCertificateNumber(),
        verificationToken: newVerificationToken(),
        learnerName: learner.name,
        courseCode: offering.course.code,
        courseTitle: offering.course.title,
        institutionName,
        issuerName: institutionName,
        ruleSnapshot: rules as unknown as Prisma.InputJsonValue,
        evidenceSnapshot: {
          ...facts,
          contentPercent: evaluation.contentPercent,
          gaps: evaluation.gaps,
        } as Prisma.InputJsonValue,
        issuedByUserId: account.user.id,
      },
    });
    await recordAuditEvent(tx, {
      tenantId: access.tenantId,
      actorUserId: account.user.id,
      action: "certificate.issued",
      resourceType: "certificate",
      resourceId: created.id,
      after: {
        learnerUserId,
        certificateNumber: created.certificateNumber,
        rules: rules as unknown as Prisma.InputJsonValue,
      },
      requestId: context.requestId,
    });
    return { certificate: toCertificateView(created), created: true };
  });
}

export async function reissueCertificate(
  account: AccountContext,
  certificateId: string,
  raw: unknown,
  context: WriteContext = {},
): Promise<CertificateView> {
  const db = getDb();
  const existing = await db.certificate.findFirst({
    where: { id: certificateId, tenantId: tenantIdOf(account) },
  });
  if (!existing) throw new ResourceNotFoundError();
  await requireCertificateManagement(account, existing.courseOfferingId, db);
  if (existing.status === "REISSUED") {
    throw new ConflictError("That certificate has already been replaced by a newer one.");
  }

  const input = z
    .object({
      learnerName: z.preprocess(
        (value) => (value === "" || value === null || value === undefined ? undefined : value),
        z.string().trim().min(2, "Use at least 2 characters.").max(160).optional(),
      ),
      reason: z.string().trim().min(3, "Give a reason of at least 3 characters.").max(500),
    })
    .parse(raw);

  return db.$transaction(async (tx) => {
    // A revoked award keeps its revoked status so a shared verification link
    // still tells the truth; only a live award is marked as replaced.
    if (existing.status === "ISSUED") {
      await tx.certificate.update({
        where: { id: existing.id },
        data: { status: "REISSUED" },
      });
    }
    const created = await tx.certificate.create({
      data: {
        tenantId: existing.tenantId,
        courseOfferingId: existing.courseOfferingId,
        userId: existing.userId,
        certificateNumber: newCertificateNumber(),
        verificationToken: newVerificationToken(),
        learnerName: input.learnerName ?? existing.learnerName,
        courseCode: existing.courseCode,
        courseTitle: existing.courseTitle,
        institutionName: existing.institutionName,
        issuerName: existing.issuerName,
        ruleSnapshot: existing.ruleSnapshot as Prisma.InputJsonValue,
        evidenceSnapshot: existing.evidenceSnapshot as Prisma.InputJsonValue,
        reissuedFromId: existing.id,
        issuedByUserId: account.user.id,
      },
    });
    await recordAuditEvent(tx, {
      tenantId: existing.tenantId,
      actorUserId: account.user.id,
      action: "certificate.reissued",
      resourceType: "certificate",
      resourceId: created.id,
      before: {
        id: existing.id,
        certificateNumber: existing.certificateNumber,
        learnerName: existing.learnerName,
      },
      after: {
        id: created.id,
        certificateNumber: created.certificateNumber,
        learnerName: created.learnerName,
        replaces: existing.id,
      },
      reason: input.reason,
      requestId: context.requestId,
    });
    return toCertificateView(created);
  });
}

export async function revokeCertificate(
  account: AccountContext,
  certificateId: string,
  raw: unknown,
  context: WriteContext = {},
): Promise<CertificateView> {
  const input = z
    .object({
      reason: z.string().trim().min(3, "Give a reason of at least 3 characters.").max(500),
    })
    .parse(raw);

  const db = getDb();
  const existing = await db.certificate.findFirst({
    where: { id: certificateId, tenantId: tenantIdOf(account) },
  });
  if (!existing) throw new ResourceNotFoundError();
  await requireCertificateManagement(account, existing.courseOfferingId, db);
  if (existing.status !== "ISSUED") {
    throw new ConflictError("Only a current certificate can be revoked.");
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.certificate.update({
      where: { id: existing.id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedByUserId: account.user.id,
        revocationReason: input.reason,
      },
    });
    await recordAuditEvent(tx, {
      tenantId: existing.tenantId,
      actorUserId: account.user.id,
      action: "certificate.revoked",
      resourceType: "certificate",
      resourceId: updated.id,
      before: { status: existing.status },
      after: { status: updated.status, certificateNumber: updated.certificateNumber },
      reason: input.reason,
      requestId: context.requestId,
    });
    return toCertificateView(updated);
  });
}

// ---------------------------------------------------------------------------
// Learner views
// ---------------------------------------------------------------------------

export type LearnerCertificate = CertificateView & {
  verificationPath: string;
};

function toLearnerCertificate(certificate: CertificateView): LearnerCertificate {
  return { ...certificate, verificationPath: `/verify/${certificate.verificationToken}` };
}

export async function listLearnerCertificates(
  account: AccountContext,
): Promise<LearnerCertificate[]> {
  const tenantId = tenantIdOf(account);
  const rows = await getDb().certificate.findMany({
    where: { tenantId, userId: account.user.id },
    orderBy: { issuedAt: "desc" },
  });
  return rows.map((row) => toLearnerCertificate(toCertificateView(row)));
}

export type LearnerCompletionCard = {
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  termName: string;
  facts: CompletionFacts;
  evaluation: CompletionEvaluation;
  certificate: LearnerCertificate | null;
};

/** Completion indicators for a learner's own enrolments, with the live award. */
export async function listLearnerCompletion(
  account: AccountContext,
): Promise<LearnerCompletionCard[]> {
  const tenantId = tenantIdOf(account);
  const db = getDb();
  const enrolments = await db.enrolment.findMany({
    where: { tenantId, userId: account.user.id, status: { in: ["ACTIVE", "COMPLETED"] } },
    orderBy: { createdAt: "asc" },
    select: {
      courseOfferingId: true,
      offering: {
        select: {
          settings: true,
          course: { select: { code: true, title: true } },
          term: { select: { name: true } },
        },
      },
    },
  });

  const cards: LearnerCompletionCard[] = [];
  for (const enrolment of enrolments) {
    const settings =
      enrolment.offering.settings &&
      typeof enrolment.offering.settings === "object" &&
      !Array.isArray(enrolment.offering.settings)
        ? (enrolment.offering.settings as Record<string, unknown>)
        : {};
    const rules = parseCompletionRules(settings.completion);
    const facts = await completionFacts(db, tenantId, enrolment.courseOfferingId, account.user.id);
    const certificate = await db.certificate.findFirst({
      where: {
        tenantId,
        courseOfferingId: enrolment.courseOfferingId,
        userId: account.user.id,
        status: "ISSUED",
      },
    });
    cards.push({
      offeringId: enrolment.courseOfferingId,
      courseCode: enrolment.offering.course.code,
      courseTitle: enrolment.offering.course.title,
      termName: enrolment.offering.term.name,
      facts,
      evaluation: evaluateCompletion(facts, rules),
      certificate: certificate ? toLearnerCertificate(toCertificateView(certificate)) : null,
    });
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Public verification
// ---------------------------------------------------------------------------

export type CertificateVerification = {
  certificateNumber: string;
  learnerName: string;
  courseCode: string;
  courseTitle: string;
  institutionName: string;
  issuerName: string;
  issuedAt: Date;
  status: "ISSUED" | "REISSUED" | "REVOKED";
  revokedAt: Date | null;
};

/**
 * Public lookup by token. Returns null for an unknown token so the page can 404
 * without confirming anything. Only the minimum fields are returned: no email,
 * no grade, and no revocation reason.
 */
export async function verifyCertificate(token: string): Promise<CertificateVerification | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const row = await getDb().certificate.findUnique({
    where: { verificationToken: trimmed },
    select: {
      certificateNumber: true,
      learnerName: true,
      courseCode: true,
      courseTitle: true,
      institutionName: true,
      issuerName: true,
      issuedAt: true,
      status: true,
      revokedAt: true,
    },
  });
  if (!row) return null;
  return row;
}
