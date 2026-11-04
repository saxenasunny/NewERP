import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildAccountContext, type AccountContext } from "@/lib/auth/account";
import { ConflictError, PermissionDeniedError, ResourceNotFoundError } from "@/lib/errors";
import {
  addInstructor,
  createCourse,
  createOffering,
  enrolStudent,
} from "@/modules/academics/course-service";
import { createAcademicYear, createTerm } from "@/modules/academics/structure-service";
import {
  createQuestion,
  createBank,
  deleteQuestion,
  getCurrentVersion,
  listQuestions,
  publishQuestion,
  questionFormToCreateInput,
} from "@/modules/quizzes/bank-service";
import {
  autosave,
  finaliseAttempt,
  getAttemptForLearner,
  gradeEssayItem,
  listUngradedEssays,
  startAttempt,
} from "@/modules/quizzes/attempt-engine";
import { publishCourse } from "@/modules/content/content-service";
import {
  addQuestionRef,
  archiveQuiz,
  createQuiz,
  getQuiz,
  listQuizzes,
  publishQuiz,
  releaseResults,
} from "@/modules/quizzes/quiz-service";

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
    "Skipping quiz tests: no PostgreSQL test database (set TEST_DATABASE_URL to a *_test database).",
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

let north: TenantFixture;
let south: TenantFixture;
let faculty: AccountContext;
let student: AccountContext;
let southFaculty: AccountContext;
let offeringId: string;

beforeEach(async () => {
  await resetDatabase();
  await seedPermissions();

  north = await createTenantFixture({ slug: "north", name: "North University", code: "NU" });
  south = await createTenantFixture({ slug: "south", name: "South College", code: "SC" });

  const admin = await accountFor(north.admin.userId, north.tenantId);
  faculty = await accountFor(north.faculty.userId, north.tenantId);
  student = await accountFor(north.student.userId, north.tenantId);
  southFaculty = await accountFor(south.faculty.userId, south.tenantId);

  const year = await createAcademicYear(
    admin,
    { name: "2026/27", startsOn: "2026-08-01", endsOn: "2027-06-30" },
    { requestId: "req-quiz" },
  );
  const term = await createTerm(
    admin,
    {
      academicYearId: year.id,
      name: "Semester 1",
      startsOn: "2026-08-15",
      endsOn: "2026-12-20",
    },
    { requestId: "req-quiz" },
  );
  const course = await createCourse(
    admin,
    { code: "CS101", title: "Introduction to Programming", credits: 3 },
    { requestId: "req-quiz" },
  );
  const offering = await createOffering(
    admin,
    { courseId: course.id, termId: term.id, status: "DRAFT" },
    { requestId: "req-quiz" },
  );
  offeringId = offering.id;

  await addInstructor(
    admin,
    {
      courseOfferingId: offeringId,
      email: `faculty@${north.slug}.example`,
      assignmentRole: "PRIMARY",
    },
    { requestId: "req-quiz" },
  );
  await enrolStudent(
    admin,
    { courseOfferingId: offeringId, email: `student@${north.slug}.example` },
    { requestId: "req-quiz" },
  );

  // Learners reach a quiz only through a published offering.
  await publishCourse(faculty, offeringId, { requestId: "req-quiz" });
});

afterAll(async () => {
  await disconnectTestDb();
});

/** Creates a published bank with one question per scored type plus an essay. */
async function seedBank() {
  const bank = await createBank(faculty, { title: "Week 1 bank", courseOfferingId: offeringId });

  const single = questionFormToCreateInput(
    {
      questionType: "single_choice",
      title: "Variable definition",
      points: 2,
      stem: "What is a variable?",
      options: [
        { id: "opt_0", text: "A fixed constant" },
        { id: "opt_1", text: "A named storage location" },
      ],
      correctOptionId: "opt_1",
    },
    bank.id,
  );
  const multi = questionFormToCreateInput(
    {
      questionType: "multi_select",
      title: "Mutable types",
      points: 2,
      stem: "Which of these are mutable?",
      options: [
        { id: "opt_0", text: "list" },
        { id: "opt_1", text: "tuple" },
        { id: "opt_2", text: "dict" },
      ],
      correctOptionIds: ["opt_0", "opt_2"],
    },
    bank.id,
  );
  const blank = questionFormToCreateInput(
    {
      questionType: "fill_blank",
      title: "Loop keyword",
      points: 1,
      stem: "The keyword that starts a loop over a range is ____.",
      acceptedAnswers: ["for"],
    },
    bank.id,
  );
  const essay = questionFormToCreateInput(
    {
      questionType: "essay",
      title: "Functions essay",
      points: 3,
      stem: "Explain why functions are useful.",
    },
    bank.id,
  );

  const created = [];
  for (const input of [single, multi, blank, essay]) {
    created.push(await createQuestion(faculty, input));
  }

  return { bank, single: created[0]!, multi: created[1]!, blank: created[2]!, essay: created[3]! };
}

async function seedQuiz(questionIds: string[]) {
  const quiz = await createQuiz(faculty, {
    courseOfferingId: offeringId,
    title: "Week 1 quiz",
    instructions: "Answer every question.",
    settings: {
      timeLimitMinutes: 30,
      attemptLimit: 1,
      releasePolicy: "manual",
      passMark: 60,
    },
  });

  for (const questionId of questionIds) {
    await addQuestionRef(faculty, quiz.id, { questionId });
  }
  return quiz;
}

describeDb("quizzes and question banks (PostgreSQL)", () => {
  it("publishes a bank question and refuses a quiz holding a draft question", async () => {
    const { bank, single, multi, blank, essay } = await seedBank();

    const questions = await listQuestions(faculty, bank.id);
    expect(questions).toHaveLength(4);
    expect(questions.every((question) => question.status === "DRAFT")).toBe(true);

    // A draft question cannot be added to a quiz: there is no published snapshot.
    await expect(getCurrentVersion(north.tenantId, single.id)).rejects.toBeInstanceOf(
      ConflictError,
    );

    for (const question of [single, multi, blank, essay]) {
      await publishQuestion(faculty, question.id);
    }

    const version = await getCurrentVersion(north.tenantId, single.id);
    expect(version.version).toBe(1);
    expect(version.answerKeyJson).toMatchObject({ correctOptionId: "opt_1" });

    const quiz = await seedQuiz([single.id, multi.id, blank.id, essay.id]);
    expect(quiz.status).toBe("DRAFT");

    // Publishing requires every referenced question to be published.
    const draftQuestion = await createQuestion(
      faculty,
      questionFormToCreateInput(
        {
          questionType: "fill_blank",
          title: "Unpublished",
          points: 1,
          stem: "Draft question.",
          acceptedAnswers: ["draft"],
        },
        bank.id,
      ),
    );
    // An unpublished question is refused before it can reach a quiz.
    await expect(
      addQuestionRef(faculty, quiz.id, { questionId: draftQuestion.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    await deleteQuestion(faculty, draftQuestion.id);

    const published = await publishQuiz(faculty, quiz.id);
    expect(published.status).toBe("PUBLISHED");

    // Archiving removes it from the learner's list.
    await archiveQuiz(faculty, quiz.id);
    const listed = await listQuizzes(faculty, offeringId);
    expect(listed[0]?.status).toBe("ARCHIVED");
  });

  it("runs an attempt: autosave survives, objective items are scored, essays queue for grading", async () => {
    const { single, multi, blank, essay } = await seedBank();
    for (const question of [single, multi, blank, essay]) {
      await publishQuestion(faculty, question.id);
    }
    const quiz = await seedQuiz([single.id, multi.id, blank.id, essay.id]);
    await publishQuiz(faculty, quiz.id);

    const attempt = await startAttempt(student, quiz.id);
    expect(attempt.status).toBe("in_progress");
    expect(attempt.deadlineAt).not.toBeNull();
    expect(attempt.items).toHaveLength(4);
    expect(attempt.showResults).toBe(false);

    const byQuestion = new Map(
      [single, multi, blank, essay].map((question, index) => [question.id, attempt.items[index]!]),
    );
    const singleItem = byQuestion.get(single.id)!;
    const multiItem = byQuestion.get(multi.id)!;
    const blankItem = byQuestion.get(blank.id)!;
    const essayItem = byQuestion.get(essay.id)!;

    const saved = await autosave(student, attempt.id, [
      { attemptItemId: singleItem.id, answerJson: { selectedOptionId: "opt_1" } },
      {
        attemptItemId: multiItem.id,
        answerJson: { selectedOptionIds: ["opt_0", "opt_2"] },
      },
      { attemptItemId: blankItem.id, answerJson: { text: "FOR" } },
      {
        attemptItemId: essayItem.id,
        answerJson: { text: "Functions avoid repetition and name behaviour." },
      },
    ]);
    expect(saved.saved).toBe(4);

    // Autosave is durable: a fresh read returns every answer.
    const reread = await getAttemptForLearner(student, attempt.id);
    const rereadSingle = reread.items.find((item) => item.id === singleItem.id)!;
    expect(rereadSingle.answer.selectedOptionId).toBe("opt_1");
    const rereadMulti = reread.items.find((item) => item.id === multiItem.id)!;
    expect(rereadMulti.answer.selectedOptionIds).toEqual(["opt_0", "opt_2"]);

    // A second in-progress start resumes rather than creating another attempt.
    const resumed = await startAttempt(student, quiz.id);
    expect(resumed.id).toBe(attempt.id);

    const finalised = await finaliseAttempt(student, attempt.id, "submitted");
    expect(finalised.status).toBe("submitted");
    // Manual release policy hides the score from the learner payload.
    expect(finalised.showResults).toBe(false);
    expect(finalised.score).toBeNull();

    // The stored total is the objective 2 + 2 + 1; the essay is still unscored.
    const stored = await testDb().quizAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(Number(stored.score)).toBe(5);

    // Submitting twice is idempotent.
    const again = await finaliseAttempt(student, attempt.id, "submitted");
    expect(again.status).toBe("submitted");
    const storedAgain = await testDb().quizAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(Number(storedAgain.score)).toBe(5);

    const queue = await listUngradedEssays(faculty, quiz.id);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.items).toHaveLength(1);

    await gradeEssayItem(faculty, attempt.id, {
      attemptItemId: essayItem.id,
      score: 3,
      feedback: "Clear and correct.",
    });

    const graded = await getAttemptForLearner(student, attempt.id);
    expect(graded.status).toBe("graded");
    // Results stay hidden until the instructor releases them.
    expect(graded.showResults).toBe(false);
    expect(graded.score).toBeNull();

    await releaseResults(faculty, quiz.id);

    const released = await getAttemptForLearner(student, attempt.id);
    expect(released.showResults).toBe(true);
    expect(released.score).toBe(8);
    const releasedEssay = released.items.find((item) => item.id === essayItem.id)!;
    expect(releasedEssay.score).toBe(3);
    expect(releasedEssay.feedback).toBe("Clear and correct.");

    await expect(listUngradedEssays(faculty, quiz.id)).resolves.toHaveLength(0);

    // The attempt limit of one is enforced on a completed quiz.
    await expect(startAttempt(student, quiz.id)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("keeps banks, quizzes, and attempts inside their institution", async () => {
    const { bank, single } = await seedBank();
    await publishQuestion(faculty, single.id);
    const quiz = await seedQuiz([single.id]);
    await publishQuiz(faculty, quiz.id);

    // Another institution sees neither the bank nor the quiz.
    await expect(getQuiz(southFaculty, quiz.id)).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(listQuestions(southFaculty, bank.id)).resolves.toHaveLength(0);
    await expect(getCurrentVersion(south.tenantId, single.id)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );

    // A learner without an active enrolment cannot reach the quiz.
    const outsider = await testDb().user.create({
      data: {
        email: `outsider@${north.slug}.example`,
        name: "Outsider",
        status: "ACTIVE",
        emailVerified: true,
      },
    });
    await testDb().tenantMembership.create({
      data: {
        tenantId: north.tenantId,
        userId: outsider.id,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });
    const outsiderRole = await testDb().role.findFirstOrThrow({
      where: { tenantId: north.tenantId, key: "student" },
    });
    await testDb().userRoleAssignment.create({
      data: {
        tenantId: north.tenantId,
        userId: outsider.id,
        roleId: outsiderRole.id,
        scopeType: "TENANT",
      },
    });
    const outsiderAccount = await accountFor(outsider.id, north.tenantId);

    const { getLearnerQuiz } = await import("@/modules/quizzes/quiz-service");
    await expect(getLearnerQuiz(outsiderAccount, quiz.id)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );

    // An enrolled learner still cannot start a draft quiz.
    const draft = await createQuiz(faculty, {
      courseOfferingId: offeringId,
      title: "Draft quiz",
    });
    await addQuestionRef(faculty, draft.id, { questionId: single.id });
    await expect(startAttempt(student, draft.id)).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
