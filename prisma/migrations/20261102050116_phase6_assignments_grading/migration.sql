-- Phase 6: assignments, submissions, grades, and rubric criteria.
-- Every tenant-owned row is scoped by tenant_id directly.
-- Submission text versions and audit events support overwrite-safe grading.

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('draft', 'submitted', 'late', 'graded');

-- CreateEnum
CREATE TYPE "GradeStatus" AS ENUM ('ungraded', 'draft', 'released');

-- CreateEnum
CREATE TYPE "AssignmentSubmissionType" AS ENUM ('text', 'file', 'link', 'text_and_file');

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "due_at" TIMESTAMPTZ(3),
    "available_from" TIMESTAMPTZ(3),
    "available_until" TIMESTAMPTZ(3),
    "points_possible" DECIMAL NOT NULL DEFAULT 10,
    "submission_types" "AssignmentSubmissionType" NOT NULL DEFAULT 'text',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" "AssignmentStatus" NOT NULL DEFAULT 'draft',

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMPTZ(3),
    "late_flag" BOOLEAN NOT NULL DEFAULT FALSE,
    "version" INTEGER NOT NULL DEFAULT 1,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_text_versions" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_text_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_file_links" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "file_id" TEXT,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "content_type" TEXT,
    "storage_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_file_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubric_criteria" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "assignment_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "points_possible" DECIMAL NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rubric_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubric_criterion_scores" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "rubric_criterion_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "grade_id" TEXT,
    "score" DECIMAL,
    "feedback" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rubric_criterion_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "learner_user_id" TEXT NOT NULL,
    "raw_score" DECIMAL,
    "points_possible" DECIMAL NOT NULL DEFAULT 10,
    "grade_status" "GradeStatus" NOT NULL DEFAULT 'ungraded',
    "graded_by_user_id" TEXT,
    "graded_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_feedback" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "grade_id" TEXT NOT NULL,
    "body" TEXT,
    "storage_key" TEXT,
    "file_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_change_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "grade_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "old_raw_score" DECIMAL,
    "new_raw_score" DECIMAL,
    "old_status" "GradeStatus",
    "new_status" "GradeStatus",
    "reason" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_change_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignments_tenant_id_course_offering_id_idx" ON "assignments"("tenant_id", "course_offering_id");
CREATE INDEX "assignments_tenant_id_status_idx" ON "assignments"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "assignment_submissions_tenant_id_assignment_id_idx" ON "assignment_submissions"("tenant_id", "assignment_id");
CREATE INDEX "assignment_submissions_tenant_id_user_id_idx" ON "assignment_submissions"("tenant_id", "user_id");
CREATE UNIQUE INDEX "assignment_submissions_assignment_id_user_id_key" ON "assignment_submissions"("assignment_id", "user_id");

-- CreateIndex
CREATE INDEX "submission_text_versions_submission_id_created_at_idx" ON "submission_text_versions"("submission_id", "created_at");

-- CreateIndex
CREATE INDEX "submission_file_links_submission_id_idx" ON "submission_file_links"("submission_id");

-- CreateIndex
CREATE INDEX "rubric_criteria_tenant_id_course_offering_id_idx" ON "rubric_criteria"("tenant_id", "course_offering_id");
CREATE INDEX "rubric_criteria_tenant_id_assignment_id_idx" ON "rubric_criteria"("tenant_id", "assignment_id");

-- CreateIndex
CREATE INDEX "rubric_criterion_scores_rubric_criterion_id_idx" ON "rubric_criterion_scores"("rubric_criterion_id");
CREATE INDEX "rubric_criterion_scores_grade_id_idx" ON "rubric_criterion_scores"("grade_id");

-- CreateIndex
CREATE INDEX "grades_tenant_id_assignment_id_idx" ON "grades"("tenant_id", "assignment_id");
CREATE INDEX "grades_tenant_id_learner_user_id_idx" ON "grades"("tenant_id", "learner_user_id");
CREATE UNIQUE INDEX "grades_assignment_id_learner_user_id_key" ON "grades"("assignment_id", "learner_user_id");

-- CreateIndex
CREATE INDEX "grade_feedback_grade_id_idx" ON "grade_feedback"("grade_id");

-- CreateIndex
CREATE INDEX "grade_change_events_tenant_id_grade_id_idx" ON "grade_change_events"("tenant_id", "grade_id");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_text_versions" ADD CONSTRAINT "submission_text_versions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_file_links" ADD CONSTRAINT "submission_file_links_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubric_criterion_scores" ADD CONSTRAINT "rubric_criterion_scores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rubric_criterion_scores" ADD CONSTRAINT "rubric_criterion_scores_rubric_criterion_id_fkey" FOREIGN KEY ("rubric_criterion_id") REFERENCES "rubric_criteria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rubric_criterion_scores" ADD CONSTRAINT "rubric_criterion_scores_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rubric_criterion_scores" ADD CONSTRAINT "rubric_criterion_scores_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grades" ADD CONSTRAINT "grades_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grades" ADD CONSTRAINT "grades_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grades" ADD CONSTRAINT "grades_learner_user_id_fkey" FOREIGN KEY ("learner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grades" ADD CONSTRAINT "grades_graded_by_user_id_fkey" FOREIGN KEY ("graded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_feedback" ADD CONSTRAINT "grade_feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grade_feedback" ADD CONSTRAINT "grade_feedback_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_change_events" ADD CONSTRAINT "grade_change_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grade_change_events" ADD CONSTRAINT "grade_change_events_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
