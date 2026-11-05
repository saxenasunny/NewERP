import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { ConflictError, ResourceNotFoundError, TenantSelectionRequiredError } from "@/lib/errors";

/**
 * Academic structure: years, terms, departments, programmes, cohorts, sections,
 * and cohort membership.
 *
 * Every read and write is scoped to the actor's active institution; a valid ID
 * from another tenant is reported as missing. Mutations validate input, write
 * the change and its audit event in one transaction, and rely on database
 * uniqueness for codes and names.
 */

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2002" || code === "23505";
}

async function guardUnique<T>(work: () => Promise<T>, message: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(message);
    throw error;
  }
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const optionalIsoDate = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  isoDate.optional(),
);

const code = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(32, "Use at most 32 characters.")
  .regex(/^[A-Za-z0-9._ -]+$/, "Use letters, digits, hyphens, periods, or underscores.")
  .transform((value) => value.toUpperCase().replace(/\s+/g, " "));

const name = z.string().trim().min(2, "Use at least 2 characters.").max(120);

const dateOrder = { message: "The end date must be after the start date." };

export const academicYearInputSchema = z
  .object({
    name,
    startsOn: isoDate,
    endsOn: isoDate,
  })
  .refine((value) => value.startsOn < value.endsOn, { ...dateOrder, path: ["endsOn"] });

export const termInputSchema = z
  .object({
    academicYearId: z.string().min(1, "Choose an academic year."),
    name,
    startsOn: isoDate,
    endsOn: isoDate,
  })
  .refine((value) => value.startsOn < value.endsOn, { ...dateOrder, path: ["endsOn"] });

export const departmentInputSchema = z.object({
  name,
  code,
  parentDepartmentId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().min(1).optional(),
  ),
});

export const programmeInputSchema = z.object({
  departmentId: z.string().min(1, "Choose a department."),
  name,
  code,
  level: z.enum(["CERTIFICATE", "DIPLOMA", "BACHELOR", "MASTER", "DOCTORATE", "OTHER"]),
});

export const cohortInputSchema = z.object({
  programmeId: z.string().min(1, "Choose a programme."),
  academicYearId: z.string().min(1, "Choose an academic year."),
  name,
});

export const sectionInputSchema = z.object({
  cohortId: z.string().min(1, "Choose a cohort."),
  // Section names are short labels such as "A", so the 2-character rule used
  // for entity names does not apply.
  name: z.string().trim().min(1, "Enter a section name.").max(60),
  capacity: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce
      .number()
      .int("Capacity must be a whole number.")
      .min(1, "Capacity must be at least 1.")
      .max(1000, "Capacity looks too large.")
      .optional(),
  ),
});

export const cohortMemberInputSchema = z.object({
  cohortId: z.string().min(1),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

export const academicYearStatusSchema = z.enum(["PLANNED", "ACTIVE", "ARCHIVED"]);
export const programmeStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

export type AcademicYearSummary = {
  id: string;
  name: string;
  startsOn: Date;
  endsOn: Date;
  status: "PLANNED" | "ACTIVE" | "ARCHIVED";
  terms: Array<{ id: string; name: string; startsOn: Date; endsOn: Date }>;
};

export type DepartmentSummary = {
  id: string;
  name: string;
  code: string;
  parentDepartmentId: string | null;
  parentName: string | null;
  programmeCount: number;
};

export type ProgrammeSummary = {
  id: string;
  name: string;
  code: string;
  level: string;
  status: "ACTIVE" | "ARCHIVED";
  departmentId: string;
  departmentName: string;
  cohortCount: number;
};

export type CohortSummary = {
  id: string;
  name: string;
  programmeId: string;
  programmeName: string;
  academicYearId: string;
  academicYearName: string;
  sectionCount: number;
  memberCount: number;
};

export type SectionSummary = {
  id: string;
  name: string;
  capacity: number | null;
  cohortId: string;
  cohortName: string;
  programmeName: string;
  offeringCount: number;
};

export type StructureOptions = {
  years: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  programmes: Array<{ id: string; name: string; code: string }>;
  cohorts: Array<{ id: string; name: string; programmeName: string }>;
  sections: Array<{ id: string; name: string; cohortName: string }>;
};

function jsonDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Academic years and terms
// ---------------------------------------------------------------------------

export async function listAcademicYears(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<AcademicYearSummary[]> {
  requirePermission(account, "academic_structure.manage");
  const years = await db.academicYear.findMany({
    where: { tenantId: tenantIdOf(account) },
    orderBy: [{ startsOn: "desc" }],
    select: {
      id: true,
      name: true,
      startsOn: true,
      endsOn: true,
      status: true,
      terms: {
        orderBy: { startsOn: "asc" },
        select: { id: true, name: true, startsOn: true, endsOn: true },
      },
    },
  });
  return years.map((year) => ({
    id: year.id,
    name: year.name,
    startsOn: year.startsOn,
    endsOn: year.endsOn,
    status: year.status,
    terms: year.terms,
  }));
}

export async function createAcademicYear(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "academic_structure.manage");
  const data = academicYearInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const year = await tx.academicYear.create({
          data: {
            tenantId,
            name: data.name,
            startsOn: data.startsOn,
            endsOn: data.endsOn,
            status: "PLANNED",
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "academic_year.created",
          resourceType: "academic_year",
          resourceId: year.id,
          after: {
            name: year.name,
            startsOn: jsonDate(year.startsOn),
            endsOn: jsonDate(year.endsOn),
          },
          requestId: context.requestId,
        });
        return { id: year.id };
      }),
    "An academic year with that name already exists.",
  );
}

export async function updateAcademicYear(
  account: AccountContext,
  academicYearId: string,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "academic_structure.manage");
  const data = academicYearInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const existing = await tx.academicYear.findFirst({
          where: { id: academicYearId, tenantId },
        });
        if (!existing) throw new ResourceNotFoundError();

        // Terms must remain inside the year. Refuse a shrink that would strand one.
        const stranded = await tx.term.findFirst({
          where: {
            academicYearId: existing.id,
            OR: [{ startsOn: { lt: data.startsOn } }, { endsOn: { gt: data.endsOn } }],
          },
          select: { name: true },
        });
        if (stranded) {
          throw new ConflictError(
            `Term "${stranded.name}" would fall outside the new dates. Adjust the term first.`,
          );
        }

        const updated = await tx.academicYear.update({
          where: { id: existing.id },
          data: { name: data.name, startsOn: data.startsOn, endsOn: data.endsOn },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "academic_year.updated",
          resourceType: "academic_year",
          resourceId: updated.id,
          before: {
            name: existing.name,
            startsOn: jsonDate(existing.startsOn),
            endsOn: jsonDate(existing.endsOn),
          },
          after: {
            name: updated.name,
            startsOn: jsonDate(updated.startsOn),
            endsOn: jsonDate(updated.endsOn),
          },
          requestId: context.requestId,
        });
        return { id: updated.id };
      }),
    "An academic year with that name already exists.",
  );
}

export async function setAcademicYearStatus(
  account: AccountContext,
  academicYearId: string,
  status: "PLANNED" | "ACTIVE" | "ARCHIVED",
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "academic_structure.manage");
  const next = academicYearStatusSchema.parse(status);
  const tenantId = tenantIdOf(account);

  await db.$transaction(async (tx) => {
    const existing = await tx.academicYear.findFirst({ where: { id: academicYearId, tenantId } });
    if (!existing) throw new ResourceNotFoundError();

    await tx.academicYear.update({ where: { id: existing.id }, data: { status: next } });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "academic_year.status_changed",
      resourceType: "academic_year",
      resourceId: existing.id,
      before: { status: existing.status },
      after: { status: next },
      requestId: context.requestId,
    });
  });
}

async function assertTermInsideYear(
  tx: Pick<DatabaseClient, "academicYear">,
  tenantId: string,
  academicYearId: string,
  startsOn: Date,
  endsOn: Date,
) {
  const year = await tx.academicYear.findFirst({
    where: { id: academicYearId, tenantId },
    select: { id: true, name: true, startsOn: true, endsOn: true },
  });
  if (!year) throw new ResourceNotFoundError("Academic year not found.");
  if (startsOn < year.startsOn || endsOn > year.endsOn) {
    throw new ConflictError(`The term must fall inside ${year.name}.`);
  }
  return year;
}

export async function createTerm(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "academic_structure.manage");
  const data = termInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        await assertTermInsideYear(tx, tenantId, data.academicYearId, data.startsOn, data.endsOn);
        const term = await tx.term.create({
          data: {
            tenantId,
            academicYearId: data.academicYearId,
            name: data.name,
            startsOn: data.startsOn,
            endsOn: data.endsOn,
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "term.created",
          resourceType: "term",
          resourceId: term.id,
          after: {
            name: term.name,
            startsOn: jsonDate(term.startsOn),
            endsOn: jsonDate(term.endsOn),
          },
          requestId: context.requestId,
        });
        return { id: term.id };
      }),
    "A term with that name already exists in this academic year.",
  );
}

export async function updateTerm(
  account: AccountContext,
  termId: string,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "academic_structure.manage");
  const data = termInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const existing = await tx.term.findFirst({ where: { id: termId, tenantId } });
        if (!existing) throw new ResourceNotFoundError();
        await assertTermInsideYear(tx, tenantId, data.academicYearId, data.startsOn, data.endsOn);

        const updated = await tx.term.update({
          where: { id: existing.id },
          data: {
            academicYearId: data.academicYearId,
            name: data.name,
            startsOn: data.startsOn,
            endsOn: data.endsOn,
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "term.updated",
          resourceType: "term",
          resourceId: updated.id,
          before: {
            name: existing.name,
            startsOn: jsonDate(existing.startsOn),
            endsOn: jsonDate(existing.endsOn),
          },
          after: {
            name: updated.name,
            startsOn: jsonDate(updated.startsOn),
            endsOn: jsonDate(updated.endsOn),
          },
          requestId: context.requestId,
        });
        return { id: updated.id };
      }),
    "A term with that name already exists in this academic year.",
  );
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export async function listDepartments(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<DepartmentSummary[]> {
  requirePermission(account, "academic_structure.manage");
  const departments = await db.department.findMany({
    where: { tenantId: tenantIdOf(account) },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      parentDepartmentId: true,
      parentDepartment: { select: { name: true } },
      _count: { select: { programmes: true } },
    },
  });
  return departments.map((department) => ({
    id: department.id,
    name: department.name,
    code: department.code,
    parentDepartmentId: department.parentDepartmentId,
    parentName: department.parentDepartment?.name ?? null,
    programmeCount: department._count.programmes,
  }));
}

async function assertDepartmentParent(
  tx: Pick<DatabaseClient, "department">,
  tenantId: string,
  departmentId: string | null,
  parentDepartmentId: string | undefined,
): Promise<void> {
  if (!parentDepartmentId) return;
  if (parentDepartmentId === departmentId) {
    throw new ConflictError("A department cannot be its own parent.");
  }

  let current: string | null | undefined = parentDepartmentId;
  const seen = new Set<string>();
  while (current) {
    if (current === departmentId) {
      throw new ConflictError("That parent would create a cycle in the department tree.");
    }
    if (seen.has(current)) break;
    seen.add(current);

    const parent: { id: string; parentDepartmentId: string | null } | null =
      await tx.department.findFirst({
        where: { id: current, tenantId },
        select: { id: true, parentDepartmentId: true },
      });
    if (!parent) throw new ResourceNotFoundError("Parent department not found.");
    current = parent.parentDepartmentId;
  }
}

export async function createDepartment(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "academic_structure.manage");
  const data = departmentInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        await assertDepartmentParent(tx, tenantId, null, data.parentDepartmentId);
        const department = await tx.department.create({
          data: {
            tenantId,
            name: data.name,
            code: data.code,
            parentDepartmentId: data.parentDepartmentId ?? null,
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "department.created",
          resourceType: "department",
          resourceId: department.id,
          after: { name: department.name, code: department.code },
          requestId: context.requestId,
        });
        return { id: department.id };
      }),
    "A department with that code already exists.",
  );
}

export async function updateDepartment(
  account: AccountContext,
  departmentId: string,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "academic_structure.manage");
  const data = departmentInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const existing = await tx.department.findFirst({ where: { id: departmentId, tenantId } });
        if (!existing) throw new ResourceNotFoundError();
        await assertDepartmentParent(tx, tenantId, existing.id, data.parentDepartmentId);

        const updated = await tx.department.update({
          where: { id: existing.id },
          data: {
            name: data.name,
            code: data.code,
            parentDepartmentId: data.parentDepartmentId ?? null,
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "department.updated",
          resourceType: "department",
          resourceId: updated.id,
          before: { name: existing.name, code: existing.code },
          after: { name: updated.name, code: updated.code },
          requestId: context.requestId,
        });
        return { id: updated.id };
      }),
    "A department with that code already exists.",
  );
}

// ---------------------------------------------------------------------------
// Programmes
// ---------------------------------------------------------------------------

export async function listProgrammes(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<ProgrammeSummary[]> {
  requirePermission(account, "academic_structure.manage");
  const programmes = await db.programme.findMany({
    where: { tenantId: tenantIdOf(account) },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      level: true,
      status: true,
      departmentId: true,
      department: { select: { name: true } },
      _count: { select: { cohorts: true } },
    },
  });
  return programmes.map((programme) => ({
    id: programme.id,
    name: programme.name,
    code: programme.code,
    level: programme.level,
    status: programme.status,
    departmentId: programme.departmentId,
    departmentName: programme.department.name,
    cohortCount: programme._count.cohorts,
  }));
}

export async function createProgramme(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "academic_structure.manage");
  const data = programmeInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const department = await tx.department.findFirst({
          where: { id: data.departmentId, tenantId },
          select: { id: true },
        });
        if (!department) throw new ResourceNotFoundError("Department not found.");

        const programme = await tx.programme.create({
          data: {
            tenantId,
            departmentId: data.departmentId,
            name: data.name,
            code: data.code,
            level: data.level,
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "programme.created",
          resourceType: "programme",
          resourceId: programme.id,
          after: { name: programme.name, code: programme.code, level: programme.level },
          requestId: context.requestId,
        });
        return { id: programme.id };
      }),
    "A programme with that code already exists.",
  );
}

export async function updateProgramme(
  account: AccountContext,
  programmeId: string,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "academic_structure.manage");
  const data = programmeInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const existing = await tx.programme.findFirst({ where: { id: programmeId, tenantId } });
        if (!existing) throw new ResourceNotFoundError();

        const department = await tx.department.findFirst({
          where: { id: data.departmentId, tenantId },
          select: { id: true },
        });
        if (!department) throw new ResourceNotFoundError("Department not found.");

        const updated = await tx.programme.update({
          where: { id: existing.id },
          data: {
            departmentId: data.departmentId,
            name: data.name,
            code: data.code,
            level: data.level,
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "programme.updated",
          resourceType: "programme",
          resourceId: updated.id,
          before: { name: existing.name, code: existing.code },
          after: { name: updated.name, code: updated.code },
          requestId: context.requestId,
        });
        return { id: updated.id };
      }),
    "A programme with that code already exists.",
  );
}

export async function setProgrammeStatus(
  account: AccountContext,
  programmeId: string,
  status: "ACTIVE" | "ARCHIVED",
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "academic_structure.manage");
  const next = programmeStatusSchema.parse(status);
  const tenantId = tenantIdOf(account);

  await db.$transaction(async (tx) => {
    const existing = await tx.programme.findFirst({ where: { id: programmeId, tenantId } });
    if (!existing) throw new ResourceNotFoundError();

    await tx.programme.update({ where: { id: existing.id }, data: { status: next } });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "programme.status_changed",
      resourceType: "programme",
      resourceId: existing.id,
      before: { status: existing.status },
      after: { status: next },
      requestId: context.requestId,
    });
  });
}

// ---------------------------------------------------------------------------
// Cohorts and sections
// ---------------------------------------------------------------------------

export async function listCohorts(
  account: AccountContext,
  filter: { programmeId?: string } = {},
  db: DatabaseClient = getDb(),
): Promise<CohortSummary[]> {
  requirePermission(account, "academic_structure.manage");
  const cohorts = await db.cohort.findMany({
    where: {
      tenantId: tenantIdOf(account),
      ...(filter.programmeId ? { programmeId: filter.programmeId } : {}),
    },
    orderBy: [{ academicYear: { startsOn: "desc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      programmeId: true,
      programme: { select: { name: true } },
      academicYearId: true,
      academicYear: { select: { name: true } },
      _count: { select: { sections: true, members: true } },
    },
  });
  return cohorts.map((cohort) => ({
    id: cohort.id,
    name: cohort.name,
    programmeId: cohort.programmeId,
    programmeName: cohort.programme.name,
    academicYearId: cohort.academicYearId,
    academicYearName: cohort.academicYear.name,
    sectionCount: cohort._count.sections,
    memberCount: cohort._count.members,
  }));
}

export async function createCohort(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "academic_structure.manage");
  const data = cohortInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const [programme, academicYear] = await Promise.all([
          tx.programme.findFirst({
            where: { id: data.programmeId, tenantId },
            select: { id: true },
          }),
          tx.academicYear.findFirst({
            where: { id: data.academicYearId, tenantId },
            select: { id: true },
          }),
        ]);
        if (!programme) throw new ResourceNotFoundError("Programme not found.");
        if (!academicYear) throw new ResourceNotFoundError("Academic year not found.");

        const cohort = await tx.cohort.create({
          data: {
            tenantId,
            programmeId: data.programmeId,
            academicYearId: data.academicYearId,
            name: data.name,
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "cohort.created",
          resourceType: "cohort",
          resourceId: cohort.id,
          after: { name: cohort.name },
          requestId: context.requestId,
        });
        return { id: cohort.id };
      }),
    "A cohort with that name already exists for this programme and year.",
  );
}

export async function updateCohort(
  account: AccountContext,
  cohortId: string,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "academic_structure.manage");
  const data = cohortInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const existing = await tx.cohort.findFirst({ where: { id: cohortId, tenantId } });
        if (!existing) throw new ResourceNotFoundError();

        const [programme, academicYear] = await Promise.all([
          tx.programme.findFirst({
            where: { id: data.programmeId, tenantId },
            select: { id: true },
          }),
          tx.academicYear.findFirst({
            where: { id: data.academicYearId, tenantId },
            select: { id: true },
          }),
        ]);
        if (!programme) throw new ResourceNotFoundError("Programme not found.");
        if (!academicYear) throw new ResourceNotFoundError("Academic year not found.");

        const updated = await tx.cohort.update({
          where: { id: existing.id },
          data: {
            programmeId: data.programmeId,
            academicYearId: data.academicYearId,
            name: data.name,
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "cohort.updated",
          resourceType: "cohort",
          resourceId: updated.id,
          before: { name: existing.name },
          after: { name: updated.name },
          requestId: context.requestId,
        });
        return { id: updated.id };
      }),
    "A cohort with that name already exists for this programme and year.",
  );
}

export async function listSections(
  account: AccountContext,
  filter: { cohortId?: string } = {},
  db: DatabaseClient = getDb(),
): Promise<SectionSummary[]> {
  requirePermission(account, "academic_structure.manage");
  const sections = await db.section.findMany({
    where: {
      tenantId: tenantIdOf(account),
      ...(filter.cohortId ? { cohortId: filter.cohortId } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      capacity: true,
      cohortId: true,
      cohort: { select: { name: true, programme: { select: { name: true } } } },
      _count: { select: { offerings: true } },
    },
  });
  return sections.map((section) => ({
    id: section.id,
    name: section.name,
    capacity: section.capacity,
    cohortId: section.cohortId,
    cohortName: section.cohort.name,
    programmeName: section.cohort.programme.name,
    offeringCount: section._count.offerings,
  }));
}

export async function createSection(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "academic_structure.manage");
  const data = sectionInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const cohort = await tx.cohort.findFirst({
          where: { id: data.cohortId, tenantId },
          select: { id: true },
        });
        if (!cohort) throw new ResourceNotFoundError("Cohort not found.");

        const section = await tx.section.create({
          data: {
            tenantId,
            cohortId: data.cohortId,
            name: data.name,
            capacity: data.capacity ?? null,
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "section.created",
          resourceType: "section",
          resourceId: section.id,
          after: { name: section.name, capacity: section.capacity },
          requestId: context.requestId,
        });
        return { id: section.id };
      }),
    "A section with that name already exists in this cohort.",
  );
}

export async function updateSection(
  account: AccountContext,
  sectionId: string,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "academic_structure.manage");
  const data = sectionInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const existing = await tx.section.findFirst({ where: { id: sectionId, tenantId } });
        if (!existing) throw new ResourceNotFoundError();

        const cohort = await tx.cohort.findFirst({
          where: { id: data.cohortId, tenantId },
          select: { id: true },
        });
        if (!cohort) throw new ResourceNotFoundError("Cohort not found.");

        const updated = await tx.section.update({
          where: { id: existing.id },
          data: { cohortId: data.cohortId, name: data.name, capacity: data.capacity ?? null },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "section.updated",
          resourceType: "section",
          resourceId: updated.id,
          before: { name: existing.name, capacity: existing.capacity },
          after: { name: updated.name, capacity: updated.capacity },
          requestId: context.requestId,
        });
        return { id: updated.id };
      }),
    "A section with that name already exists in this cohort.",
  );
}

// ---------------------------------------------------------------------------
// Cohort membership
// ---------------------------------------------------------------------------

export type CohortMemberSummary = {
  id: string;
  userId: string;
  name: string;
  email: string;
  institutionalId: string | null;
  createdAt: Date;
};

export async function listCohortMembers(
  account: AccountContext,
  cohortId: string,
  db: DatabaseClient = getDb(),
): Promise<CohortMemberSummary[]> {
  requirePermission(account, "academic_structure.manage");
  const tenantId = tenantIdOf(account);
  const cohort = await db.cohort.findFirst({
    where: { id: cohortId, tenantId },
    select: { id: true },
  });
  if (!cohort) throw new ResourceNotFoundError();

  const members = await db.cohortMember.findMany({
    where: { cohortId: cohort.id, tenantId },
    orderBy: { user: { name: "asc" } },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      user: {
        select: {
          name: true,
          email: true,
          memberships: {
            where: { tenantId },
            select: { institutionalId: true },
            take: 1,
          },
        },
      },
    },
  });

  return members.map((member) => ({
    id: member.id,
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
    institutionalId: member.user.memberships[0]?.institutionalId ?? null,
    createdAt: member.createdAt,
  }));
}

export async function addCohortMember(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "academic_structure.manage");
  const data = cohortMemberInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const cohort = await tx.cohort.findFirst({
          where: { id: data.cohortId, tenantId },
          select: { id: true, name: true },
        });
        if (!cohort) throw new ResourceNotFoundError("Cohort not found.");

        const membership = await tx.tenantMembership.findFirst({
          where: {
            tenantId,
            status: "ACTIVE",
            user: { email: data.email, status: "ACTIVE" },
          },
          select: { id: true, userId: true },
        });
        if (!membership) {
          throw new ResourceNotFoundError(
            "No active member of this institution has that email address.",
          );
        }

        const member = await tx.cohortMember.create({
          data: { tenantId, cohortId: cohort.id, userId: membership.userId },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "cohort.member_added",
          resourceType: "cohort",
          resourceId: cohort.id,
          after: { userId: membership.userId, email: data.email },
          requestId: context.requestId,
        });
        return { id: member.id };
      }),
    "That person is already in this cohort.",
  );
}

export async function removeCohortMember(
  account: AccountContext,
  cohortMemberId: string,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "academic_structure.manage");
  const tenantId = tenantIdOf(account);

  await db.$transaction(async (tx) => {
    const existing = await tx.cohortMember.findFirst({
      where: { id: cohortMemberId, tenantId },
      select: { id: true, cohortId: true, userId: true },
    });
    if (!existing) throw new ResourceNotFoundError();

    await tx.cohortMember.delete({ where: { id: existing.id } });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "cohort.member_removed",
      resourceType: "cohort",
      resourceId: existing.cohortId,
      before: { userId: existing.userId },
      requestId: context.requestId,
    });
  });
}

/** Tenant-scoped option lists for forms. */
export async function getStructureOptions(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<StructureOptions> {
  requirePermission(account, "academic_structure.manage");
  const tenantId = tenantIdOf(account);

  const [years, departments, programmes, cohorts, sections] = await Promise.all([
    db.academicYear.findMany({
      where: { tenantId },
      orderBy: { startsOn: "desc" },
      select: { id: true, name: true },
    }),
    db.department.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.programme.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    db.cohort.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, programme: { select: { name: true } } },
    }),
    db.section.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, cohort: { select: { name: true } } },
    }),
  ]);

  return {
    years,
    departments,
    programmes,
    cohorts: cohorts.map((cohort) => ({
      id: cohort.id,
      name: cohort.name,
      programmeName: cohort.programme.name,
    })),
    sections: sections.map((section) => ({
      id: section.id,
      name: section.name,
      cohortName: section.cohort.name,
    })),
  };
}
