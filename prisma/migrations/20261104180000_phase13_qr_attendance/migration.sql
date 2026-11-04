-- Phase 13: QR attendance check-in.
--
-- A session carries the nonce and expiry of its current check-in code, so a new
-- code invalidates the previous one without storing every issued token. The
-- attendance row records who produced it (staff marking or the learner's own QR
-- scan) and keeps the existing one-row-per-learner unique constraint as the
-- anti-replay guarantee.

CREATE TYPE "attendance_source" AS ENUM ('staff', 'qr');

ALTER TABLE "attendance_records"
  ADD COLUMN "source" "attendance_source" NOT NULL DEFAULT 'staff';

ALTER TABLE "live_sessions"
  ADD COLUMN "check_in_nonce" TEXT,
  ADD COLUMN "check_in_expires_at" TIMESTAMPTZ(3);
