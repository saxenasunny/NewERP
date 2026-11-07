/**
 * Weekly Timetable & Class Schedule Engine — Phase 16.
 *
 * Provides a structured academic timetable management system, including:
 * - Campus room and laboratory directory
 * - Period-by-period class slots with SlotType (Lecture, Practical, Tutorial)
 * - Conflict prevention engine (prevents overlapping faculty or room bookings)
 * - Learner & faculty weekly schedule matrices
 * - "Today's Schedule" widget projections for student & faculty dashboards
 */

import { z } from "zod";
import { requirePermission, type AccountContext } from "@/lib/auth/account";
import { getDb, type DatabaseClient } from "@/lib/db/client";
import {
  ConflictError,
  PermissionDeniedError,
  ResourceNotFoundError,
  TenantSelectionRequiredError,
  ValidationError,
} from "@/lib/errors";
import { getOfferingAccess } from "@/modules/content/content-service";
import { requireOfferingManagement } from "@/modules/sessions/session-service";
import { DayOfWeek, SlotType } from "../../generated/prisma/client";

export { DayOfWeek, SlotType };

export const DAY_ORDER: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  [DayOfWeek.MONDAY]: "Monday",
  [DayOfWeek.TUESDAY]: "Tuesday",
  [DayOfWeek.WEDNESDAY]: "Wednesday",
  [DayOfWeek.THURSDAY]: "Thursday",
  [DayOfWeek.FRIDAY]: "Friday",
  [DayOfWeek.SATURDAY]: "Saturday",
  [DayOfWeek.SUNDAY]: "Sunday",
};

export const STANDARD_PERIODS = [
  { periodNumber: 1, defaultStartTime: "09:00", defaultEndTime: "09:55" },
  { periodNumber: 2, defaultStartTime: "10:00", defaultEndTime: "10:55" },
  { periodNumber: 3, defaultStartTime: "11:00", defaultEndTime: "11:55" },
  { periodNumber: 4, defaultStartTime: "12:00", defaultEndTime: "12:55" },
  { periodNumber: 5, defaultStartTime: "13:45", defaultEndTime: "14:40" },
  { periodNumber: 6, defaultStartTime: "14:45", defaultEndTime: "15:40" },
  { periodNumber: 7, defaultStartTime: "15:45", defaultEndTime: "16:40" },
  { periodNumber: 8, defaultStartTime: "16:45", defaultEndTime: "17:40" },
];

export type CampusRoomView = {
  id: string;
  code: string;
  building: string;
  floor: number;
  capacity: number;
  isLab: boolean;
  slotCount?: number;
};

export type TimetableSlotView = {
  id: string;
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  instructorUserId: string;
  instructorName: string;
  room: CampusRoomView | null;
  dayOfWeek: DayOfWeek;
  dayLabel: string;
  startTime: string;
  endTime: string;
  periodNumber: number;
  slotType: SlotType;
  status?: "UPCOMING" | "IN_PROGRESS" | "COMPLETED";
};

export type DaySchedule = {
  day: DayOfWeek;
  dayLabel: string;
  isToday: boolean;
  slots: TimetableSlotView[];
};

export type WeeklyTimetable = {
  days: DaySchedule[];
  periods: typeof STANDARD_PERIODS;
};

export type TodaySchedule = {
  day: DayOfWeek;
  dayLabel: string;
  slots: TimetableSlotView[];
  activeSlot: TimetableSlotView | null;
  nextSlot: TimetableSlotView | null;
};

function tenantIdOf(account: AccountContext): string {
  if (!account.tenant) throw new TenantSelectionRequiredError();
  return account.tenant.tenantId;
}

/**
 * Converts "HH:mm" 24h string to total minutes since midnight.
 */
export function timeToMinutes(timeStr: string): number {
  const parts = timeStr.trim().split(":");
  if (parts.length !== 2) throw new ValidationError("Invalid time format; expected HH:mm");
  const hours = parseInt(parts[0]!, 10);
  const minutes = parseInt(parts[1]!, 10);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new ValidationError("Invalid time format; expected HH:mm between 00:00 and 23:59");
  }
  return hours * 60 + minutes;
}

/**
 * Pure check: do time interval [startA, endA) and [startB, endB) overlap?
 */
export function timeSlotsOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  const sA = timeToMinutes(startA);
  const eA = timeToMinutes(endA);
  const sB = timeToMinutes(startB);
  const eB = timeToMinutes(endB);
  return Math.max(sA, sB) < Math.min(eA, eB);
}

/**
 * Converts current JS Date into DayOfWeek enum.
 */
export function getCurrentDayOfWeek(date = new Date()): DayOfWeek {
  const dayIndex = date.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
  switch (dayIndex) {
    case 1:
      return DayOfWeek.MONDAY;
    case 2:
      return DayOfWeek.TUESDAY;
    case 3:
      return DayOfWeek.WEDNESDAY;
    case 4:
      return DayOfWeek.THURSDAY;
    case 5:
      return DayOfWeek.FRIDAY;
    case 6:
      return DayOfWeek.SATURDAY;
    case 0:
    default:
      return DayOfWeek.SUNDAY;
  }
}

// ---------------------------------------------------------------------------
// Room Management
// ---------------------------------------------------------------------------

export const createRoomSchema = z.object({
  code: z.string().trim().min(1, "Room code is required").max(30),
  building: z.string().trim().min(1, "Building name is required").max(100),
  floor: z.coerce.number().int().min(-5).max(50).default(1),
  capacity: z.coerce.number().int().min(1).max(1000).default(60),
  isLab: z.boolean().default(false),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export async function listRooms(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<CampusRoomView[]> {
  const tenantId = tenantIdOf(account);
  const rooms = await db.campusRoom.findMany({
    where: { tenantId },
    include: {
      _count: { select: { slots: true } },
    },
    orderBy: [{ building: "asc" }, { code: "asc" }],
  });

  return rooms.map((r) => ({
    id: r.id,
    code: r.code,
    building: r.building,
    floor: r.floor,
    capacity: r.capacity,
    isLab: r.isLab,
    slotCount: r._count.slots,
  }));
}

export async function createRoom(
  account: AccountContext,
  rawInput: CreateRoomInput,
  db: DatabaseClient = getDb(),
): Promise<CampusRoomView> {
  requirePermission(account, "academic_structure.manage");
  const tenantId = tenantIdOf(account);
  const input = createRoomSchema.parse(rawInput);

  const existing = await db.campusRoom.findUnique({
    where: { tenantId_code: { tenantId, code: input.code } },
  });

  if (existing) {
    throw new ConflictError(`A room with code "${input.code}" already exists.`);
  }

  const room = await db.campusRoom.create({
    data: {
      tenantId,
      code: input.code,
      building: input.building,
      floor: input.floor,
      capacity: input.capacity,
      isLab: input.isLab,
    },
  });

  return {
    id: room.id,
    code: room.code,
    building: room.building,
    floor: room.floor,
    capacity: room.capacity,
    isLab: room.isLab,
    slotCount: 0,
  };
}

export async function deleteRoom(
  account: AccountContext,
  roomId: string,
  db: DatabaseClient = getDb(),
): Promise<void> {
  requirePermission(account, "academic_structure.manage");
  const tenantId = tenantIdOf(account);

  const room = await db.campusRoom.findFirst({
    where: { id: roomId, tenantId },
    include: { _count: { select: { slots: true } } },
  });

  if (!room) throw new ResourceNotFoundError("Room not found.");
  if (room._count.slots > 0) {
    throw new ConflictError(
      `Cannot delete room "${room.code}" because it is currently assigned to ${room._count.slots} timetable slot(s).`,
    );
  }

  await db.campusRoom.delete({ where: { id: roomId } });
}

// ---------------------------------------------------------------------------
// Timetable Slot Management & Conflict Prevention Engine
// ---------------------------------------------------------------------------

export const createTimetableSlotSchema = z.object({
  offeringId: z.string().min(1),
  instructorUserId: z.string().min(1),
  roomId: z.string().optional().nullable(),
  dayOfWeek: z.nativeEnum(DayOfWeek),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be in HH:mm format"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be in HH:mm format"),
  periodNumber: z.coerce.number().int().min(1).max(12),
  slotType: z.nativeEnum(SlotType).default(SlotType.LECTURE),
});

export type CreateTimetableSlotInput = z.infer<typeof createTimetableSlotSchema>;

/**
 * Validates against instructor and room scheduling conflicts.
 */
export async function assertNoTimetableConflicts(
  options: {
    tenantId: string;
    dayOfWeek: DayOfWeek;
    startTime: string;
    endTime: string;
    instructorUserId: string;
    roomId?: string | null;
    excludeSlotId?: string;
  },
  db: DatabaseClient = getDb(),
): Promise<void> {
  const { tenantId, dayOfWeek, startTime, endTime, instructorUserId, roomId, excludeSlotId } = options;

  if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
    throw new ValidationError("Class start time must be strictly before end time.");
  }

  // 1. Check Faculty Conflict
  const instructorSlots = await db.timetableSlot.findMany({
    where: {
      tenantId,
      dayOfWeek,
      instructorUserId,
      ...(excludeSlotId ? { id: { not: excludeSlotId } } : {}),
    },
    include: {
      offering: { select: { course: { select: { code: true } } } },
      instructor: { select: { name: true } },
    },
  });

  for (const slot of instructorSlots) {
    if (timeSlotsOverlap(startTime, endTime, slot.startTime, slot.endTime)) {
      throw new ConflictError(
        `Faculty conflict: ${slot.instructor.name} is already scheduled for ${slot.offering.course.code} on ${DAY_LABELS[dayOfWeek]} from ${slot.startTime} to ${slot.endTime}.`,
      );
    }
  }

  // 2. Check Room Conflict
  if (roomId) {
    const roomSlots = await db.timetableSlot.findMany({
      where: {
        tenantId,
        dayOfWeek,
        roomId,
        ...(excludeSlotId ? { id: { not: excludeSlotId } } : {}),
      },
      include: {
        offering: { select: { course: { select: { code: true } } } },
        room: { select: { code: true } },
      },
    });

    for (const slot of roomSlots) {
      if (timeSlotsOverlap(startTime, endTime, slot.startTime, slot.endTime)) {
        throw new ConflictError(
          `Room conflict: Room ${slot.room?.code ?? "selected"} is already booked for ${slot.offering.course.code} on ${DAY_LABELS[dayOfWeek]} from ${slot.startTime} to ${slot.endTime}.`,
        );
      }
    }
  }
}

export async function createTimetableSlot(
  account: AccountContext,
  rawInput: CreateTimetableSlotInput,
  db: DatabaseClient = getDb(),
): Promise<TimetableSlotView> {
  const tenantId = tenantIdOf(account);
  const input = createTimetableSlotSchema.parse(rawInput);

  // Actor must have management access for this course offering
  const access = await requireOfferingManagement(account, input.offeringId, db);

  // Validate conflict prevention
  await assertNoTimetableConflicts(
    {
      tenantId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      instructorUserId: input.instructorUserId,
      roomId: input.roomId,
    },
    db,
  );

  const slot = await db.timetableSlot.create({
    data: {
      tenantId,
      courseOfferingId: input.offeringId,
      instructorUserId: input.instructorUserId,
      roomId: input.roomId || null,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      periodNumber: input.periodNumber,
      slotType: input.slotType,
    },
    include: {
      offering: { select: { course: { select: { code: true, title: true } } } },
      instructor: { select: { id: true, name: true } },
      room: true,
    },
  });

  return {
    id: slot.id,
    offeringId: slot.courseOfferingId,
    courseCode: slot.offering.course.code,
    courseTitle: slot.offering.course.title,
    instructorUserId: slot.instructor.id,
    instructorName: slot.instructor.name,
    room: slot.room
      ? {
          id: slot.room.id,
          code: slot.room.code,
          building: slot.room.building,
          floor: slot.room.floor,
          capacity: slot.room.capacity,
          isLab: slot.room.isLab,
        }
      : null,
    dayOfWeek: slot.dayOfWeek,
    dayLabel: DAY_LABELS[slot.dayOfWeek],
    startTime: slot.startTime,
    endTime: slot.endTime,
    periodNumber: slot.periodNumber,
    slotType: slot.slotType,
  };
}

export async function deleteTimetableSlot(
  account: AccountContext,
  slotId: string,
  db: DatabaseClient = getDb(),
): Promise<void> {
  const tenantId = tenantIdOf(account);
  const slot = await db.timetableSlot.findFirst({
    where: { id: slotId, tenantId },
  });

  if (!slot) throw new ResourceNotFoundError("Timetable slot not found.");
  await requireOfferingManagement(account, slot.courseOfferingId, db);

  await db.timetableSlot.delete({ where: { id: slotId } });
}

/**
 * All timetable slots across the institution for administrators.
 */
export async function listTenantTimetableSlots(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<TimetableSlotView[]> {
  requirePermission(account, "academic_structure.manage");
  const tenantId = tenantIdOf(account);

  const slots = await db.timetableSlot.findMany({
    where: { tenantId },
    include: {
      offering: { select: { course: { select: { code: true, title: true } } } },
      instructor: { select: { id: true, name: true } },
      room: true,
    },
    orderBy: [{ dayOfWeek: "asc" }, { periodNumber: "asc" }, { startTime: "asc" }],
  });

  return slots.map((s) => ({
    id: s.id,
    offeringId: s.courseOfferingId,
    courseCode: s.offering.course.code,
    courseTitle: s.offering.course.title,
    instructorUserId: s.instructor.id,
    instructorName: s.instructor.name,
    room: s.room
      ? {
          id: s.room.id,
          code: s.room.code,
          building: s.room.building,
          floor: s.room.floor,
          capacity: s.room.capacity,
          isLab: s.room.isLab,
        }
      : null,
    dayOfWeek: s.dayOfWeek,
    dayLabel: DAY_LABELS[s.dayOfWeek],
    startTime: s.startTime,
    endTime: s.endTime,
    periodNumber: s.periodNumber,
    slotType: s.slotType,
  }));
}

export async function listOfferingTimetable(
  account: AccountContext,
  offeringId: string,
  db: DatabaseClient = getDb(),
): Promise<TimetableSlotView[]> {
  const tenantId = tenantIdOf(account);
  await getOfferingAccess(account, offeringId, db);

  const slots = await db.timetableSlot.findMany({
    where: { tenantId, courseOfferingId: offeringId },
    include: {
      offering: { select: { course: { select: { code: true, title: true } } } },
      instructor: { select: { id: true, name: true } },
      room: true,
    },
    orderBy: [{ dayOfWeek: "asc" }, { periodNumber: "asc" }, { startTime: "asc" }],
  });

  return slots.map((s) => ({
    id: s.id,
    offeringId: s.courseOfferingId,
    courseCode: s.offering.course.code,
    courseTitle: s.offering.course.title,
    instructorUserId: s.instructor.id,
    instructorName: s.instructor.name,
    room: s.room
      ? {
          id: s.room.id,
          code: s.room.code,
          building: s.room.building,
          floor: s.room.floor,
          capacity: s.room.capacity,
          isLab: s.room.isLab,
        }
      : null,
    dayOfWeek: s.dayOfWeek,
    dayLabel: DAY_LABELS[s.dayOfWeek],
    startTime: s.startTime,
    endTime: s.endTime,
    periodNumber: s.periodNumber,
    slotType: s.slotType,
  }));
}

// ---------------------------------------------------------------------------
// Student & Faculty Weekly Matrices & Today Widgets
// ---------------------------------------------------------------------------

function buildWeeklyMatrix(slots: TimetableSlotView[], today: DayOfWeek): WeeklyTimetable {
  const slotsByDay = new Map<DayOfWeek, TimetableSlotView[]>();
  for (const day of DAY_ORDER) {
    slotsByDay.set(day, []);
  }

  for (const slot of slots) {
    const list = slotsByDay.get(slot.dayOfWeek);
    if (list) list.push(slot);
  }

  const days: DaySchedule[] = DAY_ORDER.map((day) => {
    const daySlots = (slotsByDay.get(day) ?? []).sort((a, b) => {
      if (a.periodNumber !== b.periodNumber) return a.periodNumber - b.periodNumber;
      return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    });

    return {
      day,
      dayLabel: DAY_LABELS[day],
      isToday: day === today,
      slots: daySlots,
    };
  });

  return {
    days,
    periods: STANDARD_PERIODS,
  };
}

export async function getLearnerWeeklyTimetable(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<WeeklyTimetable> {
  const tenantId = tenantIdOf(account);

  // Fetch active enrolments for the student
  const enrolments = await db.enrolment.findMany({
    where: {
      tenantId,
      userId: account.user.id,
      status: "ACTIVE",
    },
    select: { courseOfferingId: true },
  });

  const offeringIds = enrolments.map((e) => e.courseOfferingId);
  if (offeringIds.length === 0) {
    return buildWeeklyMatrix([], getCurrentDayOfWeek());
  }

  const slots = await db.timetableSlot.findMany({
    where: {
      tenantId,
      courseOfferingId: { in: offeringIds },
    },
    include: {
      offering: { select: { course: { select: { code: true, title: true } } } },
      instructor: { select: { id: true, name: true } },
      room: true,
    },
  });

  const viewSlots: TimetableSlotView[] = slots.map((s) => ({
    id: s.id,
    offeringId: s.courseOfferingId,
    courseCode: s.offering.course.code,
    courseTitle: s.offering.course.title,
    instructorUserId: s.instructor.id,
    instructorName: s.instructor.name,
    room: s.room
      ? {
          id: s.room.id,
          code: s.room.code,
          building: s.room.building,
          floor: s.room.floor,
          capacity: s.room.capacity,
          isLab: s.room.isLab,
        }
      : null,
    dayOfWeek: s.dayOfWeek,
    dayLabel: DAY_LABELS[s.dayOfWeek],
    startTime: s.startTime,
    endTime: s.endTime,
    periodNumber: s.periodNumber,
    slotType: s.slotType,
  }));

  return buildWeeklyMatrix(viewSlots, getCurrentDayOfWeek());
}

export async function getFacultyWeeklyTimetable(
  account: AccountContext,
  db: DatabaseClient = getDb(),
): Promise<WeeklyTimetable> {
  const tenantId = tenantIdOf(account);

  const slots = await db.timetableSlot.findMany({
    where: {
      tenantId,
      instructorUserId: account.user.id,
    },
    include: {
      offering: { select: { course: { select: { code: true, title: true } } } },
      instructor: { select: { id: true, name: true } },
      room: true,
    },
  });

  const viewSlots: TimetableSlotView[] = slots.map((s) => ({
    id: s.id,
    offeringId: s.courseOfferingId,
    courseCode: s.offering.course.code,
    courseTitle: s.offering.course.title,
    instructorUserId: s.instructor.id,
    instructorName: s.instructor.name,
    room: s.room
      ? {
          id: s.room.id,
          code: s.room.code,
          building: s.room.building,
          floor: s.room.floor,
          capacity: s.room.capacity,
          isLab: s.room.isLab,
        }
      : null,
    dayOfWeek: s.dayOfWeek,
    dayLabel: DAY_LABELS[s.dayOfWeek],
    startTime: s.startTime,
    endTime: s.endTime,
    periodNumber: s.periodNumber,
    slotType: s.slotType,
  }));

  return buildWeeklyMatrix(viewSlots, getCurrentDayOfWeek());
}

/**
 * Returns today's active, upcoming, and completed class slots for the actor
 * (either learner or faculty) with real-time status.
 */
export async function getTodaySchedule(
  account: AccountContext,
  now = new Date(),
  db: DatabaseClient = getDb(),
): Promise<TodaySchedule> {
  const today = getCurrentDayOfWeek(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const isLearner = account.navRole === "student";
  const matrix = isLearner
    ? await getLearnerWeeklyTimetable(account, db)
    : await getFacultyWeeklyTimetable(account, db);

  const todaySchedule = matrix.days.find((d) => d.day === today);
  const rawSlots = todaySchedule ? [...todaySchedule.slots] : [];

  let activeSlot: TimetableSlotView | null = null;
  let nextSlot: TimetableSlotView | null = null;

  const enrichedSlots: TimetableSlotView[] = rawSlots.map((slot) => {
    const startM = timeToMinutes(slot.startTime);
    const endM = timeToMinutes(slot.endTime);

    let status: "UPCOMING" | "IN_PROGRESS" | "COMPLETED";
    if (nowMinutes >= endM) {
      status = "COMPLETED";
    } else if (nowMinutes >= startM && nowMinutes < endM) {
      status = "IN_PROGRESS";
      activeSlot = slot;
    } else {
      status = "UPCOMING";
      if (!nextSlot && !activeSlot) {
        nextSlot = slot;
      }
    }

    return { ...slot, status };
  });

  return {
    day: today,
    dayLabel: DAY_LABELS[today],
    slots: enrichedSlots,
    activeSlot,
    nextSlot,
  };
}
