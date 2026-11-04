-- CreateEnum
CREATE TYPE "ProgrammeOutcomeType" AS ENUM ('peo', 'po', 'pso');

-- CreateEnum
CREATE TYPE "OutcomeRecordStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "AssessmentMappingKind" AS ENUM ('assignment', 'question');

-- CreateEnum
CREATE TYPE "AttainmentPolicyStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateTable
CREATE TABLE "programme_outcomes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "programme_id" TEXT NOT NULL,
    "type" "ProgrammeOutcomeType" NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "status" "OutcomeRecordStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "programme_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_outcomes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "status" "OutcomeRecordStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "course_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outcome_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "course_outcome_id" TEXT NOT NULL,
    "programme_outcome_id" TEXT NOT NULL,
    "correlation_level" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outcome_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_outcome_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "course_outcome_id" TEXT NOT NULL,
    "kind" "AssessmentMappingKind" NOT NULL,
    "assignment_id" TEXT,
    "question_id" TEXT,
    "weight" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessment_outcome_mappings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assessment_outcome_one_target" CHECK (
      ("kind" = 'assignment' AND "assignment_id" IS NOT NULL AND "question_id" IS NULL)
      OR ("kind" = 'question' AND "question_id" IS NOT NULL AND "assignment_id" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "attainment_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AttainmentPolicyStatus" NOT NULL DEFAULT 'draft',
    "configuration" JSONB NOT NULL,
    "notes" TEXT,
    "activated_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attainment_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "programme_outcomes_programme_id_type_code_key" ON "programme_outcomes"("programme_id", "type", "code");

-- CreateIndex
CREATE INDEX "programme_outcomes_tenant_id_programme_id_type_idx" ON "programme_outcomes"("tenant_id", "programme_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "course_outcomes_course_offering_id_code_key" ON "course_outcomes"("course_offering_id", "code");

-- CreateIndex
CREATE INDEX "course_outcomes_tenant_id_course_offering_id_idx" ON "course_outcomes"("tenant_id", "course_offering_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_mappings_course_outcome_id_programme_outcome_id_key" ON "outcome_mappings"("course_outcome_id", "programme_outcome_id");

-- CreateIndex
CREATE INDEX "outcome_mappings_tenant_id_programme_outcome_id_idx" ON "outcome_mappings"("tenant_id", "programme_outcome_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_outcome_mappings_course_outcome_id_assignment_id_key" ON "assessment_outcome_mappings"("course_outcome_id", "assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_outcome_mappings_course_outcome_id_question_id_key" ON "assessment_outcome_mappings"("course_outcome_id", "question_id");

-- CreateIndex
CREATE INDEX "assessment_outcome_mappings_tenant_id_course_outcome_id_idx" ON "assessment_outcome_mappings"("tenant_id", "course_outcome_id");

-- CreateIndex
CREATE INDEX "assessment_outcome_mappings_assignment_id_idx" ON "assessment_outcome_mappings"("assignment_id");

-- CreateIndex
CREATE INDEX "assessment_outcome_mappings_question_id_idx" ON "assessment_outcome_mappings"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "attainment_policies_tenant_id_name_version_key" ON "attainment_policies"("tenant_id", "name", "version");

-- CreateIndex
CREATE INDEX "attainment_policies_tenant_id_status_idx" ON "attainment_policies"("tenant_id", "status");

-- At most one active policy per institution.
CREATE UNIQUE INDEX "attainment_policies_one_active" ON "attainment_policies"("tenant_id") WHERE "status" = 'active';

-- AddForeignKey
ALTER TABLE "programme_outcomes" ADD CONSTRAINT "programme_outcomes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "programme_outcomes" ADD CONSTRAINT "programme_outcomes_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "course_outcomes" ADD CONSTRAINT "course_outcomes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "course_outcomes" ADD CONSTRAINT "course_outcomes_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outcome_mappings" ADD CONSTRAINT "outcome_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outcome_mappings" ADD CONSTRAINT "outcome_mappings_course_outcome_id_fkey" FOREIGN KEY ("course_outcome_id") REFERENCES "course_outcomes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outcome_mappings" ADD CONSTRAINT "outcome_mappings_programme_outcome_id_fkey" FOREIGN KEY ("programme_outcome_id") REFERENCES "programme_outcomes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assessment_outcome_mappings" ADD CONSTRAINT "assessment_outcome_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assessment_outcome_mappings" ADD CONSTRAINT "assessment_outcome_mappings_course_outcome_id_fkey" FOREIGN KEY ("course_outcome_id") REFERENCES "course_outcomes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assessment_outcome_mappings" ADD CONSTRAINT "assessment_outcome_mappings_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assessment_outcome_mappings" ADD CONSTRAINT "assessment_outcome_mappings_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attainment_policies" ADD CONSTRAINT "attainment_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
