-- Phase 9: notification preferences, a durable email delivery queue, and course
-- direct messages.

CREATE TYPE "notification_delivery_status" AS ENUM (
  'pending',
  'sent',
  'failed',
  'skipped'
);

CREATE TABLE "notification_preferences" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "category" "notification_category" NOT NULL,
  "in_app" BOOLEAN NOT NULL DEFAULT true,
  "email" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_preferences_tenant_id_user_id_category_key"
  ON "notification_preferences" ("tenant_id", "user_id", "category");

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "notification_deliveries" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "category" "notification_category" NOT NULL,
  "template" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "status" "notification_delivery_status" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "next_attempt_at" TIMESTAMPTZ(3),
  "sent_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_deliveries_tenant_id_user_id_dedupe_key_key"
  ON "notification_deliveries" ("tenant_id", "user_id", "dedupe_key");

CREATE INDEX "notification_deliveries_status_next_attempt_at_idx"
  ON "notification_deliveries" ("status", "next_attempt_at");

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "direct_messages" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "course_offering_id" TEXT NOT NULL,
  "sender_user_id" TEXT NOT NULL,
  "recipient_user_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "read_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "direct_messages_tenant_id_course_offering_id_recipient_user_id_read_at_idx"
  ON "direct_messages" ("tenant_id", "course_offering_id", "recipient_user_id", "read_at");

CREATE INDEX "direct_messages_tenant_id_course_offering_id_sender_user_id_created_at_idx"
  ON "direct_messages" ("tenant_id", "course_offering_id", "sender_user_id", "created_at");

ALTER TABLE "direct_messages"
  ADD CONSTRAINT "direct_messages_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "direct_messages"
  ADD CONSTRAINT "direct_messages_course_offering_id_fkey"
  FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "direct_messages"
  ADD CONSTRAINT "direct_messages_sender_user_id_fkey"
  FOREIGN KEY ("sender_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "direct_messages"
  ADD CONSTRAINT "direct_messages_recipient_user_id_fkey"
  FOREIGN KEY ("recipient_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
