-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('issued', 'reissued', 'revoked');

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "certificate_number" TEXT NOT NULL,
    "verification_token" TEXT NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'issued',
    "learner_name" TEXT NOT NULL,
    "course_code" TEXT NOT NULL,
    "course_title" TEXT NOT NULL,
    "institution_name" TEXT NOT NULL,
    "issuer_name" TEXT NOT NULL,
    "rule_snapshot" JSONB NOT NULL,
    "evidence_snapshot" JSONB NOT NULL,
    "reissued_from_id" TEXT,
    "issued_by_user_id" TEXT,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_user_id" TEXT,
    "revocation_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "certificates_certificate_number_key" ON "certificates"("certificate_number");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_verification_token_key" ON "certificates"("verification_token");

-- CreateIndex
CREATE INDEX "certificates_tenant_id_course_offering_id_idx" ON "certificates"("tenant_id", "course_offering_id");

-- CreateIndex
CREATE INDEX "certificates_tenant_id_user_id_idx" ON "certificates"("tenant_id", "user_id");

-- One active certificate per learner per offering. A reissue marks the previous
-- row `reissued` before the replacement is written, so history is kept while the
-- completion can never hold two live certificates.
CREATE UNIQUE INDEX "certificates_one_issued_per_completion" ON "certificates"("course_offering_id", "user_id") WHERE "status" = 'issued';

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
