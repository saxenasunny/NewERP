-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('single_choice', 'multi_select', 'true_false', 'short_answer', 'fill_blank', 'essay');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "QuizAttemptStatus" AS ENUM ('in_progress', 'submitted', 'timed_out', 'graded');

-- CreateEnum
CREATE TYPE "QuizEventType" AS ENUM ('started', 'autosaved', 'submitted', 'timed_out', 'finalised', 'graded', 'released');

-- CreateTable
CREATE TABLE "question_banks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "course_offering_id" TEXT,
    "title" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "question_bank_id" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "title" TEXT NOT NULL,
    "prompt_json" JSONB NOT NULL,
    "answer_key_json" JSONB NOT NULL,
    "points" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "status" "QuestionStatus" NOT NULL DEFAULT 'draft',
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt_json" JSONB NOT NULL,
    "answer_key_json" JSONB NOT NULL,
    "points" DECIMAL(6,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quizzes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "available_from" TIMESTAMP(3),
    "available_until" TIMESTAMP(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" "QuizStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_question_refs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "quiz_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "points_override" DECIMAL(6,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_question_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "quiz_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "QuizAttemptStatus" NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMP(3) NOT NULL,
    "deadline_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "score" DECIMAL(6,2),
    "points_possible" DECIMAL(6,2) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempt_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "quiz_attempt_id" TEXT NOT NULL,
    "question_version_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "option_order" JSONB NOT NULL,
    "points_possible" DECIMAL(6,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_attempt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_answers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "quiz_attempt_item_id" TEXT NOT NULL,
    "answer_json" JSONB NOT NULL DEFAULT '{}',
    "saved_at" TIMESTAMP(3),
    "score" DECIMAL(6,2),
    "feedback" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "quiz_attempt_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "type" "QuizEventType" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "question_banks_tenant_id_course_offering_id_title_key" ON "question_banks"("tenant_id", "course_offering_id", "title");
CREATE INDEX "question_banks_tenant_id_course_offering_id_idx" ON "question_banks"("tenant_id", "course_offering_id");

CREATE INDEX "questions_tenant_id_question_bank_id_idx" ON "questions"("tenant_id", "question_bank_id");
CREATE INDEX "questions_tenant_id_status_idx" ON "questions"("tenant_id", "status");

CREATE UNIQUE INDEX "question_versions_question_id_version_key" ON "question_versions"("question_id", "version");
CREATE INDEX "question_versions_tenant_id_question_id_idx" ON "question_versions"("tenant_id", "question_id");

CREATE INDEX "quizzes_tenant_id_course_offering_id_idx" ON "quizzes"("tenant_id", "course_offering_id");
CREATE INDEX "quizzes_tenant_id_status_idx" ON "quizzes"("tenant_id", "status");

CREATE UNIQUE INDEX "quiz_question_refs_quiz_id_question_id_key" ON "quiz_question_refs"("quiz_id", "question_id");
CREATE UNIQUE INDEX "quiz_question_refs_quiz_id_position_key" ON "quiz_question_refs"("quiz_id", "position");
CREATE INDEX "quiz_question_refs_tenant_id_quiz_id_idx" ON "quiz_question_refs"("tenant_id", "quiz_id");

CREATE UNIQUE INDEX "quiz_attempts_quiz_id_user_id_attempt_number_key" ON "quiz_attempts"("quiz_id", "user_id", "attempt_number");
CREATE UNIQUE INDEX "quiz_attempts_one_in_progress" ON "quiz_attempts"("quiz_id", "user_id") WHERE "status" = 'in_progress';
CREATE INDEX "quiz_attempts_tenant_id_quiz_id_idx" ON "quiz_attempts"("tenant_id", "quiz_id");
CREATE INDEX "quiz_attempts_tenant_id_user_id_idx" ON "quiz_attempts"("tenant_id", "user_id");

CREATE UNIQUE INDEX "quiz_attempt_items_quiz_attempt_id_position_key" ON "quiz_attempt_items"("quiz_attempt_id", "position");
CREATE UNIQUE INDEX "quiz_attempt_items_quiz_attempt_id_question_version_id_key" ON "quiz_attempt_items"("quiz_attempt_id", "question_version_id");
CREATE INDEX "quiz_attempt_items_tenant_id_quiz_attempt_id_idx" ON "quiz_attempt_items"("tenant_id", "quiz_attempt_id");

CREATE UNIQUE INDEX "quiz_answers_quiz_attempt_item_id_key" ON "quiz_answers"("quiz_attempt_item_id");
CREATE INDEX "quiz_answers_tenant_id_idx" ON "quiz_answers"("tenant_id");

CREATE INDEX "quiz_events_quiz_attempt_id_occurred_at_idx" ON "quiz_events"("quiz_attempt_id", "occurred_at");
CREATE INDEX "quiz_events_tenant_id_type_idx" ON "quiz_events"("tenant_id", "type");

ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "questions" ADD CONSTRAINT "questions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "questions" ADD CONSTRAINT "questions_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "question_banks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quiz_question_refs" ADD CONSTRAINT "quiz_question_refs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiz_question_refs" ADD CONSTRAINT "quiz_question_refs_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiz_question_refs" ADD CONSTRAINT "quiz_question_refs_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quiz_attempt_items" ADD CONSTRAINT "quiz_attempt_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiz_attempt_items" ADD CONSTRAINT "quiz_attempt_items_quiz_attempt_id_fkey" FOREIGN KEY ("quiz_attempt_id") REFERENCES "quiz_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiz_attempt_items" ADD CONSTRAINT "quiz_attempt_items_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "question_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_quiz_attempt_item_id_fkey" FOREIGN KEY ("quiz_attempt_item_id") REFERENCES "quiz_attempt_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quiz_events" ADD CONSTRAINT "quiz_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiz_events" ADD CONSTRAINT "quiz_events_quiz_attempt_id_fkey" FOREIGN KEY ("quiz_attempt_id") REFERENCES "quiz_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiz_events" ADD CONSTRAINT "quiz_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
