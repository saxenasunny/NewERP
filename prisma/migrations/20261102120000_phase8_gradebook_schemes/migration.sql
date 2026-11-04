-- CreateEnum
CREATE TYPE "GradingMode" AS ENUM ('points', 'weighted');

-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('assignment', 'quiz');

-- CreateTable
CREATE TABLE "grading_schemes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "mode" "GradingMode" NOT NULL DEFAULT 'points',
    "pass_mark" DECIMAL(5,2),
    "rounding" INTEGER NOT NULL DEFAULT 2,
    "scale" JSONB NOT NULL DEFAULT '[]',
    "treat_missing_as_zero" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "grading_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_weights" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "grading_scheme_id" TEXT NOT NULL,
    "kind" "AssessmentKind" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "weight" DECIMAL(6,3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_excusals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "AssessmentKind" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_excusals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grading_schemes_course_offering_id_key" ON "grading_schemes"("course_offering_id");

-- CreateIndex
CREATE INDEX "grading_schemes_tenant_id_idx" ON "grading_schemes"("tenant_id");

-- CreateIndex
CREATE INDEX "assessment_weights_tenant_id_grading_scheme_id_idx" ON "assessment_weights"("tenant_id", "grading_scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_weights_grading_scheme_id_kind_ref_id_key" ON "assessment_weights"("grading_scheme_id", "kind", "ref_id");

-- CreateIndex
CREATE INDEX "assessment_excusals_tenant_id_course_offering_id_idx" ON "assessment_excusals"("tenant_id", "course_offering_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_excusals_course_offering_id_user_id_kind_ref_id_key" ON "assessment_excusals"("course_offering_id", "user_id", "kind", "ref_id");

-- AddForeignKey
ALTER TABLE "grading_schemes" ADD CONSTRAINT "grading_schemes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_schemes" ADD CONSTRAINT "grading_schemes_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_weights" ADD CONSTRAINT "assessment_weights_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_weights" ADD CONSTRAINT "assessment_weights_grading_scheme_id_fkey" FOREIGN KEY ("grading_scheme_id") REFERENCES "grading_schemes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_excusals" ADD CONSTRAINT "assessment_excusals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_excusals" ADD CONSTRAINT "assessment_excusals_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_excusals" ADD CONSTRAINT "assessment_excusals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_excusals" ADD CONSTRAINT "assessment_excusals_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
