/**
 * Idempotent development seed with fictional institutions and people.
 * Emails use reserved `.example` domains; no real student data is present.
 *
 * Demo accounts share one development-only password, taken from
 * `SEED_DEMO_PASSWORD` or the documented default. The seed refuses to run in
 * production. Existing passwords are never overwritten on re-run.
 */
import { hashPassword } from "better-auth/crypto";
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient, type QuestionType } from "../generated/prisma/client";
import {
  PERMISSIONS,
  PLATFORM_ROLES,
  TENANT_ROLES,
  type RoleDefinition,
} from "../lib/permissions/catalogue";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
}

if (process.env.NODE_ENV === "production") {
  throw new Error("The demo seed must never run in production.");
}

const demoPassword = process.env.SEED_DEMO_PASSWORD ?? "DemoPassword2026!";
if (demoPassword.length < 12) {
  throw new Error("SEED_DEMO_PASSWORD must be at least 12 characters.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

let cachedDemoHash: string | undefined;
async function demoPasswordHash(): Promise<string> {
  cachedDemoHash ??= await hashPassword(demoPassword);
  return cachedDemoHash;
}

async function syncPermissionCatalogue(): Promise<void> {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: { key: permission.key, description: permission.description },
    });
  }
}

async function ensureRole(tenantId: string | null, definition: RoleDefinition) {
  const existing = await prisma.role.findFirst({ where: { tenantId, key: definition.key } });

  if (existing) {
    return prisma.role.update({
      where: { id: existing.id },
      data: {
        name: definition.name,
        scope: definition.scope === "platform" ? "PLATFORM" : "TENANT",
        isSystem: true,
        permissions: {
          deleteMany: {},
          create: definition.permissions.map((permissionKey) => ({ permissionKey })),
        },
      },
    });
  }

  return prisma.role.create({
    data: {
      tenantId,
      key: definition.key,
      name: definition.name,
      scope: definition.scope === "platform" ? "PLATFORM" : "TENANT",
      isSystem: true,
      permissions: {
        create: definition.permissions.map((permissionKey) => ({ permissionKey })),
      },
    },
  });
}

async function ensureUser(email: string, name: string) {
  const user = await prisma.user.upsert({
    where: { email },
    update: { name },
    create: { email, name, status: "ACTIVE", emailVerified: true },
  });

  const credential = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
    select: { id: true },
  });
  if (!credential) {
    await prisma.account.create({
      data: {
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: await demoPasswordHash(),
      },
    });
  }

  return user;
}

async function ensureMembership(tenantId: string, userId: string, institutionalId?: string) {
  return prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId, userId } },
    update: { status: "ACTIVE", ...(institutionalId ? { institutionalId } : {}) },
    create: {
      tenantId,
      userId,
      status: "ACTIVE",
      institutionalId: institutionalId ?? null,
      joinedAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Phase 4 sample structure
// ---------------------------------------------------------------------------

async function ensureYear(
  tenantId: string,
  name: string,
  startsOn: string,
  endsOn: string,
  status: "PLANNED" | "ACTIVE" | "ARCHIVED",
) {
  return prisma.academicYear.upsert({
    where: { tenantId_name: { tenantId, name } },
    update: { startsOn: new Date(startsOn), endsOn: new Date(endsOn), status },
    create: { tenantId, name, startsOn: new Date(startsOn), endsOn: new Date(endsOn), status },
  });
}

async function ensureTerm(
  tenantId: string,
  academicYearId: string,
  name: string,
  startsOn: string,
  endsOn: string,
) {
  return prisma.term.upsert({
    where: { academicYearId_name: { academicYearId, name } },
    update: { startsOn: new Date(startsOn), endsOn: new Date(endsOn) },
    create: {
      tenantId,
      academicYearId,
      name,
      startsOn: new Date(startsOn),
      endsOn: new Date(endsOn),
    },
  });
}

async function ensureDepartment(tenantId: string, name: string, code: string) {
  return prisma.department.upsert({
    where: { tenantId_code: { tenantId, code } },
    update: { name },
    create: { tenantId, name, code },
  });
}

async function ensureProgramme(
  tenantId: string,
  departmentId: string,
  name: string,
  code: string,
  level: "CERTIFICATE" | "DIPLOMA" | "BACHELOR" | "MASTER" | "DOCTORATE" | "OTHER",
) {
  return prisma.programme.upsert({
    where: { tenantId_code: { tenantId, code } },
    update: { name, departmentId, level, status: "ACTIVE" },
    create: { tenantId, departmentId, name, code, level, status: "ACTIVE" },
  });
}

async function ensureCohort(
  tenantId: string,
  programmeId: string,
  academicYearId: string,
  name: string,
) {
  return prisma.cohort.upsert({
    where: { programmeId_academicYearId_name: { programmeId, academicYearId, name } },
    update: {},
    create: { tenantId, programmeId, academicYearId, name },
  });
}

async function ensureSection(tenantId: string, cohortId: string, name: string, capacity: number) {
  return prisma.section.upsert({
    where: { cohortId_name: { cohortId, name } },
    update: { capacity },
    create: { tenantId, cohortId, name, capacity },
  });
}

async function ensureCourse(
  tenantId: string,
  code: string,
  title: string,
  credits: string,
  description: string,
  status: "DRAFT" | "ACTIVE" | "ARCHIVED",
) {
  return prisma.course.upsert({
    where: { tenantId_code: { tenantId, code } },
    update: { title, credits, description, status },
    create: { tenantId, code, title, credits, description, status },
  });
}

async function ensureOffering(
  tenantId: string,
  courseId: string,
  termId: string,
  sectionId: string | null,
  status: "DRAFT" | "PUBLISHED" | "CLOSED",
  startsOn: string,
  endsOn: string,
) {
  const existing = await prisma.courseOffering.findFirst({
    where: { tenantId, courseId, termId, sectionId },
  });
  if (existing) {
    return prisma.courseOffering.update({
      where: { id: existing.id },
      data: { status, startsOn: new Date(startsOn), endsOn: new Date(endsOn) },
    });
  }
  return prisma.courseOffering.create({
    data: {
      tenantId,
      courseId,
      termId,
      sectionId,
      status,
      startsOn: new Date(startsOn),
      endsOn: new Date(endsOn),
    },
  });
}

async function ensureInstructor(
  tenantId: string,
  courseOfferingId: string,
  userId: string,
  assignmentRole: "PRIMARY" | "CO_INSTRUCTOR" | "TEACHING_ASSISTANT",
) {
  return prisma.courseInstructor.upsert({
    where: { courseOfferingId_userId: { courseOfferingId, userId } },
    update: { assignmentRole },
    create: { tenantId, courseOfferingId, userId, assignmentRole },
  });
}

async function ensureEnrolment(tenantId: string, courseOfferingId: string, userId: string) {
  return prisma.enrolment.upsert({
    where: { courseOfferingId_userId: { courseOfferingId, userId } },
    update: { status: "ACTIVE" },
    create: { tenantId, courseOfferingId, userId, status: "ACTIVE", source: "MANUAL" },
  });
}

async function ensureCohortMember(tenantId: string, cohortId: string, userId: string) {
  return prisma.cohortMember.upsert({
    where: { cohortId_userId: { cohortId, userId } },
    update: {},
    create: { tenantId, cohortId, userId },
  });
}

async function ensureModule(
  tenantId: string,
  courseOfferingId: string,
  title: string,
  position: number,
  status: "DRAFT" | "PUBLISHED",
  description: string | null = null,
) {
  const existing = await prisma.courseModule.findFirst({
    where: { tenantId, courseOfferingId, title },
  });
  if (existing) {
    return prisma.courseModule.update({
      where: { id: existing.id },
      data: { position, status, description },
    });
  }
  return prisma.courseModule.create({
    data: { tenantId, courseOfferingId, title, position, status, description },
  });
}

async function ensurePrerequisite(
  tenantId: string,
  moduleId: string,
  prerequisiteModuleId: string,
) {
  return prisma.modulePrerequisite.upsert({
    where: { moduleId_prerequisiteModuleId: { moduleId, prerequisiteModuleId } },
    update: {},
    create: { tenantId, moduleId, prerequisiteModuleId },
  });
}

async function ensureContentItem(params: {
  tenantId: string;
  moduleId: string;
  title: string;
  position: number;
  kind: "RICH_TEXT" | "FILE" | "LINK" | "VIDEO_LINK";
  status: "DRAFT" | "PUBLISHED";
  body?: string;
  url?: string;
}) {
  const existing = await prisma.contentItem.findFirst({
    where: { tenantId: params.tenantId, moduleId: params.moduleId, title: params.title },
  });
  const data = {
    title: params.title,
    position: params.position,
    kind: params.kind,
    status: params.status,
    body: params.body ?? null,
    url: params.url ?? null,
  };
  if (existing) {
    return prisma.contentItem.update({ where: { id: existing.id }, data });
  }
  return prisma.contentItem.create({
    data: { ...data, tenantId: params.tenantId, moduleId: params.moduleId },
  });
}

async function ensureCourseAssignment(params: {
  tenantId: string;
  offeringId: string;
  title: string;
  instructions: string;
  pointsPossible: number;
  submissionType: "TEXT" | "FILE" | "LINK" | "TEXT_AND_FILE";
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  dueAt: string | null;
  availableFrom?: string | null;
  availableUntil?: string | null;
  settings: { allowLateSubmission: boolean; allowResubmission: boolean; maxAttempts: number };
}) {
  const existing = await prisma.assignment.findFirst({
    where: { tenantId: params.tenantId, offeringId: params.offeringId, title: params.title },
  });
  const data = {
    title: params.title,
    instructions: params.instructions,
    pointsPossible: params.pointsPossible,
    submissionTypes: params.submissionType,
    status: params.status,
    dueAt: params.dueAt ? new Date(params.dueAt) : null,
    availableFrom: params.availableFrom ? new Date(params.availableFrom) : null,
    availableUntil: params.availableUntil ? new Date(params.availableUntil) : null,
    settings: params.settings,
  };
  if (existing) {
    return prisma.assignment.update({ where: { id: existing.id }, data });
  }
  return prisma.assignment.create({
    data: { ...data, tenantId: params.tenantId, offeringId: params.offeringId },
  });
}

async function ensureLiveSession(params: {
  tenantId: string;
  offeringId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  joinUrl: string;
  createdByUserId: string;
}) {
  const existing = await prisma.liveSession.findFirst({
    where: { tenantId: params.tenantId, offeringId: params.offeringId, title: params.title },
  });
  const data = {
    title: params.title,
    startsAt: new Date(params.startsAt),
    endsAt: new Date(params.endsAt),
    joinUrl: params.joinUrl,
    status: "SCHEDULED" as const,
    createdByUserId: params.createdByUserId,
  };
  if (existing) {
    return prisma.liveSession.update({ where: { id: existing.id }, data });
  }
  return prisma.liveSession.create({
    data: { ...data, tenantId: params.tenantId, offeringId: params.offeringId },
  });
}

async function ensureRubric(
  tenantId: string,
  offeringId: string,
  assignmentId: string,
  criteria: Array<{ title: string; points: number; description: string }>,
) {
  const existing = await prisma.rubricCriterion.count({ where: { assignmentId } });
  if (existing > 0) return;
  await prisma.rubricCriterion.createMany({
    data: criteria.map((criterion, index) => ({
      tenantId,
      courseOfferingId: offeringId,
      assignmentId,
      title: criterion.title,
      description: criterion.description,
      pointsPossible: criterion.points,
      position: index + 1,
    })),
  });
}

async function ensureAssignment(params: {
  tenantId: string | null;
  userId: string;
  roleId: string;
  scopeType: "PLATFORM" | "TENANT";
  scopeId?: string | null;
}) {
  const existing = await prisma.userRoleAssignment.findFirst({
    where: {
      tenantId: params.tenantId,
      userId: params.userId,
      roleId: params.roleId,
      scopeType: params.scopeType,
      scopeId: params.scopeId ?? null,
    },
  });
  if (existing) return existing;

  return prisma.userRoleAssignment.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      roleId: params.roleId,
      scopeType: params.scopeType,
      scopeId: params.scopeId ?? null,
    },
  });
}

async function main(): Promise<void> {
  await syncPermissionCatalogue();

  const platformRoles = new Map<string, string>();
  for (const definition of PLATFORM_ROLES) {
    const role = await ensureRole(null, definition);
    platformRoles.set(definition.key, role.id);
  }

  type SeedPerson = {
    email: string;
    name: string;
    roleKey: "institution_admin" | "faculty" | "student";
    institutionalId: string;
  };

  const tenants: Array<{
    slug: string;
    name: string;
    timezone: string;
    code: string;
    people: SeedPerson[];
  }> = [
    {
      slug: "northstar",
      name: "Northstar University",
      timezone: "Asia/Kolkata",
      code: "NSU",
      people: [
        {
          email: "admin@northstar.example",
          name: "Daniel Whitfield",
          roleKey: "institution_admin",
          institutionalId: "NSU-EMP-1001",
        },
        {
          email: "faculty@northstar.example",
          name: "Amara Osei",
          roleKey: "faculty",
          institutionalId: "NSU-EMP-2001",
        },
        {
          email: "faculty2@northstar.example",
          name: "Marcus Feld",
          roleKey: "faculty",
          institutionalId: "NSU-EMP-2002",
        },
        {
          email: "student@northstar.example",
          name: "Jonah Lee",
          roleKey: "student",
          institutionalId: "NSU-STU-1001",
        },
        {
          email: "student2@northstar.example",
          name: "Aisha Rahman",
          roleKey: "student",
          institutionalId: "NSU-STU-1002",
        },
        {
          email: "student3@northstar.example",
          name: "Noah Andersen",
          roleKey: "student",
          institutionalId: "NSU-STU-1003",
        },
        {
          email: "student4@northstar.example",
          name: "Mei Tan",
          roleKey: "student",
          institutionalId: "NSU-STU-1004",
        },
        {
          email: "student5@northstar.example",
          name: "Luis Ortega",
          roleKey: "student",
          institutionalId: "NSU-STU-1005",
        },
      ],
    },
    {
      slug: "riverbend",
      name: "Riverbend College",
      timezone: "Africa/Nairobi",
      code: "RBC",
      people: [
        {
          email: "admin@riverbend.example",
          name: "Grace Mbeki",
          roleKey: "institution_admin",
          institutionalId: "RBC-EMP-1001",
        },
        {
          email: "faculty@riverbend.example",
          name: "Tomas Reyes",
          roleKey: "faculty",
          institutionalId: "RBC-EMP-2001",
        },
        {
          email: "student@riverbend.example",
          name: "Lena Fischer",
          roleKey: "student",
          institutionalId: "RBC-STU-1001",
        },
      ],
    },
  ];

  for (const seedTenant of tenants) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: seedTenant.slug },
      update: { name: seedTenant.name, status: "ACTIVE", timezone: seedTenant.timezone },
      create: {
        slug: seedTenant.slug,
        name: seedTenant.name,
        status: "ACTIVE",
        timezone: seedTenant.timezone,
        locale: "en",
      },
    });

    await prisma.institution.upsert({
      where: { tenantId: tenant.id },
      update: { name: seedTenant.name, code: seedTenant.code },
      create: { tenantId: tenant.id, name: seedTenant.name, code: seedTenant.code },
    });

    const roles = new Map<string, string>();
    for (const definition of TENANT_ROLES) {
      const role = await ensureRole(tenant.id, definition);
      roles.set(definition.key, role.id);
    }

    const people = new Map<string, string>();
    for (const person of seedTenant.people) {
      const user = await ensureUser(person.email, person.name);
      await ensureMembership(tenant.id, user.id, person.institutionalId);
      await ensureAssignment({
        tenantId: tenant.id,
        userId: user.id,
        roleId: roles.get(person.roleKey)!,
        scopeType: "TENANT",
      });
      people.set(person.email, user.id);
    }

    if (seedTenant.slug === "northstar") {
      const year = await ensureYear(tenant.id, "2026/27", "2026-08-01", "2027-06-30", "ACTIVE");
      const semester1 = await ensureTerm(
        tenant.id,
        year.id,
        "Semester 1",
        "2026-08-15",
        "2026-12-20",
      );
      const semester2 = await ensureTerm(
        tenant.id,
        year.id,
        "Semester 2",
        "2027-01-10",
        "2027-05-30",
      );
      const computerScience = await ensureDepartment(tenant.id, "Computer Science", "CS");
      const business = await ensureDepartment(tenant.id, "Business", "BUS");
      const bscs = await ensureProgramme(
        tenant.id,
        computerScience.id,
        "BSc Computer Science",
        "BSCS",
        "BACHELOR",
      );
      const bba = await ensureProgramme(
        tenant.id,
        business.id,
        "Bachelor of Business Administration",
        "BBA",
        "BACHELOR",
      );
      const csCohort = await ensureCohort(tenant.id, bscs.id, year.id, "2026 CS intake");
      const bbaCohort = await ensureCohort(tenant.id, bba.id, year.id, "2026 Business intake");
      const csSection = await ensureSection(tenant.id, csCohort.id, "A", 40);
      const bbaSection = await ensureSection(tenant.id, bbaCohort.id, "A", 35);

      const cs101 = await ensureCourse(
        tenant.id,
        "CS101",
        "Introduction to Programming",
        "4.0",
        "Variables, control flow, functions, and an introduction to data structures using a modern language.",
        "ACTIVE",
      );
      const bus101 = await ensureCourse(
        tenant.id,
        "BUS101",
        "Principles of Management",
        "3.0",
        "Organisational behaviour, planning, and the management functions in modern organisations.",
        "ACTIVE",
      );

      const csOffering = await ensureOffering(
        tenant.id,
        cs101.id,
        semester1.id,
        csSection.id,
        "PUBLISHED",
        "2026-08-20",
        "2026-12-10",
      );
      const busOffering = await ensureOffering(
        tenant.id,
        bus101.id,
        semester1.id,
        bbaSection.id,
        "DRAFT",
        "2026-08-22",
        "2026-12-12",
      );
      // Same catalogue course, next term, no section: catalogue and offering
      // are deliberately separate records.
      await ensureOffering(
        tenant.id,
        cs101.id,
        semester2.id,
        null,
        "DRAFT",
        "2027-01-15",
        "2027-05-20",
      );

      await ensureInstructor(
        tenant.id,
        csOffering.id,
        people.get("faculty@northstar.example")!,
        "PRIMARY",
      );
      await ensureInstructor(
        tenant.id,
        busOffering.id,
        people.get("faculty2@northstar.example")!,
        "PRIMARY",
      );

      const csStudents = [
        "student@northstar.example",
        "student2@northstar.example",
        "student3@northstar.example",
      ];
      for (const email of csStudents) {
        const userId = people.get(email)!;
        await ensureEnrolment(tenant.id, csOffering.id, userId);
        await ensureCohortMember(tenant.id, csCohort.id, userId);
      }
      for (const email of ["student4@northstar.example", "student5@northstar.example"]) {
        const userId = people.get(email)!;
        await ensureEnrolment(tenant.id, busOffering.id, userId);
        await ensureCohortMember(tenant.id, bbaCohort.id, userId);
      }

      // Published delivery for CS101: three modules, two of them released, one
      // still a draft so learners can see the difference.
      const welcome = await ensureModule(
        tenant.id,
        csOffering.id,
        "Week 1 · Getting started",
        1,
        "PUBLISHED",
        "How the course runs, what you need installed, and where to get help.",
      );
      await ensureContentItem({
        tenantId: tenant.id,
        moduleId: welcome.id,
        title: "How this course works",
        position: 1,
        kind: "RICH_TEXT",
        status: "PUBLISHED",
        body: "<h2>Welcome to CS101</h2><p>This course introduces programming through short lessons, weekly practice, and one small project. Each week builds on the previous one.</p><ul><li>Read the lesson before the practice task.</li><li>Mark a lesson complete when you have finished it; the next module unlocks when every lesson in this one is complete.</li><li>Ask questions in class rather than waiting until the assessment.</li></ul>",
      });
      await ensureContentItem({
        tenantId: tenant.id,
        moduleId: welcome.id,
        title: "Set up your tools",
        position: 2,
        kind: "LINK",
        status: "PUBLISHED",
        url: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started",
      });

      const controlFlow = await ensureModule(
        tenant.id,
        csOffering.id,
        "Week 2 · Control flow",
        2,
        "PUBLISHED",
        "Conditionals and loops, with practice tasks.",
      );
      await ensurePrerequisite(tenant.id, controlFlow.id, welcome.id);
      await ensureContentItem({
        tenantId: tenant.id,
        moduleId: controlFlow.id,
        title: "Reading: conditionals",
        position: 1,
        kind: "RICH_TEXT",
        status: "PUBLISHED",
        body: '<h2>Making decisions</h2><p>A conditional runs a block only when a test is true. Compare values with <code>===</code> rather than <code>==</code>, so the language does not convert types for you.</p><pre><code>if (score &gt;= 50) {\n  return "pass";\n} else {\n  return "resubmit";\n}</code></pre><p>Nested conditionals are a smell: prefer early returns and small functions.</p>',
      });
      await ensureContentItem({
        tenantId: tenant.id,
        moduleId: controlFlow.id,
        title: "Practice: FizzBuzz",
        position: 2,
        kind: "RICH_TEXT",
        status: "PUBLISHED",
        body: "<h2>Your task</h2><p>Print the numbers from 1 to 30. For multiples of three print <code>Fizz</code>, for multiples of five print <code>Buzz</code>, and for multiples of both print <code>FizzBuzz</code>.</p><ol><li>Write the loop first.</li><li>Add the two special cases, checking the combined case before either single case.</li><li>Run it and compare the first ten lines with the expected output.</li></ol>",
      });
      await ensureContentItem({
        tenantId: tenant.id,
        moduleId: controlFlow.id,
        title: "Sample video: loops explained",
        position: 3,
        kind: "VIDEO_LINK",
        status: "PUBLISHED",
        url: "https://example.com/sample-videos/loops",
      });

      const functions = await ensureModule(
        tenant.id,
        csOffering.id,
        "Week 3 · Functions and data",
        3,
        "DRAFT",
        "Still being written — learners cannot see this module yet.",
      );
      await ensurePrerequisite(tenant.id, functions.id, controlFlow.id);
      await ensureContentItem({
        tenantId: tenant.id,
        moduleId: functions.id,
        title: "Draft: functions and arguments",
        position: 1,
        kind: "RICH_TEXT",
        status: "DRAFT",
        body: "<p>Draft notes. This lesson is not visible to learners until it is published.</p>",
      });

      // Phase 6: one published assignment with a rubric and a resubmission
      // policy, plus a draft that learners cannot see.
      const practice = await ensureCourseAssignment({
        tenantId: tenant.id,
        offeringId: csOffering.id,
        title: "FizzBuzz practice",
        instructions:
          "Submit the FizzBuzz program from Week 2 as a single source file. It must print 1 to 30, replacing multiples of three with Fizz, multiples of five with Buzz, and multiples of both with FizzBuzz. Late work is accepted and flagged; one resubmission is allowed.",
        pointsPossible: 10,
        submissionType: "FILE",
        status: "PUBLISHED",
        dueAt: "2026-11-20T23:59:00.000Z",
        availableFrom: "2026-10-20T00:00:00.000Z",
        settings: { allowLateSubmission: true, allowResubmission: true, maxAttempts: 2 },
      });
      await ensureRubric(tenant.id, csOffering.id, practice.id, [
        {
          title: "Correct loop",
          points: 3,
          description: "Iterates from 1 to 30 exactly once, with no skipped or repeated numbers.",
        },
        {
          title: "FizzBuzz order",
          points: 4,
          description: "Checks the combined case before either single case.",
        },
        {
          title: "Readability",
          points: 3,
          description: "Clear names and no duplicated branches.",
        },
      ]);

      await ensureCourseAssignment({
        tenantId: tenant.id,
        offeringId: csOffering.id,
        title: "Draft: functions worksheet",
        instructions:
          "Draft task for Week 3. It is not visible to learners until the assignment is published.",
        pointsPossible: 20,
        submissionType: "TEXT",
        status: "DRAFT",
        dueAt: null,
        settings: { allowLateSubmission: false, allowResubmission: false, maxAttempts: 1 },
      });

      // Phase 9: the CS101 cohort has one past session and one upcoming one, so
      // the calendar, the session list, and the attendance roster all have data.
      await ensureLiveSession({
        tenantId: tenant.id,
        offeringId: csOffering.id,
        title: "Week 2 live class: control flow",
        startsAt: "2026-10-22T09:00:00.000Z",
        endsAt: "2026-10-22T10:30:00.000Z",
        joinUrl: "https://meet.example.com/cs101-week-2",
        createdByUserId: people.get("faculty@northstar.example")!,
      });
      await ensureLiveSession({
        tenantId: tenant.id,
        offeringId: csOffering.id,
        title: "Week 3 live class: functions",
        startsAt: "2026-11-06T09:00:00.000Z",
        endsAt: "2026-11-06T10:30:00.000Z",
        joinUrl: "https://meet.example.com/cs101-week-3",
        createdByUserId: people.get("faculty@northstar.example")!,
      });

      // ---------------------------------------------------------------------------
      // Quiz engine seed: CS101 question bank + published quiz
      // ---------------------------------------------------------------------------
      const qBank = await prisma.questionBank.upsert({
        where: {
          tenantId_offeringId_title: {
            tenantId: tenant.id,
            offeringId: csOffering.id,
            title: "CS101 question bank",
          },
        },
        update: {},
        create: { tenantId: tenant.id, offeringId: csOffering.id, title: "CS101 question bank" },
      });

      // Remove the single collapsed row that an earlier buggy seed id created.
      const legacyQuestionId = `seed-q-${qBank.id}`.slice(0, 30);
      await prisma.quizQuestionRef.deleteMany({ where: { questionId: legacyQuestionId } });
      await prisma.question.deleteMany({ where: { id: legacyQuestionId, bankId: qBank.id } });

      // Helper: upsert a question + one published version.
      // The helper stores the same normalized prompt/answer-key shape the add-question
      // form produces, so seed data is reusable by the real UI and the attempt engine.
      async function ensureQuestion(params: {
        bankId: string;
        title: string;
        type: QuestionType;
        stem: string;
        options?: Array<{ id: string; text: string }>;
        correctOptionId?: string;
        correctOptionIds?: string[];
        acceptedAnswers?: string[];
        points: number;
      }) {
        const promptJson: Record<string, unknown> = { stem: params.stem };
        if (params.options) {
          promptJson.options = params.options;
        }

        const answerKeyJson: Record<string, unknown> = {};
        if (params.type === "SINGLE_CHOICE" || params.type === "TRUE_FALSE") {
          if (params.correctOptionId) answerKeyJson.correctOptionId = params.correctOptionId;
        } else if (params.type === "MULTI_SELECT") {
          if (params.correctOptionIds?.length)
            answerKeyJson.correctOptionIds = params.correctOptionIds;
        } else if (params.type === "SHORT_ANSWER" || params.type === "FILL_BLANK") {
          if (params.acceptedAnswers?.length)
            answerKeyJson.acceptedAnswers = params.acceptedAnswers;
        }

        // Stable, unique per question: truncating this used to collapse every
        // question of one bank onto the same id.
        const id = `seed-q-${params.bankId}-${params.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        const q = await prisma.question.upsert({
          where: { id },
          update: {},
          create: {
            id,
            tenantId: tenant.id,
            bankId: params.bankId,
            type: params.type,
            title: params.title,
            promptJson: promptJson as Prisma.InputJsonValue,
            answerKeyJson: answerKeyJson as Prisma.InputJsonValue,
            points: params.points,
            status: "PUBLISHED",
            currentVersion: 1,
          },
        });
        await prisma.questionVersion.upsert({
          where: { questionId_version: { questionId: q.id, version: 1 } },
          update: {},
          create: {
            tenantId: tenant.id,
            questionId: q.id,
            version: 1,
            type: params.type,
            promptJson: promptJson as Prisma.InputJsonValue,
            answerKeyJson: answerKeyJson as Prisma.InputJsonValue,
            points: params.points,
          },
        });
        return q;
      }

      const q1 = await ensureQuestion({
        bankId: qBank.id,
        title: "Variables definition",
        type: "SINGLE_CHOICE",
        stem: "What is a variable in programming?",
        options: [
          { id: "opt_a", text: "A fixed constant that never changes" },
          { id: "opt_b", text: "A named storage location that holds a value" },
          { id: "opt_c", text: "A type of loop structure" },
          { id: "opt_d", text: "A function parameter only" },
        ],
        correctOptionId: "opt_b",
        points: 2,
      });

      const q2 = await ensureQuestion({
        bankId: qBank.id,
        title: "Python list mutability",
        type: "TRUE_FALSE",
        stem: "In Python, a list is a mutable data structure.",
        options: [
          { id: "opt_true", text: "True" },
          { id: "opt_false", text: "False" },
        ],
        correctOptionId: "opt_true",
        points: 1,
      });

      const q3 = await ensureQuestion({
        bankId: qBank.id,
        title: "Loop types",
        type: "SINGLE_CHOICE",
        stem: "Which of the following is NOT a loop type in Python?",
        options: [
          { id: "opt_for", text: "for" },
          { id: "opt_while", text: "while" },
          { id: "opt_dowhile", text: "do-while" },
          { id: "opt_none", text: "None of the above" },
        ],
        correctOptionId: "opt_dowhile",
        points: 2,
      });

      const q4 = await ensureQuestion({
        bankId: qBank.id,
        title: "Function purpose essay",
        type: "ESSAY",
        stem: "In 3–5 sentences, explain why functions are useful in programming and give one example of when you would use a function.",
        points: 3,
      });

      const q5 = await ensureQuestion({
        bankId: qBank.id,
        title: "If statement short answer",
        type: "SHORT_ANSWER",
        stem: "Write a Python if-statement that prints 'Pass' if a variable `score` is greater than or equal to 50.",
        acceptedAnswers: ["if score >= 50:\n    print('Pass')", "if score>=50:\n    print('Pass')"],
        points: 2,
      });

      // Drop the quiz row an earlier truncated seed id created.
      await prisma.quiz.deleteMany({
        where: { id: `seed-quiz-cs101-${tenant.id}`.slice(0, 30), offeringId: csOffering.id },
      });

      // Upsert the quiz
      const quiz = await prisma.quiz.upsert({
        where: { id: `seed-quiz-cs101-${tenant.id}` },
        update: {},
        create: {
          id: `seed-quiz-cs101-${tenant.id}`,
          tenantId: tenant.id,
          offeringId: csOffering.id,
          title: "CS101 Week 1 Quiz",
          instructions:
            "Answer all questions. The quiz closes 60 minutes after you start. You have one attempt.",
          settings: {
            timeLimitMinutes: 60,
            attemptLimit: 1,
            shuffleQuestions: false,
            shuffleOptions: false,
            passMark: 60,
            releasePolicy: "manual",
          },
          status: "PUBLISHED",
          version: 1,
        },
      });

      // Quiz question refs
      for (const [pos, q] of [
        [1, q1],
        [2, q2],
        [3, q3],
        [4, q4],
        [5, q5],
      ] as const) {
        await prisma.quizQuestionRef.upsert({
          where: { quizId_questionId: { quizId: quiz.id, questionId: q.id } },
          update: {},
          create: {
            tenantId: tenant.id,
            quizId: quiz.id,
            questionId: q.id,
            position: pos,
          },
        });
      }

      // BUS101 is a draft offering: its content exists but no learner can open it.
      const busModule = await ensureModule(
        tenant.id,
        busOffering.id,
        "Week 1 · Management foundations",
        1,
        "DRAFT",
        "Being prepared for next term.",
      );
      await ensureContentItem({
        tenantId: tenant.id,
        moduleId: busModule.id,
        title: "Draft: what managers actually do",
        position: 1,
        kind: "RICH_TEXT",
        status: "DRAFT",
        body: "<p>Draft lesson for the management course.</p>",
      });
    } else {
      const year = await ensureYear(tenant.id, "2026", "2026-09-01", "2027-06-30", "ACTIVE");
      const term1 = await ensureTerm(tenant.id, year.id, "Term 1", "2026-09-10", "2026-12-18");
      const arts = await ensureDepartment(tenant.id, "Arts and Sciences", "AS");
      const dla = await ensureProgramme(
        tenant.id,
        arts.id,
        "Diploma in Liberal Arts",
        "DLA",
        "DIPLOMA",
      );
      const cohort = await ensureCohort(tenant.id, dla.id, year.id, "2026 intake");
      const section = await ensureSection(tenant.id, cohort.id, "A", 30);

      const lit101 = await ensureCourse(
        tenant.id,
        "LIT101",
        "Literature Survey",
        "3.0",
        "Close reading across genres, with an emphasis on argument and evidence.",
        "ACTIVE",
      );
      await ensureCourse(
        tenant.id,
        "ENG101",
        "Academic Writing",
        "3.0",
        "Planning, drafting, and revising academic essays.",
        "ACTIVE",
      );
      const litOffering = await ensureOffering(
        tenant.id,
        lit101.id,
        term1.id,
        section.id,
        "PUBLISHED",
        "2026-09-15",
        "2026-12-10",
      );
      await ensureInstructor(
        tenant.id,
        litOffering.id,
        people.get("faculty@riverbend.example")!,
        "PRIMARY",
      );
      const riverbendStudent = people.get("student@riverbend.example")!;
      await ensureEnrolment(tenant.id, litOffering.id, riverbendStudent);
      await ensureCohortMember(tenant.id, cohort.id, riverbendStudent);

      const litModule = await ensureModule(
        tenant.id,
        litOffering.id,
        "Week 1 · Close reading",
        1,
        "PUBLISHED",
        "Reading a short passage closely, then writing about what the text does.",
      );
      await ensureContentItem({
        tenantId: tenant.id,
        moduleId: litModule.id,
        title: "Reading: the first paragraph",
        position: 1,
        kind: "RICH_TEXT",
        status: "PUBLISHED",
        body: "<h2>Read slowly</h2><p>Read the opening paragraph twice. First for what happens, then for how the sentences are built. Note one word that seems chosen rather than inevitable.</p><blockquote>Close reading is an argument about evidence, not a summary.</blockquote>",
      });
      await ensureContentItem({
        tenantId: tenant.id,
        moduleId: litModule.id,
        title: "Reference: literary terms",
        position: 2,
        kind: "LINK",
        status: "PUBLISHED",
        url: "https://www.poetryfoundation.org/learn/glossary-terms",
      });
    }

    if (seedTenant.slug === "northstar") {
      // Phase 10: OBE definitions for the CS programme and CS101's own course
      // outcomes. Correlations and evidence are seeded under the default 1-3
      // scale; the policy stays unconfigured so no attainment value is implied.
      const obeProgramme = await prisma.programme.findFirst({
        where: { tenantId: tenant.id, code: "BSCS" },
        select: { id: true },
      });
      const obeOffering = await prisma.courseOffering.findFirst({
        where: { tenantId: tenant.id, course: { code: "CS101" }, sectionId: { not: null } },
        select: { id: true },
      });
      if (obeProgramme && obeOffering) {
        const programmeOutcomeSeeds = [
          {
            type: "PEO" as const,
            code: "PEO1",
            title: "Graduates apply computing to real problems in their first professional role.",
          },
          {
            type: "PO" as const,
            code: "PO1",
            title: "Design and implement correct programs from a written specification.",
          },
          {
            type: "PO" as const,
            code: "PO2",
            title: "Analyse a problem and justify an algorithmic approach.",
          },
          {
            type: "PO" as const,
            code: "PO3",
            title: "Communicate technical decisions to a non-specialist audience.",
          },
          {
            type: "PSO" as const,
            code: "PSO1",
            title: "Build and test software with modern tooling and version control.",
          },
        ] as const;
        const programmeOutcomes = new Map<string, string>();
        for (const [index, outcome] of programmeOutcomeSeeds.entries()) {
          const record = await prisma.programmeOutcome.upsert({
            where: {
              programmeId_type_code: {
                programmeId: obeProgramme.id,
                type: outcome.type,
                code: outcome.code,
              },
            },
            update: { title: outcome.title, position: index + 1 },
            create: {
              tenantId: tenant.id,
              programmeId: obeProgramme.id,
              type: outcome.type,
              code: outcome.code,
              title: outcome.title,
              position: index + 1,
            },
          });
          programmeOutcomes.set(outcome.code, record.id);
        }

        const courseOutcomeSeeds = [
          {
            code: "CO1",
            title: "Declare variables and predict the effect of assignments and expressions.",
          },
          { code: "CO2", title: "Trace and write control flow with conditions and loops." },
          {
            code: "CO3",
            title: "Decompose a problem into functions with clear inputs and outputs.",
          },
          { code: "CO4", title: "Test a program and explain a failing case." },
        ] as const;
        const courseOutcomes = new Map<string, string>();
        for (const [index, outcome] of courseOutcomeSeeds.entries()) {
          const record = await prisma.courseOutcome.upsert({
            where: { offeringId_code: { offeringId: obeOffering.id, code: outcome.code } },
            update: { title: outcome.title, position: index + 1 },
            create: {
              tenantId: tenant.id,
              offeringId: obeOffering.id,
              code: outcome.code,
              title: outcome.title,
              position: index + 1,
            },
          });
          courseOutcomes.set(outcome.code, record.id);
        }

        const correlationSeeds = [
          ["CO1", "PO1", 3],
          ["CO2", "PO1", 2],
          ["CO2", "PO2", 3],
          ["CO3", "PO2", 3],
          ["CO3", "PSO1", 3],
          ["CO4", "PO3", 2],
        ] as const;
        for (const [coCode, poCode, level] of correlationSeeds) {
          await prisma.outcomeMapping.upsert({
            where: {
              courseOutcomeId_programmeOutcomeId: {
                courseOutcomeId: courseOutcomes.get(coCode)!,
                programmeOutcomeId: programmeOutcomes.get(poCode)!,
              },
            },
            update: { correlationLevel: level },
            create: {
              tenantId: tenant.id,
              courseOutcomeId: courseOutcomes.get(coCode)!,
              programmeOutcomeId: programmeOutcomes.get(poCode)!,
              correlationLevel: level,
            },
          });
        }

        const seededAssignment = await prisma.assignment.findFirst({
          where: { tenantId: tenant.id, offeringId: obeOffering.id },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (seededAssignment) {
          await prisma.assessmentOutcomeMapping.upsert({
            where: {
              courseOutcomeId_assignmentId: {
                courseOutcomeId: courseOutcomes.get("CO1")!,
                assignmentId: seededAssignment.id,
              },
            },
            update: {},
            create: {
              tenantId: tenant.id,
              courseOutcomeId: courseOutcomes.get("CO1")!,
              kind: "ASSIGNMENT",
              assignmentId: seededAssignment.id,
              weight: 1,
            },
          });
        }

        const seededQuestion = await prisma.question.findFirst({
          where: { tenantId: tenant.id, bank: { offeringId: obeOffering.id } },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (seededQuestion) {
          await prisma.assessmentOutcomeMapping.upsert({
            where: {
              courseOutcomeId_questionId: {
                courseOutcomeId: courseOutcomes.get("CO2")!,
                questionId: seededQuestion.id,
              },
            },
            update: {},
            create: {
              tenantId: tenant.id,
              courseOutcomeId: courseOutcomes.get("CO2")!,
              kind: "QUESTION",
              questionId: seededQuestion.id,
              weight: 1,
            },
          });
        }

        const seededPolicy = await prisma.attainmentPolicy.findFirst({
          where: { tenantId: tenant.id, name: "Institution attainment policy" },
          select: { id: true },
        });
        if (!seededPolicy) {
          await prisma.attainmentPolicy.create({
            data: {
              tenantId: tenant.id,
              name: "Institution attainment policy",
              version: 1,
              status: "ACTIVE",
              activatedAt: new Date("2026-08-01T00:00:00Z"),
              notes:
                "Sample policy. Direct and indirect methods stay unconfigured until this institution confirms its formula.",
              configuration: {
                correlationScale: [
                  { level: 1, label: "Slight", code: "L" },
                  { level: 2, label: "Moderate", code: "M" },
                  { level: 3, label: "Substantial", code: "H" },
                ],
                rounding: { decimalPlaces: 2 },
                missingData: "insufficient_evidence",
                directMethod: {
                  status: "unconfigured",
                  description:
                    "Direct attainment is not calculated until the institution confirms a formula.",
                },
                indirectMethod: {
                  status: "unconfigured",
                  description:
                    "Indirect attainment is not calculated until the institution confirms a formula.",
                },
                thresholds: { courseOutcome: null, programmeOutcome: null },
              },
            },
          });
        }
      }
    }

    // Phase 11: completion rules and one sample certificate for the demo course.
    const certificateOffering = await prisma.courseOffering.findFirst({
      where: { tenantId: tenant.id, course: { code: "CS101" }, sectionId: { not: null } },
      select: { id: true, settings: true, course: { select: { code: true, title: true } } },
    });
    if (certificateOffering) {
      const offeringSettings =
        certificateOffering.settings &&
        typeof certificateOffering.settings === "object" &&
        !Array.isArray(certificateOffering.settings)
          ? (certificateOffering.settings as Record<string, unknown>)
          : {};
      const completionRules = {
        requireAllPublishedContent: true,
        minContentPercent: 50,
        requirePublishedAssignments: false,
        requirePublishedQuizzes: false,
        minReleasedGradePercent: null,
      };
      await prisma.courseOffering.update({
        where: { id: certificateOffering.id },
        data: { settings: { ...offeringSettings, completion: completionRules } },
      });

      const certificateStudent = await prisma.user.findFirst({
        where: { email: `student@${seedTenant.slug}.example`, status: "ACTIVE" },
        select: { id: true, name: true },
      });
      if (certificateStudent) {
        const institution = await prisma.institution.findFirst({
          where: { tenantId: tenant.id },
          select: { name: true },
        });
        const certificateNumber = `CERT-2026-DEMO-${tenant.id.slice(-6).toUpperCase()}`;
        await prisma.certificate.upsert({
          where: { certificateNumber },
          update: {},
          create: {
            tenantId: tenant.id,
            courseOfferingId: certificateOffering.id,
            userId: certificateStudent.id,
            certificateNumber,
            verificationToken: `verify-demo-${seedTenant.slug}-cs101`,
            learnerName: certificateStudent.name,
            courseCode: certificateOffering.course.code,
            courseTitle: certificateOffering.course.title,
            institutionName: institution?.name ?? seedTenant.name,
            issuerName: institution?.name ?? seedTenant.name,
            ruleSnapshot: completionRules,
            evidenceSnapshot: {
              publishedContentItems: 6,
              completedContentItems: 6,
              publishedAssignments: 1,
              submittedAssignments: 1,
              publishedQuizzes: 1,
              submittedQuizzes: 1,
              releasedGradePercent: 82,
              contentPercent: 100,
              seeded: true,
            },
            issuedAt: new Date("2026-10-30T09:00:00Z"),
          },
        });
      }
    }

    console.log(
      `Seeded ${seedTenant.name}: ${people.size} people, ${roles.size} roles, academic structure`,
    );
  }

  const platformAdmin = await ensureUser("platform@lms.example", "Priya Raman");
  await ensureAssignment({
    tenantId: null,
    userId: platformAdmin.id,
    roleId: platformRoles.get("platform_super_admin")!,
    scopeType: "PLATFORM",
  });

  console.log(`Permission catalogue: ${PERMISSIONS.length} permissions`);
  console.log(
    "Demo accounts now have credentials; the password comes from SEED_DEMO_PASSWORD (documented default for local use only).",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
