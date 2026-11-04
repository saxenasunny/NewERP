import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { buildAccountContext, type AccountContext } from "@/lib/auth/account";
import { ConflictError, PermissionDeniedError, ResourceNotFoundError } from "@/lib/errors";
import {
  addInstructor,
  createCourse,
  createOffering,
  enrolStudent,
  getOffering,
  getOfferingOptions,
  listCourses,
  listEnrolments,
  listOfferings,
  setEnrolmentStatus,
  updateCourse,
} from "@/modules/academics/course-service";
import {
  addCohortMember,
  createAcademicYear,
  createCohort,
  createDepartment,
  createProgramme,
  createSection,
  createTerm,
  getStructureOptions,
  listAcademicYears,
  updateAcademicYear,
  updateDepartment,
} from "@/modules/academics/structure-service";

import {
  createTenantFixture,
  disconnectTestDb,
  integrationDatabaseUrl,
  resetDatabase,
  seedPermissions,
  testDb,
  type TenantFixture,
} from "./helpers/database";

const databaseAvailable = Boolean(integrationDatabaseUrl());

if (!databaseAvailable) {
  console.warn(
    "Skipping academic structure tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
  );
}

const describeDb = describe.skipIf(!databaseAvailable);

async function accountFor(userId: string, tenantId: string): Promise<AccountContext> {
  const account = await buildAccountContext(
    {
      session: { id: "test-session", expiresAt: new Date(Date.now() + 60_000) },
      user: { id: userId },
    },
    { activeTenantId: tenantId },
  );
  if (!account) throw new Error("Expected an account context for an active user.");
  return account;
}

const context = { requestId: "req-academics" };

async function seedStructure(admin: AccountContext) {
  const year = await createAcademicYear(
    admin,
    { name: "2026/27", startsOn: "2026-08-01", endsOn: "2027-06-30" },
    context,
  );
  const term = await createTerm(
    admin,
    {
      academicYearId: year.id,
      name: "Semester 1",
      startsOn: "2026-08-15",
      endsOn: "2026-12-20",
    },
    context,
  );
  const department = await createDepartment(
    admin,
    { name: "Computer Science", code: "CS" },
    context,
  );
  const programme = await createProgramme(
    admin,
    {
      departmentId: department.id,
      name: "BSc Computer Science",
      code: "BSCS",
      level: "BACHELOR",
    },
    context,
  );
  const cohort = await createCohort(
    admin,
    { programmeId: programme.id, academicYearId: year.id, name: "2026 intake" },
    context,
  );
  const section = await createSection(
    admin,
    { cohortId: cohort.id, name: "A", capacity: "30" },
    context,
  );
  const course = await createCourse(
    admin,
    { code: "CS101", title: "Introduction to Programming", credits: "4" },
    context,
  );
  return { year, term, department, programme, cohort, section, course };
}

async function createExtraMember(tenant: TenantFixture, email: string): Promise<string> {
  const user = await testDb().user.create({
    data: { email, name: "Extra Learner", status: "ACTIVE", emailVerified: true },
  });
  await testDb().tenantMembership.create({
    data: { tenantId: tenant.tenantId, userId: user.id, status: "ACTIVE", joinedAt: new Date() },
  });
  return user.id;
}

describeDb("academic structure, catalogue, and enrolment (PostgreSQL)", () => {
  let alpha: TenantFixture;
  let beta: TenantFixture;
  let alphaAdmin: AccountContext;
  let betaAdmin: AccountContext;

  beforeEach(async () => {
    await resetDatabase();
    await seedPermissions();
    alpha = await createTenantFixture({ slug: "alpha", name: "Alpha University", code: "ALP" });
    beta = await createTenantFixture({ slug: "beta", name: "Beta College", code: "BET" });
    alphaAdmin = await accountFor(alpha.admin.userId, alpha.tenantId);
    betaAdmin = await accountFor(beta.admin.userId, beta.tenantId);
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  describe("academic years and terms", () => {
    it("creates a year and a term inside it, refusing a term that falls outside", async () => {
      const year = await createAcademicYear(
        alphaAdmin,
        { name: "2026/27", startsOn: "2026-08-01", endsOn: "2027-06-30" },
        context,
      );

      const term = await createTerm(
        alphaAdmin,
        {
          academicYearId: year.id,
          name: "Semester 1",
          startsOn: "2026-08-15",
          endsOn: "2026-12-20",
        },
        context,
      );
      expect(term.id).toBeTruthy();

      await expect(
        createTerm(
          alphaAdmin,
          {
            academicYearId: year.id,
            name: "Summer",
            startsOn: "2026-07-01",
            endsOn: "2026-07-31",
          },
          context,
        ),
      ).rejects.toBeInstanceOf(ConflictError);

      const audit = await testDb().auditEvent.findFirst({
        where: { action: "term.created", resourceId: term.id },
      });
      expect(audit?.actorUserId).toBe(alpha.admin.userId);
    });

    it("rejects impossible date ranges before writing", async () => {
      await expect(
        createAcademicYear(
          alphaAdmin,
          { name: "Backwards", startsOn: "2027-06-30", endsOn: "2026-08-01" },
          context,
        ),
      ).rejects.toBeInstanceOf(ZodError);
      expect(await testDb().academicYear.count()).toBe(0);
    });

    it("keeps years tenant-scoped and reports a foreign year as missing", async () => {
      const year = await createAcademicYear(
        alphaAdmin,
        { name: "2026/27", startsOn: "2026-08-01", endsOn: "2027-06-30" },
        context,
      );

      expect(await listAcademicYears(betaAdmin)).toEqual([]);
      await expect(
        updateAcademicYear(
          betaAdmin,
          year.id,
          { name: "Hijacked", startsOn: "2026-08-01", endsOn: "2027-06-30" },
          context,
        ),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);

      const unchanged = await testDb().academicYear.findUniqueOrThrow({ where: { id: year.id } });
      expect(unchanged.name).toBe("2026/27");
    });

    it("requires the academic_structure.manage permission", async () => {
      const faculty = await accountFor(alpha.faculty.userId, alpha.tenantId);
      const student = await accountFor(alpha.student.userId, alpha.tenantId);

      await expect(listAcademicYears(faculty)).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        createAcademicYear(
          student,
          { name: "2026/27", startsOn: "2026-08-01", endsOn: "2027-06-30" },
          context,
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      expect(await testDb().academicYear.count()).toBe(0);
    });
  });

  describe("departments, programmes, cohorts", () => {
    it("refuses a cycle in the department tree", async () => {
      const arts = await createDepartment(alphaAdmin, { name: "Arts", code: "ART" }, context);
      const science = await createDepartment(
        alphaAdmin,
        { name: "Science", code: "SCI", parentDepartmentId: arts.id },
        context,
      );

      await expect(
        updateDepartment(
          alphaAdmin,
          arts.id,
          { name: "Arts", code: "ART", parentDepartmentId: science.id },
          context,
        ),
      ).rejects.toBeInstanceOf(ConflictError);

      await expect(
        updateDepartment(
          alphaAdmin,
          arts.id,
          { name: "Arts", code: "ART", parentDepartmentId: arts.id },
          context,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("reports a foreign department as missing and hides foreign option lists", async () => {
      const arts = await createDepartment(alphaAdmin, { name: "Arts", code: "ART" }, context);

      await expect(
        updateDepartment(betaAdmin, arts.id, { name: "Stolen", code: "STL" }, context),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);

      const betaOptions = await getStructureOptions(betaAdmin);
      expect(betaOptions.departments).toEqual([]);
      const alphaOptions = await getStructureOptions(alphaAdmin);
      expect(alphaOptions.departments.map((department) => department.name)).toEqual(["Arts"]);
    });

    it("adds cohort members only from this institution and only once", async () => {
      const structure = await seedStructure(alphaAdmin);

      const member = await addCohortMember(
        alphaAdmin,
        { cohortId: structure.cohort.id, email: "student@alpha.example" },
        context,
      );
      expect(member.id).toBeTruthy();

      await expect(
        addCohortMember(
          alphaAdmin,
          { cohortId: structure.cohort.id, email: "student@alpha.example" },
          context,
        ),
      ).rejects.toBeInstanceOf(ConflictError);

      await expect(
        addCohortMember(
          betaAdmin,
          { cohortId: structure.cohort.id, email: "student@beta.example" },
          context,
        ),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);

      expect(await testDb().cohortMember.count()).toBe(1);
    });
  });

  describe("catalogue and offerings", () => {
    it("keeps course codes unique per tenant, not globally", async () => {
      await createCourse(
        alphaAdmin,
        { code: "CS101", title: "Introduction to Programming", credits: "4" },
        context,
      );

      await expect(
        createCourse(alphaAdmin, { code: "CS101", title: "Duplicate", credits: "3" }, context),
      ).rejects.toBeInstanceOf(ConflictError);

      const betaCourse = await createCourse(
        betaAdmin,
        { code: "CS101", title: "Beta Introduction", credits: "4" },
        context,
      );
      const betaCourses = await listCourses(betaAdmin);
      expect(betaCourses).toHaveLength(1);
      expect(betaCourses[0]?.id).toBe(betaCourse.id);
    });

    it("keeps the catalogue entry distinct from a term offering", async () => {
      const structure = await seedStructure(alphaAdmin);

      let courses = await listCourses(alphaAdmin);
      expect(courses[0]?.offeringCount).toBe(0);
      expect(courses[0]?.title).toBe("Introduction to Programming");

      const offering = await createOffering(
        alphaAdmin,
        {
          courseId: structure.course.id,
          termId: structure.term.id,
          sectionId: structure.section.id,
          startsOn: "2026-08-20",
          endsOn: "2026-12-10",
          status: "PUBLISHED",
        },
        context,
      );
      expect(offering.id).toBeTruthy();

      courses = await listCourses(alphaAdmin);
      expect(courses[0]?.offeringCount).toBe(1);

      const offerings = await listOfferings(alphaAdmin);
      expect(offerings).toHaveLength(1);
      expect(offerings[0]?.courseCode).toBe("CS101");
      expect(offerings[0]?.termName).toBe("Semester 1");
      expect(offerings[0]?.sectionName).toBe("A");

      // The same catalogue course in the same term and section cannot be
      // offered twice.
      await expect(
        createOffering(
          alphaAdmin,
          {
            courseId: structure.course.id,
            termId: structure.term.id,
            sectionId: structure.section.id,
          },
          context,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("validates offering dates against the term and allows the same course in another term", async () => {
      const structure = await seedStructure(alphaAdmin);
      const secondTerm = await createTerm(
        alphaAdmin,
        {
          academicYearId: structure.year.id,
          name: "Semester 2",
          startsOn: "2027-01-10",
          endsOn: "2027-05-30",
        },
        context,
      );

      await expect(
        createOffering(
          alphaAdmin,
          {
            courseId: structure.course.id,
            termId: structure.term.id,
            startsOn: "2026-07-01",
            endsOn: "2026-12-01",
          },
          context,
        ),
      ).rejects.toBeInstanceOf(ConflictError);

      await createOffering(
        alphaAdmin,
        {
          courseId: structure.course.id,
          termId: structure.term.id,
          sectionId: structure.section.id,
        },
        context,
      );
      await createOffering(
        alphaAdmin,
        { courseId: structure.course.id, termId: secondTerm.id },
        context,
      );
      expect(await listOfferings(alphaAdmin)).toHaveLength(2);
    });

    it("lets faculty read the catalogue but not create or edit it", async () => {
      const structure = await seedStructure(alphaAdmin);
      const faculty = await accountFor(alpha.faculty.userId, alpha.tenantId);

      expect((await listCourses(faculty)).length).toBe(1);
      expect((await getOfferingOptions(faculty)).courses.length).toBe(1);

      await expect(
        createCourse(faculty, { code: "NEW101", title: "Not allowed", credits: "3" }, context),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        updateCourse(
          faculty,
          structure.course.id,
          { code: "CS101", title: "Renamed", credits: "4" },
          context,
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
  });

  describe("instructors and enrolments", () => {
    it("assigns an instructor idempotently and finds the offering only inside the tenant", async () => {
      const structure = await seedStructure(alphaAdmin);
      const offering = await createOffering(
        alphaAdmin,
        {
          courseId: structure.course.id,
          termId: structure.term.id,
          sectionId: structure.section.id,
        },
        context,
      );

      await addInstructor(
        alphaAdmin,
        {
          courseOfferingId: offering.id,
          email: "faculty@alpha.example",
          assignmentRole: "PRIMARY",
        },
        context,
      );
      await addInstructor(
        alphaAdmin,
        {
          courseOfferingId: offering.id,
          email: "faculty@alpha.example",
          assignmentRole: "CO_INSTRUCTOR",
        },
        context,
      );

      expect(await testDb().courseInstructor.count()).toBe(1);
      const detail = await getOffering(alphaAdmin, offering.id);
      expect(detail.instructors).toHaveLength(1);
      expect(detail.instructors[0]?.assignmentRole).toBe("CO_INSTRUCTOR");

      await expect(getOffering(betaAdmin, offering.id)).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
      await expect(
        addInstructor(
          betaAdmin,
          {
            courseOfferingId: offering.id,
            email: "faculty@beta.example",
            assignmentRole: "PRIMARY",
          },
          context,
        ),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("enrols once, withdraws, reactivates, and exposes the roster", async () => {
      const structure = await seedStructure(alphaAdmin);
      const offering = await createOffering(
        alphaAdmin,
        {
          courseId: structure.course.id,
          termId: structure.term.id,
          sectionId: structure.section.id,
        },
        context,
      );
      await testDb().tenantMembership.updateMany({
        where: { tenantId: alpha.tenantId, userId: alpha.student.userId },
        data: { institutionalId: "STU-0042" },
      });

      const enrolment = await enrolStudent(
        alphaAdmin,
        { courseOfferingId: offering.id, email: "student@alpha.example" },
        context,
      );
      expect(enrolment.reactivated).toBe(false);

      await expect(
        enrolStudent(
          alphaAdmin,
          { courseOfferingId: offering.id, email: "student@alpha.example" },
          context,
        ),
      ).rejects.toBeInstanceOf(ConflictError);

      await setEnrolmentStatus(alphaAdmin, enrolment.id, "WITHDRAWN", context);
      const reactivated = await enrolStudent(
        alphaAdmin,
        { courseOfferingId: offering.id, email: "student@alpha.example" },
        context,
      );
      expect(reactivated.reactivated).toBe(true);

      expect(await testDb().enrolment.count()).toBe(1);
      const roster = await listEnrolments(alphaAdmin, offering.id);
      expect(roster).toHaveLength(1);
      expect(roster[0]?.institutionalId).toBe("STU-0042");
      expect(roster[0]?.status).toBe("ACTIVE");
    });

    it("refuses an enrolment beyond the section capacity", async () => {
      const structure = await seedStructure(alphaAdmin);
      const smallSection = await createSection(
        alphaAdmin,
        { cohortId: structure.cohort.id, name: "Small", capacity: "1" },
        context,
      );
      const offering = await createOffering(
        alphaAdmin,
        { courseId: structure.course.id, termId: structure.term.id, sectionId: smallSection.id },
        context,
      );

      await createExtraMember(alpha, "extra@alpha.example");
      await enrolStudent(
        alphaAdmin,
        { courseOfferingId: offering.id, email: "student@alpha.example" },
        context,
      );

      await expect(
        enrolStudent(
          alphaAdmin,
          { courseOfferingId: offering.id, email: "extra@alpha.example" },
          context,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(await testDb().enrolment.count()).toBe(1);
    });
  });
});
