import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { recordAuditEvent } from "@/lib/audit/events";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { ConflictError, ResourceNotFoundError, TenantSelectionRequiredError } from "@/lib/errors";

import { CsvParseError, parseCsv, type CsvRow } from "./csv";

/**
 * CSV imports for people, enrolments, and instructor assignments.
 *
 * Preview parses and validates every row without writing domain data, and
 * stores the outcome so the report is reproducible. Commit applies only VALID
 * rows and is idempotent for the same identifiers: users are keyed by email,
 * memberships by (tenant, user), enrolments and instructors by
 * (offering, user). Re-running a corrected file therefore cannot create
 * uncontrolled duplicates.
 */

export type ImportKind = "USERS" | "ENROLMENTS" | "INSTRUCTORS";

const IMPORT_CONFIG = {
  USERS: {
    required: ["email", "name", "role"],
    optional: ["institutional_id"],
    permission: "users.import" as const,
    description: "People (students and faculty)",
  },
  ENROLMENTS: {
    required: ["email", "course_code", "term", "academic_year"],
    optional: ["section"],
    permission: "enrolments.manage" as const,
    description: "Learner enrolments",
  },
  INSTRUCTORS: {
    required: ["email", "course_code", "term", "academic_year"],
    optional: ["role", "section"],
    permission: "enrolments.manage" as const,
    description: "Course instructor assignments",
  },
} satisfies Record<
  ImportKind,
  {
    required: readonly string[];
    optional: readonly string[];
    permission: "users.import" | "enrolments.manage";
    description: string;
  }
>;

export const importKindSchema = z.enum(["USERS", "ENROLMENTS", "INSTRUCTORS"]);

export function importTemplate(kind: ImportKind): string {
  if (kind === "USERS") {
    return "email,name,role,institutional_id\nnew.student@example.edu,New Student,student,STU-1001\nnew.faculty@example.edu,New Faculty,faculty,EMP-2001\n";
  }
  if (kind === "INSTRUCTORS") {
    return "email,course_code,term,academic_year,section,role\nfaculty@example.edu,CS101,Semester 1,2026/27,A,primary\n";
  }
  return "email,course_code,term,academic_year,section\nstudent@example.edu,CS101,Semester 1,2026/27,A\n";
}

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

function requireImportPermission(account: AccountContext, kind: ImportKind): void {
  requirePermission(account, IMPORT_CONFIG[kind].permission);
}

function canViewImports(account: AccountContext): boolean {
  return account.permissions.has("users.import") || account.permissions.has("enrolments.manage");
}

async function createJobWithError(
  db: DatabaseClient,
  input: { tenantId: string; userId: string; kind: ImportKind; fileName: string; error: string },
): Promise<{ id: string; error: string }> {
  const job = await db.importJob.create({
    data: {
      tenantId: input.tenantId,
      kind: input.kind,
      status: "FAILED",
      fileName: input.fileName,
      createdByUserId: input.userId,
      error: input.error,
    },
    select: { id: true },
  });
  return { id: job.id, error: input.error };
}

type UserRowData = {
  email: string;
  name: string;
  roleKey: "student" | "faculty";
  roleId: string;
  institutionalId: string | null;
};

type EnrolmentRowData = {
  email: string;
  offeringId: string;
  offeringLabel: string;
};

type InstructorRowData = {
  email: string;
  offeringId: string;
  offeringLabel: string;
  role: "PRIMARY" | "CO_INSTRUCTOR" | "TEACHING_ASSISTANT";
};

type RowValidation =
  | {
      status: "VALID";
      identifier: string;
      data: UserRowData | EnrolmentRowData | InstructorRowData;
    }
  | { status: "INVALID"; identifier: string; message: string };

function emailOf(row: CsvRow): string {
  return (row.values.email ?? "").trim().toLowerCase();
}

function describeCsvError(error: unknown): string {
  if (error instanceof CsvParseError) return error.message;
  return "The file could not be read as CSV.";
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export type PreviewResult = {
  id: string;
  status: "PREVIEW" | "FAILED";
  totalRows: number;
  validRows: number;
  invalidRows: number;
  error: string | null;
};

export async function previewImport(
  account: AccountContext,
  input: { kind: ImportKind; fileName: string; csvText: string },
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<PreviewResult> {
  const kind = importKindSchema.parse(input.kind);
  requireImportPermission(account, kind);
  const tenantId = tenantIdOf(account);
  const fileName = input.fileName.trim().slice(0, 200) || "upload.csv";

  let parsed;
  try {
    parsed = parseCsv(input.csvText);
  } catch (error) {
    const job = await createJobWithError(db, {
      tenantId,
      userId: account.user.id,
      kind,
      fileName,
      error: describeCsvError(error),
    });
    return { ...job, status: "FAILED", totalRows: 0, validRows: 0, invalidRows: 0 };
  }

  const config = IMPORT_CONFIG[kind];
  const allowedHeaders = new Set([...config.required, ...config.optional]);
  const missing = config.required.filter((header) => !parsed.headers.includes(header));
  const unexpected = parsed.headers.filter((header) => !allowedHeaders.has(header));
  if (missing.length > 0 || unexpected.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`Missing required column(s): ${missing.join(", ")}.`);
    if (unexpected.length > 0) parts.push(`Unexpected column(s): ${unexpected.join(", ")}.`);
    parts.push(`Expected: ${parsed.headers.length > 0 ? [...allowedHeaders].join(", ") : "—"}.`);
    const job = await createJobWithError(db, {
      tenantId,
      userId: account.user.id,
      kind,
      fileName,
      error: parts.join(" "),
    });
    const rows = 0;
    return { ...job, status: "FAILED", totalRows: rows, validRows: 0, invalidRows: 0 };
  }

  const validations =
    kind === "USERS"
      ? await validateUserRows(account, parsed.rows, db)
      : await validateOfferingRows(account, kind, parsed.rows, db);

  const validRows = validations.filter((row) => row.status === "VALID").length;
  const invalidRows = validations.length - validRows;

  const job = await db.$transaction(async (tx) => {
    const created = await tx.importJob.create({
      data: {
        tenantId,
        kind,
        status: "PREVIEW",
        fileName,
        createdByUserId: account.user.id,
        totalRows: validations.length,
        validRows,
        invalidRows,
        summary: { checkedAt: new Date().toISOString() },
      },
      select: { id: true },
    });

    // Rows are inserted one by one; the table is small (max 2000) and this
    // keeps the stored JSON typed and the line numbers exact.
    for (const [index, row] of parsed.rows.entries()) {
      const validation = validations[index];
      if (!validation) continue;
      await tx.importRow.create({
        data: {
          importJobId: created.id,
          rowNumber: row.rowNumber,
          status: validation.status,
          identifier: validation.identifier || null,
          message: validation.status === "INVALID" ? validation.message : null,
          data:
            validation.status === "VALID"
              ? { ...validation.data, rowNumber: row.rowNumber }
              : { rowNumber: row.rowNumber, values: row.values },
        },
      });
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "import.previewed",
      resourceType: "import_job",
      resourceId: created.id,
      after: { kind, fileName, totalRows: validations.length, validRows, invalidRows },
      requestId: context.requestId,
    });

    return created;
  });

  return {
    id: job.id,
    status: "PREVIEW",
    totalRows: validations.length,
    validRows,
    invalidRows,
    error: null,
  };
}

async function validateUserRows(
  account: AccountContext,
  rows: CsvRow[],
  db: DatabaseClient,
): Promise<RowValidation[]> {
  const tenantId = tenantIdOf(account);

  const [roles, memberships] = await Promise.all([
    db.role.findMany({
      where: { tenantId, key: { in: ["student", "faculty"] } },
      select: { id: true, key: true },
    }),
    db.tenantMembership.findMany({
      where: { tenantId },
      select: {
        institutionalId: true,
        user: { select: { email: true, status: true } },
      },
    }),
  ]);

  const roleByKey = new Map(roles.map((role) => [role.key, role.id]));
  const accountStatusByEmail = new Map(
    memberships.map((membership) => [membership.user.email, membership.user.status]),
  );
  const institutionalOwner = new Map(
    memberships
      .filter((membership) => membership.institutionalId)
      .map((membership) => [membership.institutionalId as string, membership.user.email]),
  );

  const seenEmails = new Map<string, number>();
  const seenInstitutionalIds = new Map<string, number>();

  return rows.map((row) => {
    const identifier = emailOf(row);
    if (row.malformed) {
      return { status: "INVALID", identifier, message: row.malformed };
    }

    const email = emailOf(row);
    if (!z.string().email().safeParse(email).success) {
      return { status: "INVALID", identifier, message: "Enter a valid email address." };
    }
    if (seenEmails.has(email)) {
      return {
        status: "INVALID",
        identifier,
        message: `Duplicate email in this file (also on row ${seenEmails.get(email)}).`,
      };
    }
    seenEmails.set(email, row.rowNumber);

    const name = (row.values.name ?? "").trim();
    if (name.length < 2 || name.length > 120) {
      return { status: "INVALID", identifier, message: "Name must be 2–120 characters." };
    }

    const roleKey = (row.values.role ?? "").trim().toLowerCase();
    if (roleKey !== "student" && roleKey !== "faculty") {
      return { status: "INVALID", identifier, message: 'Role must be "student" or "faculty".' };
    }
    const roleId = roleByKey.get(roleKey);
    if (!roleId) {
      return {
        status: "INVALID",
        identifier,
        message: `The ${roleKey} role is not configured in this institution.`,
      };
    }

    const institutionalId = (row.values.institutional_id ?? "").trim();
    if (institutionalId) {
      if (!/^[A-Za-z0-9-]{1,32}$/.test(institutionalId)) {
        return {
          status: "INVALID",
          identifier,
          message: "Institutional ID must be 1–32 letters, digits, or hyphens.",
        };
      }
      if (seenInstitutionalIds.has(institutionalId)) {
        return {
          status: "INVALID",
          identifier,
          message: `Duplicate institutional ID in this file (also on row ${seenInstitutionalIds.get(institutionalId)}).`,
        };
      }
      seenInstitutionalIds.set(institutionalId, row.rowNumber);

      const owner = institutionalOwner.get(institutionalId);
      if (owner && owner !== email) {
        return {
          status: "INVALID",
          identifier,
          message: `Institutional ID ${institutionalId} already belongs to another member.`,
        };
      }
    }

    const accountStatus = accountStatusByEmail.get(email);
    if (accountStatus && accountStatus !== "ACTIVE") {
      return {
        status: "INVALID",
        identifier,
        message: "This account is deactivated. Reactivate it before importing.",
      };
    }

    return {
      status: "VALID",
      identifier,
      data: {
        email,
        name,
        roleKey,
        roleId,
        institutionalId: institutionalId || null,
      },
    };
  });
}

type OfferingContext = {
  courses: Map<string, { id: string; code: string }>;
  years: Map<string, { id: string; name: string }>;
  terms: Array<{ id: string; name: string; academicYearId: string }>;
  sections: Array<{ id: string; name: string }>;
  offerings: Array<{ id: string; courseId: string; termId: string; sectionId: string | null }>;
  members: Map<string, { userId: string; active: boolean }>;
};

async function loadOfferingContext(
  account: AccountContext,
  emails: string[],
  db: DatabaseClient,
): Promise<OfferingContext> {
  const tenantId = tenantIdOf(account);
  const [courses, years, terms, sections, offerings, memberships] = await Promise.all([
    db.course.findMany({ where: { tenantId }, select: { id: true, code: true } }),
    db.academicYear.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    db.term.findMany({
      where: { tenantId },
      select: { id: true, name: true, academicYearId: true },
    }),
    db.section.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    db.courseOffering.findMany({
      where: { tenantId },
      select: { id: true, courseId: true, termId: true, sectionId: true },
    }),
    db.tenantMembership.findMany({
      where: { tenantId, user: { email: { in: emails.length > 0 ? emails : ["\u0000"] } } },
      select: { status: true, user: { select: { id: true, email: true, status: true } } },
    }),
  ]);

  return {
    courses: new Map(courses.map((course) => [course.code.toUpperCase(), course])),
    years: new Map(years.map((year) => [year.name.toLowerCase(), year])),
    terms,
    sections,
    offerings,
    members: new Map(
      memberships.map((membership) => [
        membership.user.email,
        {
          userId: membership.user.id,
          active: membership.status === "ACTIVE" && membership.user.status === "ACTIVE",
        },
      ]),
    ),
  };
}

function resolveOffering(
  ctx: OfferingContext,
  row: CsvRow,
): { ok: true; offeringId: string; label: string } | { ok: false; message: string } {
  const courseCode = (row.values.course_code ?? "").trim().toUpperCase();
  const yearName = (row.values.academic_year ?? "").trim().toLowerCase();
  const termName = (row.values.term ?? "").trim().toLowerCase();
  const sectionName = (row.values.section ?? "").trim().toLowerCase();

  const course = ctx.courses.get(courseCode);
  if (!course)
    return { ok: false, message: `Course ${courseCode || "(blank)"} is not in the catalogue.` };

  const year = ctx.years.get(yearName);
  if (!year)
    return {
      ok: false,
      message: `Academic year ${row.values.academic_year || "(blank)"} was not found.`,
    };

  const matchingTerms = ctx.terms.filter(
    (term) => term.academicYearId === year.id && term.name.toLowerCase() === termName,
  );
  if (matchingTerms.length !== 1) {
    return {
      ok: false,
      message:
        matchingTerms.length === 0
          ? `Term ${row.values.term || "(blank)"} was not found in ${year.name}.`
          : `Term name "${row.values.term}" is ambiguous in ${year.name}.`,
    };
  }
  const term = matchingTerms[0];
  if (!term) return { ok: false, message: "Term could not be resolved." };

  let sectionId: string | null = null;
  if (sectionName) {
    const matchingSections = ctx.sections.filter(
      (section) => section.name.toLowerCase() === sectionName,
    );
    if (matchingSections.length !== 1) {
      return {
        ok: false,
        message:
          matchingSections.length === 0
            ? `Section ${row.values.section} was not found.`
            : `Section name "${row.values.section}" is ambiguous. Add the section to the cohort or use a unique name.`,
      };
    }
    sectionId = matchingSections[0]?.id ?? null;
  }

  const offering = ctx.offerings.find(
    (candidate) =>
      candidate.courseId === course.id &&
      candidate.termId === term.id &&
      candidate.sectionId === sectionId,
  );
  if (!offering) {
    return {
      ok: false,
      message: `No offering of ${courseCode} exists in ${year.name} · ${term.name}${sectionName ? ` · section ${row.values.section}` : ""}. Create it first.`,
    };
  }

  return {
    ok: true,
    offeringId: offering.id,
    label: `${courseCode} · ${year.name} · ${term.name}${sectionName ? ` · ${row.values.section}` : ""}`,
  };
}

async function validateOfferingRows(
  account: AccountContext,
  kind: "ENROLMENTS" | "INSTRUCTORS",
  rows: CsvRow[],
  db: DatabaseClient,
): Promise<RowValidation[]> {
  const ctx = await loadOfferingContext(
    account,
    [...new Set(rows.map((row) => emailOf(row)).filter(Boolean))],
    db,
  );
  const seenPairs = new Map<string, number>();

  return rows.map((row) => {
    const identifier = `${emailOf(row)} → ${(row.values.course_code ?? "").trim().toUpperCase()}`;
    if (row.malformed) {
      return { status: "INVALID", identifier, message: row.malformed };
    }

    const email = emailOf(row);
    if (!z.string().email().safeParse(email).success) {
      return { status: "INVALID", identifier, message: "Enter a valid email address." };
    }

    const member = ctx.members.get(email);
    if (!member) {
      return {
        status: "INVALID",
        identifier,
        message: "No member of this institution has that email address. Import the person first.",
      };
    }
    if (!member.active) {
      return {
        status: "INVALID",
        identifier,
        message: "That member is not active in this institution.",
      };
    }

    const offering = resolveOffering(ctx, row);
    if (!offering.ok) {
      return { status: "INVALID", identifier, message: offering.message };
    }

    const pairKey = `${offering.offeringId}:${email}`;
    if (seenPairs.has(pairKey)) {
      return {
        status: "INVALID",
        identifier,
        message: `Duplicate row in this file (also on row ${seenPairs.get(pairKey)}).`,
      };
    }
    seenPairs.set(pairKey, row.rowNumber);

    if (kind === "ENROLMENTS") {
      const data: EnrolmentRowData = {
        email,
        offeringId: offering.offeringId,
        offeringLabel: offering.label,
      };
      return { status: "VALID", identifier, data };
    }

    const roleValue = (row.values.role ?? "").trim().toLowerCase();
    const role =
      roleValue === "" || roleValue === "primary"
        ? "PRIMARY"
        : roleValue === "co_instructor" || roleValue === "co-instructor"
          ? "CO_INSTRUCTOR"
          : roleValue === "teaching_assistant" || roleValue === "teaching-assistant"
            ? "TEACHING_ASSISTANT"
            : null;
    if (!role) {
      return {
        status: "INVALID",
        identifier,
        message: 'Role must be "primary", "co_instructor", or "teaching_assistant".',
      };
    }

    const data: InstructorRowData = {
      email,
      offeringId: offering.offeringId,
      offeringLabel: offering.label,
      role,
    };
    return { status: "VALID", identifier, data };
  });
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export type CommitResult = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
};

export async function commitImport(
  account: AccountContext,
  jobId: string,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<CommitResult> {
  if (!canViewImports(account)) {
    requirePermission(account, "enrolments.manage");
  }
  const tenantId = tenantIdOf(account);

  const job = await db.importJob.findFirst({
    where: { id: jobId, tenantId },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  if (!job) throw new ResourceNotFoundError();
  requireImportPermission(account, job.kind);
  if (job.status === "COMMITTED") throw new ConflictError("This import was already committed.");
  if (job.status === "FAILED")
    throw new ConflictError("This import failed validation and cannot be committed.");

  const validRows = job.rows.filter((row) => row.status === "VALID");
  const result: CommitResult = { created: 0, updated: 0, skipped: 0, failed: 0 };

  // Rows removed from the source data are marked FAILED rather than aborting
  // the whole commit; valid rows still get applied.
  const applied: typeof job.rows = [];
  for (const row of validRows) {
    const resolved = await resolveRowForCommit(account, job.kind, row.data, db);
    if (!resolved.ok) {
      await db.importRow.update({
        where: { id: row.id },
        data: { status: "FAILED", message: resolved.message },
      });
      result.failed += 1;
      continue;
    }
    applied.push(row);
  }

  if (applied.length > 0) {
    await db.$transaction(async (tx) => {
      for (const row of applied) {
        const outcome = await applyRow(account, tx, job.kind, row.id, row.data);
        if (outcome === "CREATED") result.created += 1;
        else if (outcome === "UPDATED") result.updated += 1;
        else result.skipped += 1;
      }

      await tx.importJob.update({
        where: { id: job.id },
        data: {
          status: "COMMITTED",
          committedAt: new Date(),
          validRows: result.created + result.updated,
          invalidRows: job.rows.filter((row) => row.status === "INVALID").length + result.failed,
          summary: {
            checkedAt: (job.summary as { checkedAt?: string } | null)?.checkedAt ?? null,
            committed: { ...result },
          },
        },
      });

      await recordAuditEvent(tx, {
        tenantId,
        actorUserId: account.user.id,
        action: "import.committed",
        resourceType: "import_job",
        resourceId: job.id,
        after: { kind: job.kind, fileName: job.fileName, ...result },
        requestId: context.requestId,
      });
    });
  } else {
    // Nothing applied (for example every reference disappeared). The job stays
    // in preview so the operator can fix the source and re-upload.
    result.failed = validRows.length;
  }

  return result;
}

type ResolvedRow = { ok: true } | { ok: false; message: string };

async function resolveRowForCommit(
  account: AccountContext,
  kind: ImportKind,
  data: unknown,
  db: DatabaseClient,
): Promise<ResolvedRow> {
  const tenantId = tenantIdOf(account);
  const values = data as Record<string, unknown>;

  if (kind === "USERS") {
    const email = typeof values.email === "string" ? values.email : "";
    const roleId = typeof values.roleId === "string" ? values.roleId : "";
    const role = await db.role.findFirst({ where: { id: roleId, tenantId }, select: { id: true } });
    if (!role) return { ok: false, message: "The role no longer exists in this institution." };

    const user = await db.user.findUnique({ where: { email }, select: { status: true } });
    if (user && user.status !== "ACTIVE") {
      return { ok: false, message: "This account is deactivated." };
    }
    return { ok: true };
  }

  const offeringId = typeof values.offeringId === "string" ? values.offeringId : "";
  const email = typeof values.email === "string" ? values.email : "";
  const offering = await db.courseOffering.findFirst({
    where: { id: offeringId, tenantId },
    select: { id: true, section: { select: { capacity: true } } },
  });
  if (!offering) return { ok: false, message: "The course offering no longer exists." };

  const membership = await db.tenantMembership.findFirst({
    where: { tenantId, status: "ACTIVE", user: { email, status: "ACTIVE" } },
    select: { userId: true },
  });
  if (!membership) return { ok: false, message: "The person is no longer an active member." };

  if (kind === "ENROLMENTS") {
    const existing = await db.enrolment.findUnique({
      where: {
        courseOfferingId_userId: {
          courseOfferingId: offering.id,
          userId: membership.userId,
        },
      },
      select: { status: true },
    });
    const activeCount = await db.enrolment.count({
      where: { courseOfferingId: offering.id, status: "ACTIVE" },
    });
    if (
      existing?.status !== "ACTIVE" &&
      offering.section?.capacity !== null &&
      offering.section?.capacity !== undefined &&
      activeCount >= offering.section.capacity
    ) {
      return { ok: false, message: "The section is at capacity." };
    }
  }

  return { ok: true };
}

type Tx = Prisma.TransactionClient;

async function applyRow(
  account: AccountContext,
  tx: Tx,
  kind: ImportKind,
  rowId: string,
  data: unknown,
): Promise<"CREATED" | "UPDATED" | "SKIPPED"> {
  const tenantId = tenantIdOf(account);
  const values = data as Record<string, unknown>;

  if (kind === "USERS") {
    const email = String(values.email);
    const name = String(values.name);
    const roleKey = String(values.roleKey);
    const roleId = String(values.roleId);
    const institutionalId =
      typeof values.institutionalId === "string" ? values.institutionalId : null;

    const existingUser = await tx.user.findUnique({ where: { email }, select: { id: true } });
    const user =
      existingUser ??
      (await tx.user.create({
        data: { email, name, status: "ACTIVE", emailVerified: true },
        select: { id: true },
      }));

    await tx.tenantMembership.upsert({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      update: {
        status: "ACTIVE",
        // A blank cell must not erase an existing student/staff number.
        ...(institutionalId ? { institutionalId } : {}),
      },
      create: {
        tenantId,
        userId: user.id,
        status: "ACTIVE",
        institutionalId,
        joinedAt: new Date(),
      },
    });

    const existingRole = await tx.userRoleAssignment.findFirst({
      where: { tenantId, userId: user.id, roleId },
      select: { id: true },
    });
    if (!existingRole) {
      await tx.userRoleAssignment.create({
        data: {
          tenantId,
          userId: user.id,
          roleId,
          scopeType: "TENANT",
          grantedByUserId: account.user.id,
        },
      });
    }

    const status = existingUser ? "UPDATED" : "CREATED";
    await tx.importRow.update({ where: { id: rowId }, data: { status } });
    return status;
  }

  const offeringId = String(values.offeringId);
  const email = String(values.email);
  const membership = await tx.tenantMembership.findFirstOrThrow({
    where: { tenantId, status: "ACTIVE", user: { email, status: "ACTIVE" } },
    select: { userId: true },
  });

  if (kind === "ENROLMENTS") {
    const existing = await tx.enrolment.findUnique({
      where: {
        courseOfferingId_userId: {
          courseOfferingId: offeringId,
          userId: membership.userId,
        },
      },
      select: { id: true, status: true },
    });

    if (existing?.status === "ACTIVE") {
      await tx.importRow.update({ where: { id: rowId }, data: { status: "SKIPPED" } });
      return "SKIPPED";
    }

    if (existing) {
      await tx.enrolment.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", source: "IMPORT", enrolledAt: new Date() },
      });
      await tx.importRow.update({ where: { id: rowId }, data: { status: "UPDATED" } });
      return "UPDATED";
    }

    await tx.enrolment.create({
      data: {
        tenantId,
        courseOfferingId: offeringId,
        userId: membership.userId,
        status: "ACTIVE",
        source: "IMPORT",
      },
    });
    await tx.importRow.update({ where: { id: rowId }, data: { status: "CREATED" } });
    return "CREATED";
  }

  const assignmentRole = String(values.role) as "PRIMARY" | "CO_INSTRUCTOR" | "TEACHING_ASSISTANT";
  const existing = await tx.courseInstructor.findUnique({
    where: {
      courseOfferingId_userId: {
        courseOfferingId: offeringId,
        userId: membership.userId,
      },
    },
    select: { id: true, assignmentRole: true },
  });

  if (existing) {
    if (existing.assignmentRole === assignmentRole) {
      await tx.importRow.update({ where: { id: rowId }, data: { status: "SKIPPED" } });
      return "SKIPPED";
    }
    await tx.courseInstructor.update({
      where: { id: existing.id },
      data: { assignmentRole },
    });
    await tx.importRow.update({ where: { id: rowId }, data: { status: "UPDATED" } });
    return "UPDATED";
  }

  await tx.courseInstructor.create({
    data: {
      tenantId,
      courseOfferingId: offeringId,
      userId: membership.userId,
      assignmentRole,
    },
  });
  await tx.importRow.update({ where: { id: rowId }, data: { status: "CREATED" } });
  return "CREATED";
}

// ---------------------------------------------------------------------------
// History and reports
// ---------------------------------------------------------------------------

export type ImportJobSummary = {
  id: string;
  kind: ImportKind;
  status: "PREVIEW" | "COMMITTED" | "FAILED";
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  error: string | null;
  committedAt: Date | null;
  createdAt: Date;
  createdByName: string | null;
};

export async function listImportJobs(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<ImportJobSummary[]> {
  if (!canViewImports(account)) {
    requirePermission(account, "enrolments.manage");
  }
  const jobs = await db.importJob.findMany({
    where: { tenantId: tenantIdOf(account) },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      kind: true,
      status: true,
      fileName: true,
      totalRows: true,
      validRows: true,
      invalidRows: true,
      error: true,
      committedAt: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });
  return jobs.map((job) => ({
    id: job.id,
    kind: job.kind,
    status: job.status,
    fileName: job.fileName,
    totalRows: job.totalRows,
    validRows: job.validRows,
    invalidRows: job.invalidRows,
    error: job.error,
    committedAt: job.committedAt,
    createdAt: job.createdAt,
    createdByName: job.createdBy?.name ?? null,
  }));
}

export async function getImportJob(
  account: AccountContext,
  jobId: string,
  db: DatabaseClient = getDb(),
) {
  if (!canViewImports(account)) {
    requirePermission(account, "enrolments.manage");
  }
  const job = await db.importJob.findFirst({
    where: { id: jobId, tenantId: tenantIdOf(account) },
    include: {
      rows: { orderBy: { rowNumber: "asc" } },
      createdBy: { select: { name: true } },
    },
  });
  if (!job) throw new ResourceNotFoundError();
  return job;
}

/** RFC 4180-correct CSV for the downloadable row report. */
export function importReportCsv(job: {
  fileName: string;
  kind: ImportKind;
  rows: Array<{
    rowNumber: number;
    status: string;
    identifier: string | null;
    message: string | null;
  }>;
}): string {
  const escape = (value: string) =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = [["row", "status", "identifier", "message"].join(",")];
  for (const row of job.rows) {
    lines.push(
      [String(row.rowNumber), row.status.toLowerCase(), row.identifier ?? "", row.message ?? ""]
        .map(escape)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
