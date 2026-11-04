-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('rich_text', 'file', 'link', 'video_link');

-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('not_started', 'in_progress', 'completed');

-- CreateTable
CREATE TABLE "course_modules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 1,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_prerequisites" (
    "tenant_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "prerequisite_module_id" TEXT NOT NULL,

    CONSTRAINT "module_prerequisites_pkey" PRIMARY KEY ("module_id","prerequisite_module_id")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "ContentKind" NOT NULL DEFAULT 'rich_text',
    "body" TEXT,
    "url" TEXT,
    "storage_key" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER,
    "content_type" TEXT,
    "position" INTEGER NOT NULL DEFAULT 1,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "available_from" TIMESTAMPTZ(3),
    "available_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_progress" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "ProgressStatus" NOT NULL DEFAULT 'not_started',
    "first_viewed_at" TIMESTAMPTZ(3),
    "last_viewed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "content_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "content_item_id" TEXT,
    "type" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_modules_tenant_id_course_offering_id_position_idx" ON "course_modules"("tenant_id", "course_offering_id", "position");

-- CreateIndex
CREATE INDEX "module_prerequisites_tenant_id_idx" ON "module_prerequisites"("tenant_id");

-- CreateIndex
CREATE INDEX "module_prerequisites_prerequisite_module_id_idx" ON "module_prerequisites"("prerequisite_module_id");

-- CreateIndex
CREATE INDEX "content_items_tenant_id_module_id_position_idx" ON "content_items"("tenant_id", "module_id", "position");

-- CreateIndex
CREATE INDEX "content_progress_tenant_id_user_id_idx" ON "content_progress"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_progress_content_item_id_user_id_key" ON "content_progress"("content_item_id", "user_id");

-- CreateIndex
CREATE INDEX "learning_events_tenant_id_course_offering_id_created_at_idx" ON "learning_events"("tenant_id", "course_offering_id", "created_at");

-- CreateIndex
CREATE INDEX "learning_events_tenant_id_user_id_created_at_idx" ON "learning_events"("tenant_id", "user_id", "created_at");

-- AddForeignKey
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_prerequisites" ADD CONSTRAINT "module_prerequisites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_prerequisites" ADD CONSTRAINT "module_prerequisites_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_prerequisites" ADD CONSTRAINT "module_prerequisites_prerequisite_module_id_fkey" FOREIGN KEY ("prerequisite_module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_progress" ADD CONSTRAINT "content_progress_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_progress" ADD CONSTRAINT "content_progress_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_progress" ADD CONSTRAINT "content_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
