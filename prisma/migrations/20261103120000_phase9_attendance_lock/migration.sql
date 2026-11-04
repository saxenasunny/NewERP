-- AlterTable
ALTER TABLE "live_sessions" ADD COLUMN "attendance_locked_at" TIMESTAMPTZ(3),
ADD COLUMN "attendance_reopened_at" TIMESTAMPTZ(3),
ADD COLUMN "attendance_reopened_by_user_id" TEXT;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_attendance_reopened_by_user_id_fkey" FOREIGN KEY ("attendance_reopened_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
