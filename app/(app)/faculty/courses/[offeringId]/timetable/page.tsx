import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { getOfferingAccess } from "@/modules/content/content-service";
import {
  DAY_LABELS,
  DAY_ORDER,
  DayOfWeek,
  listOfferingTimetable,
  listRooms,
  SlotType,
  STANDARD_PERIODS,
} from "@/modules/timetable/timetable-service";

import { createSlotAction, deleteSlotAction } from "./actions";

export const metadata: Metadata = { title: "Course Timetable · Faculty" };

const SLOT_TYPE_COLORS = {
  LECTURE: "bg-blue-50 text-blue-700 border-blue-200",
  TUTORIAL: "bg-purple-50 text-purple-700 border-purple-200",
  PRACTICAL: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export default async function FacultyCourseTimetablePage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  const [{ offeringId }, { notice, error }] = await Promise.all([params, searchParams]);

  let access;
  let slots;
  let rooms;
  let offeringDetails;

  const db = getDb();
  try {
    const [fetchedAccess, fetchedSlots, fetchedRooms, fetchedOffering] = await Promise.all([
      getOfferingAccess(account, offeringId, db),
      listOfferingTimetable(account, offeringId, db),
      listRooms(account, db),
      db.courseOffering.findFirst({
        where: { id: offeringId },
        include: {
          instructors: { include: { user: { select: { id: true, name: true } } } },
        },
      }),
    ]);
    access = fetchedAccess;
    slots = fetchedSlots;
    rooms = fetchedRooms;
    offeringDetails = fetchedOffering;
  } catch (caught) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Course Timetable" />
        <Alert tone="warning" title="Not available">
          {caught instanceof AppError ? caught.message : "The timetable could not be loaded."}
        </Alert>
      </div>
    );
  }

  const instructors = offeringDetails?.instructors.map((i) => i.user) ?? [];
  const canManage = access.canManage;

  // Group slots by day
  const slotsByDay = new Map<DayOfWeek, typeof slots>();
  for (const day of DAY_ORDER) {
    slotsByDay.set(day, []);
  }
  for (const slot of slots) {
    const list = slotsByDay.get(slot.dayOfWeek);
    if (list) list.push(slot);
  }

  return (
    <div className="flex flex-col gap-8 pb-12">
      <Breadcrumbs
        items={[
          { label: "My courses", href: "/faculty/courses" },
          { label: access.courseCode, href: `/faculty/courses/${offeringId}` },
          { label: "Class timetable" },
        ]}
      />

      <PageHeader
        title={`${access.courseCode} Weekly Timetable`}
        description={`${access.courseTitle} · ${access.termName}. Configure weekly lecture periods, lab practicals, room allocations, and faculty assignments with active conflict prevention.`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/faculty/courses/${offeringId}/attendance`}>
              <Button variant="secondary" size="sm">
                Attendance Report
              </Button>
            </Link>
            <Link href="/admin/rooms">
              <Button variant="secondary" size="sm">
                Campus Rooms
              </Button>
            </Link>
          </div>
        }
      />

      {notice ? <Alert tone="success" title="Success">{notice}</Alert> : null}
      {error ? <Alert tone="danger" title="Scheduling Conflict">{error}</Alert> : null}

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left Column: Add Timetable Slot Form (1 col) */}
        {canManage ? (
          <div className="lg:col-span-1">
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm sticky top-6">
              <h2 className="text-base font-bold text-ink mb-1">Schedule Class Period</h2>
              <p className="text-xs text-ink-muted mb-4">
                Assign recurring weekly class slot. Double-booking conflicts are automatically blocked.
              </p>

              <form action={createSlotAction} className="flex flex-col gap-4">
                <input type="hidden" name="offeringId" value={offeringId} />

                <Select
                  id="slot-day"
                  label="Day of the Week"
                  name="dayOfWeek"
                  defaultValue={DayOfWeek.MONDAY}
                  required
                >
                  {DAY_ORDER.map((day) => (
                    <option key={day} value={day}>
                      {DAY_LABELS[day]}
                    </option>
                  ))}
                </Select>

                <div className="grid grid-cols-2 gap-3">
                  <Select
                    id="slot-period"
                    label="Period"
                    name="periodNumber"
                    defaultValue="1"
                    required
                  >
                    {STANDARD_PERIODS.map((p) => (
                      <option key={p.periodNumber} value={p.periodNumber}>
                        Period {p.periodNumber} ({p.defaultStartTime})
                      </option>
                    ))}
                  </Select>

                  <Select
                    id="slot-type"
                    label="Slot Type"
                    name="slotType"
                    defaultValue={SlotType.LECTURE}
                    required
                  >
                    <option value={SlotType.LECTURE}>Lecture</option>
                    <option value={SlotType.PRACTICAL}>Lab / Practical</option>
                    <option value={SlotType.TUTORIAL}>Tutorial</option>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    id="slot-start-time"
                    label="Start Time (24h)"
                    name="startTime"
                    defaultValue="09:00"
                    placeholder="09:00"
                    pattern="^([01]\d|2[0-3]):[0-5]\d$"
                    required
                    hint="HH:mm"
                  />

                  <Input
                    id="slot-end-time"
                    label="End Time (24h)"
                    name="endTime"
                    defaultValue="09:55"
                    placeholder="09:55"
                    pattern="^([01]\d|2[0-3]):[0-5]\d$"
                    required
                    hint="HH:mm"
                  />
                </div>

                <Select
                  id="slot-instructor"
                  label="Assigned Instructor"
                  name="instructorUserId"
                  defaultValue={account.user.id}
                  required
                  hint="Faculty member taking this period"
                >
                  {instructors.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name}
                    </option>
                  ))}
                  {instructors.length === 0 ? (
                    <option value={account.user.id}>{account.user.name}</option>
                  ) : null}
                </Select>

                <Select
                  id="slot-room"
                  label="Classroom / Lab"
                  name="roomId"
                  defaultValue=""
                  hint="Physical room on campus (optional)"
                >
                  <option value="">Online / TBA</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.code} ({room.building} · {room.isLab ? "Lab" : "Classroom"})
                    </option>
                  ))}
                </Select>

                <Button type="submit" variant="primary" size="md" className="w-full mt-2 font-bold">
                  Schedule Class Slot
                </Button>
              </form>
            </div>
          </div>
        ) : null}

        {/* Right Column: Weekly Schedule Breakdown (2 cols) */}
        <div className={`flex flex-col gap-6 ${canManage ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 text-xs text-blue-900 flex items-start gap-2.5">
            <span className="text-base select-none">🛡️</span>
            <div>
              <p className="font-bold">Active Conflict Prevention Engine</p>
              <p className="mt-0.5 text-blue-800 text-[11px]">
                The timetable engine automatically validates all slot submissions. It strictly blocks overlapping teacher schedules and double-booked classrooms.
              </p>
            </div>
          </div>

          {slots.length === 0 ? (
            <EmptyState
              title="No class slots scheduled yet"
              description="Add weekly periods using the form on the left. Students enrolled in this course will immediately see them in their weekly timetable."
            />
          ) : (
            <div className="flex flex-col gap-6">
              {DAY_ORDER.map((day) => {
                const daySlots = slotsByDay.get(day) ?? [];
                if (daySlots.length === 0) return null;

                return (
                  <div key={day} className="flex flex-col gap-3">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                        <span>🗓️</span> {DAY_LABELS[day]}
                      </h3>
                      <span className="text-xs text-ink-muted">
                        {daySlots.length} {daySlots.length === 1 ? "Period" : "Periods"}
                      </span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {daySlots.map((slot) => (
                        <div
                          key={slot.id}
                          className="flex flex-col justify-between rounded-xl border border-border bg-surface p-4 shadow-2xs hover:border-brand-200 transition-all"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-mono text-xs font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded">
                                P{slot.periodNumber} · {slot.startTime}–{slot.endTime}
                              </span>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                                  SLOT_TYPE_COLORS[slot.slotType]
                                }`}
                              >
                                {slot.slotType}
                              </span>
                            </div>

                            <p className="mt-2 text-xs font-semibold text-ink">
                              Faculty: <span className="font-bold">{slot.instructorName}</span>
                            </p>
                            <p className="mt-1 text-xs text-ink-muted">
                              Location:{" "}
                              {slot.room ? (
                                <span className="font-medium text-ink">
                                  {slot.room.code} ({slot.room.building}
                                  {slot.room.isLab ? " · Lab" : ""})
                                </span>
                              ) : (
                                <span className="italic">Online / TBA</span>
                              )}
                            </p>
                          </div>

                          {canManage ? (
                            <div className="mt-4 pt-2 border-t border-border flex justify-end">
                              <form action={deleteSlotAction}>
                                <input type="hidden" name="offeringId" value={offeringId} />
                                <input type="hidden" name="slotId" value={slot.id} />
                                <Button
                                  type="submit"
                                  variant="ghost"
                                  size="sm"
                                  className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                                >
                                  Remove Slot
                                </Button>
                              </form>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
