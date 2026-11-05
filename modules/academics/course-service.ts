import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit/events";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import { ConflictError, ResourceNotFoundError, TenantSelectionRequiredError } from "@/lib/errors";

/**
 * Course catalogue and course offerings.
 *
 * A catalogue `Course` is the institution's description of a course (code,
 * credits, status). A `CourseOffering` schedules that course in a term, attaches
 * an optional section, and owns instructors and enrolments. Learners are never
 * enrolled into a catalogue entry.
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

const codeSchema = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(32, "Use at most 32 characters.")
  .regex(/^[A-Za-z0-9._ -]+$/, "Use letters, digits, hyphens, periods, or underscores.")
  .transform((value) => value.toUpperCase().replace(/\s+/g, " "));

const titleSchema = z.string().trim().min(2, "Use at least 2 characters.").max(160);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const optionalIsoDate = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  isoDate.optional(),
);

const optionalId = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().min(1).optional(),
);

export const courseInputSchema = z.object({
  code: codeSchema,
  title: titleSchema,
  description: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().trim().max(4000, "Keep the description under 4000 characters.").optional(),
  ),
  credits: z.coerce
    .number()
    .min(0.5, "Credits must be at least 0.5.")
    .max(60, "Credits look too large."),
});

export const offeringInputSchema = z
  .object({
    courseId: z.string().min(1, "Choose a course."),
    termId: z.string().min(1, "Choose a term."),
    sectionId: optionalId,
    startsOn: optionalIsoDate,
    endsOn: optionalIsoDate,
    status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]).default("DRAFT"),
  })
  .refine((value) => !value.startsOn || !value.endsOn || value.startsOn < value.endsOn, {
    message: "The end date must be after the start date.",
    path: ["endsOn"],
  });

export const instructorInputSchema = z.object({
  courseOfferingId: z.string().min(1),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  assignmentRole: z.enum(["PRIMARY", "CO_INSTRUCTOR", "TEACHING_ASSISTANT"]).default("PRIMARY"),
});

export const enrolmentInputSchema = z.object({
  courseOfferingId: z.string().min(1),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

export type CourseSummary = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  credits: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  offeringCount: number;
};

export type OfferingSummary = {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  termId: string;
  termName: string;
  academicYearName: string;
  sectionId: string | null;
  sectionName: string | null;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  startsOn: Date | null;
  endsOn: Date | null;
  instructorNames: string[];
  enrolmentCount: number;
};

export type OfferingDetail = OfferingSummary & {
  instructors: Array<{
    id: string;
    userId: string;
    name: string;
    email: string;
    assignmentRole: "PRIMARY" | "CO_INSTRUCTOR" | "TEACHING_ASSISTANT";
  }>;
  capacity: number | null;
};

export type EnrolmentSummary = {
  id: string;
  userId: string;
  name: string;
  email: string;
  institutionalId: string | null;
  status: "ACTIVE" | "WITHDRAWN" | "COMPLETED";
  source: "MANUAL" | "IMPORT";
  enrolledAt: Date;
};

export type OfferingOptions = {
  courses: Array<{ id: string; code: string; title: string; status: string }>;
  terms: Array<{ id: string; name: string; academicYearName: string }>;
  sections: Array<{ id: string; name: string; cohortName: string; programmeName: string }>;
};

function jsonDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export async function listCourses(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<CourseSummary[]> {
  requirePermission(account, "courses.read");
  const courses = await db.course.findMany({
    where: { tenantId: tenantIdOf(account) },
    orderBy: [{ code: "asc" }],
    select: {
      id: true,
      code: true,
      title: true,
      description: true,
      credits: true,
      status: true,
      _count: { select: { offerings: true } },
    },
  });
  return courses.map((course) => ({
    id: course.id,
    code: course.code,
    title: course.title,
    description: course.description,
    credits: course.credits.toFixed(1),
    status: course.status,
    offeringCount: course._count.offerings,
  }));
}

export async function createCourse(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "courses.create");
  const data = courseInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const course = await tx.course.create({
          data: {
            tenantId,
            code: data.code,
            title: data.title,
            description: data.description ?? null,
            credits: data.credits.toFixed(1),
            status: "DRAFT",
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "course.created",
          resourceType: "course",
          resourceId: course.id,
          after: { code: course.code, title: course.title, credits: course.credits.toFixed(1) },
          requestId: context.requestId,
        });
        return { id: course.id };
      }),
    "A course with that code already exists.",
  );
}

export async function updateCourse(
  account: AccountContext,
  courseId: string,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "courses.update");
  const data = courseInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const existing = await tx.course.findFirst({ where: { id: courseId, tenantId } });
        if (!existing) throw new ResourceNotFoundError();

        const updated = await tx.course.update({
          where: { id: existing.id },
          data: {
            code: data.code,
            title: data.title,
            description: data.description ?? null,
            credits: data.credits.toFixed(1),
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "course.updated",
          resourceType: "course",
          resourceId: updated.id,
          before: { code: existing.code, title: existing.title },
          after: { code: updated.code, title: updated.title },
          requestId: context.requestId,
        });
        return { id: updated.id };
      }),
    "A course with that code already exists.",
  );
}

export async function setCourseStatus(
  account: AccountContext,
  courseId: string,
  status: "DRAFT" | "ACTIVE" | "ARCHIVED",
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  // Archiving is a separate capability so a content role cannot retire a course.
  requirePermission(account, status === "ARCHIVED" ? "courses.archive" : "courses.update");
  const tenantId = tenantIdOf(account);

  await db.$transaction(async (tx) => {
    const existing = await tx.course.findFirst({ where: { id: courseId, tenantId } });
    if (!existing) throw new ResourceNotFoundError();

    await tx.course.update({ where: { id: existing.id }, data: { status } });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "course.status_changed",
      resourceType: "course",
      resourceId: existing.id,
      before: { status: existing.status },
      after: { status },
      requestId: context.requestId,
    });
  });
}

// ---------------------------------------------------------------------------
// Offerings
// ---------------------------------------------------------------------------

const offeringSelect = {
  id: true,
  courseId: true,
  termId: true,
  sectionId: true,
  startsOn: true,
  endsOn: true,
  status: true,
  course: { select: { code: true, title: true } },
  term: { select: { name: true, academicYear: { select: { name: true } } } },
  section: { select: { name: true, capacity: true } },
  instructors: {
    select: { user: { select: { name: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  _count: { select: { enrolments: true } },
};

type OfferingRow = {
  id: string;
  courseId: string;
  termId: string;
  sectionId: string | null;
  startsOn: Date | null;
  endsOn: Date | null;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  course: { code: string; title: string };
  term: { name: string; academicYear: { name: string } };
  section: { name: string; capacity: number | null } | null;
  instructors: Array<{ user: { name: string } }>;
  _count: { enrolments: number };
};

function toOfferingSummary(offering: OfferingRow): OfferingSummary {
  return {
    id: offering.id,
    courseId: offering.courseId,
    courseCode: offering.course.code,
    courseTitle: offering.course.title,
    termId: offering.termId,
    termName: offering.term.name,
    academicYearName: offering.term.academicYear.name,
    sectionId: offering.sectionId,
    sectionName: offering.section?.name ?? null,
    status: offering.status,
    startsOn: offering.startsOn,
    endsOn: offering.endsOn,
    instructorNames: offering.instructors.map((instructor) => instructor.user.name),
    enrolmentCount: offering._count.enrolments,
  };
}

export async function listOfferings(
  account: AccountContext,
  filter: { termId?: string } = {},
  db: DatabaseClient = getDb(),
): Promise<OfferingSummary[]> {
  requirePermission(account, "courses.read");
  const offerings = await db.courseOffering.findMany({
    where: {
      tenantId: tenantIdOf(account),
      ...(filter.termId ? { termId: filter.termId } : {}),
    },
    orderBy: [{ term: { startsOn: "desc" } }, { course: { code: "asc" } }],
    select: offeringSelect,
  });
  return offerings.map(toOfferingSummary);
}

export async function getOffering(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<OfferingDetail> {
  requirePermission(account, "courses.read");
  const offering = await db.courseOffering.findFirst({
    where: { id: offeringId, tenantId: tenantIdOf(account) },
    select: {
      ...offeringSelect,
      instructors: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          userId: true,
          assignmentRole: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!offering) throw new ResourceNotFoundError();

  const summary = toOfferingSummary(offering);
  return {
    ...summary,
    capacity: offering.section?.capacity ?? null,
    instructors: offering.instructors.map((instructor) => ({
      id: instructor.id,
      userId: instructor.userId,
      name: instructor.user.name,
      email: instructor.user.email,
      assignmentRole: instructor.assignmentRole,
    })),
  };
}

export async function getOfferingOptions(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<OfferingOptions> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);

  const [courses, terms, sections] = await Promise.all([
    db.course.findMany({
      where: { tenantId, status: { not: "ARCHIVED" } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, title: true, status: true },
    }),
    db.term.findMany({
      where: { tenantId },
      orderBy: { startsOn: "desc" },
      select: { id: true, name: true, academicYear: { select: { name: true } } },
    }),
    db.section.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        cohort: { select: { name: true, programme: { select: { name: true } } } },
      },
    }),
  ]);

  return {
    courses,
    terms: terms.map((term) => ({
      id: term.id,
      name: term.name,
      academicYearName: term.academicYear.name,
    })),
    sections: sections.map((section) => ({
      id: section.id,
      name: section.name,
      cohortName: section.cohort.name,
      programmeName: section.cohort.programme.name,
    })),
  };
}

async function assertOfferingReferences(
  tx: Pick<DatabaseClient, "course" | "term" | "section">,
  tenantId: string,
  data: {
    courseId: string;
    termId: string;
    sectionId?: string;
    startsOn?: Date;
    endsOn?: Date;
  },
) {
  const [course, term, section] = await Promise.all([
    tx.course.findFirst({
      where: { id: data.courseId, tenantId },
      select: { id: true, status: true },
    }),
    tx.term.findFirst({
      where: { id: data.termId, tenantId },
      select: { id: true, name: true, startsOn: true, endsOn: true },
    }),
    data.sectionId
      ? tx.section.findFirst({ where: { id: data.sectionId, tenantId }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  if (!course) throw new ResourceNotFoundError("Course not found.");
  if (course.status === "ARCHIVED") {
    throw new ConflictError("That course is archived and cannot be offered.");
  }
  if (!term) throw new ResourceNotFoundError("Term not found.");
  if (data.sectionId && !section) throw new ResourceNotFoundError("Section not found.");

  if (data.startsOn && data.startsOn < term.startsOn) {
    throw new ConflictError(`The offering cannot start before ${term.name}.`);
  }
  if (data.endsOn && data.endsOn > term.endsOn) {
    throw new ConflictError(`The offering cannot end after ${term.name}.`);
  }
  return term;
}

export async function createOffering(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "courses.create");
  const data = offeringInputSchema.parse(input);
  if (data.status === "PUBLISHED") requirePermission(account, "courses.publish");
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        await assertOfferingReferences(tx, tenantId, data);

        const duplicate = await tx.courseOffering.findFirst({
          where: {
            tenantId,
            courseId: data.courseId,
            termId: data.termId,
            sectionId: data.sectionId ?? null,
          },
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictError("That course is already offered in this term and section.");
        }

        const offering = await tx.courseOffering.create({
          data: {
            tenantId,
            courseId: data.courseId,
            termId: data.termId,
            sectionId: data.sectionId ?? null,
            startsOn: data.startsOn ?? null,
            endsOn: data.endsOn ?? null,
            status: data.status,
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "offering.created",
          resourceType: "course_offering",
          resourceId: offering.id,
          after: {
            courseId: offering.courseId,
            termId: offering.termId,
            sectionId: offering.sectionId,
            startsOn: jsonDate(offering.startsOn),
            endsOn: jsonDate(offering.endsOn),
            status: offering.status,
          },
          requestId: context.requestId,
        });
        return { id: offering.id };
      }),
    "That course is already offered in this term and section.",
  );
}

export async function updateOffering(
  account: AccountContext,
  offeringId: string,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "courses.update");
  const data = offeringInputSchema.parse(input);
  if (data.status === "PUBLISHED") requirePermission(account, "courses.publish");
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const existing = await tx.courseOffering.findFirst({
          where: { id: offeringId, tenantId },
        });
        if (!existing) throw new ResourceNotFoundError();

        await assertOfferingReferences(tx, tenantId, data);

        const duplicate = await tx.courseOffering.findFirst({
          where: {
            tenantId,
            courseId: data.courseId,
            termId: data.termId,
            sectionId: data.sectionId ?? null,
            id: { not: existing.id },
          },
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictError("That course is already offered in this term and section.");
        }

        const updated = await tx.courseOffering.update({
          where: { id: existing.id },
          data: {
            courseId: data.courseId,
            termId: data.termId,
            sectionId: data.sectionId ?? null,
            startsOn: data.startsOn ?? null,
            endsOn: data.endsOn ?? null,
            status: data.status,
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "offering.updated",
          resourceType: "course_offering",
          resourceId: updated.id,
          before: {
            courseId: existing.courseId,
            termId: existing.termId,
            sectionId: existing.sectionId,
            status: existing.status,
          },
          after: {
            courseId: updated.courseId,
            termId: updated.termId,
            sectionId: updated.sectionId,
            status: updated.status,
          },
          requestId: context.requestId,
        });
        return { id: updated.id };
      }),
    "That course is already offered in this term and section.",
  );
}

// ---------------------------------------------------------------------------
// Instructors
// ---------------------------------------------------------------------------

export async function addInstructor(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string }> {
  requirePermission(account, "enrolments.manage");
  const data = instructorInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const offering = await tx.courseOffering.findFirst({
          where: { id: data.courseOfferingId, tenantId },
          select: { id: true },
        });
        if (!offering) throw new ResourceNotFoundError("Course offering not found.");

        const membership = await tx.tenantMembership.findFirst({
          where: {
            tenantId,
            status: "ACTIVE",
            user: { email: data.email, status: "ACTIVE" },
          },
          select: { userId: true },
        });
        if (!membership) {
          throw new ResourceNotFoundError(
            "No active member of this institution has that email address.",
          );
        }

        const instructor = await tx.courseInstructor.upsert({
          where: {
            courseOfferingId_userId: {
              courseOfferingId: offering.id,
              userId: membership.userId,
            },
          },
          update: { assignmentRole: data.assignmentRole },
          create: {
            tenantId,
            courseOfferingId: offering.id,
            userId: membership.userId,
            assignmentRole: data.assignmentRole,
          },
        });
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: "offering.instructor_added",
          resourceType: "course_offering",
          resourceId: offering.id,
          after: { userId: membership.userId, role: data.assignmentRole },
          requestId: context.requestId,
        });
        return { id: instructor.id };
      }),
    "That person is already assigned to this offering.",
  );
}

export async function removeInstructor(
  account: AccountContext,
  instructorId: string,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "enrolments.manage");
  const tenantId = tenantIdOf(account);

  await db.$transaction(async (tx) => {
    const existing = await tx.courseInstructor.findFirst({
      where: { id: instructorId, tenantId },
      select: { id: true, courseOfferingId: true, userId: true },
    });
    if (!existing) throw new ResourceNotFoundError();

    await tx.courseInstructor.delete({ where: { id: existing.id } });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "offering.instructor_removed",
      resourceType: "course_offering",
      resourceId: existing.courseOfferingId,
      before: { userId: existing.userId },
      requestId: context.requestId,
    });
  });
}

// ---------------------------------------------------------------------------
// Enrolments and roster
// ---------------------------------------------------------------------------

export async function listEnrolments(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<EnrolmentSummary[]> {
  requirePermission(account, "courses.read");
  const tenantId = tenantIdOf(account);
  const offering = await db.courseOffering.findFirst({
    where: { id: offeringId, tenantId },
    select: { id: true },
  });
  if (!offering) throw new ResourceNotFoundError();

  const enrolments = await db.enrolment.findMany({
    where: { courseOfferingId: offering.id, tenantId },
    orderBy: { user: { name: "asc" } },
    select: {
      id: true,
      userId: true,
      status: true,
      source: true,
      enrolledAt: true,
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

  return enrolments.map((enrolment) => ({
    id: enrolment.id,
    userId: enrolment.userId,
    name: enrolment.user.name,
    email: enrolment.user.email,
    institutionalId: enrolment.user.memberships[0]?.institutionalId ?? null,
    status: enrolment.status,
    source: enrolment.source,
    enrolledAt: enrolment.enrolledAt,
  }));
}

export async function enrolStudent(
  account: AccountContext,
  input: unknown,
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<{ id: string; reactivated: boolean }> {
  requirePermission(account, "enrolments.manage");
  const data = enrolmentInputSchema.parse(input);
  const tenantId = tenantIdOf(account);

  return guardUnique(
    () =>
      db.$transaction(async (tx) => {
        const offering = await tx.courseOffering.findFirst({
          where: { id: data.courseOfferingId, tenantId },
          select: {
            id: true,
            section: { select: { capacity: true } },
            _count: { select: { enrolments: { where: { status: "ACTIVE" } } } },
          },
        });
        if (!offering) throw new ResourceNotFoundError("Course offering not found.");

        const membership = await tx.tenantMembership.findFirst({
          where: {
            tenantId,
            status: "ACTIVE",
            user: { email: data.email, status: "ACTIVE" },
          },
          select: { userId: true },
        });
        if (!membership) {
          throw new ResourceNotFoundError(
            "No active member of this institution has that email address.",
          );
        }

        const existing = await tx.enrolment.findUnique({
          where: {
            courseOfferingId_userId: {
              courseOfferingId: offering.id,
              userId: membership.userId,
            },
          },
          select: { id: true, status: true },
        });

        if (existing?.status === "ACTIVE") {
          throw new ConflictError("That person is already enrolled in this offering.");
        }

        const capacity = offering.section?.capacity ?? null;
        if (capacity !== null && offering._count.enrolments >= capacity) {
          throw new ConflictError("This section is at capacity.");
        }

        const enrolment = existing
          ? await tx.enrolment.update({
              where: { id: existing.id },
              data: { status: "ACTIVE", enrolledAt: new Date(), source: "MANUAL" },
            })
          : await tx.enrolment.create({
              data: {
                tenantId,
                courseOfferingId: offering.id,
                userId: membership.userId,
                status: "ACTIVE",
                source: "MANUAL",
              },
            });

        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: account.user.id,
          action: existing ? "enrolment.reactivated" : "enrolment.created",
          resourceType: "enrolment",
          resourceId: enrolment.id,
          after: { userId: membership.userId, courseOfferingId: offering.id },
          requestId: context.requestId,
        });
        return { id: enrolment.id, reactivated: Boolean(existing) };
      }),
    "That person is already enrolled in this offering.",
  );
}

export async function setEnrolmentStatus(
  account: AccountContext,
  enrolmentId: string,
  status: "ACTIVE" | "WITHDRAWN" | "COMPLETED",
  context: { requestId: string },
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "enrolments.manage");
  const tenantId = tenantIdOf(account);

  await db.$transaction(async (tx) => {
    const existing = await tx.enrolment.findFirst({
      where: { id: enrolmentId, tenantId },
      select: { id: true, status: true, courseOfferingId: true, userId: true },
    });
    if (!existing) throw new ResourceNotFoundError();
    if (existing.status === status) return;

    await tx.enrolment.update({ where: { id: existing.id }, data: { status } });
    await recordAuditEvent(tx, {
      tenantId,
      actorUserId: account.user.id,
      action: "enrolment.status_changed",
      resourceType: "enrolment",
      resourceId: existing.id,
      before: { status: existing.status },
      after: { status },
      requestId: context.requestId,
    });
  });
}
