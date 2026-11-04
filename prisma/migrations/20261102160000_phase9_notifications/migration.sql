-- Phase 9: in-app notifications with a retry-safe dedupe key.

CREATE TYPE "notification_category" AS ENUM (
  'sessions',
  'assignments',
  'quizzes',
  'grades',
  'announcements',
  'security',
  'account'
);

CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "category" "notification_category" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "href" TEXT,
  "dedupe_key" TEXT,
  "read_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notifications_tenant_id_user_id_dedupe_key_key"
  ON "notifications" ("tenant_id", "user_id", "dedupe_key");

CREATE INDEX "notifications_tenant_id_user_id_read_at_idx"
  ON "notifications" ("tenant_id", "user_id", "read_at");

CREATE INDEX "notifications_tenant_id_user_id_created_at_idx"
  ON "notifications" ("tenant_id", "user_id", "created_at");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
