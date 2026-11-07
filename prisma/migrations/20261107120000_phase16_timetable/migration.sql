-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "SlotType" AS ENUM ('LECTURE', 'TUTORIAL', 'PRACTICAL');

-- CreateTable
CREATE TABLE "campus_rooms" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "building" TEXT NOT NULL,
    "floor" INTEGER NOT NULL DEFAULT 1,
    "capacity" INTEGER NOT NULL DEFAULT 60,
    "is_lab" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campus_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_slots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "instructor_user_id" TEXT NOT NULL,
    "room_id" TEXT,
    "day_of_week" "DayOfWeek" NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "period_number" INTEGER NOT NULL,
    "slot_type" "SlotType" NOT NULL DEFAULT 'LECTURE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "timetable_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campus_rooms_tenant_id_code_key" ON "campus_rooms"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "campus_rooms_tenant_id_idx" ON "campus_rooms"("tenant_id");

-- CreateIndex
CREATE INDEX "timetable_slots_tenant_id_day_of_week_period_number_idx" ON "timetable_slots"("tenant_id", "day_of_week", "period_number");

-- CreateIndex
CREATE INDEX "timetable_slots_course_offering_id_idx" ON "timetable_slots"("course_offering_id");

-- CreateIndex
CREATE INDEX "timetable_slots_instructor_user_id_idx" ON "timetable_slots"("instructor_user_id");

-- CreateIndex
CREATE INDEX "timetable_slots_room_id_idx" ON "timetable_slots"("room_id");

-- AddForeignKey
ALTER TABLE "campus_rooms" ADD CONSTRAINT "campus_rooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_instructor_user_id_fkey" FOREIGN KEY ("instructor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "campus_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
